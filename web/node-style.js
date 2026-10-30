// Shared node -> CSS mapping for Verynize documents. ONE source of truth for the live canvas
// (web/app.js, loaded as a classic <script>) and the headless HTML export
// (integrations/export-html.mjs, which imports this file through integrations/node-style.mjs), so the
// canvas, screenshots and exported HTML cannot drift.
//
// nodeStyle(node, parent, ctx) -> {box, img}: ordered lists of [css-property, value] declarations for
// the layer element and (image nodes) its inner <img>. Values from the document are sanitized, so
// the result is safe to serialize into a style attribute (after attribute escaping).
//   ctx.color      resolved fill/ink color (token lookup is the caller's job)
//   ctx.lastInFlow true when the node is the last in-flow child of a block parent (space-y)
//
// Layout model (see integrations/codec-layout.mjs for the matching headless engine):
//   free   children positioned by x/y (absolute)
//   block  CSS block flow (display: flow-root, so child margins never escape the frame; adjacent
//          sibling margins collapse like CSS); gapY = space-y
//   flex   flexbox with gap/gapX/gapY, wrap, grow/shrink/basis, align-self, auto margins
//   grid   equal columns (optional equal rows) with col-span / row-span; justifyItems aligns cells
//   inline children are inline-block
(function (root) {
  'use strict';
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const PALETTES = {aurora: '#a58bdd,#85d6be,#c9a7ef', sunset: '#ffc078,#e582a8,#a58bdd', ocean: '#6ed8df,#6d91d7,#9b84d4'};
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  const px = v => num(v) + 'px';
  // Length: number -> px, 'N%' -> percent; anything else -> 0px.
  const len = v => (typeof v === 'string' ? (/^-?\d+(\.\d+)?%$/.test(v) ? v : '0px') : px(v));
  /** Accept a free-form CSS value from the document only when it cannot break out of a declaration. */
  const safe = (value, fallback = '') => (typeof value === 'string' && value.length <= 4000 && !/[;{}<>\\]/.test(value) && !/url\s*\(/i.test(value) ? value : fallback);
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const ALIGN = ['flex-start', 'flex-end', 'center', 'stretch', 'baseline', 'start', 'end'];
  const JUSTIFY = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end'];

  /** Sizing modes: Fixed always; Hug for text and flow frames; Fill inside flow parents. */
  function sizingAllowed(n, parent, mode) {
    if (!mode || mode === 'fixed') return true;
    if (mode === 'hug') return n.type === 'text' || (n.type === 'frame' && n.layout !== 'free');
    if (mode === 'fill') return !!parent && parent.type === 'frame' && parent.layout !== 'free';
    return false;
  }
  function sizingMode(n, axis, parent) {
    const mode = n[axis === 'w' ? 'wMode' : 'hMode'] || 'fixed';
    // A Left & Right (Top & Bottom) constraint stretches the layer between both insets, in any parent.
    if (mode === 'fill' && anchored(n, parent) && pinnedBoth(n, axis)) return 'fill';
    return sizingAllowed(n, parent, mode) ? mode : 'fixed';
  }
  const inFlow = (n, parent) => !!parent && parent.layout !== 'free' && n.position !== 'absolute';

  // ---------- Constraints ----------
  // Constraints are CSS anchoring of an absolutely positioned child (a child of a free frame, or an
  // absolute child of a flow frame). They live in the same fields the Tailwind codec uses, so they
  // export and re-import as written: `inset` [top, right, bottom, left] (px or 'N%') and `translate`.
  //   start   (Left/Top)          left inset, or no insets at all (x/y)
  //   end     (Right/Bottom)      right inset only
  //   stretch (Left & Right)      both insets, sizing mode fill (width auto between them)
  //   center  (Center)            left 50% + translate (-50% when exactly centered, else a px offset)
  //   scale   (Scale)             percentage inset + wPct/hPct
  // Insets are measured inside the parent's border (its padding box, the CSS containing block).
  const isSet = v => v !== null && v !== undefined;
  const isPct = v => typeof v === 'string' && v.endsWith('%');
  const hasInset = n => Array.isArray(n.inset) && n.inset.some(isSet);
  /** Whether a layer is positioned by insets (and so has constraints). */
  function anchored(n, parent) {
    if (!parent) return false;
    return parent.layout !== 'free' ? n.position === 'absolute' : hasInset(n);
  }
  const AXES = {h: {start: 3, end: 1, t: 0, size: 'w', pct: 'wPct', mode: 'wMode'}, v: {start: 0, end: 2, t: 1, size: 'h', pct: 'hPct', mode: 'hMode'}};
  const pinnedBoth = (n, axis) => { const a = AXES[axis === 'w' ? 'h' : 'v']; return Array.isArray(n.inset) && isSet(n.inset[a.start]) && isSet(n.inset[a.end]); };
  /** The constraint per axis: {h, v} each 'start' | 'end' | 'stretch' | 'center' | 'scale'. */
  function constraintsOf(n) {
    const ins = Array.isArray(n.inset) ? n.inset : [], tr = Array.isArray(n.translate) ? n.translate : [];
    const read = a => {
      const s = ins[a.start], e = ins[a.end];
      if (s === '50%' && !isSet(e) && isSet(tr[a.t])) return 'center';
      if (isPct(s) || isPct(e)) return 'scale';
      if (isSet(s) && isSet(e)) return 'stretch';
      return isSet(e) ? 'end' : 'start';
    };
    return {h: read(AXES.h), v: read(AXES.v)};
  }
  /**
   * Insets for constraints that keep a layer where it is. `box` is its geometry inside the parent's
   * padding box ({x, y, w, h}); `cb` the padding box size ({w, h}). Returns a patch (null = remove).
   */
  function anchorPatch(n, constraints, box, cb) {
    const r2 = v => Math.round(v * 100) / 100, pct = (v, total) => r2(total ? v / total * 100 : 0) + '%';
    const inset = [null, null, null, null], translate = [null, null], patch = {};
    for (const key of ['h', 'v']) {
      const a = AXES[key], c = constraints[key] || 'start', pos = key === 'h' ? box.x : box.y, size = box[a.size], total = cb[a.size];
      patch[a.pct] = null;
      if (c === 'stretch') patch[a.mode] = 'fill';
      else if (n[a.mode] === 'fill' || (c === 'scale' && n[a.mode] !== 'fixed')) { patch[a.mode] = 'fixed'; patch[a.size] = r2(size); }
      if (c === 'start') inset[a.start] = r2(pos);
      else if (c === 'end') inset[a.end] = r2(total - pos - size);
      else if (c === 'stretch') { inset[a.start] = r2(pos); inset[a.end] = r2(total - pos - size); }
      else if (c === 'center') { inset[a.start] = '50%'; const off = pos + size / 2 - total / 2; translate[a.t] = Math.abs(off) < 0.5 ? '-50%' : r2(pos - total / 2); }
      else if (c === 'scale') { inset[a.start] = pct(pos, total); patch[a.pct] = r2(total ? size / total * 100 : 100); }
    }
    // Plain Left/Top is the x/y default: no insets at all.
    const plain = constraints.h === 'start' && constraints.v === 'start';
    patch.inset = plain ? null : inset;
    patch.translate = translate.some(isSet) ? translate : null;
    return patch;
  }
  /**
   * Where the insets place a layer inside its parent's padding box (the inverse of anchorPatch):
   * {x, y, w, h}. `size` is the layer's own size for axes the insets don't decide.
   */
  function anchoredBox(n, cb, size) {
    const ins = Array.isArray(n.inset) ? n.inset : [], tr = Array.isArray(n.translate) ? n.translate : [], out = {};
    const resolve = (v, total) => (isPct(v) ? parseFloat(v) / 100 * total : num(v));
    for (const key of ['h', 'v']) {
      const a = AXES[key], total = cb[a.size], s = ins[a.start], e = ins[a.end], t = tr[a.t];
      let w = isSet(n[a.pct]) && (n[a.mode] || 'fixed') === 'fixed' ? num(n[a.pct]) / 100 * total : size[a.size];
      let pos;
      if (isSet(s) && isSet(e) && (n[a.mode] === 'fill')) { pos = resolve(s, total); w = Math.max(0, total - pos - resolve(e, total)); }
      else if (isSet(s)) pos = resolve(s, total);
      else if (isSet(e)) pos = total - resolve(e, total) - w;
      else pos = key === 'h' ? num(n.x) : num(n.y);
      if (isSet(t)) pos += isPct(t) ? parseFloat(t) / 100 * w : num(t);
      out[key === 'h' ? 'x' : 'y'] = pos; out[a.size] = w;
    }
    return out;
  }

  function nodeStyle(n, parent, ctx = {}) {
    const decl = new Map();
    // Later writes win and move to the end, so shorthands never clobber longhands set after them.
    const set = (k, v) => { if (v === undefined || v === null || v === '') return; decl.delete(k); decl.set(k, String(v)); };
    const color = safe(ctx.color ?? n.color, n.type === 'text' ? '#25252e' : 'transparent');
    const flowParent = !!parent && parent.layout !== 'free';
    // Positioned by insets: an absolute child of a flow frame, or a child of a free frame with constraints.
    const absoluteInFlow = anchored(n, parent);
    const flow = flowParent && !absoluteInFlow;

    // Base box.
    set('box-sizing', 'border-box');
    set('position', flow ? 'relative' : 'absolute');
    if (!flowParent && !absoluteInFlow) { set('left', px(n.x)); set('top', px(n.y)); }
    set('width', px(n.w)); set('height', px(n.h));
    set('border-radius', px(n.radius));
    set('font-size', px(num(n.fontSize, 16)));
    set('font-family', safe(n.fontFamily, 'system-ui'));
    set('font-weight', /^(normal|bold|[1-9][0-9]{0,2}|1000)$/.test(String(n.fontWeight)) ? String(n.fontWeight) : '400');
    set('text-align', pick(n.textAlign, ['left', 'center', 'right', 'justify', 'start', 'end'], 'left'));
    set('line-height', String(num(n.lineHeight, 1.15)));
    set('letter-spacing', px(n.letterSpacing));
    // Rotation, then flips (negative scale) in the node's own frame: transform = rotate(r) scale(±1, ±1).
    const flip = (n.flipX === true || n.flipY === true) ? `scale(${n.flipX === true ? -1 : 1}, ${n.flipY === true ? -1 : 1})` : '';
    if (num(n.rotation) || flip) set('transform', [num(n.rotation) ? `rotate(${num(n.rotation)}deg)` : '', flip].filter(Boolean).join(' '));
    set('opacity', String(num(n.opacity, 100) / 100));
    set('border', `${Math.max(0, num(n.strokeWidth))}px solid ${safe(n.strokeColor, '#000000')}`);
    if (safe(n.shadow)) set('box-shadow', safe(n.shadow));
    if (n.clipContent) set('overflow', 'hidden');
    set('white-space', 'pre-wrap');
    set('overflow-wrap', 'anywhere');
    set('color', color);
    set('z-index', String(Math.round(num(n.zIndex))));
    set('flex-shrink', '0');
    set('background', n.type === 'text' ? 'transparent' : color);
    if (n.type !== 'text' && safe(n.gradient)) set('background-image', safe(n.gradient));
    if (PALETTES[n.animated]) { set('background-image', `linear-gradient(120deg,${PALETTES[n.animated]})`); set('background-size', '250% 250%'); set('animation', 'design-gradient 8s ease infinite'); }
    if (safe(n.mask)) set('mask-image', safe(n.mask));
    if (parent?.layout === 'inline') { set('display', 'inline-block'); set('vertical-align', 'top'); }

    // Frame layout.
    if (n.type === 'frame') {
      const layout = n.layout || 'free';
      set('display', layout === 'free' || layout === 'inline' ? 'block' : layout === 'block' ? 'flow-root' : layout);
      if (layout === 'free') set('padding', '0px');
      else {
        const p = num(n.padding);
        set('padding', [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map(v => px(v ?? p)).join(' '));
      }
      if (layout === 'flex' || layout === 'grid') {
        const g = num(n.gap);
        set('row-gap', px(n.gapY ?? g)); set('column-gap', px(n.gapX ?? g));
        set('align-items', pick(n.alignItems, ALIGN, 'stretch'));
        set('justify-content', pick(n.justifyContent, JUSTIFY, 'flex-start'));
      }
      if (layout === 'flex') { set('flex-direction', (n.direction === 'column' ? 'column' : 'row') + (n.reverse === true ? '-reverse' : '')); if (n.flexWrap) set('flex-wrap', 'wrap'); }
      if (layout === 'grid') {
        set('grid-template-columns', `repeat(${Math.max(1, Math.min(100, Math.floor(num(n.columns, 2)) || 2))}, minmax(0, 1fr))`);
        if (num(n.rows) >= 1) set('grid-template-rows', `repeat(${Math.min(100, Math.floor(num(n.rows)))}, minmax(0, 1fr))`);
        if (n.justifyItems !== undefined) set('justify-items', pick(n.justifyItems, ALIGN, 'stretch'));
      }
    }

    // Sizing modes (hug = fit content, fill = stretch into the parent).
    const w = sizingMode(n, 'w', parent), h = sizingMode(n, 'h', parent);
    const flex = parent?.layout === 'flex', row = flex && parent.direction !== 'column';
    if (w === 'hug') set('width', n.type === 'text' && !parent ? 'max-content' : 'fit-content');
    if (h === 'hug') set('height', 'auto');
    const insetSet = i => absoluteInFlow && Array.isArray(n.inset) && n.inset[i] !== null && n.inset[i] !== undefined;
    if (w === 'fill') {
      set('width', absoluteInFlow ? (insetSet(1) && insetSet(3) ? 'auto' : '100%') : parent.layout === 'inline' ? '100%' : 'auto'); set('min-width', '0');
      if (flow && row) { set('flex-grow', '1'); set('flex-basis', '0'); } else if (flow && flex) set('align-self', 'stretch');
    }
    if (h === 'fill') {
      set('height', absoluteInFlow ? (insetSet(0) && insetSet(2) ? 'auto' : '100%') : flex ? 'auto' : '100%'); set('min-height', '0');
      if (flow && flex && !row) { set('flex-grow', '1'); set('flex-basis', '0'); } else if (flow && flex) set('align-self', 'stretch');
    }

    // Placement inside a flow parent.
    if (absoluteInFlow) {
      const inset = Array.isArray(n.inset) ? n.inset : [];
      const has = i => inset[i] !== null && inset[i] !== undefined;
      if (SIDES.some((_, i) => has(i))) SIDES.forEach((k, i) => { if (has(i)) set(k, len(inset[i])); });
      else {
        // No offsets: x/y are relative to the parent's border box; CSS offsets start inside the border.
        const b = bordersOf(parent);
        set('left', px(num(n.x) - b[3])); set('top', px(num(n.y) - b[0]));
      }
      if (Array.isArray(n.translate)) set('translate', len(n.translate[0]) + ' ' + len(n.translate[1]));
    } else if (flow) {
      set('flex-shrink', String(n.shrink ?? (w === 'hug' ? 1 : 0)));
      if (n.grow !== undefined) set('flex-grow', String(num(n.grow)));
      if (n.basis !== undefined) set('flex-basis', len(n.basis));
      if (n.alignSelf && n.alignSelf !== 'auto') set('align-self', pick(n.alignSelf, ALIGN, 'auto'));
      const margin = Array.isArray(n.margin) && n.margin.length === 4 ? n.margin.map(v => (v === 'auto' ? 'auto' : len(v))) : ['0px', '0px', '0px', '0px'];
      // space-y on a block parent: every in-flow child but the last gets the gap as its bottom margin
      // unless it declares its own (Tailwind v4: the child's margin class wins over space-y).
      if (parent.layout === 'block' && num(parent.gapY) && !ctx.lastInFlow && margin[2] === '0px') margin[2] = px(parent.gapY);
      if (margin.some(v => v !== '0px')) set('margin', margin.join(' '));
      if (n.colSpan !== undefined && parent.layout === 'grid') set('grid-column', n.colSpan === 'full' ? '1 / -1' : `span ${Math.max(1, Math.floor(num(n.colSpan, 1)))} / span ${Math.max(1, Math.floor(num(n.colSpan, 1)))}`);
      if (n.rowSpan !== undefined && parent.layout === 'grid') set('grid-row', `span ${Math.max(1, Math.floor(num(n.rowSpan, 1)))} / span ${Math.max(1, Math.floor(num(n.rowSpan, 1)))}`);
    }
    if (parent) {
      if (n.wPct !== undefined && w === 'fixed') set('width', num(n.wPct) + '%');
      if (n.hPct !== undefined && h === 'fixed') set('height', num(n.hPct) + '%');
    }
    for (const [k, prop] of [['minW', 'min-width'], ['maxW', 'max-width'], ['minH', 'min-height'], ['maxH', 'max-height']]) if (n[k] !== undefined && n[k] !== null) set(prop, len(n[k]));
    if (num(n.aspectRatio) > 0 && h !== 'fixed') { set('aspect-ratio', String(num(n.aspectRatio))); set('height', 'auto'); }

    // Shape and effects.
    if (Array.isArray(n.cornerRadii) && n.cornerRadii.length === 4) set('border-radius', n.cornerRadii.map(px).join(' '));
    // Ellipse: any box type can be drawn as an ellipse inscribed in its bounds; it overrides corner radii.
    if (n.ellipse === true && n.type !== 'text') set('border-radius', '50%');
    if (Array.isArray(n.strokeWidths) && n.strokeWidths.length === 4) set('border-width', n.strokeWidths.map(v => px(Math.max(0, num(v)))).join(' '));
    if (['dashed', 'dotted', 'double'].includes(n.strokeStyle)) set('border-style', n.strokeStyle);
    if (num(n.ringWidth) > 0) {
      const ring = (n.ringInset ? 'inset ' : '') + `0 0 0 ${num(n.ringWidth)}px ${safe(n.ringColor, '#000000')}`;
      set('box-shadow', safe(n.shadow) ? ring + ', ' + safe(n.shadow) : ring);
    }

    // Text.
    if (n.type === 'text') {
      if (['uppercase', 'lowercase', 'capitalize'].includes(n.textTransform)) set('text-transform', n.textTransform);
      if (/^(none|underline|overline|line-through)( (underline|overline|line-through))*$/.test(String(n.textDecoration || ''))) set('text-decoration-line', n.textDecoration);
      if (['italic', 'normal'].includes(n.fontStyle)) set('font-style', n.fontStyle);
      if (['wrap', 'nowrap', 'balance', 'pretty', 'stable'].includes(n.textWrap)) set('text-wrap', n.textWrap);
      if (n.truncate) { set('white-space', 'nowrap'); set('overflow', 'hidden'); set('text-overflow', 'ellipsis'); }
      else if (n.noWrap) set('white-space', 'pre');
      if (num(n.lineClamp) > 0) { set('display', '-webkit-box'); set('-webkit-line-clamp', String(Math.floor(num(n.lineClamp)))); set('-webkit-box-orient', 'vertical'); set('overflow', 'hidden'); }
    }
    if (n.hidden) set('display', 'none');

    const img = n.type === 'image' ? [['width', '100%'], ['height', '100%'], ['object-fit', pick(n.objectFit, ['contain', 'cover', 'fill', 'none', 'scale-down'], 'contain')], ['display', 'block']] : null;
    // Optional monochrome SVG paint: retain the source and recolor its alpha silhouette.
    const svgTint = n.type === 'image' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ctx.svgColor || n.svgColor || '') && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=\s]+$/.test(n.src || '');
    if (svgTint) img.push(['background-color', ctx.svgColor || n.svgColor], ['mask-image', `url("${n.src.replace(/\s/g, '')}")`], ['mask-mode', 'alpha'], ['mask-size', n.objectFit === 'cover' ? 'cover' : n.objectFit === 'none' ? 'auto' : n.objectFit === 'fill' ? '100% 100%' : 'contain'], ['mask-position', 'center'], ['mask-repeat', 'no-repeat']);
    return {box: [...decl], img, svgTint};
  }

  function bordersOf(n) {
    if (Array.isArray(n?.strokeWidths) && n.strokeWidths.length === 4) return n.strokeWidths.map(v => num(v));
    const w = num(n?.strokeWidth); return [w, w, w, w];
  }
  /** Serialize declarations as a style attribute value (caller escapes for HTML). */
  const styleText = decls => (decls || []).map(([k, v]) => `${k}:${v}`).join(';');
  /** Apply declarations to a DOM element (browser). */
  function applyStyle(el, decls) { for (const [k, v] of decls || []) el.style.setProperty(k, v); }
  /** Text runs -> [{text, style: [[prop, value]]}] segments (bold/italic/color/size). */
  function textSegments(n) {
    const text = String(n.text || ''), runs = Array.isArray(n.textRuns) ? n.textRuns : [];
    const points = [...new Set([0, text.length, ...runs.flatMap(r => [r.start, r.end])])].filter(p => p >= 0 && p <= text.length).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], style = [];
      for (const r of runs.filter(r => r.start <= a && r.end >= b)) {
        if (r.bold) style.push(['font-weight', '700']);
        if (r.italic) style.push(['font-style', 'italic']);
        if (safe(r.color)) style.push(['color', safe(r.color)]);
        if (isNum(r.fontSize)) style.push(['font-size', r.fontSize + 'px']);
      }
      out.push({text: text.slice(a, b), style});
    }
    return out;
  }
  /** Index of the last in-flow (not hidden, not absolute) child in a list of siblings. */
  const lastInFlowId = children => children.filter(c => !c.hidden && c.position !== 'absolute').at(-1)?.id;

  root.BetterNodeStyle = {nodeStyle, styleText, applyStyle, textSegments, sizingAllowed, sizingMode, inFlow, lastInFlowId, anchored, constraintsOf, anchorPatch, anchoredBox, safeCss: safe, PALETTES};
})(typeof globalThis !== 'undefined' ? globalThis : window);
