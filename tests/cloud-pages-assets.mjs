// Cross-feature: per-page room storage with lazy page loading (cloud/room-store.js), room assets
// (cloud/inline-binaries.js) and web sign-in (cloud/web-access.js). A room created on a server
// without asset storage keeps large inline images on pages a lazy client has not loaded; once the
// server stores assets, each page is migrated to R2 when it is fetched (`GET /pages`), without
// touching the pages nobody loaded, and the web app cannot fetch pages without a session.
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-pages-assets-"));
const options = await cloudOptions(persistence);
// The same server without asset storage (no signing secret): binaries stay inline, as before.
const noAssets = {
  ...options,
  workers: options.workers.map((worker) => ({
    ...worker,
    config: { ...worker.config, env: { ...worker.config.env } },
  })),
};
delete noAssets.workers[0].config.env.ASSET_SIGNING_SECRET;
let mf = new Miniflare(noAssets);
// Asset URLs pass the document schema on https or loopback http only.
const origin = "http://localhost";
const WEB = { origin, "sec-fetch-site": "same-origin" };
const call = (route, { method = "GET", body, token, session, headers = {} } = {}) =>
  mf.dispatchFetch(route.startsWith("http") ? route : origin + route, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(session ? { "x-verynize-session": session } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// Over the 8 KiB inline limit (web/storage-limits.js INLINE_LIMIT_BYTES).
const bigPng = () => Uint8Array.from(Buffer.concat([PNG, crypto.randomBytes(12 * 1024)]));
const dataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
const image = (id, src) => ({ id, type: "image", name: id, x: 0, y: 0, w: 10, h: 10, src });
const text = (id) => ({ id, type: "text", name: id, x: 0, y: 0, w: 10, h: 10, text: "Hello" });

try {
  const imageB = bigPng(),
    imageC = bigPng();
  const document = {
    version: 2,
    name: "Lazy pages with images",
    activePage: "a",
    pages: [
      { id: "a", name: "Cover", nodes: [text("t1")] },
      { id: "b", name: "Gallery", nodes: [image("i1", dataUrl(imageB)), text("t2")] },
      { id: "c", name: "Archive", nodes: [image("i2", dataUrl(imageC))] },
    ],
  };
  const room = await data(await call("/api/rooms", { method: "POST", body: { document } }), 201);
  const base = `/api/rooms/${room.id}`;
  const fetchPages = (ids, options = { token: room.token }) =>
    call(`${base}/pages?${ids.map((id) => `id=${id}`).join("&")}`, options);
  // Stored inline on the server without assets.
  let pages = await data(await fetchPages(["b"]), 200);
  assert.equal(pages.pages[0].nodes[0].src, dataUrl(imageB));

  // The server gains asset storage. A lazy snapshot of the active page migrates nothing else.
  await mf.dispose();
  mf = new Miniflare(options);
  const lazy = await data(await call(`${base}?lazy=1`, { token: room.token }), 200);
  assert.deepEqual(lazy.unloaded.sort(), ["b", "c"]);
  assert.equal(lazy.revision, 0, "pages nobody loaded are not migrated");

  // Fetching page b migrates it: its image is now a room asset holding the same bytes.
  const assetUrl = new RegExp(
    `^${origin}/api/rooms/${room.id}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`,
  );
  pages = await data(await fetchPages(["b"]), 200);
  assert.equal(pages.revision, 1, "one server batch");
  const [gallery] = pages.pages;
  assert.match(gallery.nodes[0].src, assetUrl);
  assert.equal(gallery.nodes[1].text, "Hello", "other nodes are untouched");
  const served = await call(gallery.nodes[0].src);
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), imageB);
  // Page c stays inline until it is fetched itself; fetching b again changes nothing.
  pages = await data(await fetchPages(["b"]), 200);
  assert.equal(pages.revision, 1);
  pages = await data(await fetchPages(["c"]), 200);
  assert.equal(pages.revision, 2);
  assert.match(pages.pages[0].nodes[0].src, assetUrl);
  // The migrated pages are stored per page: the whole document holds no data: URL any more.
  const whole = await data(await call(base, { token: room.token }), 200);
  assert.equal(whole.revision, 2);
  assert.doesNotMatch(JSON.stringify(whole.document), /data:image\/png/);
  assert.deepEqual(
    whole.document.pages.map((page) => page.id),
    ["a", "b", "c"],
  );

  // Web sign-in: the web app's anonymous page fetch is refused, even with the room's link.
  const refused = await data(await fetchPages(["a"], { token: room.token, headers: WEB }), 401);
  assert.match(refused.error, /Sign in/);
  const session = await passwordUser(origin, "pages-assets@example.com", "Pages", (url, init) =>
    mf.dispatchFetch(url, init),
  );
  pages = await data(await fetchPages(["a"], { token: room.token, session, headers: WEB }), 200);
  assert.equal(pages.pages[0].id, "a");
  // The desktop and scripts keep capability-link access.
  await data(
    await fetchPages(["a"], {
      token: room.token,
      headers: { origin: "app://verynize", "sec-fetch-site": "cross-site" },
    }),
    200,
  );

  console.log(
    "PASS lazy pages × room assets × web sign-in: inline images on unloaded pages migrate to R2 when each page is fetched (not before), once, and anonymous web page fetches are refused",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
