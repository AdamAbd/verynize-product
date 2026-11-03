// Title-bar file tabs in the desktop window: every opened file keeps a tab, a click on any tab switches files (the
// bar is a window drag region, so tabs must opt out), drag reorders the strip, and the + opens the file switcher.
const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/bd-file-tabs-");
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(page);
    for (const name of ["Alpha", "Beta"])
      await page.evaluate(async (name) => {
        const doc = window.design.getDocument();
        doc.name = name;
        await window.fileLibrary.createFromDocument(doc);
      }, name);
    const names = () =>
      page
        .locator("[data-file-tab]:visible")
        .evaluateAll((tabs) =>
          tabs.map((tab) => tab.querySelector("input")?.value ?? tab.textContent.trim()),
        );
    const tab = (name) =>
      page.locator("[data-file-tab]:visible").filter({ has: page.locator(`text="${name}"`) });
    const current = () => page.evaluate(() => window.design.getDocument().name);
    assert.deepEqual((await names()).slice(-2), ["Alpha", "Beta"]);

    // Any tab is clickable while another one is active, and is not part of the window drag region.
    assert.equal(
      await page
        .locator("[data-file-tab]:not([data-document-tab])")
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region")),
      "no-drag",
    );
    await tab("Alpha").click();
    await page.waitForFunction(() => window.design.getDocument().name === "Alpha");
    await page
      .locator("[data-file-tab]:visible:not([data-document-tab])")
      .filter({ hasText: "Beta" })
      .click();
    await page.waitForFunction(() => window.design.getDocument().name === "Beta");
    assert.equal(await current(), "Beta");

    // Drag Beta in front of Alpha: the strip reorders and keeps the order after a reload.
    const before = await names();
    const alpha = page
      .locator("[data-file-tab]:visible:not([data-document-tab])")
      .filter({ hasText: "Alpha" });
    const box = await alpha.boundingBox();
    await page
      .locator("[data-document-tab]")
      .dragTo(alpha, { targetPosition: { x: 4, y: box.height / 2 } });
    const after = await names();
    assert.equal(
      after.indexOf("Beta"),
      after.indexOf("Alpha") - 1,
      `dragged: ${before} → ${after}`,
    );
    await page.reload();
    await waitForUiReady(page);
    assert.deepEqual(await names(), after, "order survives a reload");

    // + opens the file switcher.
    await page.locator("#shell-new-file").click();
    await page.locator("#file-switcher [data-switcher-new]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#file-switcher").waitFor({ state: "detached" });
    console.log(
      "PASS file tabs: one tab per file, click any tab (no-drag), drag to reorder (persists), + file switcher",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
