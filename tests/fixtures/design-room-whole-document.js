// DesignRoom storage as shipped before per-page records (tests/cloud-room-pages.mjs migration
// fixture): the same SQLite tables, with the whole document in one `room.document` row. POST
// {room, document, tokenHash, revision, publicNonce, stamps} seeds a room; the current Worker then
// runs on the same persisted state.
import { DurableObject } from "cloudflare:workers";

export class DesignRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL, public_nonce TEXT, public_document TEXT, public_revision INTEGER);
      CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members (account_id TEXT PRIMARY KEY, email TEXT NOT NULL, handle TEXT, role TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stamps (path TEXT PRIMARY KEY, stamp TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, last_batch INTEGER NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, author TEXT NOT NULL, account_id TEXT, page_id TEXT, node_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  seed({ document, tokenHash, revision = 0, publicNonce = null, stamps = {} }) {
    const text = JSON.stringify(document);
    this.sql.exec(
      "INSERT INTO room (id,token_hash,document,revision,public_nonce,public_document,public_revision) VALUES (1,'migrated',?,?,?,?,?)",
      text,
      revision,
      publicNonce,
      publicNonce ? text : null,
      publicNonce ? revision : null,
    );
    this.sql.exec(
      "INSERT INTO capabilities (id,hash,role,label,created_at) VALUES (?,?,?,?,?)",
      crypto.randomUUID(),
      tokenHash,
      "owner",
      "Original invite link",
      Date.now(),
    );
    for (const [path, stamp] of Object.entries(stamps))
      this.sql.exec("INSERT INTO stamps (path,stamp) VALUES (?,?)", path, stamp);
    return { seeded: true };
  }
}

export default {
  async fetch(request, env) {
    const data = await request.json();
    return Response.json(await env.ROOMS.getByName(data.room).seed(data));
  },
};
