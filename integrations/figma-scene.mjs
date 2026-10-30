// Translate a decoded Figma binary scene (the `nodeChanges` list of a fig-kiwi message, from a clipboard
// payload or a .fig file) into the node shape of Figma's public REST API, so one converter
// (convertFigma in desktop/figma.cjs) handles REST, clipboard and file imports alike.
//
//   sceneToRest(message, {images}) -> {document: {type:'DOCUMENT', children:[CANVAS...]}, name, images: {hashHex: dataURL}, warnings}
//
// Geometry: every scene node has `size` and a parent-relative 2×3 `transform`. Absolute transforms are
// accumulated to produce `absoluteBoundingBox` (axis-aligned) and `relativeTransform`/`size`, exactly
// what the REST API returns with `geometry=paths`. Path blobs (fillGeometry/strokeGeometry commandsBlob)
// are decoded to SVG path strings. Component instances are expanded from their component (overrides and
// derived sizes applied) and later flattened into editable layers.
import { hexOf } from "./figma-kiwi.mjs";

const key = (g) => (g ? `${g.sessionID}:${g.localID}` : "");
const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const mul = (a, b) => ({
  m00: a.m00 * b.m00 + a.m01 * b.m10,
  m01: a.m00 * b.m01 + a.m01 * b.m11,
  m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
  m10: a.m10 * b.m00 + a.m11 * b.m10,
  m11: a.m10 * b.m01 + a.m11 * b.m11,
  m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
});
const apply = (m, x, y) => ({ x: m.m00 * x + m.m01 * y + m.m02, y: m.m10 * x + m.m11 * y + m.m12 });
function invert(m) {
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (!det) return null;
  return {
    m00: m.m11 / det,
    m01: -m.m01 / det,
    m02: (m.m01 * m.m12 - m.m11 * m.m02) / det,
    m10: -m.m10 / det,
    m11: m.m00 / det,
    m12: (m.m10 * m.m02 - m.m00 * m.m12) / det,
  };
}
const TYPE = { SYMBOL: "COMPONENT", ROUNDED_RECTANGLE: "RECTANGLE" };
const CONSTRAINT_H = {
  MIN: "LEFT",
  MAX: "RIGHT",
  CENTER: "CENTER",
  STRETCH: "LEFT_RIGHT",
  SCALE: "SCALE",
};
const CONSTRAINT_V = {
  MIN: "TOP",
  MAX: "BOTTOM",
  CENTER: "CENTER",
  STRETCH: "TOP_BOTTOM",
  SCALE: "SCALE",
};
const EFFECT = { FOREGROUND_BLUR: "LAYER_BLUR" };
const SIZING = (s) =>
  s === "RESIZE_TO_FIT" || s === "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE" ? "AUTO" : "FIXED";
const WEIGHTS = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/light/, 300],
  [/medium/, 500],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700],
];
export function weightOf(style = "") {
  const s = String(style).toLowerCase();
  for (const [re, w] of WEIGHTS) if (re.test(s)) return w;
  return 400;
}

/** Decode a commandsBlob: opcode bytes (0 close, 1 move, 2 line, 3 quad, 4 cubic) + float32 LE coordinates. */
export function pathFromCommands(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    view = new DataView(b.buffer, b.byteOffset, b.byteLength),
    out = [];
  const ARGS = { 1: ["M", 2], 2: ["L", 2], 3: ["Q", 4], 4: ["C", 6] };
  let i = 0;
  const num = (v) => String(Math.round(v * 1000) / 1000);
  while (i < b.length) {
    const op = b[i++];
    if (op === 0) {
      out.push("Z");
      continue;
    }
    const spec = ARGS[op];
    if (!spec || i + spec[1] * 4 > b.length) throw new Error("Invalid Figma path data");
    const nums = [];
    for (let k = 0; k < spec[1]; k++, i += 4) nums.push(num(view.getFloat32(i, true)));
    out.push(spec[0] + nums.join(" "));
  }
  return out.join("");
}
/** Inverse of pathFromCommands for absolute M/L/Q/C/Z paths (fixtures and tests). */
export function commandsFromPath(d) {
  const tokens = String(d).match(/[MLQCZ]|-?[\d.]+(?:e-?\d+)?/gi) || [],
    bytes = [],
    ARGS = { M: [1, 2], L: [2, 2], Q: [3, 4], C: [4, 6], Z: [0, 0] };
  let at = 0;
  while (at < tokens.length) {
    const [op, n] = ARGS[tokens[at++].toUpperCase()];
    bytes.push(op);
    for (let k = 0; k < n; k++) {
      const f = Buffer.alloc(4);
      f.writeFloatLE(Number(tokens[at++]));
      bytes.push(...f);
    }
  }
  return new Uint8Array(bytes);
}

function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return null;
}

export function sceneToRest(
  message,
  { images = new Map(), maxImages = 60, maxImageBytes = 15 * 1024 * 1024 } = {},
) {
  const changes = Array.isArray(message?.nodeChanges) ? message.nodeChanges : null;
  if (!changes) throw new Error("Figma data contains no scene nodes");
  const blobs = Array.isArray(message.blobs) ? message.blobs.map((b) => b?.bytes) : [],
    warnings = new Set();
  const byId = new Map(),
    children = new Map();
  for (const n of changes) if (n?.guid && n.phase !== "REMOVED") byId.set(key(n.guid), n);
  for (const n of byId.values()) {
    const parent = key(n.parentIndex?.guid);
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(n);
  }
  for (const list of children.values())
    list.sort((a, b) =>
      a.parentIndex.position < b.parentIndex.position
        ? -1
        : a.parentIndex.position > b.parentIndex.position
          ? 1
          : 0,
    );
  const docNode = [...byId.values()].find((n) => n.type === "DOCUMENT");
  const imageURLs = {};
  let imageBytes = 0;
  const imageRef = (paint) => {
    const hash = paint.image?.hash;
    if (!hash || !hash.length) return null;
    const hex = hexOf(hash).toLowerCase();
    if (!(hex in imageURLs)) {
      const data = images.get(hex),
        type = data && sniff(data);
      if (
        data &&
        type &&
        Object.keys(imageURLs).length < maxImages &&
        imageBytes + data.length <= maxImageBytes
      ) {
        imageBytes += data.length;
        imageURLs[hex] = `data:${type};base64,${Buffer.from(data).toString("base64")}`;
      } else imageURLs[hex] = null;
    }
    return hex;
  };

  const color = (c) => ({ r: c?.r ?? 0, g: c?.g ?? 0, b: c?.b ?? 0, a: c?.a ?? 1 });
  function paint(p) {
    if (!p) return null;
    const out = {
      type: p.type,
      visible: p.visible !== false,
      opacity: p.opacity ?? 1,
      blendMode: p.blendMode,
    };
    if (p.type === "SOLID") out.color = color(p.color);
    else if (String(p.type).startsWith("GRADIENT_")) {
      // The paint transform maps layer-normalised space into gradient space; its inverse places the handles.
      const inv = invert(p.transform || IDENTITY) || IDENTITY;
      const pts =
        p.type === "GRADIENT_LINEAR"
          ? [
              [0, 0.5],
              [1, 0.5],
              [0, 1],
            ]
          : [
              [0.5, 0.5],
              [1, 0.5],
              [0.5, 1],
            ];
      out.gradientHandlePositions = pts.map(([x, y]) => apply(inv, x, y));
      out.gradientStops = (p.stops || []).map((s) => ({
        position: s.position ?? 0,
        color: color(s.color),
      }));
    } else if (p.type === "IMAGE") {
      out.imageRef = imageRef(p);
      out.scaleMode =
        { STRETCH: "STRETCH", FIT: "FIT", FILL: "FILL", TILE: "TILE" }[p.imageScaleMode] || "FILL";
      if (p.transform && p.imageScaleMode === "STRETCH")
        out.imageTransform = [
          [p.transform.m00, p.transform.m01, p.transform.m02],
          [p.transform.m10, p.transform.m11, p.transform.m12],
        ];
    }
    return out;
  }
  const geometry = (list) =>
    Array.isArray(list)
      ? list
          .map((g) => {
            const bytes = blobs[g.commandsBlob];
            if (!bytes) return null;
            try {
              return {
                path: pathFromCommands(bytes),
                windingRule: g.windingRule === "ODD" ? "EVENODD" : "NONZERO",
              };
            } catch {
              warnings.add("Some vector paths could not be decoded");
              return null;
            }
          })
          .filter(Boolean)
      : undefined;
  const lineHeight = (lh, size) => {
    if (!lh || !Number.isFinite(lh.value)) return {};
    if (lh.units === "PIXELS") return { lineHeightPx: lh.value, lineHeightUnit: "PIXELS" };
    if (lh.units === "RAW")
      return {
        lineHeightPx: lh.value * size,
        lineHeightUnit: "FONT_SIZE_%",
        lineHeightPercentFontSize: lh.value * 100,
      };
    if (lh.units === "PERCENT" && lh.value !== 100)
      return {
        lineHeightPx: (lh.value / 100) * size,
        lineHeightUnit: "FONT_SIZE_%",
        lineHeightPercentFontSize: lh.value,
      };
    return { lineHeightUnit: "INTRINSIC_%" };
  };
  const letterSpacing = (ls, size) =>
    !ls || !Number.isFinite(ls.value)
      ? undefined
      : ls.units === "PERCENT"
        ? (ls.value / 100) * size
        : ls.value;
  function textStyle(n, base = {}) {
    const s = {};
    if (n.fontName) {
      s.fontFamily = n.fontName.family;
      s.fontWeight = weightOf(n.fontName.style);
      s.italic = /italic|oblique/i.test(n.fontName.style || "");
      s.fontPostScriptName = n.fontName.postscript;
    }
    const size = n.fontSize ?? base.fontSize ?? 16;
    if (n.fontSize !== undefined) s.fontSize = n.fontSize;
    if (n.textAlignHorizontal)
      s.textAlignHorizontal =
        n.textAlignHorizontal === "JUSTIFIED" ? "JUSTIFIED" : n.textAlignHorizontal;
    if (n.textAlignVertical) s.textAlignVertical = n.textAlignVertical;
    if (n.letterSpacing) s.letterSpacing = letterSpacing(n.letterSpacing, size);
    if (n.lineHeight) Object.assign(s, lineHeight(n.lineHeight, size));
    if (n.textCase) s.textCase = { UPPER: "UPPER", LOWER: "LOWER", TITLE: "TITLE" }[n.textCase];
    if (n.textDecoration) s.textDecoration = n.textDecoration;
    if (n.textAutoResize) s.textAutoResize = n.textAutoResize;
    if (Array.isArray(n.fillPaints)) s.fills = n.fillPaints.map(paint).filter(Boolean);
    return s;
  }

  // Instance expansion: the component's subtree is cloned under the instance. Overrides and derived
  // (resized) data are addressed by guid paths relative to each enclosing instance.
  const pathKey = (guids) => guids.map(key).join("/");
  function overridesOf(instance) {
    const map = new Map(),
      derived = new Map();
    for (const o of instance.symbolData?.symbolOverrides || [])
      if (o.guidPath?.guids?.length) map.set(pathKey(o.guidPath.guids), o);
    for (const d of instance.derivedSymbolData || [])
      if (d.guidPath?.guids?.length) derived.set(pathKey(d.guidPath.guids), d);
    return { map, derived };
  }
  const INSTANCE_OWN = new Set([
    "guid",
    "parentIndex",
    "phase",
    "type",
    "name",
    "transform",
    "size",
    "symbolData",
    "derivedSymbolData",
    "visible",
    "internalOnly",
    "horizontalConstraint",
    "verticalConstraint",
    "stackPositioning",
    "stackChildPrimaryGrow",
    "stackChildAlignSelf",
  ]);
  const SKIP = new Set(["guid", "guidPath", "parentIndex", "phase"]);
  function patched(node, scopes, chain) {
    let out = node;
    // Innermost instance first, so overrides set by outer instances win.
    for (let i = scopes.length - 1; i >= 0; i--) {
      const rel = pathKey(chain.slice(scopes[i].depth)),
        d = scopes[i].derived.get(rel),
        o = scopes[i].map.get(rel);
      for (const patch of [d, o])
        if (patch) {
          out = out === node ? { ...node } : out;
          for (const [k, v] of Object.entries(patch))
            if (!SKIP.has(k)) out[k] = k === "textData" ? { ...out.textData, ...v } : v;
        }
    }
    return out;
  }

  let count = 0;
  function convert(raw, parentAbs, scopes, chain, depth) {
    if (depth > 80) throw new Error("Figma hierarchy exceeds 80 levels");
    if (++count > 20000)
      throw new Error("Figma data exceeds 20,000 layers; copy a smaller selection");
    const nodeChain = [...chain, raw.guid];
    let n = scopes.length ? patched(raw, scopes, nodeChain) : raw;
    // An instance inherits the component's own properties (fills, auto layout, effects…) unless it sets them.
    if (n.type === "INSTANCE") {
      const symbol = byId.get(key(n.symbolData?.symbolID));
      if (symbol) {
        const inherited = {};
        for (const [k, v] of Object.entries(symbol)) if (!INSTANCE_OWN.has(k)) inherited[k] = v;
        n = { ...inherited, ...n };
      }
    }
    const transform = n.transform || IDENTITY,
      abs = mul(parentAbs, transform);
    const w = Math.max(0, n.size?.x ?? 0),
      h = Math.max(0, n.size?.y ?? 0);
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map(([x, y]) => apply(abs, x, y));
    const xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y);
    const type = TYPE[n.type] || n.type;
    const out = {
      id: key(n.guid) || `${count}`,
      type,
      name: n.name || type,
      visible: n.visible !== false,
      opacity: n.opacity ?? 1,
      blendMode: n.blendMode,
      absoluteBoundingBox: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      size: { x: w, y: h },
      relativeTransform: [
        [transform.m00, transform.m01, transform.m02],
        [transform.m10, transform.m11, transform.m12],
      ],
    };
    if (Array.isArray(n.fillPaints)) out.fills = n.fillPaints.map(paint).filter(Boolean);
    if (Array.isArray(n.strokePaints)) out.strokes = n.strokePaints.map(paint).filter(Boolean);
    if (n.strokeWeight !== undefined) out.strokeWeight = n.strokeWeight;
    if (n.strokeAlign) out.strokeAlign = n.strokeAlign;
    if (Array.isArray(n.dashPattern) && n.dashPattern.length) out.strokeDashes = n.dashPattern;
    if (n.borderStrokeWeightsIndependent)
      out.individualStrokeWeights = {
        top: n.borderTopWeight ?? 0,
        right: n.borderRightWeight ?? 0,
        bottom: n.borderBottomWeight ?? 0,
        left: n.borderLeftWeight ?? 0,
      };
    if (Array.isArray(n.effects))
      out.effects = n.effects.map((e) => ({
        type: EFFECT[e.type] || e.type,
        visible: e.visible !== false,
        color: color(e.color),
        offset: { x: e.offset?.x ?? 0, y: e.offset?.y ?? 0 },
        radius: e.radius ?? 0,
        spread: e.spread ?? 0,
      }));
    if (n.cornerRadius !== undefined) out.cornerRadius = n.cornerRadius;
    if (n.rectangleCornerRadiiIndependent)
      out.rectangleCornerRadii = [
        n.rectangleTopLeftCornerRadius ?? 0,
        n.rectangleTopRightCornerRadius ?? 0,
        n.rectangleBottomRightCornerRadius ?? 0,
        n.rectangleBottomLeftCornerRadius ?? 0,
      ];
    if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(type))
      out.clipsContent = n.frameMaskDisabled !== true;
    if (n.mask) out.isMask = true;
    if (n.horizontalConstraint || n.verticalConstraint)
      out.constraints = {
        horizontal: CONSTRAINT_H[n.horizontalConstraint] || "LEFT",
        vertical: CONSTRAINT_V[n.verticalConstraint] || "TOP",
      };
    if (n.stackMode === "HORIZONTAL" || n.stackMode === "VERTICAL") {
      const left = n.stackHorizontalPadding ?? n.stackPadding ?? 0,
        top = n.stackVerticalPadding ?? n.stackPadding ?? 0;
      Object.assign(out, {
        layoutMode: n.stackMode,
        itemSpacing: n.stackSpacing ?? 0,
        counterAxisSpacing: n.stackCounterSpacing,
        paddingLeft: left,
        paddingTop: top,
        paddingRight: n.stackPaddingRight ?? left,
        paddingBottom: n.stackPaddingBottom ?? top,
        primaryAxisAlignItems:
          n.stackPrimaryAlignItems === "SPACE_EVENLY"
            ? "SPACE_BETWEEN"
            : n.stackPrimaryAlignItems || "MIN",
        counterAxisAlignItems: n.stackCounterAlignItems || "MIN",
        layoutWrap: n.stackWrap === "WRAP" ? "WRAP" : "NO_WRAP",
        primaryAxisSizingMode: SIZING(n.stackPrimarySizing),
        counterAxisSizingMode: SIZING(n.stackCounterSizing),
      });
    }
    if (n.stackPositioning === "ABSOLUTE") out.layoutPositioning = "ABSOLUTE";
    if (n.stackChildPrimaryGrow) out.layoutGrow = n.stackChildPrimaryGrow;
    if (n.stackChildAlignSelf === "STRETCH") out.layoutAlign = "STRETCH";
    if (n.booleanOperation) out.booleanOperation = n.booleanOperation;
    const fillGeometry = geometry(n.fillGeometry),
      strokeGeometry = geometry(n.strokeGeometry);
    if (fillGeometry?.length) out.fillGeometry = fillGeometry;
    if (strokeGeometry?.length) out.strokeGeometry = strokeGeometry;
    if (
      n.arcData &&
      (Math.abs((n.arcData.endingAngle ?? 0) - (n.arcData.startingAngle ?? 0) - 2 * Math.PI) >
        1e-3 ||
        n.arcData.innerRadius)
    )
      out.arcData = n.arcData;
    if (type === "TEXT") {
      const td = n.textData || {},
        base = textStyle(n);
      out.characters = String(td.characters ?? "");
      out.style = base;
      if (base.fills) out.fills = base.fills;
      const ids = Array.isArray(td.characterStyleIDs) ? td.characterStyleIDs : [];
      if (ids.some(Boolean)) {
        out.characterStyleOverrides = ids;
        out.styleOverrideTable = {};
        for (const entry of td.styleOverrideTable || [])
          if (entry?.styleID) out.styleOverrideTable[entry.styleID] = textStyle(entry, base);
      }
    }
    // Children: own children, or the component's children for an instance.
    let kids = children.get(key(raw.guid)) || [],
      nextScopes = scopes,
      nextChain = nodeChain;
    if (type === "INSTANCE") {
      const symbol = byId.get(key(n.symbolData?.symbolID));
      if (symbol) {
        out.componentName = symbol.name;
        kids = children.get(key(symbol.guid)) || [];
        nextScopes = [...scopes, { depth: nodeChain.length, ...overridesOf(n) }];
        // Resized instance: scale the component's children only when no derived data repositions them.
        if (
          !(n.derivedSymbolData || []).length &&
          symbol.size &&
          (Math.abs(symbol.size.x - w) > 0.5 || Math.abs(symbol.size.y - h) > 0.5)
        )
          warnings.add(`${out.name}: resized instance children keep component positions`);
      } else if (!kids.length)
        warnings.add(`${out.name}: component definition is not in the copied data`);
    }
    out.children = kids
      .map((child) => convert(child, abs, nextScopes, nextChain, depth + 1))
      .filter(Boolean);
    return out;
  }

  const canvases = (
    docNode
      ? children.get(key(docNode.guid)) || []
      : [...byId.values()].filter((n) => n.type === "CANVAS")
  ).filter((c) => c.type === "CANVAS");
  const pages = [];
  for (const canvas of canvases) {
    if (canvas.internalOnly) continue; // component definitions travel in an internal page; instances reference them
    const kids = (children.get(key(canvas.guid)) || []).map((child) =>
      convert(child, IDENTITY, [], [], 1),
    );
    if (kids.length)
      pages.push({
        id: key(canvas.guid),
        type: "CANVAS",
        name: canvas.name || "Page",
        children: kids,
      });
  }
  if (!pages.length) {
    // Loose nodes without a page (rare in clipboard data): put every top-level non-document node on one page.
    const loose = [...byId.values()].filter(
      (n) => !["DOCUMENT", "CANVAS"].includes(n.type) && !byId.has(key(n.parentIndex?.guid)),
    );
    if (loose.length)
      pages.push({
        id: "page",
        type: "CANVAS",
        name: "Page 1",
        children: loose.map((n) => convert(n, IDENTITY, [], [], 1)),
      });
  }
  if (!pages.length) throw new Error("Figma data contains no visible layers");
  const missing = Object.values(imageURLs).filter((v) => v === null).length;
  if (missing)
    warnings.add(
      `${missing} image fill${missing === 1 ? "" : "s"} not included in the Figma data (copy/paste carries image references only)`,
    );
  return {
    document: { type: "DOCUMENT", name: docNode?.name || "Figma import", children: pages },
    images: Object.fromEntries(Object.entries(imageURLs).filter(([, v]) => v)),
    warnings: [...warnings],
  };
}
