// The accounts database on Node: the subset of Cloudflare's D1 API that drizzle-orm/d1, Better
// Auth (through drizzle) and the tests use, over one node:sqlite file. Every statement is its own
// transaction like D1, and batch() is atomic. Migrations (cloud/migrations) are applied with
// applyMigrations, recorded in d1_migrations like `cf d1 migrations apply`.
import fs from "node:fs";
import { fromSqlite, openDatabase, plainRow, statementCache, toSqlite } from "./sqlite.js";

class Statement {
  constructor(database, query, params = []) {
    this.database = database;
    this.query = query;
    this.params = params;
  }
  bind(...values) {
    return new Statement(this.database, this.query, values.map(toSqlite));
  }
  execute() {
    const started = performance.now();
    const statement = this.database.prepare(this.query);
    const meta = (rows, changes, lastRowId) => ({
      duration: performance.now() - started,
      changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      rows_read: rows,
      rows_written: changes,
      size_after: 0,
    });
    if (statement.columns().length) {
      const results = statement.all(...this.params).map(plainRow);
      return { success: true, results, meta: meta(results.length, 0, 0) };
    }
    const { changes, lastInsertRowid } = statement.run(...this.params);
    return { success: true, results: [], meta: meta(0, Number(changes), Number(lastInsertRowid)) };
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
  async first(column) {
    const row = this.execute().results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!Object.hasOwn(row, column))
      throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column];
  }
  async raw({ columnNames = false } = {}) {
    const statement = this.database.prepareArrays(this.query);
    const rows = statement.columns().length
      ? statement.all(...this.params).map((row) => row.map(fromSqlite))
      : (statement.run(...this.params), []);
    return columnNames ? [statement.columns().map((column) => column.name), ...rows] : rows;
  }
}

export class SqliteD1Database {
  constructor(file) {
    this.db = openDatabase(file);
    this.prepare = statementCache(this.db);
    const arrays = statementCache(this.db);
    this.prepareArrays = (query) => {
      const statement = arrays(query);
      statement.setReturnArrays(true);
      return statement;
    };
    this.binding = {
      prepare: (query) => new Statement(this, query),
      batch: async (statements) => this.batch(statements),
      exec: async (query) => {
        this.db.exec(query);
        return { count: query.split(";").filter((part) => part.trim()).length, duration: 0 };
      },
    };
  }
  batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}

/** Open the accounts database: returns the D1-shaped binding (env.DB) and a close function. */
export function openD1(file) {
  const database = new SqliteD1Database(file);
  return { binding: database.binding, close: () => database.close(), db: database.db };
}

/** Apply the *.sql files of a directory (a file: URL ending in "/") once each, in name order. */
export function applyMigrations(db, directory) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare("SELECT name FROM d1_migrations")
      .all()
      .map((row) => row.name),
  );
  const names = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const added = [];
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(new URL(name, directory), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${name} failed: ${error.message}`);
    }
    added.push(name);
  }
  return added;
}
