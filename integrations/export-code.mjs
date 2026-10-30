// "Code" export of the inspector Export section: Tailwind (JSX through the codec) or plain CSS (the
// artwork HTML with its inline declarations moved into class rules). Used by desktop/render.cjs.
import { validateDocument } from "./design-store.mjs";
import { ensureShortIds, elementCode, getPage } from "./design-edit.mjs";
import { cssVarForToken } from "./jsx-codec.mjs";

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

/** `:root` custom properties for the document's colour variables. */
function rootVariables(tokens = {}) {
  const lines = Object.entries(tokens).map(
    ([name, value]) => `  ${cssVarForToken(name)}: ${value};`,
  );
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : "";
}

/** A React component (Tailwind classes) for the given nodes, in the order given. */
export function tailwindCode(document, pageId, nodeIds, name = "Export") {
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
  const code = nodes
    .filter((n) => !covered(n))
    .map((n) => elementCode(d, page, n))
    // Editor bookkeeping (short ids, canvas position) is meaningless outside the editor.
    .map((c) =>
      c.replace(/ data-node-id="[^"]*"/g, "").replace(/ data-component-[xy]="[^"]*"/g, ""),
    )
    .join("\n");
  const body = code
    .split("\n")
    .map((line) => "      " + line)
    .join("\n");
  const vars = rootVariables(d.tokens);
  return `${vars ? `/* Colour variables used by the classes below:\n${vars}*/\n` : ""}export default function ${component(name)}() {\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`;
}

/** Plain HTML + CSS: every inline style of the artwork HTML becomes a class rule. */
export function cssCode(html, tokens = {}) {
  if (typeof html !== "string" || !html.includes("<body")) throw new Error("Expected artwork HTML");
  const rules = [],
    used = new Map();
  const out = html.replace(
    /<([a-zA-Z][\w-]*)([^<>]*?)\sstyle="([^"]*)"([^<>]*)>/g,
    (all, tag, before, style, after) => {
      const attrs = before + after;
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
  const sheet = `<style>\n${rootVariables(tokens)}${rules.join("\n")}\n</style>`;
  return out.includes("</head>") ? out.replace("</head>", `${sheet}</head>`) : sheet + out;
}
