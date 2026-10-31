// desktop/storage-migration.cjs recovery and downgrade sync: when an earlier copy failed (pending marker), the editor ran
// on an empty app://verynize origin and wrote its first-run defaults there. The retry must restore the
// user's file:// data over those defaults and keep the replaced app:// values in a backup file.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
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

async function downgradeChecks(profile) {
  const APP = "app://verynize/storage-migration.html";
  const marker = path.join(profile, MARKER);
  let app = await launch(profile);
  try {
    await editor(app);
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
  // Start a genuine first migration, independently of recovery coverage.
  await fs.rm(marker);
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "original");
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
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.deepEqual(
      await page.evaluate(() =>
        ["sync-key", "conflict-key", "delete-key"].map((k) => localStorage.getItem(k)),
      ),
      ["old-build edit", "new-build edit", null],
    );
    const record = await readMarker(marker);
    assert.equal(record.conflicts, 2, "local edit and consumed outbox conflict");
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
  } finally {
    await app.close();
  }
  const backupsBefore = (await fs.readdir(profile)).filter((name) =>
    name.startsWith("storage-origin-migration-backup-"),
  );
  app = await launch(profile);
  try {
    await editor(app);
    assert.deepEqual(
      (await fs.readdir(profile)).filter((name) =>
        name.startsWith("storage-origin-migration-backup-"),
      ),
      backupsBefore,
      "unchanged data creates no backup",
    );
    const record = await readMarker(marker);
    assert.equal(record.unchanged, true);
    assert.equal(record.copied, 0);
    assert.equal(record.replaced, 0);
    assert.equal(record.outbox, 0);
    console.log(
      `unchanged migration probe: ${record.elapsedMs.toFixed(1)} ms; no copy (2.7 MB UTF-16 synthetic payload + outbox)`,
    );
    // Another old-build edit must not overwrite the retained app conflict on the next launch.
    await seed(app, FILE_PAGE, [["conflict-key", "second old edit"]]);
  } finally {
    await app.close();
  }
  app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(await page.evaluate(() => localStorage.getItem("conflict-key")), "new-build edit");
    assert.equal((await readMarker(marker)).conflicts, 1);
    // Refuse replacement when the owner-only backup cannot be written, and retain the baseline
    // so a retry cannot be mistaken for destructive first-copy recovery.
    await seed(app, FILE_PAGE, [["sync-key", "edit requiring backup"]]);
    const before = await fs.readFile(marker, "utf8");
    await fs.chmod(profile, 0o500);
    try {
      const result = await app.evaluate(async ({ app, BrowserWindow }, modulePath) => {
        return process
          .getBuiltinModule("module")
          .createRequire(app.getAppPath() + "/package.json")(modulePath)
          .migrateStorage({ app, BrowserWindow, log: { error() {} } });
      }, path.resolve("desktop/storage-migration.cjs"));
      assert.ok(result.error, "backup failure returns instead of preventing startup");
      assert.equal(await page.evaluate(() => localStorage.getItem("sync-key")), "old-build edit");
      assert.equal(await fs.readFile(marker, "utf8"), before, "failed sync retains baseline");
    } finally {
      await fs.chmod(profile, 0o700);
    }
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
      "old-build edit",
      "unknown baseline never guesses newer origin",
    );
    assert.ok((await readMarker(marker)).conflicts >= 1);
    await page.locator("#storage-migration-notice").waitFor();
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
    console.log(
      "PASS storage migration: recovery, downgrade edits/deletions, local/outbox conflicts, consumed outbox protection, repeated conflicts, backup permissions/failure, hashless markers, unchanged-copy timing",
    );
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
