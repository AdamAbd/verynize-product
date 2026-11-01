// Web sign-in, server half (cloud/web-access.js, cloud/README.md "Web sign-in"): requests from the
// web app (a page on the server's own origin: Sec-Fetch-Site same-origin or a matching Origin)
// need a signed-in account for every room route, while the desktop renderer (Origin
// app://verynize) and scripts keep anonymous rooms and capability-link joins. Public snapshots
// stay anonymous. ROOM_ACCOUNT_REQUIRED=all also requires an account to create a room from any
// client; =off restores anonymous web use. Also the per-account web AI setup flag on /api/me.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const ORIGIN = "http://local";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-web-access-"));
const options = await cloudOptions(path.join(dir, "state"));
const baseEnv = { ...options.workers[0].config.env };
const withMode = (mode) => {
  options.workers[0].config.env = mode
    ? { ...baseEnv, ROOM_ACCOUNT_REQUIRED: { type: "text", value: mode } }
    : baseEnv;
  return options;
};
let mf = new Miniflare(withMode(null));

const CLIENTS = {
  // A page of the web app: fetch() marks it same-origin and names the page origin.
  web: { origin: ORIGIN, "sec-fetch-site": "same-origin" },
  // Browsers do not send Origin on same-origin GETs; Sec-Fetch-Site still says where it came from.
  webGet: { "sec-fetch-site": "same-origin" },
  // Only Origin (an older browser without Fetch Metadata).
  webOrigin: { origin: ORIGIN },
  desktop: { origin: "app://verynize", "sec-fetch-site": "cross-site" },
  script: {},
};
let ip = 0;
const send = (route, { client = "script", method = "GET", body, session, token, headers } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
      // Fresh IPs keep the per-IP room creation limit out of the way.
      "cf-connecting-ip": `198.51.100.${++ip % 250}`,
      ...CLIENTS[client],
      ...(session ? { "x-verynize-session": session } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};
const create = (options) =>
  send("/api/rooms", { method: "POST", body: { document: { nodes: [] } }, ...options });

try {
  await mf.ready;
  const session = await passwordUser(ORIGIN, "web-access@example.com", "Web", (url, init) =>
    mf.dispatchFetch(url, init),
  );

  // ---- default rule ("web") ----
  for (const client of ["web", "webOrigin"]) {
    const refused = await data(await create({ client }), 401);
    assert.match(refused.error, /Sign in/, client);
  }
  const desktopRoom = await data(await create({ client: "desktop" }), 201);
  const scriptRoom = await data(await create({ client: "script" }), 201);
  assert.equal(desktopRoom.role, "owner");
  const webRoom = await data(await create({ client: "web", session }), 201);
  assert.equal(webRoom.role, "owner");
  assert.ok(webRoom.organizationId, "a signed-in web room lands in the personal workspace");

  // An invite link (capability token) opens the room from the desktop and scripts, and from the
  // web app only together with an account.
  const room = `/api/rooms/${desktopRoom.id}`;
  assert.equal(
    (await data(await send(room, { client: "desktop", token: desktopRoom.token }), 200)).role,
    "owner",
  );
  assert.equal(
    (await data(await send(room, { client: "script", token: desktopRoom.token }), 200)).role,
    "owner",
  );
  await data(await send(room, { client: "webGet", token: desktopRoom.token }), 401);
  await data(await send(room + "/access", { client: "webGet", token: desktopRoom.token }), 401);
  await data(
    await send(room + "/comments", {
      client: "web",
      method: "POST",
      token: desktopRoom.token,
      body: { text: "anonymous" },
    }),
    401,
  );
  assert.equal(
    (await data(await send(room, { client: "webGet", token: desktopRoom.token, session }), 200))
      .role,
    "owner",
  );
  // Sockets: the browser's handshake carries Origin and Sec-Fetch-Site.
  const anonymousSocket = await send(`${room}/socket?token=${desktopRoom.token}`, {
    client: "web",
    headers: { upgrade: "websocket" },
  });
  assert.equal(anonymousSocket.status, 401);
  const desktopSocket = await send(`${room}/socket?token=${desktopRoom.token}`, {
    client: "desktop",
    headers: { upgrade: "websocket" },
  });
  assert.equal(desktopSocket.status, 101);
  desktopSocket.webSocket.accept();
  desktopSocket.webSocket.close();
  const webSocket = await send(
    `${room}/socket?token=${desktopRoom.token}&session=${encodeURIComponent(session)}`,
    { client: "web", headers: { upgrade: "websocket" } },
  );
  assert.equal(webSocket.status, 101);
  webSocket.webSocket.accept();
  webSocket.webSocket.close();

  // Published snapshots stay public, also when opened from the web app.
  const published = await data(
    await send(`/api/rooms/${scriptRoom.id}/publish`, { method: "POST", token: scriptRoom.token }),
    200,
  );
  assert.ok(
    (await data(await send(`/api/public/${published.publicId}`, { client: "webGet" }), 200))
      .document,
  );
  // Account routes keep their own rules: signing in from the web app needs no session.
  await data(await send("/api/me", { client: "webGet" }), 401);

  // ---- web AI setup, remembered per account ----
  const me = await data(await send("/api/me", { client: "webGet", session }), 200);
  assert.equal(me.aiSetupAt, null);
  const done = await data(
    await send("/api/me", { client: "web", method: "PATCH", session, body: { aiSetup: true } }),
    200,
  );
  assert.equal(typeof done.aiSetupAt, "number");
  assert.equal((await data(await send("/api/me", { session }), 200)).aiSetupAt, done.aiSetupAt);
  // A profile edit keeps it; `aiSetup: false` shows the steps again.
  const renamed = await data(
    await send("/api/me", { method: "PATCH", session, body: { displayName: "Web Designer" } }),
    200,
  );
  assert.equal(renamed.aiSetupAt, done.aiSetupAt);
  assert.equal(renamed.account.aiSetupAt, undefined, "not part of the public profile");
  const reset = await data(
    await send("/api/me", { method: "PATCH", session, body: { aiSetup: false } }),
    200,
  );
  assert.equal(reset.aiSetupAt, null);

  // ---- ROOM_ACCOUNT_REQUIRED=all: the desktop needs an account to create rooms, joins still work ----
  await mf.dispose();
  mf = new Miniflare(withMode("all"));
  await mf.ready;
  await data(await create({ client: "desktop" }), 401);
  await data(await create({ client: "script" }), 401);
  await data(await create({ client: "web" }), 401);
  assert.equal((await data(await create({ client: "desktop", session }), 201)).role, "owner");
  assert.equal(
    (await data(await send(room, { client: "desktop", token: desktopRoom.token }), 200)).role,
    "owner",
  );

  // ---- ROOM_ACCOUNT_REQUIRED=off: anonymous web use as before ----
  await mf.dispose();
  mf = new Miniflare(withMode("off"));
  await mf.ready;
  await data(await create({ client: "web" }), 201);
  await data(await send(room, { client: "webGet", token: desktopRoom.token }), 200);

  console.log(
    "PASS cloud web access: web-origin room routes need an account (create, read, comment, socket), desktop and scripts keep anonymous rooms and invite joins, public snapshots stay public, AI setup flag per account, ROOM_ACCOUNT_REQUIRED all/off",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
