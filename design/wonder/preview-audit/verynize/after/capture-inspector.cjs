// After-captures for the INSPECTOR preview-parity work (PF4 default size + presets, PF5 context menu, PF6 inspector,
// PF7 layer row). Serves the audit sandbox site (/tmp/preview-sandbox-vz, falls back to a tiny page) over localhost,
// opens it as a canvas preview frame and saves 1440×870 @2× PNGs next to this file.
//
//   npm run build:ui && node design/wonder/preview-audit/verynize/after/capture-inspector.cjs
const ROOT = require("node:path").resolve(__dirname, "../../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const SANDBOX = "/tmp/preview-sandbox-vz";
const TYPES = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".js": "text/javascript" };

(async () => {
  const server = http.createServer(async (req, res) => {
    let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    try {
      const body = await fs.readFile(path.join(SANDBOX, path.normalize(file)));
      res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
      res.end(body);
    } catch {
      res.setHeader("content-type", "text/html");
      res.end("<h1>Preview sandbox</h1><button>Count: 0</button>");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://localhost:${server.address().port}/`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vz-pp-inspector-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ cwd: ROOT, env, args: [".", "--force-device-scale-factor=2", "--force-color-profile=srgb", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 870));
    await page.waitForFunction(() => !!window.livePreview && !!window.previewPresets);
    await page.waitForTimeout(500);
    const shot = (name) => page.screenshot({ path: path.join(__dirname, name + ".png") });
    const wait = (ms) => page.waitForTimeout(ms);
    await page.evaluate((url) => window.livePreview.show(url, { root: "/tmp/preview-sandbox-vz", name: "preview-sandbox" }), url);
    await wait(1500);
    // Wonder's PF6 framing: zoom 55 % with the frame left of centre.
    await page.evaluate(() => {
      const n = window.design.getDocument().pages.flatMap((p) => p.nodes).find((n) => n.preview);
      window.design.setCamera(30 - n.x * 0.55, 120 - n.y * 0.55, 0.55);
    });
    await page.mouse.move(1435, 450);
    await wait(400);
    await shot("PF6-inspector");
    await shot("PF7-layers");
    await page.locator("#screen-template").click();
    await wait(400);
    await shot("PF4-presets");
    await page.locator('#screen-template-menu [data-preset="iPhone 17"]').click();
    await wait(800);
    await page.mouse.move(1435, 450);
    await shot("PF4-resize");
    await page.locator("#screen-template").click();
    await wait(300);
    await page.locator(`#screen-template-menu [data-preset='MacBook Pro 14"']`).click();
    await wait(800);
    const box = await page.locator("#live-frame").boundingBox();
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.4, { button: "right" });
    await wait(400);
    await shot("PF5-context");
    console.log("saved PF4-presets, PF4-resize, PF5-context, PF6-inspector, PF7-layers");
  } finally {
    await app.close();
    server.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
