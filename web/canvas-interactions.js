'use strict';
// Verynize canvas engine: camera, tools, selection, smart guides, clipboard and the
// command/shortcut registry. Independent implementation; app.js passes its editor state in
// through BetterCanvas.install(editor) so this file never reaches into private globals.
(() => {
  const ZOOM_STOPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
  const MIN_ZOOM = ZOOM_STOPS[0], MAX_ZOOM = ZOOM_STOPS.at(-1);
  const SAFE = {top: 48, right: 40, bottom: 96, left: 40};
  const BOARD = {x: 0, y: 0, w: 1000, h: 700};
  const DRAW_TOOLS = new Set(['frame', 'rectangle', 'ellipse', 'text', 'shader']);
  const TOOL_BUTTONS = {move: 'select-tool', scale: 'scale-tool', hand: 'pan-tool', eyedropper: 'eyedropper-tool', frame: 'add-frame', rectangle: 'rectangle', ellipse: 'add-ellipse', text: 'text', shader: 'add-shader'};
  const STYLE_KEYS = ['color', 'token', 'gradient', 'radius', 'ellipse', 'strokeWidth', 'strokeColor', 'shadow', 'opacity', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'mask', 'animated', 'clipContent'];
  const CLIP_MARKER = 'verynize/nodes';
  const FRAME_PRESETS = [
    ['Smartphone', [['iPhone 17', 402, 874], ['iPhone 18 Pro', 402, 874], ['iPhone Air', 420, 912], ['iPhone 18 Pro Max', 440, 956]]],
    ['Tablet', [['iPad Air 11"', 820, 1180], ['iPad Mini 8.3"', 744, 1133]]],
    ['Desktop', [['MacBook Air', 1280, 832], ['MacBook Pro 14"', 1512, 982], ['MacBook Pro 16"', 1728, 1117], ['Desktop', 1920, 1080], ['TV', 3840, 2160]]],
    ['Presentation', [['Slide 16:9', 1920, 1080], ['Slide 4:3', 1024, 768]]],
  ];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const typing = target => !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);

  function install(ed) {
    const $ = s => document.querySelector(s);
    const {canvas, camera: cam} = ed;
    const wrap = $('#canvas-wrap'), workspace = $('#workspace');
    let tool = 'move', space = false, autoFit = true, lastPage = null, clipboard = null, styleClipboard = null, pasteTimer = null, pendingInPlace = false, suppressPasteUntil = 0, menu = null;
    const drilled = new Set(), cameras = new Map();
    const find = id => ed.nodes().find(n => n.id === id);
    const sel = () => ed.getSelection();
    const selectedNodes = () => ed.nodes().filter(n => sel().has(n.id));
    const isFlow = n => !!n && n.type === 'frame' && n.layout !== 'free';
    const elementOf = id => canvas.querySelector('[data-id="' + CSS.escape(id) + '"]');
    const footer = message => { const f = $('#workspace footer') || $('footer'); if (f) f.textContent = message; };

    // ---------- Overlay (screen-space chrome) ----------
    const overlay = document.createElement('div');
    overlay.id = 'canvas-overlay';
    overlay.innerHTML = '<svg class="guide-layer" xmlns="http://www.w3.org/2000/svg"></svg><div class="guide-labels"></div><div class="frame-labels"></div><div class="marquee" hidden></div>';
    wrap.append(overlay);
    const guideSvg = overlay.querySelector('.guide-layer'), guideLabels = overlay.querySelector('.guide-labels'), frameLabels = overlay.querySelector('.frame-labels'), marqueeBox = overlay.querySelector('.marquee');

    // ---------- Camera ----------
    const viewport = () => wrap.getBoundingClientRect();
    function applyCamera() {
      canvas.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
      canvas.style.setProperty('--iz', String(1 / cam.zoom));
      const label = $('#zoom-reset'); if (label) label.textContent = Math.round(cam.zoom * 100) + '%';
      if (lastPage) cameras.set(lastPage, {...cam});
      ed.updateMeasurement();
      drawFrameLabels();
    }
    function setCamera(x, y, zoom, fitting = false) {
      cam.x = x; cam.y = y; cam.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM); autoFit = fitting; applyCamera();
    }
    function screenToWorld(clientX, clientY) {
      const r = viewport();
      return {x: (clientX - r.left - cam.x) / cam.zoom, y: (clientY - r.top - cam.y) / cam.zoom};
    }
    const toScreenX = x => x * cam.zoom + cam.x, toScreenY = y => y * cam.zoom + cam.y;
    function zoomAt(zoom, clientX, clientY) {
      const r = viewport(), z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      const wx = (clientX - r.left - cam.x) / cam.zoom, wy = (clientY - r.top - cam.y) / cam.zoom;
      setCamera(clientX - r.left - wx * z, clientY - r.top - wy * z, z);
    }
    function zoomCenter(zoom) { const r = viewport(); zoomAt(zoom, r.left + r.width / 2, r.top + r.height / 2); }
    function stepZoom(direction) {
      const z = cam.zoom;
      const next = direction > 0 ? (ZOOM_STOPS.find(s => s > z * 1.001) ?? MAX_ZOOM) : (ZOOM_STOPS.findLast(s => s < z / 1.001) ?? MIN_ZOOM);
      zoomCenter(next);
    }
    // World-space bounds of a rendered node (axis-aligned; includes rotation and flow layout).
    function worldRect(id) {
      const el = elementOf(id); if (!el) return null;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null;
      const v = viewport();
      return {x: (r.left - v.left - cam.x) / cam.zoom, y: (r.top - v.top - cam.y) / cam.zoom, w: r.width / cam.zoom, h: r.height / cam.zoom};
    }
    function union(rects) {
      rects = rects.filter(Boolean); if (!rects.length) return null;
      const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
      return {x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y};
    }
    function fitBounds(b, maxZoom = MAX_ZOOM, fitting = false) {
      const r = viewport(); if (!b || !r.width || !r.height) return;
      const aw = Math.max(40, r.width - SAFE.left - SAFE.right), ah = Math.max(40, r.height - SAFE.top - SAFE.bottom);
      const z = clamp(Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h), maxZoom), MIN_ZOOM, MAX_ZOOM);
      setCamera(SAFE.left + (aw - b.w * z) / 2 - b.x * z, SAFE.top + (ah - b.h * z) / 2 - b.y * z, z, fitting);
    }
    function contentBounds() {
      const tops = ed.nodes().filter(n => !n.parentId && !n.hidden);
      const rects = tops.map(n => worldRect(n.id));
      if (!tops.some(n => n.type === 'frame')) rects.push(BOARD);
      return union(rects) || BOARD;
    }
    const fit = (initial = false) => fitBounds(contentBounds(), initial ? 1 : MAX_ZOOM, true);
    function zoomToSelection() { const b = union([...sel()].map(worldRect)); if (b) fitBounds(b); else fit(); }
    function placeInView(w, h) {
      const r = viewport(), c = screenToWorld(r.left + r.width / 2, r.top + (r.height - SAFE.bottom + SAFE.top) / 2);
      return {x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2)};
    }
    function visibleWorld() { const r = viewport(), a = screenToWorld(r.left, r.top), b = screenToWorld(r.right, r.bottom); return {x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y}; }
    const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    workspace.addEventListener('wheel', e => {
      if (e.target.closest('#canvas-toolbar, .canvas-title, #frame-presets, #canvas-menu, dialog')) return;
      e.preventDefault();
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= viewport().width; dy *= viewport().height; }
      if (e.ctrlKey || e.metaKey) {
        const k = Math.abs(dy) < 20 ? 8 : 1; // trackpad pinch sends small deltas
        zoomAt(cam.zoom * Math.pow(1.002, -dy * k), e.clientX, e.clientY);
      } else {
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        setCamera(cam.x - dx, cam.y - dy, cam.zoom);
      }
    }, {passive: false});
    // Opening or closing a panel on the left (layers, chat dock, chats sidebar) moves the viewport's left edge: shift the
    // camera by the same amount so the artwork stays put on screen instead of sliding with the panel (panels are ≥200px
    // wide; smaller moves are start-up layout settling).
    let viewportLeft = null, panelToggledAt = -Infinity;
    new MutationObserver(() => { panelToggledAt = performance.now(); }).observe(document.body, {attributes: true, attributeFilter: ['class']});
    new ResizeObserver(() => {
      const left = viewport().left, moved = viewportLeft !== null && Math.abs(left - viewportLeft) >= 100 && performance.now() - panelToggledAt < 1000;
      if (moved) { cam.x -= left - viewportLeft; autoFit = false; }
      viewportLeft = left;
      if (autoFit) fit(true); else applyCamera();
    }).observe(wrap);
    // Bring a layer into view by moving the camera (scrolling cannot reach negative world space).
    function reveal(id) {
      const b = worldRect(id); if (!b) return;
      const v = visibleWorld();
      if (b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h) return;
      const r = viewport();
      if (b.w * cam.zoom > r.width - SAFE.left - SAFE.right || b.h * cam.zoom > r.height - SAFE.top - SAFE.bottom) { fitBounds(b, cam.zoom); return; }
      setCamera(r.width / 2 - (b.x + b.w / 2) * cam.zoom, (r.height + SAFE.top - SAFE.bottom) / 2 - (b.y + b.h / 2) * cam.zoom, cam.zoom);
    }
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      const layer = canvas.contains(this) && this !== canvas ? this.closest('.layer') : null;
      if (layer?.dataset.id) { reveal(layer.dataset.id); return; }
      return nativeScrollIntoView.apply(this, args);
    };
    // The viewport never scrolls natively; programmatic scrolls (e.g. scrollIntoView) become camera pans.
    for (const scroller of [wrap, workspace]) scroller.addEventListener('scroll', () => {
      const dx = scroller.scrollLeft, dy = scroller.scrollTop; if (!dx && !dy) return;
      scroller.scrollLeft = 0; scroller.scrollTop = 0; setCamera(cam.x - dx, cam.y - dy, cam.zoom);
    });

    // ---------- Tools ----------
    function setTool(next) {
      if (next === 'image') { setTool('move'); $('#image')?.click(); return; }
      const previous = tool;
      tool = TOOL_BUTTONS[next] ? next : 'move';
      workspace.dataset.tool = tool;
      for (const [name, id] of Object.entries(TOOL_BUTTONS)) document.getElementById(id)?.classList.toggle('tool-active', name === tool);
      const presets = $('#frame-presets'); if (presets) presets.hidden = tool !== 'frame';
      if (tool === 'eyedropper' && previous !== 'eyedropper') openEyedropper();
    }
    // Legacy command buttons for the tools added here; the chrome island takes their ids over (toolbar / app menu).
    for (const [id, label, run] of [['eyedropper-tool', 'Eyedropper', () => setTool(tool === 'eyedropper' ? 'move' : 'eyedropper')], ['add-ellipse', 'Ellipse', () => insertEllipse()]]) {
      if (document.getElementById(id)) continue;
      const b = document.createElement('button'); b.type = 'button'; b.id = id; b.hidden = true; b.textContent = label; b.setAttribute('aria-label', label); b.onclick = run;
      document.body.append(b); // not in the legacy toolbar: wonder-shell.js rebuilds that one
    }
    function insertEllipse(extra = {}) { ed.add('rectangle', {name: 'Ellipse', ellipse: true, w: 200, h: 200, radius: 0, ...extra}); }

    // ---------- Eyedropper (I): pick a screen color and apply it to the selection's fill (text: ink) ----------
    const hexOf = value => {
      const m = String(value).match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
      if (m) return m[4] !== undefined && parseFloat(m[4]) === 0 ? null : '#' + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, '0')).join('');
      return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    };
    function applyPickedColor(hex) {
      const list = selectedNodes().filter(n => !n.locked);
      writeSystemClipboard(hex);
      if (!list.length) { footer('Picked ' + hex + ' (copied)'); return false; }
      ed.checkpoint();
      for (const n of list) { n.color = hex; n.token = ''; if (n.type !== 'text') n.gradient = ''; }
      ed.render(); footer('Applied ' + hex);
      return true;
    }
    let eyedropperRun = 0;
    async function openEyedropper() {
      const run = ++eyedropperRun;
      if (typeof window.EyeDropper !== 'function') { footer('Click the canvas to pick a color'); return; }
      try {
        const result = await new window.EyeDropper().open();
        if (run !== eyedropperRun || tool !== 'eyedropper') return;
        const hex = hexOf(result?.sRGBHex);
        if (hex) applyPickedColor(hex);
        setTool('move');
      } catch (error) {
        if (run !== eyedropperRun) return;
        // Cancelled by the user (Escape): leave the tool. Otherwise (e.g. no user activation) pick by clicking a layer.
        if (error?.name === 'AbortError') setTool('move'); else footer('Click the canvas to pick a color');
      }
    }
    // Fallback picker: the painted color of the layer under the pointer (image pixels are sampled).
    function colorAt(clientX, clientY) {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!canvas.contains(el) || el === canvas) continue;
        if (el.tagName === 'IMG' && el.complete && el.naturalWidth) {
          try {
            const r = el.getBoundingClientRect(), c = document.createElement('canvas'); c.width = c.height = 1;
            const ctx = c.getContext('2d'); ctx.drawImage(el, (clientX - r.left) / r.width * el.naturalWidth, (clientY - r.top) / r.height * el.naturalHeight, 1, 1, 0, 0, 1, 1);
            const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data; if (alpha) return hexOf(`rgb(${red}, ${green}, ${blue})`);
          } catch {}
          continue;
        }
        const layer = el.closest('.layer'); if (!layer) continue;
        const style = getComputedStyle(el), own = el === layer ? layer.dataset.designType === 'text' ? hexOf(style.color) : hexOf(style.backgroundColor) : el.tagName === 'SPAN' ? hexOf(style.color) : null;
        if (own) return own;
      }
      return null;
    }

    // ---------- Selection helpers ----------
    function pathTo(id) { const path = []; let n = find(id); while (n) { path.unshift(n); n = n.parentId ? find(n.parentId) : null; } return path; }
    function resolveHit(hitId) {
      const deep = window.appPreferences?.get?.().selection !== 'classic';
      if (deep) return hitId;
      const scope = new Set(drilled);
      for (const n of selectedNodes()) if (n.parentId) scope.add(n.parentId);
      const path = pathTo(hitId);
      // Descend from the root while the current frame is part of the drilled/selection scope.
      let depth = 0;
      while (depth < path.length - 1 && scope.has(path[depth].id)) depth++;
      return path[depth]?.id ?? hitId;
    }
    // Selected nodes without any selected ancestor.
    function topSelected() {
      const list = selectedNodes();
      return list.filter(n => !list.some(o => o.id !== n.id && ed.descendants(o.id).has(n.id)));
    }
    function select(ids) { ed.setSelection(new Set(ids)); ed.render(); }
    function clearSelection() { drilled.clear(); select([]); }

    // Lazy undo: only record history once a gesture actually changes something.
    function gesture() {
      const before = ed.snapshot(); let committed = false;
      return {commit() { if (!committed) { ed.pushHistory(before); committed = true; } }, get committed() { return committed; }};
    }

    // ---------- Pointer: pan / move / resize / marquee / draw ----------
    function track(e, move, end) {
      const up = ev => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); end?.(ev); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      e.preventDefault();
    }
    function startPan(e) {
      const start = {x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y};
      workspace.classList.add('panning');
      track(e, ev => setCamera(start.cx + ev.clientX - start.x, start.cy + ev.clientY - start.y, cam.zoom), () => workspace.classList.remove('panning'));
    }
    wrap.addEventListener('pointerdown', e => {
      closeMenu();
      if (e.target.closest('.frame-label')) return;
      if (space || tool === 'hand' || e.button === 1) { startPan(e); return; }
      if (e.button !== 0) return;
      if (tool === 'eyedropper') { e.preventDefault(); const hex = colorAt(e.clientX, e.clientY); if (hex) { eyedropperRun++; applyPickedColor(hex); setTool('move'); } return; }
      if (DRAW_TOOLS.has(tool)) { startDraw(e); return; }
      const handle = e.target.closest('#canvas .handle');
      if (handle) { startResize(e, handle.closest('.layer').dataset.id, handle.dataset.corner); return; }
      const el = e.target.closest('#canvas .layer');
      if (!el) { startMarquee(e); return; }
      const id = resolveHit(el.dataset.id);
      if (e.shiftKey) { const next = new Set(sel()); if (next.has(id)) next.delete(id); else next.add(id); select(next); e.preventDefault(); return; }
      if (!sel().has(id)) select([id]);
      startMove(e);
    });
    wrap.addEventListener('dblclick', e => {
      const el = e.target.closest('#canvas .layer'); if (!el) return;
      const path = pathTo(el.dataset.id), current = path.findIndex(n => sel().has(n.id));
      let target = path.at(-1);
      if (current >= 0 && current < path.length - 1) { drilled.add(path[current].id); target = path[current + 1]; }
      else if (current < 0) target = find(resolveHit(el.dataset.id));
      select([target.id]);
      if (target.type === 'text' && current === path.length - 1) editText();
    });
    function editText() { const t = $('#inspector')?.elements.text; if (t) { t.focus(); t.select(); } }

    function guideTargets(moving) {
      const first = find(moving[0]); if (!first) return [];
      const excluded = new Set(moving.flatMap(id => [...ed.descendants(id)]));
      const targets = ed.nodes().filter(n => (n.parentId || null) === (first.parentId || null) && !excluded.has(n.id) && !n.hidden).map(n => worldRect(n.id)).filter(Boolean);
      if (first.parentId) { const p = worldRect(first.parentId); if (p) targets.push({...p, parent: true}); }
      return targets;
    }
    // Inset [top, right, bottom, left] in px for an absolute child of a flow frame (offsets are measured
    // inside the parent's border; % offsets resolve against it). Without offsets, left/top come from x/y.
    function insetStart(n) {
      const p = find(n.parentId) || {}, b = Array.isArray(p.strokeWidths) && p.strokeWidths.length === 4 ? p.strokeWidths.map(v => Number(v) || 0) : Array(4).fill(Number(p.strokeWidth) || 0);
      const cbW = (Number(p.w) || 0) - b[1] - b[3], cbH = (Number(p.h) || 0) - b[0] - b[2];
      const ins = (Array.isArray(n.inset) ? n.inset : [null, null, null, null]).map((v, i) => (v === null || v === undefined ? null : typeof v === 'string' ? parseFloat(v) / 100 * (i % 2 ? cbW : cbH) : Number(v) || 0));
      if (ins[1] === null && ins[3] === null) ins[3] = n.x - b[3];
      if (ins[0] === null && ins[2] === null) ins[0] = n.y - b[0];
      return ins;
    }
    function startMove(e) {
      let moving = topSelected().filter(n => !n.locked).map(n => n.id);
      if (!moving.length) return;
      const g = gesture(), start = {x: e.clientX, y: e.clientY};
      let starts = null, box = null, targets = null;
      const begin = ev => {
        g.commit();
        if (ev.altKey) moving = duplicateNodes(moving, 0);
        starts = moving.map(find).filter(n => n && (!isFlow(find(n.parentId)) || n.position === 'absolute')).map(n => ({n, x: n.x, y: n.y, inset: isFlow(find(n.parentId)) ? insetStart(n) : null}));
        box = union(moving.map(worldRect)); targets = guideTargets(moving);
      };
      track(e, ev => {
        let dx = (ev.clientX - start.x) / cam.zoom, dy = (ev.clientY - start.y) / cam.zoom;
        if (!starts) { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return; begin(ev); }
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let guides = [];
        if (box && $('#snap')?.checked !== false && !ev.metaKey && !ev.ctrlKey) {
          const snapped = snapBox({...box, x: box.x + dx, y: box.y + dy}, targets);
          dx += snapped.dx; dy += snapped.dy; guides = snapped.guides;
        }
        const r2 = v => Math.round(v * 100) / 100;
        for (const s of starts) {
          s.n.x = r2(s.x + dx); s.n.y = r2(s.y + dy);
          // Absolute child of a flow frame: the renderer places it from `inset`, so shift the offsets it uses.
          if (s.inset) s.n.inset = s.inset.map((v, i) => (v === null ? null : r2(v + [dy, -dx, -dy, dx][i])));
        }
        ed.render(); drawGuides(guides);
      }, () => drawGuides([]));
    }

    // Snap a moving box to sibling/parent edges and centers, or to equal spacing.
    function snapBox(box, targets) {
      const threshold = 6 / cam.zoom, result = {dx: 0, dy: 0, guides: []};
      for (const axis of ['x', 'y']) {
        const size = axis === 'x' ? 'w' : 'h', cross = axis === 'x' ? 'y' : 'x', crossSize = axis === 'x' ? 'h' : 'w';
        const edges = b => [b[axis], b[axis] + b[size] / 2, b[axis] + b[size]];
        let best = null;
        for (const t of targets) for (const value of edges(t)) for (const own of edges(box)) {
          const d = value - own; if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, kind: 'edge'};
        }
        // Equal spacing along this axis among targets that overlap on the cross axis.
        const row = targets.filter(t => !t.parent && t[cross] < box[cross] + box[crossSize] && t[cross] + t[crossSize] > box[cross]).sort((a, b) => a[axis] - b[axis]);
        const before = row.filter(t => t[axis] + t[size] <= box[axis] + threshold).at(-1);
        const after = row.find(t => t[axis] >= box[axis] + box[size] - threshold);
        const gaps = [];
        for (let i = 0; i < row.length - 1; i++) { const gap = row[i + 1][axis] - (row[i][axis] + row[i][size]); if (gap > 0) gaps.push({gap, a: row[i], b: row[i + 1]}); }
        const spacing = [];
        if (before && after) { const gap = (after[axis] - before[axis] - before[size] - box[size]) / 2; if (gap >= 0) spacing.push({pos: before[axis] + before[size] + gap, gap}); }
        for (const ref of gaps) {
          if (before) spacing.push({pos: before[axis] + before[size] + ref.gap, gap: ref.gap, ref});
          if (after) spacing.push({pos: after[axis] - ref.gap - box[size], gap: ref.gap, ref});
        }
        for (const s of spacing) { const d = s.pos - box[axis]; if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 0.01)) best = {d, kind: 'spacing', ...s}; }
        if (!best) continue;
        result['d' + axis] = best.d;
        const moved = {...box, [axis]: box[axis] + best.d};
        if (best.kind === 'edge') {
          for (const t of targets) for (const value of edges(t)) if (edges(moved).some(v => Math.abs(v - value) < 0.5)) {
            const lo = Math.min(t[cross], moved[cross]), hi = Math.max(t[cross] + t[crossSize], moved[cross] + moved[crossSize]);
            result.guides.push(axis === 'x' ? {type: 'line', x1: value, y1: lo, x2: value, y2: hi} : {type: 'line', x1: lo, y1: value, x2: hi, y2: value});
          }
        } else {
          const segs = [];
          const prev = row.filter(t => t[axis] + t[size] <= moved[axis] + 0.5).at(-1), next = row.find(t => t[axis] >= moved[axis] + moved[size] - 0.5);
          if (prev && Math.abs(moved[axis] - prev[axis] - prev[size] - best.gap) < 0.5) segs.push([prev[axis] + prev[size], moved[axis]]);
          if (next && Math.abs(next[axis] - moved[axis] - moved[size] - best.gap) < 0.5) segs.push([moved[axis] + moved[size], next[axis]]);
          if (best.ref) segs.push([best.ref.a[axis] + best.ref.a[size], best.ref.b[axis]]);
          const mid = moved[cross] + moved[crossSize] / 2;
          for (const [a, b] of segs) result.guides.push(axis === 'x' ? {type: 'gap', x1: a, y1: mid, x2: b, y2: mid, label: Math.round(best.gap)} : {type: 'gap', x1: mid, y1: a, x2: mid, y2: b, label: Math.round(best.gap)});
        }
      }
      return result;
    }
    function drawGuides(guides, className = '') {
      guideSvg.replaceChildren(); guideLabels.replaceChildren();
      overlay.dataset.guides = String(guides.length);
      for (const g of guides) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', toScreenX(g.x1)); line.setAttribute('y1', toScreenY(g.y1)); line.setAttribute('x2', toScreenX(g.x2)); line.setAttribute('y2', toScreenY(g.y2));
        line.setAttribute('class', 'guide guide-' + g.type + (className ? ' ' + className : ''));
        guideSvg.append(line);
        if (g.label !== undefined) {
          const label = document.createElement('span'); label.className = 'guide-label'; label.textContent = String(g.label);
          label.style.left = (toScreenX(g.x1) + toScreenX(g.x2)) / 2 + 'px'; label.style.top = (toScreenY(g.y1) + toScreenY(g.y2)) / 2 + 'px';
          guideLabels.append(label);
        }
      }
    }

    function startResize(e, id, corner) {
      const n = find(id); if (!n || n.locked) return;
      let total = Number(n.rotation) || 0, ancestor = n;
      while (ancestor.parentId) { ancestor = find(ancestor.parentId); if (!ancestor) break; total += Number(ancestor.rotation) || 0; }
      const s = {x: n.x, y: n.y, w: n.w, h: n.h}, start = {x: e.clientX, y: e.clientY}, g = gesture(), scaling = tool === 'scale';
      const content = scaling ? [...ed.descendants(id)].map(find).filter(Boolean).map(d => ({d, x: d.x, y: d.y, w: d.w, h: d.h, fontSize: d.fontSize, radius: d.radius, gap: d.gap, padding: d.padding, strokeWidth: d.strokeWidth})) : [];
      track(e, ev => {
        g.commit();
        const dx = (ev.clientX - start.x) / cam.zoom, dy = (ev.clientY - start.y) / cam.zoom, angle = total * Math.PI / 180;
        const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
        const sx = (corner.includes('e') ? 1 : -1) * (n.flipX ? -1 : 1), sy = (corner.includes('s') ? 1 : -1) * (n.flipY ? -1 : 1), centered = ev.altKey ? 2 : 1; // handles flip with the layer
        let w = Math.max(10, s.w + sx * localX * centered), h = Math.max(10, s.h + sy * localY * centered);
        if (ev.shiftKey || scaling) { const fx = w / s.w, fy = h / s.h, f = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy; w = Math.max(10, s.w * f); h = Math.max(10, s.h * f); }
        const dw = w - s.w, dh = h - s.h, a = (Number(n.rotation) || 0) * Math.PI / 180, parent = find(n.parentId);
        n.w = w; n.h = h;
        if (n.wMode === 'hug' || n.wMode === 'fill') n.wMode = 'fixed';
        if (n.hMode === 'hug' || n.hMode === 'fill') n.hMode = 'fixed';
        if (!isFlow(parent)) {
          if (ev.altKey) { n.x = s.x - dw / 2; n.y = s.y - dh / 2; }
          else { n.x = s.x + (sx * dw * Math.cos(a) - sy * dh * Math.sin(a) - dw) / 2; n.y = s.y + (sx * dw * Math.sin(a) + sy * dh * Math.cos(a) - dh) / 2; }
        }
        if (scaling) {
          const f = w / s.w;
          for (const c of content) {
            if (c.d.id !== id) { c.d.x = c.x * f; c.d.y = c.y * f; c.d.w = Math.max(1, c.w * f); c.d.h = Math.max(1, c.h * f); }
            c.d.fontSize = clamp(c.fontSize * f, 8, 200); c.d.radius = c.radius * f; c.d.gap = c.gap * f; c.d.padding = c.padding * f; c.d.strokeWidth = c.strokeWidth * f;
          }
        }
        ed.render();
      });
    }

    function startMarquee(e) {
      const additive = e.shiftKey, base = additive ? new Set(sel()) : new Set();
      if (!additive) { drilled.clear(); if (sel().size) select([]); }
      const p0 = screenToWorld(e.clientX, e.clientY);
      track(e, ev => {
        const p1 = screenToWorld(ev.clientX, ev.clientY);
        const rect = {x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y)};
        showMarquee(rect);
        const hits = ed.nodes().filter(n => !n.parentId && !n.hidden && !n.locked).filter(n => { const r = worldRect(n.id); return r && intersects(rect, r); }).map(n => n.id);
        const next = new Set([...base, ...hits]);
        if (next.size !== sel().size || [...next].some(id => !sel().has(id))) select(next);
      }, () => { marqueeBox.hidden = true; });
    }
    function showMarquee(rect, kind = 'select') {
      marqueeBox.hidden = false; marqueeBox.dataset.kind = kind;
      Object.assign(marqueeBox.style, {left: toScreenX(rect.x) + 'px', top: toScreenY(rect.y) + 'px', width: rect.w * cam.zoom + 'px', height: rect.h * cam.zoom + 'px'});
    }

    function frameAt(clientX, clientY) {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!canvas.contains(el) || !el.classList.contains('frame-layer')) continue;
        const n = find(el.dataset.id); if (n && !n.locked && !n.hidden) return n;
      }
      return null;
    }
    function startDraw(e) {
      const kind = tool, p0 = screenToWorld(e.clientX, e.clientY), parent = frameAt(e.clientX, e.clientY);
      let last = p0;
      const rectFor = (p1, square) => {
        let w = p1.x - p0.x, h = p1.y - p0.y;
        if (square) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        return {x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + h), w: Math.abs(w), h: Math.abs(h)};
      };
      let square = false;
      track(e, ev => { last = screenToWorld(ev.clientX, ev.clientY); square = ev.shiftKey; showMarquee(rectFor(last, square), 'draw'); }, () => {
        marqueeBox.hidden = true;
        let r = rectFor(last, square);
        if (r.w * cam.zoom < 3 && r.h * cam.zoom < 3) {
          const size = {frame: [400, 300], rectangle: [200, 150], ellipse: [200, 200], text: [240, 60], shader: [480, 300]}[kind];
          r = {x: p0.x, y: p0.y, w: size[0], h: size[1]};
        }
        r.w = Math.max(10, r.w); r.h = Math.max(10, r.h);
        let x = r.x, y = r.y;
        if (parent) { const pr = worldRect(parent.id); if (pr) { x = r.x - pr.x - (parent.strokeWidth || 0); y = r.y - pr.y - (parent.strokeWidth || 0); } }
        const extra = {x: Math.round(x), y: Math.round(y), w: Math.round(r.w), h: Math.round(r.h), parentId: parent?.id || null};
        if (kind === 'shader') Object.assign(extra, {name: 'Aurora shader', color: '#a58bdd'});
        if (kind === 'text') extra.fontSize = 24;
        setTool('move');
        if (kind === 'ellipse') insertEllipse(extra); else ed.add(kind, extra);
        if (kind === 'text') editText();
      });
    }

    // Alt-hover distance measurement.
    let lastHover = null;
    wrap.addEventListener('pointermove', e => {
      lastHover = e;
      if (e.buttons) return;
      if (e.altKey) measureTo(e); else if (overlay.dataset.measuring) { overlay.dataset.measuring = ''; drawGuides([]); }
    });
    function measureTo(e) {
      const a = union(topSelected().map(n => worldRect(n.id)));
      if (!a) return;
      const el = e.target.closest?.('#canvas .layer');
      let id = el?.dataset.id;
      if (!id || sel().has(id)) id = topSelected()[0]?.parentId;
      const b = id ? worldRect(id) : null;
      overlay.dataset.measuring = '1';
      if (!b) { drawGuides([]); return; }
      const guides = [], cy = a.y + a.h / 2, cx = a.x + a.w / 2;
      const inside = b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h;
      const seg = (x1, y1, x2, y2) => { const len = Math.abs(x2 - x1) + Math.abs(y2 - y1); if (len > 0.01) guides.push({type: 'measure', x1, y1, x2, y2, label: Math.round(len * 10) / 10}); };
      if (inside) { seg(b.x, cy, a.x, cy); seg(a.x + a.w, cy, b.x + b.w, cy); seg(cx, b.y, cx, a.y); seg(cx, a.y + a.h, cx, b.y + b.h); }
      else {
        if (b.x >= a.x + a.w) seg(a.x + a.w, cy, b.x, cy); else if (a.x >= b.x + b.w) seg(b.x + b.w, cy, a.x, cy);
        if (b.y >= a.y + a.h) seg(cx, a.y + a.h, cx, b.y); else if (a.y >= b.y + b.h) seg(cx, b.y + b.h, cx, a.y);
      }
      drawGuides(guides, 'measure');
    }

    // Name labels above top-level frames (artboards); drag a label to move its frame.
    function drawFrameLabels() {
      frameLabels.replaceChildren();
      for (const n of ed.nodes().filter(n => !n.parentId && n.type === 'frame' && !n.hidden)) {
        const r = worldRect(n.id); if (!r || sel().has(n.id)) continue;
        const label = document.createElement('span'); label.className = 'frame-label'; label.textContent = n.name; label.dataset.id = n.id;
        label.style.left = toScreenX(r.x) + 'px'; label.style.top = toScreenY(r.y) - 18 + 'px';
        label.onpointerdown = e => { if (e.button !== 0 || space || tool === 'hand') return; e.stopPropagation(); select(e.shiftKey ? [...sel(), n.id] : [n.id]); if (!e.shiftKey) startMove(e); };
        frameLabels.append(label);
      }
    }

    // ---------- Structure commands ----------
    function insertOrdered(list, items, index) { list.splice(index, 0, ...items); }
    function duplicateNodes(ids, offset = 20) {
      const all = new Set(ids.flatMap(id => [...ed.descendants(id)])), mapping = new Map([...all].map(id => [id, ed.uid()]));
      const copies = ed.nodes().filter(n => all.has(n.id)).map(n => ({...structuredClone(n), id: mapping.get(n.id), parentId: mapping.get(n.parentId) || n.parentId, x: n.x + (all.has(n.parentId) ? 0 : offset), y: n.y + (all.has(n.parentId) ? 0 : offset)}));
      ed.nodes().push(...copies);
      const result = ids.map(id => mapping.get(id));
      ed.setSelection(new Set(result));
      return result;
    }
    function frameSelection() {
      const list = topSelected(); if (!list.length) return null;
      const parentId = list[0].parentId || null;
      if (!list.every(n => (n.parentId || null) === parentId)) { footer('Frame layers that share the same parent.'); return null; }
      const parent = find(parentId), all = ed.nodes(), flow = isFlow(parent);
      const local = new Map(list.map(n => { const el = elementOf(n.id); return [n.id, flow && el ? {x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight} : {x: n.x, y: n.y, w: n.w, h: n.h}]; }));
      const b = union([...local.values()]);
      ed.checkpoint();
      const frame = {...ed.defaults, id: ed.uid(), type: 'frame', name: 'Frame', parentId, x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, w: Math.max(1, b.w), h: Math.max(1, b.h), color: 'transparent', text: '', radius: 0, padding: 0, layout: 'free'};
      for (const n of list) { const r = local.get(n.id); n.parentId = frame.id; n.x = r.x - b.x; n.y = r.y - b.y; }
      const index = Math.max(...list.map(n => all.indexOf(n)));
      insertOrdered(all, [frame], index + 1);
      ed.setSelection(new Set([frame.id])); ed.render();
      return frame;
    }
    function unframeSelection() {
      const frames = topSelected().filter(n => n.type === 'frame'); if (!frames.length) return;
      ed.checkpoint();
      const released = [];
      for (const f of frames) {
        const all = ed.nodes(), kids = all.filter(n => n.parentId === f.id), parent = find(f.parentId);
        const offsets = new Map(kids.map(k => { const el = elementOf(k.id); return [k.id, el ? {x: el.offsetLeft, y: el.offsetTop} : {x: k.x, y: k.y}]; }));
        for (const k of kids) {
          const o = isFlow(f) ? offsets.get(k.id) : {x: k.x, y: k.y};
          k.x = f.x + (f.strokeWidth || 0) + o.x; k.y = f.y + (f.strokeWidth || 0) + o.y; k.parentId = f.parentId || null;
          if (!isFlow(parent) && k.wMode === 'fill') k.wMode = 'fixed';
          if (!isFlow(parent) && k.hMode === 'fill') k.hMode = 'fixed';
        }
        const kidSet = new Set(kids), next = [];
        for (const n of all) { if (n === f) next.push(...kids); else if (!kidSet.has(n)) next.push(n); }
        ed.page().nodes = next;
        released.push(...kids.map(k => k.id));
      }
      ed.setSelection(new Set(released)); ed.render();
    }
    function addAutoLayout() {
      let list = topSelected(); if (!list.length) return;
      let frame = list.length === 1 && list[0].type === 'frame' ? list[0] : null;
      if (frame && isFlow(frame)) return;
      if (!frame) { frame = frameSelection(); if (!frame) return; } else ed.checkpoint();
      const kids = ed.nodes().filter(n => n.parentId === frame.id && !n.hidden);
      const center = (n, axis) => n[axis] + n[axis === 'x' ? 'w' : 'h'] / 2;
      const spread = axis => kids.length ? Math.max(...kids.map(n => center(n, axis))) - Math.min(...kids.map(n => center(n, axis))) : 0;
      const direction = spread('x') >= spread('y') ? 'row' : 'column', axis = direction === 'row' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
      const sorted = kids.toSorted((a, b) => a[axis] - b[axis]);
      const gaps = sorted.slice(1).map((n, i) => n[axis] - sorted[i][axis] - sorted[i][size]);
      const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)) : 16;
      const padding = kids.length ? Math.max(0, Math.round(Math.min(...kids.flatMap(n => [n.x, n.y, frame.w - n.x - n.w, frame.h - n.y - n.h])))) : 16;
      reorderSiblings(frame.id, () => [...sorted, ...ed.nodes().filter(n => n.parentId === frame.id && !sorted.includes(n))]);
      Object.assign(frame, {layout: 'flex', direction, gap, padding, alignItems: 'flex-start', justifyContent: 'flex-start', wMode: 'hug', hMode: 'hug'});
      ed.setSelection(new Set([frame.id])); ed.render();
    }
    function removeAutoLayout() {
      const frames = topSelected().filter(isFlow); if (!frames.length) return;
      ed.checkpoint();
      for (const f of frames) {
        for (const k of ed.nodes().filter(n => n.parentId === f.id)) {
          const el = elementOf(k.id); if (el) { k.x = el.offsetLeft; k.y = el.offsetTop; if (el.offsetWidth) { k.w = el.offsetWidth; k.h = el.offsetHeight; } }
          if (k.wMode === 'fill') k.wMode = 'fixed'; if (k.hMode === 'fill') k.hMode = 'fixed';
        }
        f.layout = 'free'; if (f.wMode === 'hug') f.wMode = 'fixed'; if (f.hMode === 'hug') f.hMode = 'fixed';
      }
      ed.render();
    }
    function reorderSiblings(parentId, order) {
      const all = ed.nodes(), siblings = all.filter(n => (n.parentId || null) === (parentId || null));
      const slots = siblings.map(n => all.indexOf(n)), next = order(siblings);
      slots.forEach((slot, i) => { all[slot] = next[i]; });
    }
    function arrange(mode) {
      const list = selectedNodes(); if (!list.length) return;
      ed.checkpoint();
      for (const parentId of new Set(list.map(n => n.parentId || null))) reorderSiblings(parentId, siblings => {
        const order = siblings.slice(), picked = n => sel().has(n.id);
        if (mode === 'front') return [...order.filter(n => !picked(n)), ...order.filter(picked)];
        if (mode === 'back') return [...order.filter(picked), ...order.filter(n => !picked(n))];
        if (mode === 'forward') { for (let i = order.length - 2; i >= 0; i--) if (picked(order[i]) && !picked(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]]; }
        else for (let i = 1; i < order.length; i++) if (picked(order[i]) && !picked(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
        return order;
      });
      ed.render();
    }
    function toggleFlag(key) {
      const list = selectedNodes(); if (!list.length) return;
      ed.checkpoint();
      const value = !list.every(n => n[key]);
      for (const n of list) { if (value) n[key] = true; else delete n[key]; }
      ed.render();
    }
    // Normalize an angle to (-180, 180].
    const angle = a => { const r = ((Math.round(a * 100) / 100 + 180) % 360 + 360) % 360 - 180; return r === -180 ? 180 : r || 0; };
    // Flip (⇧H / ⇧V): mirror each layer in place (flipX/flipY = negative scale). Mirroring a rotated layer on screen
    // negates its rotation. Several free-positioned siblings flip as a group: positions mirror across their bounds.
    function flip(axis) {
      const list = topSelected().filter(n => !n.locked); if (!list.length) return false;
      ed.checkpoint();
      const key = axis === 'x' ? 'flipX' : 'flipY', size = axis === 'x' ? 'w' : 'h';
      const parentId = list[0].parentId || null, parent = find(parentId);
      if (list.length > 1 && !isFlow(parent) && list.every(n => (n.parentId || null) === parentId)) {
        const lo = Math.min(...list.map(n => n[axis])), hi = Math.max(...list.map(n => n[axis] + n[size]));
        for (const n of list) n[axis] = Math.round((lo + hi - n[axis] - n[size]) * 100) / 100;
      }
      for (const n of list) { if (n[key]) delete n[key]; else n[key] = true; if (Number(n.rotation)) n.rotation = angle(-n.rotation); }
      ed.render();
      return true;
    }
    function rotate90(direction = 1) {
      const list = topSelected().filter(n => !n.locked); if (!list.length) return false;
      ed.checkpoint();
      for (const n of list) n.rotation = angle((Number(n.rotation) || 0) + 90 * direction);
      ed.render();
      return true;
    }

    // ---------- Re-parent / reorder (layers panel drag & drop) ----------
    // World position of a frame's content origin (inside its border). Ancestor rotation is ignored.
    function contentOrigin(id) {
      const n = id ? find(id) : null; if (!n) return {x: 0, y: 0};
      const tl = layerOrigin(n), el = elementOf(n.id);
      return {x: tl.x + (el ? el.clientLeft : Number(n.strokeWidth) || 0), y: tl.y + (el ? el.clientTop : Number(n.strokeWidth) || 0)};
    }
    function layerOrigin(n) {
      const o = contentOrigin(n.parentId), el = elementOf(n.id);
      if (isFlow(find(n.parentId)) && n.position !== 'absolute' && el && el.offsetParent) return {x: o.x + el.offsetLeft, y: o.y + el.offsetTop};
      return {x: o.x + n.x, y: o.y + n.y};
    }
    /**
     * Move layers next to (`above` = in front of, `below` = behind) or `inside` (frontmost child of) a target layer,
     * as in the layers panel where the top row is frontmost. Keeps world positions when the parent changes, keeps the
     * moved layers' relative order, skips locked layers and refuses drops into a locked or moved frame. One undo step.
     * Returns the moved ids, or null when nothing could move.
     */
    function moveNodes(ids, targetId, position) {
      const all = ed.nodes(), target = targetId ? find(targetId) : null;
      if (!['above', 'below', 'inside'].includes(position) || (targetId && !target)) return null;
      const wanted = new Set(ids);
      let roots = all.filter(n => wanted.has(n.id) && !n.locked);
      roots = roots.filter(n => !roots.some(o => o !== n && ed.descendants(o.id).has(n.id)));
      if (!roots.length) return null;
      const parentId = position === 'inside' ? (target ? target.id : null) : (target?.parentId || null), parent = find(parentId);
      if (position === 'inside' && target && target.type !== 'frame') return null;
      if (parent && (parent.locked || roots.some(n => ed.descendants(n.id).has(parent.id)))) return null;
      if (target && position !== 'inside' && roots.includes(target)) {
        // Dropping next to a dragged layer: anchor on the nearest sibling that is not being moved.
        const siblings = all.filter(n => (n.parentId || null) === parentId), i = siblings.indexOf(target);
        const step = position === 'above' ? 1 : -1;
        let j = i; while (siblings[j] && roots.includes(siblings[j])) j += step;
        if (siblings[j]) return moveNodes(ids, siblings[j].id, position === 'above' ? 'below' : 'above');
        // Every sibling on that side moves: drop at the very front / back of the parent.
        return moveRoots(roots, parentId, position === 'above' ? 'front' : 'back');
      }
      return moveRoots(roots, parentId, position === 'inside' ? 'front' : {target, after: position === 'above'});
    }
    function moveRoots(roots, parentId, where) {
      const before = ed.snapshot(), all = ed.nodes(), parent = find(parentId), origin = contentOrigin(parentId);
      const plan = roots.map(n => {
        const world = layerOrigin(n), next = {x: Math.round((world.x - origin.x) * 100) / 100, y: Math.round((world.y - origin.y) * 100) / 100};
        return {n, same: (n.parentId || null) === (parentId || null), ...next};
      });
      const order = all.filter(n => !roots.includes(n));
      let index;
      if (where === 'front') index = order.length;
      else if (where === 'back') { const first = order.find(n => (n.parentId || null) === (parentId || null)); index = first ? order.indexOf(first) : order.length; }
      else index = order.indexOf(where.target) + (where.after ? 1 : 0);
      order.splice(index, 0, ...roots);
      const candidate = structuredClone(ed.design), page = candidate.pages.find(p => p.id === ed.page().id), byId = new Map(page.nodes.map(n => [n.id, n]));
      page.nodes = order.map(n => byId.get(n.id));
      for (const step of plan) { const c = byId.get(step.n.id); c.parentId = parentId || null; if (!step.same) { c.x = step.x; c.y = step.y; } }
      try { ed.validate(candidate); } catch (error) { footer('Unable to move layers: ' + error.message); return null; }
      all.splice(0, all.length, ...order);
      for (const {n, same, x, y} of plan) {
        if (same) continue;
        n.parentId = parentId || null; n.x = x; n.y = y;
        if (!isFlow(parent)) { if (n.wMode === 'fill') n.wMode = 'fixed'; if (n.hMode === 'fill') n.hMode = 'fixed'; }
      }
      ed.pushHistory(before);
      ed.setSelection(new Set(roots.map(n => n.id))); ed.render();
      return roots.map(n => n.id);
    }

    function selectInverse() {
      const scope = selectedNodes()[0]?.parentId || null;
      select(ed.nodes().filter(n => (n.parentId || null) === scope && !n.hidden && !n.locked && !sel().has(n.id)).map(n => n.id));
    }
    // Select all matching layers: same kind (type, ellipse, icon) on the page.
    function selectMatching() {
      const kind = n => [n.type, n.ellipse ? 'ellipse' : '', n.icon ? 'icon' : ''].join(':'), wanted = new Set(selectedNodes().map(kind));
      if (!wanted.size) return;
      select(ed.nodes().filter(n => wanted.has(kind(n)) && !n.hidden && !n.locked).map(n => n.id));
    }

    // ---------- Navigation ----------
    function selectChildren() {
      const list = selectedNodes(); if (!list.length) return;
      if (list.length === 1 && list[0].type === 'text') { editText(); return; }
      const kids = ed.nodes().filter(n => sel().has(n.parentId) && !n.hidden);
      if (!kids.length) return;
      list.forEach(n => drilled.add(n.id)); select(kids.map(n => n.id));
    }
    function selectParent() {
      const parents = [...new Set(selectedNodes().map(n => n.parentId).filter(Boolean))];
      if (parents.length) { parents.forEach(id => drilled.delete(id)); select(parents); }
    }
    function cycleSibling(step) {
      const current = selectedNodes()[0];
      const siblings = ed.nodes().filter(n => (n.parentId || null) === (current ? current.parentId || null : null) && !n.hidden).toReversed();
      if (!siblings.length) return;
      const i = current ? siblings.indexOf(current) : -1;
      select([siblings[(i + step + siblings.length) % siblings.length].id]);
    }
    function selectAll() {
      const scope = selectedNodes()[0]?.parentId || null;
      select(ed.nodes().filter(n => (n.parentId || null) === scope && !n.hidden && !n.locked).map(n => n.id));
    }

    // ---------- Clipboard ----------
    function serializeSelection() {
      const roots = topSelected(); if (!roots.length) return null;
      const ids = new Set(roots.flatMap(n => [...ed.descendants(n.id)]));
      const list = ed.nodes().filter(n => ids.has(n.id)).map(n => structuredClone(n));
      const tokens = {}; for (const n of list) if (n.token && ed.design.tokens[n.token]) tokens[n.token] = ed.design.tokens[n.token];
      const world = {}; for (const n of roots) { const r = worldRect(n.id); if (r) world[n.id] = {x: r.x, y: r.y}; }
      return {format: CLIP_MARKER, version: 1, page: ed.page().id, roots: roots.map(n => n.id), nodes: list, tokens, world};
    }
    function writeSystemClipboard(text, extra = {}) {
      let written = false;
      const onCopy = e => { e.clipboardData.setData('text/plain', text); for (const [type, value] of Object.entries(extra)) e.clipboardData.setData(type, value); e.preventDefault(); written = true; };
      document.addEventListener('copy', onCopy);
      try { document.execCommand('copy'); } catch {}
      document.removeEventListener('copy', onCopy);
      if (!written) navigator.clipboard?.writeText(text).catch(() => {});
    }
    function copy() {
      const data = serializeSelection(); if (!data) return false;
      clipboard = data; writeSystemClipboard(JSON.stringify(data));
      footer(`Copied ${data.roots.length} layer${data.roots.length === 1 ? '' : 's'}`);
      return true;
    }
    function cut() { if (copy()) $('#delete')?.click(); }
    // Copy as PNG: 2× raster of the selection on the system clipboard. When the async clipboard API may not write
    // images (the desktop shell denies clipboard permissions), the PNG goes out as an HTML <img> with a data URL.
    async function copyAsPng() {
      if (!sel().size) return false;
      let result;
      try { result = await ed.exportArtwork({format: 'PNG', scale: 2, selectionOnly: true}); }
      catch (error) { footer('Unable to copy as PNG: ' + (error?.message || error)); return false; }
      const size = `${result.width} × ${result.height}`;
      try {
        if (window.desktop?.writeClipboardImage) await window.desktop.writeClipboardImage(result.dataURL);
        else {
          const bytes = Uint8Array.from(atob(String(result.dataURL).split(',')[1] || ''), c => c.charCodeAt(0));
          await navigator.clipboard.write([new ClipboardItem({'image/png': new Blob([bytes], {type: 'image/png'})})]);
        }
        footer(`Copied ${size} PNG`);
      } catch {
        writeSystemClipboard(result.dataURL, {'text/html': `<img src="${result.dataURL}" width="${result.width / 2}" height="${result.height / 2}" alt="">`});
        footer(`Copied ${size} PNG as an HTML image`);
      }
      return true;
    }
    // Copy as code: standalone HTML of the selection (inline styles, same renderer as export).
    async function copyAsCode() {
      if (!sel().size) return false;
      try { const result = await ed.exportArtwork({format: 'HTML', selectionOnly: true}); writeSystemClipboard(result.content); footer('Copied selection as HTML'); return true; }
      catch (error) { footer('Unable to copy as code: ' + (error?.message || error)); return false; }
    }
    function parseClipboard(text) {
      try { const data = JSON.parse(text); return data?.format === CLIP_MARKER && Array.isArray(data.nodes) && Array.isArray(data.roots) ? data : null; } catch { return null; }
    }
    function paste(data = clipboard, {inPlace = false} = {}) {
      if (!data) return false;
      const ids = new Map(data.nodes.map(n => [n.id, ed.uid()])), roots = new Set(data.roots);
      const target = !inPlace && sel().size === 1 && selectedNodes()[0].type === 'frame' && !roots.has(selectedNodes()[0].id) ? selectedNodes()[0] : null;
      const copies = data.nodes.map(n => ({...structuredClone(n), id: ids.get(n.id), parentId: ids.get(n.parentId) || n.parentId || null}));
      const originalOf = new Map([...ids].map(([from, to]) => [to, from]));
      const placed = copies.filter(n => roots.has(originalOf.get(n.id)));
      for (const n of placed) {
        const original = originalOf.get(n.id);
        if (target) { n.parentId = target.id; continue; }
        if (n.parentId && !find(n.parentId)) { const w = data.world?.[original]; n.parentId = null; if (w) { n.x = w.x; n.y = w.y; } }
      }
      // Normal paste lands in place when visible; otherwise it is centered in the viewport.
      const tops = placed.filter(n => !n.parentId);
      if (!inPlace && !target && tops.length) {
        const b = union(tops.map(n => ({x: n.x, y: n.y, w: n.w, h: n.h})));
        if (!intersects(b, visibleWorld())) { const p = placeInView(b.w, b.h); for (const n of tops) { n.x += p.x - b.x; n.y += p.y - b.y; } }
      }
      const candidate = structuredClone(ed.design);
      candidate.pages.find(p => p.id === ed.page().id).nodes.push(...structuredClone(copies));
      for (const [k, v] of Object.entries(data.tokens || {})) if (!candidate.tokens[k]) candidate.tokens[k] = v;
      try { ed.validate(candidate); } catch (error) { footer('Unable to paste: ' + error.message); return false; }
      ed.checkpoint();
      for (const [k, v] of Object.entries(data.tokens || {})) if (!ed.design.tokens[k]) ed.design.tokens[k] = v;
      ed.nodes().push(...copies.map(n => ({...ed.defaults, ...n})));
      ed.setSelection(new Set(placed.map(n => n.id))); ed.render();
      return true;
    }
    function requestPaste(inPlace) {
      // Let the native paste event deliver the system clipboard; fall back to the in-app clipboard.
      clearTimeout(pasteTimer);
      pasteTimer = setTimeout(() => { pasteTimer = null; suppressPasteUntil = Date.now() + 1000; paste(clipboard, {inPlace}); }, 120);
      pendingInPlace = inPlace;
    }
    document.addEventListener('paste', e => {
      if (typing(e.target) || document.querySelector('dialog[open]') || document.body.classList.contains('files-view')) return;
      const inPlace = pasteTimer !== null && pendingInPlace;
      clearTimeout(pasteTimer); pasteTimer = null;
      if (Date.now() < suppressPasteUntil) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      const data = parseClipboard(text);
      if (data) { clipboard = data; paste(data, {inPlace}); return; }
      const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/') && f.size < 8e6);
      if (file) {
        const reader = new FileReader();
        reader.onload = () => { const img = new Image(); img.onload = () => { const w = Math.min(600, img.width), h = w * img.height / img.width, p = placeInView(w, h); ed.add('image', {name: file.name || 'Pasted image', src: reader.result, w, h, x: p.x, y: p.y, parentId: null, color: 'transparent'}); }; img.src = reader.result; };
        reader.readAsDataURL(file); return;
      }
      if (text.trim()) { const p = placeInView(320, 80); ed.add('text', {text: text.slice(0, 100000), name: 'Pasted text', x: p.x, y: p.y, w: 320, h: 80, parentId: null}); return; }
      paste(clipboard, {inPlace});
    });
    function copyStyle() { const n = selectedNodes()[0]; if (!n) return; styleClipboard = Object.fromEntries(STYLE_KEYS.map(k => [k, structuredClone(n[k])])); footer('Copied style from ' + n.name); }
    function pasteStyle() {
      if (!styleClipboard || !sel().size) return;
      ed.checkpoint();
      for (const n of selectedNodes()) for (const [k, v] of Object.entries(styleClipboard)) if (v !== undefined) n[k] = structuredClone(v);
      ed.render();
    }

    // ---------- Command registry ----------
    const needsSelection = () => sel().size > 0;
    const commands = [
      {id: 'tool.move', label: 'Move', section: 'Tools', keys: ['v'], run: () => setTool('move')},
      {id: 'tool.scale', label: 'Scale', section: 'Tools', keys: ['k'], run: () => setTool('scale')},
      {id: 'tool.hand', label: 'Hand', section: 'Tools', keys: ['h'], run: () => setTool('hand')},
      {id: 'tool.frame', label: 'Frame', section: 'Tools', keys: ['f'], run: () => setTool('frame')},
      {id: 'tool.rectangle', label: 'Rectangle', section: 'Tools', keys: ['r'], run: () => setTool('rectangle')},
      {id: 'tool.text', label: 'Text', section: 'Tools', keys: ['t'], run: () => setTool('text')},
      {id: 'tool.shader', label: 'Shader', section: 'Tools', keys: ['s'], run: () => setTool('shader')},
      {id: 'tool.ellipse', label: 'Ellipse', section: 'Tools', keys: ['o'], run: () => setTool('ellipse')},
      {id: 'tool.eyedropper', label: 'Eyedropper', section: 'Tools', keys: ['i', 'ctrl+c'], run: () => setTool(tool === 'eyedropper' ? 'move' : 'eyedropper')},
      {id: 'tool.image', label: 'Image', section: 'Tools', keys: [], run: () => setTool('image')},
      {id: 'edit.undo', label: 'Undo', section: 'Edit', keys: ['mod+z'], run: () => $('#undo')?.click()},
      {id: 'edit.redo', label: 'Redo', section: 'Edit', keys: ['mod+shift+z', 'mod+y'], run: () => $('#redo')?.click()},
      {id: 'edit.copy', label: 'Copy', section: 'Edit', keys: ['mod+c'], when: needsSelection, run: copy},
      {id: 'edit.cut', label: 'Cut', section: 'Edit', keys: ['mod+x'], when: needsSelection, run: cut},
      {id: 'edit.paste', label: 'Paste', section: 'Edit', keys: ['mod+v'], native: true, run: () => paste(clipboard)},
      {id: 'edit.pasteInPlace', label: 'Paste in place', section: 'Edit', keys: ['mod+shift+v'], native: true, run: () => paste(clipboard, {inPlace: true})},
      {id: 'edit.copyPng', label: 'Copy as PNG', section: 'Edit', keys: [], when: needsSelection, run: copyAsPng},
      {id: 'edit.copyCode', label: 'Copy as code', section: 'Edit', keys: ['mod+shift+c'], when: needsSelection, run: copyAsCode},
      {id: 'edit.copyStyle', label: 'Copy style', section: 'Edit', keys: ['mod+alt+c'], when: needsSelection, run: copyStyle},
      {id: 'edit.pasteStyle', label: 'Paste style', section: 'Edit', keys: ['mod+alt+v'], when: needsSelection, run: pasteStyle},
      {id: 'edit.duplicate', label: 'Duplicate', section: 'Edit', keys: ['mod+d'], when: needsSelection, run: () => $('#duplicate')?.click()},
      {id: 'edit.delete', label: 'Delete', section: 'Edit', keys: ['delete', 'backspace'], when: needsSelection, run: () => $('#delete')?.click()},
      {id: 'select.all', label: 'Select all', section: 'Selection', keys: ['mod+a'], run: selectAll},
      {id: 'select.inverse', label: 'Select inverse', section: 'Selection', keys: ['mod+shift+a'], run: selectInverse},
      {id: 'select.matching', label: 'Select all matching layers', section: 'Selection', keys: ['mod+alt+a'], when: needsSelection, run: selectMatching},
      {id: 'select.child', label: 'Select children', section: 'Selection', keys: ['enter'], when: needsSelection, run: selectChildren},
      {id: 'select.parent', label: 'Select parent', section: 'Selection', keys: ['shift+enter', '\\'], when: needsSelection, run: selectParent},
      {id: 'select.next', label: 'Select next sibling', section: 'Selection', keys: ['tab'], when: needsSelection, run: () => cycleSibling(1)},
      {id: 'select.previous', label: 'Select previous sibling', section: 'Selection', keys: ['shift+tab'], when: needsSelection, run: () => cycleSibling(-1)},
      {id: 'select.escape', label: 'Deselect', section: 'Selection', keys: ['escape'], run: () => { if (menu) closeMenu(); else if (tool !== 'move') setTool('move'); else clearSelection(); }},
      {id: 'view.zoomIn', label: 'Zoom in', section: 'View', keys: ['mod+=', 'mod+shift+=', 'mod+plus'], run: () => stepZoom(1)},
      {id: 'view.zoomOut', label: 'Zoom out', section: 'View', keys: ['mod+-'], run: () => stepZoom(-1)},
      {id: 'view.zoom100', label: 'Zoom to 100%', section: 'View', keys: ['mod+0', 'shift+0'], run: () => zoomCenter(1)},
      {id: 'view.fit', label: 'Zoom to fit', section: 'View', keys: ['shift+1'], run: () => fit()},
      {id: 'view.selection', label: 'Zoom to selection', section: 'View', keys: ['shift+2'], run: zoomToSelection},
      {id: 'transform.frame', label: 'Frame selection', section: 'Transform', keys: ['mod+g', 'mod+alt+g'], when: needsSelection, run: frameSelection},
      {id: 'transform.unframe', label: 'Unframe selection', section: 'Transform', keys: ['mod+shift+g'], when: needsSelection, run: unframeSelection},
      {id: 'transform.autoLayout', label: 'Add auto layout', section: 'Transform', keys: ['shift+a'], when: needsSelection, run: addAutoLayout},
      {id: 'transform.removeAutoLayout', label: 'Remove auto layout', section: 'Transform', keys: ['alt+shift+a'], when: needsSelection, run: removeAutoLayout},
      {id: 'transform.flipH', label: 'Flip horizontal', section: 'Transform', keys: ['shift+h'], when: needsSelection, run: () => flip('x')},
      {id: 'transform.flipV', label: 'Flip vertical', section: 'Transform', keys: ['shift+v'], when: needsSelection, run: () => flip('y')},
      {id: 'transform.rotate90', label: 'Rotate 90° right', section: 'Transform', keys: ['alt+shift+r'], when: needsSelection, run: () => rotate90(1)},
      {id: 'transform.rotate90ccw', label: 'Rotate 90° left', section: 'Transform', keys: ['alt+shift+l'], when: needsSelection, run: () => rotate90(-1)},
      {id: 'arrange.forward', label: 'Bring forward', section: 'Transform', keys: ['mod+]'], when: needsSelection, run: () => arrange('forward')},
      {id: 'arrange.backward', label: 'Send backward', section: 'Transform', keys: ['mod+['], when: needsSelection, run: () => arrange('backward')},
      {id: 'arrange.front', label: 'Bring to front', section: 'Transform', keys: ['mod+alt+]'], when: needsSelection, run: () => arrange('front')},
      {id: 'arrange.back', label: 'Send to back', section: 'Transform', keys: ['mod+alt+['], when: needsSelection, run: () => arrange('back')},
      {id: 'layer.visibility', label: 'Show/hide', section: 'Edit', keys: ['mod+shift+h'], when: needsSelection, run: () => toggleFlag('hidden')},
      {id: 'layer.lock', label: 'Lock/unlock', section: 'Edit', keys: ['mod+shift+l'], when: needsSelection, run: () => toggleFlag('locked')},
      {id: 'align.left', label: 'Align left', section: 'Alignment', keys: ['alt+a'], when: needsSelection, run: () => ed.align('left')},
      {id: 'align.right', label: 'Align right', section: 'Alignment', keys: ['alt+d'], when: needsSelection, run: () => ed.align('right')},
      {id: 'align.center', label: 'Align horizontal centers', section: 'Alignment', keys: ['alt+h'], when: needsSelection, run: () => ed.align('center')},
      {id: 'align.top', label: 'Align top', section: 'Alignment', keys: ['alt+w'], when: needsSelection, run: () => ed.align('top')},
      {id: 'align.middle', label: 'Align vertical centers', section: 'Alignment', keys: ['alt+v'], when: needsSelection, run: () => ed.align('middle')},
      {id: 'align.bottom', label: 'Align bottom', section: 'Alignment', keys: ['alt+s'], when: needsSelection, run: () => ed.align('bottom')},
      {id: 'align.distributeX', label: 'Distribute horizontal spacing', section: 'Alignment', keys: ['ctrl+alt+h'], when: needsSelection, run: () => ed.align('horizontal')},
      {id: 'align.distributeY', label: 'Distribute vertical spacing', section: 'Alignment', keys: ['ctrl+alt+v'], when: needsSelection, run: () => ed.align('vertical')},
      ...Array.from({length: 10}, (_, d) => ({id: 'opacity.' + d, label: `Opacity ${d ? d * 10 : 100}%`, section: 'Shape', keys: [String(d)], when: needsSelection, hidden: true, run: () => { ed.checkpoint(); selectedNodes().forEach(n => { n.opacity = d ? d * 10 : 100; }); ed.render(); }})),
    ];
    const KEY_NAMES = {BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Backslash: '\\', NumpadAdd: 'plus', NumpadSubtract: '-', Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab', Escape: 'escape', Delete: 'delete', Backspace: 'backspace'};
    function comboOf(e) {
      let key = KEY_NAMES[e.code] || (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^(Digit|Numpad)\d$/.test(e.code) ? e.code.at(-1) : (e.key || '').toLowerCase());
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      const mod = mac ? e.metaKey : e.ctrlKey, ctrl = mac && e.ctrlKey;
      return [mod && 'mod', ctrl && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', key].filter(Boolean).join('+');
    }
    const keyIndex = new Map();
    for (const c of commands) for (const k of c.keys) keyIndex.set(k, c);
    function runCommand(id) { const c = commands.find(x => x.id === id); if (!c || (c.when && !c.when())) return false; c.run(); return true; }
    const shortcutText = k => k.replace('mod+', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+').replace('alt+', '⌥').replace('shift+', '⇧').replace('ctrl+', '⌃').toUpperCase();

    document.addEventListener('keydown', e => {
      if (typing(e.target) || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]') || document.body.classList.contains('files-view') || document.body.classList.contains('settings-open')) return;
      if (e.code === 'Space') { space = true; workspace.classList.add('space-pan'); e.preventDefault(); return; }
      if (e.altKey && lastHover && !e.repeat) measureTo(lastHover);
      if (e.key.startsWith('Arrow')) {
        const list = selectedNodes().filter(n => !n.locked); if (!list.length) return;
        e.preventDefault(); ed.checkpoint();
        const prefs = window.appPreferences?.get?.() || {}, delta = e.shiftKey ? (prefs.largeNudge || 10) : (prefs.smallNudge || 1);
        for (const n of list) { if (e.key === 'ArrowLeft') n.x -= delta; if (e.key === 'ArrowRight') n.x += delta; if (e.key === 'ArrowUp') n.y -= delta; if (e.key === 'ArrowDown') n.y += delta; }
        ed.render(); return;
      }
      const command = keyIndex.get(comboOf(e)); if (!command) return;
      if (command.when && !command.when()) return;
      if (command.native) { requestPaste(command.id === 'edit.pasteInPlace'); return; } // keep default so the native paste event fires
      e.preventDefault(); command.run();
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') { space = false; workspace.classList.remove('space-pan'); }
      if (e.key === 'Alt' && overlay.dataset.measuring) { overlay.dataset.measuring = ''; drawGuides([]); }
    });
    window.addEventListener('blur', () => { space = false; workspace.classList.remove('space-pan'); });

    // ---------- Context menu ----------
    function closeMenu() { menu?.remove(); menu = null; }
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault(); closeMenu();
      const el = e.target.closest('#canvas .layer');
      if (el) { const id = resolveHit(el.dataset.id); if (!sel().has(id)) select([id]); }
      menu = document.createElement('div'); menu.id = 'canvas-menu'; menu.setAttribute('role', 'menu');
      const groups = [['edit.copy', 'edit.cut', 'edit.paste', 'edit.duplicate', 'edit.delete'], ['edit.copyPng', 'edit.copyCode', 'edit.copyStyle', 'edit.pasteStyle'], ['select.all', 'select.inverse', 'select.matching'], ['arrange.front', 'arrange.forward', 'arrange.backward', 'arrange.back'], ['transform.flipH', 'transform.flipV', 'transform.rotate90'], ['transform.frame', 'transform.unframe', 'transform.autoLayout', 'transform.removeAutoLayout'], ['layer.visibility', 'layer.lock'], ['view.fit', 'view.selection']];
      for (const group of groups) {
        const items = group.map(id => commands.find(c => c.id === id)).filter(c => c.id === 'edit.paste' ? !!clipboard : (!c.when || c.when()));
        if (!items.length) continue;
        if (menu.childElementCount) menu.append(document.createElement('hr'));
        for (const c of items) {
          const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.command = c.id;
          const label = document.createElement('span'); label.textContent = c.label; const keys = document.createElement('kbd'); keys.textContent = c.keys[0] ? shortcutText(c.keys[0]) : '';
          b.append(label, keys); b.onclick = () => { closeMenu(); c.run(); }; menu.append(b);
        }
      }
      document.body.append(menu);
      const r = menu.getBoundingClientRect();
      menu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px'; menu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    });
    document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);

    // ---------- Toolbar wiring (runs after the shell has built the toolbar) ----------
    function wireToolbar() {
      const select = document.getElementById('select-tool'), pan = document.getElementById('pan-tool');
      if (select) { select.onclick = () => setTool('move'); select.title = 'Move (V)'; }
      if (pan) { pan.onclick = () => setTool(tool === 'hand' ? 'move' : 'hand'); pan.title = 'Hand (H, or hold Space)'; }
      if (select && !document.getElementById('scale-tool')) {
        const scale = document.createElement('button'); scale.id = 'scale-tool'; scale.type = 'button'; scale.title = 'Scale (K)'; scale.setAttribute('aria-label', 'Scale tool');
        scale.onclick = () => setTool(tool === 'scale' ? 'move' : 'scale'); select.after(scale);
      }
      for (const [id, key] of [['add-frame', 'F'], ['rectangle', 'R'], ['add-ellipse', 'O'], ['text', 'T'], ['add-shader', 'S']]) { const b = document.getElementById(id); if (b && !b.title.includes('(')) b.title += ` (${key} to draw)`; }
      if (!document.getElementById('frame-presets')) {
        const panel = document.createElement('div'); panel.id = 'frame-presets'; panel.hidden = true; panel.setAttribute('aria-label', 'Frame presets');
        const hint = document.createElement('p'); hint.textContent = 'Drag on the canvas to draw a frame, or choose a size'; panel.append(hint);
        for (const [group, presets] of FRAME_PRESETS) {
          const heading = document.createElement('strong'); heading.textContent = group; panel.append(heading);
          for (const [name, w, h] of presets) {
            const b = document.createElement('button'); b.type = 'button'; b.dataset.preset = name;
            const label = document.createElement('span'); label.textContent = name; const size = document.createElement('small'); size.textContent = `${w} × ${h}`;
            b.append(label, size);
            b.onclick = () => { const p = placeInView(w, h); setTool('move'); ed.add('frame', {name, x: p.x, y: p.y, w, h, parentId: null}); zoomToSelection(); };
            panel.append(b);
          }
        }
        workspace.append(panel);
      }
      setTool(tool);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToolbar); else queueMicrotask(wireToolbar);
    for (const [id, fn] of [['zoom-in', () => stepZoom(1)], ['zoom-out', () => stepZoom(-1)], ['zoom-reset', () => zoomCenter(1)], ['zoom-fit', () => fit()]]) { const b = document.getElementById(id); if (b) b.onclick = fn; }

    // ---------- Render integration ----------
    function afterRender() {
      const pageId = ed.page().id;
      if (lastPage !== pageId) {
        if (lastPage) drilled.clear();
        lastPage = pageId;
        const saved = cameras.get(pageId);
        if (saved) setCamera(saved.x, saved.y, saved.zoom); else requestAnimationFrame(() => fit(true));
      }
      for (const id of drilled) if (!find(id)) drilled.delete(id);
      drawFrameLabels();
    }
    applyCamera();

    return {
      afterRender, reveal, setTool, getTool: () => tool, fit, zoomToSelection, stepZoom, zoomAt, zoomCenter, setCamera, screenToWorld, worldRect, placeInView,
      // scrollLeft/scrollTop stay non-negative for older readers; x/y carry the exact camera offset.
      getView: () => ({zoom: cam.zoom, scrollLeft: clamp(Math.round(-cam.x), 0, 1e7) || 0, scrollTop: clamp(Math.round(-cam.y), 0, 1e7) || 0, page: ed.page().id, x: cam.x || 0, y: cam.y || 0}),
      applyView: view => setCamera(Number.isFinite(view.x) ? view.x : -(Number(view.scrollLeft) || 0), Number.isFinite(view.y) ? view.y : -(Number(view.scrollTop) || 0), Number(view.zoom) || 1),
      commands: () => commands.filter(c => !c.hidden).map(({id, label, section, keys}) => ({id, label, section, keys: [...keys]})),
      runCommand, copy, cut, paste: options => paste(clipboard, options), copyStyle, pasteStyle, frameSelection, unframeSelection, addAutoLayout, removeAutoLayout, arrange,
      moveNodes, flip, rotate90, copyAsPng, copyAsCode, selectInverse, selectMatching,
      getDrilled: () => [...drilled],
    };
  }
  window.BetterCanvas = {install, ZOOM_STOPS, FRAME_PRESETS};
})();
