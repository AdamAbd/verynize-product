// Moving the account directory from the AccountDirectory Durable Object to D1 (cloud/profiles.js):
// a directory seeded by the previous code (tests/fixtures/account-directory-v1.js) is copied on
// the first request after the upgrade. Account ids, legacy sessions, profiles, the room index,
// publications and apps survive; an email that already had a D1 profile keeps it and receives the
// old rows; a taken handle is replaced; the copy runs once; and the first email + password sign-in
// of an old account moves its owned rooms into the personal workspace.
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-directory-migration-"));
const state = path.join(dir, "state");
let mf;
const ORIGIN = "http://local";
const send = (route, { method = "GET", body, session } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-verynize-session": session } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const carol = "33333333-3333-4333-8333-333333333333";
const roomA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roomB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const appId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const aliceSession = "vs_" + "a1".repeat(32);

try {
  // 1. The previous directory, with its data.
  const legacy = await cloudOptions(state);
  const config = legacy.workers[0].config;
  config.manifest = {
    mainModule: "worker.js",
    modules: {
      "worker.js": {
        type: "esm",
        contents: await fs.readFile(
          new URL("./fixtures/account-directory-v1.js", import.meta.url),
          "utf8",
        ),
      },
    },
  };
  config.env = { ACCOUNTS: config.env.ACCOUNTS };
  config.exports = { AccountDirectory: { type: "durable-object", storage: "sqlite" } };
  mf = new Miniflare(legacy);
  const t = Date.now() - 60_000;
  await data(
    await mf.dispatchFetch(ORIGIN, {
      method: "POST",
      body: JSON.stringify({
        accounts: [
          {
            id: alice,
            email: "alice@example.test",
            handle: "alice-ui",
            displayName: "Alice Interface",
            avatarUrl: "https://example.test/a.png",
            createdAt: t,
            verified: true,
          },
          { id: bob, email: "bob@example.test", handle: "taken", displayName: "bob", createdAt: t },
          {
            id: carol,
            email: "carol@example.test",
            handle: "carol",
            displayName: "Carol",
            createdAt: t,
            verified: true,
          },
        ],
        sessions: [{ session: aliceSession, accountId: alice }],
        memberships: [
          { accountId: alice, roomId: roomA, role: "owner", title: "Alpha", updatedAt: t },
          { accountId: bob, roomId: roomA, role: "viewer", title: "Alpha", updatedAt: t },
          { accountId: carol, roomId: roomB, role: "editor", title: "Beta", updatedAt: t },
        ],
        publications: [
          {
            kind: "design",
            ref: roomA,
            accountId: alice,
            title: "Alpha",
            path: `/#public=${roomA}.n`,
            publishedAt: t,
          },
          {
            kind: "app",
            ref: appId,
            accountId: alice,
            title: "Site",
            path: "/apps/alice-ui/site/",
            publishedAt: t,
          },
        ],
        apps: [
          {
            id: appId,
            accountId: alice,
            name: "site",
            title: "Site",
            activeVersion: 2,
            createdAt: t,
          },
        ],
      }),
    }),
    200,
  );
  await mf.dispose();

  // 2. D1 already holds a profile for Carol (another id) and uses Bob's handle.
  mf = new Miniflare(await cloudOptions(state));
  const db = await mf.getD1Database("DB");
  const existingCarol = "44444444-4444-4444-8444-444444444444";
  await db.batch([
    db
      .prepare(
        'INSERT INTO "profile" ("id","email","handle","displayName","verified","createdAt") VALUES (?,?,?,?,1,?)',
      )
      .bind(existingCarol, "carol@example.test", "carol-new", "Carol New", Date.now()),
    db
      .prepare(
        'INSERT INTO "profile" ("id","email","handle","displayName","verified","createdAt") VALUES (?,?,?,?,1,?)',
      )
      .bind(crypto.randomUUID(), "someone@example.test", "taken", "Someone", Date.now()),
  ]);

  // 3. The first request copies the directory; the legacy session keeps working.
  const me = await data(await send("/api/me", { session: aliceSession }), 200);
  assert.equal(me.account.id, alice);
  assert.equal(me.account.handle, "alice-ui");
  assert.equal(me.account.displayName, "Alice Interface");
  assert.equal(me.account.avatarUrl, "https://example.test/a.png");
  assert.equal(
    (
      await db
        .prepare('SELECT "state" FROM "migration_state" WHERE "name"=?')
        .bind("directory")
        .first()
    ).state,
    "done",
  );
  assert.deepEqual(
    (await data(await send("/api/me/rooms", { session: aliceSession }), 200)).rooms.map((r) => [
      r.id,
      r.role,
      r.title,
    ]),
    [[roomA, "owner", "Alpha"]],
  );
  const creator = await data(await send("/api/profiles/alice-ui"), 200);
  assert.deepEqual(creator.publications.map((p) => [p.kind, p.path]).sort(), [
    ["app", "/apps/alice-ui/site/"],
    ["design", `/#public=${roomA}.n`],
  ]);
  const apps = (await data(await send("/api/apps", { session: aliceSession }), 200)).apps;
  assert.deepEqual(
    apps.map((a) => [a.id, a.name, a.activeVersion, a.path]),
    [[appId, "site", 2, "/apps/alice-ui/site/"]],
  );
  // Carol's rows moved onto her existing D1 profile; Bob got a free handle and stays unverified.
  const rows = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results;
  assert.deepEqual(
    (await rows('SELECT "accountId" FROM "room_membership" WHERE "roomId"=?', roomB)).map(
      (r) => r.accountId,
    ),
    [existingCarol],
  );
  assert.equal((await rows('SELECT 1 FROM "profile" WHERE "id"=?', carol)).length, 0);
  const bobRow = (await rows('SELECT "handle","verified" FROM "profile" WHERE "id"=?', bob))[0];
  assert.notEqual(bobRow.handle, "taken");
  assert.equal(bobRow.verified, 0);
  assert.equal((await send(`/api/profiles/${bobRow.handle}`)).status, 404);

  // 4. The copy runs once, also across restarts and when re-triggered after a reset.
  const count = async () => (await rows('SELECT COUNT(*) AS n FROM "room_membership"'))[0].n;
  assert.equal(await count(), 3);
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(state));
  await data(await send("/api/me", { session: aliceSession }), 200);
  const db2 = await mf.getD1Database("DB");
  await db2
    .prepare('UPDATE "migration_state" SET "state"=? WHERE "name"=?')
    .bind("failed", "directory")
    .run();
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(state));
  await data(await send("/api/me", { session: aliceSession }), 200);
  const db3 = await mf.getD1Database("DB");
  assert.equal(
    (await db3.prepare('SELECT COUNT(*) AS n FROM "room_membership"').first()).n,
    3,
    "re-running the copy adds nothing",
  );

  // 5. Alice signs up with email + password: same account, and her room joins her workspace.
  const token = await passwordUser(ORIGIN, "alice@example.test", "Alice", (url, init) =>
    mf.dispatchFetch(url, init),
  );
  const linked = await data(await send("/api/me", { session: token }), 200);
  assert.equal(linked.account.id, alice);
  const workspace = await data(
    await send(`/api/orgs/${linked.personalOrganizationId}/rooms`, { session: token }),
    200,
  );
  assert.deepEqual(
    workspace.rooms.map((r) => [r.id, r.title]),
    [[roomA, "Alpha"]],
  );
  // Profile edits land in D1 and show on the public profile.
  await data(
    await send("/api/me", { method: "PATCH", session: token, body: { displayName: "Alice D1" } }),
    200,
  );
  assert.equal((await data(await send("/api/profiles/alice-ui"), 200)).displayName, "Alice D1");

  console.log(
    "PASS directory migration: account ids, legacy sessions, profiles, room index, publications and apps copied to D1; email collision mapped, taken handle replaced, unverified kept private; runs once (restart, retry); first password sign-in adopts owned rooms",
  );
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
