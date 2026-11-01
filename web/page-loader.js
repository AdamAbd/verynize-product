// Lazy pages of shared rooms. A room joins with its metadata, its page index and the active page
// (cloud/rooms.js `lazy=1`); the other pages are stubs ({...properties, nodes: []}) until they
// are fetched. This module keeps which pages are unloaded and is the one place the editor asks for
// them: web/app.js calls `render(design)` on every render (a page switch fetches the page and shows
// a loading state), whole-document features call `ensureAll()` first (save, templates, the agent
// bridge, publish), and web/cloud-panel.js feeds it the room's snapshots and page messages.
//
// Edits are never lost on an unloaded page:
// - remote operations on its nodes are dropped (`filterRemote`): the page, fetched on the socket
//   that carries the operations, already contains them, and later operations apply on top;
// - local operations on its nodes (made while it loads) wait here (`splitLocal`, `deferredOps`)
//   and are released to the room when the page arrives (`received`).
// API: window.pageLoader (cloud/README.md, "Page storage and lazy pages").
(() => {
  const Ops = window.VerynizeOps;
  const PREFETCH_KEY = "verynize.pages.prefetch"; // "off", or the idle delay in milliseconds
  const PREFETCH_DELAY = 1500;
  const WAIT_MS = 30000;
  let unloaded = new Set(),
    wanted = new Set(),
    deferred = [],
    sizes = new Map(),
    source = null,
    waiters = [],
    prefetchTimer = null,
    overlay = null;

  const isUnloaded = (id) => unloaded.has(id);
  const nodeOpOn = (op, ids) => Ops.isNodeOp(op) && ids.has(op.page);
  // Held operations: node edits of a page, and the removal of a page (kept until the page has
  // loaded, so undoing it restores the page with its layers).
  const held = (op) => Ops.isNodeOp(op) || op?.t === "removePage";
  const pageOf = (op) => (op.t === "removePage" ? op.id : op.page);

  function settle() {
    waiters = waiters.filter((waiter) => {
      if (waiter.ids.some((id) => unloaded.has(id))) return true;
      clearTimeout(waiter.timer);
      waiter.resolve();
      return false;
    });
    renderOverlay();
  }
  function forget(id) {
    unloaded.delete(id);
    wanted.delete(id);
    deferred = deferred.filter((op) => pageOf(op) !== id);
  }

  /** Ask the room for pages (once each until they arrive; resent after a reconnect by `resume`). */
  function request(ids) {
    const fresh = ids.filter((id) => unloaded.has(id) && !wanted.has(id));
    for (const id of fresh) wanted.add(id);
    if (fresh.length) source?.request(fresh);
    renderOverlay();
  }

  function ensure(ids) {
    const missing = (ids || [...unloaded]).filter((id) => unloaded.has(id));
    if (!missing.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { ids: missing, resolve, reject };
      waiter.timer = setTimeout(() => {
        waiters = waiters.filter((item) => item !== waiter);
        reject(
          Error(
            "Some pages of this shared design have not loaded yet. Check the connection and try again.",
          ),
        );
      }, WAIT_MS);
      waiters.push(waiter);
      request(missing);
    });
  }

  function schedulePrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
    let setting = null;
    try {
      setting = localStorage.getItem(PREFETCH_KEY);
    } catch {}
    if (setting === "off" || !unloaded.size || !source) return;
    const delay =
      Number.isFinite(Number(setting)) && setting !== null ? Number(setting) : PREFETCH_DELAY;
    prefetchTimer = setTimeout(() => {
      const run = () => {
        // Smallest pages first, so most of the document is usable soonest.
        const ids = [...unloaded].sort((a, b) => (sizes.get(a) || 0) - (sizes.get(b) || 0));
        request(ids);
      };
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 2000 });
      else run();
    }, delay);
  }

  function activePageId() {
    try {
      return window.design?.getView?.().page ?? null;
    } catch {
      return null;
    }
  }
  function renderOverlay(active = activePageId()) {
    const workspace = document.getElementById("workspace");
    if (!workspace) return;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "page-loading";
      overlay.setAttribute("role", "status");
      overlay.hidden = true;
      workspace.append(overlay);
    }
    const loading = !!active && unloaded.has(active);
    overlay.hidden = !loading;
    document.body.classList.toggle("page-loading", loading);
    if (loading)
      overlay.textContent = source?.online?.()
        ? "Loading page…"
        : "This page loads when the shared room is reachable.";
  }

  window.pageLoader = Object.freeze({
    /** web/app.js render hook: fetch the shown page when it is not loaded yet. */
    render(design) {
      const active = design?.activePage;
      if (active && unloaded.has(active)) request([active]);
      renderOverlay(active);
    },
    isUnloaded,
    unloadedIds: () => [...unloaded],
    /**
     * A room snapshot: `ids` are its stub pages, `pages` its index ({id, bytes}). Deferred edits of
     * pages that are loaded now are returned, for the caller to send.
     */
    reset(ids = [], pages = []) {
      unloaded = new Set(ids);
      wanted = new Set([...wanted].filter((id) => unloaded.has(id)));
      sizes = new Map((pages || []).map((page) => [page.id, page.bytes]));
      const released = deferred.filter((op) => !unloaded.has(pageOf(op)));
      deferred = deferred.filter((op) => unloaded.has(pageOf(op)));
      settle();
      schedulePrefetch();
      return released;
    },
    /** Stored state for the room outbox (web/cloud-panel.js), and its restore. */
    stored: () => ({ unloaded: [...unloaded], deferred: deferred.slice() }),
    restore(state) {
      unloaded = new Set(Array.isArray(state?.unloaded) ? state.unloaded : []);
      deferred = Array.isArray(state?.deferred) ? state.deferred.filter(held) : [];
      wanted.clear();
      settle();
    },
    /** Remote operations to apply to the confirmed document: none on unloaded pages' nodes. */
    filterRemote(ops) {
      if (!unloaded.size) return ops;
      for (const op of ops)
        if (op?.t === "removePage") forget(op.id);
        else if (op?.t === "root") {
          unloaded.clear();
          wanted.clear();
          deferred = [];
        }
      const result = ops.filter((op) => !nodeOpOn(op, unloaded));
      settle();
      return result;
    },
    /**
     * Local operations: those on unloaded pages' nodes, and removals of unloaded pages, wait for
     * the page, which is requested (a reorder of such a page only lists local layers, so it is
     * dropped); the rest are returned to send now.
     */
    splitLocal(ops) {
      if (!unloaded.size) return ops;
      const now = [],
        waiting = [];
      for (const op of ops) {
        if (op?.t === "removePage" && unloaded.has(op.id)) {
          deferred.push(op);
          waiting.push(op.id);
        } else if (!nodeOpOn(op, unloaded)) now.push(op);
        else if (op.t !== "nodeOrder") deferred.push(op);
      }
      if (waiting.length) request(waiting);
      return now;
    },
    /** Local operations waiting for their pages (applied on top of the editor document). */
    deferredOps: () => deferred,
    /** A page arrived: it is loaded now. Returns its deferred local operations to send. */
    received(id) {
      const mine = deferred.filter((op) => pageOf(op) === id);
      deferred = deferred.filter((op) => pageOf(op) !== id);
      unloaded.delete(id);
      wanted.delete(id);
      settle();
      return mine;
    },
    /** A requested page does not exist (any more). */
    missing(id) {
      forget(id);
      settle();
    },
    /**
     * `doc` with the loaded `page` in place of its stub, keeping layers added to the stub
     * locally (collaborative undo steps recorded while the page loaded).
     */
    fill(doc, page) {
      if (!Ops.isStructured(doc)) return doc;
      const index = doc.pages.findIndex((item) => item.id === page.id);
      if (index < 0) return doc;
      const known = new Set(page.nodes.map((node) => node.id));
      const extra = doc.pages[index].nodes.filter((node) => !known.has(node.id));
      const pages = doc.pages.slice();
      pages[index] = { ...page, nodes: page.nodes.concat(extra) };
      return { ...doc, pages };
    },
    /** Connect a page source ({request(ids), online()}); null when the room closes. */
    attach(next) {
      source = next;
      if (!next) {
        clearTimeout(prefetchTimer);
        unloaded.clear();
        wanted.clear();
        deferred = [];
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(Error("The shared room closed before its pages loaded"));
        }
        waiters = [];
      }
      renderOverlay();
    },
    /** The source can send again (socket synced): ask for every page still wanted. */
    resume() {
      const ids = [...wanted].filter((id) => unloaded.has(id));
      if (ids.length) source?.request(ids);
      renderOverlay();
      schedulePrefetch();
    },
    /** Resolves when the pages are loaded (every unloaded page without ids). */
    ensure,
    ensureAll: () => ensure(null),
    /** Diagnostics and tests. */
    state: () => ({
      unloaded: [...unloaded],
      requested: [...wanted],
      deferred: deferred.length,
    }),
  });
})();
