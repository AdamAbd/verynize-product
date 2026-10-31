// Renderer origin migration and conservative downgrade reconciliation.
// First migration (no record yet), pending first-copy recovery and the upgrade of hashless done
// markers run before the editor opens: a sandboxed hidden page reads file:// and writes app://.
// The marker stores per-key SHA-256 baselines for localStorage and each verynize-cloud/outbox
// record. Fresh profiles use a cheap disk pre-check without a window.
//
// Completed migrations stay off the startup path: the launch only reads the marker and checks
// for a staged file (well under 10 ms, no window). Edits made by an older (file://) build are
// found by probeAfterLaunch: after the editor has loaded and an idle delay, a bounded hidden
// file:// read compares hashes with the baseline. Changed old-origin values are never written
// under the running renderer (it already loaded its state and could overwrite them). They are
// staged in an owner-only, atomically written file, the running editor shows a notice, and the
// next launch applies them before the window opens. Applying re-reads app:// and re-checks it
// against the baseline: copy when app:// still matches it; otherwise keep app://, preserve both
// versions in an owner-only backup and show a dismissible notice. Deletions count as changes.
// A staged file is only applied over the baseline it was computed against. A quit aborts the
// probe; failures and timeouts are recorded and the next launch probes again. There is no cheap
// trigger to skip probing: Chromium shares one localStorage LevelDB across origins and keeps
// appending to it after will-quit and process exit, so file metadata cannot tell an old build's
// writes from this build's. Times are recorded without data values.
//
// Existing done markers without hashes cannot establish which build edited a value: differing
// app:// values are conflicts. Pending first-copy recovery retains the original policy: file://
// wins over app:// defaults, with backups before replacement and at most three attempts. A failed
// downgrade check never becomes a pending first-copy recovery: that would overwrite newer edits.
// Storage replacements require exclusive, append-only 0600 backups; marker replacement is atomic.
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ORIGIN } = require("./app-protocol.cjs");

const MARKER = "storage-origin-migration.json";
const REPLACED = "storage-origin-migration-replaced.json";
const MAX_ATTEMPTS = 3;
const PAGE = "storage-migration.html";
const OUTBOX = { db: "verynize-cloud", store: "outbox", version: 1 };
const STAGED = "storage-origin-migration-staged.json";
const PROBE = "storage-origin-migration-probe.json";
const TIMEOUT = 15000;
const PROBE_DELAY = 3000;
const EMPTY = { file: {}, app: {} };

/** The marker's record, `null` when there is none. An unreadable marker counts as done (never loop). */
async function readMarker(file) {
  return fs.readFile(file, "utf8").then(parseRecord, missingRecord);
}
/** Startup variant: a few-KB read that never yields to the busy startup event loop. */
function readMarkerSync(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return missingRecord(error);
  }
  return parseRecord(text);
}
const missingRecord = (error) => (error?.code === "ENOENT" ? null : { unreadable: true });
function parseRecord(text) {
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

const CONFLICT_NOTICE = "storage-migration-notice";
const STAGED_NOTICE = "storage-migration-staged-notice";
const isEditor = (contents) =>
  contents.getURL().startsWith(ORIGIN + "/") && !contents.getURL().endsWith(PAGE);

/** A dismissible notice in the editor page; the page has no API for it, so main injects it. */
function showNotice(contents, id, text) {
  return contents
    .executeJavaScript(`(() => {
      if (document.getElementById(${JSON.stringify(id)})) return;
      const notice = document.createElement('div');
      notice.id = ${JSON.stringify(id)}; notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;background:#252525;color:white;border:1px solid #888;font:14px system-ui';
      notice.textContent = ${JSON.stringify(text + " ")};
      const close = document.createElement('button'); close.textContent = 'Dismiss'; close.onclick = () => notice.remove();
      notice.append(close); document.body.append(notice);
    })()`)
    .catch(() => {});
}

function noticeOnNextWindow(app, id, text) {
  const listener = (_event, win) => {
    win.webContents.once("did-finish-load", () => {
      if (!isEditor(win.webContents)) return;
      app.removeListener("browser-window-created", listener);
      showNotice(win.webContents, id, text);
    });
  };
  app.on("browser-window-created", listener);
}

const conflictNotice = (app, backupFile) =>
  noticeOnNextWindow(
    app,
    CONFLICT_NOTICE,
    `Edits from an older Verynize build conflict with this build. Your current edits were kept. Older edits are saved in ${backupFile}.`,
  );

function stagedNotice(app, BrowserWindow) {
  const text =
    "Changes made in an older version of Verynize were found. They will be applied the next time you open Verynize.";
  const editors = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && isEditor(win.webContents),
  );
  if (!editors.length) return noticeOnNextWindow(app, STAGED_NOTICE, text);
  for (const win of editors) showNotice(win.webContents, STAGED_NOTICE, text);
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

function hiddenWindow(BrowserWindow) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  return win;
}
const FILE_PAGE = () => pathToFileURL(path.join(__dirname, "../web", PAGE)).href;

/** Old-origin values that differ from the `oldFile` hashes (all of them without a baseline). */
function changesOf(data, fileHashes, oldFile) {
  const incoming = entries(data),
    changes = {};
  for (const key of new Set([...Object.keys(incoming), ...Object.keys(oldFile || {})])) {
    if (oldFile && (fileHashes[key] || absent) === (oldFile[key] || absent)) continue;
    changes[key] = incoming[key] ?? null;
  }
  return changes;
}

/** Decides each changed old-origin value against the current app:// value and its baseline. */
function reconcile(changes, current, old) {
  const delta = { local: {}, outbox: [], replaceOutbox: true };
  const conflicts = [],
    displaced = {};
  const appBaseline = { ...old?.app };
  for (const [key, value] of Object.entries(changes)) {
    if (hash(current[key] ?? null) === hash(value)) {
      appBaseline[key] = hash(value);
      continue;
    }
    // Old done markers have no baseline: never guess which origin is newer.
    const safe = old ? hash(current[key] ?? null) === (old.app[key] || absent) : !(key in current);
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
  return { delta, conflicts, displaced, appBaseline };
}

/** Backs up every displaced value, then writes the safe ones into the app:// page `win`. */
async function commit(win, userData, plan) {
  const backupFile = Object.keys(plan.displaced).length
    ? await backup(userData, { at: new Date().toISOString(), values: plan.displaced })
    : undefined;
  const result = await win.webContents.executeJavaScript(
    WRITE(plan.delta, Object.keys(plan.delta.local)),
    true,
  );
  if (result.failed) throw Error("Downgrade sync could not write all values; backup retained");
  return { ...result, conflicts: plan.conflicts.length, backupFile };
}

/** A finished migration whose later old-build edits are handled by the background probe. */
const completed = (record) =>
  !!record &&
  !record.pending &&
  !record.unreadable &&
  !record.gaveUp &&
  !!(record.baseline || record.fresh);

async function readStaged(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    return error?.code === "ENOENT" ? null : { invalid: true };
  }
  try {
    const staged = JSON.parse(text);
    return staged?.values && staged.fileHashes && typeof staged.base === "string"
      ? staged
      : { invalid: true };
  } catch {
    return { invalid: true };
  }
}

/** Runs before the editor window opens. Returns `{deferred: true}` when nothing has to happen
 *  now: the caller then hands the result to `probeAfterLaunch`. */
async function migrateStorage({ app, BrowserWindow, log = console }) {
  const started = performance.now();
  let windows = 0;
  const count = () => windows++;
  app.on("browser-window-created", count);
  try {
    const result = await startup({ app, BrowserWindow, log, started });
    return { ...result, windows };
  } finally {
    app.removeListener("browser-window-created", count);
  }
}

async function startup({ app, BrowserWindow, log, started }) {
  const userData = app.getPath("userData");
  const marker = path.join(userData, MARKER);
  const previous = readMarkerSync(marker);
  if (previous?.unreadable || previous?.gaveUp) return { skipped: "unreadable-or-exhausted" };
  if (completed(previous)) {
    if (!existsSync(path.join(userData, STAGED)))
      return { deferred: true, elapsedMs: performance.now() - started };
    const staged = await readStaged(path.join(userData, STAGED));
    if (staged && !staged.invalid)
      return applyStaged({ app, BrowserWindow, log, started, userData, previous, staged });
    if (staged) await fs.rm(path.join(userData, STAGED), { force: true }).catch(() => {});
    return { deferred: true, elapsedMs: performance.now() - started };
  }
  return migrate({ app, BrowserWindow, log, started, userData, previous });
}

/** Applies changes staged by an earlier probe, re-verified against the current app:// values. */
async function applyStaged({ app, BrowserWindow, log, started, userData, previous, staged }) {
  const marker = path.join(userData, MARKER),
    file = path.join(userData, STAGED);
  const old = previous.baseline || EMPTY;
  // Staged against another baseline (e.g. a later recovery rewrote the marker): probe again.
  if (staged.base !== hash(old.file)) {
    await fs.rm(file, { force: true }).catch(() => {});
    return { deferred: true, discarded: true, elapsedMs: performance.now() - started };
  }
  const attempts = (Number(staged.attempts) || 0) + 1;
  let win;
  try {
    win = hiddenWindow(BrowserWindow);
    const result = await withTimeout(
      (async () => {
        await win.loadURL(`${ORIGIN}/${PAGE}`);
        const current = entries(await win.webContents.executeJavaScript(READ, true));
        const plan = reconcile(staged.values, current, old);
        const outcome = await commit(win, userData, plan);
        if (plan.conflicts.length) conflictNotice(app, path.join(userData, outcome.backupFile));
        return {
          ...outcome,
          applied: Object.keys(staged.values).length,
          baseline: { file: staged.fileHashes, app: plan.appBaseline },
        };
      })(),
      TIMEOUT,
      "Applying staged storage changes",
    );
    const record = { ...result, elapsedMs: performance.now() - started };
    await writeJson(marker, {
      from: "file://",
      to: ORIGIN,
      at: new Date().toISOString(),
      ...record,
    });
    await fs.rm(file, { force: true });
    return record;
  } catch (error) {
    const message = String(error?.message || error);
    // Keep the staged file for a retry (re-verification makes that safe); give up after a few.
    const gaveUp = attempts >= MAX_ATTEMPTS;
    log.error?.(`Applying staged storage changes failed${gaveUp ? " (giving up)" : ""}:`, error);
    if (gaveUp) {
      await fs
        .rename(
          file,
          path.join(userData, `storage-origin-migration-staged-failed-${randomUUID()}.json`),
        )
        .then(() => writeJson(marker, { ...previous, stagedGaveUp: hash(staged.fileHashes) }))
        .catch(() => {});
    } else await writeJson(file, { ...staged, attempts }).catch(() => {});
    return { error: message };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

/** First copy, pending recovery, or the one-time upgrade of a hashless done marker. */
async function migrate({ app, BrowserWindow, log, started, userData, previous }) {
  const marker = path.join(userData, MARKER);
  const sync = !!previous && !previous.pending && !previous.fresh;
  const recover = !!previous?.pending;
  const attempts = (Number(previous?.attempts) || 0) + 1;
  const write = (result) =>
    writeJson(marker, { from: "file://", to: ORIGIN, at: new Date().toISOString(), ...result });
  // Nothing stored for file:// (fresh profile, or file:// never used storage): no window needed.
  if (!sync && !(await hasFileOriginData(userData))) {
    await write({ fresh: true, copied: 0 }).catch(() => {});
    return { fresh: true, elapsedMs: performance.now() - started };
  }
  // Written before the copy: if it fails or the app dies mid-copy, the next launch knows the
  // editor may have run on an empty origin (see Recovery above).
  if (!sync) await write({ pending: true, attempts }).catch(() => {});
  let win;
  try {
    win = hiddenWindow(BrowserWindow);
    const run = async () => {
      await win.loadURL(FILE_PAGE());
      const data = await win.webContents.executeJavaScript(READ, true);
      const found = Object.keys(data.local).length;
      const fileHashes = hashes(data);
      await win.loadURL(`${ORIGIN}/${PAGE}`);
      const currentData = await win.webContents.executeJavaScript(READ, true);
      if (sync) {
        const plan = reconcile(changesOf(data, fileHashes, null), entries(currentData), null);
        const outcome = await commit(win, userData, plan);
        if (plan.conflicts.length) conflictNotice(app, path.join(userData, outcome.backupFile));
        return {
          ...outcome,
          found,
          baseline: { file: fileHashes, app: plan.appBaseline },
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

/** Reads file:// in a hidden page and stages values an older build changed since the baseline.
 *  Never touches app:// storage. Aborting (`signal`, e.g. on quit) destroys the page; the staged
 *  file is replaced atomically, so it is either absent or complete. */
async function probeStorage({ app, BrowserWindow, timeout = TIMEOUT, signal }) {
  const started = performance.now();
  const userData = app.getPath("userData");
  const elapsed = () => performance.now() - started;
  const previous = await readMarker(path.join(userData, MARKER));
  if (!completed(previous)) return { skipped: "not-migrated", elapsedMs: elapsed() };
  if (await readStaged(path.join(userData, STAGED)))
    return { skipped: "staged", elapsedMs: elapsed() };
  // A quit during the atomic write can leave its temporary file behind (never the staged file).
  for (const name of await fs.readdir(userData).catch(() => []))
    if (name.startsWith(STAGED + ".") && name.endsWith(".tmp"))
      await fs.rm(path.join(userData, name), { force: true }).catch(() => {});
  if (!previous.baseline && !(await hasFileOriginData(userData)))
    return { unchanged: true, fresh: true, elapsedMs: elapsed() };
  const old = previous.baseline || EMPTY;
  let win;
  const abort = () => {
    if (win && !win.isDestroyed()) win.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) return { aborted: true };
    win = hiddenWindow(BrowserWindow);
    if (signal?.aborted) throw Error("Storage probe aborted");
    const data = await withTimeout(
      (async () => {
        await win.loadURL(FILE_PAGE());
        return win.webContents.executeJavaScript(READ, true);
      })(),
      timeout,
      "Storage probe",
    );
    abort();
    const fileHashes = hashes(data);
    const values = changesOf(data, fileHashes, old.file);
    const changed = Object.keys(values).length;
    if (!changed) return { unchanged: true, elapsedMs: elapsed() };
    if (previous.stagedGaveUp === hash(fileHashes))
      return { changed, skipped: "gave-up", elapsedMs: elapsed() };
    if (signal?.aborted) return { aborted: true };
    await writeJson(path.join(userData, STAGED), {
      version: 1,
      at: new Date().toISOString(),
      base: hash(old.file),
      fileHashes,
      values,
    });
    return { changed, staged: true, elapsedMs: elapsed() };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    return { error: String(error?.message || error), elapsedMs: elapsed() };
  } finally {
    signal?.removeEventListener("abort", abort);
    abort();
  }
}

const envMs = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Schedules the downgrade probe once `editor` has loaded, after an idle delay. Never throws or
 *  blocks: a quit aborts it, and failures are recorded for the next launch to retry. Writes
 *  `userData/storage-origin-migration-probe.json` with the startup and probe times. */
function probeAfterLaunch({ app, BrowserWindow, editor, startup, log = console }) {
  // After a first copy or recovery the old origin was just read; after applying staged changes it
  // may have changed again since they were staged.
  if (!startup?.deferred && !startup?.applied) return;
  const delayMs = envMs("VERYNIZE_STORAGE_PROBE_DELAY_MS", PROBE_DELAY);
  const timeout = envMs("VERYNIZE_STORAGE_PROBE_TIMEOUT_MS", TIMEOUT);
  const controller = new AbortController();
  let timer;
  const quit = () => {
    clearTimeout(timer);
    controller.abort();
  };
  app.once("before-quit", quit);
  const run = async () => {
    const result = await probeStorage({ app, BrowserWindow, timeout, signal: controller.signal });
    app.removeListener("before-quit", quit);
    if (controller.signal.aborted) return;
    if (result.staged) stagedNotice(app, BrowserWindow);
    if (result.error) log.warn?.(`Storage probe failed (will retry next launch): ${result.error}`);
    await writeJson(path.join(app.getPath("userData"), PROBE), {
      at: new Date().toISOString(),
      startup: { elapsedMs: startup.elapsedMs, windows: startup.windows },
      delayMs,
      ...result,
    });
  };
  const start = () => {
    if (!controller.signal.aborted)
      timer = setTimeout(
        () => run().catch((error) => log.warn?.("Storage probe:", error)),
        delayMs,
      );
  };
  if (editor && !editor.isDestroyed() && editor.webContents.isLoading())
    editor.webContents.once("did-stop-loading", start);
  else start();
}

module.exports = {
  migrateStorage,
  probeAfterLaunch,
  probeStorage,
  hasFileOriginData,
  readMarker,
  MARKER,
  REPLACED,
  STAGED,
  PROBE,
  MAX_ATTEMPTS,
};
