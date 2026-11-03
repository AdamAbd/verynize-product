// Share parity, server half (design/wonder/share-audit/CONTRACT.md §1, cloud/README.md "File
// visibility" and "Share invitations"): private/public rooms (anonymous viewers on every origin,
// writes refused, making a room private disconnects public-only sockets with reason "private"),
// workspace share invitations (several addresses, validation, dedupe, viewer/editor/admin, one
// email per invitation), in-app acceptance of a pending invitation (403 invitation-pending,
// GET|POST /invitation), per-member roles overriding the workspace default, direct-member
// fallback for rooms outside a workspace, no email on role changes (B2) and the last owner
// refused when removing themselves (B8).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, signIn } from "./cloud-harness.mjs";

const ORIGIN = "http://local";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-share-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const local = (url, init) => mf.dispatchFetch(url, init);

const CLIENTS = {
  web: { origin: ORIGIN, "sec-fetch-site": "same-origin" },
  desktop: { origin: "app://verynize", "sec-fetch-site": "cross-site" },
  script: {},
};
let ip = 0;
const send = (route, { client = "script", method = "GET", body, session, token } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": `198.51.100.${++ip % 250}`,
      ...CLIENTS[client],
      ...(session ? { "x-verynize-session": session } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};
const auth = (route, session, body) =>
  send("/api/auth" + route, { method: body ? "POST" : "GET", session, body });
const roleIn = async (roomId, options) => {
  const response = await send(`/api/rooms/${roomId}`, options);
  return response.status === 200 ? (await response.json()).role : response.status;
};
const outbox = async (email, pattern) =>
  (await data(await send(`/api/dev/outbox?to=${encodeURIComponent(email)}`), 200)).messages.filter(
    (message) => pattern.test(message.subject),
  );

/** A socket whose messages can be awaited by predicate; `closed` resolves with the close code. */
async function connect(roomId, { client = "script", session, token } = {}) {
  const query = new URLSearchParams();
  if (session) query.set("session", session);
  if (token) query.set("token", token);
  const upgrade = await mf.dispatchFetch(`${ORIGIN}/api/rooms/${roomId}/socket?${query}`, {
    headers: { Upgrade: "websocket", ...CLIENTS[client] },
  });
  assert.equal(upgrade.status, 101, "socket upgrade");
  const socket = upgrade.webSocket;
  const seen = [];
  const waiters = [];
  let closeCode = null;
  const closed = new Promise((resolve) =>
    socket.addEventListener("close", (event) => resolve((closeCode = event.code))),
  );
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    seen.push(message);
    for (const waiter of waiters.slice())
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
  });
  socket.accept();
  return {
    socket,
    closed,
    get closeCode() {
      return closeCode;
    },
    seen,
    next: (predicate) =>
      new Promise((resolve, reject) => {
        const found = seen.find(predicate);
        if (found) {
          seen.splice(seen.indexOf(found), 1);
          return resolve(found);
        }
        const timer = setTimeout(() => reject(Error("Timed out waiting for socket message")), 4000);
        waiters.push({
          predicate,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        });
      }),
  };
}

try {
  const ana = await passwordUser(ORIGIN, "ana@example.test", "Ana", local, "192.0.2.1");
  const budi = await passwordUser(ORIGIN, "budi@example.test", "Budi", local, "192.0.2.2");
  const cici = await passwordUser(ORIGIN, "cici@example.test", "Cici", local, "192.0.2.3");
  const dodi = await passwordUser(ORIGIN, "dodi@example.test", "Dodi", local, "192.0.2.4");
  const eka = await passwordUser(ORIGIN, "eka@example.test", "Eka", local, "192.0.2.5");

  const room = await data(
    await send("/api/rooms", {
      client: "web",
      method: "POST",
      session: ana,
      body: { document: { name: "Sunbird", pages: [] } },
    }),
    201,
  );
  const base = `/api/rooms/${room.id}`;
  const workspace = (await data(await send("/api/me", { session: ana }), 200))
    .personalOrganizationId;

  // ---- /access: visibility, organization and the caller's abilities ----
  const owner = await data(await send(base + "/access", { client: "web", session: ana }), 200);
  assert.equal(owner.visibility, "private");
  assert.deepEqual(owner.organization, { id: workspace, name: "Ana's workspace" });
  assert.deepEqual(owner.you, {
    role: "owner",
    canInvite: true,
    canChangeVisibility: true,
    canClaim: false,
  });

  // ---- visibility: private refuses strangers ----
  const editorLink = await data(
    await send(base + "/tokens", {
      method: "POST",
      session: ana,
      body: { role: "editor", label: "Editor invite" },
    }),
    201,
  );
  assert.equal(await roleIn(room.id, { client: "web" }), 401);
  assert.equal(await roleIn(room.id, { client: "desktop" }), 401);
  assert.equal(await roleIn(room.id, { client: "web", session: cici }), 401);
  for (const [options, status] of [
    [{ client: "web" }, 401],
    [{ client: "desktop" }, 401],
    [{ client: "desktop", token: editorLink.token }, 403],
  ])
    assert.equal(
      (
        await send(base + "/visibility", {
          ...options,
          method: "PUT",
          body: { visibility: "public" },
        })
      ).status,
      status,
      "only owners change visibility",
    );
  assert.equal(
    (
      await send(base + "/visibility", {
        method: "PUT",
        session: ana,
        body: { visibility: "everyone" },
      })
    ).status,
    400,
  );
  const ownerSocket = await connect(room.id, { session: ana });
  await ownerSocket.next((m) => m.type === "welcome");
  assert.deepEqual(
    await data(
      await send(base + "/visibility", {
        client: "web",
        method: "PUT",
        session: ana,
        body: { visibility: "public" },
      }),
      200,
    ).then(({ visibility }) => ({ visibility })),
    { visibility: "public" },
  );
  assert.equal(
    (await ownerSocket.next((m) => m.type === "visibility")).visibility,
    "public",
    "live sockets learn the new visibility",
  );

  // ---- public: anyone reads as a viewer, on every origin, without an account ----
  for (const client of ["web", "desktop", "script"])
    assert.equal(await roleIn(room.id, { client }), "viewer", client);
  assert.equal(await roleIn(room.id, { client: "web", session: cici }), "viewer");
  assert.equal(await roleIn(room.id, { client: "web", session: ana }), "owner");
  const visitor = await data(await send(base + "/access", { client: "web" }), 200);
  assert.equal(visitor.visibility, "public");
  assert.deepEqual(visitor.members, [], "visitors never see who the file is shared with");
  assert.equal(visitor.links, undefined);
  assert.deepEqual(visitor.you, {
    role: "viewer",
    canInvite: false,
    canChangeVisibility: false,
    canClaim: false,
  });
  assert.equal(
    (await data(await send(`${base}/pages?id=none`, { client: "web" }), 200)).missing[0],
    "none",
  );
  // Writes stay refused: a public viewer never edits.
  const revision = (await data(await send(base, { client: "desktop" }), 200)).revision;
  assert.equal(
    (
      await send(base, {
        client: "web",
        method: "PUT",
        body: { document: { pages: [] }, baseRevision: revision },
      })
    ).status,
    401,
    "the web app needs an account to write",
  );
  assert.equal(
    (
      await send(base, {
        client: "desktop",
        method: "PUT",
        body: { document: { pages: [] }, baseRevision: revision },
      })
    ).status,
    403,
  );
  const refusedOps = await data(
    await send(base + "/ops", {
      client: "desktop",
      method: "POST",
      body: { client: "visitor", batch: 1, ops: [{ op: "set", path: ["name"], value: "X" }] },
    }),
    403,
  );
  assert.equal(refusedOps.rejected, 1);
  assert.equal(
    (
      await send(base + "/comments", {
        client: "desktop",
        method: "POST",
        body: { text: "hi" },
      })
    ).status,
    403,
  );
  // Sockets: anonymous web visitors, signed-in strangers and link holders.
  const anonymous = await connect(room.id, { client: "web" });
  assert.equal((await anonymous.next((m) => m.type === "welcome")).role, "viewer");
  anonymous.socket.send(
    JSON.stringify({
      type: "ops",
      client: "visitor-socket",
      batch: 1,
      ops: [{ op: "set", path: ["name"], value: "X" }],
    }),
  );
  assert.equal((await anonymous.next((m) => m.type === "ops")).rejected, 1);
  const stranger = await connect(room.id, { client: "web", session: cici });
  assert.equal((await stranger.next((m) => m.type === "welcome")).role, "viewer");
  const linked = await connect(room.id, { client: "desktop", token: editorLink.token });
  assert.equal((await linked.next((m) => m.type === "welcome")).role, "editor");

  // ---- private again: public-only sockets are disconnected with reason "private" ----
  await data(
    await send(base + "/visibility", {
      method: "PUT",
      session: ana,
      body: { visibility: "private" },
    }),
    200,
  );
  for (const peer of [anonymous, stranger]) {
    const revoked = await peer.next((m) => m.type === "revoked");
    assert.equal(revoked.reason, "private");
    assert.equal(await peer.closed, 4401);
  }
  assert.equal((await linked.next((m) => m.type === "visibility")).visibility, "private");
  await ownerSocket.next((m) => m.type === "visibility" && m.visibility === "private");
  assert.ok(
    ![...linked.seen, ...ownerSocket.seen].some((m) => m.type === "revoked"),
    "members and link holders stay connected",
  );
  assert.equal(linked.closeCode, null);
  assert.equal(await roleIn(room.id, { client: "web" }), 401);
  assert.equal(await roleIn(room.id, { client: "desktop" }), 401);
  assert.equal(await roleIn(room.id, { client: "web", session: cici }), 401);
  assert.equal(
    (await data(await send(base + "/access", { session: ana }), 200)).visibility,
    "private",
  );
  for (const peer of [linked, ownerSocket]) peer.socket.close();

  // ---- share invitations into the room's workspace ----
  const invite = (emails, role, session = ana) =>
    send(base + "/share-invitations", {
      client: "web",
      method: "POST",
      session,
      body: { emails, role },
    });
  assert.equal((await invite(["budi@example.test"], "owner")).status, 400);
  assert.equal((await invite([], "viewer")).status, 400);
  assert.equal((await invite("budi@example.test", "viewer")).status, 400);
  assert.equal(
    (
      await invite(
        Array.from({ length: 21 }, (_, i) => `p${i}@example.test`),
        "viewer",
      )
    ).status,
    400,
    "at most 20 addresses per call",
  );
  assert.equal(
    (await invite(["budi@example.test"], "viewer", cici)).status,
    401,
    "strangers cannot invite",
  );
  const sent = await data(
    await invite(
      [
        "budi@example.test",
        " BUDI@example.test ",
        "not-an-email",
        "cici@example.test, dodi@example.test",
      ],
      "viewer",
    ),
    200,
  );
  assert.deepEqual(sent.invited, [
    { email: "budi@example.test", status: "invited" },
    { email: "cici@example.test", status: "invited" },
    { email: "dodi@example.test", status: "invited" },
  ]);
  assert.deepEqual(sent.errors, [
    { email: "not-an-email", message: "Enter a valid email address" },
  ]);
  const invitedMail = /invited you to/;
  assert.equal((await outbox("budi@example.test", invitedMail)).length, 1, "one email each");
  // Inviting again (other role) updates the pending invitation without another email.
  const again = await data(await invite(["budi@example.test"], "editor"), 200);
  assert.deepEqual(again.invited, [{ email: "budi@example.test", status: "invited" }]);
  assert.equal((await outbox("budi@example.test", invitedMail)).length, 1, "no second email");
  const pendingList = await data(
    await send(`/api/auth/organization/list-invitations?organizationId=${workspace}`, {
      session: ana,
    }),
    200,
  );
  assert.equal(pendingList.find((i) => i.email === "budi@example.test").role, "editor");

  // ---- in-app acceptance: invited non-members get a distinguishable 403 ----
  const pending = await data(await send(base, { client: "web", session: budi }), 403);
  assert.equal(pending.code, "invitation-pending");
  assert.deepEqual(
    { ...pending.invitation, id: undefined },
    {
      id: undefined,
      organizationId: workspace,
      organizationName: "Ana's workspace",
      inviterName: "Ana",
      role: "editor",
      roomRole: "editor",
    },
  );
  assert.equal(
    (await data(await send(base + "/access", { session: budi }), 403)).invitation.id,
    pending.invitation.id,
  );
  const budiSocket = await mf.dispatchFetch(
    `${ORIGIN}/api/rooms/${room.id}/socket?session=${encodeURIComponent(budi)}`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(budiSocket.status, 403, "the socket refuses with the invitation too");
  assert.equal(
    (await data(await send(base + "/invitation", { session: budi }), 200)).invitation.id,
    pending.invitation.id,
  );
  assert.equal(
    (await data(await send(base + "/invitation", { session: eka }), 200)).invitation,
    null,
  );
  assert.equal((await send(base + "/invitation")).status, 401);
  assert.equal(
    (
      await send(base + "/invitation", {
        method: "POST",
        session: budi,
        body: { action: "accept", invitationId: "someone-else" },
      })
    ).status,
    404,
  );
  const joined = await data(
    await send(base + "/invitation", {
      method: "POST",
      session: budi,
      body: { action: "accept", invitationId: pending.invitation.id },
    }),
    200,
  );
  assert.deepEqual(joined, {
    accepted: true,
    role: "editor",
    organization: { id: workspace, name: "Ana's workspace" },
  });
  assert.equal(await roleIn(room.id, { session: budi }), "editor");
  assert.equal(
    (await data(await send(base + "/invitation", { session: budi }), 200)).invitation,
    null,
  );
  // Declining: the invitation is gone and the room stays closed.
  await data(
    await send(base + "/invitation", {
      method: "POST",
      session: cici,
      body: { action: "decline" },
    }),
    200,
  );
  assert.equal(await roleIn(room.id, { session: cici }), 401);
  // Settings › Members accepts the same invitations through Better Auth, with the same role.
  const [dodiInvitation] = await data(await auth("/organization/list-user-invitations", dodi), 200);
  assert.equal(dodiInvitation.role, "viewer");
  await data(
    await auth("/organization/accept-invitation", dodi, { invitationId: dodiInvitation.id }),
    200,
  );
  assert.equal(await roleIn(room.id, { session: dodi }), "viewer");
  // Already members are reported, not invited or emailed again.
  const repeat = await data(
    await invite(["budi@example.test", "dodi@example.test"], "viewer"),
    200,
  );
  assert.deepEqual(
    repeat.invited.map((i) => i.status),
    ["already-member", "already-member"],
  );
  assert.equal((await outbox("budi@example.test", invitedMail)).length, 1);

  // Per-member roles override the workspace default (metadata.roomRole).
  await data(
    await auth("/organization/update", ana, {
      organizationId: workspace,
      data: { metadata: { roomRole: "viewer" } },
    }),
    200,
  );
  assert.equal(await roleIn(room.id, { session: budi }), "editor", "pinned editor");
  await data(
    await auth("/organization/update", ana, {
      organizationId: workspace,
      data: { metadata: { roomRole: "editor" } },
    }),
    200,
  );
  assert.equal(await roleIn(room.id, { session: dodi }), "viewer", "pinned viewer");
  // Changing a member's role updates live sockets and sends no email.
  const budiLive = await connect(room.id, { session: budi });
  assert.equal((await budiLive.next((m) => m.type === "welcome")).role, "editor");
  const full = await data(
    await send(`/api/auth/organization/get-full-organization?organizationId=${workspace}`, {
      session: ana,
    }),
    200,
  );
  await data(
    await auth("/organization/update-member-role", ana, {
      organizationId: workspace,
      memberId: full.members.find((m) => m.user.email === "budi@example.test").id,
      role: "viewer",
    }),
    200,
  );
  assert.equal((await budiLive.next((m) => m.type === "role")).role, "viewer");
  assert.equal((await outbox("budi@example.test", /invite/i)).length, 1);
  // Viewers and editors cannot invite: they are not room owners.
  assert.equal((await invite(["zed@example.test"], "viewer", budi)).status, 403);
  // Admin invitations make organization admins, who are room owners and may invite.
  await data(await invite(["eka@example.test"], "admin"), 200);
  await data(
    await send(base + "/invitation", { method: "POST", session: eka, body: { action: "accept" } }),
    200,
  ).then((answer) => assert.equal(answer.role, "owner"));
  const ekaAccess = await data(await send(base + "/access", { session: eka }), 200);
  assert.equal(ekaAccess.you.canInvite, true);
  assert.equal(ekaAccess.you.canChangeVisibility, true);
  // Removing a member from the workspace revokes their live socket.
  await data(
    await auth("/organization/remove-member", ana, {
      organizationId: workspace,
      memberIdOrEmail: "budi@example.test",
    }),
    200,
  );
  assert.equal((await budiLive.next((m) => m.type === "revoked")).reason, "removed");
  assert.equal(await budiLive.closed, 4401);

  // ---- rooms outside a workspace: direct members (admin = owner), no re-email (B2) ----
  const lena = await signIn(ORIGIN, "lena@example.test", local);
  const loose = await data(
    await send("/api/rooms", {
      method: "POST",
      session: lena.session,
      body: { document: { pages: [] } },
    }),
    201,
  );
  assert.equal(loose.organizationId, null);
  const looseBase = `/api/rooms/${loose.id}`;
  const direct = await data(
    await send(looseBase + "/share-invitations", {
      method: "POST",
      session: lena.session,
      body: { emails: ["mira@example.test", "nino@example.test"], role: "admin" },
    }),
    200,
  );
  assert.deepEqual(
    direct.invited.map((i) => i.status),
    ["invited", "invited"],
  );
  const looseAccess = await data(await send(looseBase + "/access", { session: lena.session }), 200);
  assert.equal(looseAccess.organization, null);
  assert.deepEqual(
    looseAccess.members.map((m) => [m.email, m.role]),
    [
      ["lena@example.test", "owner"],
      ["mira@example.test", "owner"],
      ["nino@example.test", "owner"],
    ],
  );
  const miraMail = /You were invited/;
  assert.equal((await outbox("mira@example.test", miraMail)).length, 1);
  const changed = await data(
    await send(looseBase + "/members", {
      method: "POST",
      session: lena.session,
      body: { email: "mira@example.test", role: "viewer" },
    }),
    200,
  );
  assert.equal(changed.previousRole, "owner");
  assert.equal(changed.emailed, false, "a role change is not an invitation (B2)");
  assert.equal((await outbox("mira@example.test", miraMail)).length, 1);
  const directAgain = await data(
    await send(looseBase + "/share-invitations", {
      method: "POST",
      session: lena.session,
      body: { emails: ["mira@example.test"], role: "editor" },
    }),
    200,
  );
  assert.deepEqual(directAgain.invited, [{ email: "mira@example.test", status: "already-member" }]);

  // ---- the last owner cannot remove themselves, even with an owner link (B8) ----
  await data(
    await send(`${looseBase}/members/${looseAccess.members[2].accountId}`, {
      method: "DELETE",
      session: lena.session,
    }),
    200,
  );
  const lenaOwnerOnly = await data(
    await send(`${looseBase}/members/${looseAccess.members[1].accountId}`, {
      method: "DELETE",
      session: lena.session,
    }),
    200,
  );
  assert.ok(lenaOwnerOnly.removed);
  const refused = await data(
    await send(`${looseBase}/members/${lena.account.id}`, {
      method: "DELETE",
      session: lena.session,
    }),
    409,
  );
  assert.match(refused.error, /last owner/);
  assert.equal(await roleIn(loose.id, { session: lena.session }), "owner");
  // The owner token still works for the claim flag: an owner link without owner membership.
  const claimable = await data(
    await send(looseBase + "/access", { session: cici, token: loose.token }),
    200,
  );
  assert.equal(claimable.you.canClaim, true);

  console.log(
    "PASS share: private/public visibility (anonymous viewers on web/desktop/scripts, writes refused, owner-only change, private kicks public-only sockets with reason private + 4401), /access organization + you, workspace share invitations (multi, invalid, dedupe, max 20, role mapping, admin, one email, role update without email), in-app invitation 403 + accept/decline, Better Auth accept grants the role, per-member roles over the default, live role change/removal, direct-member fallback, no re-email on role change (B2), last owner self-removal refused (B8), canClaim",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
