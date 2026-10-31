// One-time copy of renderer storage from the old file:// origin to app://verynize.
//
// Until the editor moved to the app:// scheme (desktop/app-protocol.cjs) it ran from file://, and
// everything the renderer keeps in localStorage (documents and the file library, chats, settings,
// cloud account sessions, view state) plus the cloud outbox in IndexedDB (`verynize-cloud`/`outbox`)
// belongs to that origin. A new origin starts empty, so before the first app:// window opens this
// module reads the old storage in a hidden window at a file:// URL and writes it in a hidden window
// at app://verynize/storage-migration.html (both blank pages in the default session).
//
// - Keys already present on app://verynize are kept; the old file:// data is left in place (an older
//   build can still read it).
// - A marker file in userData records the result so the copy runs once. It is written as
//   `{pending: true}` before the copy starts and replaced by the result when the copy finishes.
// - Recovery: a pending marker means an earlier attempt failed or crashed, and the editor then ran on
//   an empty app://verynize origin and wrote its first-run defaults there (an empty file library,
//   default settings, an empty chat list). Keeping those would hide the user's real data for good, so
//   the retry lets the file:// values win, after saving every app:// value it replaces to
//   userData/storage-origin-migration-replaced.json. After MAX_ATTEMPTS failures it gives up (each
//   attempt can block startup for up to TIMEOUT).
// - Profiles without file:// storage (fresh installs, test runs) are marked done without opening a window.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ORIGIN } = require("./app-protocol.cjs");

const MARKER = "storage-origin-migration.json";
const REPLACED = "storage-origin-migration-replaced.json";
const MAX_ATTEMPTS = 3;
const PAGE = "storage-migration.html";
const OUTBOX = { db: "verynize-cloud", store: "outbox", version: 1 };
const TIMEOUT = 15000;

/** The marker's record, `null` when there is none. An unreadable marker counts as done (never loop). */
async function readMarker(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    return error?.code === "ENOENT" ? null : { unreadable: true };
  }
  try {
    const record = JSON.parse(text);
    return record && typeof record === "object" ? record : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}

// Runs in the file:// page. Only plain strings / structured-clone values leave it.
const READ = `(async () => {
  const local = {};
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); local[key] = localStorage.getItem(key); }
  let outbox = [];
  try {
    const names = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
    if (names.includes(${JSON.stringify(OUTBOX.db)})) {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open(${JSON.stringify(OUTBOX.db)}); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      if (db.objectStoreNames.contains(${JSON.stringify(OUTBOX.store)})) {
        outbox = await new Promise((resolve, reject) => {
          const store = db.transaction(${JSON.stringify(OUTBOX.store)}, 'readonly').objectStore(${JSON.stringify(OUTBOX.store)});
          const keys = store.getAllKeys(), values = store.getAll();
          values.onsuccess = () => resolve(keys.result.map((key, i) => [key, values.result[i]]));
          values.onerror = () => reject(values.error);
        });
      }
      db.close();
    }
  } catch {}
  return { local, outbox };
})()`;

// Runs in the app://verynize page with the data read above.
// `overwrite` lists keys whose app:// value is replaced (recovery after a failed attempt).
const WRITE = (data, overwrite = []) => `(async (data, overwrite) => {
  let copied = 0, kept = 0, replaced = 0, failed = 0, outbox = 0;
  const failedKeys = [];
  for (const [key, value] of Object.entries(data.local)) {
    const current = localStorage.getItem(key);
    if (current === value) { kept++; continue; }
    if (current !== null && !overwrite.includes(key)) { kept++; continue; }
    try { localStorage.setItem(key, value); if (current === null) copied++; else replaced++; } catch { failed++; failedKeys.push(key); }
  }
  if (data.outbox.length) {
    try {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(${JSON.stringify(OUTBOX.db)}, ${OUTBOX.version});
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(${JSON.stringify(OUTBOX.store)})) r.result.createObjectStore(${JSON.stringify(OUTBOX.store)}); };
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      outbox = await new Promise((resolve) => {
        const tx = db.transaction(${JSON.stringify(OUTBOX.store)}, 'readwrite'), store = tx.objectStore(${JSON.stringify(OUTBOX.store)});
        let added = 0;
        for (const [key, value] of data.outbox) { const probe = store.getKey(key); probe.onsuccess = () => { if (probe.result === undefined) { store.put(value, key); added++; } }; }
        tx.oncomplete = () => resolve(added); tx.onerror = tx.onabort = () => resolve(0);
      });
      db.close();
    } catch { failed++; failedKeys.push('indexedDB:' + ${JSON.stringify(OUTBOX.db)}); }
  }
  return { copied, kept, replaced, failed, failedKeys, outbox };
})(${JSON.stringify(data)}, ${JSON.stringify(overwrite)})`;

/** Cheap pre-check without a renderer. Chromium keys localStorage rows by origin (`META:file://`,
 *  `_file://\0\1key`) and names IndexedDB folders `file__0.indexeddb.*`. The first key of every
 *  leveldb block is stored in full, so any file:// row leaves the bytes `file://` in a log/table file. */
async function hasFileOriginData(userData) {
  try {
    if (
      (await fs.readdir(path.join(userData, "IndexedDB"))).some((name) => name.startsWith("file__"))
    )
      return true;
  } catch {}
  const dir = path.join(userData, "Local Storage", "leveldb");
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!/\.(log|ldb|sst)$/.test(name)) continue;
    try {
      if ((await fs.readFile(path.join(dir, name))).includes("file://")) return true;
    } catch {}
  }
  return false;
}

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Error(label + " timed out")), ms)),
  ]);

async function migrateStorage({ app, BrowserWindow, log = console }) {
  const userData = app.getPath("userData");
  const marker = path.join(userData, MARKER);
  const previous = await readMarker(marker);
  if (previous && !previous.pending) return { skipped: "done" };
  const recover = !!previous?.pending;
  const attempts = (Number(previous?.attempts) || 0) + 1;
  const write = (result) =>
    fs.writeFile(
      marker,
      JSON.stringify(
        { from: "file://", to: ORIGIN, at: new Date().toISOString(), ...result },
        null,
        2,
      ) + "\n",
    );
  // Nothing stored for file:// (fresh profile, or file:// never used storage): no window needed.
  if (!(await hasFileOriginData(userData))) {
    await write({ fresh: true, copied: 0 }).catch(() => {});
    return { fresh: true };
  }
  // Written before the copy: if it fails or the app dies mid-copy, the next launch knows the
  // editor may have run on an empty origin (see Recovery above).
  await write({ pending: true, attempts }).catch(() => {});
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  try {
    const run = async () => {
      await win.loadURL(pathToFileURL(path.join(__dirname, "../web", PAGE)).href);
      const data = await win.webContents.executeJavaScript(READ, true);
      const found = Object.keys(data.local).length;
      if (!found && !data.outbox.length) return { copied: 0, found: 0 };
      await win.loadURL(`${ORIGIN}/${PAGE}`);
      let overwrite = [];
      if (recover) {
        // Save the app:// values about to be replaced before touching them.
        const current = (await win.webContents.executeJavaScript(READ, true)).local;
        overwrite = Object.keys(data.local).filter(
          (key) => key in current && current[key] !== data.local[key],
        );
        if (overwrite.length)
          await fs.writeFile(
            path.join(userData, REPLACED),
            JSON.stringify(
              {
                at: new Date().toISOString(),
                local: Object.fromEntries(overwrite.map((key) => [key, current[key]])),
              },
              null,
              2,
            ) + "\n",
            { mode: 0o600 },
          );
      }
      const result = await win.webContents.executeJavaScript(WRITE(data, overwrite), true);
      return { found, ...(recover ? { recovered: true } : {}), ...result };
    };
    const result = await withTimeout(run(), TIMEOUT, "Storage migration");
    if (result.failed)
      log.warn?.(
        `Storage migration: ${result.failed} item(s) could not be copied from file:// to ${ORIGIN}`,
      );
    await write({ ...result, attempts });
    return result;
  } catch (error) {
    const message = String(error?.message || error);
    const gaveUp = attempts >= MAX_ATTEMPTS;
    log.error?.(
      `Storage migration failed (${gaveUp ? "giving up" : "will retry next launch"}):`,
      error,
    );
    await write(
      gaveUp
        ? { gaveUp: true, attempts, error: message }
        : { pending: true, attempts, error: message },
    ).catch(() => {});
    return { error: message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { migrateStorage, hasFileOriginData, readMarker, MARKER, REPLACED, MAX_ATTEMPTS };
