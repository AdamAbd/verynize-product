// SQLite on Node through the built-in node:sqlite (no native module to build). Shared by the
// actor storage (sql-storage.js) and the D1-compatible accounts database (d1.js).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Open a database file with the durability settings every Node store uses. */
export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL with synchronous=FULL: a committed transaction survives a crash or power loss, which is
  // what "persist before acknowledging" relies on.
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
  );
  return db;
}

/** Values Cloudflare's SQL APIs accept, converted for node:sqlite. */
export function toSqlite(value) {
  if (value === undefined)
    throw new TypeError("Type 'undefined' cannot be bound to a SQL statement");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

/** BLOB columns come back as ArrayBuffer, like Cloudflare's SQL APIs. */
export function fromSqlite(value) {
  return value instanceof Uint8Array
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    : value;
}
export const plainRow = (row) => {
  const out = {};
  for (const key of Object.keys(row)) out[key] = fromSqlite(row[key]);
  return out;
};

/** Several statements in one string (schema setup); they run with exec and return no rows. */
export const isScript = (query) => query.trim().replace(/;+$/, "").includes(";");

/** A small prepared-statement cache per connection. */
export function statementCache(db, size = 256) {
  const cache = new Map();
  return (query) => {
    let statement = cache.get(query);
    if (statement) {
      cache.delete(query);
      cache.set(query, statement);
      return statement;
    }
    statement = db.prepare(query);
    cache.set(query, statement);
    if (cache.size > size) cache.delete(cache.keys().next().value);
    return statement;
  };
}
