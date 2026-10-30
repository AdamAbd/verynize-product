// Better Auth sessions acting through directory accounts (phase 1): email + password users reach
// rooms, profiles and invitations made for their email, legacy magic-link accounts link by verified
// email, sockets accept the bearer token, sign-out ends both kinds of session, and the emailed
// links land on the server's verification and password-reset pages. Local workerd, built bundle.
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions, signIn } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-auth-bridge-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const ORIGIN = "http://local";
let nextIp = 1;
const send = (route, { method = "GET", body, session, token, ip = "203.0.113.9" } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(session ? { "x-verynize-session": session } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};
const outbox = async (email) =>
  (await data(await send("/api/dev/outbox?to=" + encodeURIComponent(email)), 200)).messages;
const local = { fetch: (url, init) => mf.dispatchFetch(url, init) };

/** Sign up with a password, follow the emailed link, then sign in; returns the bearer token. */
async function passwordUser(email, name, password = "a long enough password") {
  const ip = `198.51.100.${nextIp++}`;
  await data(
    await send("/api/auth/sign-up/email", {
      method: "POST",
      ip,
      body: { email, password, name, callbackURL: "/account/verified" },
    }),
    200,
  );
  const link = new URL((await outbox(email)).find((m) => /Verify/.test(m.subject)).link);
  const verified = await send(link.pathname + link.search);
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.get("location"), "/account/verified");
  const signedIn = await send("/api/auth/sign-in/email", {
    method: "POST",
    ip,
    body: { email, password },
  });
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  return signedIn.headers.get("set-auth-token");
}

try {
  // Pages for emailed links: no script on the verified page, a CSP-limited script on reset.
  const verifiedPage = await send("/account/verified");
  assert.equal(verifiedPage.status, 200);
  assert.match(await verifiedPage.text(), /Email verified/);
  assert.match(verifiedPage.headers.get("content-security-policy"), /default-src 'none'/);
  const badLink = await send("/account/verified?error=INVALID_TOKEN");
  assert.equal(badLink.status, 400);
  assert.match(await badLink.text(), /invalid or has already been used/);
  assert.doesNotMatch(
    await (await send("/account/verified?error=<script>")).text(),
    /<script>/,
    "unknown error codes are not echoed",
  );

  // A legacy magic-link account (with a room) is linked when the same email signs up.
  const legacy = await signIn(ORIGIN, "carla@example.test", local.fetch);
  const room = await data(
    await send("/api/rooms", {
      method: "POST",
      session: legacy.session,
      body: { document: { title: "Carla board", pages: [] } },
    }),
    201,
  );
  const carla = await passwordUser("carla@example.test", "Carla P.");
  const me = await data(await send("/api/me", { session: carla }), 200);
  assert.equal(me.account.id, legacy.account.id, "same directory account");
  assert.equal(me.account.displayName, legacy.account.displayName, "existing profile is kept");
  assert.equal(me.sessions, 2, "one legacy and one Better Auth session");
  assert.deepEqual(
    (await data(await send("/api/me/rooms", { session: carla }), 200)).rooms.map((r) => r.id),
    [room.id],
  );
  assert.equal(
    (await data(await send(`/api/rooms/${room.id}`, { session: carla }), 200)).role,
    "owner",
  );
  // The token also works as Authorization: Bearer; a forged one is anonymous.
  assert.equal(
    (await data(await send("/api/me", { token: carla }), 200)).account.id,
    me.account.id,
  );
  assert.equal((await send("/api/me", { session: carla.slice(0, -3) + "AAA" })).status, 401);

  // A new password user gets a fresh directory account named after the sign-up name.
  const dana = await passwordUser("dana@example.test", "Dana Q.");
  const danaMe = await data(await send("/api/me", { session: dana }), 200);
  assert.equal(danaMe.account.displayName, "Dana Q.");
  assert.match(danaMe.account.handle, /^dana/);
  const profile = await data(
    await send("/api/me", {
      method: "PATCH",
      session: dana,
      body: { handle: "dana-studio", displayName: "Dana Studio" },
    }),
    200,
  );
  assert.equal(profile.account.handle, "dana-studio");

  // Room invitations by email reach a user who signs up afterwards; sockets take the token.
  await data(
    await send(`/api/rooms/${room.id}/members`, {
      method: "POST",
      session: carla,
      body: { email: "erin@example.test", role: "editor" },
    }),
    200,
  );
  const erin = await passwordUser("erin@example.test", "Erin");
  assert.equal(
    (await data(await send(`/api/rooms/${room.id}`, { session: erin }), 200)).role,
    "editor",
  );
  const upgrade = await mf.dispatchFetch(
    `${ORIGIN}/api/rooms/${room.id}/socket?session=${encodeURIComponent(erin)}`,
    { headers: { Upgrade: "websocket" } },
  );
  const socket = upgrade.webSocket;
  const welcome = new Promise((resolve) =>
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "welcome") resolve(message);
    }),
  );
  socket.accept();
  assert.equal((await welcome).role, "editor");
  socket.close();
  assert.equal(
    (await send(`/api/rooms/${room.id}`, { session: dana })).status,
    401,
    "non-members have no access",
  );

  // Passkey tickets (registration) work from a Better Auth session.
  await data(await send("/api/auth/passkeys/ticket", { method: "POST", session: dana }), 201);

  // An unverified sign-in is refused and emails a fresh verification link.
  await data(
    await send("/api/auth/sign-up/email", {
      method: "POST",
      ip: "192.0.2.50",
      body: { email: "finn@example.test", password: "finn long password", name: "Finn" },
    }),
    200,
  );
  const refused = await data(
    await send("/api/auth/sign-in/email", {
      method: "POST",
      ip: "192.0.2.50",
      body: {
        email: "finn@example.test",
        password: "finn long password",
        callbackURL: "/account/verified",
      },
    }),
    403,
  );
  assert.equal(refused.code, "EMAIL_NOT_VERIFIED");
  assert.equal(
    (await outbox("finn@example.test")).filter((m) => /Verify/.test(m.subject)).length,
    2,
  );

  // Password reset goes through the reset page; the link token is single use.
  await data(
    await send("/api/auth/request-password-reset", {
      method: "POST",
      ip: "192.0.2.60",
      body: { email: "dana@example.test", redirectTo: "/account/reset-password" },
    }),
    200,
  );
  const resetLink = new URL(
    (await outbox("dana@example.test")).find((m) => /Reset/.test(m.subject)).link,
  );
  const toPage = await send(resetLink.pathname + resetLink.search);
  assert.equal(toPage.status, 302);
  const pageUrl = new URL(toPage.headers.get("location"), ORIGIN);
  assert.equal(pageUrl.pathname, "/account/reset-password");
  const resetToken = pageUrl.searchParams.get("token");
  assert.ok(resetToken);
  const resetPage = await send(pageUrl.pathname + pageUrl.search);
  assert.equal(resetPage.status, 200);
  assert.match(await resetPage.text(), /<script src="\/account\/reset-password\.js"><\/script>/);
  assert.match(resetPage.headers.get("content-security-policy"), /script-src 'self'/);
  const script = await send("/account/reset-password.js");
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.match(await script.text(), /\/api\/auth\/reset-password/);
  await data(
    await send("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, newPassword: "dana new passphrase" },
    }),
    200,
  );
  assert.equal((await send("/api/me", { session: dana })).status, 401, "reset revokes sessions");
  const used = await send(resetLink.pathname + resetLink.search);
  assert.match(used.headers.get("location"), /\/account\/reset-password\?error=INVALID_TOKEN/);
  assert.equal((await send("/account/reset-password?error=INVALID_TOKEN")).status, 400);

  // Sign out ends one Better Auth session; sign out everywhere also ends the legacy session.
  const carla2 = (
    await send("/api/auth/sign-in/email", {
      method: "POST",
      ip: "192.0.2.70",
      body: { email: "carla@example.test", password: "a long enough password" },
    })
  ).headers.get("set-auth-token");
  await data(await send("/api/auth/signout", { method: "POST", session: carla2 }), 200);
  assert.equal((await send("/api/me", { session: carla2 })).status, 401);
  assert.equal((await send("/api/me", { session: carla })).status, 200);
  const everywhere = await data(
    await send("/api/auth/signout-all", { method: "POST", session: carla }),
    200,
  );
  assert.equal(everywhere.sessions, 2);
  assert.equal((await send("/api/me", { session: carla })).status, 401);
  assert.equal((await send("/api/me", { session: legacy.session })).status, 401);

  console.log(
    "PASS Better Auth bridge: verified-email linking of legacy accounts, new accounts, profiles, room roles and email invites, socket bearer sessions, passkey tickets, unverified resend, reset page, sign out (everywhere)",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
