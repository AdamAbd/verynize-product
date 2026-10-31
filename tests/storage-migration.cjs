// desktop/storage-migration.cjs recovery: when an earlier copy failed (pending marker), the editor ran
// on an empty app://verynize origin and wrote its first-run defaults there. The retry must restore the
// user's file:// data over those defaults and keep the replaced app:// values in a backup file.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { MARKER, REPLACED, readMarker } = require("../desktop/storage-migration.cjs");

const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const launch = (profile) => electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
const FILE_PAGE = pathToFileURL(path.resolve("web/storage-migration.html")).href;

async function editor(app) {
  for (let i = 0; i < 200; i++) {
    const page = app
      .windows()
      .find(
        (p) =>
          p.url().startsWith("app://verynize/") && !p.url().endsWith("/storage-migration.html"),
      );
    if (page) {
      await page.waitForFunction(() => !!window.desktop && document.readyState === "complete");
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("The editor window did not open");
}

/** Sets localStorage entries on a given origin through a hidden window of the running app. */
const seed = (app, url, entries) =>
  app.evaluate(
    async ({ BrowserWindow }, { url, entries }) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await win.loadURL(url);
      await win.webContents.executeJavaScript(
        `(${JSON.stringify(entries)}).forEach(([k, v]) => localStorage.setItem(k, v))`,
        true,
      );
      win.destroy();
    },
    { url, entries },
  );

async function unitChecks() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-marker-"));
  try {
    const file = path.join(dir, MARKER);
    assert.equal(await readMarker(file), null, "no marker");
    await fs.writeFile(file, '{"pending":true,"attempts":2}');
    assert.deepEqual(await readMarker(file), { pending: true, attempts: 2 });
    await fs.writeFile(file, "{not json");
    assert.deepEqual(await readMarker(file), { unreadable: true }, "garbage counts as done");
    await fs.writeFile(file, "null");
    assert.deepEqual(await readMarker(file), { unreadable: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function recoveryChecks(profile) {
  const library = JSON.stringify({ files: [{ id: "a" }, { id: "b" }, { id: "c" }], folders: [] });
  const defaults = JSON.stringify({ files: [{ id: "default" }], folders: [] });
  // 1. Fresh launch, then simulate the state a failed first copy leaves behind: the user's data on
  //    file://, first-run defaults on app://, and a pending marker.
  let app = await launch(profile);
  try {
    const page = await editor(app);
    await page.evaluate(() => localStorage.setItem("verynize-recovery-session", "new in app"));
    await seed(app, FILE_PAGE, [
      ["verynize-recovery-library", library],
      ["verynize-recovery-same", "same"],
      ["verynize-recovery-only-file", "file"],
    ]);
    await seed(app, "app://verynize/storage-migration.html", [
      ["verynize-recovery-library", defaults],
      ["verynize-recovery-same", "same"],
    ]);
  } finally {
    await app.close();
  }
  await fs.writeFile(path.join(profile, MARKER), JSON.stringify({ pending: true, attempts: 1 }));
  // 2. The retry restores the file:// values and backs up what it replaced.
  app = await launch(profile);
  try {
    const page = await editor(app);
    const values = await page.evaluate(() =>
      Object.fromEntries(
        [
          "verynize-recovery-library",
          "verynize-recovery-same",
          "verynize-recovery-only-file",
          "verynize-recovery-session",
        ].map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    assert.equal(values["verynize-recovery-library"], library, "file:// data wins over defaults");
    assert.equal(values["verynize-recovery-same"], "same");
    assert.equal(values["verynize-recovery-only-file"], "file");
    assert.equal(values["verynize-recovery-session"], "new in app", "app-only keys are kept");
    const record = await readMarker(path.join(profile, MARKER));
    assert.equal(record.pending, undefined, JSON.stringify(record));
    assert.equal(record.recovered, true);
    assert.ok(record.replaced >= 1 && record.failed === 0, JSON.stringify(record));
    const backup = JSON.parse(await fs.readFile(path.join(profile, REPLACED), "utf8"));
    assert.equal(backup.local["verynize-recovery-library"], defaults, "replaced value is saved");
    assert.equal("verynize-recovery-same" in backup.local, false, "equal values are not replaced");
    assert.equal((await fs.stat(path.join(profile, REPLACED))).mode & 0o077, 0, "backup is 0600");
  } finally {
    await app.close();
  }
  // 3. Done: the next launch opens no migration window and changes nothing.
  app = await launch(profile);
  try {
    const first = await app.firstWindow();
    assert.ok(!first.url().endsWith("/storage-migration.html"), "no migration window when done");
    const page = await editor(app);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("verynize-recovery-library")),
      library,
    );
  } finally {
    await app.close();
  }
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-storage-migration-"));
  try {
    await unitChecks();
    await recoveryChecks(profile);
    console.log(
      "PASS storage migration: marker parsing, recovery after a failed copy (file:// wins, replaced app:// values backed up), done marker",
    );
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
