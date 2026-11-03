// Private, revision-checked account data shared by desktop and web. Design documents themselves
// remain in rooms; these records hold preferences, individual chats and library organization.
import { sql } from "drizzle-orm";
import { database } from "./db.js";
import { fail } from "./http.js";

export async function readAccountState(env, accountId) {
  const items = await database(env).all(
    sql`SELECT key, value, revision FROM account_state WHERE accountId = ${accountId}`,
  );
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
    try {
      JSON.parse(data.value);
    } catch {
      fail(400, "value must contain valid JSON");
    }
  }
  const db = database(env);
  // Atomic compare-and-swap: two devices cannot silently replace each other's writes.
  const item =
    data.revision === 0
      ? await db.get(sql`INSERT INTO account_state (accountId, key, value, revision, updatedAt)
        VALUES (${accountId}, ${key}, ${data.value}, 1, ${Date.now()})
        ON CONFLICT (accountId, key) DO NOTHING RETURNING key, value, revision`)
      : await db.get(sql`UPDATE account_state SET value = ${data.value}, revision = revision + 1, updatedAt = ${Date.now()}
        WHERE accountId = ${accountId} AND key = ${key} AND revision = ${data.revision}
        RETURNING key, value, revision`);
  if (!item) fail(409, "This item changed on another device. Refresh before saving.");
  return { item };
}
