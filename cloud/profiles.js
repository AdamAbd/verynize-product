// Account directory in D1 (migration 0003): profiles (public handle, display name, avatar),
// the room membership index, profile publications and the published-app registry. It replaced
// the AccountDirectory Durable Object as the source of truth; that object now keeps only
// credentials (legacy sessions, magic links, passkeys, handoffs) and a minimal mirror of each
// account for passkey ceremonies. Account ids are the directory's own ids, so room members,
// sockets and app versions keep their references. migrateDirectory() copies the old data once.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { database } from "./db.js";
import { app, migrationState, profile, publication, roomMembership } from "./schema.js";
import { APP_NAME, EMAIL, HANDLE, RESERVED } from "./rules.js";
import { fail, randomHex } from "./http.js";

const directory = (env) => env.ACCOUNTS.getByName("directory");

export function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) fail(400, "Enter a valid email address");
  return email;
}
const publicProfile = (row) =>
  row && {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl || "",
    createdAt: row.createdAt,
  };

const byId = (env, id) =>
  database(env)
    .select()
    .from(profile)
    .where(eq(profile.id, String(id)))
    .get();
const byEmail = (env, email) =>
  database(env).select().from(profile).where(eq(profile.email, email)).get();
const byHandle = (env, handle) =>
  database(env).select().from(profile).where(eq(profile.handle, handle)).get();

export const getProfile = async (env, id) => publicProfile(await byId(env, id));
export async function profileIdForEmail(env, email) {
  if (typeof email !== "string") return null;
  return (await byEmail(env, email.trim().toLowerCase()))?.id || null;
}
export async function profilesById(env, ids) {
  const list = (Array.isArray(ids) ? ids : []).slice(0, 64).map(String);
  if (!list.length) return [];
  const rows = await database(env).select().from(profile).where(inArray(profile.id, list)).all();
  return rows.map(publicProfile);
}

async function freeHandle(env, email) {
  let base = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  if (base.length < 3 || RESERVED.has(base)) base = "designer";
  let handle = base;
  while (await byHandle(env, handle)) handle = `${base}-${randomHex(2)}`;
  return handle;
}

/**
 * The profile for an email, created when missing (invitations, magic links). `verified` marks an
 * address its owner proved; `displayName` names a new profile.
 */
export async function ensureProfile(env, rawEmail, { verified = false, displayName = "" } = {}) {
  const email = normalizeEmail(rawEmail);
  let row = await byEmail(env, email);
  if (!row) {
    const name = String(displayName || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    await database(env)
      .insert(profile)
      .values({
        id: crypto.randomUUID(),
        email,
        handle: await freeHandle(env, email),
        displayName: name || email.split("@")[0].slice(0, 80),
        verified,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    row = await byEmail(env, email);
  } else if (verified && !row.verified) {
    await database(env).update(profile).set({ verified: true }).where(eq(profile.id, row.id)).run();
    row = { ...row, verified: true };
  }
  return publicProfile(row);
}

/**
 * The profile of a Better Auth user (verified email). A profile made earlier by a magic link,
 * passkey or invitation for the same email is linked. `linked` is true the first time, when the
 * caller attaches the account's legacy rooms to the user's personal organization.
 */
export async function linkUser(env, user) {
  const linkedRow = await database(env)
    .select()
    .from(profile)
    .where(eq(profile.userId, user.id))
    .get();
  if (linkedRow) return { profile: publicProfile(linkedRow), linked: false };
  const ensured = await ensureProfile(env, user.email, { verified: true, displayName: user.name });
  await database(env)
    .update(profile)
    .set({ userId: user.id, verified: true })
    .where(and(eq(profile.id, ensured.id), sql`"userId" IS NULL`))
    .run();
  return { profile: ensured, linked: true };
}

export async function updateProfile(env, accountId, patch) {
  const row = await byId(env, accountId);
  if (!row) fail(404, "Account not found");
  const changes = {};
  if (patch.handle !== undefined) {
    const handle = String(patch.handle).trim().toLowerCase();
    if (!HANDLE.test(handle) || RESERVED.has(handle))
      fail(400, "Handles use 3–30 lowercase letters, numbers or dashes");
    const owner = await byHandle(env, handle);
    if (owner && owner.id !== accountId) fail(409, "That handle is taken");
    changes.handle = handle;
  }
  if (patch.displayName !== undefined) {
    const name = String(patch.displayName).trim().replace(/\s+/g, " ");
    if (!name || name.length > 80) fail(400, "Display names use 1–80 characters");
    changes.displayName = name;
  }
  if (patch.avatarUrl !== undefined) {
    const url = String(patch.avatarUrl).trim();
    if (url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        fail(400, "Avatar must be an HTTPS image URL");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 500)
        fail(400, "Avatar must be an HTTPS image URL");
    }
    changes.avatarUrl = url || null;
  }
  if (Object.keys(changes).length)
    await database(env).update(profile).set(changes).where(eq(profile.id, accountId)).run();
  return getProfile(env, accountId);
}

/** Public creator profile (verified accounts only); app paths follow handle changes. */
export async function publicCreator(env, handle) {
  const row = typeof handle === "string" ? await byHandle(env, handle.toLowerCase()) : null;
  if (!row || !row.verified) return null;
  const items = await database(env)
    .select()
    .from(publication)
    .where(eq(publication.accountId, row.id))
    .orderBy(desc(publication.publishedAt))
    .limit(200)
    .all();
  const publications = [];
  for (const item of items)
    publications.push({
      kind: item.kind,
      title: item.title,
      path: item.kind === "app" ? (await appInfo(env, item.ref))?.path || item.path : item.path,
      publishedAt: item.publishedAt,
    });
  return {
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl || "",
    publications,
  };
}

export async function recordPublication(env, accountId, { kind, ref, title, path }) {
  const values = {
    kind,
    ref,
    accountId,
    title: String(title || "Untitled").slice(0, 120),
    path,
    publishedAt: Date.now(),
  };
  await database(env)
    .insert(publication)
    .values(values)
    .onConflictDoUpdate({ target: [publication.kind, publication.ref], set: values })
    .run();
}
export async function removePublication(env, kind, ref) {
  await database(env)
    .delete(publication)
    .where(and(eq(publication.kind, kind), eq(publication.ref, ref)))
    .run();
}

// ---- room membership index (the room's own members table is authoritative for access) ----

export async function linkRoom(env, accountId, roomId, role, title) {
  const values = {
    accountId,
    roomId,
    role,
    title: title ? String(title).slice(0, 120) : null,
    updatedAt: Date.now(),
  };
  await database(env)
    .insert(roomMembership)
    .values(values)
    .onConflictDoUpdate({ target: [roomMembership.accountId, roomMembership.roomId], set: values })
    .run();
}
export async function unlinkRoom(env, accountId, roomId) {
  await database(env)
    .delete(roomMembership)
    .where(and(eq(roomMembership.accountId, accountId), eq(roomMembership.roomId, roomId)))
    .run();
}
export async function rooms(env, accountId) {
  const rows = await database(env)
    .select()
    .from(roomMembership)
    .where(eq(roomMembership.accountId, accountId))
    .orderBy(desc(roomMembership.updatedAt))
    .limit(500)
    .all();
  return rows.map((row) => ({
    id: row.roomId,
    role: row.role,
    title: row.title || "Shared design",
    updatedAt: row.updatedAt,
  }));
}

// ---- published apps: names are unique per account and served at /apps/<handle>/<name>/ ----

export async function appInfo(env, appId) {
  const row = await database(env)
    .select({ app, handle: profile.handle })
    .from(app)
    .innerJoin(profile, eq(profile.id, app.accountId))
    .where(eq(app.id, String(appId)))
    .get();
  return row
    ? {
        id: row.app.id,
        accountId: row.app.accountId,
        name: row.app.name,
        title: row.app.title,
        handle: row.handle,
        activeVersion: row.app.activeVersion ?? null,
        path: `/apps/${row.handle}/${row.app.name}/`,
      }
    : null;
}
export async function ensureApp(env, accountId, rawName, rawTitle) {
  const name = String(rawName || "")
    .trim()
    .toLowerCase();
  if (!APP_NAME.test(name)) fail(400, "App names use lowercase letters, numbers and dashes");
  const title =
    String(rawTitle || name)
      .trim()
      .slice(0, 120) || name;
  const find = () =>
    database(env)
      .select()
      .from(app)
      .where(and(eq(app.accountId, accountId), eq(app.name, name)))
      .get();
  let row = await find();
  if (!row) {
    const count = await database(env).$count(app, eq(app.accountId, accountId));
    if (count >= 50) fail(429, "An account can publish at most 50 apps");
    await database(env)
      .insert(app)
      .values({ id: crypto.randomUUID(), accountId, name, title, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
    row = await find();
  } else if (rawTitle)
    await database(env).update(app).set({ title }).where(eq(app.id, row.id)).run();
  return appInfo(env, row.id);
}
export async function apps(env, accountId) {
  const rows = await database(env)
    .select({ id: app.id })
    .from(app)
    .where(eq(app.accountId, accountId))
    .orderBy(desc(app.createdAt))
    .all();
  return Promise.all(rows.map((row) => appInfo(env, row.id)));
}
export async function resolveApp(env, handle, name) {
  const row = await database(env)
    .select({ id: app.id })
    .from(app)
    .innerJoin(profile, eq(profile.id, app.accountId))
    .where(
      and(
        eq(profile.handle, String(handle).toLowerCase()),
        eq(app.name, String(name).toLowerCase()),
      ),
    )
    .get();
  return row ? appInfo(env, row.id) : null;
}
export async function setActiveVersion(env, appId, version) {
  const info = await appInfo(env, appId);
  if (!info) fail(404, "App not found");
  await database(env).update(app).set({ activeVersion: version }).where(eq(app.id, appId)).run();
  if (version === null) await removePublication(env, "app", appId);
  else
    await recordPublication(env, info.accountId, {
      kind: "app",
      ref: appId,
      title: info.title,
      path: info.path,
    });
  return appInfo(env, appId);
}

// ---- one-time copy from the AccountDirectory Durable Object ----

const MIGRATION = "directory";
const STALE = 5 * 60 * 1000;
let migrated = false;

/**
 * Copy accounts, the membership index, publications and apps from AccountDirectory into D1 once
 * (state in migration_state). Idempotent and safe to retry: rows are upserted, and an email that
 * already has a D1 profile keeps it, with the old account's rows mapped onto it. A copy in progress
 * elsewhere is not waited for; a copy stuck for five minutes is taken over.
 */
export async function migrateDirectory(env) {
  if (migrated || !env.DB) return;
  const db = database(env);
  const state = await db
    .select()
    .from(migrationState)
    .where(eq(migrationState.name, MIGRATION))
    .get();
  if (state?.state === "done") {
    migrated = true;
    return;
  }
  const now = Date.now();
  const claimed = await db
    .insert(migrationState)
    .values({ name: MIGRATION, state: "running", updatedAt: now })
    .onConflictDoUpdate({
      target: migrationState.name,
      set: { state: "running", updatedAt: now },
      setWhere: sql`${migrationState.state} <> 'done' AND (${migrationState.state} <> 'running' OR ${migrationState.updatedAt} < ${now - STALE})`,
    })
    .run();
  if (!claimed.meta?.changes) return;
  try {
    const stub = directory(env);
    const ids = new Map();
    const page = async (table, each) => {
      let after = 0;
      for (;;) {
        const { rows, last } = await stub.exportRows(table, after, 200);
        for (const row of rows) await each(row);
        if (!rows.length || last === after) break;
        after = last;
      }
    };
    await page("accounts", async (row) => {
      const existing = await byEmail(env, row.email);
      if (existing) {
        ids.set(row.id, existing.id);
        if (row.verified && !existing.verified)
          await db.update(profile).set({ verified: true }).where(eq(profile.id, existing.id)).run();
        return;
      }
      const handle = (await byHandle(env, row.handle))
        ? await freeHandle(env, row.email)
        : row.handle;
      await db
        .insert(profile)
        .values({
          id: row.id,
          email: row.email,
          handle,
          displayName: row.display_name,
          avatarUrl: row.avatar_url || null,
          verified: !!row.verified,
          createdAt: row.created_at,
        })
        .onConflictDoNothing()
        .run();
      ids.set(row.id, row.id);
    });
    const mapped = (id) => ids.get(id) || id;
    await page("memberships", (row) =>
      db
        .insert(roomMembership)
        .values({
          accountId: mapped(row.account_id),
          roomId: row.room_id,
          role: row.role,
          title: row.title,
          updatedAt: row.updated_at,
        })
        .onConflictDoNothing()
        .run(),
    );
    await page("publications", (row) =>
      db
        .insert(publication)
        .values({
          kind: row.kind,
          ref: row.ref,
          accountId: mapped(row.account_id),
          title: row.title,
          path: row.path,
          publishedAt: row.published_at,
        })
        .onConflictDoNothing()
        .run(),
    );
    await page("apps", (row) =>
      db
        .insert(app)
        .values({
          id: row.id,
          accountId: mapped(row.account_id),
          name: row.name,
          title: row.title,
          activeVersion: row.active_version ?? null,
          createdAt: row.created_at,
        })
        .onConflictDoNothing()
        .run(),
    );
    await db
      .update(migrationState)
      .set({ state: "done", updatedAt: Date.now() })
      .where(eq(migrationState.name, MIGRATION))
      .run();
    migrated = true;
  } catch (error) {
    await db
      .update(migrationState)
      .set({ state: "failed", updatedAt: Date.now() })
      .where(eq(migrationState.name, MIGRATION))
      .run();
    throw error;
  }
}
