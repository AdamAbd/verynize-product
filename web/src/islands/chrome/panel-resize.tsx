// Drag-to-resize panel edges (Wonder sidebar-resize recording): the inner edge of the layers panel, the inner (left)
// edge of the properties panel and the right edge of the chat dock. No visible handle: a col-resize cursor on a 7px
// strip centred on the 1px edge, which turns accent-coloured while dragging. Double-click resets to the default
// width; widths persist in localStorage. Widths live in CSS variables on <html> (`--panel-left-width`, …, defaults in
// globals.css `<panel-resize-tokens>`) that chrome.css and the title bar read, so React never re-renders while dragging.
// Visibility of each strip follows the layout body classes in panel-resize.css. While a width changes,
// `html[data-panel-reflow]` tells the canvas (web/canvas-interactions.js) to pan with the viewport's left edge so the
// artwork stays put on screen, as in Wonder.
import type { KeyboardEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import "./panel-resize.css";

export type PanelSide = "left" | "right" | "chat";

type PanelSpec = {
  cssVar: string;
  /** Default track width (content + 1px edge), measured from design/wonder. */
  defaultWidth: number;
  min: number;
  max: number;
  /** +1 when dragging right widens the panel (its edge is on its right), -1 otherwise. */
  direction: 1 | -1;
  label: string;
};

// Wonder: both side panels open at 280 + 1px edge and never get narrower than that (the recording drags the layers
// panel back down to exactly its default); the chat dock opens at 499px and can be narrowed to ~350px.
export const PANELS: Record<PanelSide, PanelSpec> = {
  left: {
    cssVar: "--panel-left-width",
    defaultWidth: 281,
    min: 281,
    max: 561,
    direction: 1,
    label: "Resize layers panel",
  },
  right: {
    cssVar: "--panel-right-width",
    defaultWidth: 281,
    min: 281,
    max: 561,
    direction: -1,
    label: "Resize properties panel",
  },
  chat: {
    cssVar: "--chat-dock-width",
    defaultWidth: 499,
    min: 360,
    max: 800,
    direction: 1,
    label: "Resize chat panel",
  },
};

const STORAGE_KEY = "verynize.panelWidths";
/** The canvas keeps at least this much width while a panel grows. */
const MIN_CANVAS = 320;
const KEY_STEP = 8;

const SIDES = Object.keys(PANELS) as PanelSide[];
const widths: Record<PanelSide, number> = {
  left: PANELS.left.defaultWidth,
  right: PANELS.right.defaultWidth,
  chat: PANELS.chat.defaultWidth,
};

const clamp = (side: PanelSide, value: number) =>
  Math.round(Math.min(PANELS[side].max, Math.max(PANELS[side].min, value)));

function readSaved(): Partial<Record<PanelSide, number>> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function save() {
  try {
    const changed = Object.fromEntries(
      SIDES.filter((side) => widths[side] !== PANELS[side].defaultWidth).map((side) => [
        side,
        widths[side],
      ]),
    );
    if (Object.keys(changed).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable: the width still applies for this session.
  }
}

function writeVar(side: PanelSide) {
  const root = document.documentElement.style;
  if (widths[side] === PANELS[side].defaultWidth) root.removeProperty(PANELS[side].cssVar);
  else root.setProperty(PANELS[side].cssVar, `${widths[side]}px`);
}

/** Apply the saved widths. Called once when the chrome island mounts, before the first layout of the grid. */
export function initPanelWidths() {
  const saved = readSaved();
  for (const side of SIDES) {
    const value = Number(saved[side]);
    widths[side] = Number.isFinite(value) ? clamp(side, value) : PANELS[side].defaultWidth;
    writeVar(side);
  }
}

let reflowTimer = 0;
/** Mark the next layouts as panel reflows (see the file comment). Held while dragging; a one-off change (double-click,
 * keyboard) holds it for two frames, until the canvas' ResizeObserver has seen the new layout. */
function beginReflow() {
  cancelAnimationFrame(reflowTimer);
  document.documentElement.dataset.panelReflow = "";
  // Stop the canvas from re-fitting on every resize step (a fresh document auto-fits until the camera moves).
  const camera = window.design?.getCamera?.();
  if (camera) window.design.setCamera(camera.x, camera.y, camera.zoom);
}
function endReflow() {
  cancelAnimationFrame(reflowTimer);
  reflowTimer = requestAnimationFrame(() => {
    reflowTimer = requestAnimationFrame(() => delete document.documentElement.dataset.panelReflow);
  });
}

/** Resize a panel; returns the applied (clamped) width. */
export function setPanelWidth(side: PanelSide, value: number, limit = PANELS[side].max) {
  const next = Math.min(clamp(side, value), Math.max(PANELS[side].min, Math.round(limit)));
  if (next === widths[side]) return next;
  widths[side] = next;
  writeVar(side);
  return next;
}

/** How wide `side` may grow right now without squeezing the canvas below MIN_CANVAS. */
function growLimit(side: PanelSide) {
  const canvas = document.getElementById("workspace")?.getBoundingClientRect().width ?? 0;
  return widths[side] + Math.max(0, canvas - MIN_CANVAS);
}

let endActiveDrag: (() => void) | null = null;

/** Follow one drag of `side`'s edge. Listens on the window (capture phase) for the whole gesture instead of relying on
 * pointer capture alone: Chromium can drop the capture right after granting it (e.g. on the click that activates the
 * window), and the drag must still end on pointerup. A drag whose pointerup never arrived ends at the next press. */
function startDrag(side: PanelSide, handle: HTMLElement, down: PointerEvent<HTMLElement>) {
  endActiveDrag?.();
  const spec = PANELS[side];
  const pointer = down.pointerId;
  const startX = down.clientX;
  const startWidth = widths[side];
  const limit = growLimit(side);
  try {
    handle.setPointerCapture(pointer);
  } catch {
    // The window listeners below still follow the pointer.
  }
  beginReflow();
  document.documentElement.dataset.panelResizing = side;

  const move = (event: globalThis.PointerEvent) => {
    if (event.pointerId !== pointer) return;
    event.stopPropagation(); // no canvas hover or tool feedback under the dragged edge
    setPanelWidth(side, startWidth + (event.clientX - startX) * spec.direction, limit);
    handle.setAttribute("aria-valuenow", String(widths[side]));
  };
  const end = (event?: globalThis.PointerEvent) => {
    if (event && event.pointerId !== pointer) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    window.removeEventListener("blur", cancel);
    endActiveDrag = null;
    delete document.documentElement.dataset.panelResizing;
    endReflow();
    save();
  };
  const cancel = () => end();
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  window.addEventListener("blur", cancel);
  endActiveDrag = cancel;
}

function Handle({ side }: { side: PanelSide }) {
  const spec = PANELS[side];
  const sync = (el: HTMLElement) => el.setAttribute("aria-valuenow", String(widths[side]));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={spec.label}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={widths[side]}
      tabIndex={0}
      data-panel-resize={side}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        startDrag(side, event.currentTarget, event);
      }}
      onDoubleClick={(event) => {
        beginReflow();
        setPanelWidth(side, spec.defaultWidth);
        endReflow();
        sync(event.currentTarget);
        save();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
        const sign = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (!sign) return;
        event.preventDefault();
        beginReflow();
        setPanelWidth(side, widths[side] + sign * step * spec.direction, growLimit(side));
        endReflow();
        sync(event.currentTarget);
        save();
      }}
    >
      <span aria-hidden="true" data-panel-resize-line="" />
    </div>
  );
}

/** The three edge strips: the side panels' strips sit in the main grid (so they follow its columns and collapse with
 * them), the chat dock's strip is fixed beside the dock. */
export function PanelResizeHandles() {
  const main = document.querySelector("body > main");
  return (
    <>
      {main ? createPortal(<Handle side="left" />, main) : null}
      {main ? createPortal(<Handle side="right" />, main) : null}
      {createPortal(<Handle side="chat" />, document.body)}
    </>
  );
}
