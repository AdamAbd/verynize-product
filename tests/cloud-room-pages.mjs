// Per-page room storage (cloud/room-store.js) and lazy page loading, on the real room actor:
// page records and node index, lazy snapshots over HTTP and WebSocket (`lazy=1`, `sync`, `pages`),
// operations on pages a client has not loaded, node id uniqueness across unloaded pages, the
// page / document limits of cloud/limits.js, the frozen public copy, and the one-time migration of
// rooms that stored the whole document in one row (tests/fixtures/design-room-whole-document.js).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/cloud-ops.js";
import { DOCUMENT_BYTES, PAGE_BYTES } from "../cloud/limits.js";
import { digestHex } from "../cloud/http.js";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const Ops = globalThis.VerynizeOps;
const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  parentId: null,
  name: id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  ...extra,
});
const board = () => ({
  version: 2,
  name: "Pages",
  activePage: "p2",
  pages: [
    { id: "p1", name: "Cover", nodes: [node("a"), node("b", { type: "text", text: "Hi" })] },
    { id: "p2", name: "Screens", nodes: [node("c")], background: "#fff" },
    { id: "p3", name: "Archive", nodes: [node("d"), node("e", { parentId: "d" })] },
  ],
  tokens: { brand: "#123456" },
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-room-pages-"));
const state = path.join(dir, "state");
let mf;
const call = (route, { method = "GET", body, token } = {}) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
const data = async (response, status = 200) => {
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 300));
  return JSON.parse(text);
};
async function socket(route) {
  const upgrade = await mf.dispatchFetch("http://local" + route, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(upgrade.status, 101);
  const ws = upgrade.webSocket;
  const seen = [];
  ws.addEventListener("message", (event) => seen.push(JSON.parse(event.data)));
  ws.accept();
  const next = (predicate, label = "message") =>
    new Promise((resolve, reject) => {
      const found = seen.findIndex(predicate);
      if (found >= 0) return resolve(seen.splice(found, 1)[0]);
      const timer = setTimeout(() => reject(Error("Missing " + label)), 6000);
      const listener = (event) => {
        const value = JSON.parse(event.data);
        if (!predicate(value)) return;
        clearTimeout(timer);
        ws.removeEventListener("message", listener);
        seen.splice(seen.indexOf(value), 1);
        resolve(value);
      };
      ws.addEventListener("message", listener);
    });
  return { ws, seen, next, send: (value) => ws.send(JSON.stringify(value)) };
}

try {
  mf = new Miniflare(await cloudOptions(state));

  // ---- create: stored per page, the whole document assembles unchanged ----------------------
  const doc = board();
  const room = await data(await call("/api/rooms", { method: "POST", body: { document: doc } }), 201);
  const url = "/api/rooms/" + room.id;
  const full = await data(await call(url, { token: room.token }));
  assert.equal(JSON.stringify(full.document), JSON.stringify(doc), "key order survives the split");

  // ---- lazy snapshot over HTTP: metadata, page index and the active page only ----------------
  const lazy = await data(await call(url + "?lazy=1", { token: room.token }));
  assert.deepEqual(lazy.unloaded.sort(), ["p1", "p3"]);
  assert.deepEqual(
    lazy.document.pages.map((p) => [p.id, p.name, p.nodes.length]),
    [
      ["p1", "Cover", 0],
      ["p2", "Screens", 1],
      ["p3", "Archive", 0],
    ],
  );
  assert.equal(lazy.document.pages[1].background, "#fff");
  assert.deepEqual(lazy.document.tokens, { brand: "#123456" });
  assert.deepEqual(
    lazy.pages.map((p) => [p.id, p.nodes]),
    [
      ["p1", 2],
      ["p2", 1],
      ["p3", 2],
    ],
  );
  for (const entry of lazy.pages)
    assert.equal(
      entry.bytes,
      new TextEncoder().encode(JSON.stringify(doc.pages.find((p) => p.id === entry.id))).length,
    );
  const chosen = await data(await call(url + "?lazy=1&page=p3", { token: room.token }));
  assert.deepEqual(chosen.unloaded.sort(), ["p1", "p2"]);
  const fetched = await data(await call(url + "/pages?id=p3&id=nope", { token: room.token }));
  assert.deepEqual(fetched.pages, [doc.pages[2]]);
  assert.deepEqual(fetched.missing, ["nope"]);
  assert.equal((await call(url + "/pages?id=p1")).status, 401);

  // ---- lazy sockets: sync, page requests, operations on pages a client has not loaded --------
  const lazyClient = await socket(`${url}/socket?token=${room.token}&client=lazy1&lazy=1`);
  const welcome = await lazyClient.next((m) => m.type === "welcome");
  assert.equal(welcome.lazyPages, true);
  lazyClient.send({ type: "sync", pages: [] });
  const synced = await lazyClient.next((m) => m.type === "snapshot", "lazy snapshot");
  assert.deepEqual(synced.unloaded.sort(), ["p1", "p3"]);
  assert.equal(
    lazyClient.seen.filter((m) => m.type === "snapshot").length,
    0,
    "lazy clients get no full snapshot",
  );
  const editor = await socket(`${url}/socket?token=${room.token}&client=editor1`);
  const editorSnapshot = await editor.next((m) => m.type === "snapshot");
  assert.equal(editorSnapshot.document.pages[2].nodes.length, 2, "other clients get everything");
  const clock = Ops.createClock("editor1");
  editor.send({
    type: "ops",
    batch: 1,
    ops: [
      { t: "node", page: "p3", id: "d", key: "x", value: 42, s: clock.next() },
      { t: "add", page: "p3", id: "f", value: node("f"), s: clock.next() },
    ],
  });
  const broadcast = await lazyClient.next((m) => m.type === "ops" && m.client === "editor1");
  assert.equal(broadcast.ops.length, 2, "operations on unloaded pages still reach lazy clients");
  lazyClient.send({ type: "pages", ids: ["p3"] });
  const page3 = await lazyClient.next((m) => m.type === "pages" && m.pages.length, "page p3");
  assert.equal(page3.revision, broadcast.revision);
  assert.equal(page3.pages[0].nodes.find((n) => n.id === "d").x, 42);
  assert.deepEqual(
    page3.pages[0].nodes.map((n) => n.id),
    ["d", "e", "f"],
  );
  lazyClient.send({ type: "pages", ids: ["gone"] });
  assert.deepEqual(
    (await lazyClient.next((m) => m.type === "pages" && m.missing?.length)).missing,
    ["gone"],
  );
  // Node ids stay unique across pages a batch does not load (p1 and p2 are not touched here).
  editor.send({
    type: "ops",
    batch: 2,
    ops: [{ t: "add", page: "p2", id: "a", value: node("a"), s: clock.next() }],
  });
  const duplicate = await editor.next((m) => m.type === "ops" && m.batch === 2);
  assert.equal(duplicate.rejected, 1, "a node id used on an unloaded page is refused");
  // Moving a node between pages in one batch keeps the index right.
  editor.send({
    type: "ops",
    batch: 3,
    ops: [
      { t: "remove", page: "p3", id: "f", s: clock.next() },
      { t: "add", page: "p1", id: "f", value: node("f", { x: 7 }), s: clock.next() },
    ],
  });
  assert.equal((await editor.next((m) => m.type === "ops" && m.batch === 3)).ops.length, 2);
  editor.send({
    type: "ops",
    batch: 4,
    ops: [{ t: "add", page: "p2", id: "f", value: node("f"), s: clock.next() }],
  });
  assert.equal((await editor.next((m) => m.type === "ops" && m.batch === 4)).rejected, 1);
  // Page removal, insertion and order.
  editor.send({
    type: "ops",
    batch: 5,
    ops: [
      { t: "addPage", id: "p4", value: { id: "p4", name: "New", nodes: [node("g")] }, s: clock.next() },
      { t: "pageOrder", value: ["p4", "p3", "p2", "p1"], s: clock.next() },
      { t: "removePage", id: "p2", s: clock.next() },
    ],
  });
  const reordered = await editor.next((m) => m.type === "ops" && m.batch === 5);
  assert.equal(reordered.ops.length, 3);
  // A sync at the current revision sends no document.
  lazyClient.send({ type: "sync", pages: ["p3"], revision: reordered.revision });
  const same = await lazyClient.next((m) => m.type === "snapshot" && m.same);
  assert.deepEqual(
    same.pages.map((p) => p.id),
    ["p4", "p3", "p1"],
  );
  lazyClient.send({ type: "sync", pages: ["p3"], revision: 1 });
  const resync = await lazyClient.next((m) => m.type === "snapshot" && !m.same);
  assert.deepEqual(resync.unloaded.sort(), ["p1", "p4"]);
  assert.equal(resync.document.pages.find((p) => p.id === "p3").nodes.length, 2);
  const whole = (await data(await call(url, { token: room.token }))).document;
  const expected = Ops.apply(doc, [
    { t: "node", page: "p3", id: "d", key: "x", value: 42 },
    { t: "add", page: "p1", id: "f", value: node("f", { x: 7 }) },
    { t: "addPage", id: "p4", value: { id: "p4", name: "New", nodes: [node("g")] } },
    { t: "pageOrder", value: ["p4", "p3", "p2", "p1"] },
    { t: "removePage", id: "p2" },
  ]).doc;
  assert.deepEqual(whole, expected);
  editor.ws.close();
  lazyClient.ws.close();

  // ---- limits: per page and per document, instead of one 2 MB room -------------------------
  const filler = (bytes) => "x".repeat(bytes);
  const big = board();
  big.pages[0].nodes[1].text = filler(1_500_000);
  big.pages[1].nodes[0].name = filler(1_500_000);
  const bigRoom = await data(await call("/api/rooms", { method: "POST", body: { document: big } }), 201);
  assert.equal(
    (await data(await call(`/api/rooms/${bigRoom.id}?lazy=1&page=p3`, { token: bigRoom.token })))
      .document.pages[0].nodes.length,
    0,
    "a 3 MB room joins with only the requested page",
  );
  const oversized = board();
  oversized.pages[0].nodes[1].text = filler(PAGE_BYTES);
  const refused = await data(
    await call("/api/rooms", { method: "POST", body: { document: oversized } }),
    413,
  );
  assert.match(refused.error, /Cover.*page limit/);
  const bigUrl = `/api/rooms/${bigRoom.id}`;
  let batch = 0;
  const post = (ops) =>
    call(bigUrl + "/ops", {
      method: "POST",
      token: bigRoom.token,
      body: { client: "filler", batch: ++batch, ops },
    });
  const tooBig = await data(
    await post([{ t: "node", page: "p1", id: "b", key: "text", value: filler(PAGE_BYTES) }]),
    413,
  );
  assert.equal(tooBig.rejected, 1);
  assert.match(tooBig.error, /page limit/);
  // Fill to the document limit with pages just under the page limit.
  const pageBody = Math.floor(PAGE_BYTES * 0.9);
  let added = 0,
    total = null;
  for (let i = 0; i < 20; i++) {
    const response = await post([
      {
        t: "addPage",
        id: "fill" + i,
        value: { id: "fill" + i, name: "Fill", nodes: [node("fill-node" + i, { text: filler(pageBody) })] },
      },
    ]);
    if (response.status === 413) {
      total = await response.json();
      break;
    }
    await data(response);
    added++;
  }
  assert.ok(total, "the document limit stops growth");
  assert.match(total.error, /room limit/);
  assert.equal(added, Math.floor((DOCUMENT_BYTES - 3_000_000) / pageBody));
  const sizes = (await data(await call(bigUrl + "?lazy=1", { token: bigRoom.token }))).pages;
  assert.ok(sizes.reduce((sum, p) => sum + p.bytes, 0) <= DOCUMENT_BYTES);
  // The stored page records survive a refused batch untouched.
  assert.equal(
    (await data(await call(bigUrl + "/pages?id=p1", { token: bigRoom.token }))).pages[0].nodes[1]
      .text.length,
    1_500_000,
  );

  // ---- public snapshot: a frozen copy assembled from the pages --------------------------------
  const publication = await data(await call(url + "/publish", { method: "POST", token: room.token }));
  const publicDoc = (await data(await call(`/api/public/${publication.publicId}`))).document;
  assert.deepEqual(publicDoc, expected);
  await data(
    await call(url + "/ops", {
      method: "POST",
      token: room.token,
      body: { client: "later", batch: 1, ops: [{ t: "page", page: "p1", key: "name", value: "Changed" }] },
    }),
  );
  assert.deepEqual(
    (await data(await call(`/api/public/${publication.publicId}`))).document,
    expected,
  );
  await mf.dispose();

  // ---- migration of rooms that stored the whole document in one row ------------------------
  const legacyRoom = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const jsonRoom = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const secret = "c".repeat(64);
  const legacyDoc = board();
  legacyDoc.pages[1].nodes.push(node("emoji", { type: "text", text: "😀".repeat(200_000) }));
  const stamp = Ops.createClock("legacy", () => Date.now() + 60_000).next();
  const fixture = await cloudOptions(state);
  const config = fixture.workers[0].config;
  config.manifest = {
    mainModule: "worker.js",
    modules: {
      "worker.js": {
        type: "esm",
        contents: await fs.readFile(
          new URL("./fixtures/design-room-whole-document.js", import.meta.url),
          "utf8",
        ),
      },
    },
  };
  config.env = { ROOMS: config.env.ROOMS };
  config.exports = { DesignRoom: { type: "durable-object", storage: "sqlite" } };
  mf = new Miniflare(fixture);
  const seed = (body) =>
    mf.dispatchFetch("http://local", { method: "POST", body: JSON.stringify(body) });
  const tokenHash = await digestHex(secret);
  await data(
    await seed({
      room: legacyRoom,
      document: legacyDoc,
      tokenHash,
      revision: 7,
      publicNonce: "d".repeat(64),
      stamps: { "n/c/x": stamp },
    }),
  );
  await data(await seed({ room: jsonRoom, document: { nodes: [1, 2] }, tokenHash, revision: 2 }));
  await mf.dispose();

  mf = new Miniflare(await cloudOptions(state));
  const migrated = await data(await call(`/api/rooms/${legacyRoom}`, { token: secret }));
  assert.equal(migrated.revision, 7);
  assert.equal(JSON.stringify(migrated.document), JSON.stringify(legacyDoc), "no data lost");
  const migratedLazy = await data(await call(`/api/rooms/${legacyRoom}?lazy=1`, { token: secret }));
  assert.deepEqual(migratedLazy.unloaded.sort(), ["p1", "p3"]);
  assert.equal(migratedLazy.document.pages[1].nodes[1].text, "😀".repeat(200_000));
  assert.deepEqual(
    (await data(await call(`/api/public/${legacyRoom}.${"d".repeat(64)}`))).document,
    legacyDoc,
    "the legacy public copy keeps serving",
  );
  // Stamps survive: an older edit of n/c/x loses, a node id on an unloaded page stays taken.
  const older = await data(
    await call(`/api/rooms/${legacyRoom}/ops`, {
      method: "POST",
      token: secret,
      body: {
        client: "after",
        batch: 1,
        ops: [
          { t: "node", page: "p2", id: "c", key: "x", value: 5, s: Ops.createClock("x").next() },
          { t: "add", page: "p2", id: "e", value: node("e") },
        ],
      },
    }),
  );
  assert.equal(older.rejected, 2);
  assert.equal(
    (await data(await call(`/api/rooms/${legacyRoom}`, { token: secret }))).revision,
    7,
  );
  assert.deepEqual(
    (await data(await call(`/api/rooms/${jsonRoom}`, { token: secret }))).document,
    { nodes: [1, 2] },
    "documents without pages migrate as one text",
  );
  // The migration runs once: an edit after it survives the next start.
  await data(
    await call(`/api/rooms/${legacyRoom}/ops`, {
      method: "POST",
      token: secret,
      body: { client: "after", batch: 2, ops: [{ t: "page", page: "p3", key: "name", value: "Old" }] },
    }),
  );
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(state));
  const restarted = await data(await call(`/api/rooms/${legacyRoom}`, { token: secret }));
  assert.equal(restarted.revision, 8);
  assert.equal(restarted.document.pages[2].name, "Old");
  assert.deepEqual(restarted.document.pages[1], legacyDoc.pages[1]);

  console.log(
    "PASS per-page room storage: page records with key order kept, lazy HTTP/socket snapshots, page fetches ordered with operations, edits on unloaded pages, node ids unique across unloaded pages, page/document limits, frozen public copy, idempotent migration of whole-document rooms (stamps, public copy, JSON documents)",
  );
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
