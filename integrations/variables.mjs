// Variable library rules shared by the headless engine: aliases (a variable that references another
// variable of the same type), slash-named folders, and how a bound variable value is written into a
// layer. Colour variables live in `document.tokens` ({name: '#hex'}), typed ones in `document.variables`
// ({name: {type, value}}). Aliases live in `document.aliases` ({name: targetName}); the aliased entry
// always stores the resolved literal value too, so every reader that ignores aliases (canvas, codecs,
// HTML/CSS export) keeps rendering the right value. Alias validation and resolution on load live in
// web/document-core.js (shared with the canvas); web/src/islands/inspector/vars.ts mirrors the editing rules.
import { validateAliases, variableKind } from "./document-core.mjs";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
const RESERVED = ["__proto__", "prototype", "constructor"];
const validName = (name) => typeof name === "string" && NAME.test(name) && !RESERVED.includes(name);
const own = (object, key) => !!object && Object.hasOwn(object, key);

/** 'color' for a colour variable, the variable type for a typed one, null when the name is unknown. */
export { variableKind };

/**
 * The variable whose literal value `name` shows: follows the alias chain while each target exists and
 * has the same type. Dangling aliases (deleted target) stop the chain at the last existing variable.
 */
export function aliasRoot(document, name) {
  const aliases = document.aliases || {};
  const kind = variableKind(document, name);
  const seen = new Set([name]);
  let current = name;
  while (own(aliases, current)) {
    const next = aliases[current];
    if (seen.has(next) || variableKind(document, next) !== kind) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** True when pointing `name` at `target` would make the chain loop back to `name`. */
export function aliasCycle(document, name, target) {
  const aliases = document.aliases || {};
  const seen = new Set();
  for (
    let current = target;
    current !== undefined;
    current = own(aliases, current) ? aliases[current] : undefined
  ) {
    if (current === name) return true;
    if (seen.has(current)) return true;
    seen.add(current);
  }
  return false;
}

/** Throws on malformed aliases, type mismatches and cycles. Aliases to deleted variables are tolerated. */
export { validateAliases };

/** Copy each alias' resolved value into the aliased variable (in place). */
export function syncAliases(document) {
  for (const name of Object.keys(document.aliases || {})) {
    const kind = variableKind(document, name);
    if (!kind) continue;
    const root = aliasRoot(document, name);
    if (root === name) continue;
    if (kind === "color") document.tokens[name] = document.tokens[root];
    else document.variables[name].value = document.variables[root].value;
  }
  return document;
}

/** Point `name` at `target` (same type, no cycles) and resolve its value. */
export function setAlias(document, name, target) {
  const kind = variableKind(document, name);
  if (!kind) throw new Error(`Variable ${name} does not exist`);
  if (variableKind(document, target) !== kind)
    throw new Error(`Variable ${name} can only reference a variable of the same type`);
  if (name === target || aliasCycle(document, name, target))
    throw new Error(`Referencing ${target} from ${name} would create a cycle`);
  document.aliases = { ...document.aliases, [name]: target };
  return syncAliases(document);
}

/** Remove the reference of `name`; it keeps its current resolved value as a literal. */
export function detachAlias(document, name) {
  if (!own(document.aliases, name)) return document;
  syncAliases(document);
  delete document.aliases[name];
  if (!Object.keys(document.aliases).length) delete document.aliases;
  return document;
}

/** Rename references to `from` (alias names and targets). */
export function renameAliasRefs(document, from, to) {
  if (!document.aliases) return document;
  document.aliases = Object.fromEntries(
    Object.entries(document.aliases).map(([name, target]) => [
      name === from ? to : name,
      target === from ? to : target,
    ]),
  );
  return document;
}

/** Before deleting `name`: drop its alias and detach every alias that points at it (values stay literal). */
export function dropAliases(document, name) {
  if (!document.aliases) return document;
  syncAliases(document);
  for (const [key, target] of Object.entries(document.aliases))
    if (key === name || target === name) delete document.aliases[key];
  if (!Object.keys(document.aliases).length) delete document.aliases;
  return document;
}

// ---------------------------------------------------------------------------------------------
// Folders: a slash-separated name `surface/base` lives in folder `surface`, nested folders allowed.

/** Folder path of a variable name ('' at the root). */
export const folderOf = (name) => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");
/** Every colour and typed variable inside `folder` (including nested folders). */
export function folderMembers(document, folder) {
  const prefix = folder + "/";
  return [...Object.keys(document.tokens || {}), ...Object.keys(document.variables || {})].filter(
    (name) => name.startsWith(prefix),
  );
}
/** Old → new names when folder `from` is renamed to `to`; throws on invalid or colliding names. */
export function folderRenames(document, from, to) {
  const target = String(to)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!target || !validName(target)) throw new Error(`Invalid folder name ${JSON.stringify(to)}`);
  const members = folderMembers(document, from);
  const moved = new Set(members);
  const renames = members.map((name) => [name, target + name.slice(from.length)]);
  for (const [, next] of renames) {
    if (!validName(next)) throw new Error(`Invalid variable name ${JSON.stringify(next)}`);
    if ((own(document.tokens, next) || own(document.variables, next)) && !moved.has(next))
      throw new Error(`A variable named “${next}” already exists.`);
  }
  return renames;
}

// ---------------------------------------------------------------------------------------------
// Bound layer properties. Most bindings write the property of the same name; a few write derived
// fields: per-corner radius into `cornerRadii`, axis padding into the side overrides, and a Dimension
// bound to line height (pixels) becomes the unitless multiplier the renderer uses.

export const CORNER_KEYS = [
  "radiusTopLeft",
  "radiusTopRight",
  "radiusBottomRight",
  "radiusBottomLeft",
];
export const PADDING_AXES = {
  paddingX: ["paddingLeft", "paddingRight"],
  paddingY: ["paddingTop", "paddingBottom"],
};
export const FIELD_LIMITS = {
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
  ...Object.fromEntries(CORNER_KEYS.map((key) => [key, [0, 1e6]])),
};
const round = (value) => Math.round(value * 1e4) / 1e4;

/** Value a (compatible, valid) variable gives to `key` on `node`. */
export function boundValue(variable, key, node) {
  if (variable.type === "fontWeight") return String(variable.value);
  if (variable.type === "fontFamily") return String(variable.value).trim();
  let value = Number(variable.value);
  if (key === "lineHeight" && variable.type === "dimension") {
    const size = Number.isFinite(node?.fontSize) && node.fontSize > 0 ? node.fontSize : 16;
    value = round(value / size);
  }
  const [min, max] = FIELD_LIMITS[key] || [-1e6, 1e6];
  return Math.min(max, Math.max(min, value));
}

/** Write a bound value into the node (in place). */
export function writeBoundValue(node, key, value) {
  const corner = CORNER_KEYS.indexOf(key);
  if (corner >= 0) {
    const fallback = Number.isFinite(node.radius) ? Math.max(0, node.radius) : 0;
    const radii =
      Array.isArray(node.cornerRadii) && node.cornerRadii.length === 4
        ? [...node.cornerRadii]
        : [fallback, fallback, fallback, fallback];
    radii[corner] = value;
    node.cornerRadii = radii;
  } else if (PADDING_AXES[key]) {
    for (const side of PADDING_AXES[key]) node[side] = value;
  } else node[key] = value;
  return node;
}

/** Binding keys in the order they must be applied (font size before a line height derived from it). */
export const bindingOrder = (bindings) =>
  Object.keys(bindings || {}).sort((a, b) => (a === "lineHeight") - (b === "lineHeight"));
