'use strict';
// Canvas layers for web/app.js render(): one element per node, kept by node id from one render to the next. A render
// compares every node with what its element last drew (its own fields, its parent's layout, selection, variables,
// whether it is the last in-flow child) and redraws only the elements that differ, in place. Children are moved into
// their parent's element, never rebuilt with it, so an edit restyles and re-rasters only what it changed.
// layerElement() still builds detached trees from scratch for export (exportHTML, exportArtwork, print).
// Live previews (n.preview) keep the element web/live-preview.js owns and are redrawn on every render, as before.
// Other code that writes into a layer element (the text editor, drag offsets, inspector colour previews, a shader
// fallback) is seen by a MutationObserver: that element is redrawn from its node on the next render, which is what the
// old full rebuild did for it. localStorage 'verynize.canvas-render' = 'full' rebuilds every element on every render.
(() => {
  const CORNERS = ['nw', 'ne', 'sw', 'se'];
  // Fields that move or rename a node without changing how its children are styled.
  const PLACEMENT = new Set(['x', 'y', 'name']);
  // Attributes other scripts maintain on layer elements themselves (shader status, the clip-proof selection ring).
  const KEPT_ATTRIBUTES = new Set(['data-shader-status', 'data-shader-kind', 'data-clip-ring']);
  const PREVIEW = Symbol('preview');

  // Deep equality for the JSON-like values a node holds.
  function same(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    let count = 0;
    for (const k in a) { if (!(k in b) || !same(a[k], b[k])) return false; count++; }
    for (const _k in b) count--;
    return count === 0;
  }
  // A node's own fields as drawn; nested values are copied because the editor mutates nodes in place.
  function snapshot(n) {
    const fields = {}; let count = 0;
    for (const k in n) { const v = n[k]; fields[k] = v !== null && typeof v === 'object' ? structuredClone(v) : v; count++; }
    return {fields, count};
  }
  // 0: unchanged, 1: only moved or renamed (children unaffected), 2: anything else.
  function compare(drawn, n) {
    const fields = drawn.fields; let result = 0, count = 0;
    for (const k in n) {
      count++;
      const v = n[k], p = fields[k];
      const equal = v === p ? v !== undefined || k in fields : v !== null && typeof v === 'object' && same(v, p);
      if (!equal) { if (!PLACEMENT.has(k)) return 2; result = 1; }
    }
    return count === drawn.count ? result : 2;
  }

  function install(ed) {
    const {canvas} = ed, NS = () => window.BetterNodeStyle;
    const els = new Map(), memos = new Map(), owner = new WeakMap(), stops = new Map(), dirty = new Set();
    let byId = new Map(), tokensKey = null, version = 0, starting = [];

    // ---------- One layer (shared with export) ----------
    function draw(el, n, editing, parent, ctx) {
      const tokens = ed.design.tokens, S = NS(), selected = editing && ed.getSelection().has(n.id);
      el.className = editing ? 'layer' + (n.type === 'frame' ? ' frame-layer' : '') + (selected ? ' selected' : '') : '';
      el.dataset.id = n.id; el.dataset.designType = n.type; el.dataset.name = n.name;
      const color = tokens[n.token] || n.color;
      const css = S.nodeStyle(n, parent, {color, svgColor: tokens[n.svgColorToken] || n.svgColor, lastInFlow: ctx.lastInFlow, tokens});
      S.applyStyle(el, css.box);
      if (editing && Number(n.outlineWidth) > 0) el.dataset.outline = '';
      if (n.icon) el.dataset.icon = n.icon;
      if (n.type === 'text') for (const seg of S.textSegments(n)) { const span = document.createElement('span'); span.textContent = seg.text; S.applyStyle(span, seg.style); el.append(span); }
      if (n.type === 'shader' || n.shaderFill === true) {
        if (n.type !== 'shader') el.dataset.shaderFill = 'true';
        el.dataset.shaderPreset = n.shaderPreset; el.dataset.shaderSpeed = n.shaderSpeed; el.dataset.shaderIntensity = n.shaderIntensity; el.dataset.shaderColor = color;
        const params = window.BetterShaders.paramsAttr(n, tokens);
        if (params) el.dataset.shaderParams = params; else delete el.dataset.shaderParams;
      }
      if (n.type === 'image' && n.src) {
        const img = document.createElement(css.svgTint ? 'span' : 'img');
        if (css.svgTint) { img.setAttribute('role', 'img'); img.setAttribute('aria-label', n.name); img.dataset.svgColor = 'true'; } else { img.src = css.src || n.src; img.alt = n.name; }
        S.applyStyle(img, css.img); el.append(img);
      }
      if (editing && n.preview) window.livePreview?.renderNode(n, el);
    }
    const lock = el => { el.style.pointerEvents = 'none'; el.dataset.locked = 'true'; };
    function handles(el) {
      for (const corner of CORNERS) { const h = document.createElement('span'); h.className = 'handle'; h.dataset.corner = corner; h.setAttribute('aria-label', 'Resize ' + corner); el.append(h); }
    }
    // A fresh, detached tree (export, and live previews on the canvas).
    function layerElement(n, editing, parent, ctx = {}) {
      const el = (editing && n.preview ? window.livePreview?.nodeElement(n.id) : null) || document.createElement('div');
      el.querySelectorAll(':scope > .handle').forEach(h => h.remove());
      draw(el, n, editing, parent, ctx);
      if (n.type === 'frame' && !n.preview) {
        const kids = ed.nodes().filter(c => c.parentId === n.id), last = NS().lastInFlowId(kids);
        for (const child of kids) el.append(layerElement(child, editing, n, {lastInFlow: child.id === last}));
      }
      if (editing && n.locked) lock(el);
      if (editing && ed.getSelection().has(n.id)) handles(el);
      return el;
    }

    // ---------- Shaders: one running surface per drawn shader element ----------
    function stop(el) { const close = stops.get(el); if (close) { stops.delete(el); close(); } }
    // Started once the render has placed every element: a surface sizes itself from its attached layer.
    function start(el) { if (el.dataset.shaderPreset !== undefined) starting.push(el); }

    // ---------- Keyed canvas render ----------
    function adopt(id, old, el) {
      if (old && old !== el) { stop(old); old.remove(); }
      els.set(id, el); owner.set(el, id);
    }
    // Back to a bare element before it is drawn again; child layer elements stay where they are.
    function reset(el) {
      stop(el);
      while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
      for (let c = el.firstChild, next; c; c = next) { next = c.nextSibling; if (!owner.has(c)) c.remove(); }
    }
    function insert(parent, el, ref) {
      if (parent.moveBefore && el.isConnected && parent.isConnected) { try { parent.moveBefore(el, ref); return; } catch {} } // keeps live previews' iframes running
      parent.insertBefore(el, ref);
    }
    // Child layers in order, after the parent's own content and before its selection handles.
    function place(parent, children) {
      let ref = null;
      for (let c = parent.lastChild; c?.classList?.contains('handle'); c = c.previousSibling) ref = c;
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (c.parentNode !== parent || c.nextSibling !== ref) insert(parent, c, ref);
        ref = c;
      }
    }
    function visit(n, parent, lastInFlow, kids, seen, selection) {
      seen.add(n.id);
      const old = els.get(n.id), drawnAs = memos.get(n.id);
      if (n.preview) {
        const el = layerElement(n, true, parent, {lastInFlow});
        adopt(n.id, old, el); memos.set(n.id, PREVIEW); dirty.delete(n.id);
        stop(el); start(el); // shaders restart with every redraw, as they used to on every render
        return el;
      }
      let el = drawnAs === PREVIEW ? null : old, memo = drawnAs === PREVIEW ? null : drawnAs;
      const selected = selection.has(n.id), parentId = parent ? parent.id : null, parentVer = parent ? memos.get(parent.id)?.layoutVer ?? 0 : 0;
      const change = el && memo ? compare(memo.drawn, n) : 2;
      const redraw = change > 0 || dirty.has(n.id) || memo.selected !== selected || memo.lastInFlow !== lastInFlow || memo.parentId !== parentId || memo.parentVer !== parentVer;
      // The in-canvas text editor owns its element while typing; it is redrawn once editing ends.
      const drawn = redraw && !el?.hasAttribute('data-text-editing');
      if (drawn) {
        if (el) reset(el); else { el = document.createElement('div'); adopt(n.id, old, el); }
        draw(el, n, true, parent, {lastInFlow});
        if (n.locked) lock(el);
        memos.set(n.id, {drawn: snapshot(n), selected, lastInFlow, parentId, parentVer, layoutVer: change === 2 ? ++version : memo.layoutVer});
        dirty.delete(n.id);
      }
      if (n.type === 'frame') {
        const list = kids.get(n.id) || [], last = NS().lastInFlowId(list);
        place(el, list.map(c => visit(c, n, c.id === last, kids, seen, selection)));
      }
      if (drawn) { if (selected) handles(el); start(el); }
      return el;
    }
    function render() {
      absorb(observer.takeRecords());
      if (mode() === 'full') { for (const el of els.values()) stop(el); els.clear(); memos.clear(); dirty.clear(); }
      const list = ed.nodes(), kids = new Map(), seen = new Set(), selection = ed.getSelection();
      byId = new Map();
      for (const n of list) {
        byId.set(n.id, n);
        const p = n.parentId || null, siblings = kids.get(p);
        if (siblings) siblings.push(n); else kids.set(p, [n]);
      }
      const key = JSON.stringify(ed.design.tokens || {});
      if (key !== tokensKey) { tokensKey = key; for (const id of memos.keys()) dirty.add(id); }
      const tops = (kids.get(null) || []).map(n => visit(n, null, false, kids, seen, selection));
      place(canvas, tops);
      if (canvas.childElementCount !== tops.length) { const keep = new Set(tops); for (const c of Array.from(canvas.children)) if (!keep.has(c)) c.remove(); }
      for (const [id, el] of els) if (!seen.has(id)) { stop(el); el.remove(); els.delete(id); memos.delete(id); dirty.delete(id); }
      for (const el of starting) if (el.isConnected) stops.set(el, window.BetterShaders.mount(el));
      starting = [];
      observer.takeRecords(); // this render's own writes
    }

    // ---------- Writes from elsewhere ----------
    function layerOf(node) { for (let x = node; x && x !== canvas; x = x.parentNode) { const id = owner.get(x); if (id !== undefined) return id; } }
    function absorb(records) {
      for (const r of records) {
        if (r.target === canvas || (r.type === 'attributes' && (KEPT_ATTRIBUTES.has(r.attributeName) || r.target.classList.contains('shader-surface')))) continue;
        const id = layerOf(r.target); if (id !== undefined) dirty.add(id);
      }
    }
    const observer = new MutationObserver(absorb);
    observer.observe(canvas, {subtree: true, childList: true, attributes: true, characterData: true});
    function mode() { try { return localStorage.getItem('verynize.canvas-render'); } catch { return null; } }
    // Shaders read preferences (reduced motion) when they start: redraw every layer on the render that follows.
    window.addEventListener('app-preferences-changed', () => { for (const id of memos.keys()) dirty.add(id); });

    return {
      render, layerElement,
      elementOf: id => { const el = els.get(id); return el?.isConnected ? el : null; },
      node: id => byId.get(id),
      invalidate: id => { if (id === undefined) for (const key of memos.keys()) dirty.add(key); else dirty.add(id); },
      stats: () => ({elements: els.size, shaders: stops.size}),
    };
  }
  window.VerynizeCanvasRender = {install};
})();
