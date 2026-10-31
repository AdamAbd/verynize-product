import { useEffect, useState, useSyncExternalStore } from "react";
import { relayout } from "./legacy";

/** Observe a DOM node's attributes and derive a value; setState bails out when the value is unchanged. */
function useObserved<T>(selector: () => Element | null, attributes: string[], read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const target = selector();
    if (!target) return;
    const update = () => setValue(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true, attributeFilter: attributes });
    return () => observer.disconnect();
    // selector/read are module-level helpers passed inline; observing once is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

const readZoom = () => {
  const zoom = window.design?.getCamera?.().zoom ?? 1;
  return Math.round(zoom * 100);
};

/** Current zoom in percent. The camera writes `#canvas` style on change; only the rounded value re-renders. */
export function useZoom(): number {
  return useObserved(() => document.getElementById("canvas"), ["style"], readZoom);
}

/** Active canvas tool (`move`, `scale`, `hand`, `frame`, `text`, `shader`, …) from `#workspace[data-tool]`. */
export function useTool(): string {
  return useObserved(
    () => document.getElementById("workspace"),
    ["data-tool"],
    () => document.getElementById("workspace")?.dataset.tool || "move",
  );
}

/** Whether a legacy <dialog> is open. */
export function useDialogOpen(id: string): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timer = 0;
    const attach = () => {
      const dialog = document.getElementById(id);
      if (!dialog) {
        timer = window.setTimeout(attach, 500);
        return;
      }
      const update = () => setOpen(dialog.hasAttribute("open"));
      update();
      observer = new MutationObserver(update);
      observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [id]);
  return open;
}

/* ---------- Panel layouts (Details ⌥1 · Design ⌥2 · Canvas ⌥0) ---------- */
export type LayoutName = "details" | "design" | "canvas";
export const LAYOUTS: { name: LayoutName; label: string; key: string }[] = [
  { name: "details", label: "Details", key: "1" },
  { name: "design", label: "Design", key: "2" },
  { name: "canvas", label: "Canvas", key: "0" },
];

export function currentLayout(): LayoutName {
  const body = document.body.classList;
  if (!body.contains("left-collapsed")) return "design";
  return body.contains("right-collapsed") ? "canvas" : "details";
}

/** Whether the panels match a preset exactly. Sidebar shown + properties hidden (header toggle) is no preset, so
 * nothing is highlighted and the views menu reads "Design · edited". */
export function isExactLayout(): boolean {
  const body = document.body.classList;
  return body.contains("left-collapsed") || !body.contains("right-collapsed");
}

// The preset last chosen explicitly (toolbar, views menu, ⌥ shortcut). Until it is chosen, or once the panels leave
// it, the views menu reads "<Layout> · edited" (19, canvas audit T2-plus). The toolbar still highlights the toggle of
// the layout on screen while the menu is closed (canvas audit T1-*-verified, T3, T4, V3).
let applied: LayoutName | null = null;
const appliedListeners = new Set<() => void>();
export function useAppliedLayout(): LayoutName | null {
  return useSyncExternalStore(
    (fn) => {
      appliedListeners.add(fn);
      return () => appliedListeners.delete(fn);
    },
    () => applied,
  );
}

export function applyLayout(name: LayoutName) {
  applied = name;
  appliedListeners.forEach((fn) => fn());
  const body = document.body.classList;
  body.toggle("left-collapsed", name !== "design");
  body.toggle("right-collapsed", name === "canvas");
  relayout();
}

export function toggleBodyClass(name: "left-collapsed" | "right-collapsed", force?: boolean) {
  document.body.classList.toggle(name, force);
  relayout();
}
