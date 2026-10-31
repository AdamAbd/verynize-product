// Plain-browser smoke test of the platform layer (web/platform.js, web/src/lib/platform.ts): web/ served by a tiny
// static server with the SPA fallback the Worker uses (extensionless paths → index.html), loaded in Chromium with no
// preload, so there is no window.desktop. The runtime reports kind 'web' with no capabilities, the editor still loads
// a document through the shared schema, desktop-only entry points keep their "open the desktop app" behaviour, and
// the page throws nothing. Browser: Playwright's Chromium, else the installed Chrome, else an Electron window
// without a preload (still plain Chromium; the test fails if window.desktop exists).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium, _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

const webRoot = path.join(__dirname, "..", "web");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // No backend here: the cloud API answers 404 like an unreachable server would.
    if (url.pathname.startsWith("/api/"))
      return res
        .writeHead(404, { "content-type": "application/json" })
        .end('{"error":"not found"}');
    let file = path.join(webRoot, decodeURIComponent(url.pathname));
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot) return res.writeHead(403).end();
    if (!path.extname(file) || url.pathname === "/") file = path.join(webRoot, "index.html");
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      res
        .writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" })
        .end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function openBrowser(url) {
  // VERYNIZE_WEB_SMOKE_ELECTRON=1 skips straight to the Electron fallback.
  for (const options of process.env.VERYNIZE_WEB_SMOKE_ELECTRON
    ? []
    : [{}, { channel: "chrome" }]) {
    try {
      const browser = await chromium.launch({ ...options, headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 870 } });
      return { page, close: () => browser.close(), label: options.channel || "chromium" };
    } catch {
      /* try the next browser */
    }
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-web-"));
  const env = { ...process.env, VERYNIZE_PLAIN_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [path.join(__dirname, "fixtures/plain-window.cjs"), `--user-data-dir=${userData}`],
    env,
  });
  const page = await app.firstWindow();
  return { page, close: () => app.close(), label: "electron without preload" };
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  const browser = await openBrowser(origin + "/editor");
  const { page } = browser;
  try {
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    if (page.url() !== origin + "/editor") await page.goto(origin + "/editor");
    await waitForUiReady(page);

    // Runtime: plain web, nothing desktop.
    const runtime = await page.evaluate(() => ({
      desktop: typeof window.desktop,
      kind: window.verynizePlatform.kind,
      bridge: window.verynizePlatform.desktop,
      capabilities: Object.entries(window.verynizePlatform.capabilities)
        .filter(([, on]) => on)
        .map(([name]) => name),
      can: window.verynizePlatform.can("projects"),
      frozen: Object.isFrozen(window.verynizePlatform),
    }));
    assert.deepEqual(runtime, {
      desktop: "undefined",
      kind: "web",
      bridge: null,
      capabilities: [],
      can: false,
      frozen: true,
    });

    // The editor loads and edits through the shared schema (web/document-core.js).
    const editor = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push({
        id: "smoke",
        type: "rectangle",
        name: "Smoke",
        x: 10,
        y: 10,
        w: 40,
        h: 40,
      });
      window.design.loadDocument(d);
      let rejected = "";
      try {
        window.design.loadDocument({
          ...d,
          pages: [
            {
              id: "x",
              name: "X",
              nodes: [{ id: "n", type: "rectangle", name: "N", x: 0, y: 0, w: 0, h: 10 }],
            },
          ],
        });
      } catch (error) {
        rejected = error.message;
      }
      return {
        schema: typeof window.VerynizeDocument?.validateDocument,
        version: d.version,
        smoke: !!window.design.getDocument().pages[0].nodes.find((n) => n.id === "smoke"),
        rejected,
        layer: !!document.querySelector('#canvas [data-id="smoke"]'),
      };
    });
    assert.deepEqual(editor, {
      schema: "function",
      version: 2,
      smoke: true,
      rejected: "Invalid node w",
      layer: true,
    });

    // Desktop-only entry points keep their web behaviour.
    assert.equal(
      await page.locator("#project-agent-status").textContent(),
      "Open the desktop app to use project files and local agents.",
    );
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("onboarding-open")),
      false,
      "no desktop onboarding on the web",
    );
    const notes = await page.evaluate(async () => {
      const $ = (id) => document.getElementById(id);
      const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
      $("figma-run").click();
      await settle();
      $("generate-run").click();
      await settle();
      $("capture-web-url").value = "https://example.com/";
      $("capture-web-form").requestSubmit();
      await settle();
      $("cloud-app-section").open = true;
      await settle();
      return {
        figma: $("figma-status").textContent,
        generate: $("generate-status").textContent,
        capture: $("capture-web-status").textContent,
        publish: $("cloud-app-project").textContent,
      };
    });
    assert.deepEqual(notes, {
      figma: "Open the desktop app to import from Figma.",
      generate: "Open the desktop app to generate images.",
      capture: "Open the desktop app to capture web pages.",
      publish: "App publishing runs in the Verynize desktop app.",
    });
    await page.evaluate(() => window.appSettings.open("agents"));
    await page.locator("#settings-screen").getByText("Desktop app required").waitFor();
    await page.evaluate(() => window.appSettings.close());

    assert.deepEqual(errors, [], "no page errors");
    console.log(`web platform smoke (${browser.label}): PASS`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
