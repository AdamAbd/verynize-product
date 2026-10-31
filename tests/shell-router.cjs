const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/shell-router-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    // Desktop serves the renderer from app://verynize, so routes own the real URL path.
    assert.equal(await page.evaluate(() => location.origin), "app://verynize");
    const ipcWorks = () =>
      page.evaluate(() => window.desktop.onboardingState().then((s) => s.skip === true));
    const documentBefore = await page.evaluate(() => window.design.getDocument());
    const expectView = async (path) => {
      await page.waitForFunction(
        (path) =>
          window.shellRouter.state.location.pathname === path &&
          location.pathname === path &&
          document.body.classList.contains("files-view") === (path === "/"),
        path,
      );
    };
    await expectView("/editor");
    await page.locator("#files-home").click();
    await expectView("/");
    await page.locator(".file-open").first().click();
    await expectView("/editor");
    await page.evaluate(() => window.shellRouter.history.back());
    await expectView("/");
    await page.evaluate(() => window.shellRouter.history.forward());
    await expectView("/editor");
    await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
    await expectView("/");
    await page.keyboard.press("Escape");
    await expectView("/editor");
    // Repeated legacy calls must not create duplicate entries.
    const length = await page.evaluate(() => window.shellRouter.history.length);
    await page.evaluate(() => {
      window.fileLibrary.showEditor();
      window.fileLibrary.showEditor();
    });
    assert.equal(await page.evaluate(() => window.shellRouter.history.length), length);
    assert.equal(new URL(page.url()).pathname, "/editor");
    assert.ok(await ipcWorks(), "IPC after route changes");
    assert.deepEqual(await page.evaluate(() => window.design.getDocument()), documentBefore);
    for (const hash of ["#room=router-test&token=a%2Fb%3D", "#public=router-test"]) {
      await page.evaluate((hash) => {
        location.hash = hash;
        window.fileLibrary.showHome();
      }, hash);
      await expectView("/");
      // The legacy flow carries the hash along; router navigations must opt in with hash: true.
      await page.evaluate(() => window.fileLibrary.showEditor());
      await expectView("/editor");
      assert.equal(new URL(page.url()).hash, hash);
      await page.evaluate(() => window.shellRouter.navigate({ to: "/", hash: true }));
      await expectView("/");
      assert.equal(new URL(page.url()).hash, hash);
    }
    // A reload on a route lands on the same view, with IPC still trusted.
    await page.evaluate(() => {
      location.hash = "";
      window.fileLibrary.showHome();
    });
    await expectView("/");
    await page.reload();
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectView("/");
    await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
    await expectView("/editor");
    await page.reload();
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectView("/editor");
    assert.ok(await ipcWorks(), "IPC after reloading /editor");
    console.log(
      "PASS shell router: app:// browser history, URL path sync, reload on routes, route/view sync, Back/Forward, Escape, deduplication, document and cloud hash preservation",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
