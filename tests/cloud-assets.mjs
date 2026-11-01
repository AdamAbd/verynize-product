// Room assets in local workerd with a real (Miniflare) R2 bucket and D1: registration, signed
// upload, dedupe, validation, signed reads, role enforcement, published snapshots and restart.
import { ASSET_SECRET, Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/storage-limits.js";

const Limits = globalThis.VerynizeStorageLimits;
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-assets-"));
const options = await cloudOptions(persistence);
let mf = new Miniflare(options);
const origin = "http://localhost";
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

  // Declared types: unknown ones refused, sizes bounded, hash shape checked, bytes sniffed.
  assert.equal((await register(room.id, room.token, PNG, "text/html")).status, 415);
  assert.equal((await register(room.id, room.token, PNG, "application/pdf")).status, 415);
  // SVG may be declared, but PNG bytes declared as SVG are refused when they arrive.
  const pngAsSvg = Uint8Array.from([...PNG, 7]);
  response = await register(room.id, room.token, pngAsSvg, "image/svg+xml");
  assert.equal(response.status, 201);
  assert.equal(
    (await put((await response.json()).uploadUrl, pngAsSvg, "image/svg+xml")).status,
    415,
  );
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

  // ---- Every binary type: SVG, fonts and video upload, are sniffed and served with their type. ----
  const SVG = new TextEncoder().encode(
    '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><style>rect{fill:red}</style><rect width="4" height="4"/></svg>',
  );
  const WOFF2 = Uint8Array.from(Buffer.concat([Buffer.from("wOF2"), crypto.randomBytes(64)]));
  const WOFF = Uint8Array.from(Buffer.concat([Buffer.from("wOFF"), crypto.randomBytes(64)]));
  const TTF = Uint8Array.from(Buffer.concat([Buffer.from([0, 1, 0, 0]), crypto.randomBytes(64)]));
  const OTF = Uint8Array.from(Buffer.concat([Buffer.from("OTTO"), crypto.randomBytes(64)]));
  const MP4 = Uint8Array.from(
    Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isommp41"),
      crypto.randomBytes(64),
    ]),
  );
  const WEBM = Uint8Array.from(
    Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(64)]),
  );
  for (const [type, bytes] of [
    ["image/svg+xml", SVG],
    ["font/woff2", WOFF2],
    ["font/woff", WOFF],
    ["font/ttf", TTF],
    ["font/otf", OTF],
    ["video/mp4", MP4],
    ["video/webm", WEBM],
  ]) {
    response = await register(room.id, room.token, bytes, type);
    assert.equal(response.status, 201, type);
    const asset = await response.json();
    assert.equal((await put(asset.uploadUrl, bytes, type)).status, 200, type);
    response = await call(asset.url);
    assert.equal(response.status, 200, type);
    assert.equal(response.headers.get("content-type"), type);
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.equal(response.headers.get("access-control-allow-origin"), "*", "fonts need CORS");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
  // Bytes that are not what they claim: PNG as a font, HTML as SVG, a font as video.
  const html = new TextEncoder().encode(
    "<html><body><svg></svg><script>alert(1)</script></body></html>",
  );
  for (const [type, bytes] of [
    ["font/woff2", Uint8Array.from([...PNG, 1])],
    ["image/svg+xml", html],
    ["video/mp4", Uint8Array.from([...WOFF2, 1])],
  ]) {
    const asset = await (await register(room.id, room.token, bytes, type)).json();
    response = await put(asset.uploadUrl, bytes, type);
    assert.equal(response.status, 415, type);
  }

  // ---- Inline binaries never reach room storage. ----
  const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const BIG_PNG = Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(12000)]));
  const BIG_JPEG = Uint8Array.from(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(12000)]),
  );
  const BIG_WOFF2 = Uint8Array.from(
    Buffer.concat([Buffer.from("wOF2"), crypto.randomBytes(12000)]),
  );
  const BIG_SVG = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${"x".repeat(300 * 1024)} --></svg>`,
  );
  const smallPng = dataUrl("image/png", PNG);
  const node = (id, extra = {}) => ({
    id,
    type: "image",
    name: id,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    ...extra,
  });
  const page = (nodes) => ({ id: "p", name: "Page 1", nodes });
  const assetUrl = (roomId) =>
    new RegExp(`^${origin}/api/rooms/${roomId}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`);
  const read = async (roomId, token) =>
    (await (await call(`/api/rooms/${roomId}`, { token })).json()).document;
  const bytesOf = async (url) => new Uint8Array(await (await call(url)).arrayBuffer());

  // Room creation: image sources, image fills, masks, fonts and large SVG become assets; small
  // images and recolourable-size SVG stay inline; the same bytes share one asset.
  response = await call("/api/rooms", {
    method: "POST",
    body: {
      document: {
        version: 2,
        name: "Inline",
        pages: [
          page([
            node("a", { src: dataUrl("image/png", BIG_PNG) }),
            node("b", { src: dataUrl("image/png", BIG_PNG) }),
            node("c", { src: smallPng }),
            node("d", {
              type: "rectangle",
              fills: [{ type: "image", src: dataUrl("image/jpeg", BIG_JPEG), opacity: 60 }],
              masks: [{ type: "image", src: dataUrl("image/png", BIG_PNG) }],
            }),
            node("e", { src: dataUrl("image/svg+xml", BIG_SVG) }),
            {
              id: "t",
              type: "text",
              name: "t",
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              text: dataUrl("image/png", BIG_PNG),
            },
          ]),
        ],
        fontFaces: [
          {
            family: "Brand",
            weight: "400",
            style: "normal",
            src: dataUrl("font/woff2", BIG_WOFF2),
          },
        ],
      },
    },
  });
  assert.equal(response.status, 201);
  const inlineRoom = await response.json();
  let stored = await read(inlineRoom.id, inlineRoom.token);
  const [a, b, c, d, e, t] = stored.pages[0].nodes;
  assert.match(a.src, assetUrl(inlineRoom.id));
  assert.equal(b.src, a.src, "identical bytes share one asset");
  assert.equal(c.src, smallPng, "small images stay inline");
  assert.match(d.fills[0].src, assetUrl(inlineRoom.id));
  assert.equal(d.fills[0].opacity, 60);
  assert.equal(d.masks[0].src, a.src);
  assert.match(e.src, assetUrl(inlineRoom.id));
  assert.equal(t.text, dataUrl("image/png", BIG_PNG), "text content is never rewritten");
  assert.match(stored.fontFaces[0].src, assetUrl(inlineRoom.id));
  assert.deepEqual(await bytesOf(a.src), BIG_PNG);
  assert.deepEqual(await bytesOf(d.fills[0].src), BIG_JPEG);
  assert.deepEqual(await bytesOf(stored.fontFaces[0].src), BIG_WOFF2);
  assert.deepEqual(await bytesOf(e.src), BIG_SVG);
  assert.equal((await call(stored.fontFaces[0].src)).headers.get("content-type"), "font/woff2");
  // Data that rooms cannot store is refused, and bytes that are not what the data URL says.
  response = await call("/api/rooms", {
    method: "POST",
    body: {
      document: { pages: [page([node("x", { src: dataUrl("application/pdf", BIG_PNG) })])] },
    },
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /cannot be stored in a shared file/);
  response = await call("/api/rooms", {
    method: "POST",
    body: { document: { pages: [page([node("x", { src: dataUrl("image/gif", BIG_PNG) })])] } },
  });
  assert.equal(response.status, 415);

  // Snapshot writes: an editor's inline image becomes an asset; a viewer's write is refused.
  const snapshotBefore = await (
    await call(`/api/rooms/${inlineRoom.id}`, { token: inlineRoom.token })
  ).json();
  const BIG_PNG_2 = Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(9000)]));
  const edited = structuredClone(snapshotBefore.document);
  edited.pages[0].nodes.push(node("f", { src: dataUrl("image/png", BIG_PNG_2) }));
  response = await call(`/api/rooms/${inlineRoom.id}`, {
    method: "PUT",
    token: inlineRoom.token,
    body: { document: edited, baseRevision: snapshotBefore.revision },
  });
  assert.equal(response.status, 200);
  stored = (await response.json()).document;
  assert.match(stored.pages[0].nodes.at(-1).src, assetUrl(inlineRoom.id));
  assert.deepEqual(await bytesOf(stored.pages[0].nodes.at(-1).src), BIG_PNG_2);
  const inlineViewer = await (
    await call(`/api/rooms/${inlineRoom.id}/tokens`, {
      method: "POST",
      token: inlineRoom.token,
      body: { role: "viewer" },
    })
  ).json();
  const BIG_PNG_3 = Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(9500)]));
  edited.pages[0].nodes.push(node("g", { src: dataUrl("image/png", BIG_PNG_3) }));
  response = await call(`/api/rooms/${inlineRoom.id}`, {
    method: "PUT",
    token: inlineViewer.token,
    body: { document: edited, baseRevision: snapshotBefore.revision + 1 },
  });
  assert.equal(response.status, 403);
  // The viewer's bytes were not stored: registering them needs a fresh upload.
  assert.equal((await register(inlineRoom.id, inlineRoom.token, BIG_PNG_3)).status, 201);

  // HTTP operation batches: the added layer arrives with an asset URL.
  const BIG_PNG_4 = Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(10000)]));
  response = await call(`/api/rooms/${inlineRoom.id}/ops`, {
    method: "POST",
    token: inlineRoom.token,
    body: {
      client: "http-client",
      batch: 1,
      ops: [
        {
          t: "add",
          page: "p",
          id: "h",
          value: node("h", { src: dataUrl("image/png", BIG_PNG_4) }),
        },
      ],
    },
  });
  assert.equal(response.status, 200);
  const httpOps = await response.json();
  assert.equal(httpOps.ops.length, 1);
  assert.match(httpOps.ops[0].value.src, assetUrl(inlineRoom.id));

  // WebSocket batches reach the room directly: a large inline binary is rejected with a reason
  // (clients upload first), the rest of the batch applies.
  const upgrade = await mf.dispatchFetch(
    `${origin}/api/rooms/${inlineRoom.id}/socket?token=${inlineRoom.token}&client=ws-client`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket;
  const messages = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  socket.accept();
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error("Timed out waiting for a socket message");
  };
  const welcome = await waitFor((m) => m.type === "snapshot");
  assert.equal(Limits.inlineBinaries(welcome.document).length, 0, "no inline binary in the room");
  socket.send(
    JSON.stringify({
      type: "ops",
      client: "ws-client",
      batch: 1,
      ops: [
        { t: "node", page: "p", id: "a", key: "src", value: dataUrl("image/png", BIG_PNG_4) },
        { t: "node", page: "p", id: "a", key: "name", value: "renamed" },
      ],
    }),
  );
  const answer = await waitFor((m) => m.type === "ops" && m.client === "ws-client");
  assert.equal(answer.ops.length, 1);
  assert.equal(answer.ops[0].key, "name");
  assert.equal(answer.rejected, 1);
  socket.close();
  stored = await read(inlineRoom.id, inlineRoom.token);
  assert.match(stored.pages[0].nodes[0].src, assetUrl(inlineRoom.id));
  assert.equal(stored.pages[0].nodes[0].name, "renamed");

  // ---- Rooms created before every binary became an asset are migrated when opened. ----
  // A server without asset storage keeps binaries inline (as before)…
  await mf.dispose();
  const noAssets = {
    ...options,
    workers: options.workers.map((worker) => ({
      ...worker,
      config: { ...worker.config, env: { ...worker.config.env } },
    })),
  };
  delete noAssets.workers[0].config.env.ASSET_SIGNING_SECRET;
  mf = new Miniflare(noAssets);
  const BIG_PNG_5 = Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(11000)]));
  const legacyDoc = {
    version: 2,
    name: "Legacy",
    pages: [page([node("old", { src: dataUrl("image/png", BIG_PNG_5) })])],
    fontFaces: [
      { family: "Old", weight: "400", style: "normal", src: dataUrl("font/woff2", BIG_WOFF2) },
    ],
  };
  const legacy = await (
    await call("/api/rooms", { method: "POST", body: { document: legacyDoc } })
  ).json();
  assert.equal(
    (await read(legacy.id, legacy.token)).pages[0].nodes[0].src,
    dataUrl("image/png", BIG_PNG_5),
  );
  // …and once the server stores assets, opening the room moves them to R2.
  await mf.dispose();
  mf = new Miniflare(options);
  const migrated = await (await call(`/api/rooms/${legacy.id}`, { token: legacy.token })).json();
  assert.match(migrated.document.pages[0].nodes[0].src, assetUrl(legacy.id));
  assert.match(migrated.document.fontFaces[0].src, assetUrl(legacy.id));
  assert.deepEqual(await bytesOf(migrated.document.pages[0].nodes[0].src), BIG_PNG_5);
  assert.equal(migrated.revision, 1, "one server batch");
  // Opening it again is a no-op.
  assert.equal(
    (await (await call(`/api/rooms/${legacy.id}`, { token: legacy.token })).json()).revision,
    1,
  );

  console.log(
    "PASS room assets: signed upload, dedupe, size/type/sha checks, forged and expired upload URLs, role enforcement, signed reads, serving headers, published snapshot images, restart persistence, SVG/font/video types and sniffing, inline extraction on create/snapshot/HTTP ops, rejection on sockets and for unsupported data, migration of older rooms",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
