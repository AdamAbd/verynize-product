// Per-page storage of a room's design document in the room's SQLite (cloud/rooms.js).
//
// A version-2 document (`pages[].nodes[]`) is stored as:
// - its metadata: every top-level field except `pages` (name, variables, styles, …), key `m`;
// - one record per page, keyed by page id: a `pages` row (position, size, node count) and the
//   page's JSON split into its properties (key `h:<id>`) and its nodes (key `n:<id>`);
// - `node_pages`: node id → page id, so node ids stay unique across pages that a batch does not load.
// Texts live in `parts` rows of at most 256 Ki UTF-16 units (≤ 1 MiB of UTF-8), because a
// Durable Object SQLite row holds at most 2 MB. Other JSON documents (no pages, or a repeated page id) are one text, `w`.
//
// Operation batches load only the pages they touch (VerynizeOps.touchedPages); the pages they
// leave out are stubs (`nodes: []`) that are never written back. Writes are validated against the
// limits of cloud/limits.js before anything is stored.
//
// Rooms created before this layout kept the whole document in `room.document`. `migrate` converts
// such a room on first open, inside the constructor's synchronous turn (atomic), and records
// `layout` in the `meta` table, so it runs once.
import "../web/cloud-ops.js";
import { fail } from "./http.js";
import { DOCUMENT_BYTES, META_BYTES, PAGE_BYTES, byteSize } from "./limits.js";

const Ops = globalThis.VerynizeOps;
const PART_CHARS = 256 * 1024;
const MB = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
// `null` keeps the key's position, so assembled documents serialize like the stored ones.
const headText = (page) => JSON.stringify({ ...page, nodes: null });
const metaText = (doc) => JSON.stringify({ ...doc, pages: null });

/** Split a text into parts without separating a UTF-16 surrogate pair. */
function chunks(text) {
  const out = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + PART_CHARS);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}

const tooLarge = (message) => fail(413, message);
// Page records are keyed by id; a document repeating a page id is kept as one text instead.
const paged = (doc) =>
  Ops.isStructured(doc) && new Set(doc.pages.map((page) => page.id)).size === doc.pages.length;
const pageLabel = (page) =>
  typeof page.name === "string" && page.name ? `Page "${page.name.slice(0, 60)}"` : "A page";

export class RoomStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, position INTEGER NOT NULL, bytes INTEGER NOT NULL, nodes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS parts (key TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, part));
      CREATE TABLE IF NOT EXISTS node_pages (node_id TEXT PRIMARY KEY, page_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS node_pages_page ON node_pages (page_id);
    `);
  }

  setting(key) {
    return this.sql.exec("SELECT value FROM meta WHERE key=?", key).toArray()[0]?.value ?? null;
  }
  setSetting(key, value) {
    this.sql.exec("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)", key, String(value));
  }
  /** "pages" (per-page records), "json" (one text) or null (legacy `room.document`). */
  get layout() {
    return this.setting("layout");
  }

  text(key) {
    return this.sql
      .exec("SELECT data FROM parts WHERE key=? ORDER BY part", key)
      .toArray()
      .map((row) => row.data)
      .join("");
  }
  writeText(key, text) {
    this.sql.exec("DELETE FROM parts WHERE key=?", key);
    chunks(text).forEach((data, part) =>
      this.sql.exec("INSERT INTO parts (key,part,data) VALUES (?,?,?)", key, part, data),
    );
  }
  dropPage(id) {
    this.sql.exec("DELETE FROM pages WHERE id=?", id);
    this.sql.exec("DELETE FROM parts WHERE key=? OR key=?", "h:" + id, "n:" + id);
    this.sql.exec("DELETE FROM node_pages WHERE page_id=?", id);
  }
  clear() {
    this.sql.exec("DELETE FROM pages");
    this.sql.exec("DELETE FROM node_pages");
    this.sql.exec("DELETE FROM parts WHERE key<>'pub'");
  }

  /**
   * Convert a legacy room (whole document in `room.document`) once. Returns true when it ran.
   * Size limits are not applied: the legacy room already held the document.
   */
  migrate(row) {
    if (!row || this.layout) return false;
    const document = JSON.parse(row.document);
    this.replace(document, { enforce: false });
    this.sql.exec("UPDATE room SET document='' WHERE id=1");
    return true;
  }

  /** Page records in order: [{id, bytes, nodes}] (empty for documents without pages). */
  index() {
    if (this.layout !== "pages") return [];
    return this.sql.exec("SELECT id,bytes,nodes FROM pages ORDER BY position").toArray();
  }
  /** The page `id` with its nodes, or null. */
  page(id) {
    if (this.layout !== "pages") return null;
    if (!this.sql.exec("SELECT 1 AS found FROM pages WHERE id=?", id).toArray().length) return null;
    const page = JSON.parse(this.text("h:" + id));
    page.nodes = JSON.parse(this.text("n:" + id));
    return page;
  }
  /** Page id holding a node (node ids are unique per document), or null. */
  nodePage(id) {
    return (
      this.sql.exec("SELECT page_id FROM node_pages WHERE node_id=?", id).toArray()[0]?.page_id ??
      null
    );
  }
  metadata() {
    if (this.layout === "pages") return JSON.parse(this.text("m"));
    if (this.layout === "json") return JSON.parse(this.text("w"));
    return null;
  }
  title() {
    try {
      const doc = this.metadata();
      return typeof doc?.name === "string" ? doc.name.slice(0, 120) : "Shared design";
    } catch {
      return "Shared design";
    }
  }

  /**
   * The document with the pages in `ids` (all with null) holding their nodes and the others as
   * stubs (their properties, `nodes: []`). Returns {doc, stubs: Set of stub ids, texts, meta}:
   * the texts let `commit` skip unchanged records.
   */
  load(ids = null) {
    if (this.layout === "json") {
      const text = this.text("w");
      return { doc: JSON.parse(text), stubs: new Set(), texts: new Map(), meta: text };
    }
    const meta = this.text("m");
    const doc = JSON.parse(meta);
    const stubs = new Set(),
      texts = new Map();
    doc.pages = this.index().map(({ id }) => {
      const head = this.text("h:" + id);
      const page = JSON.parse(head);
      if (ids && !ids.has(id)) {
        page.nodes = [];
        stubs.add(id);
        return page;
      }
      const nodes = this.text("n:" + id);
      page.nodes = JSON.parse(nodes);
      texts.set(id, { head, nodes, ids: page.nodes.map((node) => node.id) });
      return page;
    });
    return { doc, stubs, texts, meta };
  }
  /** The whole document. */
  read() {
    return this.load(null).doc;
  }

  /** Store `document` in place of everything (create, migration, conversion of the layout). */
  replace(document, { enforce = true } = {}) {
    if (!paged(document)) return this.writeJson(document, enforce);
    this.commit(
      { doc: { pages: [] }, stubs: new Set(), texts: new Map(), meta: null },
      document,
      { replace: true, enforce },
    );
  }

  writeJson(document, enforce = true) {
    if (document === null || typeof document !== "object")
      fail(400, "Document must be a JSON object or array");
    const text = JSON.stringify(document);
    if (enforce && byteSize(text) > META_BYTES)
      tooLarge(`Documents without pages are limited to ${MB(META_BYTES)}`);
    this.clear();
    this.writeText("w", text);
    this.setSetting("layout", "json");
  }

  /**
   * Store `after`, a change of the loaded `state` (load()). Only the metadata and the loaded or
   * new pages that changed are written; stub pages keep their stored records. Removed pages are
   * deleted and positions follow `after.pages`. Throws 413 before writing anything when a page,
   * the metadata or the whole document exceeds its limit.
   */
  commit(state, after, { replace = false, enforce = true } = {}) {
    if (!paged(after)) return this.writeJson(after, enforce);
    if (!replace && this.layout !== "pages") return this.replace(after, { enforce });
    const meta = metaText(after);
    const metaBytes = byteSize(meta) - 4;
    if (enforce && metaBytes > META_BYTES)
      tooLarge(`The document's settings and variables exceed ${MB(META_BYTES)}`);
    const stored = new Map(
      replace
        ? []
        : this.sql
            .exec("SELECT id,position,bytes FROM pages")
            .toArray()
            .map((row) => [row.id, row]),
    );
    const writes = [];
    let total = metaBytes;
    for (const page of after.pages) {
      if (stored.has(page.id) && state.stubs.has(page.id)) {
        total += stored.get(page.id).bytes;
        continue;
      }
      const head = headText(page),
        nodes = JSON.stringify(page.nodes);
      const bytes = byteSize(head) - 4 + byteSize(nodes);
      if (enforce && bytes > PAGE_BYTES)
        tooLarge(`${pageLabel(page)} exceeds the ${MB(PAGE_BYTES)} page limit`);
      total += bytes;
      const previous = stored.has(page.id) ? state.texts.get(page.id) : null;
      if (previous && previous.head === head && previous.nodes === nodes) continue;
      writes.push({ page, head, nodes, bytes, previous });
    }
    if (enforce && total > DOCUMENT_BYTES)
      tooLarge(`The document exceeds the ${MB(DOCUMENT_BYTES)} room limit`);

    if (replace) this.clear();
    const kept = new Set(after.pages.map((page) => page.id));
    for (const id of stored.keys()) if (!kept.has(id)) this.dropPage(id);
    if (meta !== state.meta) this.writeText("m", meta);
    // Node index: removals of every written page first, so a node moved between pages keeps its row.
    const added = [];
    for (const { page, previous } of writes) {
      const now = new Set(page.nodes.map((node) => node.id));
      const before = new Set(previous?.ids || []);
      for (const id of before)
        if (!now.has(id))
          this.sql.exec("DELETE FROM node_pages WHERE node_id=? AND page_id=?", id, page.id);
      for (const id of now) if (!before.has(id)) added.push([id, page.id]);
    }
    for (const [id, page] of added)
      this.sql.exec("INSERT OR REPLACE INTO node_pages (node_id,page_id) VALUES (?,?)", id, page);
    for (const { page, head, nodes, bytes, previous } of writes) {
      if (previous?.head !== head) this.writeText("h:" + page.id, head);
      if (previous?.nodes !== nodes) this.writeText("n:" + page.id, nodes);
      this.sql.exec(
        "INSERT INTO pages (id,position,bytes,nodes) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes, nodes=excluded.nodes",
        page.id,
        stored.get(page.id)?.position ?? -1,
        bytes,
        page.nodes.length,
      );
    }
    after.pages.forEach((page, position) => {
      if (stored.get(page.id)?.position !== position)
        this.sql.exec("UPDATE pages SET position=? WHERE id=?", position, page.id);
    });
    if (this.layout !== "pages") this.setSetting("layout", "pages");
  }

  // ---- public snapshot (frozen copy of the whole document) --------------------------------
  publish() {
    this.writeText("pub", JSON.stringify(this.read()));
  }
  unpublish() {
    this.sql.exec("DELETE FROM parts WHERE key='pub'");
  }
  /** The published document: the legacy `room.public_document` copy, or the stored parts. */
  published(row) {
    if (row.public_document) return JSON.parse(row.public_document);
    const text = this.text("pub");
    return text ? JSON.parse(text) : null;
  }
}
