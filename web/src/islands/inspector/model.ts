// Node helpers and validated edits (mirrors the clamping in app.js `form.onchange`).
import { activePage, type DesignDocument, type LayerNode } from "@/lib/bridge";
import { notify } from "./legacy";

export type Node = LayerNode & {
  color: string;
  token: string;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: string;
  lineHeight: number;
  letterSpacing: number;
  radius: number;
  zIndex: number;
  rotation: number;
  opacity: number;
  layout: "free" | "flex" | "grid" | "block" | "inline";
  direction: string;
  gap: number;
  padding: number;
  columns: number;
  alignItems: string;
  justifyContent: string;
  gradient: string;
  mask: string;
  animated: string;
  shadow: string;
  strokeWidth: number;
  strokeColor: string;
  clipContent: boolean;
  shaderPreset: string;
  shaderSpeed: number;
  shaderIntensity: number;
  textRuns: { start: number; end: number; bold: boolean; italic: boolean; color?: string; fontSize?: number }[];
  wMode?: SizingMode;
  hMode?: SizingMode;
};
export type SizingMode = "fixed" | "hug" | "fill";

export const pageNodes = (doc: DesignDocument) => activePage(doc).nodes as Node[];

/** The primary selected layer (same rule as app.js `chosen()`: first in page order). */
export function primaryNode(doc: DesignDocument, selection: string[]): Node | undefined {
  if (!selection.length) return undefined;
  const wanted = new Set(selection);
  return pageNodes(doc).find((n) => wanted.has(n.id));
}

export function parentOf(doc: DesignDocument, node: Node): Node | undefined {
  return node.parentId ? pageNodes(doc).find((n) => n.id === node.parentId) : undefined;
}

export function descendants(doc: DesignDocument, id: string): Set<string> {
  const found = new Set([id]);
  const nodes = pageNodes(doc);
  let size: number;
  do {
    size = found.size;
    for (const n of nodes) if (n.parentId && found.has(n.parentId)) found.add(n.id);
  } while (size !== found.size);
  return found;
}

export function sizingAllowed(node: Node, parent: Node | undefined, mode: SizingMode): boolean {
  if (mode === "fixed") return true;
  if (mode === "hug") return node.type === "text" || (node.type === "frame" && node.layout !== "free");
  return !!parent && parent.type === "frame" && parent.layout !== "free";
}

export function sizingMode(node: Node, axis: "w" | "h", parent: Node | undefined): SizingMode {
  const mode = (axis === "w" ? node.wMode : node.hMode) || "fixed";
  return sizingAllowed(node, parent, mode) ? mode : "fixed";
}

const NUMERIC = new Set([
  "x", "y", "w", "h", "fontSize", "radius", "zIndex", "gap", "padding", "columns", "shaderSpeed",
  "shaderIntensity", "rotation", "opacity", "strokeWidth", "lineHeight", "letterSpacing",
]);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Validate a field value the way app.js does. Returns the value to store, or an error message. */
export function normalize(key: string, raw: string | boolean): { value: unknown } | { error: string } {
  if (typeof raw === "boolean") return { value: raw };
  if (NUMERIC.has(key)) {
    let v = Number(raw.trim());
    if (raw.trim() === "" || !Number.isFinite(v)) return { error: "Enter a number." };
    if (key === "w" || key === "h") v = Math.max(10, v);
    if (key === "radius" || key === "gap" || key === "padding" || key === "strokeWidth") v = Math.max(0, v);
    if (key === "opacity") v = clamp(v, 0, 100);
    if (key === "lineHeight") v = Math.max(0.1, v);
    if (key === "fontSize") v = clamp(v, 8, 200);
    if (key === "shaderSpeed") v = clamp(v, 0, 5);
    if (key === "shaderIntensity") v = clamp(v, 0, 2);
    if (key === "columns") v = clamp(Math.round(v), 1, 12);
    return { value: v };
  }
  if ((key === "gradient" || key === "mask") && raw && (/url\s*\(/i.test(raw) || !CSS.supports("background-image", raw)))
    return { error: "Enter a CSS gradient without external URLs." };
  if (key === "shadow" && raw && (/url\s*\(/i.test(raw) || !CSS.supports("box-shadow", raw)))
    return { error: "Enter a CSS box shadow." };
  return { value: raw };
}

/** Keys that only make sense on one layer at a time. */
const SINGLE = new Set(["name", "text", "parentId"]);

/**
 * Write one field to the selection through `window.design.updateNodes` (validated, one undo step).
 * Returns an error message when the value is rejected.
 */
export function setField(selection: string[], primary: Node, key: string, raw: string | boolean): string | null {
  const result = normalize(key, raw);
  if ("error" in result) {
    notify(result.error);
    return result.error;
  }
  const value = result.value;
  const ids = SINGLE.has(key) ? [primary.id] : selection;
  try {
    window.design.updateNodes(ids, (n) => {
      const node = n as Node;
      const patch: Record<string, unknown> = {};
      if (key === "text") patch.textRuns = [];
      if (key === "w" && node.wMode && node.wMode !== "fixed") patch.wMode = "fixed";
      if (key === "h" && node.hMode && node.hMode !== "fixed") patch.hMode = "fixed";
      patch[key] =
        key === "parentId" ? value || null : key === "name" ? String(value).trim() || node.type : value;
      return patch as Partial<LayerNode>;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(message);
    return message;
  }
  return null;
}

/** Apply a computed patch to the selection (validated, one undo step). */
export function patchNodes(ids: string[], patch: (node: Node) => Record<string, unknown>) {
  try {
    window.design.updateNodes(ids, (n) => patch(n as Node) as Partial<LayerNode>);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

export const HEX = /^#[0-9a-f]{6}$/i;

/** "#a58bdd" → "A58BDD"; non-hex values (e.g. "transparent") → "". */
export const hexLabel = (color: string) => (HEX.test(color) ? color.slice(1).toUpperCase() : "");

/** Parse a user-typed hex ("fff", "#A58BDD", "a58bdd") into "#rrggbb". */
export function parseHex(raw: string): string | null {
  let v = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toLowerCase() : null;
}

/** Number shown in a field: at most two decimals, no trailing zeros. */
export const fmt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "");

export const WEIGHTS: [string, string][] = [
  ["100", "Thin"],
  ["200", "Extra Light"],
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semi Bold"],
  ["700", "Bold"],
  ["800", "Extra Bold"],
  ["900", "Black"],
];
export const weightName = (w: string) => WEIGHTS.find(([v]) => v === String(w))?.[1] ?? String(w);

export const FONTS = [
  "Inter",
  "system-ui",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
  "monospace",
  "serif",
  "sans-serif",
];

export const SHADER_PRESETS: [string, string][] = [
  ["aurora", "Aurora"],
  ["ribbon", "Glass ribbon"],
  ["mesh", "Mesh flow"],
  ["waves", "Waves"],
  ["noise", "Soft noise"],
  ["swirl", "Swirl"],
];
