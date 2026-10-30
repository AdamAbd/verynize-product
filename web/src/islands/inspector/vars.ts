// Variables (design/wonder 41–42). Colour variables are `document.tokens = {name: "#hex"}` (layers use
// `node.token` / `node.svgColorToken`); typed ones (Dimensions, Numbers, Font family, Font weight) are
// `document.variables = {name: {type, value}}` and layers bind a property with `node.bindings = {property: name}`.
// Bound properties keep the resolved value, so the canvas, export, codecs and MCP keep working unchanged.
// A variable may reference another of the same type: `document.aliases = {name: target}`; the aliased entry
// still stores the resolved value. Slash names (`surface/base`) group into folders.
// Mirrors integrations/variables.mjs, design-store.mjs and design-edit.mjs (syncVariables).
import type { DesignDocument } from "@/lib/bridge";
import { notify } from "./legacy";
import { patchNodes, scalarOverrides, type Node } from "./model";

export type VariableType = "dimension" | "number" | "fontFamily" | "fontWeight";
export type VariableKind = VariableType | "color";
export type Variable = { type: VariableType; value: number | string };
export type Variables = Record<string, Variable>;
export type Aliases = Record<string, string>;

export const VARIABLE_TYPES: {
  type: VariableType;
  label: string;
  group: string;
  fallback: number | string;
}[] = [
  { type: "dimension", label: "Dimensions", group: "Dimensions", fallback: 16 },
  { type: "number", label: "Numbers", group: "Numbers", fallback: 1 },
  { type: "fontFamily", label: "Font family", group: "Font families", fallback: "Inter" },
  { type: "fontWeight", label: "Font weight", group: "Font weights", fallback: "400" },
];

export const CORNER_KEYS = [
  "radiusTopLeft",
  "radiusTopRight",
  "radiusBottomRight",
  "radiusBottomLeft",
] as const;
const PADDING_AXES: Record<string, string[]> = {
  paddingX: ["paddingLeft", "paddingRight"],
  paddingY: ["paddingTop", "paddingBottom"],
};

/** Layer property → variable types that may drive it (same table as BINDABLE in design-store.mjs). */
export const BINDABLE: Record<string, VariableType[]> = {
  radius: ["dimension", "number"],
  gap: ["dimension", "number"],
  padding: ["dimension", "number"],
  strokeWidth: ["dimension", "number"],
  fontSize: ["dimension", "number"],
  letterSpacing: ["dimension", "number"],
  lineHeight: ["number", "dimension"],
  opacity: ["number"],
  fontFamily: ["fontFamily"],
  fontWeight: ["fontWeight"],
  w: ["dimension"],
  h: ["dimension"],
  minW: ["dimension"],
  maxW: ["dimension"],
  minH: ["dimension"],
  maxH: ["dimension"],
  paddingX: ["dimension"],
  paddingY: ["dimension"],
  ...Object.fromEntries(CORNER_KEYS.map((key) => [key, ["dimension"] as VariableType[]])),
};
const LIMITS: Record<string, [number, number]> = {
  opacity: [0, 100],
  fontSize: [1, 1000],
  lineHeight: [0.1, 100],
  radius: [0, 1e6],
  gap: [0, 1e6],
  padding: [0, 1e6],
  strokeWidth: [0, 1e6],
  w: [1, 1e6],
  h: [1, 1e6],
  minW: [0, 1e6],
  maxW: [0, 1e6],
  minH: [0, 1e6],
  maxH: [0, 1e6],
  paddingX: [0, 1e6],
  paddingY: [0, 1e6],
  ...Object.fromEntries(CORNER_KEYS.map((key) => [key, [0, 1e6] as [number, number]])),
};

export const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
const RESERVED = ["__proto__", "prototype", "constructor"];

export const variablesOf = (doc: DesignDocument) => (doc.variables ?? {}) as Variables;
export const aliasesOf = (doc: DesignDocument) => (doc.aliases ?? {}) as Aliases;
export const bindingsOf = (node: Node) => (node.bindings ?? {}) as Record<string, string>;

/** "color" for a colour variable, its type for a typed one, null when the name is unknown. */
export function kindOf(doc: DesignDocument, name: string): VariableKind | null {
  if (Object.hasOwn(doc.tokens ?? {}, name)) return "color";
  return Object.hasOwn(variablesOf(doc), name) ? variablesOf(doc)[name].type : null;
}

export function validValue(type: VariableType, value: unknown): boolean {
  if (type === "dimension" || type === "number")
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e6;
  if (type === "fontFamily")
    return (
      typeof value === "string" &&
      !!value.trim() &&
      value.length <= 200 &&
      !/[;{}<>\\]/.test(value) &&
      !/url\s*\(/i.test(value)
    );
  return /^(normal|bold|[1-9][0-9]{0,2}|1000)$/.test(String(value));
}

/** Parse a typed-in value for a variable type; null when invalid. */
export function parseValue(type: VariableType, raw: string): number | string | null {
  const text = raw.trim().replace(/px$/i, "");
  const value =
    type === "dimension" || type === "number"
      ? Number(text)
      : type === "fontWeight"
        ? text
        : raw.trim();
  if (type !== "fontFamily" && text === "") return null;
  return validValue(type, value) ? value : null;
}

/* ---------- Aliases ---------- */

/** The variable whose literal value `name` shows (follows references while the target exists). */
export function aliasRoot(doc: DesignDocument, name: string): string {
  const aliases = aliasesOf(doc);
  const kind = kindOf(doc, name);
  const seen = new Set([name]);
  let current = name;
  while (Object.hasOwn(aliases, current)) {
    const next = aliases[current];
    if (seen.has(next) || kindOf(doc, next) !== kind) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** True when `name → target` would loop back to `name`. */
export function aliasCycle(doc: DesignDocument, name: string, target: string): boolean {
  const aliases = aliasesOf(doc);
  const seen = new Set<string>();
  for (let current: string | undefined = target; current !== undefined;) {
    if (current === name || seen.has(current)) return true;
    seen.add(current);
    current = Object.hasOwn(aliases, current) ? aliases[current] : undefined;
  }
  return false;
}

/** Variables `name` may reference: same type, not itself, no cycles. */
export function referenceCandidates(doc: DesignDocument, name: string): string[] {
  const kind = kindOf(doc, name);
  const names = kind === "color" ? Object.keys(doc.tokens ?? {}) : Object.keys(variablesOf(doc));
  return names.filter((n) => n !== name && kindOf(doc, n) === kind && !aliasCycle(doc, name, n));
}

/** Copy each alias' resolved value into the aliased variable (in place). */
export function syncAliases(doc: DesignDocument) {
  const vars = variablesOf(doc);
  for (const name of Object.keys(aliasesOf(doc))) {
    const kind = kindOf(doc, name);
    const root = aliasRoot(doc, name);
    if (!kind || root === name) continue;
    if (kind === "color") doc.tokens[name] = doc.tokens[root];
    else vars[name] = { ...vars[name], value: vars[root].value };
  }
  return doc;
}

function withoutAliases(doc: DesignDocument, drop: (name: string, target: string) => boolean) {
  const aliases = Object.fromEntries(
    Object.entries(aliasesOf(doc)).filter(([name, target]) => !drop(name, target)),
  );
  if (Object.keys(aliases).length) doc.aliases = aliases;
  else delete doc.aliases;
}

/* ---------- Binding resolution ---------- */

/** Resolved value a variable gives to a layer property (clamped like the headless engine). */
export function resolve(
  vars: Variables,
  key: string,
  name: string,
  node?: Partial<Node>,
): number | string | undefined {
  const v = vars[name];
  if (!v || !BINDABLE[key]?.includes(v.type) || !validValue(v.type, v.value)) return undefined;
  if (v.type === "fontWeight") return String(v.value);
  if (v.type === "fontFamily") return String(v.value).trim();
  let value = Number(v.value);
  if (key === "lineHeight" && v.type === "dimension") {
    // A pixel line height becomes the unitless multiplier the renderer uses.
    const size =
      Number.isFinite(node?.fontSize) && Number(node?.fontSize) > 0 ? node!.fontSize! : 16;
    value = Math.round((value / size) * 1e4) / 1e4;
  }
  const [min, max] = LIMITS[key] ?? [-1e6, 1e6];
  return Math.min(max, Math.max(min, value));
}

/** Fields a bound value writes (per-corner radius and axis padding write derived properties). */
export function boundPatch(
  node: Node,
  key: string,
  value: number | string,
): Record<string, unknown> {
  const corner = (CORNER_KEYS as readonly string[]).indexOf(key);
  if (corner >= 0) {
    const fallback = Number.isFinite(node.radius) ? Math.max(0, node.radius) : 0;
    const current = node.cornerRadii;
    const radii =
      Array.isArray(current) && current.length === 4
        ? [...(current as number[])]
        : [fallback, fallback, fallback, fallback];
    radii[corner] = Number(value);
    return { cornerRadii: radii };
  }
  if (PADDING_AXES[key]) return Object.fromEntries(PADDING_AXES[key].map((side) => [side, value]));
  return { [key]: value };
}

const ordered = (bindings: Record<string, string>) =>
  Object.keys(bindings).sort((a, b) => Number(a === "lineHeight") - Number(b === "lineHeight"));

/** Resolve aliases, then apply every binding of every page to its resolved value (in place). */
export function syncBindings(doc: DesignDocument) {
  syncAliases(doc);
  const vars = variablesOf(doc);
  for (const page of doc.pages)
    for (const n of page.nodes as Node[]) {
      const bindings = bindingsOf(n);
      for (const key of ordered(bindings)) {
        const value = resolve(vars, key, bindings[key], n);
        if (value !== undefined) Object.assign(n, boundPatch(n, key, value));
      }
    }
  return doc;
}

/** Whole-document edit (one undo step via setDocument); keeps the selection. */
function editDocument(edit: (doc: DesignDocument) => void): boolean {
  const selection = window.design.getSelection();
  const doc = window.design.getDocument();
  try {
    edit(doc);
    syncBindings(doc);
    window.design.setDocument(doc);
    if (selection.length) window.design.setSelection(selection);
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    return false;
  }
}

const exists = (doc: DesignDocument, name: string) =>
  Object.hasOwn(doc.tokens ?? {}, name) || Object.hasOwn(variablesOf(doc), name);

export function nameError(doc: DesignDocument, name: string, except?: string): string | null {
  if (!NAME.test(name) || RESERVED.includes(name))
    return "Use letters, digits, “-”, “_”, “.”, “/” or spaces.";
  if (name !== except && exists(doc, name)) return `A variable named “${name}” already exists.`;
  return null;
}

/** Ask for a name and create a variable with the type's default value. */
export async function createVariable(type: VariableType): Promise<string | null> {
  const meta = VARIABLE_TYPES.find((t) => t.type === type)!;
  const doc = window.design.getDocument();
  const base = { dimension: "space", number: "number", fontFamily: "font", fontWeight: "weight" }[
    type
  ];
  let suggestion = base;
  for (let i = 2; exists(doc, suggestion); i++) suggestion = base + "-" + i;
  const name = (await window.askText?.(`${meta.label} variable name`, suggestion))?.trim();
  if (!name) return null;
  const error = nameError(doc, name);
  if (error) {
    notify(error);
    return null;
  }
  return editDocument((d) => {
    d.variables = { ...variablesOf(d), [name]: { type, value: meta.fallback } };
  })
    ? name
    : null;
}

/** Change a colour variable (keeps alpha as #rrggbbaa); a literal value detaches its reference. */
export function setTokenColor(name: string, color: string) {
  return editDocument((d) => {
    if (!Object.hasOwn(d.tokens ?? {}, name)) throw Error(`Variable ${name} no longer exists`);
    withoutAliases(d, (key) => key === name);
    d.tokens = { ...d.tokens, [name]: color };
  });
}

export function setVariableValue(name: string, value: number | string) {
  return editDocument((d) => {
    const vars = variablesOf(d);
    if (!vars[name]) throw Error(`Variable ${name} no longer exists`);
    withoutAliases(d, (key) => key === name);
    d.variables = { ...vars, [name]: { ...vars[name], value } };
  });
}

/** Colour holders of a layer's paint stack (solid paints and gradient stops); see web/node-style.js. */
const eachPaintColor = (n: Node, fn: (c: { color?: string; token?: string }) => void) =>
  (
    window as unknown as {
      BetterNodeStyle?: {
        eachPaintColor(n: Node, fn: (c: { color?: string; token?: string }) => void): void;
      };
    }
  ).BetterNodeStyle?.eachPaintColor(n, fn);

/** Rename variables in place (colour or typed); every layer reference and alias follows. */
function applyRenames(d: DesignDocument, renames: [string, string][]) {
  const map = new Map(renames);
  const to = (name: string) => map.get(name) ?? name;
  const rekey = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [to(k), v]));
  d.tokens = rekey(d.tokens ?? {});
  if (d.variables) d.variables = rekey(variablesOf(d));
  if (d.aliases)
    d.aliases = Object.fromEntries(
      Object.entries(aliasesOf(d)).map(([name, target]) => [to(name), to(target)]),
    );
  for (const page of d.pages)
    for (const n of page.nodes as Node[]) {
      if (n.token && map.has(n.token)) n.token = to(n.token);
      if (typeof n.svgColorToken === "string" && map.has(n.svgColorToken))
        n.svgColorToken = to(n.svgColorToken);
      eachPaintColor(n, (c) => {
        if (c.token && map.has(c.token)) c.token = to(c.token);
      });
      const b = bindingsOf(n);
      for (const key of Object.keys(b)) b[key] = to(b[key]);
    }
}

/** Delete variables; bound layers keep their resolved value, references to them become literal. */
function applyDeletes(d: DesignDocument, names: string[]) {
  const gone = new Set(names);
  syncAliases(d);
  withoutAliases(d, (name, target) => gone.has(name) || gone.has(target));
  for (const page of d.pages)
    for (const n of page.nodes as Node[]) {
      if (n.token && gone.has(n.token)) {
        n.color = d.tokens[n.token] ?? n.color;
        n.token = "";
      }
      if (typeof n.svgColorToken === "string" && gone.has(n.svgColorToken)) {
        n.svgColor = d.tokens[n.svgColorToken] ?? n.svgColor;
        delete n.svgColorToken;
      }
      eachPaintColor(n, (c) => {
        if (!c.token || !gone.has(c.token)) return;
        c.color = d.tokens[c.token] ?? c.color;
        delete c.token;
      });
      if (!n.bindings) continue;
      const b = Object.fromEntries(Object.entries(bindingsOf(n)).filter(([, v]) => !gone.has(v)));
      if (Object.keys(b).length) n.bindings = b;
      else delete n.bindings;
    }
  d.tokens = Object.fromEntries(Object.entries(d.tokens ?? {}).filter(([k]) => !gone.has(k)));
  const vars = Object.fromEntries(Object.entries(variablesOf(d)).filter(([k]) => !gone.has(k)));
  if (Object.keys(vars).length) d.variables = vars;
  else delete d.variables;
}

export function renameVariable(from: string, to: string) {
  const error = nameError(window.design.getDocument(), to, from);
  if (error) {
    notify(error);
    return false;
  }
  return editDocument((d) => applyRenames(d, [[from, to]]));
}

/** Delete a colour or typed variable; bound layers keep their current value. */
export function deleteVariable(name: string) {
  return editDocument((d) => applyDeletes(d, [name]));
}

/* ---------- Folders (slash-separated names) ---------- */

/** Folder path of a name ('' at the root). */
export const folderOf = (name: string) =>
  name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
export const leafOf = (name: string) => name.slice(name.lastIndexOf("/") + 1);

/**
 * Group named entries by folder for pickers (bind menu, colour picker Variables tab): root entries first,
 * then each folder path in name order. Order inside a group follows the input.
 */
export function groupByFolder<T>(
  entries: [string, T][],
): { folder: string; items: [string, T][] }[] {
  const groups = new Map<string, [string, T][]>();
  for (const entry of entries) {
    const folder = folderOf(entry[0]);
    groups.set(folder, [...(groups.get(folder) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([folder, items]) => ({ folder, items }));
}

/** Variables inside `folder` (nested folders included), optionally only those of one kind. */
export function folderMembers(doc: DesignDocument, folder: string, kind?: VariableKind) {
  const prefix = folder + "/";
  return [...Object.keys(doc.tokens ?? {}), ...Object.keys(variablesOf(doc))].filter(
    (n) => n.startsWith(prefix) && (!kind || kindOf(doc, n) === kind),
  );
}

/** Rename folder `from` → `to` for its members (of `kind` when given); one undo step. */
export function renameFolder(from: string, to: string, kind?: VariableKind) {
  const target = to.trim().replace(/^\/+|\/+$/g, "");
  if (target === from) return true;
  const doc = window.design.getDocument();
  const members = folderMembers(doc, from, kind);
  const moving = new Set(members);
  const renames = members.map((n) => [n, target + n.slice(from.length)] as [string, string]);
  for (const [, next] of renames) {
    const error = !target
      ? "Enter a folder name."
      : nameError(doc, next, moving.has(next) ? next : undefined);
    if (error) {
      notify(error);
      return false;
    }
  }
  return editDocument((d) => applyRenames(d, renames));
}

/** Delete every variable in `folder`; bound layers keep their resolved values. */
export function deleteFolder(folder: string, kind?: VariableKind) {
  return editDocument((d) => applyDeletes(d, folderMembers(d, folder, kind)));
}

/** Point `name` at `target` (same type, no cycles); the value follows the target. */
export function referenceVariable(name: string, target: string) {
  return editDocument((d) => {
    if (!referenceCandidates(d, name).includes(target))
      throw Error(`${name} cannot reference ${target}.`);
    d.aliases = { ...aliasesOf(d), [name]: target };
  });
}

/** Drop the reference; the variable keeps the value it resolved to. */
export function detachReference(name: string) {
  return editDocument((d) => {
    syncAliases(d);
    withoutAliases(d, (key) => key === name);
  });
}

/* ---------- Binding ---------- */

/** Bindings a newly bound key replaces (uniform vs per-corner radius, uniform vs axis padding). */
function conflictingBindings(key: string): string[] {
  if (key === "radius") return [...CORNER_KEYS];
  if ((CORNER_KEYS as readonly string[]).includes(key)) return ["radius"];
  if (key === "padding") return ["paddingX", "paddingY"];
  if (key === "paddingX" || key === "paddingY") return ["padding"];
  return [];
}

/** Values to materialize before a derived binding (corner/axis) takes over from a uniform one. */
function materialize(n: Node, key: string): Record<string, unknown> {
  if ((CORNER_KEYS as readonly string[]).includes(key)) {
    const r = Number.isFinite(n.radius) ? Math.max(0, n.radius) : 0;
    return Array.isArray(n.cornerRadii) && n.cornerRadii.length === 4
      ? {}
      : { cornerRadii: [r, r, r, r] };
  }
  if (PADDING_AXES[key]) {
    const p = Number.isFinite(n.padding) ? Number(n.padding) : 0;
    return Object.fromEntries(
      ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((side) => [
        side,
        Number.isFinite(n[side]) ? n[side] : p,
      ]),
    );
  }
  if (key === "w" && n.wMode && n.wMode !== "fixed") return { wMode: "fixed" };
  if (key === "h" && n.hMode && n.hMode !== "fixed") return { hMode: "fixed" };
  return {};
}

/** Bind (or with `name` null, detach) a property of the selection to a variable. */
export function bindVariable(
  doc: DesignDocument,
  selection: string[],
  key: string,
  name: string | null,
) {
  const vars = variablesOf(doc);
  if (name && resolve(vars, key, name) === undefined) {
    notify(`Variable ${name} cannot drive ${key}.`);
    return;
  }
  patchNodes(selection, (n) => {
    const b = { ...bindingsOf(n) };
    if (name) {
      b[key] = name;
      for (const other of conflictingBindings(key)) delete b[other];
    } else delete b[key];
    if (!name) return { bindings: Object.keys(b).length ? b : undefined };
    // Per-side/axis values take precedence in the renderer. A newly bound scalar must become
    // visible immediately, just as entering a scalar value does. Preserve the independent
    // cross-axis gap; the bindable gap field edits the flex main axis (columns for a grid).
    const base = { ...n, ...materialize(n, key) } as Node;
    const value = resolve(vars, key, name, base)!;
    return {
      bindings: b,
      ...materialize(n, key),
      ...scalarOverrides(n, key),
      ...boundPatch(base, key, value),
    };
  });
}

/** Text for a variable value in lists. */
export const valueLabel = (v: Variable) =>
  v.type === "dimension" ? `${v.value}px` : String(v.value);

/** `:root { --name: value; }` for colour tokens and typed variables (mirrors design-edit.mjs variablesCss).
 * References are exported with their resolved value. */
export function variablesCss(source: DesignDocument): string {
  const doc = syncAliases(structuredClone(source));
  const cssVar = (name: string) =>
    "--" +
    name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const lines: string[] = [];
  const names = new Map<string, string>();
  const add = (name: string, value: string) => {
    const identifier = cssVar(name);
    const previous = names.get(identifier);
    if (previous !== undefined)
      throw new Error(
        `Variables “${previous}” and “${name}” both export as ${identifier}. Rename one before exporting CSS.`,
      );
    names.set(identifier, name);
    lines.push(`  ${identifier}: ${value};`);
  };
  for (const [name, value] of Object.entries(doc.tokens ?? {})) add(name, value);
  for (const [name, v] of Object.entries(variablesOf(doc))) {
    if (!validValue(v.type, v.value)) continue;
    const family = String(v.value).trim();
    const value =
      v.type === "dimension"
        ? `${v.value}px`
        : v.type === "fontFamily"
          ? /^[a-zA-Z-]+$/.test(family)
            ? family
            : `'${family.replace(/['\\]/g, "")}'`
          : String(v.value);
    add(name, value);
  }
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : "";
}
