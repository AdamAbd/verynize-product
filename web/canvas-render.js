"use strict";
// Canvas layers for web/app.js render(): one element per node, kept by node id from one render to the next. A render
// compares every node with what its element last drew (its own fields, its parent's layout, selection, variables,
// whether it is the last in-flow child) and redraws only the elements that differ, in place. Children are moved into
// their parent's element, never rebuilt with it, so an edit restyles and re-rasters only what it changed.
// layerElement() still builds detached trees from scratch for export (exportHTML, exportArtwork, print).
// Live previews (n.preview) keep the element web/live-preview.js owns and are redrawn on every render, as before.
// Other code that writes into a layer element (the text editor, drag offsets, inspector colour previews, a shader
// fallback) is seen by a MutationObserver: that element is redrawn from its node on the next render, which is what the
// old full rebuild did for it. localStorage 'verynize.canvas-render' = 'full' rebuilds every element on every render.
// Offscreen artboards are culled: see "Culling" below.
(() => {
  const CORNERS = ["nw", "ne", "sw", "se"];
  // Fields that move or rename a node without changing how its children are styled.
  const PLACEMENT = new Set(["x", "y", "name"]);
  // Attributes maintained outside a redraw: shader status, the clip-proof selection ring, a drag in progress
  // (canvas-interactions.js) and culling (below).
  const KEPT_ATTRIBUTES = new Set([
    "data-shader-status",
    "data-shader-kind",
    "data-clip-ring",
    "data-dragging",
    "data-culled",
  ]);
  // Culling: grid cell size (world px), boards revealed per camera step during a gesture, settle delay (ms).
  const CELL = 2048,
    REVEAL = 6,
    SETTLE_MS = 150;
  const PREVIEW = Symbol("preview");

  // Deep equality for the JSON-like values a node holds.
  function same(a, b) {
    if (a === b) return true;
    if (
      a === null ||
      b === null ||
      typeof a !== "object" ||
      typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    let count = 0;
    for (const k in a) {
      if (!(k in b) || !same(a[k], b[k])) return false;
      count++;
    }
    for (const _k in b) count--;
    return count === 0;
  }
  // A node's own fields as drawn; nested values are copied because the editor mutates nodes in place.
  function snapshot(n) {
    const fields = {};
    let count = 0;
    for (const k in n) {
      const v = n[k];
      fields[k] = v !== null && typeof v === "object" ? structuredClone(v) : v;
      count++;
    }
    return { fields, count };
  }
  // 0: unchanged, 1: only moved or renamed (children unaffected), 2: anything else.
  function compare(drawn, n) {
    const fields = drawn.fields;
    let result = 0,
      count = 0;
    for (const k in n) {
      count++;
      const v = n[k],
        p = fields[k];
      const equal =
        v === p
          ? v !== undefined || k in fields
          : v !== null && typeof v === "object" && same(v, p);
      if (!equal) {
        if (!PLACEMENT.has(k)) return 2;
        result = 1;
      }
    }
    return count === drawn.count ? result : 2;
  }

  function install(ed) {
    const { canvas, camera: cam } = ed,
      NS = () => window.BetterNodeStyle;
    const els = new Map(),
      memos = new Map(),
      owner = new WeakMap(),
      stops = new Map(),
      dirty = new Set();
    let byId = new Map(),
      tokensKey = null,
      version = 0,
      starting = [];
    let boards = new Map(),
      grid = new Map(),
      wide = [],
      shown = new Set(),
      boardOf = new Map(),
      redrawn = new Set();
    let view = null,
      lastMove = 0,
      settleTimer = 0,
      cameraMoved = false;

    // ---------- One layer (shared with export) ----------
    function draw(el, n, editing, parent, ctx) {
      const tokens = ed.design.tokens,
        S = NS(),
        selected = editing && ed.getSelection().has(n.id);
      el.className = editing
        ? "layer" + (n.type === "frame" ? " frame-layer" : "") + (selected ? " selected" : "")
        : "";
      el.dataset.id = n.id;
      el.dataset.designType = n.type;
      el.dataset.name = n.name;
      // Component chrome (canvas.css): main, instance root, slot of a main, or slot of an instance.
      const role = !editing
        ? ""
        : n.component === true
          ? "main"
          : n.instanceOf
            ? "instance"
            : n.slot === true
              ? n.sourceId
                ? "instance-slot"
                : "slot"
              : "";
      if (role) el.dataset.component = role;
      else delete el.dataset.component;
      const color = tokens[n.token] || n.color;
      const css = S.nodeStyle(n, parent, {
        color,
        svgColor: tokens[n.svgColorToken] || n.svgColor,
        lastInFlow: ctx.lastInFlow,
        tokens,
      });
      S.applyStyle(el, css.box);
      if (editing && Number(n.outlineWidth) > 0) el.dataset.outline = "";
      if (n.icon) el.dataset.icon = n.icon;
      if (n.type === "text")
        for (const seg of S.textSegments(n)) {
          const span = document.createElement("span");
          span.textContent = seg.text;
          S.applyStyle(span, seg.style);
          el.append(span);
        }
      if (n.type === "shader" || n.shaderFill === true) {
        if (n.type !== "shader") el.dataset.shaderFill = "true";
        el.dataset.shaderPreset = n.shaderPreset;
        el.dataset.shaderSpeed = n.shaderSpeed;
        el.dataset.shaderIntensity = n.shaderIntensity;
        el.dataset.shaderColor = color;
        const params = window.BetterShaders.paramsAttr(n, tokens);
        if (params) el.dataset.shaderParams = params;
        else delete el.dataset.shaderParams;
      }
      if (n.type === "vector") {
        const svg = document.createElement("template");
        svg.innerHTML = window.VerynizeVector.svgMarkup(n, tokens);
        el.append(svg.content);
      }
      if (n.type === "image" && n.src) {
        const img = document.createElement(css.svgTint ? "span" : "img");
        if (css.svgTint) {
          img.setAttribute("role", "img");
          img.setAttribute("aria-label", n.name);
          img.dataset.svgColor = "true";
        } else {
          img.src = css.src || n.src;
          img.alt = n.name;
        }
        S.applyStyle(img, css.img);
        el.append(img);
      }
      if (editing && n.preview) window.livePreview?.renderNode(n, el);
    }
    const lock = (el) => {
      el.style.pointerEvents = "none";
      el.dataset.locked = "true";
    };
    function handles(el) {
      for (const corner of CORNERS) {
        const h = document.createElement("span");
        h.className = "handle";
        h.dataset.corner = corner;
        h.setAttribute("aria-label", "Resize " + corner);
        el.append(h);
      }
    }
    // A fresh, detached tree (export, and live previews on the canvas).
    function layerElement(n, editing, parent, ctx = {}) {
      const el =
        (editing && n.preview ? window.livePreview?.nodeElement(n.id) : null) ||
        document.createElement("div");
      el.querySelectorAll(":scope > .handle").forEach((h) => h.remove());
      draw(el, n, editing, parent, ctx);
      if (n.type === "frame" && !n.preview) {
        const kids = ed.nodes().filter((c) => c.parentId === n.id),
          last = NS().lastInFlowId(kids);
        for (const child of kids)
          el.append(layerElement(child, editing, n, { lastInFlow: child.id === last }));
      }
      if (editing && n.locked) lock(el);
      if (editing && ed.getSelection().has(n.id)) handles(el);
      return el;
    }

    // ---------- Shaders: one running surface per drawn shader element ----------
    function stop(el) {
      const close = stops.get(el);
      if (close) {
        stops.delete(el);
        close();
      }
    }
    // Started once the render has placed every element: a surface sizes itself from its attached layer.
    function start(el) {
      if (el.dataset.shaderPreset !== undefined) starting.push(el);
    }

    // ---------- Keyed canvas render ----------
    function adopt(id, old, el) {
      if (old && old !== el) {
        stop(old);
        old.remove();
      }
      els.set(id, el);
      owner.set(el, id);
    }
    // Back to a bare element before it is drawn again; child layer elements stay where they are.
    function reset(el) {
      stop(el);
      while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
      for (let c = el.firstChild, next; c; c = next) {
        next = c.nextSibling;
        if (!owner.has(c)) c.remove();
      }
    }
    function insert(parent, el, ref) {
      if (parent.moveBefore && el.isConnected && parent.isConnected) {
        try {
          parent.moveBefore(el, ref);
          return;
        } catch {}
      } // keeps live previews' iframes running
      parent.insertBefore(el, ref);
    }
    // Child layers in order, after the parent's own content and before its selection handles.
    function place(parent, children) {
      let ref = null;
      for (let c = parent.lastChild; c?.classList?.contains("handle"); c = c.previousSibling)
        ref = c;
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (c.parentNode !== parent || c.nextSibling !== ref) insert(parent, c, ref);
        ref = c;
      }
    }
    function visit(n, parent, lastInFlow, kids, seen, selection, top = n.id) {
      seen.add(n.id);
      boardOf.set(n.id, top);
      const old = els.get(n.id),
        drawnAs = memos.get(n.id);
      if (n.preview) {
        const el = layerElement(n, true, parent, { lastInFlow });
        adopt(n.id, old, el);
        memos.set(n.id, PREVIEW);
        dirty.delete(n.id);
        stop(el);
        start(el); // shaders restart with every redraw, as they used to on every render
        return el;
      }
      let el = drawnAs === PREVIEW ? null : old,
        memo = drawnAs === PREVIEW ? null : drawnAs;
      const selected = selection.has(n.id),
        parentId = parent ? parent.id : null,
        parentVer = parent ? (memos.get(parent.id)?.layoutVer ?? 0) : 0;
      const change = el && memo ? compare(memo.drawn, n) : 2;
      const redraw =
        change > 0 ||
        dirty.has(n.id) ||
        memo.selected !== selected ||
        memo.lastInFlow !== lastInFlow ||
        memo.parentId !== parentId ||
        memo.parentVer !== parentVer;
      // The in-canvas text editor owns its element while typing; it is redrawn once editing ends.
      const drawn = redraw && !el?.hasAttribute("data-text-editing");
      if (drawn) {
        if (el) reset(el);
        else {
          el = document.createElement("div");
          adopt(n.id, old, el);
        }
        draw(el, n, true, parent, { lastInFlow });
        if (n.locked) lock(el);
        memos.set(n.id, {
          drawn: snapshot(n),
          selected,
          lastInFlow,
          parentId,
          parentVer,
          layoutVer: change === 2 ? ++version : memo.layoutVer,
        });
        dirty.delete(n.id);
        redrawn.add(top);
      }
      if (n.type === "frame") {
        const list = kids.get(n.id) || [],
          last = NS().lastInFlowId(list);
        place(
          el,
          list.map((c) => visit(c, n, c.id === last, kids, seen, selection, top)),
        );
      }
      if (drawn) {
        if (selected) handles(el);
        start(el);
      }
      return el;
    }
    function render() {
      absorb(observer.takeRecords());
      if (mode() === "full") {
        for (const el of els.values()) stop(el);
        els.clear();
        memos.clear();
        dirty.clear();
      }
      const list = ed.nodes(),
        kids = new Map(),
        seen = new Set(),
        selection = ed.getSelection();
      byId = new Map();
      boardOf = new Map();
      redrawn = new Set();
      for (const n of list) {
        byId.set(n.id, n);
        const p = n.parentId || null,
          siblings = kids.get(p);
        if (siblings) siblings.push(n);
        else kids.set(p, [n]);
      }
      const key = JSON.stringify(ed.design.tokens || {});
      if (key !== tokensKey) {
        tokensKey = key;
        for (const id of memos.keys()) dirty.add(id);
      }
      const topNodes = kids.get(null) || [],
        tops = topNodes.map((n) => visit(n, null, false, kids, seen, selection));
      place(canvas, tops);
      if (canvas.childElementCount !== tops.length) {
        const keep = new Set(tops);
        for (const c of Array.from(canvas.children)) if (!keep.has(c)) c.remove();
      }
      for (const [id, el] of els)
        if (!seen.has(id)) {
          stop(el);
          el.remove();
          els.delete(id);
          memos.delete(id);
          dirty.delete(id);
        }
      index(topNodes);
      cull();
      for (const el of starting) if (el.isConnected) stops.set(el, window.BetterShaders.mount(el));
      starting = [];
      observer.takeRecords(); // this render's own writes
    }

    // ---------- Culling: offscreen artboards skip style, layout and paint ----------
    // A top-level frame with a fixed size that clips its content, more than half a viewport outside the view, gets
    // data-culled (content-visibility: hidden, web/canvas.css). Its own box stays laid out and painted (frame labels,
    // fit, marquee); its subtree costs nothing, and layout queries inside it still answer (laid out on demand).
    // Boards are hidden at once. During a camera gesture at most REVEAL boards come back per camera step, nearest
    // first (the board's own fill shows meanwhile), and all of them once the camera settles or the document renders.
    // localStorage 'verynize.canvas-cull' = 'off' turns culling off.
    function culling() {
      try {
        return localStorage.getItem("verynize.canvas-cull") !== "off";
      } catch {
        return true;
      }
    }
    function cullable(n) {
      const S = NS();
      return (
        n.type === "frame" &&
        n.clipContent === true &&
        !n.preview &&
        !n.hidden &&
        S.sizingMode(n, "w", null) === "fixed" &&
        S.sizingMode(n, "h", null) === "fixed" &&
        n.wPct === undefined &&
        n.hPct === undefined &&
        n.minW == null &&
        n.minH == null &&
        !(Number(n.aspectRatio) > 0)
      );
    }
    // World bounds of a top-level box (rotated about its centre).
    function bounds(n) {
      const w = Number(n.w) || 0,
        h = Number(n.h) || 0,
        a = ((Number(n.rotation) || 0) * Math.PI) / 180,
        c = Math.abs(Math.cos(a)),
        s = Math.abs(Math.sin(a));
      const rw = w * c + h * s,
        rh = w * s + h * c,
        cx = (Number(n.x) || 0) + w / 2,
        cy = (Number(n.y) || 0) + h / 2;
      return { x0: cx - rw / 2, y0: cy - rh / 2, x1: cx + rw / 2, y1: cy + rh / 2 };
    }
    const cells = (b, fn) => {
      for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++)
        for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++)
          fn(gx + "," + gy);
    };
    function index(topNodes) {
      boards = new Map();
      grid = new Map();
      wide = [];
      for (const n of topNodes) {
        const el = els.get(n.id);
        if (!el) continue;
        if (!cullable(n)) {
          if (el.hasAttribute("data-culled")) el.removeAttribute("data-culled");
          continue;
        }
        const b = { el, ...bounds(n) };
        boards.set(n.id, b);
        if ((b.x1 - b.x0) * (b.y1 - b.y0) > 64 * CELL * CELL) wide.push(n.id);
        else
          cells(b, (key) => {
            const list = grid.get(key);
            if (list) list.push(n.id);
            else grid.set(key, [n.id]);
          });
      }
      shown = new Set(
        [...boards].filter(([, b]) => !b.el.hasAttribute("data-culled")).map(([id]) => id),
      );
    }
    function cull(budget = Infinity) {
      clearTimeout(settleTimer);
      cameraMoved = false;
      if (!view) {
        const r = canvas.parentElement?.getBoundingClientRect();
        view = { w: r?.width || 0, h: r?.height || 0 };
      }
      const near = new Set(),
        z = cam.zoom || 1;
      if (!culling() || !view.w || !view.h) for (const id of boards.keys()) near.add(id); // off, or no viewport: all show
      else {
        const mx = view.w / z / 2,
          my = view.h / z / 2;
        const v = {
          x0: -cam.x / z - mx,
          y0: -cam.y / z - my,
          x1: (view.w - cam.x) / z + mx,
          y1: (view.h - cam.y) / z + my,
        };
        const test = (id) => {
          const b = boards.get(id);
          if (b.x1 >= v.x0 && b.x0 <= v.x1 && b.y1 >= v.y0 && b.y0 <= v.y1) near.add(id);
        };
        cells(v, (key) => grid.get(key)?.forEach(test));
        wide.forEach(test);
      }
      for (const id of shown)
        if (!near.has(id)) {
          boards.get(id).el.setAttribute("data-culled", "");
          shown.delete(id);
        }
      let reveal = [...near].filter((id) => !shown.has(id));
      if (reveal.length > budget) {
        const cx = -cam.x / z + view.w / z / 2,
          cy = -cam.y / z + view.h / z / 2;
        const d = (id) => {
          const b = boards.get(id);
          return Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
        };
        reveal = reveal.sort((a, b) => d(a) - d(b)).slice(0, budget);
        settleTimer = setTimeout(() => cull(), SETTLE_MS);
      }
      for (const id of reveal) {
        boards.get(id).el.removeAttribute("data-culled");
        shown.add(id);
      }
    }
    // A camera step (the transform written on #canvas): steps closer than 100 ms apart are a gesture.
    function moved() {
      const now = performance.now(),
        gesture = now - lastMove < 100;
      lastMove = now;
      cull(gesture ? REVEAL : Infinity);
    }
    if (typeof ResizeObserver === "function" && canvas.parentElement)
      new ResizeObserver(([entry]) => {
        view = { w: entry.contentRect.width, h: entry.contentRect.height };
        cull();
      }).observe(canvas.parentElement);

    // ---------- Writes from elsewhere ----------
    function layerOf(node) {
      for (let x = node; x && x !== canvas; x = x.parentNode) {
        const id = owner.get(x);
        if (id !== undefined) return id;
      }
    }
    function absorb(records) {
      for (const r of records) {
        if (r.target === canvas) {
          if (r.attributeName === "style") cameraMoved = true;
          continue;
        }
        if (
          r.type === "attributes" &&
          (KEPT_ATTRIBUTES.has(r.attributeName) || r.target.classList.contains("shader-surface"))
        )
          continue;
        const id = layerOf(r.target);
        if (id !== undefined) dirty.add(id);
      }
    }
    const observer = new MutationObserver((records) => {
      absorb(records);
      if (cameraMoved) moved();
    });
    observer.observe(canvas, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    function mode() {
      try {
        return localStorage.getItem("verynize.canvas-render");
      } catch {
        return null;
      }
    }
    // Shaders read preferences (reduced motion) when they start: redraw every layer on the render that follows.
    window.addEventListener("app-preferences-changed", () => {
      for (const id of memos.keys()) dirty.add(id);
    });

    return {
      render,
      layerElement,
      // For measuring right after render(): null inside a culled board this render did not redraw (nothing changed there).
      elementOf: (id) => {
        const el = els.get(id),
          top = boardOf.get(id);
        return el?.isConnected && !(boards.has(top) && !shown.has(top) && !redrawn.has(top))
          ? el
          : null;
      },
      // The node's drawn layer element (map lookup), or null when the renderer holds none in the page.
      layerOf: (id) => {
        const el = els.get(id);
        return el?.isConnected ? el : null;
      },
      node: (id) => byId.get(id),
      stats: () => ({
        elements: els.size,
        shaders: stops.size,
        boards: boards.size,
        culled: boards.size - shown.size,
      }), // diagnostics
    };
  }
  window.VerynizeCanvasRender = { install };
})();
