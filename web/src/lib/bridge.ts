// Bridge between React islands and the legacy vanilla renderer (web/*.js).
// Legacy modules expose their APIs on `window`; their DOM controls keep the original handlers.
import { useEffect, useState, useSyncExternalStore } from "react";

/* ---------- Legacy window APIs (subset used by islands) ---------- */
export type LayerNode = {
  id: string;
  type: "rectangle" | "text" | "frame" | "image" | "shader" | string;
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  locked?: boolean;
  [key: string]: unknown;
};
export type DesignPage = { id: string; name: string; nodes: LayerNode[] };
export type DesignDocument = {
  version: number;
  name: string;
  activePage: string;
  pages: DesignPage[];
  tokens: Record<string, string>;
  [key: string]: unknown;
};
export type DesignApi = {
  getDocument(): DesignDocument;
  setDocument(doc: DesignDocument): void;
  subscribe(fn: (doc: DesignDocument) => void): () => void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
  updateNodes(ids: string[], patch: Partial<LayerNode> | ((node: LayerNode) => Partial<LayerNode>)): boolean;
  setActivePage(id: string): void;
  canUndo(): boolean;
  canRedo(): boolean;
  getCamera(): { x: number; y: number; zoom: number };
  setCamera(x: number, y: number, zoom: number): void;
  zoomToFit(): void;
  setTool(tool: string): void;
  getTool(): string;
  commands(): { id: string; label?: string }[];
  runCommand(id: string): void;
  [key: string]: unknown;
};

declare global {
  interface Window {
    design: DesignApi;
    verynize: DesignApi;
    agentWorkspace?: Record<string, (...args: never[]) => unknown>;
    fileLibrary?: Record<string, unknown> & { list(): unknown[]; currentId: string | null };
    appSettings?: { open(section?: string): void; close?(): void };
    appPreferences?: { get(): Record<string, unknown> };
    askText?: (title: string, value?: string) => Promise<string | null>;
  }
}

export const design = (): DesignApi => window.design;

/* ---------- Design store hooks ---------- */
let snapshot: DesignDocument | null = null;
let selectionSnapshot: string[] = [];
const listeners = new Set<() => void>();
let attached = false;
function attach() {
  if (attached || !window.design) return;
  attached = true;
  snapshot = window.design.getDocument();
  selectionSnapshot = window.design.getSelection();
  window.design.subscribe((doc) => {
    snapshot = doc;
    const next = window.design.getSelection();
    if (next.join() !== selectionSnapshot.join()) selectionSnapshot = next;
    listeners.forEach((fn) => fn());
  });
}
function subscribe(fn: () => void) {
  attach();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current document; re-renders after every legacy render(). */
export function useDesign(): DesignDocument {
  return useSyncExternalStore(subscribe, () => {
    attach();
    return snapshot as DesignDocument;
  });
}

/** Selected layer ids. */
export function useSelection(): string[] {
  return useSyncExternalStore(subscribe, () => {
    attach();
    return selectionSnapshot;
  });
}

export function activePage(doc: DesignDocument): DesignPage {
  return doc.pages.find((p) => p.id === doc.activePage) ?? doc.pages[0];
}

/** Re-render when a body class changes (layout state such as `left-collapsed`, `agent-chat-open`, `files-view`). */
export function useBodyClass(name: string): boolean {
  const [on, setOn] = useState(() => document.body.classList.contains(name));
  useEffect(() => {
    const observer = new MutationObserver(() => setOn(document.body.classList.contains(name)));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [name]);
  return on;
}

/** Subscribe to a window event (e.g. "app-preferences-changed"). */
export function useWindowEvent(name: string, fn: (event: Event) => void) {
  useEffect(() => {
    window.addEventListener(name, fn);
    return () => window.removeEventListener(name, fn);
  }, [name, fn]);
}

/* ---------- Legacy controls ---------- */
// Legacy scripts bind handlers to elements by id when they load. An island "takes over" an id:
// the legacy element is renamed to `legacy-<id>` and parked in a hidden dock, and the island renders
// its own visible element with the original id that forwards to the legacy element.
const taken = new Map<string, HTMLElement>();
function dock() {
  let d = document.getElementById("bd-legacy-dock");
  if (!d) {
    d = document.createElement("div");
    d.id = "bd-legacy-dock";
    d.hidden = true;
    d.setAttribute("aria-hidden", "true");
    document.body.append(d);
  }
  return d;
}

// The legacy element keeps its id until the island has rendered its own element with that id, so legacy code
// such as render() (`$("#document-name").value = …`) never dereferences null in between.
const pending = new Map<string, HTMLElement>();
let pendingObserver: MutationObserver | null = null;
function claimPending() {
  for (const [id, el] of pending) {
    const owners = document.querySelectorAll(`[id="${CSS.escape(id)}"]`);
    if ([...owners].some((node) => node !== el)) {
      el.id = `legacy-${id}`;
      pending.delete(id);
    }
  }
  if (!pending.size) {
    pendingObserver?.disconnect();
    pendingObserver = null;
  }
}

/** Park a legacy element and hand its id to the island once the island renders it. Returns the legacy element. */
export function takeOver(id: string, options: { park?: boolean } = {}): HTMLElement | null {
  const existing = taken.get(id);
  if (existing) return existing;
  const el = document.getElementById(id);
  if (!el) return null;
  if (options.park !== false) dock().append(el);
  taken.set(id, el);
  pending.set(id, el);
  if (!pendingObserver) {
    pendingObserver = new MutationObserver(claimPending);
    pendingObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["id"] });
  }
  claimPending();
  return el;
}

/** The legacy element for an id, whether or not it has been taken over. */
export function legacy<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return (taken.get(id) ?? document.getElementById(`legacy-${id}`) ?? document.getElementById(id)) as T | null;
}

/** Click a legacy control (runs its original handler). */
export function legacyClick(id: string) {
  legacy(id)?.click();
}

/** Set a legacy form control value and fire `change` (and `input`) like a user edit. */
export function legacySet(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: string | boolean) {
  if (!el) return;
  if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Hide legacy DOM that an island replaces visually without removing it (keeps references valid). */
export function hideLegacy(...elements: (Element | null | undefined)[]) {
  for (const el of elements) if (el instanceof HTMLElement) el.dataset.bdHidden = "true";
}

/* ---------- Portals ---------- */
/** Container for Radix portals so menus/popovers/dialogs get the island reset and tokens. */
export function portalContainer(): HTMLElement {
  let el = document.getElementById("bd-portal");
  if (!el) {
    el = document.createElement("div");
    el.id = "bd-portal";
    el.setAttribute("data-bd", "");
    document.body.append(el);
  }
  return el;
}
