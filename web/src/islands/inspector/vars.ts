// Typed variables (design/wonder 41–42): Dimensions, Numbers, Font family, Font weight, stored next to the
// colour `tokens` as `document.variables = {name: {type, value}}`. Layers bind a property with
// `node.bindings = {property: name}` and keep the resolved value in the property itself, so the canvas, export,
// codecs and MCP keep working unchanged. Mirrors integrations/design-store.mjs + design-edit.mjs (syncVariables).
import type { DesignDocument } from "@/lib/bridge";
import { notify } from "./legacy";
import { patchNodes, type Node } from "./model";

export type VariableType = "dimension" | "number" | "fontFamily" | "fontWeight";
export type Variable = { type: VariableType; value: number | string };
export type Variables = Record<string, Variable>;

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

/** Layer property → variable types that may drive it (same table as BINDABLE in design-store.mjs). */
export const BINDABLE: Record<string, VariableType[]> = {
  radius: ["dimension", "number"],
  gap: ["dimension", "number"],
  padding: ["dimension", "number"],
  strokeWidth: ["dimension", "number"],
  fontSize: ["dimension", "number"],
  letterSpacing: ["dimension", "number"],
  lineHeight: ["number"],
  opacity: ["number"],
  fontFamily: ["fontFamily"],
  fontWeight: ["fontWeight"],
};
const LIMITS: Record<string, [number, number]> = {
  opacity: [0, 100],
  fontSize: [1, 1000],
  lineHeight: [0.1, 100],
  radius: [0, 1e6],
  gap: [0, 1e6],
  padding: [0, 1e6],
  strokeWidth: [0, 1e6],
};

export const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
const RESERVED = ["__proto__", "prototype", "constructor"];

export const variablesOf = (doc: DesignDocument) => (doc.variables ?? {}) as Variables;
export const bindingsOf = (node: Node) => (node.bindings ?? {}) as Record<string, string>;

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

/** Resolved value a variable gives to a layer property (clamped like the headless engine). */
export function resolve(vars: Variables, key: string, name: string): number | string | undefined {
  const v = vars[name];
  if (!v || !BINDABLE[key]?.includes(v.type) || !validValue(v.type, v.value)) return undefined;
  if (v.type === "fontWeight") return String(v.value);
  if (v.type === "fontFamily") return String(v.value).trim();
  const [min, max] = LIMITS[key] ?? [-1e6, 1e6];
  return Math.min(max, Math.max(min, Number(v.value)));
}

/** Apply every binding of every page to its resolved value (in place). */
export function syncBindings(doc: DesignDocument) {
  const vars = variablesOf(doc);
  for (const page of doc.pages)
    for (const n of page.nodes as Node[])
      for (const [key, name] of Object.entries(bindingsOf(n))) {
        const value = resolve(vars, key, name);
        if (value !== undefined) (n as Record<string, unknown>)[key] = value;
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

export function nameError(doc: DesignDocument, name: string, except?: string): string | null {
  if (!NAME.test(name) || RESERVED.includes(name))
    return "Use letters, digits, “-”, “_”, “.”, “/” or spaces.";
  if (
    name !== except &&
    (Object.hasOwn(doc.tokens ?? {}, name) || Object.hasOwn(variablesOf(doc), name))
  )
    return `A variable named “${name}” already exists.`;
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
  for (
    let i = 2;
    Object.hasOwn(variablesOf(doc), suggestion) || Object.hasOwn(doc.tokens ?? {}, suggestion);
    i++
  )
    suggestion = base + "-" + i;
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

/** Change a colour variable (keeps alpha as #rrggbbaa); layers bound through `token` follow on render. */
export function setTokenColor(name: string, color: string) {
  return editDocument((d) => {
    if (!Object.hasOwn(d.tokens ?? {}, name)) throw Error(`Variable ${name} no longer exists`);
    d.tokens = { ...d.tokens, [name]: color };
  });
}

export function setVariableValue(name: string, value: number | string) {
  return editDocument((d) => {
    const vars = variablesOf(d);
    if (!vars[name]) throw Error(`Variable ${name} no longer exists`);
    d.variables = { ...vars, [name]: { ...vars[name], value } };
  });
}

export function renameVariable(from: string, to: string) {
  const doc = window.design.getDocument();
  const error = nameError(doc, to, from);
  if (error) {
    notify(error);
    return false;
  }
  return editDocument((d) => {
    const vars = variablesOf(d);
    d.variables = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k === from ? to : k, v]),
    );
    for (const page of d.pages)
      for (const n of page.nodes as Node[]) {
        const b = bindingsOf(n);
        for (const key of Object.keys(b)) if (b[key] === from) b[key] = to;
      }
  });
}

/** Delete a variable; bound layers keep their current value. */
export function deleteVariable(name: string) {
  return editDocument((d) => {
    const vars = { ...variablesOf(d) };
    delete vars[name];
    d.variables = vars;
    for (const page of d.pages)
      for (const n of page.nodes as Node[]) {
        if (!n.bindings) continue;
        const b = { ...bindingsOf(n) };
        for (const key of Object.keys(b)) if (b[key] === name) delete b[key];
        if (Object.keys(b).length) n.bindings = b;
        else delete n.bindings;
      }
  });
}

/** Bind (or with `name` null, detach) a property of the selection to a variable. */
export function bindVariable(
  doc: DesignDocument,
  selection: string[],
  key: string,
  name: string | null,
) {
  const vars = variablesOf(doc);
  const value = name ? resolve(vars, key, name) : undefined;
  if (name && value === undefined) {
    notify(`Variable ${name} cannot drive ${key}.`);
    return;
  }
  patchNodes(selection, (n) => {
    const b = { ...bindingsOf(n) };
    if (name) b[key] = name;
    else delete b[key];
    return { bindings: Object.keys(b).length ? b : undefined, ...(name ? { [key]: value } : {}) };
  });
}

/** Text for a variable value in lists. */
export const valueLabel = (v: Variable) =>
  v.type === "dimension" ? `${v.value}px` : String(v.value);

/** `:root { --name: value; }` for colour tokens and typed variables (mirrors design-edit.mjs variablesCss). */
export function variablesCss(doc: DesignDocument): string {
  const cssVar = (name: string) =>
    "--" +
    name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const lines: string[] = [];
  for (const [name, value] of Object.entries(doc.tokens ?? {}))
    lines.push(`  ${cssVar(name)}: ${value};`);
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
    lines.push(`  ${cssVar(name)}: ${value};`);
  }
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : "";
}
