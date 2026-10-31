// Room assets in local workerd with a real (Miniflare) R2 bucket and D1: registration, signed
// upload, dedupe, validation, signed reads, role enforcement, published snapshots and restart.
import { Miniflare } from "miniflare";
import { ASSET_SECRET, cloudOptions, passwordUser } from "./cloud-harness.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-assets-"));
const options = await cloudOptions(persistence);
let mf = new Miniflare(options);
const origin = "http://local";
const call = (route, { method = "GET", body, token, session, headers = {} } = {}) =>
  mf.dispatchFetch(route.startsWith("http") ? route : origin + route, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { "content-type": "application/json" }
        : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(session ? { "x-verynize-session": session } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) }
      : {}),
  });
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
// A real 1×1 PNG and a minimal (sniffable) GIF.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const GIF = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
);
const register = (room, token, bytes, contentType = "image/png", extra = {}) =>
  call(`/api/rooms/${room}/assets`, {
    method: "POST",
    token,
    body: { contentType, size: bytes.byteLength, sha256: sha(bytes), ...extra },
  });
const put = (uploadUrl, bytes, contentType = "image/png") =>
  call(uploadUrl, { method: "PUT", body: bytes, headers: { "content-type": contentType } });

try {
  const room = await (
    await call("/api/rooms", { method: "POST", body: { document: { pages: [] } } })
  ).json();
  const base = `/api/rooms/${room.id}`;

  // Registration and upload.
  let response = await register(room.id, room.token, PNG);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.method, "PUT");
  assert.equal(created.existing, false);
  assert.match(
    created.url,
    new RegExp(`^${origin}${base}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`),
  );
  assert.ok(created.expiresAt > Date.now() && created.expiresAt <= Date.now() + 10 * 60 * 1000);
  // Not readable before the bytes arrive.
  assert.equal((await call(created.url)).status, 404);
  // Size, hash and content mismatches are refused.
  const tampered = Uint8Array.from(PNG);
  tampered[tampered.length - 1] ^= 1;
  response = await put(created.uploadUrl, tampered);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /sha256/);
  assert.equal((await put(created.uploadUrl, PNG.slice(0, 10))).status, 400);
  assert.equal((await put(created.uploadUrl, Uint8Array.from([...PNG, 0]))).status, 413);
  // Forged and expired upload URLs.
  const forged = new URL(created.uploadUrl);
  forged.searchParams.set("signature", "0".repeat(64));
  assert.equal((await put(forged.href, PNG)).status, 403);
  const stretched = new URL(created.uploadUrl);
  stretched.searchParams.set("expires", String(Number(stretched.searchParams.get("expires")) + 1));
  assert.equal((await put(stretched.href, PNG)).status, 403);
  const expired = new URL(created.uploadUrl);
  const past = Date.now() - 1000;
  const parts = [
    "verynize-room-asset-v1",
    "put",
    room.id,
    created.id,
    sha(PNG),
    String(PNG.byteLength),
    "image/png",
    String(past),
  ];
  expired.searchParams.set("expires", String(past));
  expired.searchParams.set(
    "signature",
    crypto.createHmac("sha256", ASSET_SECRET).update(parts.join("\n")).digest("hex"),
  );
  response = await put(expired.href, PNG);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /expired/);
  // An upload URL is bound to its room.
  const other = await (
    await call("/api/rooms", { method: "POST", body: { document: { pages: [] } } })
  ).json();
  assert.equal((await put(created.uploadUrl.replace(room.id, other.id), PNG)).status, 403);

  response = await put(created.uploadUrl, PNG);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, created.url);

  // Serving headers through the signed read URL (no credentials).
  response = await call(created.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /max-age=31536000, immutable/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(response.headers.get("etag"), `"${sha(PNG)}"`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
  assert.equal(
    (await call(created.url, { headers: { "if-none-match": `"${sha(PNG)}"` } })).status,
    304,
  );
  assert.equal((await call(created.url, { method: "HEAD" })).status, 200);

  // Dedupe: the same bytes in the same room need no upload.
  response = await register(room.id, room.token, PNG);
  assert.equal(response.status, 200);
  const again = await response.json();
  assert.equal(again.existing, true);
  assert.equal(again.id, created.id);
  assert.equal(again.url, created.url);
  assert.equal(again.uploadUrl, undefined);
  // Another room gets its own copy (rooms never share assets).
  response = await register(other.id, other.token, PNG);
  assert.equal(response.status, 201);
  assert.notEqual((await response.json()).id, created.id);

  // Declared types: SVG and others refused, sizes bounded, hash shape checked, bytes sniffed.
  assert.equal((await register(room.id, room.token, PNG, "image/svg+xml")).status, 415);
  assert.equal((await register(room.id, room.token, PNG, "text/html")).status, 415);
  assert.equal(
    (await register(room.id, room.token, PNG, "image/png", { size: 20 * 1024 * 1024 + 1 })).status,
    413,
  );
  assert.equal(
    (await register(room.id, room.token, PNG, "image/png", { sha256: "abc" })).status,
    400,
  );
  response = await register(room.id, room.token, GIF, "image/png");
  const lying = await response.json();
  response = await put(lying.uploadUrl, GIF);
  assert.equal(response.status, 415);
  // Re-registering the same bytes with the right type replaces the pending declaration.
  response = await register(room.id, room.token, GIF, "image/gif");
  const gif = await response.json();
  assert.equal(gif.id, lying.id);
  assert.equal((await put(gif.uploadUrl, GIF, "image/gif")).status, 200);
  assert.equal((await call(gif.url)).headers.get("content-type"), "image/gif");

  // Roles: viewers read but cannot upload; strangers and forged read signatures are refused.
  const viewer = await (
    await call(`${base}/tokens`, { method: "POST", token: room.token, body: { role: "viewer" } })
  ).json();
  assert.equal((await register(room.id, viewer.token, GIF)).status, 403);
  const commenter = await (
    await call(`${base}/tokens`, { method: "POST", token: room.token, body: { role: "commenter" } })
  ).json();
  assert.equal((await register(room.id, commenter.token, GIF)).status, 403);
  assert.equal((await register(room.id, null, GIF)).status, 401);
  assert.equal((await register(room.id, other.token, GIF)).status, 401);
  const bare = created.url.split("?")[0];
  assert.equal((await call(bare)).status, 401);
  assert.equal((await call(bare, { token: other.token })).status, 401);
  assert.equal((await call(bare, { token: viewer.token })).status, 200);
  assert.equal((await call(bare + "?sig=" + "f".repeat(64))).status, 403);
  assert.equal((await call(bare + "?sig=short")).status, 403);
  // A read signature is bound to its room and asset.
  assert.equal((await call(created.url.replace(room.id, other.id))).status, 403);
  assert.equal((await call(created.url.replace(created.id, gif.id))).status, 403);
  // A signed-in account that is not a member cannot read the bare URL either.
  const stranger = await passwordUser(origin, "stranger@example.com", "Stranger", (url, init) =>
    mf.dispatchFetch(url, init),
  );
  assert.equal((await call(bare, { session: stranger })).status, 401);
  assert.equal(
    (
      await call(`${base}/assets`, {
        method: "POST",
        session: stranger,
        body: { contentType: "image/gif", size: GIF.byteLength, sha256: sha(GIF) },
      })
    ).status,
    401,
  );
  // A member by email (editor) can upload with only a session.
  const member = await passwordUser(origin, "member@example.com", "Member", (url, init) =>
    mf.dispatchFetch(url, init),
  );
  const owner = await passwordUser(origin, "owner@example.com", "Owner", (url, init) =>
    mf.dispatchFetch(url, init),
  );
  assert.equal(
    (await call(`${base}/claim`, { method: "POST", token: room.token, session: owner })).status,
    200,
  );
  assert.equal(
    (
      await call(`${base}/members`, {
        method: "POST",
        token: room.token,
        session: owner,
        body: { email: "member@example.com", role: "editor" },
      })
    ).status,
    200,
  );
  const third = Uint8Array.from([...GIF.slice(0, -1), 0x3b, 0x3b]);
  response = await call(`${base}/assets`, {
    method: "POST",
    session: member,
    body: { contentType: "image/gif", size: third.byteLength, sha256: sha(third) },
  });
  assert.equal(response.status, 201);
  assert.equal((await call(bare, { session: member })).status, 200);

  // The document stores the URL; a published snapshot renders it for anonymous viewers.
  const document = {
    pages: [
      {
        id: "p",
        name: "Page",
        nodes: [{ id: "img", type: "image", src: created.url, x: 0, y: 0, width: 1, height: 1 }],
      },
    ],
  };
  const current = await (await call(base, { token: room.token })).json();
  assert.equal(
    (
      await call(base, {
        method: "PUT",
        token: room.token,
        body: { document, baseRevision: current.revision },
      })
    ).status,
    200,
  );
  const publication = await (
    await call(`${base}/publish`, { method: "POST", token: room.token })
  ).json();
  const snapshot = await (await call(`/api/public/${publication.publicId}`)).json();
  const publicSrc = snapshot.document.pages[0].nodes[0].src;
  assert.equal(publicSrc, created.url);
  response = await call(publicSrc);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);

  // Persistence across a restart (D1 metadata and R2 bytes).
  await mf.dispose();
  mf = new Miniflare(options);
  response = await call(created.url);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
  assert.equal((await (await register(room.id, room.token, PNG)).json()).existing, true);
  // Uploading again after completion is harmless and returns the same asset.
  assert.equal((await put(gif.uploadUrl, GIF, "image/gif")).status, 200);
  // Unknown assets and methods.
  assert.equal(
    (await call(`${base}/assets/${crypto.randomUUID()}`, { token: room.token })).status,
    404,
  );
  assert.equal((await call(`${base}/assets`, { token: room.token })).status, 404);

  console.log(
    "PASS room assets: signed upload, dedupe, size/type/sha checks, forged and expired upload URLs, role enforcement, signed reads, serving headers, published snapshot images, restart persistence",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
