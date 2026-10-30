// Accounts, public creator profiles, identity-based room roles, capability links with roles,
// token rotation/recovery and migration of rooms created by the previous Worker, on local workerd.
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions, signIn } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-accounts-"));
const state = path.join(dir, "state");
let mf;
const send = (route, { method = "GET", body, token, session, headers = {} } = {}) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(session ? { "x-verynize-session": session } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};
const local = { fetch: (url, init) => mf.dispatchFetch(url, init) };
const outbox = async (email) =>
  (await data(await send("/api/dev/outbox?to=" + encodeURIComponent(email)), 200)).messages;
function socketMessages(socket) {
  const seen = [];
  socket.addEventListener("message", (event) => seen.push(JSON.parse(event.data)));
  return {
    seen,
    next: (predicate) =>
      new Promise((resolve, reject) => {
        const found = seen.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(Error("Timed out waiting for socket message")), 4000);
        socket.addEventListener("message", function listener(event) {
          const value = JSON.parse(event.data);
          if (predicate(value)) {
            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve(value);
          }
        });
      }),
  };
}

try {
  // Backward compatibility: a room created by the previous Worker keeps its link after upgrading.
  // tests/fixtures/cloud-worker-v1.js is the snapshot-only Worker as shipped before accounts and roles.
  const legacySource = await fs.readFile(
    new URL("./fixtures/cloud-worker-v1.js", import.meta.url),
    "utf8",
  );
  const legacyOptions = await cloudOptions(state);
  const config = legacyOptions.workers[0].config;
  config.manifest = {
    mainModule: "worker.js",
    modules: { "worker.js": { type: "esm", contents: legacySource } },
  };
  config.env = { ROOM_CREATION: config.env.ROOM_CREATION, ROOMS: config.env.ROOMS };
  config.exports = { DesignRoom: { type: "durable-object", storage: "sqlite" } };
  mf = new Miniflare(legacyOptions);
  const legacy = await data(
    await send("/api/rooms", { method: "POST", body: { document: { nodes: [{ id: "old" }] } } }),
    201,
  );
  const legacyPublic = await data(
    await send(`/api/rooms/${legacy.id}/publish`, { method: "POST", token: legacy.token }),
    200,
  );
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(state));
  let room = await data(await send(`/api/rooms/${legacy.id}`, { token: legacy.token }), 200);
  assert.deepEqual(
    [room.revision, room.role, room.protocol],
    [0, "owner", 2],
    "legacy link becomes an owner capability",
  );
  assert.equal(
    (await send("/api/public/" + legacyPublic.publicId)).status,
    200,
    "legacy publication still served",
  );
  await data(
    await send(`/api/rooms/${legacy.id}`, {
      method: "PUT",
      token: legacy.token,
      body: { document: { nodes: [] }, baseRevision: 0 },
    }),
    200,
  );

  // Magic-link sign-in through the development outbox; links are single use.
  assert.equal(
    (await send("/api/auth/start", { method: "POST", body: { email: "not-an-email" } })).status,
    400,
  );
  const alice = await signIn("http://local", "Alice@Example.test", local.fetch);
  assert.equal(alice.account.email, "alice@example.test");
  assert.match(alice.session, /^vs_[0-9a-f]{64}$/);
  assert.match(alice.link, /^http:\/\/local\/#signin=[0-9a-f]{64}$/);
  const [mail] = await outbox("alice@example.test");
  assert.match(mail.text, /within 15 minutes/);
  const reused = new URLSearchParams(new URL(alice.link).hash.slice(1)).get("signin");
  assert.equal(
    (await send("/api/auth/verify", { method: "POST", body: { token: reused } })).status,
    401,
    "a link cannot be replayed",
  );
  assert.equal((await send("/api/me", { session: "vs_" + "f".repeat(64) })).status, 401);
  let me = await data(await send("/api/me", { session: alice.session }), 200);
  assert.equal(me.account.handle, "alice");
  assert.equal(me.sessions, 1);

  // Profiles: validation, uniqueness, escaping on the public page.
  assert.equal(
    (
      await send("/api/me", {
        method: "PATCH",
        session: alice.session,
        body: { avatarUrl: "http://insecure.test/a.png" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await send("/api/me", { method: "PATCH", session: alice.session, body: { handle: "API" } }))
      .status,
    400,
  );
  me = await data(
    await send("/api/me", {
      method: "PATCH",
      session: alice.session,
      body: {
        handle: "alice-studio",
        displayName: "Alice <b>Studio</b>",
        avatarUrl: "https://images.example.test/alice.png",
      },
    }),
    200,
  );
  assert.equal(me.profilePath, "/u/alice-studio");
  const bob = await signIn("http://local", "bob@example.test", local.fetch);
  assert.equal(
    (
      await send("/api/me", {
        method: "PATCH",
        session: bob.session,
        body: { handle: "alice-studio" },
      })
    ).status,
    409,
  );
  const profile = await data(await send("/api/profiles/alice-studio"), 200);
  assert.deepEqual(
    [profile.displayName, profile.avatarUrl, profile.publications],
    ["Alice <b>Studio</b>", "https://images.example.test/alice.png", []],
  );
  assert.equal(profile.email, undefined, "public profiles never expose email addresses");
  let page = await send("/u/alice-studio");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  const pageText = await page.text();
  assert.match(pageText, /Alice &lt;b&gt;Studio&lt;\/b&gt;/);
  assert.doesNotMatch(pageText, /<b>Studio/);
  assert.equal((await send("/u/nobody-here")).status, 404);

  // Rooms created while signed in belong to the account; members get roles by email.
  const created = await data(
    await send("/api/rooms", {
      method: "POST",
      session: alice.session,
      body: {
        document: {
          version: 2,
          name: "Team board",
          activePage: "p",
          pages: [{ id: "p", name: "Page", nodes: [] }],
        },
      },
    }),
    201,
  );
  assert.equal(created.role, "owner");
  const rooms = (await data(await send("/api/me/rooms", { session: alice.session }), 200)).rooms;
  assert.deepEqual(
    rooms.map((r) => [r.id, r.role, r.title]),
    [[created.id, "owner", "Team board"]],
  );
  const base = `/api/rooms/${created.id}`;
  assert.equal(
    (await send(base, { session: bob.session })).status,
    401,
    "non-members have no access",
  );
  assert.equal(
    (
      await send(base + "/members", {
        method: "POST",
        token: created.token,
        body: { email: "bob@example.test", role: "viewer" },
      })
    ).status,
    401,
    "email invites need a signed-in owner",
  );
  const invited = await data(
    await send(base + "/members", {
      method: "POST",
      session: alice.session,
      body: { email: "bob@example.test", role: "viewer" },
    }),
    200,
  );
  assert.equal(invited.emailed, true);
  assert.match((await outbox("bob@example.test"))[0].text, new RegExp(`#room=${created.id}`));
  room = await data(await send(base, { session: bob.session }), 200);
  assert.equal(room.role, "viewer");
  assert.deepEqual(
    (await data(await send("/api/me/rooms", { session: bob.session }), 200)).rooms.map(
      (r) => r.role,
    ),
    ["viewer"],
  );
  const op = (batch, ops) => ({ client: "bob-client", batch, ops });
  assert.equal(
    (
      await send(base, {
        method: "PUT",
        session: bob.session,
        body: { document: {}, baseRevision: 0 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send(base + "/ops", {
        method: "POST",
        session: bob.session,
        body: op(1, [{ t: "doc", key: "name", value: "Viewer edit" }]),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send(base + "/comments", {
        method: "POST",
        session: bob.session,
        body: { text: "Looks good" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await send(base + "/access", { session: bob.session }).then((r) => r.json())).links,
    undefined,
    "only owners see capability links",
  );
  await data(
    await send(base + "/members", {
      method: "POST",
      session: alice.session,
      body: { email: "bob@example.test", role: "commenter" },
    }),
    200,
  );
  const comment = await data(
    await send(base + "/comments", {
      method: "POST",
      session: bob.session,
      body: { text: "Looks good", nodeId: "n1" },
    }),
    201,
  );
  assert.equal(comment.comment.author, "bob");
  await data(
    await send(base + "/members", {
      method: "POST",
      session: alice.session,
      body: { email: "bob@example.test", role: "editor" },
    }),
    200,
  );
  const edit = await data(
    await send(base + "/ops", {
      method: "POST",
      session: bob.session,
      body: op(2, [{ t: "doc", key: "name", value: "Renamed by Bob" }]),
    }),
    200,
  );
  assert.equal(edit.revision, 1);
  assert.equal(
    (
      await send(base + "/members", {
        method: "POST",
        session: bob.session,
        body: { email: "carol@example.test", role: "owner" },
      })
    ).status,
    403,
    "editors cannot grant roles",
  );

  // Capability links carry roles too.
  const viewerLink = await data(
    await send(base + "/tokens", {
      method: "POST",
      token: created.token,
      body: { role: "viewer", label: "Client review" },
    }),
    201,
  );
  assert.equal((await data(await send(base, { token: viewerLink.token }), 200)).role, "viewer");
  assert.equal(
    (await send(base + "/publish", { method: "POST", token: viewerLink.token })).status,
    403,
  );
  const access = await data(await send(base + "/access", { token: created.token }), 200);
  assert.deepEqual(access.links.map((link) => link.role).sort(), ["owner", "viewer"]);
  assert.deepEqual(
    access.members.map((m) => [m.email, m.role]),
    [
      ["alice@example.test", "owner"],
      ["bob@example.test", "editor"],
    ],
  );

  // Publishing while signed in lists the design on the creator profile.
  const published = await data(
    await send(base + "/publish", { method: "POST", token: created.token, session: alice.session }),
    200,
  );
  assert.deepEqual(
    (await data(await send("/api/profiles/alice-studio"), 200)).publications.map((p) => [
      p.kind,
      p.title,
      p.path,
    ]),
    [["design", "Renamed by Bob", `/#public=${published.publicId}`]],
  );

  // Rotation revokes every capability link and disconnects their sockets; members keep access.
  const upgrade = await mf.dispatchFetch(`http://local${base}/socket?token=${viewerLink.token}`, {
    headers: { Upgrade: "websocket" },
  });
  const socket = upgrade.webSocket;
  const inbox = socketMessages(socket);
  socket.accept();
  assert.equal((await inbox.next((m) => m.type === "welcome")).role, "viewer");
  const rotated = await data(
    await send(base + "/tokens/rotate", { method: "POST", token: created.token }),
    200,
  );
  assert.equal(rotated.revoked, 2);
  await inbox.next((m) => m.type === "revoked");
  for (const old of [created.token, viewerLink.token])
    assert.equal((await send(base, { token: old })).status, 401);
  assert.equal((await data(await send(base, { token: rotated.token }), 200)).role, "owner");
  assert.equal((await data(await send(base, { session: bob.session }), 200)).role, "editor");

  // Recovery: the owner account mints a fresh owner link without any surviving token.
  const recovered = await data(
    await send(base + "/tokens/rotate", { method: "POST", session: alice.session }),
    200,
  );
  assert.equal((await send(base, { token: rotated.token })).status, 401);
  assert.equal((await data(await send(base, { token: recovered.token }), 200)).role, "owner");

  // Claiming: an anonymous room can be attached to an account by someone holding its owner link.
  assert.equal(
    (await send(`/api/rooms/${legacy.id}/claim`, { method: "POST", session: bob.session })).status,
    401,
  );
  await data(
    await send(`/api/rooms/${legacy.id}/claim`, {
      method: "POST",
      token: legacy.token,
      session: bob.session,
    }),
    200,
  );
  assert.equal(
    (await data(await send(`/api/rooms/${legacy.id}`, { session: bob.session }), 200)).role,
    "owner",
  );

  // Removing members disconnects and drops access; the last owner account cannot be removed without an owner link.
  await data(
    await send(`${base}/members/${bob.account.id}`, { method: "DELETE", session: alice.session }),
    200,
  );
  assert.equal((await send(base, { session: bob.session })).status, 401);
  await data(await send(base + "/tokens/rotate", { method: "POST", session: alice.session }), 200);
  const ownerLinks = (await data(await send(base + "/access", { session: alice.session }), 200))
    .links;
  for (const link of ownerLinks)
    await data(
      await send(`${base}/tokens/${link.id}`, { method: "DELETE", session: alice.session }),
      200,
    );
  assert.equal(
    (
      await send(`${base}/members/${alice.account.id}`, {
        method: "DELETE",
        session: alice.session,
      })
    ).status,
    409,
  );

  // Unpublishing removes the profile entry. Sign out ends one session; sign out everywhere ends all.
  await data(await send(base + "/publish", { method: "DELETE", session: alice.session }), 200);
  assert.deepEqual((await data(await send("/api/profiles/alice-studio"), 200)).publications, []);
  const second = await signIn("http://local", "alice@example.test", local.fetch);
  assert.equal((await data(await send("/api/me", { session: second.session }), 200)).sessions, 2);
  await data(await send("/api/auth/signout", { method: "POST", session: second.session }), 200);
  assert.equal((await send("/api/me", { session: second.session })).status, 401);
  const third = await signIn("http://local", "alice@example.test", local.fetch);
  assert.equal(
    (
      await data(
        await send("/api/auth/signout-all", { method: "POST", session: third.session }),
        200,
      )
    ).sessions,
    2,
  );
  for (const session of [alice.session, third.session])
    assert.equal((await send("/api/me", { session })).status, 401);

  // Sessions and memberships survive a restart; sign-in requests are rate limited.
  const fourth = await signIn("http://local", "alice@example.test", local.fetch);
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(state));
  assert.equal((await data(await send(base, { session: fourth.session }), 200)).role, "owner");
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++)
    limited =
      (await send("/api/auth/start", { method: "POST", body: { email: "flood@example.test" } }))
        .status === 429;
  assert.equal(limited, true);
  console.log(
    "PASS accounts: legacy room migration, magic-link sign-in (single use), sessions, profiles/escaping, member roles (viewer/commenter/editor/owner), role links, profile publications, rotation with socket revocation, account recovery, claiming, member removal, sign out (everywhere), restart persistence, sign-in rate limit",
  );
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
