// Smoke test of the Node build of the web app (vite.node.config.ts + web-start/node/server.mjs):
// it serves /editor and the legacy editor boots in Chromium; web/ files are served and web/src is
// not; backend paths and room WebSocket upgrades are forwarded to VERYNIZE_BACKEND_URL (a stub
// backend here); without a backend they answer 502.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createWebServer } from "../web-start/node/server.mjs";
import { launchBrowser } from "./helpers/web-app.mjs";
import { checkWebRouter } from "./helpers/web-router.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = fileURLToPath(new URL("../dist/web-node", import.meta.url));
if (!fs.existsSync(new URL("../web/dist/ui.js", import.meta.url)))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
execFileSync(
  process.execPath,
  ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
  {
    cwd: root,
    stdio: "pipe",
  },
);

// Stub backend: echoes HTTP requests and speaks just enough WebSocket to send one text frame.
const backend = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
    res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, body }));
  });
});
const upgraded = new Set();
backend.on("upgrade", (req, socket) => {
  upgraded.add(socket);
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const text = Buffer.from(JSON.stringify({ type: "hello", url: req.url }));
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  socket.on("error", () => {});
});
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

let browser;
const backendPort = await listen(backend);
const web = await createWebServer({ dist, backend: `http://127.0.0.1:${backendPort}` });
const bare = await createWebServer({ dist });
try {
  const origin = `http://127.0.0.1:${await listen(web)}`;
  const get = (route, init) => fetch(origin + route, { redirect: "manual", ...init });

  for (const route of ["/", "/editor", "/settings/preferences"]) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(await response.text(), /id="canvas"/, route);
  }
  const css = await get("/style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const font = await get("/assets/fonts/inter-latin-400-normal.woff2");
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("cache-control"), "no-cache");
  for (const route of ["/src/ui.tsx", "/storage-migration.html", "/no-such-page"])
    assert.equal((await get(route)).status, 404, route);
  assert.equal((await get("/index.html")).status, 302);

  const echoed = await get("/api/rooms?x=1", { method: "POST", body: "payload" });
  assert.equal(echoed.status, 200);
  assert.deepEqual(echoed.headers.getSetCookie(), ["a=1", "b=2"]);
  assert.deepEqual(await echoed.json(), {
    method: "POST",
    url: "/api/rooms?x=1",
    host: `127.0.0.1:${backendPort}`,
    body: "payload",
  });
  assert.equal((await (await get("/u/someone")).json()).url, "/u/someone");

  const message = await new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace("http", "ws") + "/api/rooms/r1/socket?token=t");
    const timer = setTimeout(
      () => reject(new Error("no message through the proxied socket")),
      5000,
    );
    ws.onerror = () => reject(new Error("proxied socket failed"));
    ws.onmessage = (event) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(event.data));
    };
  });
  assert.deepEqual(message, { type: "hello", url: "/api/rooms/r1/socket?token=t" });

  const bareOrigin = `http://127.0.0.1:${await listen(bare)}`;
  assert.equal((await fetch(bareOrigin + "/api/rooms")).status, 502);
  assert.equal((await fetch(bareOrigin + "/editor")).status, 200);

  browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/editor");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  assert.equal(await page.evaluate(() => window.shellRouter.state.location.pathname), "/editor");
  await page.waitForSelector("#canvas .layer");
  const before = await page.locator("#canvas .layer").count();
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#rectangle").click();
  assert.equal(await page.locator("#canvas .layer").count(), before + 1);
  assert.deepEqual(errors, []);
  await page.close();
  await checkWebRouter(browser, origin);
  console.log(
    "PASS web (Node build): /editor boots client-only, one router (clicks, Back/Forward, deep links, room fragment), static web/ files without web/src, /api and room WebSocket forwarded to the backend",
  );
} finally {
  await browser?.close();
  for (const socket of upgraded) socket.destroy();
  for (const server of [web, bare, backend]) {
    server.closeAllConnections?.();
    server.close();
  }
}
