// Pure document transforms used by the MCP tools: stable short element ids, page indexing,
// JSX -> node construction (Tailwind v4 classes, CSS-like flow layout with hug/fill sizing and
// text inheritance), and the update_elements directive script. Everything here operates on plain
// version-2 document objects.
import { randomUUID } from 'node:crypto';
import { NODE_DEFAULTS, parseJsx, parseClasses, collectText, isTextOnly, isSafeTag, serializeNode, cssVarForToken, normalizeColor, JsxSyntaxError, defaultSizing, isFlexRow } from './jsx-codec.mjs';
import { layoutPage, measureText } from './codec-layout.mjs';
import { cascadeText, styleFromSpec, mergeStyle, TEXT_DEFAULTS, baselineTextStyle } from './codec-text.mjs';
import { resolveIcon, iconToNodeImage, isSafeColor } from './assets.mjs';
import { cssColorToHex } from './codec-css.mjs';
import { BINDABLE, checkVariableValue } from './design-store.mjs';

export { measureText };

export const clone = value => structuredClone(value);

// ---------------------------------------------------------------------------------------------
// Short ids. Each node gets a page-unique code stored as `shortId`. Artboards (top-level nodes)
// are addressed by their code ("bok"); descendants by "<artboard code>.<own code>" ("bok.tem").

const CONSONANTS = 'bcdfghjklmnprstvwz', VOWELS = 'aeiou', LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function hash(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function codeFor(id, attempt) {
  const h = hash(id + ':' + attempt);
  if (attempt < 6) return CONSONANTS[h % 18] + VOWELS[Math.floor(h / 18) % 5] + CONSONANTS[Math.floor(h / 90) % 18];
  if (attempt < 40) return [0, 1, 2].map(k => LETTERS[Math.floor(h / 26 ** k) % 26]).join('');
  return [0, 1, 2, 3].map(k => LETTERS[Math.floor(h / 26 ** k) % 26]).join('');
}
const SHORT = /^[a-z]{3,4}$/;
/** Assign missing or duplicate short ids in place. Returns true when anything changed. */
export function ensureShortIds(document) {
  let changed = false;
  for (const page of document.pages) {
    const used = new Set();
    for (const node of page.nodes) {
      if (typeof node.shortId === 'string' && SHORT.test(node.shortId) && !used.has(node.shortId)) { used.add(node.shortId); continue; }
      let attempt = 0, code; do code = codeFor(node.id, attempt++); while (used.has(code));
      node.shortId = code; used.add(code); changed = true;
    }
  }
  return changed;
}

export function indexPage(page) {
  const byId = new Map(), byCode = new Map(), kids = new Map();
  for (const node of page.nodes) { byId.set(node.id, node); if (node.shortId) byCode.set(node.shortId, node); const key = node.parentId || null; if (!kids.has(key)) kids.set(key, []); kids.get(key).push(node); }
  const rootOf = node => { let current = node; const seen = new Set(); while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.parentId); } return current; };
  const shortId = node => node.parentId ? `${rootOf(node).shortId}.${node.shortId}` : node.shortId;
  const children = id => kids.get(id) || [];
  const descendants = id => { const out = []; const walk = pid => { for (const child of children(pid)) { out.push(child); walk(child.id); } }; walk(id); return out; };
  const ancestors = node => { const out = []; let current = node; while (current.parentId && byId.has(current.parentId)) { current = byId.get(current.parentId); out.unshift(current); } return out; };
  const resolve = ref => {
    if (typeof ref !== 'string' || !ref) return null;
    if (byId.has(ref)) return byId.get(ref);
    const code = ref.includes('.') ? ref.slice(ref.lastIndexOf('.') + 1) : ref;
    const node = byCode.get(code);
    if (!node) return null;
    if (ref.includes('.') && rootOf(node).shortId !== ref.slice(0, ref.indexOf('.'))) return null;
    return node;
  };
  const require = ref => { const node = resolve(ref); if (!node) throw new Error(`Element ${JSON.stringify(ref)} not found on page ${page.id}`); return node; };
  return { page, byId, children, descendants, ancestors, rootOf, shortId, resolve, require };
}

export function getPage(document, pageId) {
  const page = pageId ? document.pages.find(p => p.id === pageId) : document.pages.find(p => p.id === document.activePage) || document.pages[0];
  if (!page) throw new Error(`Page ${pageId} not found. Call get_design_context for page ids.`);
  return page;
}

export function elementCode(document, page, node, depth = Infinity) {
  const index = indexPage(page);
  const parent = node.parentId ? index.byId.get(node.parentId) : null;
  return serializeNode(node, index, { depth, tokens: document.tokens || {}, parent, isRoot: !node.parentId });
}

// ---------------------------------------------------------------------------------------------
// JSX -> nodes
//
// Node model written by the codec (all optional; legacy documents keep working):
//   layout 'block'|'flex'|'grid'|'inline'|'free'   frames default to 'block' (CSS block flow)
//   wMode/hMode 'fixed'|'hug'|'fill', wPct/hPct     sizing; hug/fill w/h are layout outputs
//   paddingTop/Right/Bottom/Left                    when not uniform (uniform -> `padding`)
//   gapX/gapY                                       when they differ (equal -> `gap`)
//   cornerRadii [tl,tr,br,bl], strokeWidths [t,r,b,l], strokeStyle, ringWidth/ringColor/ringInset
//   ellipse (rounded-[50%]), flipX/flipY (-scale-x-100 / -scale-y-100)
//   flexWrap, reverse (row-/column-reverse), grow, shrink, basis, alignSelf, colSpan, rowSpan, margin [t,r,b,l] (number|'auto')
//   rows (equal grid rows), justifyItems (grid cell alignment)
//   minW/maxW/minH/maxH (px number or 'N%'), aspectRatio
//   position 'absolute' + inset [t,r,b,l] (px|'N%'|null) + translate [x,y] (px|'N%')
//   textTransform, textDecoration, fontStyle, truncate, noWrap, lineClamp, textWrap, objectFit, hidden
//   textStyle (frames: inheritable text declarations), styleOwn (text: keys declared on itself)
//   measured: false                                  geometry came from the headless estimate
//   icon 'set:name' (image nodes from <Icon name> / <ArrowRight/>): src is a generated SVG data URL;
//     iconColor (own text-* / color, else inherited text color), iconStrokeWidth; regenerated by reflow
//   srcRemote 'https://…' + assetStatus 'pending'|'missing'|'ready'   remote <img> not yet embedded

const BOX_KEYS = ['fill', 'gradient', 'strokeWidth', 'padding', 'radius', 'shadow', 'ringWidth', 'cornerRadii'];
const COMMON_KEYS = ['opacity', 'rotation', 'flipX', 'flipY', 'zIndex', 'clipContent', 'mask', 'animated', 'shadow', 'strokeColor', 'strokeStyle', 'ringWidth', 'ringColor', 'ringInset', 'hidden', 'aspectRatio', 'grow', 'shrink', 'basis', 'alignSelf', 'colSpan', 'rowSpan'];
const FRAME_KEYS = ['layout', 'direction', 'reverse', 'columns', 'rows', 'alignItems', 'justifyContent', 'justifyItems', 'flexWrap'];
const TEXT_ONLY_KEYS = ['truncate', 'noWrap', 'lineClamp', 'textWrap'];
const TEXT_SPEC_KEYS = ['ink', 'inkToken', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'lineHeight', 'lineHeightPx', 'letterSpacing', 'letterSpacingEm', 'textTransform', 'textDecoration', 'fontStyle', 'textWrap'];
const OWN_KEY = { ink: 'color', inkToken: 'color', fontSize: 'fontSize', fontWeight: 'fontWeight', fontFamily: 'fontFamily', textAlign: 'textAlign', lineHeight: 'lineHeight', lineHeightPx: 'lineHeight',
  letterSpacing: 'letterSpacing', letterSpacingEm: 'letterSpacing', textTransform: 'textTransform', textDecoration: 'textDecoration', fontStyle: 'fontStyle', textWrap: 'textWrap' };

function classify(el) {
  const override = el.attrs['data-node-type'];
  if (['frame', 'rectangle', 'text', 'image', 'shader'].includes(override)) return override;
  if (el.tag === 'img') return 'image';
  if (el.tag === 'Shader') return 'shader';
  if (el.tag === 'hr' || el.tag === 'input') return 'rectangle';
  if (/^[A-Z]/.test(el.tag)) return 'icon';
  // A flex/grid container of inline elements (<nav className="flex"><a>…</a><a>…</a></nav>) is a frame.
  const layoutClass = /(^|\s)!?(flex|inline-flex|grid|inline-grid)(\s|$)/.test(String(el.attrs.className ?? el.attrs.class ?? ''));
  if (el.children.length && isTextOnly(el) && !(layoutClass && el.children.filter(c => c.tag && c.tag !== 'br').length > 1)) return 'text';
  if (el.selfClosing && el.tag === 'div') return 'rectangle';
  return 'frame';
}

const sidesOf = (node, prefix, fallback) => ['Top', 'Right', 'Bottom', 'Left'].map(s => node[prefix + s] ?? fallback);
function setPadding(node, values) {
  if (values.every(v => v === values[0])) { node.padding = values[0]; for (const s of ['Top', 'Right', 'Bottom', 'Left']) delete node['padding' + s]; }
  else { ['Top', 'Right', 'Bottom', 'Left'].forEach((s, i) => { node['padding' + s] = values[i]; }); node.padding = Math.max(...values); }
}
function mergeFour(current, next) { return next.map((v, i) => (v === null || v === undefined ? current[i] : v)); }

/** Apply parsed class props (not geometry) to a node of known type. Text keys become own (text) or inherited declarations (frames). */
export function applySpec(node, spec, tokens) {
  const p = spec.props;
  for (const key of COMMON_KEYS) if (key in p) node[key] = p[key];
  if ('cornerRadii' in p) {
    const merged = mergeFour(Array.isArray(node.cornerRadii) ? node.cornerRadii : Array(4).fill(Number(node.radius) || 0), p.cornerRadii);
    if (merged.every(v => v === merged[0])) { node.radius = merged[0]; delete node.cornerRadii; } else { node.cornerRadii = merged; node.radius = Math.max(...merged); }
  } else if ('radius' in p) { node.radius = p.radius; delete node.cornerRadii; }
  // rounded-[50%] makes the box an ellipse; any other radius class turns it back into a rounded box.
  if (p.ellipse === true && node.type !== 'text') node.ellipse = true; else if ('radius' in p || 'cornerRadii' in p) delete node.ellipse;
  if ('strokeWidths' in p) {
    const merged = mergeFour(Array.isArray(node.strokeWidths) ? node.strokeWidths : Array(4).fill(Number(node.strokeWidth) || 0), p.strokeWidths);
    if (merged.every(v => v === merged[0])) { node.strokeWidth = merged[0]; delete node.strokeWidths; } else { node.strokeWidths = merged; node.strokeWidth = Math.max(...merged); }
  } else if ('strokeWidth' in p) { node.strokeWidth = p.strokeWidth; delete node.strokeWidths; }
  if (node.type === 'image' && 'objectFit' in p) node.objectFit = p.objectFit;
  if (node.type === 'text') {
    const own = new Set(Array.isArray(node.styleOwn) ? node.styleOwn : []);
    if ('fontSize' in p) node.fontSize = p.fontSize;
    if ('ink' in p) { node.color = p.ink; node.token = p.inkToken || ''; }
    for (const key of ['fontWeight', 'fontFamily', 'textAlign', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'fontStyle', 'textWrap', 'truncate', 'noWrap', 'lineClamp']) if (key in p) node[key] = p[key];
    if ('lineHeightPx' in p) node.lineHeight = Math.round(p.lineHeightPx / (node.fontSize || 16) * 1000) / 1000;
    if ('letterSpacingEm' in p) node.letterSpacing = Math.round(p.letterSpacingEm * (node.fontSize || 16) * 100) / 100;
    for (const key of Object.keys(p)) if (OWN_KEY[key]) own.add(OWN_KEY[key]);
    if (spec.italic !== undefined) { own.add('fontStyle'); node.fontStyle = spec.italic ? 'italic' : ''; }
    node.styleOwn = [...own];
  } else {
    if (node.type !== 'image') {
      if ('fill' in p) { node.color = p.fill; node.token = p.fillToken || ''; }
      if ('gradient' in p) node.gradient = p.gradient;
    }
    if (node.type === 'frame') {
      const declared = styleFromSpec({ props: Object.fromEntries(TEXT_SPEC_KEYS.filter(k => k in p).map(k => [k, p[k]])), italic: spec.italic });
      if (Object.keys(declared).length) node.textStyle = mergeStyle(node.textStyle, declared);
    }
  }
  if (node.type === 'frame') {
    for (const key of FRAME_KEYS) if (key in p) node[key] = p[key];
    if ('direction' in p && !('layout' in p) && (node.layout === 'free' || node.layout === 'block')) node.layout = 'flex';
    if (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some(k => k in p)) setPadding(node, mergeFour(sidesOf(node, 'padding', Number(node.padding) || 0), [p.paddingTop, p.paddingRight, p.paddingBottom, p.paddingLeft]));
    if ('gapX' in p || 'gapY' in p) {
      const gx = p.gapX ?? node.gapX ?? node.gap ?? 0, gy = p.gapY ?? node.gapY ?? node.gap ?? 0;
      if (gx === gy) { node.gap = gx; delete node.gapX; delete node.gapY; } else { node.gapX = gx; node.gapY = gy; node.gap = Math.max(gx, gy); }
    }
  }
  void tokens;
}

const lengthValue = len => (len.frac !== undefined && !len.px ? `${Math.round(len.frac * 100000) / 1000}%` : len.px ?? 0);
const FALLBACK = { rectangle: [100, 100], image: [200, 150], shader: [400, 300], frame: [100, 100], text: [100, 20] };

/**
 * Apply size/position classes. `parent` is the node's parent (null for artboards). New nodes get
 * CSS auto sizing (hug/fill); edits only change what the classes mention.
 */
function applyGeometry(node, spec, parent, { isNew, warnings, label }) {
  const free = parent && (!parent.layout || parent.layout === 'free');
  const inset = [spec.top, spec.right, spec.bottom, spec.left];
  if (free) {
    // Free frames position children by x/y (Left/Top). Right/bottom, percentage and centring offsets are
    // constraints: kept as `inset`/`translate` so the renderer anchors them (see constraintsOf in node-style.js).
    const plainPx = len => len === undefined || (len.px !== undefined && len.frac === undefined);
    const constrained = spec.right || spec.bottom || spec.translate || !plainPx(spec.left) || !plainPx(spec.top);
    if (constrained) {
      node.inset = mergeFour(Array.isArray(node.inset) ? node.inset : [null, null, null, null], inset.map(v => (v ? lengthValue(v) : null)));
      if (spec.translate) node.translate = [spec.translate.x, spec.translate.y];
      // Keep an explicit start inset on axes the classes don't anchor, so x/y-less axes stay where they are.
      if (node.inset[1] === null && node.inset[3] === null) node.inset[3] = spec.left?.px ?? node.x ?? 0;
      if (node.inset[0] === null && node.inset[2] === null) node.inset[0] = spec.top?.px ?? node.y ?? 0;
    } else {
      if (Array.isArray(node.inset) && (spec.left || spec.top)) { delete node.inset; delete node.translate; }
      if (spec.left?.px !== undefined) node.x = spec.left.px; else if (isNew) node.x = 0;
      if (spec.top?.px !== undefined) node.y = spec.top.px; else if (isNew) node.y = 0;
    }
  } else if (parent) {
    if (spec.absolute) node.position = 'absolute';
    else if (inset.some(Boolean) && node.position !== 'absolute') warnings.push(`${label}: top/right/bottom/left offsets only apply to absolute elements; add "absolute"`);
    if (node.position === 'absolute') {
      if (inset.some(Boolean) || isNew) node.inset = mergeFour(Array.isArray(node.inset) ? node.inset : [null, null, null, null], inset.map(v => (v ? lengthValue(v) : null)));
      if (spec.translate) node.translate = [spec.translate.x, spec.translate.y];
    }
  } else if (spec.absolute) warnings.push(`${label}: artboards are positioned with data-component-x/y; "absolute" ignored`);
  if (spec.margin) {
    if (!parent) warnings.push(`${label}: margins on an artboard are ignored`);
    else node.margin = mergeFour(Array.isArray(node.margin) ? node.margin : [0, 0, 0, 0], ['top', 'right', 'bottom', 'left'].map(s => spec.margin[s]));
  }
  for (const [key, prop] of [['minW', 'minW'], ['maxW', 'maxW'], ['minH', 'minH'], ['maxH', 'maxH']]) if (spec[key]) node[prop] = lengthValue(spec[key]);
  const def = defaultSizing(node, parent);
  const canHug = node.type === 'text' || node.type === 'frame';
  const row = isFlexRow(parent) && node.position !== 'absolute';
  const axis = (len, key, modeKey, pctKey, defMode) => {
    if (!len || len.auto) {
      if (!isNew && !len) return;
      let mode = defMode;
      if (key === 'w' && row && Number(node.grow) > 0 && spec.has.has('grow')) mode = 'fill';
      if (key === 'w' && !parent && canHug) mode = 'hug'; // resolved to a fixed width after layout
      if (mode === 'fixed') node[key] = node[key] ?? FALLBACK[node.type][key === 'w' ? 0 : 1];
      node[modeKey] = mode; delete node[pctKey];
      return;
    }
    if (len.fit) { node[modeKey] = canHug ? 'hug' : 'fixed'; delete node[pctKey]; if (!canHug) warnings.push(`${label}: fit-content sizing needs a frame or text; kept a fixed size`); return; }
    if (len.px !== undefined && len.frac === undefined) { node[modeKey] = 'fixed'; node[key] = Math.max(1, len.px); delete node[pctKey]; return; }
    if (len.frac === 1 && !len.px && parent && !free) { node[modeKey] = 'fill'; delete node[pctKey]; return; }
    if (len.frac !== undefined && !len.px && parent) { node[modeKey] = 'fixed'; node[pctKey] = Math.round(len.frac * 100000) / 1000; return; }
    warnings.push(`${label}: ${key === 'w' ? 'width' : 'height'} ${len.frac !== undefined ? `${len.frac * 100}%${len.px ? ` ${len.px < 0 ? '-' : '+'} ${Math.abs(len.px)}px` : ''}` : ''} cannot be represented here; kept the current size`);
  };
  axis(spec.w, 'w', 'wMode', 'wPct', def.w);
  axis(spec.h, 'h', 'hMode', 'hPct', def.h);
  if (isNew && node.type === 'rectangle' && !spec.h && !node.aspectRatio) warnings.push(`${label}: empty element without a height; used ${node.h}px (CSS would collapse it to 0)`);
}

// ---------------------------------------------------------------------------------------------
// Icons: <Icon name="lucide:arrow-right" className="size-5 text-slate-500"/> and component names
// (<ArrowRight/>, <LuX/>, <IconBrandGithub/>) become image nodes with a generated SVG.

const ICON_TAGS = new Set(['Icon', 'Iconify']);
const iconNameOf = el => (ICON_TAGS.has(el.tag) ? (typeof el.attrs.name === 'string' ? el.attrs.name : typeof el.attrs.icon === 'string' ? el.attrs.icon : '') : el.tag).trim();
const STROKE_CLASS = /^stroke-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)(?:px)?\])$/;
const isRemoteSrc = src => typeof src === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(src) && src.length <= 4000;
const isEmbeddedSrc = src => typeof src === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(src);

/** Split stroke-N classes off an icon's className (they are SVG stroke widths, not CSS borders). */
function iconClasses(className) {
  let strokeWidth;
  const rest = String(className || '').split(/\s+/).filter(c => { const m = STROKE_CLASS.exec(c); if (!m) return true; strokeWidth = Number(m[1] ?? m[2]); return false; });
  return { className: rest.join(' '), strokeWidth };
}

/** Apply icon attributes/classes to an image node. Returns the parsed class spec. */
function applyIconElement(node, el, tokens, warnings, where, { isNew }) {
  const raw = iconNameOf(el);
  const icon = raw ? resolveIcon(raw) : null;
  if (raw || isNew) {
    if (icon) { node.icon = icon.name; node.assetStatus = 'ready'; }
    else {
      node.icon = raw || 'unknown'; node.assetStatus = 'missing'; delete node.src;
      warnings.push(`${where}: icon ${JSON.stringify(raw || '')} was not found in the bundled icon sets (lucide, tabler, ph); left an empty placeholder. Use search_icons or a "set:name" such as lucide:arrow-right`);
    }
  }
  const { className, strokeWidth } = iconClasses(el.attrs.className ?? el.attrs.class ?? '');
  const spec = parseClasses(className, { tokens });
  if ('ink' in spec.props) node.iconColor = spec.props.ink;
  if (typeof el.attrs.color === 'string') { if (isSafeColor(el.attrs.color) && el.attrs.color !== 'currentColor') node.iconColor = normalizeColor(el.attrs.color) || el.attrs.color; else if (el.attrs.color === 'currentColor') delete node.iconColor; }
  const sw = Number.isFinite(el.attrs.strokeWidth) ? el.attrs.strokeWidth : Number.isFinite(Number(el.attrs.strokeWidth)) && el.attrs.strokeWidth !== undefined ? Number(el.attrs.strokeWidth) : strokeWidth;
  if (Number.isFinite(sw) && sw > 0 && sw <= 32) node.iconStrokeWidth = sw;
  const size = Number(el.attrs.size);
  if (Number.isFinite(size) && size > 0) { if (!spec.w) { node.w = Math.min(2048, size); node.wMode = 'fixed'; } if (!spec.h) { node.h = Math.min(2048, size); node.hMode = 'fixed'; } }
  else if (isNew) { if (!spec.w) node.w = spec.h?.px ?? 24; if (!spec.h) node.h = spec.w?.px ?? 24; }
  return spec;
}

const iconCache = new Map();
/** Regenerate icon image sources from their resolved color, size and stroke width. */
export function refreshIcons(page, document = {}) {
  const index = indexPage(page);
  const tokens = document.tokens || {};
  for (const node of page.nodes) {
    if (node.type !== 'image' || !node.icon || node.assetStatus === 'missing') continue;
    let color = node.iconColor;
    if (!color) { const style = baselineTextStyle({ type: 'text' }, index.ancestors(node)); color = (style.token && tokens[style.token]) || style.color || TEXT_DEFAULTS.color; }
    const size = Math.round(Math.max(1, Math.min(Number(node.w) || 24, Number(node.h) || 24)));
    const key = `${node.icon}|${color}|${size}|${node.iconStrokeWidth ?? ''}`;
    if (!iconCache.has(key)) { if (iconCache.size > 500) iconCache.clear(); iconCache.set(key, iconToNodeImage(node.icon, { size, color, strokeWidth: node.iconStrokeWidth })); }
    const src = iconCache.get(key);
    if (src) { node.src = src; node.assetStatus = 'ready'; } else { delete node.src; node.assetStatus = 'missing'; }
  }
}

/**
 * Convert parsed JSX elements to nodes under `parent` (a node or null). Returns
 * {roots, nodes, warnings}. Geometry is computed later by `reflow` once the nodes are on the page.
 * `reuse` maps short/long ids of nodes being replaced to node ids that may be kept.
 */
function applySvgColor(node, attrs) {
  if (Object.hasOwn(attrs, 'data-svg-color')) {
    const value = attrs['data-svg-color'];
    if (value === '') { delete node.svgColor; delete node.svgColorToken; }
    else if (typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) node.svgColor = value;
    else throw new Error('Invalid SVG color');
  }
  if (Object.hasOwn(attrs, 'data-svg-color-token')) {
    const name = attrs['data-svg-color-token'];
    if (name === '') delete node.svgColorToken;
    else { checkTokenName(name); node.svgColorToken = name; }
  }
  if (!/^data:image\/svg\+xml;base64,/.test(node.src || '')) { delete node.svgColor; delete node.svgColorToken; }
}

export function buildNodes(elements, { document, page, parent = null, warnings = [], keepRootId = null, reuse = null }) {
  const tokens = document.tokens || {};
  const nodes = []; const roots = [];
  const make = (el, parentNode, isTop) => {
    const kind = classify(el);
    if (el.tag === 'br') return null;
    const isIcon = kind === 'icon';
    const label = typeof el.attrs['data-node-label'] === 'string' && el.attrs['data-node-label'].trim() ? el.attrs['data-node-label'].trim().slice(0, 200) : null;
    const where = `<${el.tag}${label ? ` "${label}"` : ''}>`;
    const spec = parseClasses(isIcon ? iconClasses(el.attrs.className ?? el.attrs.class ?? '').className : el.attrs.className ?? el.attrs.class ?? '', { tokens });
    if (spec.warnings.length) warnings.push(`Classes on ${where}: ${spec.warnings.slice(0, 12).join('; ')}${spec.warnings.length > 12 ? ' …' : ''}`);
    if (el.attrs.style !== undefined) warnings.push(`style attributes are not supported on <${el.tag}>; use Tailwind classes`);
    let reused = null;
    if (reuse && typeof el.attrs['data-node-id'] === 'string') reused = reuse(el.attrs['data-node-id']);
    const id = (isTop && keepRootId) ? keepRootId.id : reused?.id || randomUUID();
    const shortId = (isTop && keepRootId) ? keepRootId.shortId : reused?.shortId;
    const boxText = kind === 'text' && (el.tag === 'button' || BOX_KEYS.some(k => spec.has.has(k)) || spec.has.has('layout'));
    const type = boxText ? 'frame' : isIcon ? 'image' : kind;
    const node = { ...clone(NODE_DEFAULTS), id, type, parentId: parentNode?.id ?? null, name: label || (isIcon ? (resolveIcon(iconNameOf(el))?.icon || iconNameOf(el) || 'Icon') : defaultName(type, el)) };
    if (shortId) node.shortId = shortId;
    if (isSafeTag(el.tag) && !['div', 'p', 'img'].includes(el.tag)) node.htmlTag = el.tag;
    node.color = type === 'frame' ? 'transparent' : type === 'text' ? TEXT_DEFAULTS.color : type === 'shader' ? '#a58bdd' : '#d9d9d9';
    if (type === 'frame') node.layout = 'block';
    if (type === 'text') node.styleOwn = [];
    if (type === 'shader') {
      if (['aurora', 'waves', 'noise', 'ribbon', 'mesh', 'swirl'].includes(el.attrs.preset)) node.shaderPreset = el.attrs.preset;
      if (Number.isFinite(el.attrs.speed)) node.shaderSpeed = Math.min(5, Math.max(0, el.attrs.speed));
      if (Number.isFinite(el.attrs.intensity)) node.shaderIntensity = Math.min(2, Math.max(0, el.attrs.intensity));
    }
    if (isIcon) { node.color = 'transparent'; applyIconElement(node, el, tokens, warnings, where, { isNew: true }); }
    else if (type === 'image') {
      const src = typeof el.attrs.src === 'string' ? el.attrs.src.trim() : '';
      if (isEmbeddedSrc(src)) node.src = src;
      else if (isRemoteSrc(src)) {
        // Fetched asynchronously by the tool layer, which embeds it as src and sets assetStatus 'ready'.
        if (reused?.srcRemote === src && reused.src) { node.src = reused.src; node.srcRemote = src; node.assetStatus = reused.assetStatus || 'ready'; }
        else { node.srcRemote = src; node.assetStatus = 'pending'; }
      } else if (reused?.src && !src) node.src = reused.src;
      else if (src) warnings.push(`Image ${label || ''} src must be an embedded data:image URL or an http(s) URL; created an empty image placeholder`);
      applySvgColor(node, el.attrs);
    }
    if (type === 'text') { const { text, runs } = collectText(el, { tokens }); node.text = text; node.textRuns = runs; }
    // Text-only keys (truncate, line-clamp) belong to the label of a box-text element.
    const ownSpec = boxText ? { ...spec, props: Object.fromEntries(Object.entries(spec.props).filter(([k]) => !TEXT_ONLY_KEYS.includes(k))) } : spec;
    applySpec(node, ownSpec, tokens);
    if (boxText) {
      // Text with a box (button, badge, pill): a flex frame that centers a text child.
      // Buttons center their label (UA behaviour); other boxes keep block flow and text-align.
      if (el.tag === 'button' && !spec.has.has('layout')) {
        node.layout = 'flex'; if (!spec.has.has('alignItems')) node.alignItems = 'center';
        if (!spec.has.has('justifyContent')) node.justifyContent = spec.props.textAlign === 'left' ? 'flex-start' : spec.props.textAlign === 'right' ? 'flex-end' : 'center';
      }
      if (el.tag === 'button' && !spec.has.has('fill') && !spec.has.has('gradient')) { node.color = '#25252e'; if (!spec.has.has('ink')) node.textStyle = mergeStyle(node.textStyle, { color: '#ffffff', token: '' }); }
    }
    applyGeometry(node, spec, parentNode, { isNew: true, warnings, label: where });
    nodes.push(node);
    if (boxText) {
      const text = { ...clone(NODE_DEFAULTS), id: randomUUID(), type: 'text', parentId: node.id, name: 'Label', color: TEXT_DEFAULTS.color, styleOwn: [] };
      const { text: content, runs } = collectText(el, { tokens }); text.text = content; text.textRuns = runs;
      applySpec(text, { props: Object.fromEntries(TEXT_ONLY_KEYS.filter(k => k in spec.props).map(k => [k, spec.props[k]])), has: new Set(), ignored: [], warnings: [] }, tokens);
      applyGeometry(text, { props: {}, has: new Set() }, node, { isNew: true, warnings, label: where });
      nodes.push(text);
    } else if (type === 'frame') {
      for (const child of el.children) {
        if (child.text !== undefined) { if (child.text.trim()) warnings.push(`Loose text "${child.text.trim().slice(0, 40)}" inside <${el.tag}> was wrapped in a text element`); else continue; make({ tag: 'p', attrs: {}, children: [child], selfClosing: false }, node, false); continue; }
        make(child, node, false);
      }
    }
    if (!parentNode && el) {
      const cw = Number(el.attrs['data-component-width']), ch = Number(el.attrs['data-component-height']);
      if (Number.isFinite(cw) && cw > 0 && !spec.w) { node.wMode = 'fixed'; node.w = cw; }
      if (Number.isFinite(ch) && ch > 0 && !spec.h) { node.hMode = 'fixed'; node.h = ch; }
      if (node.wMode === 'hug') node._autoWidth = true;
      node._pos = { x: Number(el.attrs['data-component-x']), y: Number(el.attrs['data-component-y']) };
    }
    return node;
  };
  for (const el of elements) { const root = make(el, parent, true); if (root) roots.push(root); }
  return { roots, nodes, warnings };
}

function defaultName(type, el) {
  if (type === 'text') { const t = el ? collectText(el).text.replace(/\s+/g, ' ').trim().slice(0, 40).trim() : ''; return t || 'Text'; }
  if (el && isSafeTag(el.tag) && el.tag !== 'div') return el.tag[0].toUpperCase() + el.tag.slice(1);
  return { frame: 'Frame', rectangle: 'Rectangle', image: 'Image', shader: 'Shader' }[type] || 'Layer';
}

/**
 * Recompute text inheritance and geometry for the artboards containing `nodes` (all artboards
 * when omitted). Flow children get x/y relative to their parent; hug/fill sizes are re-estimated.
 */
export function reflow(page, nodes = null, warnings = [], document = null) {
  const index = indexPage(page);
  cascadeText(page.nodes, index.byId);
  const roots = nodes ? new Set(nodes.filter(Boolean).map(n => index.rootOf(index.byId.get(n.id) || n).id)) : null;
  layoutPage(page, roots);
  // Artboards without a width: size to content once (capped), then keep that width fixed.
  // Artboards without a width hug their content; very wide content is capped at 1200px.
  const autos = page.nodes.filter(n => n._autoWidth && (delete n._autoWidth) && n.w > 1200);
  for (const root of autos) {
    root.wMode = 'fixed'; root.w = 1200;
    warnings.push(`Artboard "${root.name}" has no width and its content is wider than 1200px; using 1200px. Add w-[…px] or data-component-width.`);
  }
  if (autos.length) layoutPage(page, new Set(autos.map(n => n.id)));
  refreshIcons(page, document || {});
  // Legacy free frames: right/bottom offsets resolve against the frame size.
  for (const n of page.nodes) {
  }
  return warnings;
}

function nextArtboardX(page, self) {
  const existing = page.nodes.filter(n => !n.parentId && n !== self && Number.isFinite(n.x) && !n._placing);
  if (!existing.length) return 0;
  return Math.ceil(Math.max(...existing.map(n => n.x + n.w)) + 80);
}

// ---------------------------------------------------------------------------------------------
// Tree operations

export function removeSubtree(page, node) {
  const index = indexPage(page);
  const removed = new Set([node.id, ...index.descendants(node.id).map(n => n.id)]);
  page.nodes = page.nodes.filter(n => !removed.has(n.id));
  return removed;
}

/** Insert nodes (already parent-linked) relative to an anchor. */
export function insertNodes(page, newNodes, where) {
  let at = page.nodes.length;
  if (where.before) at = page.nodes.indexOf(where.before);
  else if (where.after) { at = page.nodes.indexOf(where.after) + 1; }
  else if (where.first) { const firstSibling = page.nodes.find(n => (n.parentId || null) === (where.parentId || null)); if (firstSibling) at = page.nodes.indexOf(firstSibling); }
  if (at < 0) at = page.nodes.length;
  page.nodes.splice(at, 0, ...newNodes);
}

function promoteToFrame(node) {
  if (node.type === 'frame') return;
  if (node.type !== 'rectangle') throw new Error(`Element is a ${node.type}; only frames (or empty rectangles) can contain children`);
  node.type = 'frame';
  if (!node.layout || node.layout === 'free') node.layout = 'block';
}

// ---------------------------------------------------------------------------------------------
// update_elements directive script

const DIRECTIVE = /\{?\s*\/\*\s*((?:edit|replace|delete|insert\s+as\s+(?:first|last)\s+child\s+of|insert\s+(?:before|after))\s+[A-Za-z0-9_.:-]+)\s*\*\/\s*\}?/gi;
export function parseDirectives(script) {
  if (typeof script !== 'string' || !script.trim()) throw new Error('edit must be a non-empty directive script');
  const matches = [...script.matchAll(DIRECTIVE)];
  if (!matches.length) throw new Error('No directives found. Start each step with a comment such as {/* edit abc.def */}, {/* replace abc.def */}, {/* insert as last child of abc */}, {/* insert after abc.def */} or {/* delete abc.def */}.');
  const leading = script.slice(0, matches[0].index).trim();
  if (leading) throw new Error('Unexpected content before the first directive');
  return matches.map((m, i) => {
    const header = m[1].replace(/\s+/g, ' ').trim();
    const body = script.slice(m.index + m[0].length, i + 1 < matches.length ? matches[i + 1].index : script.length).trim();
    const parts = header.split(' '); const target = parts.at(-1); const verb = parts[0].toLowerCase();
    const kind = verb === 'insert' ? (header.toLowerCase().includes('first child') ? 'first' : header.toLowerCase().includes('last child') ? 'last' : parts[1].toLowerCase()) : verb;
    return { header, kind, target, body };
  });
}

/** Patch an existing node from an element (attributes, classes, text) and recurse into identified children. */
function editNode(document, page, node, el, warnings) {
  const index = indexPage(page);
  const iconTag = el.tag !== 'Shader' && /^[A-Z]/.test(el.tag);
  const kind = el.tag === 'Shader' ? 'shader' : el.tag === 'img' || iconTag ? 'image' : null;
  if (kind && kind !== node.type) throw new Error(`Element ${index.shortId(node)} is a ${node.type}; use replace to change it into a ${kind}`);
  if (iconTag !== !!node.icon && kind === 'image') throw new Error(`Element ${index.shortId(node)} is ${node.icon ? 'an icon; edit it with <Icon name="…">' : 'an image; edit it with <img>'} or use replace`);
  if (typeof el.attrs['data-node-label'] === 'string' && el.attrs['data-node-label'].trim()) node.name = el.attrs['data-node-label'].trim().slice(0, 200);
  const cls = el.attrs.className ?? el.attrs.class;
  const textBefore = node.text, sizeBefore = node.fontSize;
  let spec = null;
  if (iconTag) {
    applyIconElement(node, el, document.tokens || {}, warnings, index.shortId(node), { isNew: false });
  }
  if (typeof cls === 'string') {
    spec = parseClasses(iconTag ? iconClasses(cls).className : cls, { tokens: document.tokens || {} });
    if (spec.warnings.length) warnings.push(`Classes on ${index.shortId(node)}: ${spec.warnings.slice(0, 12).join('; ')}`);
    applySpec(node, spec, document.tokens);
    const parent = node.parentId ? index.byId.get(node.parentId) : null;
    applyGeometry(node, spec, parent, { isNew: false, warnings, label: index.shortId(node) });
  }
  if (!node.parentId) { const cx = Number(el.attrs['data-component-x']), cy = Number(el.attrs['data-component-y']); if (Number.isFinite(cx)) node.x = cx; if (Number.isFinite(cy)) node.y = cy; }
  if (node.type === 'image' && !node.icon && typeof el.attrs.src === 'string') {
    const src = el.attrs.src.trim();
    if (isEmbeddedSrc(src)) { node.src = src; delete node.srcRemote; delete node.assetStatus; }
    else if (isRemoteSrc(src) && src !== node.srcRemote) { node.srcRemote = src; node.assetStatus = 'pending'; delete node.src; }
  }
  if (node.type === 'image' && !node.icon) applySvgColor(node, el.attrs);
  if (node.type === 'shader') {
    if (['aurora', 'waves', 'noise', 'ribbon', 'mesh', 'swirl'].includes(el.attrs.preset)) node.shaderPreset = el.attrs.preset;
    if (Number.isFinite(el.attrs.speed)) node.shaderSpeed = Math.min(5, Math.max(0, el.attrs.speed));
    if (Number.isFinite(el.attrs.intensity)) node.shaderIntensity = Math.min(2, Math.max(0, el.attrs.intensity));
  }
  if (node.type === 'text') {
    if (el.children.length) {
      if (!isTextOnly(el)) throw new Error(`Text element ${index.shortId(node)} can only contain text and inline tags (b, i, span, br)`);
      const { text, runs } = collectText(el, { tokens: document.tokens || {} }); node.text = text; node.textRuns = runs;
    }
    // Text grows with its content unless the edit pins a height (legacy nodes had baked heights).
    if ((node.text !== textBefore || node.fontSize !== sizeBefore) && !(spec && spec.h) && node.hMode !== 'fill') node.hMode = 'hug';
    return;
  }
  for (const child of el.children) {
    if (child.text !== undefined) { if (child.text.trim()) throw new Error(`Cannot put loose text inside ${node.type} ${index.shortId(node)}; edit a text child or insert one`); continue; }
    const ref = child.attrs['data-node-id'];
    if (typeof ref !== 'string') throw new Error(`Child <${child.tag}> inside an edit needs data-node-id; use "insert as last child of ${index.shortId(node)}" to add new elements`);
    const target = index.require(ref);
    if (target.parentId !== node.id) throw new Error(`${ref} is not a direct child of ${index.shortId(node)}`);
    editNode(document, page, target, child, warnings);
  }
}

export function applyDirective(document, page, directive, warnings = []) {
  const index = indexPage(page);
  const target = index.require(directive.target);
  if (directive.kind === 'delete') {
    if (directive.body) throw new Error('delete takes no JSX body');
    const parent = target.parentId ? index.byId.get(target.parentId) : null;
    const removed = removeSubtree(page, target);
    return { removed: [...removed].length, affected: [], reflow: parent ? [parent] : [] };
  }
  const { elements } = parseJsx(directive.body);
  if (!elements.length) throw new Error(`${directive.kind} needs a JSX element after the directive`);
  if (directive.kind === 'edit') {
    if (elements.length !== 1) throw new Error('edit takes exactly one element');
    editNode(document, page, target, elements[0], warnings);
    return { affected: [target] };
  }
  if (directive.kind === 'replace') {
    if (elements.length !== 1) throw new Error('replace takes exactly one element');
    const oldNodes = [target, ...index.descendants(target.id)];
    const oldById = new Map(oldNodes.map(n => [n.id, n]));
    const used = new Set();
    const reuse = ref => { const found = index.resolve(ref); if (!found || !oldById.has(found.id) || found.id === target.id || used.has(found.id)) return null; used.add(found.id); return found; };
    const parent = target.parentId ? index.byId.get(target.parentId) : null;
    const position = page.nodes.indexOf(target);
    const { roots, nodes } = buildNodes(elements, { document, page, parent, warnings, keepRootId: { id: target.id, shortId: target.shortId }, reuse });
    const root = roots[0]; if (!root) throw new Error('Replacement produced no element');
    if (!parent) { delete root._autoWidth; if (root.wMode === 'hug') { root.wMode = 'fixed'; root.w = target.w; } const cx = Number(elements[0].attrs['data-component-x']), cy = Number(elements[0].attrs['data-component-y']); root.x = Number.isFinite(cx) ? cx : target.x; root.y = Number.isFinite(cy) ? cy : target.y; }
    else if (!parent.layout || parent.layout === 'free') { const spec = parseClasses(elements[0].attrs.className ?? '', { tokens: document.tokens || {} }); if (spec.left === undefined) root.x = target.x; if (spec.top === undefined) root.y = target.y; }
    const before = page.nodes.slice(0, position).filter(n => !oldById.has(n.id)).length;
    page.nodes = page.nodes.filter(n => !oldById.has(n.id));
    page.nodes.splice(before, 0, ...nodes);
    return { affected: [root], replaced: oldNodes.length };
  }
  // insert
  let parent, where;
  if (directive.kind === 'first' || directive.kind === 'last') { parent = target; promoteToFrame(parent); where = { parentId: parent.id, [directive.kind]: true }; }
  else { parent = target.parentId ? index.byId.get(target.parentId) : null; where = { [directive.kind]: target }; }
  const { roots, nodes } = buildNodes(elements, { document, page, parent, warnings });
  if (!parent) for (const root of roots) { root._placing = true; }
  insertNodes(page, nodes, where);
  return { affected: roots, place: parent ? [] : roots };
}

export function runDirectives(document, pageId, script) {
  const directives = parseDirectives(script);
  let working = clone(document);
  ensureShortIds(working);
  const report = []; let applied = 0;
  directives.forEach((directive, i) => {
    const attempt = clone(working); const warnings = [];
    try {
      const page = getPage(attempt, pageId);
      const result = applyDirective(attempt, page, directive, warnings);
      const touched = [...result.affected, ...(result.reflow || [])].map(n => n.id);
      reflow(page, touched.map(id => page.nodes.find(n => n.id === id)).filter(Boolean), warnings, attempt);
      for (const root of result.place || []) { const pos = root._pos || {}; delete root._placing; delete root._pos; root.x = Number.isFinite(pos.x) ? pos.x : nextArtboardX(page, root); root.y = Number.isFinite(pos.y) ? pos.y : 0; }
      for (const n of page.nodes) delete n._pos;
      ensureShortIds(attempt);
      const freshPage = getPage(attempt, pageId);
      const index = indexPage(freshPage);
      const code = result.affected.map(node => elementCode(attempt, freshPage, index.byId.get(node.id), 3)).join('\n');
      working = attempt; applied++;
      report.push(`OK ${i + 1}. ${directive.header}${result.removed ? ` (removed ${result.removed} element${result.removed === 1 ? '' : 's'})` : ''}${warnings.length ? `\n  warnings: ${warnings.join('; ')}` : ''}${code ? `\n${code}` : ''}`);
    } catch (error) {
      report.push(`FAIL ${i + 1}. ${directive.header}: ${error instanceof JsxSyntaxError ? 'JSX syntax error: ' : ''}${error.message}`);
    }
  });
  const failed = directives.length - applied;
  report.push(`${applied} of ${directives.length} directives applied.${failed ? ` ${failed} failed.` : ''}`);
  return { document: working, applied, failed, report: report.join('\n\n') };
}

// ---------------------------------------------------------------------------------------------
// Higher-level operations shared by the tools

export function createArtboards(document, pageId, code) {
  const doc = clone(document); ensureShortIds(doc);
  const page = getPage(doc, pageId);
  const { elements, imports } = parseJsx(code);
  if (!elements.length) throw new Error('code must contain at least one root element');
  const warnings = imports.length ? [`Import lines were ignored (${imports.length}); icon components (<Icon name="lucide:…"/>, <ArrowRight/>, <LuX/>, <IconBrandGithub/>) are resolved by name from the bundled lucide, tabler and phosphor sets`] : [];
  const { roots, nodes } = buildNodes(elements, { document: doc, page, parent: null, warnings });
  if (!roots.length) throw new Error('No supported elements were found in code');
  const positions = new Map(roots.map(root => [root, root._pos || {}]));
  for (const root of roots) { root._placing = true; delete root._pos; }
  page.nodes.push(...nodes);
  reflow(page, roots, warnings, doc);
  for (const root of roots) {
    const { x, y } = positions.get(root) || {};
    delete root._placing;
    root.x = Number.isFinite(x) ? x : nextArtboardX(page, root); root.y = Number.isFinite(y) ? y : 0;
  }
  ensureShortIds(doc);
  const index = indexPage(getPage(doc, pageId));
  return { document: doc, roots: roots.map(r => index.byId.get(r.id)), warnings, page: getPage(doc, pageId) };
}

export function duplicateElements(document, pageId, ref, { count = 1, newArtboard, label, className } = {}) {
  const doc = clone(document); ensureShortIds(doc);
  const page = getPage(doc, pageId); const index = indexPage(page);
  const source = index.require(ref);
  const isRoot = !source.parentId; const asArtboard = newArtboard ?? isRoot;
  const subtree = [source, ...index.descendants(source.id)];
  const created = []; const warnings = [];
  let anchor = source;
  for (let copyIndex = 0; copyIndex < count; copyIndex++) {
    const ids = new Map(subtree.map(n => [n.id, randomUUID()]));
    const copies = subtree.map(n => { const c = clone(n); c.id = ids.get(n.id); delete c.shortId; c.parentId = n.id === source.id ? (asArtboard ? null : n.parentId) : ids.get(n.parentId); return c; });
    const root = copies[0];
    if (asArtboard) {
      const absolute = (() => { let x = source.x, y = source.y, cur = source; while (cur.parentId) { cur = index.byId.get(cur.parentId); x += cur.x; y += cur.y; } return { x, y }; })();
      const right = Math.max(...page.nodes.filter(n => !n.parentId).map(n => n.x + n.w), absolute.x + source.w);
      root.x = Math.ceil(right + 80); root.y = absolute.y;
      if (!isRoot) { root.wMode = 'fixed'; root.w = source.w; if (root.hMode === 'fill') root.hMode = 'fixed'; delete root.wPct; delete root.hPct; delete root.position; delete root.inset; delete root.translate; delete root.margin; }
      page.nodes.push(...copies);
    } else {
      const parent = source.parentId ? index.byId.get(source.parentId) : null;
      if (!parent || parent.layout === 'free') { root.x = source.x + 20 * (copyIndex + 1); root.y = source.y + 20 * (copyIndex + 1); }
      insertNodes(page, copies, { after: anchor }); anchor = root;
    }
    if (label) root.name = String(label).slice(0, 200);
    else if (asArtboard) root.name = `${source.name} copy${count > 1 ? ' ' + (copyIndex + 1) : ''}`;
    if (className) {
      const spec = parseClasses(className, { tokens: doc.tokens || {} });
      applySpec(root, spec, doc.tokens);
      applyGeometry(root, spec, root.parentId ? index.byId.get(root.parentId) : null, { isNew: false, warnings, label: root.name });
    }
    created.push(root);
  }
  reflow(page, created, [], doc);
  ensureShortIds(doc);
  const fresh = indexPage(getPage(doc, pageId));
  return { document: doc, created: created.map(n => fresh.byId.get(n.id)), page: getPage(doc, pageId), warnings };
}

// ---------------------------------------------------------------------------------------------
// Design tokens. Verynize stores color variables as `tokens: {name: '#rrggbb'}`; tools expose
// them Wonder-style with slash-separated names and a CSS variable.

export function describeTokens(document) {
  return Object.entries(document.tokens || {}).map(([name, value]) => ({ id: name, name, type: 'color', value, cssVar: `var(${cssVarForToken(name)})` }));
}
export function tokenColor(value) {
  // Opaque colors become #rrggbb; translucent ones keep their alpha as #rrggbbaa.
  const exact = typeof value === 'string' ? cssColorToHex(value.trim().toLowerCase()) : null;
  const color = exact && exact !== 'transparent' && exact.length === 9 ? exact : normalizeColor(value);
  if (!color || color === 'transparent') throw new Error(`Token value ${JSON.stringify(value)} must be a hex or rgb() color`);
  return color;
}
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
export function checkTokenName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/.test(name) || RESERVED.has(name)) throw new Error(`Invalid token name ${JSON.stringify(name)}; use letters, digits, "-", "_", "." and "/" (e.g. color/text/primary)`);
  return name;
}
export function renameTokenRefs(document, from, to) { for (const page of document.pages) for (const node of page.nodes) { if (node.token === from) node.token = to; if (node.svgColorToken === from) node.svgColorToken = to; } }
export function unbindToken(document, name) { const value = document.tokens[name]; for (const page of document.pages) for (const node of page.nodes) { if (node.token === name) { node.color = value; node.token = ''; } if (node.svgColorToken === name) { node.svgColor = value; delete node.svgColorToken; } } }
export function syncTokenColors(document) { for (const page of document.pages) for (const node of page.nodes) { if (node.token && document.tokens[node.token]) node.color = document.tokens[node.token]; if (node.svgColorToken && document.tokens[node.svgColorToken]) node.svgColor = document.tokens[node.svgColorToken]; } syncVariables(document); }

// ---------------------------------------------------------------------------------------------
// Typed variables (dimension / number / fontFamily / fontWeight; see design-store.mjs). Bound layer
// properties hold the resolved value; syncVariables re-applies variable values after every write.

const FIELD_LIMITS = { opacity: [0, 100], fontSize: [1, 1000], lineHeight: [0.1, 100], radius: [0, 1e6], gap: [0, 1e6], padding: [0, 1e6], strokeWidth: [0, 1e6] };
/** Value a variable gives to a layer property, or undefined when the binding cannot apply. */
export function variableValueFor(document, key, name) {
  const variable = document.variables?.[name];
  if (!variable || !BINDABLE[key]?.includes(variable.type) || !checkVariableValue(variable.type, variable.value)) return undefined;
  if (variable.type === 'fontWeight') return String(variable.value);
  if (variable.type === 'fontFamily') return variable.value.trim();
  const [min, max] = FIELD_LIMITS[key] || [-1e6, 1e6];
  return Math.min(max, Math.max(min, variable.value));
}
export function syncVariables(document) {
  if (!document.variables) return document;
  for (const page of document.pages) for (const node of page.nodes) for (const [key, name] of Object.entries(node.bindings || {})) {
    const value = variableValueFor(document, key, name);
    if (value !== undefined) node[key] = value;
  }
  return document;
}
/** Remove every binding to `name`; layers keep the current resolved value. */
export function unbindVariable(document, name) {
  for (const page of document.pages) for (const node of page.nodes) if (node.bindings) {
    for (const [key, bound] of Object.entries(node.bindings)) if (bound === name) delete node.bindings[key];
    if (!Object.keys(node.bindings).length) delete node.bindings;
  }
  return document;
}
export function renameVariableRefs(document, from, to) {
  for (const page of document.pages) for (const node of page.nodes) for (const key of Object.keys(node.bindings || {})) if (node.bindings[key] === from) node.bindings[key] = to;
  return document;
}
export function describeVariables(document) {
  return Object.entries(document.variables || {}).map(([name, v]) => ({ id: name, name, type: v.type, value: v.value, cssVar: `var(${cssVarForToken(name)})` }));
}
/** CSS custom properties for color tokens and typed variables (`:root { --name: value; }`). */
export function variablesCss(document) {
  const lines = [];
  const names = new Map();
  const add = (name, value) => {
    const identifier = cssVarForToken(name);
    if (names.has(identifier)) throw new Error(`Variables “${names.get(identifier)}” and “${name}” both export as ${identifier}. Rename one before exporting CSS.`);
    names.set(identifier, name);
    lines.push(`  ${identifier}: ${value};`);
  };
  for (const [name, value] of Object.entries(document.tokens || {})) add(name, value);
  for (const [name, v] of Object.entries(document.variables || {})) {
    if (!checkVariableValue(v.type, v.value)) continue;
    const value = v.type === 'dimension' ? `${v.value}px` : v.type === 'fontFamily' ? (/^[a-zA-Z-]+$/.test(v.value.trim()) ? v.value.trim() : `'${v.value.trim().replace(/['\\]/g, '')}'`) : String(v.value);
    add(name, value);
  }
  return lines.length ? `:root {\n${lines.join('\n')}\n}\n` : '';
}
