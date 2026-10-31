// The canvas context menu. web/canvas-interactions.js keeps the hit testing: on right-click it retargets the selection
// (clickTarget, frame labels, locked layers) and dispatches `bd:canvas-menu` with the pointer, the document point and
// the layers under the pointer. This opens a Radix context menu at that point, portalled into `portalContainer()` so
// it paints above the canvas overlays (selection badge, frame labels).
import { useCallback, useEffect, useRef, useState } from "react";
import { design, useDesign, useSelection, useWindowEvent } from "@/lib/bridge";
import { MenuEntries } from "./entries";
import { addContext, emptyCanvasMenu, layerMenu, type Point } from "./model";
import { Menu, MenuContent } from "./parts";
import { previewMenu, selectedPreview } from "./preview-menu";
import "./context-menu.css";

type Detail = {
  x: number;
  y: number;
  point: Point | null;
  target: string | null;
  under: string[];
  /** Opened on an artboard label (Wonder CM9-label: no Select layer). */
  label?: boolean;
};

/** Re-renders with the document and selection, so labels such as Show / Unlock stay current. */
function LayerEntries({ under, label }: { under: string[]; label: boolean }) {
  useDesign();
  useSelection();
  const preview = selectedPreview();
  return (
    <MenuEntries
      entries={preview ? previewMenu(preview, under) : layerMenu(label ? "label" : "canvas", under)}
    />
  );
}

export function CanvasContextMenu() {
  const trigger = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<(Detail & { serial: number; preview: boolean }) | null>(null);

  const onMenu = useCallback((event: Event) => {
    const detail = (event as CustomEvent<Detail>).detail;
    if (!detail) return;
    setState((prev) => ({
      ...detail,
      under: detail.under ?? [],
      preview: !!detail.target && !!selectedPreview(),
      serial: (prev?.serial ?? 0) + 1,
    }));
    // Radix opens a context menu at the pointer of the `contextmenu` event its trigger receives.
    trigger.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: detail.x,
        clientY: detail.y,
      }),
    );
  }, []);
  useWindowEvent("bd:canvas-menu", onMenu);
  useAddContextShortcut();

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <span ref={trigger} hidden aria-hidden="true" />
      </Menu.Trigger>
      {state ? (
        <MenuContent
          key={state.serial}
          id="canvas-menu"
          data-target={state.target ? (state.preview ? "preview" : "layer") : "canvas"}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {state.target ? (
            <LayerEntries under={state.under} label={!!state.label} />
          ) : (
            <MenuEntries entries={emptyCanvasMenu(state.point)} />
          )}
        </MenuContent>
      ) : null}
    </Menu.Root>
  );
}

/** ⌘L (Ctrl+L elsewhere) adds the selection to the chat, as the menu's "Add context ⌘L" says. Code mode keeps its
 * own ⌘L (focus the composer). */
function useAddContextShortcut() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mac = /Mac/.test(navigator.platform);
      if (event.defaultPrevented || event.code !== "KeyL" || event.altKey || event.shiftKey) return;
      if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const body = document.body.classList;
      if (["code-mode", "files-view", "settings-open"].some((name) => body.contains(name))) return;
      if (document.querySelector("dialog[open]")) return;
      const ids = design().getSelection();
      if (!ids.length) return;
      if (addContext(ids)) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
