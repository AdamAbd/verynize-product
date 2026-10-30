// Published applications: one SQLite Durable Object per app holding immutable, versioned
// static builds (HTML/JS/CSS/assets uploaded from the desktop after a local build).
import { DurableObject } from "cloudflare:workers";
import { rpcFail, bytesHex } from "./http.js";

const CHUNK = 1024 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const MAX_VERSION_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_VERSIONS = 20;

const TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};
export const contentTypeOf = (path) =>
  TYPES[(/\.([a-z0-9]+)$/i.exec(path)?.[1] || "").toLowerCase()] || "application/octet-stream";

/** Normalised relative file path, or null when it could escape the version or is malformed. */
export function cleanPath(value) {
  if (typeof value !== "string" || !value || value.length > 400) return null;
  let path;
  try {
    path = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f]/.test(path) || path.startsWith("/")) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return path;
}

export class PublishedApp extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL, files INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS files (version INTEGER NOT NULL, path TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, chunks INTEGER NOT NULL, PRIMARY KEY (version, path));
      CREATE TABLE IF NOT EXISTS chunks (version INTEGER NOT NULL, path TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (version, path, idx));
    `);
  }

  version(version) {
    return this.sql.exec("SELECT * FROM versions WHERE version=?", version).toArray()[0] || null;
  }

  createVersion(note) {
    const ready = this.sql.exec("SELECT COUNT(*) AS n FROM versions WHERE state='ready'").one().n;
    if (ready >= MAX_VERSIONS) rpcFail(409, `Delete an old version first (limit ${MAX_VERSIONS})`);
    // Abandoned uploads older than a day are discarded.
    for (const old of this.sql
      .exec(
        "SELECT version FROM versions WHERE state='uploading' AND created_at<?",
        Date.now() - 86400000,
      )
      .toArray())
      this.dropVersion(old.version);
    this.sql.exec(
      "INSERT INTO versions (state,note,created_at) VALUES ('uploading',?,?)",
      typeof note === "string" ? note.slice(0, 200) : null,
      Date.now(),
    );
    return { version: this.sql.exec("SELECT last_insert_rowid() AS v").one().v };
  }

  async putFile(version, rawPath, bytes) {
    const row = this.version(version);
    if (!row || row.state !== "uploading") rpcFail(409, "This version is not accepting files");
    const path = cleanPath(rawPath);
    if (!path) rpcFail(400, "Invalid file path");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE)
      rpcFail(413, "Files are limited to 25 MB");
    const previous = this.sql
      .exec("SELECT size FROM files WHERE version=? AND path=?", version, path)
      .toArray()[0];
    const files = row.files + (previous ? 0 : 1),
      total = row.bytes - (previous?.size || 0) + bytes.byteLength;
    if (files > MAX_FILES) rpcFail(413, `A version holds at most ${MAX_FILES} files`);
    if (total > MAX_VERSION_BYTES) rpcFail(413, "A version is limited to 100 MB");
    const sha256 = await bytesHex(bytes);
    this.sql.exec("DELETE FROM chunks WHERE version=? AND path=?", version, path);
    const count = Math.max(1, Math.ceil(bytes.byteLength / CHUNK));
    for (let i = 0; i < count; i++)
      this.sql.exec(
        "INSERT INTO chunks (version,path,idx,data) VALUES (?,?,?,?)",
        version,
        path,
        i,
        bytes.subarray(i * CHUNK, (i + 1) * CHUNK),
      );
    this.sql.exec(
      "INSERT OR REPLACE INTO files (version,path,content_type,size,sha256,chunks) VALUES (?,?,?,?,?,?)",
      version,
      path,
      contentTypeOf(path),
      bytes.byteLength,
      sha256,
      count,
    );
    this.sql.exec("UPDATE versions SET files=?,bytes=? WHERE version=?", files, total, version);
    return { path, size: bytes.byteLength, sha256 };
  }

  /** Seal an upload: every manifest entry must match what was stored; stray files are dropped. */
  finalize(version, manifest) {
    const row = this.version(version);
    if (!row || row.state !== "uploading") rpcFail(409, "This version is not accepting files");
    if (!Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES)
      rpcFail(400, "The manifest lists the uploaded files");
    const wanted = new Map();
    for (const entry of manifest) {
      const path = cleanPath(entry?.path);
      if (!path || !Number.isSafeInteger(entry.size) || typeof entry.sha256 !== "string")
        rpcFail(400, "Invalid manifest entry");
      wanted.set(path, entry);
    }
    if (!wanted.has("index.html")) rpcFail(400, "The build output needs an index.html at its root");
    const stored = new Map(
      this.sql
        .exec("SELECT path,size,sha256 FROM files WHERE version=?", version)
        .toArray()
        .map((file) => [file.path, file]),
    );
    for (const [path, entry] of wanted) {
      const file = stored.get(path);
      if (!file) rpcFail(409, `Missing upload: ${path}`);
      if (file.size !== entry.size || file.sha256 !== entry.sha256)
        rpcFail(409, `Upload changed in transit: ${path}`);
    }
    for (const path of stored.keys())
      if (!wanted.has(path)) {
        this.sql.exec("DELETE FROM chunks WHERE version=? AND path=?", version, path);
        this.sql.exec("DELETE FROM files WHERE version=? AND path=?", version, path);
      }
    const totals = this.sql
      .exec(
        "SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files WHERE version=?",
        version,
      )
      .one();
    this.sql.exec(
      "UPDATE versions SET state='ready',files=?,bytes=? WHERE version=?",
      totals.files,
      totals.bytes,
      version,
    );
    return { version, files: totals.files, bytes: totals.bytes };
  }

  versions() {
    return this.sql
      .exec(
        "SELECT version,note,created_at,files,bytes FROM versions WHERE state='ready' ORDER BY version DESC",
      )
      .toArray()
      .map((row) => ({
        version: row.version,
        note: row.note || "",
        createdAt: row.created_at,
        files: row.files,
        bytes: row.bytes,
      }));
  }

  isReady(version) {
    return this.version(version)?.state === "ready";
  }

  dropVersion(version) {
    this.sql.exec("DELETE FROM chunks WHERE version=?", version);
    this.sql.exec("DELETE FROM files WHERE version=?", version);
    this.sql.exec("DELETE FROM versions WHERE version=?", version);
  }
  deleteVersion(version) {
    if (!this.version(version)) rpcFail(404, "Version not found");
    this.dropVersion(version);
    return { deleted: version };
  }

  /**
   * File for a request path inside a ready version. Directory paths resolve to index.html, and
   * extension-less paths fall back to the root index.html so client-side routes load.
   */
  read(version, rawPath) {
    if (!this.isReady(version)) return null;
    const candidates = [];
    if (!rawPath) candidates.push("index.html");
    else {
      const trimmed = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
      const path = cleanPath(trimmed);
      if (!path) return null;
      if (!rawPath.endsWith("/")) candidates.push(path);
      candidates.push(path + "/index.html");
      if (!/\.[a-z0-9]+$/i.test(path)) candidates.push("index.html");
    }
    for (const path of candidates) {
      const file = this.sql
        .exec("SELECT * FROM files WHERE version=? AND path=?", version, path)
        .toArray()[0];
      if (!file) continue;
      const body = new Uint8Array(file.size);
      let offset = 0;
      for (const chunk of this.sql.exec(
        "SELECT data FROM chunks WHERE version=? AND path=? ORDER BY idx",
        version,
        path,
      )) {
        const data = new Uint8Array(chunk.data);
        body.set(data, offset);
        offset += data.byteLength;
      }
      return { path, contentType: file.content_type, sha256: file.sha256, body };
    }
    return null;
  }
}
