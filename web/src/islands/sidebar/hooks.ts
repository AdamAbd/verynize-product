// Narrow subscriptions to the legacy design store. The store notifies after *every* legacy render
// (including each pointer move while dragging on the canvas); the sidebar only re-renders when the
// slice it shows actually changes.
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { activePage, design, type DesignDocument, type LayerNode } from "@/lib/bridge";

/** Subscribe to a JSON-serialisable slice of the document; re-renders only when the slice changes. */
export function useDesignSlice<T>(select: (doc: DesignDocument) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const keyRef = useRef<string | null>(null);
  const subscribe = useCallback((notify: () => void) => {
    const api = design();
    if (!api) return () => {};
    return api.subscribe((doc) => {
      const next = JSON.stringify(selectRef.current(doc));
      if (next !== keyRef.current) {
        keyRef.current = next;
        notify();
      }
    });
  }, []);
  const key = useSyncExternalStore(subscribe, () => {
    if (keyRef.current === null) keyRef.current = JSON.stringify(selectRef.current(design().getDocument()));
    return keyRef.current;
  });
  return useMemo(() => JSON.parse(key) as T, [key]);
}

export type PageInfo = { id: string; name: string };
export type DocSummary = { name: string; activePage: string; pages: PageInfo[] };

export function useDocSummary(): DocSummary {
  return useDesignSlice((doc) => ({
    name: doc.name,
    activePage: activePage(doc)?.id ?? doc.activePage,
    pages: doc.pages.map((p) => ({ id: p.id, name: p.name })),
  }));
}

/** Only the fields the layer tree renders. */
export type TreeNode = Pick<LayerNode, "id" | "name" | "type" | "parentId" | "hidden" | "locked"> & {
  layout?: string;
  direction?: string;
  ellipse?: boolean;
  /** A live preview frame (preview audit PF7): drawn with a browser-window icon. */
  preview?: true;
};

export function useTreeNodes(): TreeNode[] {
  return useDesignSlice((doc) =>
    (activePage(doc)?.nodes ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: n.parentId ?? null,
      hidden: n.hidden || undefined,
      locked: n.locked || undefined,
      layout: typeof n.layout === "string" ? n.layout : undefined,
      direction: typeof n.direction === "string" ? n.direction : undefined,
      ellipse: n.ellipse === true || undefined,
      preview: n.preview ? (true as const) : undefined,
    })),
  );
}
