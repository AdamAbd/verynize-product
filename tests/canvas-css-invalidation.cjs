const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { synthetic } = require("../eval/canvas-perf/bench-verynize.cjs");
const install = require("../eval/canvas-perf/renderer.cjs");
const { checkSource } = require("../scripts/check-css-has.cjs");

(async () => {
  for (const variant of [
    "focus",
    "focus-visible",
    "focus-within",
    "hover",
    "active",
    "checked",
    "disabled",
  ]) {
    for (const prefix of ["has-", "group-has-", "peer-has-"]) {
      assert.equal(checkSource(`${prefix}${variant}/named:opacity-0`).length, 1);
      assert.equal(checkSource(`${prefix}[:${variant}]:opacity-0`).length, 1);
    }
  }
  assert.equal(
    checkSource("group-focus-within/chip:opacity-0 has-[>svg]:px-2 has-data-[slot=action]:flex")
      .length,
    0,
  );
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-css-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.evaluate(install);
    await page.evaluate((doc) => __perf.action("load", doc), synthetic(500));
    const result = await page.evaluate(() => {
      const offenders = [];
      let selectors = 0;
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.selectorText) {
            selectors++;
            if (/:has\(\s*:focus/.test(rule.selectorText)) offenders.push(rule.selectorText);
          }
          if (rule.cssRules) walk(rule.cssRules);
          if (rule.styleSheet) walk(rule.styleSheet.cssRules);
        }
      };
      // Fail on unreadable sheets too: silently skipping one would weaken this regression gate.
      for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets])
        walk(sheet.cssRules);
      return { offenders, selectors, nodes: document.querySelectorAll("#canvas .layer").length };
    });
    assert.equal(result.nodes, 500);
    assert.ok(result.selectors > 100, "inspect the loaded production stylesheets");
    assert.deepEqual(
      result.offenders,
      [],
      "no focus :has() selectors in loaded CSSOM, including nested rules",
    );
    // Keyboard focus on the row itself must expose its actions (old :has() only saw descendants).
    const row = page.locator(".layer-row").first();
    await row.focus();
    assert.equal(await row.locator("button").last().isVisible(), true);
    console.log("canvas-css-invalidation: ok");
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
