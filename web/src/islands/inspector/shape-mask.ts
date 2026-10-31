// "Use as mask" (Wonder canvas audit P5, design/wonder/canvas-audit/wonder/P5-*.png):
// - Two or more sibling layers selected → the bottom one is consumed: its rectangle becomes a shape mask on the top one,
//   stored as `inset(T% R% B% L%)` of the top layer's box (P5-mask-inspector shows `inset(-50% -50% -50% -5…` for a
//   200×200 source under a centred 100×100 target). No wrapper or group is created; the source layer is removed.
// - CM5-multi-verified shows the item for four selected top-level siblings, but Wonder's result for more than two was
//   not captured. Assumption: the bottom-most selected sibling's shape becomes the mask of every other selected
//   sibling (each gets its own inset() relative to its own box), and the bottom-most layer is consumed.
// - "Detach mask as shape" recreates the geometry as a plain white Frame right below the layer (P5-detach-mask:
//   the source's fill is not restored) and drops the mask. "Remove mask" only clears it (P5-remove-result).
// Every operation is one undo step. Rendering and validation live in web/node-style.js (mask type `shape`).
import { activePage, design, type LayerNode } from "@/lib/bridge";
import type { Mask } from "./effects";

type Box = { x: number; y: number; w: number; h: number };
type MaskedNode = LayerNode & { masks?: Mask[]; layout?: string; position?: string };

const SHAPE = /^inset\(-?\d{1,5}(\.\d{1,3})?%( -?\d{1,5}(\.\d{1,3})?%){0,3}\)$/;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** inset() percentages as [top, right, bottom, left], or null when the string is not a shape mask. */
export function parseInset(shape: string | undefined): [number, number, number, number] | null {
  if (typeof shape !== "string" || !SHAPE.test(shape)) return null;
  const v = shape.slice(6, -1).split(" ").map(parseFloat);
  return [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
}

export const isShapeInset = (shape: string) => parseInset(shape) !== null;

/**
 * The layer's box in its parent's coordinates. The size is the rendered one (Hug / Fill layers); the position is
 * the stored x/y for freely placed layers and the rendered offset inside an auto layout.
 */
function boxOf(node: LayerNode, nodes: LayerNode[]): Box {
  const el = document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(node.id)}"]`);
  const parent = nodes.find((n) => n.id === node.parentId) as MaskedNode | undefined;
  const placed =
    (!parent?.layout || parent.layout === "free" || node.position === "absolute") &&
    Number.isFinite(node.x) &&
    Number.isFinite(node.y);
  const rendered = !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
  return {
    x: placed || !rendered ? Number(node.x) || 0 : el.offsetLeft,
    y: placed || !rendered ? Number(node.y) || 0 : el.offsetTop,
    w: rendered ? el.offsetWidth : Number(node.w) || 0,
    h: rendered ? el.offsetHeight : Number(node.h) || 0,
  };
}

/**
 * The selection as { targets, source } when it is two or more siblings: `source` is the bottom-most selected layer,
 * `targets` the others (Wonder offers Use as mask for any multi-selection of siblings, CM5-multi-verified / P5).
 */
export function maskGroup(): { targets: MaskedNode[]; source: MaskedNode } | null {
  const ids = design().getSelection();
  if (ids.length < 2) return null;
  const nodes = activePage(design().getDocument())?.nodes ?? [];
  const index = ids.map((id) => nodes.findIndex((n) => n.id === id));
  if (index.some((i) => i < 0)) return null;
  const parent = nodes[index[0]].parentId ?? null;
  if (index.some((i) => (nodes[i].parentId ?? null) !== parent)) return null;
  // Later layers paint above earlier siblings, so the lowest index is the bottom-most.
  const sorted = [...index].sort((a, b) => a - b).map((i) => nodes[i] as MaskedNode);
  return { source: sorted[0], targets: sorted.slice(1) };
}

/** Index of the layer's first shape mask, or -1. */
export function shapeMaskIndex(node: LayerNode | undefined): number {
  const masks = (node as MaskedNode | undefined)?.masks;
  return Array.isArray(masks) ? masks.findIndex((m) => m?.type === "shape") : -1;
}

function commit(doc: ReturnType<ReturnType<typeof design>["getDocument"]>, selection: string[]) {
  design().setDocument(doc);
  design().setSelection(selection);
}

/**
 * Turn the bottom-most selected sibling into a shape mask on every other selected sibling and remove it (one undo
 * step). The remaining siblings stay selected.
 */
export function useAsMask(): boolean {
  const group = maskGroup();
  if (!group) return false;
  const { source, targets } = group;
  const doc = design().getDocument();
  const page = activePage(doc);
  const b = boxOf(source, page.nodes);
  const boxes = targets.map((top) => boxOf(top, page.nodes));
  if (!boxes.every((t) => t.w > 0 && t.h > 0)) return false;
  targets.forEach((top, i) => {
    const t = boxes[i];
    const inset = [
      ((b.y - t.y) / t.h) * 100,
      ((t.x + t.w - (b.x + b.w)) / t.w) * 100,
      ((t.y + t.h - (b.y + b.h)) / t.h) * 100,
      ((b.x - t.x) / t.w) * 100,
    ].map((v) => Math.min(99999, Math.max(-99999, round(v))));
    const shape = `inset(${inset.map((v) => `${v}%`).join(" ")})`;
    const target = page.nodes.find((n) => n.id === top.id) as MaskedNode;
    target.masks = [...(target.masks ?? []), { type: "shape", shape }];
  });
  // The consumed layer goes, with anything inside it.
  const gone = new Set([source.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of page.nodes)
      if (n.parentId && gone.has(n.parentId) && !gone.has(n.id)) {
        gone.add(n.id);
        grew = true;
      }
  }
  page.nodes = page.nodes.filter((n) => !gone.has(n.id));
  commit(
    doc,
    targets.map((n) => n.id),
  );
  return true;
}

/** Clear one mask from the layer (one undo step); the consumed source is not restored. */
export function removeMask(nodeId: string, index: number): boolean {
  const doc = design().getDocument();
  const node = activePage(doc).nodes.find((n) => n.id === nodeId) as MaskedNode | undefined;
  if (!node?.masks?.[index]) return false;
  const masks = node.masks.filter((_, i) => i !== index);
  if (masks.length) node.masks = masks;
  else delete node.masks;
  commit(doc, design().getSelection());
  return true;
}

/**
 * Detach a shape mask: a white Frame with the mask's geometry is inserted right below the layer and selected, and
 * the mask is dropped (one undo step).
 */
export function detachShapeMask(nodeId: string, index: number): boolean {
  const doc = design().getDocument();
  const page = activePage(doc);
  const nodes = page.nodes as MaskedNode[];
  const at = nodes.findIndex((n) => n.id === nodeId);
  const node = nodes[at];
  const inset = parseInset(node?.masks?.[index]?.shape);
  if (!node || !inset) return false;
  const [t, r, b, l] = inset;
  const box = boxOf(node, nodes);
  const frame: MaskedNode = {
    id: crypto.randomUUID(),
    type: "frame",
    name: "Frame",
    parentId: node.parentId ?? null,
    x: round(box.x + (l / 100) * box.w),
    y: round(box.y + (t / 100) * box.h),
    w: Math.max(1, round(box.w * (1 - (l + r) / 100))),
    h: Math.max(1, round(box.h * (1 - (t + b) / 100))),
    color: "#ffffff",
    radius: 0,
  };
  if (!frame.parentId) delete (frame as Partial<MaskedNode>).parentId;
  // Inside an auto layout the shape keeps its place without pushing the siblings.
  const parent = nodes.find((n) => n.id === node.parentId);
  if (parent?.layout && parent.layout !== "free") frame.position = "absolute";
  const masks = node.masks!.filter((_, i) => i !== index);
  if (masks.length) node.masks = masks;
  else delete node.masks;
  nodes.splice(at, 0, frame);
  commit(doc, [frame.id]);
  return true;
}
