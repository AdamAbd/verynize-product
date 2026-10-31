// Organizations own rooms (phase 2): personal organizations, rooms created in an organization,
// organization roles granting room roles (owner/admin -> owner, member -> the default room role),
// live socket updates when members, roles or the default change, leaving, moving rooms between
// organizations, listings, and guards (forged headers, reserved slugs, deleting non-empty orgs).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, signIn } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-orgs-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const ORIGIN = "http://local";
const local = (url, init) => mf.dispatchFetch(url, init);
const send = (route, { method = "GET", body, session, headers = {} } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
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
const auth = (route, session, body) =>
  send("/api/auth" + route, { method: body ? "POST" : "GET", session, body });
const roleIn = async (roomId, session) => {
  const response = await send(`/api/rooms/${roomId}`, { session });
  return response.status === 200 ? (await response.json()).role : response.status;
};

/** A socket whose messages can be awaited by predicate. */
async function connect(roomId, session) {
  const upgrade = await mf.dispatchFetch(
    `${ORIGIN}/api/rooms/${roomId}/socket?session=${encodeURIComponent(session)}`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101, "socket upgrade");
  const socket = upgrade.webSocket;
  const seen = [];
  const waiters = [];
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
  const dodi = await passwordUser(ORIGIN, "dodi@example.test", "Dodi", local, "192.0.2.3");

  // Personal organizations: created on first use, stable afterwards.
  const anaMe = await data(await send("/api/me", { session: ana }), 200);
  assert.ok(anaMe.personalOrganizationId);
  assert.equal(
    (await data(await send("/api/me", { session: ana }), 200)).personalOrganizationId,
    anaMe.personalOrganizationId,
  );
  const personalRoom = await data(
    await send("/api/rooms", {
      method: "POST",
      session: ana,
      body: { document: { name: "Ana sketch", pages: [] } },
    }),
    201,
  );
  assert.equal(personalRoom.organizationId, anaMe.personalOrganizationId);
  assert.equal(personalRoom.role, "owner");
  // Legacy (passkey/magic-link) sessions and anonymous rooms stay outside organizations.
  const legacy = await signIn(ORIGIN, "lena@example.test", local);
  const legacyRoom = await data(
    await send("/api/rooms", {
      method: "POST",
      session: legacy.session,
      body: { document: { pages: [] } },
    }),
    201,
  );
  assert.equal(legacyRoom.organizationId, null);
  assert.equal(
    (
      await send("/api/rooms", {
        method: "POST",
        session: legacy.session,
        body: { document: {}, organizationId: anaMe.personalOrganizationId },
      })
    ).status,
    401,
  );

  // A team organization with Budi as a member.
  const studio = await data(
    await auth("/organization/create", ana, { name: "Studio", slug: "studio" }),
    200,
  );
  const invitation = await data(
    await auth("/organization/invite-member", ana, {
      email: "budi@example.test",
      role: "member",
      organizationId: studio.id,
    }),
    200,
  );
  await data(
    await auth("/organization/accept-invitation", budi, { invitationId: invitation.id }),
    200,
  );

  // Rooms created in the organization reach its members without a link or direct membership.
  const board = await data(
    await send("/api/rooms", {
      method: "POST",
      session: ana,
      body: { document: { name: "Studio board", pages: [] }, organizationId: studio.id },
    }),
    201,
  );
  assert.equal(board.organizationId, studio.id);
  assert.equal(await roleIn(board.id, budi), "editor");
  assert.equal(await roleIn(board.id, dodi), 401);
  assert.equal(await roleIn(personalRoom.id, budi), 401, "personal rooms stay private");
  assert.equal(
    (
      await send("/api/rooms", {
        method: "POST",
        session: dodi,
        body: { document: {}, organizationId: studio.id },
      })
    ).status,
    403,
    "only members create rooms in an organization",
  );
  assert.equal(
    (
      await send(`/api/rooms/${board.id}`, {
        session: dodi,
        headers: { "x-verynize-org-role": "owner" },
      })
    ).status,
    401,
    "a client-sent organization role is ignored",
  );
  const budiRooms = await data(await send("/api/me/rooms", { session: budi }), 200);
  assert.deepEqual(
    budiRooms.rooms.map((r) => [r.id, r.role, r.organizationName, r.title]),
    [[board.id, "editor", "Studio", "Studio board"]],
  );
  const listing = await data(await send(`/api/orgs/${studio.id}/rooms`, { session: budi }), 200);
  assert.equal(listing.role, "editor");
  assert.deepEqual(
    listing.rooms.map((r) => r.id),
    [board.id],
  );
  assert.equal((await send(`/api/orgs/${studio.id}/rooms`, { session: dodi })).status, 404);
  const access = await data(await send(`/api/rooms/${board.id}/access`, { session: budi }), 200);
  assert.deepEqual(access.organization, { id: studio.id, name: "Studio" });

  // A direct membership and the organization role combine: the higher one wins.
  await data(
    await send(`/api/rooms/${board.id}/members`, {
      method: "POST",
      session: ana,
      body: { email: "dodi@example.test", role: "viewer" },
    }),
    200,
  );
  assert.equal(await roleIn(board.id, dodi), "viewer");

  // Live sockets follow organization changes: default member role, member role, removal.
  const live = await connect(board.id, budi);
  assert.equal((await live.next((m) => m.type === "welcome")).role, "editor");
  await data(
    await auth("/organization/update", ana, {
      organizationId: studio.id,
      data: { metadata: { roomRole: "viewer" } },
    }),
    200,
  );
  assert.equal((await live.next((m) => m.type === "role")).role, "viewer");
  assert.equal(await roleIn(board.id, budi), "viewer");
  assert.equal(
    (
      await auth("/organization/update", ana, {
        organizationId: studio.id,
        data: { metadata: { roomRole: "owner" } },
      })
    ).status,
    400,
    "members cannot be given owner by default",
  );
  const budiMember = (
    await data(
      await send(`/api/auth/organization/get-full-organization?organizationId=${studio.id}`, {
        session: ana,
      }),
      200,
    )
  ).members.find((m) => m.user.email === "budi@example.test");
  await data(
    await auth("/organization/update-member-role", ana, {
      organizationId: studio.id,
      memberId: budiMember.id,
      role: "admin",
    }),
    200,
  );
  assert.equal((await live.next((m) => m.type === "role")).role, "owner");
  await data(
    await auth("/organization/remove-member", ana, {
      organizationId: studio.id,
      memberIdOrEmail: "budi@example.test",
    }),
    200,
  );
  await live.next((m) => m.type === "revoked");
  assert.equal(await roleIn(board.id, budi), 401);

  // Re-invited, Budi regains access live; leaving the organization revokes it again.
  const again = await data(
    await auth("/organization/invite-member", ana, {
      email: "budi@example.test",
      role: "member",
      organizationId: studio.id,
    }),
    200,
  );
  await data(await auth("/organization/accept-invitation", budi, { invitationId: again.id }), 200);
  assert.equal(await roleIn(board.id, budi), "viewer");
  const live2 = await connect(board.id, budi);
  assert.equal((await live2.next((m) => m.type === "welcome")).role, "viewer");
  await data(await auth("/organization/leave", budi, { organizationId: studio.id }), 200);
  await live2.next((m) => m.type === "revoked");
  assert.equal(await roleIn(board.id, budi), 401);

  // Moving a room: owners only, into organizations they belong to; members follow live.
  const third = await data(
    await auth("/organization/invite-member", ana, {
      email: "budi@example.test",
      role: "member",
      organizationId: studio.id,
    }),
    200,
  );
  await data(await auth("/organization/accept-invitation", budi, { invitationId: third.id }), 200);
  assert.equal(await roleIn(personalRoom.id, budi), 401);
  assert.equal(
    (
      await send(`/api/rooms/${personalRoom.id}/organization`, {
        method: "PUT",
        session: dodi,
        body: { organizationId: studio.id },
      })
    ).status,
    403,
    "non-members of the target cannot move rooms into it",
  );
  assert.equal(
    (
      await send(`/api/rooms/${board.id}/organization`, {
        method: "PUT",
        session: budi,
        body: { organizationId: anaMe.personalOrganizationId },
      })
    ).status,
    403,
  );
  const moved = await data(
    await send(`/api/rooms/${personalRoom.id}/organization`, {
      method: "PUT",
      session: ana,
      body: { organizationId: studio.id },
    }),
    200,
  );
  assert.deepEqual(moved.organization, { id: studio.id, name: "Studio" });
  assert.equal(await roleIn(personalRoom.id, budi), "viewer");
  // A legacy room enters an organization when its owner (also an email account) moves it.
  const lenaPassword = await passwordUser(ORIGIN, "lena@example.test", "Lena", local, "192.0.2.4");
  const lenaOrg = (await data(await send("/api/me", { session: lenaPassword }), 200))
    .personalOrganizationId;
  await data(
    await send(`/api/rooms/${legacyRoom.id}/organization`, {
      method: "PUT",
      session: lenaPassword,
      body: { organizationId: lenaOrg },
    }),
    200,
  );
  const lenaListing = await data(
    await send(`/api/orgs/${lenaOrg}/rooms`, { session: lenaPassword }),
    200,
  );
  assert.deepEqual(
    lenaListing.rooms.map((r) => r.id),
    [legacyRoom.id],
  );

  // Guards: reserved personal slugs; organizations with rooms cannot be deleted.
  assert.equal(
    (await auth("/organization/create", dodi, { name: "Fake", slug: "personal-someone" })).status,
    400,
  );
  assert.equal(
    (
      await auth("/organization/create", dodi, {
        name: "Fake",
        slug: "fake",
        metadata: { personal: true },
      })
    ).status,
    400,
  );
  assert.equal(
    (await auth("/organization/delete", ana, { organizationId: studio.id })).status,
    409,
  );
  const empty = await data(
    await auth("/organization/create", dodi, { name: "Empty", slug: "empty" }),
    200,
  );
  await data(await auth("/organization/delete", dodi, { organizationId: empty.id }), 200);
  // Updating a personal organization's metadata keeps it personal.
  await data(
    await auth("/organization/update", ana, {
      organizationId: anaMe.personalOrganizationId,
      data: { metadata: { roomRole: "commenter" } },
    }),
    200,
  );
  assert.equal(
    (await data(await send("/api/me", { session: ana }), 200)).personalOrganizationId,
    anaMe.personalOrganizationId,
  );

  console.log(
    "PASS organizations: personal workspaces, rooms in organizations, member/admin/owner room roles, default member role, live role/revocation on update/remove/leave, rejoin, direct+org role max, listings, moving rooms (incl. legacy), forged header, reserved slugs, non-empty delete refused",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
