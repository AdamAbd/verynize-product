// Shared browser check of navigation in the web app (web-start), run against every web target.
// Start's router is the page's only router: the legacy shell router runs hosted on it
// (web-start/src/legacy/shell-host.ts). Checks UI clicks, app navigation and Back/Forward between
// /, /editor, /code and /settings/<section>; that the editor never remounts; that Start's router
// location always matches the address bar and Back/Forward move exactly one entry; deep links; and
// that the #room= fragment survives navigation.
import assert from "node:assert/strict";

const ROOM = "11111111-1111-4111-8111-111111111111";
const INVITE = `#room=${ROOM}&token=${"ab".repeat(32)}`;

export async function checkWebRouter(browser, origin) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = async () => {
    await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 20000,
    });
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
  };
  // Address bar, Start's router, history entry and the legacy views.
  const state = () =>
    page.evaluate(() => {
      const routed = window.shellRouter.state.location;
      return {
        path: location.pathname,
        hash: location.hash,
        routerHref: routed.pathname + routed.searchStr + (routed.hash ? `#${routed.hash}` : ""),
        index: history.state?.__TSR_index,
        length: history.length,
        home: document.body.classList.contains("files-view"),
        code: document.body.classList.contains("code-mode"),
        settings: document.body.classList.contains("settings-open"),
        section: window.appSettings.getState().section,
      };
    });
  // Waits until the URL, Start's router (resolved, same href) and the views agree on `path`.
  const expectShell = async (path, { home = path === "/", code = path === "/code" } = {}) => {
    await page.waitForFunction(
      ({ path, home, code }) => {
        const routed = window.shellRouter.state.location;
        const settings = path.startsWith("/settings/");
        const body = document.body.classList;
        return (
          window.shellRouter.state.status === "idle" &&
          location.pathname === path &&
          routed.pathname + routed.searchStr + (routed.hash ? `#${routed.hash}` : "") ===
            location.pathname + location.search + location.hash &&
          body.contains("settings-open") === settings &&
          (!settings || window.appSettings.getState().section === path.slice(10)) &&
          body.contains("files-view") === home &&
          body.contains("code-mode") === code
        );
      },
      { path, home, code },
    );
    return state();
  };
  const back = () => page.goBack({ waitUntil: "commit" });

  await page.goto(origin + "/editor");
  await ready();

  // One router and one history on the page: the shell router is Start's router.
  assert.equal(
    await page.evaluate(
      () =>
        window.verynizeShellHost !== undefined &&
        window.shellRouter === window.verynizeShellHost.router &&
        window.shellRouter.history === window.verynizeShellHost.router.history,
    ),
    true,
    "the shell router runs hosted on Start's router",
  );
  // Markers that a remount would lose: the canvas element, a window property, one boot.
  await page.evaluate(() => {
    window.__routerMarker = "kept";
    window.__routerCanvas = document.getElementById("canvas");
  });
  const mounted = () =>
    page.evaluate(() => ({
      marker: window.__routerMarker,
      canvas: window.__routerCanvas === document.getElementById("canvas"),
      appScripts: document.querySelectorAll('script[src$="app.js"]').length,
      layouts: document.querySelectorAll("#canvas").length,
    }));
  const MOUNTED = { marker: "kept", canvas: true, appScripts: 1, layouts: 1 };

  const start = await expectShell("/editor");
  // UI click: Files home pushes one entry.
  await page.locator("#files-home").click();
  let at = await expectShell("/");
  assert.equal(at.index, start.index + 1, "Files pushes one entry");
  assert.equal(at.length, start.length + 1, "one history entry per navigation");
  // Back goes exactly one step, Forward returns.
  await back();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back moves one entry");
  await page.goForward({ waitUntil: "commit" });
  at = await expectShell("/");
  assert.equal(at.index, start.index + 1, "Forward moves one entry");
  await back();
  await expectShell("/editor");

  // Settings from the app menu: opening pushes one entry, a section click replaces it, Back to app
  // returns to the entry it was opened from.
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#shell-settings").click();
  at = await expectShell("/settings/preferences", { home: false });
  assert.equal(at.index, start.index + 1, "opening settings pushes one entry");
  const other = await page.evaluate(() => {
    const button = [...document.querySelectorAll("#settings-nav button")].find(
      (b) => b.offsetParent !== null && !/preferences/i.test(b.textContent),
    );
    return button?.textContent.trim();
  });
  assert.ok(other, "another settings section to click");
  await page.locator("#settings-nav button").filter({ hasText: other }).first().click();
  await page.waitForFunction(() => location.pathname !== "/settings/preferences");
  const section = await page.evaluate(() => location.pathname);
  at = await expectShell(section);
  assert.equal(at.index, start.index + 1, "switching sections replaces the entry");
  await back();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back closes settings in one step");
  await page.goForward({ waitUntil: "commit" });
  await expectShell(section);
  await page.locator("#settings-back").click();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back to app adds no entry");
  assert.equal(at.length, start.length + 1, "only one forward entry exists");

  // Code workspace through app navigation (Start's router), then Back/Forward.
  await page.evaluate(() => window.shellNavigation.navigate({ to: "/code" }));
  at = await expectShell("/code");
  assert.equal(at.index, start.index + 1);
  await back();
  await expectShell("/editor");
  await page.goForward({ waitUntil: "commit" });
  await expectShell("/code");
  // Legacy request from code mode to the Files home, then Back to code.
  await page.evaluate(() => window.fileLibrary.showHome());
  at = await expectShell("/");
  assert.equal(at.index, start.index + 2);
  await back();
  await expectShell("/code");
  await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
  await expectShell("/editor");
  assert.deepEqual(await mounted(), MOUNTED, "the editor never remounts");

  // Reload keeps settings over the view it was opened from (history state), and Back returns to it.
  await page.locator("#files-home").click();
  const home = await expectShell("/");
  await page.evaluate(() => window.appSettings.open("account"));
  at = await expectShell("/settings/account", { home: true });
  assert.equal(at.index, home.index + 1);
  await page.reload();
  await ready();
  at = await expectShell("/settings/account", { home: true });
  assert.equal(at.index, home.index + 1, "reload keeps the entry");
  await back();
  at = await expectShell("/");
  assert.equal(at.index, home.index);

  // Deep links render the right area (fresh loads, no history state).
  for (const [url, path, options] of [
    ["/", "/", {}],
    ["/code", "/code", {}],
    ["/settings/account", "/settings/account", {}],
    ["/settings", "/settings/preferences", {}],
    ["/settings/nope", "/settings/preferences", {}],
  ]) {
    await page.goto(origin + url);
    await ready();
    await expectShell(path, options);
  }

  // The room fragment stays client-side and survives every kind of navigation.
  await page.goto(origin + "/editor" + INVITE);
  await ready();
  await expectShell("/editor");
  await page.waitForFunction(() => document.getElementById("cloud-dialog")?.open);
  await page.evaluate(() => document.getElementById("cloud-dialog").close());
  const withInvite = await state();
  assert.equal(withInvite.hash, INVITE);
  await page.locator("#files-home").click();
  at = await expectShell("/");
  assert.equal(at.hash, INVITE, "UI navigation keeps the fragment");
  await page.evaluate(() => window.shellNavigation.navigate({ to: "/code" }));
  at = await expectShell("/code");
  assert.equal(at.hash, INVITE, "router navigation keeps the fragment");
  await page.evaluate(() => window.appSettings.open("account"));
  at = await expectShell("/settings/account", { code: true });
  assert.equal(at.hash, INVITE, "settings keeps the fragment");
  await back();
  at = await expectShell("/code");
  assert.equal(at.hash, INVITE);
  await back();
  at = await expectShell("/");
  assert.equal(at.hash, INVITE, "Back keeps the fragment");
  // Navigating to the current path adds no entry even though the fragment is kept.
  await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
  assert.deepEqual(await state(), at);
  // Leaving the room drops it in place.
  await page.evaluate((room) => window.shellNavigation.clearRoomHash(room), ROOM);
  await page.waitForFunction(() => location.hash === "");
  at = await expectShell("/");
  assert.equal(at.hash, "");

  assert.deepEqual(errors, []);
  await page.close();
}
