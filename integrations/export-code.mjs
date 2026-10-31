// "Code" export of the inspector Export section: Tailwind (JSX through the codec) or plain CSS (the
// artwork HTML with its inline declarations moved into class rules). Used by desktop/render.cjs.
import { validateDocument } from "./design-store.mjs";
import { ensureShortIds, elementCode, getPage } from "./design-edit.mjs";
import { cssVarForToken } from "./jsx-codec.mjs";
import { layerRecord } from "./export-html.mjs";
import { styleSignature } from "./codec-html.mjs";
import { sourceMeta } from "./codec-source.mjs";
import { documentFontCss, usedFontFaces } from "./font-faces.mjs";
import { extractFontFamilies, familyKind } from "./fonts.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const component = (name) =>
  (
    String(name || "")
      .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
      .replace(/^[^a-zA-Z]+/, "") || "Export"
  ).replace(/^./, (c) => c.toUpperCase());

/**
 * `:root` custom properties for the document's variables: colours, typed variables (dimensions in px,
 * numbers, font families and weights) and aliases as var() references to their target.
 */
function rootVariables(tokens = {}, variables = {}, aliases = {}) {
  const value = (name) => {
    if (aliases && Object.hasOwn(aliases, name)) return `var(${cssVarForToken(aliases[name])})`;
    if (Object.hasOwn(tokens, name)) return tokens[name];
    const v = variables[name];
    return v.type === "dimension" ? `${v.value}px` : String(v.value);
  };
  const names = [...Object.keys(tokens), ...Object.keys(variables || {})];
  const lines = names.map((name) => `  ${cssVarForToken(name)}: ${value(name)};`);
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : "";
}

/**
 * Google Fonts `<link>` tags for the web fonts that `nodes` use (Inter included). System and generic families
 * and the document's embedded `fontFaces` are left out.
 */
function fontLinks(document, nodes, markup) {
  const embedded = new Set(usedFontFaces(document, markup).map((f) => f.family.toLowerCase()));
  const families = extractFontFamilies({ pages: [{ nodes }] }).filter(
    (f) =>
      ["web", "bundled"].includes(familyKind(f.family)) && !embedded.has(f.family.toLowerCase()),
  );
  if (!families.length) return [];
  const query = families
    .map((f) => {
      const family = encodeURIComponent(f.family).replace(/%20/g, "+");
      if (!f.styles.includes("italic")) return `family=${family}:wght@${f.weights.join(";")}`;
      const axes = f.styles.flatMap((s) => f.weights.map((w) => `${s === "italic" ? 1 : 0},${w}`));
      return `family=${family}:ital,wght@${axes.join(";")}`;
    })
    .join("&");
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com" />',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin />',
    `<link href="https://fonts.googleapis.com/css2?${query}&display=swap" rel="stylesheet" />`,
  ];
}

const commentLine = (text) => ` * ${String(text).replace(/\*\//g, "* /")}\n`;

/**
 * A React component (Tailwind classes) for the given nodes, in the order given.
 * `snippet` ({links, date}) gives the clipboard form used by Copy as code and Copy prompt: a "Made with Verynize"
 * comment with the layer links and the date, then Google Fonts links and a box-sizing reset inside the fragment.
 */
export function tailwindCode(document, pageId, nodeIds, name = "Export", { snippet = null } = {}) {
  const d = clone(validateDocument(clone(document)));
  ensureShortIds(d);
  const page = getPage(d, pageId);
  const ids = new Set(nodeIds);
  const nodes = page.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) throw new Error("Select at least one layer to export.");
  // Drop nodes whose ancestor is also exported (the ancestor already contains them).
  const byId = new Map(page.nodes.map((n) => [n.id, n]));
  const covered = (n) => {
    for (let p = byId.get(n.parentId); p; p = byId.get(p.parentId)) if (ids.has(p.id)) return true;
    return false;
  };
  const roots = nodes.filter((n) => !covered(n));
  const code = roots
    .map((n) => elementCode(d, page, n))
    // Short ids are editor bookkeeping and are dropped. The artboard's canvas position is kept as
    // data-canvas-x/y (inert in React) so import_jsx / jsxToDocument put the artboard back where it was.
    .map((c) =>
      c
        .replace(/ data-node-id="[^"]*"/g, "")
        .replace(/ data-component-([xy])="/g, ' data-canvas-$1="'),
    )
    .join("\n");
  let extras = [];
  let made = "";
  if (snippet) {
    const rootIds = new Set(roots.map((n) => n.id));
    const inRoots = (n) => {
      for (let p = n; p; p = byId.get(p.parentId)) if (rootIds.has(p.id)) return true;
      return false;
    };
    extras = [
      ...fontLinks(d, page.nodes.filter(inRoots), code),
      '<style>{"* { box-sizing: border-box; }"}</style>',
    ];
    const lines = ["Made with Verynize", ...(snippet.links || []), snippet.date].filter(Boolean);
    made = `/**\n${lines.map(commentLine).join("")} */\n`;
  }
  const body = [...extras, ...code.split("\n")].map((line) => "      " + line).join("\n");
  const vars = rootVariables(d.tokens, d.variables, d.aliases);
  // The @verynize header lets the importer (codec-source.mjs jsxToDocument) restore variables and the page.
  const header = `/* @verynize ${JSON.stringify(sourceMeta(d, page)).replace(/\*\//g, "*\\/")} */\n`;
  // Embedded (captured) custom fonts used by the classes: the same @font-face rules as the HTML export.
  const fonts = documentFontCss(d, code);
  return `${made}${vars ? `/* Colour variables${d.variables && Object.keys(d.variables).length ? " and typed variables" : ""} used by the classes below:\n${vars}*/\n` : ""}${fonts ? `/* Embedded fonts used by the classes below (add to your global CSS):\n${fonts}\n*/\n` : ""}${header}export default function ${component(name)}() {\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`;
}

/**
 * Plain HTML + CSS: every inline style of the artwork HTML becomes a class rule. With `document`, each
 * layer (matched by data-id) also carries data-vn-node/data-vn-sig and the page carries a verynize-meta
 * block, so codec-html.mjs reads the export back losslessly (layers whose CSS was edited are rebuilt
 * from their declarations).
 */
export function cssCode(html, tokens = {}, { document = null, pageId } = {}) {
  if (typeof html !== "string" || !html.includes("<body")) throw new Error("Expected artwork HTML");
  const rules = [],
    used = new Map();
  const page = document ? getPage(document, pageId) : null;
  const layers = new Map((page?.nodes || []).map((n) => [n.id, n]));
  const escapeAttr = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const out = html.replace(
    /<([a-zA-Z][\w-]*)([^<>]*?)\sstyle="([^"]*)"([^<>]*)>/g,
    (all, tag, before, style, after) => {
      let attrs = before + after;
      const id = /\sdata-id="([^"]*)"/.exec(attrs)?.[1];
      const layer = id !== undefined ? layers.get(decode(id)) : null;
      if (layer && !/\sdata-vn-node=/.test(attrs))
        attrs += ` data-vn-node="${escapeAttr(layerRecord(layer))}" data-vn-sig="${styleSignature(decode(style))}"`;
      const name = /data-name="([^"]*)"/.exec(attrs)?.[1];
      const base = slug(decode(name || "")) || (tag === "span" ? "text" : tag);
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      const cls = n === 1 ? base : `${base}-${n}`;
      const decls = decode(style)
        .split(/;(?![^(]*\))/)
        .map((s) => s.trim())
        .filter(Boolean);
      // One declaration per line as "property: value" (inline styles may omit the space).
      const lines = decls.map((d) => {
        const i = d.indexOf(":");
        return i < 0 ? `  ${d};` : `  ${d.slice(0, i).trim()}: ${d.slice(i + 1).trim()};`;
      });
      rules.push(`.${cls} {\n${lines.join("\n")}\n}`);
      const existing = /\sclass="([^"]*)"/.exec(attrs);
      const rest = existing
        ? attrs.replace(existing[0], ` class="${`${existing[1]} ${cls}`.trim()}"`)
        : `${attrs} class="${cls}"`;
      return `<${tag}${rest}>`;
    },
  );
  const meta = document
    ? `<script type="application/json" id="verynize-meta">${JSON.stringify(sourceMeta(document, page)).replace(/</g, "\\u003c")}</script>`
    : "";
  // Embedded custom fonts: kept when the artwork HTML already carries them, otherwise from `document`.
  const fonts = document && !/@font-face/.test(html) ? documentFontCss(document, html) : "";
  const sheet = `${meta}<style>\n${fonts ? fonts + "\n" : ""}${rootVariables(tokens, document?.variables, document?.aliases)}${rules.join("\n")}\n</style>`;
  return out.includes("</head>") ? out.replace("</head>", `${sheet}</head>`) : sheet + out;
}
