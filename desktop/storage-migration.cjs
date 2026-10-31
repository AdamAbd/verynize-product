// Renderer origin migration and conservative downgrade reconciliation.
// Read file:// in a sandboxed, hidden blank page before the editor opens. The marker stores
// per-key SHA-256 baselines for localStorage and each verynize-cloud/outbox record. On subsequent
// launches only changed old-origin values are candidates: copy when app:// still matches its
// baseline; otherwise keep app://, preserve both versions in an owner-only backup and show a
// dismissible notice. Deletions count as changes. Never replay an unchanged old outbox.
//
// Existing done markers without hashes cannot establish which build edited a value: differing
// app:// values are conflicts. Fresh profiles still use the cheap disk pre-check without a window.
// Migrated profiles need one hidden file:// read (Chromium's localStorage LevelDB is shared by
// origins, so file mtime alone cannot reliably detect old-build edits). Unchanged hashes skip
// app:// navigation, all copying, and backup creation. Times are recorded without data values.
//
// Pending first-copy recovery retains the original policy: file:// wins over app:// defaults,
// with backups before replacement and at most three attempts. A failed downgrade check never
// becomes a pending first-copy recovery: that would overwrite newer edits on the next launch.
// Storage replacements require exclusive, append-only 0600 backups; marker replacement is atomic.
const { createHash, randomUUID } = require("node:crypto");
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
  } catch (error) { throw new Error("Cannot read migration outbox: " + error.message); }
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
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); if (current === null) copied++; else replaced++; } catch { failed++; failedKeys.push(key); }
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
        for (const [key, value] of data.outbox) { const probe = store.getKey(key); probe.onsuccess = () => { if (probe.result === undefined || data.replaceOutbox) { if (value === null) store.delete(key); else store.put(value, key); added++; } }; }
        tx.oncomplete = () => resolve(added); tx.onerror = tx.onabort = () => { failed++; failedKeys.push("indexedDB:outbox"); resolve(0); };
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

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const entries = (data) => ({
  ...Object.fromEntries(Object.entries(data.local).map(([key, value]) => ["local:" + key, value])),
  ...Object.fromEntries(
    data.outbox.map(([key, value]) => ["outbox:" + JSON.stringify(key), value]),
  ),
});
const hashes = (data) =>
  Object.fromEntries(
    Object.entries(entries(data))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, hash(value)]),
  );
const absent = hash(null);

// Append-only, exclusive owner-only snapshots: failed marker writes and repeated recoveries must
// never destroy the only copy of a displaced value. Refuse to mutate storage if the backup fails.
async function backup(userData, data) {
  const name = `storage-origin-migration-backup-${randomUUID()}.json`;
  await fs.writeFile(path.join(userData, name), JSON.stringify(data), { mode: 0o600, flag: "wx" });
  return name;
}

async function writeJson(file, data) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function noticeOnNextWindow(app, backupFile) {
  const listener = (_event, win) => {
    win.webContents.once("did-finish-load", () => {
      if (
        !win.webContents.getURL().startsWith(ORIGIN + "/") ||
        win.webContents.getURL().endsWith(PAGE)
      )
        return;
      app.removeListener("browser-window-created", listener);
      win.webContents
        .executeJavaScript(`(() => {
        const notice = document.createElement('div');
        notice.id = 'storage-migration-notice'; notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;background:#252525;color:white;border:1px solid #888;font:14px system-ui';
        notice.textContent = 'Edits from an older Verynize build conflict with this build. Your current edits were kept. Older edits are saved in ' + ${JSON.stringify(backupFile)} + '. ';
        const close = document.createElement('button'); close.textContent = 'Dismiss'; close.onclick = () => notice.remove();
        notice.append(close); document.body.append(notice);
      })()`)
        .catch(() => {});
    });
  };
  app.on("browser-window-created", listener);
}

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label + " timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

async function migrateStorage({ app, BrowserWindow, log = console }) {
  const started = performance.now();
  const userData = app.getPath("userData");
  const marker = path.join(userData, MARKER);
  const previous = await readMarker(marker);
  if (previous?.unreadable || previous?.gaveUp) return { skipped: "unreadable-or-exhausted" };
  const sync = !!previous && !previous.pending && !previous.fresh;
  const recover = !!previous?.pending;
  const attempts = (Number(previous?.attempts) || 0) + 1;
  const write = (result) =>
    writeJson(marker, { from: "file://", to: ORIGIN, at: new Date().toISOString(), ...result });
  // Nothing stored for file:// (fresh profile, or file:// never used storage): no window needed.
  if (!sync && !(await hasFileOriginData(userData))) {
    await write({ fresh: true, copied: 0 }).catch(() => {});
    return { fresh: true };
  }
  // Written before the copy: if it fails or the app dies mid-copy, the next launch knows the
  // editor may have run on an empty origin (see Recovery above).
  if (!sync) await write({ pending: true, attempts }).catch(() => {});
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    const run = async () => {
      await win.loadURL(pathToFileURL(path.join(__dirname, "../web", PAGE)).href);
      const data = await win.webContents.executeJavaScript(READ, true);
      const found = Object.keys(data.local).length;
      const fileHashes = hashes(data);
      if (
        sync &&
        previous.baseline &&
        JSON.stringify(fileHashes) === JSON.stringify(previous.baseline.file)
      ) {
        return {
          ...previous,
          copied: 0,
          replaced: 0,
          outbox: 0,
          conflicts: 0,
          unchanged: true,
          elapsedMs: performance.now() - started,
        };
      }
      await win.loadURL(`${ORIGIN}/${PAGE}`);
      const currentData = await win.webContents.executeJavaScript(READ, true);
      if (sync) {
        const current = entries(currentData),
          incoming = entries(data);
        const old = previous.baseline;
        const delta = { local: {}, outbox: [], replaceOutbox: true };
        const conflicts = [],
          displaced = {};
        const appBaseline = { ...old?.app };
        for (const key of new Set([...Object.keys(incoming), ...Object.keys(old?.file || {})])) {
          const value = incoming[key] ?? null;
          if (old && (fileHashes[key] || absent) === (old.file[key] || absent)) continue;
          if (hash(current[key] ?? null) === hash(value)) {
            appBaseline[key] = hash(value);
            continue;
          }
          // Old done markers have no baseline: never guess which origin is newer.
          const safe = old
            ? hash(current[key] ?? null) === (old.app[key] || absent)
            : !(key in current);
          displaced[key] = { file: value, app: current[key] ?? null };
          if (!safe) {
            conflicts.push(key);
            appBaseline[key] = old?.app[key] || hash(value);
            continue;
          }
          appBaseline[key] = hash(value);
          if (key.startsWith("local:")) delta.local[key.slice(6)] = value;
          else delta.outbox.push([JSON.parse(key.slice(7)), value]);
        }
        const backupFile = Object.keys(displaced).length
          ? await backup(userData, { at: new Date().toISOString(), values: displaced })
          : undefined;
        const result = await win.webContents.executeJavaScript(
          WRITE(delta, Object.keys(delta.local)),
          true,
        );
        if (result.failed)
          throw Error("Downgrade sync could not write all values; backup retained");

        if (conflicts.length) noticeOnNextWindow(app, path.join(userData, backupFile));
        return {
          ...result,
          found,
          conflicts: conflicts.length,
          backupFile,
          baseline: { file: fileHashes, app: appBaseline },
          elapsedMs: performance.now() - started,
        };
      }
      let overwrite = [];
      if (recover) {
        // Save the app:// values about to be replaced before touching them.
        const current = currentData.local;
        overwrite = Object.keys(data.local).filter(
          (key) => key in current && current[key] !== data.local[key],
        );
        if (overwrite.length) {
          await backup(userData, {
            local: Object.fromEntries(overwrite.map((key) => [key, current[key]])),
          });
          await writeJson(path.join(userData, REPLACED), {
            at: new Date().toISOString(),
            local: Object.fromEntries(overwrite.map((key) => [key, current[key]])),
          });
        }
      }
      // Preserve both origins before the initial copy too, including outbox records.
      await backup(userData, { file: data, app: currentData });
      const result = await win.webContents.executeJavaScript(WRITE(data, overwrite), true);
      if (result.failed)
        throw Error("Storage migration could not write all values; backup retained");
      return {
        found,
        ...(recover ? { recovered: true } : {}),
        ...result,
        baseline: {
          file: fileHashes,
          app: hashes(await win.webContents.executeJavaScript(READ, true)),
        },
        elapsedMs: performance.now() - started,
      };
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
    const gaveUp = !sync && attempts >= MAX_ATTEMPTS;
    log.error?.(
      `Storage migration failed (${gaveUp ? "giving up" : "will retry next launch"}):`,
      error,
    );
    if (!sync)
      await write(
        gaveUp
          ? { gaveUp: true, attempts, error: message }
          : { pending: true, attempts, error: message },
      ).catch(() => {});
    return { error: message };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = { migrateStorage, hasFileOriginData, readMarker, MARKER, REPLACED, MAX_ATTEMPTS };
