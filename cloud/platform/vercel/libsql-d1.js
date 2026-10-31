// The accounts database on Vercel: the D1 query API (the subset drizzle-orm/d1, Better Auth and the
// tests use) over a libSQL client. In production that is Turso over HTTP (`libsql://` or
// `https://` URL); locally a `file:` URL works the same. Each statement runs on its own, like D1;
// batch() is one write transaction. Migrations (cloud/migrations) are applied with
// applyMigrations and recorded in d1_migrations like `cf d1 migrations apply`.
import fs from "node:fs";
import { createClient } from "@libsql/client";

/** Values Cloudflare's SQL APIs accept, converted for libSQL. */
function toLibsql(value) {
  if (value === undefined)
    throw new TypeError("Type 'undefined' cannot be bound to a SQL statement");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

/** libSQL rows -> plain objects (D1 shape; a repeated column name keeps the last value). */
function plainRows(result) {
  return result.rows.map((row) => {
    const out = {};
    result.columns.forEach((name, index) => (out[name] = row[index]));
    return out;
  });
}

function d1Result(result, started) {
  const changes = result.columns.length ? 0 : result.rowsAffected;
  return {
    success: true,
    results: result.columns.length ? plainRows(result) : [],
    meta: {
      duration: performance.now() - started,
      changes,
      last_row_id: result.lastInsertRowid === undefined ? 0 : Number(result.lastInsertRowid),
      changed_db: changes > 0,
      rows_read: result.rows.length,
      rows_written: changes,
      size_after: 0,
    },
  };
}

class Statement {
  constructor(client, query, params = []) {
    this.client = client;
    this.query = query;
    this.params = params;
  }
  bind(...values) {
    return new Statement(this.client, this.query, values.map(toLibsql));
  }
  get statement() {
    return { sql: this.query, args: this.params };
  }
  async all() {
    const started = performance.now();
    return d1Result(await this.client.execute(this.statement), started);
  }
  async run() {
    return this.all();
  }
  async first(column) {
    const row = (await this.all()).results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!Object.hasOwn(row, column))
      throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column];
  }
  async raw({ columnNames = false } = {}) {
    const result = await this.client.execute(this.statement);
    const rows = result.rows.map((row) => result.columns.map((_, index) => row[index]));
    return columnNames ? [[...result.columns], ...rows] : rows;
  }
}

/** A D1-shaped binding (env.DB) over a libSQL client. */
export function libsqlD1(client) {
  return {
    prepare: (query) => new Statement(client, query),
    batch: async (statements) => {
      const started = performance.now();
      const results = await client.batch(
        statements.map((statement) => statement.statement),
        "write",
      );
      return results.map((result) => d1Result(result, started));
    },
    exec: async (query) => {
      await client.executeMultiple(query);
      return { count: splitStatements(query).length, duration: 0 };
    },
  };
}

/**
 * Open a libSQL client: `url` is libsql://, https:// (Turso) or file: (local). Several local
 * processes may share a file database: they wait for each other's locks instead of failing.
 */
export function openLibsql({ url, authToken }) {
  if (!url) throw new Error("DATABASE_URL is required (a libsql://, https:// or file: URL)");
  return createClient({
    url,
    authToken: authToken || undefined,
    intMode: "number",
    timeout: url.startsWith("file:") ? 10_000 : undefined,
  });
}

/** WAL for a local file database, so readers and the writer of other processes overlap. */
export async function prepareLocal(client, url) {
  if (url.startsWith("file:")) await client.execute("PRAGMA journal_mode=WAL");
}

/** The statements of a migration file (comments removed; the files hold no triggers). */
export function splitStatements(sql) {
  return sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Apply the *.sql files of a directory (a file: URL ending in "/") once each, in name order. Each
 * file is one transaction that starts by recording its name, so instances starting together
 * apply it once: the loser's batch fails on the unique name and rolls back.
 */
export async function applyMigrations(client, directory) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  );
  const appliedNames = async () =>
    new Set((await client.execute("SELECT name FROM d1_migrations")).rows.map((row) => row.name));
  const applied = await appliedNames();
  const names = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const added = [];
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(new URL(name, directory), "utf8");
    try {
      await client.batch(
        [
          { sql: "INSERT INTO d1_migrations (name) VALUES (?)", args: [name] },
          ...splitStatements(sql),
        ],
        "write",
      );
      added.push(name);
    } catch (error) {
      if ((await appliedNames()).has(name)) continue;
      throw new Error(`Migration ${name} failed: ${error.message}`);
    }
  }
  return added;
}
