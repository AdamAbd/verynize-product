// Wait for the renderer's UI-ready signal (web/src/lib/bridge.ts, contract in web/src/islands/README.md):
// `<html data-ui-ready="true">` is set once every React island has committed its first render and every
// taken-over shell control id (#files-home, #add-page, …) belongs to the visible island element instead of the
// hidden legacy element parked in #bd-legacy-dock. Call it after launch and after every reload, before clicking
// shell/chrome/sidebar controls. On timeout the error names the islands and ids still pending.
async function waitForUiReady(page, { timeout = 20000 } = {}) {
  try {
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout,
    });
  } catch (error) {
    const pending = await page
      .evaluate(() => window.__bdPendingTakeovers?.() ?? "bridge not loaded")
      .catch((e) => String(e));
    error.message = `UI not ready: ${JSON.stringify(pending)}\n${error.message}`;
    throw error;
  }
}

module.exports = { waitForUiReady };
