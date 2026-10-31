// Visual proof for the preview Edit / Capture modes (PM1, PM2, PM3, PM4, PM5, X2, PP2), framed like the Wonder captures:
// a 1512×982 preview at (418, 246) and 55% zoom, chat closed. Writes after/<id>-<state>.png at 1440×870 @2×.
//   npm run build:ui && node design/wonder/preview-audit/verynize/capture-edit.cjs
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const OUT = path.join(__dirname, "after");
const HTML = `<!doctype html><html><head><title>Sunbird</title><style>body{margin:0;padding:40px;font-family:system-ui;background:#f4f6fe;color:#172340}h1{margin:0 0 24px;font-size:36px}button,input{font:12px system-ui;display:block;margin-bottom:16px}input{padding:6px;width:120px}a{display:block;margin:0 0 16px 8px}</style></head><body><h1>Sunbird preview sandbox</h1><button>Count: 0</button><input placeholder="Type a message"><a href="/about/">About</a><svg width="122" height="76"><rect width="122" height="76" fill="#93b3f3"/><circle cx="60" cy="38" r="18" fill="#f5c460"/><path d="M76 34l14 4-14 4z" fill="#e8705c"/></svg></body></html>`;
(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vz-edit-proof-"));
  const server = http.createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(HTML); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ cwd: ROOT, env, args: [".", "--force-device-scale-factor=2", "--force-color-profile=srgb", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 870));
    await page.waitForFunction(() => !!window.livePreview && !!window.previewEdits);
    await page.waitForTimeout(500);
    const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + ".png") }); console.log("·", name); };
    await page.evaluate((url) => window.livePreview.show(url, { name: "Dipper" }), `http://127.0.0.1:${server.address().port}/`);
    const id = await page.evaluate(() => window.livePreview.getNodeId());
    await page.evaluate((id) => { window.design.updateNodes([id], { x: 418, y: 246, w: 1512, h: 982 }); window.design.setSelection([id]); }, id);
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await page.waitForTimeout(400);
    // 55% zoom with the frame where Wonder has it (screen x≈306, y≈158 for the body).
    await page.evaluate(() => { const wrap = document.getElementById("canvas-wrap").getBoundingClientRect(); const z = 0.55; window.design.setCamera(306 - wrap.left - 418 * z, 128 - wrap.top - 246 * z + 30, z); });
    const frame = page.frames().find((f) => f.name() === "verynize-live-preview");
    await frame.waitForSelector("h1");
    const toPage = async (selector, dx = 20) => {
      const box = await page.locator("#live-frame").boundingBox();
      const scale = await page.locator("#live-frame").evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
      const r = await frame.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }; }, selector);
      return { x: box.x + (r.x + dx) * scale, y: box.y + (r.y + r.h / 2) * scale };
    };
    await shot("PM1-toolbar");
    for (const [sel, name] of [["#preview-navigate", "navigate"], ["#preview-edit", "edit"], ["#live-capture", "capture"]]) {
      await page.mouse.move(700, 600); await page.waitForTimeout(250);
      await page.locator(sel).hover(); await page.waitForTimeout(700);
      await shot(`PM1-${name}-hover`);
    }
    await page.locator("#preview-more").click(); await shot("PM1-more-menu"); await page.keyboard.press("Escape");
    await page.locator("#preview-navigate").click(); await page.mouse.move(700, 700); await shot("PM2-navigate");
    await page.locator("#preview-edit").click(); await page.mouse.move(700, 700);
    const h1 = await toPage("h1");
    await page.mouse.move(h1.x, h1.y); await page.waitForFunction(() => window.previewEdits.hovered()?.tag === "h1"); await shot("PM3-hover");
    await page.mouse.click(h1.x, h1.y); await page.locator("#preview-element-inspector").waitFor();
    await page.locator("#live-preview .pedit-chat").hover(); await shot("PM3-select");
    const word = await frame.evaluate(() => { const n = document.querySelector("h1").firstChild, r = document.createRange(), i = n.textContent.indexOf("preview"); r.setStart(n, i + 2); r.setEnd(n, i + 3); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    const box = await page.locator("#live-frame").boundingBox(), scale = await page.locator("#live-frame").evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
    await page.mouse.dblclick(box.x + word.x * scale, box.y + word.y * scale);
    await frame.waitForFunction(() => getSelection().toString() === "preview");
    await shot("PM3-inspector");
    await page.keyboard.type("edited"); await page.keyboard.press("Escape");
    await page.waitForFunction((id) => window.previewEdits.count(id) === 1, id);
    await page.mouse.move(700, 760); await shot("PM3-edited");
    await page.locator("#live-preview [data-pe=preview-changes-badge]").click(); await page.locator("#preview-changes").waitFor(); await shot("X2-changes");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => { void window.previewEdits.confirmBeforeStop(id); }, id); await page.locator("#preview-discard-dialog").waitFor(); await shot("PP2-stopped");
    await page.locator("#preview-discard-keep").click();
    await page.locator("#preview-edit").click(); await page.locator("#preview-edit").click();
    await page.mouse.click(h1.x, h1.y); await page.locator("#live-preview .pedit-picked").waitFor();
    await page.keyboard.press("Meta+L"); await page.waitForTimeout(600); await shot("PM5-context");
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await page.evaluate((id) => window.design.setSelection([id]), id);
    await page.locator("#live-capture").click(); await page.mouse.move(h1.x, h1.y);
    await page.waitForFunction(() => window.previewEdits.target()?.tag === "h1"); await shot("PM4-capture");
    await page.mouse.click(h1.x, h1.y);
    await page.waitForFunction(() => window.design.getSelection().length === 1 && window.design.getDocument().pages.some((p) => p.nodes.some((n) => n.id === window.design.getSelection()[0] && n.type === "text")));
    await page.mouse.move(700, 760); await shot("PM4-result");
  } finally { await app.close(); server.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
