// Private, revision-checked account data shared by desktop and web. Design documents themselves
// remain in rooms; these records hold preferences, individual chats and library organization.
import { fail } from "./http.js";

export const ACCOUNT_VALUE_BYTES = 20 * 1024 * 1024;
// The API wraps a JSON string in JSON: quotes and backslashes can double its encoded size.
export const ACCOUNT_REQUEST_BYTES = 2 * ACCOUNT_VALUE_BYTES + 1024;
const CHUNK_CHARS = 128 * 1024;
const marker = /^@chunk:([0-9a-f-]{36}):(\d+)$/;

export async function readAccountState(env, accountId) {
  // One statement provides a consistent snapshot of heads and chunks during concurrent writes.
  const { results } = await env.DB.prepare(
    "SELECT key, value, revision FROM account_state WHERE accountId = ?",
  )
    .bind(accountId)
    .all();
  const rows = new Map(results.map((row) => [row.key, row]));
  const items = results.filter((row) => !row.key.startsWith("@chunk:"));
  for (const item of items) {
    const match = typeof item.value === "string" && item.value.match(marker);
    if (!match) continue;
    const parts = [];
    for (let index = 0; index < Number(match[2]); index++) {
      const part = rows.get(`@chunk:${match[1]}:${index}`);
      if (!part || typeof part.value !== "string") fail(500, "Account record is incomplete");
      parts.push(part.value);
    }
    item.value = parts.join("");
  }
  return { items };
}

export async function writeAccountState(env, accountId, key, data) {
  if (!/^(preference|agent-default|chat|draft|folder|file):.{1,240}$/.test(key))
    fail(400, "Invalid account state key");
  if (!Number.isSafeInteger(data.revision) || data.revision < 0)
    fail(400, "A nonnegative revision is required");
  if (data.value !== null && typeof data.value !== "string")
    fail(400, "value must be a JSON string or null");
  if (data.value !== null) {
    if (new TextEncoder().encode(data.value).byteLength > ACCOUNT_VALUE_BYTES)
      fail(413, "Account record exceeds 20 MB");
    try {
      JSON.parse(data.value);
    } catch {
      fail(400, "value must contain valid JSON");
    }
  }
  const db = env.DB;
  const previous = await db
    .prepare("SELECT value FROM account_state WHERE accountId = ? AND key = ?")
    .bind(accountId, key)
    .first();
  const parts = [];
  if (data.value?.length > CHUNK_CHARS) {
    for (let start = 0; start < data.value.length;) {
      let end = Math.min(start + CHUNK_CHARS, data.value.length);
      // Never send a half surrogate pair through SQLite's UTF-8 encoding.
      const last = data.value.charCodeAt(end - 1);
      if (end < data.value.length && last >= 0xd800 && last <= 0xdbff) end--;
      parts.push(data.value.slice(start, end));
      start = end;
    }
  }
  const id = crypto.randomUUID();
  // This cannot collide with user values: those must contain valid JSON. Internal keys are
  // outside the public key allowlist. No schema migration or client protocol change is needed.
  const value = parts.length ? `@chunk:${id}:${parts.length}` : data.value;
  const now = Date.now();
  const write =
    data.revision === 0
      ? db
          .prepare(`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
        VALUES (?, ?, ?, 1, ?) ON CONFLICT (accountId, key) DO NOTHING
        RETURNING key, revision`)
          .bind(accountId, key, value, now)
      : db
          .prepare(`UPDATE account_state SET value = ?, revision = revision + 1, updatedAt = ?
        WHERE accountId = ? AND key = ? AND revision = ?
        RETURNING key, revision`)
          .bind(value, now, accountId, key, data.revision);
  const statements = [write];
  for (const [index, part] of parts.entries()) {
    statements.push(
      db
        .prepare(`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
      SELECT ?, ?, ?, 1, ? WHERE EXISTS (
        SELECT 1 FROM account_state WHERE accountId = ? AND key = ? AND value = ? AND revision = ?
      )`)
        .bind(
          accountId,
          `@chunk:${id}:${index}`,
          part,
          now,
          accountId,
          key,
          value,
          data.revision + 1,
        ),
    );
  }
  const old = previous?.value?.match(marker);
  if (old) {
    statements.push(
      db
        .prepare(`DELETE FROM account_state WHERE accountId = ? AND key LIKE ?
      AND EXISTS (SELECT 1 FROM account_state WHERE accountId = ? AND key = ? AND value IS ? AND revision = ?)
    `)
        .bind(accountId, `@chunk:${old[1]}:%`, accountId, key, value, data.revision + 1),
    );
  }
  // D1 batch is a transaction: failed writes never publish a partial transcript. A stale
  // compare-and-swap cannot insert chunks or remove the current record's chunks.
  const [result] = await db.batch(statements);
  const item = result.results[0];
  if (!item) fail(409, "This item changed on another device. Refresh before saving.");
  return { item: { ...item, value: data.value } };
}
