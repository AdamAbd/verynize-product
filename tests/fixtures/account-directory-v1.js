// AccountDirectory as shipped before the directory moved to D1 (tests/cloud-directory-migration.mjs):
// the same SQLite tables, seeded with accounts, a legacy session, the room membership index,
// publications and apps. The current Worker then runs on the same persisted state.
import { DurableObject } from "cloudflare:workers";

export class AccountDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, handle TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar_url TEXT, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sign_in_links (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, label TEXT);
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, link TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (account_id TEXT NOT NULL, room_id TEXT NOT NULL, role TEXT NOT NULL, title TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, room_id));
      CREATE TABLE IF NOT EXISTS publications (kind TEXT NOT NULL, ref TEXT NOT NULL, account_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, published_at INTEGER NOT NULL, PRIMARY KEY (kind, ref));
      CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, alg INTEGER NOT NULL, jwk TEXT NOT NULL, sign_count INTEGER NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER);
      CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);
      CREATE TABLE IF NOT EXISTS passkey_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id TEXT, handoff_id TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS passkey_tickets (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS handoffs (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, account_id TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, active_version INTEGER, created_at INTEGER NOT NULL, UNIQUE (account_id, name));
    
    `);
  }
  async seed({ accounts, sessions, memberships, publications, apps }) {
    const digest = async (text) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    for (const a of accounts)
      this.sql.exec(
        "INSERT INTO accounts (id,email,handle,display_name,avatar_url,created_at,verified) VALUES (?,?,?,?,?,?,?)",
        a.id,
        a.email,
        a.handle,
        a.displayName,
        a.avatarUrl || null,
        a.createdAt,
        a.verified ? 1 : 0,
      );
    for (const s of sessions)
      this.sql.exec(
        "INSERT INTO sessions (hash,account_id,created_at,expires_at,label) VALUES (?,?,?,?,?)",
        await digest(s.session),
        s.accountId,
        Date.now(),
        Date.now() + 86400000,
        "fixture",
      );
    for (const m of memberships)
      this.sql.exec(
        "INSERT INTO memberships (account_id,room_id,role,title,updated_at) VALUES (?,?,?,?,?)",
        m.accountId,
        m.roomId,
        m.role,
        m.title,
        m.updatedAt,
      );
    for (const p of publications)
      this.sql.exec(
        "INSERT INTO publications (kind,ref,account_id,title,path,published_at) VALUES (?,?,?,?,?,?)",
        p.kind,
        p.ref,
        p.accountId,
        p.title,
        p.path,
        p.publishedAt,
      );
    for (const a of apps)
      this.sql.exec(
        "INSERT INTO apps (id,account_id,name,title,active_version,created_at) VALUES (?,?,?,?,?,?)",
        a.id,
        a.accountId,
        a.name,
        a.title,
        a.activeVersion,
        a.createdAt,
      );
    return { seeded: true };
  }
}

export default {
  async fetch(request, env) {
    const data = await request.json();
    return Response.json(await env.ACCOUNTS.getByName("directory").seed(data));
  },
};
