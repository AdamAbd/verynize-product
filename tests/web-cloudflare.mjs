// Browser test of the Cloudflare web app (web-start) in local workerd, run twice: against
// `vp dev`, and against the deployable build (`vp build`, the output `cf deploy --prebuilt` uploads)
// served by `vp preview`. Chromium loads /editor and /settings/preferences: the legacy editor boots client-only, the
// router resolves, /api/* reaches cloud/worker.js, a room WebSocket connects to the Durable Object,
// and web/src is not served. Uses Playwright's Chromium, or installed Chrome when that is missing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, startProcess, freePort } from "./helpers/web-app.mjs";
import { checkWebRouter } from "./helpers/web-router.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = await fs.mkdtemp(path.join(os.tmpdir(), "web-cloudflare-"));
const vp = (...args) => [process.execPath, ["node_modules/vite-plus/bin/vp", ...args]];
let browser;
try {
  // Local D1 for the dev server, the same way docs/deployment.md describes it.
  execFileSync(process.execPath, ["scripts/db-migrate.mjs", "--local", "--persist-to", state], {
    cwd: root,
    stdio: "pipe",
  });
  if (!(await fs.stat(path.join(root, "web/dist/ui.js")).catch(() => null)))
    execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
  browser = await launchBrowser();
  await check("dev");
  execFileSync(...vp("build"), { cwd: root, stdio: "pipe" });
  await check("preview");
} finally {
  await browser?.close();
  await fs.rm(state, { recursive: true, force: true });
}

async function check(mode) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const server = await startProcess(...vp(mode, "--port", String(port), "--strictPort"), {
    cwd: root,
    env: { ...process.env, VERYNIZE_CF_STATE: state },
    ready: origin + "/",
  });
  try {
    await checkApp(origin);
    await checkWebRouter(browser, origin);
  } finally {
    await server.stop();
  }
  console.log(
    `PASS web (Cloudflare ${mode}): client-only editor boot, rectangle added, shell routes, one router (clicks, Back/Forward, deep links, room fragment), /api via worker, room WebSocket, web/src not served`,
  );
}

async function checkApp(origin) {
  // Server-side routing.
  const get = (route, init) => fetch(origin + route, { redirect: "manual", ...init });
  for (const route of ["/", "/editor", "/settings/preferences", "/code"]) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /<html lang="en">/, route);
    // The editor is never server-rendered: no editor markup in the document.
    assert.doesNotMatch(html, /id="canvas"/, route);
  }
  for (const route of ["/src/ui.tsx", "/src/lib/bridge.ts", "/src/islands/README.md"]) {
    const response = await get(route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(await response.text(), /import |export /, route);
  }
  assert.equal((await get("/style.css")).status, 200);
  assert.equal((await get("/dist/ui.js")).status, 200);
  assert.equal((await get("/storage-migration.html")).status, 404);
  const legacyIndex = await get("/index.html?x=1");
  assert.equal(legacyIndex.status, 302);
  assert.equal(new URL(legacyIndex.headers.get("location"), origin).href, origin + "/?x=1");
  const apiMissing = await get("/api/does-not-exist");
  assert.equal(apiMissing.status, 404);
  assert.deepEqual(await apiMissing.json(), { error: "Not found" });
  assert.equal((await get("/no-such-page")).status, 404);

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(origin + "/editor");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
  assert.equal(await page.evaluate(() => window.shellRouter.state.location.pathname), "/editor");
  assert.equal(await page.evaluate(() => document.body.classList.contains("files-view")), false);
  // Legacy markup sits directly in <body>, before Start's nodes, and the scripts ran in order.
  assert.equal(
    await page.evaluate(() => document.querySelector("body > header.app-chrome") !== null),
    true,
  );
  assert.equal(await page.evaluate(() => typeof window.design?.getDocument), "function");
  await page.waitForSelector("#canvas .layer");
  const layers = () => page.locator("#canvas .layer").count();
  const before = await layers();
  assert.ok(before > 0, "canvas renders the starter layers");
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#rectangle").click();
  assert.equal(await layers(), before + 1);
  assert.equal(
    await page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .some((n) => n.type === "rectangle"),
    ),
    true,
  );

  // Shell navigation keeps the editor mounted (one boot, same layers) and moves the URL.
  await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
  await page.waitForFunction(
    () => location.pathname === "/" && document.body.classList.contains("files-view"),
  );
  await page.goBack();
  await page.waitForFunction(
    () => location.pathname === "/editor" && !document.body.classList.contains("files-view"),
  );
  assert.equal(await layers(), before + 1);

  // Cloud API and room WebSocket from the page's origin.
  const socket = await page.evaluate(async () => {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { nodes: [] } }),
    });
    const room = await response.json();
    const url = new URL(`/api/rooms/${room.id}/socket?token=${room.token}`, location.href);
    url.protocol = url.protocol.replace("http", "ws");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("no presence over the room socket")), 8000);
      ws.onerror = () => reject(new Error("room socket failed"));
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "presence", name: "Web test", cursor: { x: 1, y: 2 } }));
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type !== "presence" || !message.peers.some((peer) => peer.name === "Web test"))
          return;
        clearTimeout(timer);
        ws.close();
        resolve({ status: response.status, type: message.type });
      };
    });
  });
  assert.deepEqual(socket, { status: 201, type: "presence" });

  // A fresh load of a settings deep link opens the legacy settings overlay.
  await page.goto(origin + "/settings/preferences");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      window.shellRouter?.state.location.pathname === "/settings/preferences" &&
      document.body.classList.contains("settings-open"),
  );
  assert.equal(await page.locator("#settings-screen").isVisible(), true);
  assert.equal(await page.evaluate(async () => (await fetch("/src/ui.tsx")).status), 404);
  assert.deepEqual(errors, []);
  await page.close();
}
