// desktop/storage-migration.cjs recovery and downgrade sync: when an earlier copy failed (pending marker), the editor ran
// on an empty app://verynize origin and wrote its first-run defaults there. The retry must restore the
// user's file:// data over those defaults and keep the replaced app:// values in a backup file.
// Edits made by an older (file://) build after the migration are found by a background probe after the
// editor loads, staged, announced in the running app and applied before the window on the next launch.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { MARKER, REPLACED, STAGED, PROBE, readMarker } = require("../desktop/storage-migration.cjs");

const env = {
  ...process.env,
  VERYNIZE_SKIP_ONBOARDING: "1",
  VERYNIZE_STORAGE_PROBE_DELAY_MS: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
const MODULE = path.resolve("desktop/storage-migration.cjs");
const STARTUP_BUDGET_MS = 10;
/** Launches with no probe record, so `probed` waits for this launch's background probe. */
async function launch(profile, extra = {}) {
  await fs.rm(path.join(profile, PROBE), { force: true });
  return electron.launch({ env: { ...env, ...extra }, args: [".", `--user-data-dir=${profile}`] });
}
async function probed(profile) {
  for (let i = 0; i < 400; i++) {
    const record = await readMarker(path.join(profile, PROBE));
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("The background storage probe did not finish");
}
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
/** Calls an export of desktop/storage-migration.cjs inside the running app. With `abortOnWindow`,
 *  its signal aborts as soon as it opens its hidden window (a quit during the probe). */
const callModule = (app, name, abortOnWindow = false) =>
  app.evaluate(
    async ({ app, BrowserWindow }, { modulePath, name, abortOnWindow }) => {
      const mod = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json")(modulePath);
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (abortOnWindow) app.once("browser-window-created", abort);
      try {
        return await mod[name]({
          app,
          BrowserWindow,
          signal: controller.signal,
          log: { error() {}, warn() {} },
        });
      } finally {
        app.removeListener("browser-window-created", abort);
      }
    },
    { modulePath: MODULE, name, abortOnWindow },
  );
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
      await waitForUiReady(page);
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
    // The first launch just found no file:// data: no background probe follows it.
    assert.equal((await readMarker(path.join(profile, MARKER))).fresh, true);
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
  // 3. Done: probe the old origin without copying unchanged values.
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("verynize-recovery-library")),
      library,
    );
  } finally {
    await app.close();
  }
}

async function outbox(app, url, records) {
  await app.evaluate(
    async ({ BrowserWindow }, { url, records }) => {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      try {
        await win.loadURL(url);
        await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('verynize-cloud', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('outbox');
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('outbox', 'readwrite');
          for (const [key,value] of ${JSON.stringify(records)}) {
            if (value === null) tx.objectStore('outbox').delete(key);
            else tx.objectStore('outbox').put(value,key);
          }
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); db.close();
      })()`);
      } finally {
        win.destroy();
      }
    },
    { url, records },
  );
}

const localValues = (page, keys) =>
  page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), keys);
const backups = async (profile) =>
  (await fs.readdir(profile)).filter((name) => name.startsWith("storage-origin-migration-backup-"));

async function downgradeChecks(profile) {
  const APP = "app://verynize/storage-migration.html";
  const marker = path.join(profile, MARKER);
  const staged = path.join(profile, STAGED);
  let app = await launch(profile);
  try {
    await editor(app);
    await probed(profile);
    await seed(app, FILE_PAGE, [
      ["sync-key", "original"],
      ["conflict-key", "original"],
      ["delete-key", "original"],
      ["timing-payload", "x".repeat(1_350_000)],
    ]);
    await outbox(app, FILE_PAGE, [
      ["pending", { version: 1 }],
      ["consumed", { version: 1 }],
      ["old-ack", { version: 1 }],
    ]);
  } finally {
    await app.close();
  }
  // Start a genuine first migration, independently of recovery coverage. It stays synchronous.
  await fs.rm(marker);
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "original");
    const record = await readMarker(marker);
    assert.ok(record.baseline && record.copied >= 4, JSON.stringify(record));
    console.log(
      `first migration (before the editor): ${record.elapsedMs.toFixed(1)} ms (2.7 MB UTF-16 synthetic payload + outbox)`,
    );
    // The copy just read file://, so no background probe follows. Old-build edits made now act as if
    // an older build ran before the next launch.
    await seed(app, FILE_PAGE, [
      ["sync-key", "old-build edit"],
      ["conflict-key", "old-build edit"],
    ]);
    await seed(app, APP, [["conflict-key", "new-build edit"]]);
    await outbox(app, FILE_PAGE, [
      ["pending", { version: 2 }],
      ["consumed", { version: 2 }],
      ["old-ack", null],
    ]);
    await outbox(app, APP, [["consumed", null]]);
    // A missing old key is an edit too.
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ show: false });
      await win.loadURL(url);
      await win.webContents.executeJavaScript("localStorage.removeItem('delete-key')");
      win.destroy();
    }, FILE_PAGE);
  } finally {
    await app.close();
  }
  // The launch itself only reads the marker; the background probe stages the edits and tells the
  // running app, without writing app:// storage under the editor.
  app = await launch(profile);
  try {
    const page = await editor(app);
    const probe = await probed(profile);
    assert.equal(probe.startup.windows, 0, "no window before the editor");
    assert.ok(probe.startup.elapsedMs <= STARTUP_BUDGET_MS, JSON.stringify(probe));
    assert.equal(probe.staged, true, JSON.stringify(probe));
    assert.equal(probe.changed, 6, "3 localStorage keys + 3 outbox records");
    await page.locator("#storage-migration-staged-notice").waitFor();
    assert.equal((await fs.stat(staged)).mode & 0o077, 0, "staged file is 0600");
    assert.deepEqual(
      await localValues(page, ["sync-key", "conflict-key", "delete-key"]),
      ["original", "new-build edit", "original"],
      "nothing written under the running renderer",
    );
  } finally {
    await app.close();
  }
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.deepEqual(await localValues(page, ["sync-key", "conflict-key", "delete-key"]), [
      "old-build edit",
      "new-build edit",
      null,
    ]);
    const record = await readMarker(marker);
    console.log(
      `staged apply (before the editor): ${record.elapsedMs.toFixed(1)} ms (6 staged values, 2.7 MB app:// read)`,
    );
    assert.equal(record.applied, 6);
    assert.equal(record.conflicts, 2, "local edit and consumed outbox conflict");
    assert.equal(await exists(staged), false, "staged file consumed");
    const saved = JSON.parse(await fs.readFile(path.join(profile, record.backupFile), "utf8"));
    assert.equal(saved.values["local:conflict-key"].file, "old-build edit");
    assert.equal(saved.values["local:sync-key"].app, "original", "replacement backed up first");
    assert.equal((await fs.stat(path.join(profile, record.backupFile))).mode & 0o077, 0);
    await page.locator("#storage-migration-notice").waitFor();
    assert.deepEqual(
      await page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("verynize-cloud");
          r.onsuccess = () => resolve(r.result);
        });
        const values = await new Promise((resolve) => {
          const r = db.transaction("outbox").objectStore("outbox").getAll();
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return values;
      }),
      [{ version: 2 }],
      "changed pending outbox copied; consumed entry never replayed",
    );
    assert.equal((await probed(profile)).unchanged, true, "applied hashes become the baseline");
  } finally {
    await app.close();
  }
  const backupsBefore = await backups(profile);
  const markerBefore = await fs.readFile(marker, "utf8");
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(app.windows()[0], page, "the editor is the first window");
    const probe = await probed(profile);
    assert.equal(probe.unchanged, true);
    assert.equal(probe.startup.windows, 0);
    assert.ok(probe.startup.elapsedMs <= STARTUP_BUDGET_MS, JSON.stringify(probe));
    console.log(
      `unchanged launch: ${probe.startup.elapsedMs.toFixed(2)} ms before the editor, no window; background probe ${probe.elapsedMs.toFixed(1)} ms (2.7 MB payload + outbox)`,
    );
    assert.deepEqual(await backups(profile), backupsBefore, "unchanged data creates no backup");
    assert.equal(
      await fs.readFile(marker, "utf8"),
      markerBefore,
      "unchanged data keeps the marker",
    );
    // Another old-build edit must not overwrite the retained app conflict on the next launch, and
    // a staged change must not overwrite an app:// edit made after it was staged.
    await seed(app, FILE_PAGE, [
      ["conflict-key", "second old edit"],
      ["sync-key", "edit superseded later"],
    ]);
  } finally {
    await app.close();
  }
  // A probe timeout leaves the app working and stages nothing; quitting during a probe leaves no file.
  app = await launch(profile, { VERYNIZE_STORAGE_PROBE_TIMEOUT_MS: "1" });
  try {
    const page = await editor(app);
    const probe = await probed(profile);
    assert.match(probe.error, /timed out/, JSON.stringify(probe));
    assert.equal(await exists(staged), false);
    assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "old-build edit");
    assert.ok(await page.evaluate(async () => (await window.desktop.onboardingState()).skip));
    assert.deepEqual(await callModule(app, "probeStorage", true), { aborted: true });
    assert.equal(await exists(staged), false, "aborted probe stages nothing");
    assert.deepEqual(
      (await fs.readdir(profile)).filter((name) => name.endsWith(".tmp")),
      [],
      "no partial file",
    );
  } finally {
    await app.close();
  }
  // A temporary file left by a quit during an earlier staged write is removed by the next probe.
  const leftover = path.join(profile, STAGED + ".interrupted.tmp");
  await fs.writeFile(leftover, "{", { mode: 0o600 });
  app = await launch(profile);
  try {
    const page = await editor(app);
    const probe = await probed(profile);
    assert.equal(probe.staged, true, "retried on the next launch: " + JSON.stringify(probe));
    assert.equal(await exists(leftover), false, "interrupted write cleaned up");
    assert.equal(probe.changed, 2);
    await page.locator("#storage-migration-staged-notice").waitFor();
    await page.evaluate(() => localStorage.setItem("sync-key", "newer app edit"));
  } finally {
    await app.close();
  }
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.deepEqual(await localValues(page, ["sync-key", "conflict-key"]), [
      "newer app edit",
      "new-build edit",
    ]);
    const record = await readMarker(marker);
    assert.equal(record.conflicts, 2, "repeated conflict and superseded staged change");
    const saved = JSON.parse(await fs.readFile(path.join(profile, record.backupFile), "utf8"));
    assert.deepEqual(saved.values["local:sync-key"], {
      file: "edit superseded later",
      app: "newer app edit",
    });
    await page.locator("#storage-migration-notice").waitFor();
    await probed(profile);
    // Refuse replacement when the owner-only backup cannot be written, and retain the baseline
    // and the staged file so the next launch retries.
    await seed(app, FILE_PAGE, [["sync-key", "edit requiring backup"]]);
    assert.equal((await callModule(app, "probeStorage")).staged, true);
    const before = await fs.readFile(marker, "utf8");
    await fs.chmod(profile, 0o500);
    try {
      const result = await callModule(app, "migrateStorage");
      assert.ok(result.error, "backup failure returns instead of preventing startup");
      assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "newer app edit");
      assert.equal(await fs.readFile(marker, "utf8"), before, "failed apply retains baseline");
      assert.equal(await exists(staged), true, "failed apply keeps the staged changes");
    } finally {
      await fs.chmod(profile, 0o700);
    }
  } finally {
    await app.close();
  }
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "newer app edit");
    assert.equal((await readMarker(marker)).conflicts, 1, "retry re-verifies against app://");
    assert.equal(await exists(staged), false);
  } finally {
    await app.close();
  }
  // Upgrade a done marker written by the original one-time migrator (no baseline hashes).
  await fs.writeFile(marker, JSON.stringify({ copied: 3, found: 3 }));
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("sync-key")),
      "newer app edit",
      "unknown baseline never guesses newer origin",
    );
    const record = await readMarker(marker);
    assert.ok(record.conflicts >= 1 && record.baseline, JSON.stringify(record));
    await page.locator("#storage-migration-notice").waitFor();
  } finally {
    await app.close();
  }
}

// A profile that started on this build (fresh marker) and later got data from an older build.
async function freshMarkerChecks(profile) {
  const staged = path.join(profile, STAGED);
  let app = await launch(profile);
  try {
    await editor(app);
    assert.equal((await readMarker(path.join(profile, MARKER))).fresh, true);
    await seed(app, FILE_PAGE, [["fresh-old-build", "made by an older build"]]);
  } finally {
    await app.close();
  }
  // Quitting before the scheduled probe runs cancels it: no record, nothing staged.
  app = await launch(profile, { VERYNIZE_STORAGE_PROBE_DELAY_MS: "60000" });
  try {
    await editor(app);
  } finally {
    await app.close();
  }
  assert.equal(await exists(path.join(profile, PROBE)), false, "cancelled probe records nothing");
  assert.equal(await exists(staged), false);
  app = await launch(profile);
  try {
    const page = await editor(app);
    const probe = await probed(profile);
    assert.equal(probe.staged, true, JSON.stringify(probe));
    assert.equal(probe.startup.windows, 0);
    await page.locator("#storage-migration-staged-notice").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("fresh-old-build")), null);
  } finally {
    await app.close();
  }
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("fresh-old-build")),
      "made by an older build",
    );
    const record = await readMarker(path.join(profile, MARKER));
    assert.ok(record.baseline && !record.fresh && record.conflicts === 0, JSON.stringify(record));
    assert.equal((await probed(profile)).unchanged, true);
  } finally {
    await app.close();
  }
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-storage-migration-"));
  try {
    await unitChecks();
    await recoveryChecks(profile);
    await downgradeChecks(profile);
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-storage-fresh-"));
    try {
      await freshMarkerChecks(fresh);
    } finally {
      await fs.rm(fresh, { recursive: true, force: true });
    }
    console.log(
      "PASS storage migration: recovery, unchanged launch without a startup window, background probe staging + notice + next-launch apply, downgrade edits/deletions, local/outbox conflicts, consumed outbox protection, repeated and superseded conflicts, probe timeout/abort/quit, fresh-marker old-build data, backup permissions/failure, hashless markers",
    );
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
