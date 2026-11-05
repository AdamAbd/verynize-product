import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search, SearchX, X, Type, Square, Frame, Image, Sparkles } from "lucide-react";
import { activePage, design, type DesignDocument } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { paletteKeyAllowed } from "../CommandPalette";
import { setPanelOpen, usePanelOpen } from "../shortcuts";
import { buildIndex, search, type SearchNode } from "./search";

let lastQuery = "";
const close = () => setPanelOpen("find", false);
function slice(doc: DesignDocument) {
  return {
    page: doc.activePage,
    nodes: (activePage(doc)?.nodes ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: n.parentId,
      hidden: n.hidden,
      locked: n.locked,
      text: typeof n.text === "string" ? n.text : undefined,
      shortId: typeof n.shortId === "string" ? n.shortId : undefined,
    })),
  };
}
// Only read the cloned document at subscription startup, never for a query change.
function useIndex() {
  const keyRef = useRef<string | null>(null);
  const subscribe = useCallback(
    (notify: () => void) =>
      design().subscribe((doc) => {
        const next = JSON.stringify(slice(doc));
        if (next !== keyRef.current) {
          keyRef.current = next;
          notify();
        }
      }),
    [],
  );
  const key = useSyncExternalStore(
    subscribe,
    () => (keyRef.current ??= JSON.stringify(slice(design().getDocument()))),
  );
  return useMemo(() => {
    const value = JSON.parse(key) as { page: string; nodes: SearchNode[] };
    return { page: value.page, entries: buildIndex(value.nodes) };
  }, [key]);
}
export function FindLayersPanel() {
  const open = usePanelOpen("find");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (
        !mod ||
        e.shiftKey ||
        e.altKey ||
        e.isComposing ||
        e.key.toLowerCase() !== "f" ||
        !paletteKeyAllowed(e.target)
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        ) &&
        e.target.id !== "find-layers-input"
      )
        return;
      if (
        [...document.querySelectorAll('dialog[open], [role="dialog"]')].some(
          (el) => el.getClientRects().length,
        )
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanelOpen("find", true);
      document.getElementById("find-layers-input")?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <Finder /> : null;
}
function Finder() {
  const index = useIndex();
  const [query, setQuery] = useState(lastQuery);
  const results = useMemo(() => search(index.entries, query), [index, query]);
  const [position, setPosition] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = results[Math.min(position, results.length - 1)];
  useEffect(() => {
    design().setSelection([]);
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    setPosition(0);
  }, [results]);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        !panel.current?.contains(e.target) &&
        !e.target.closest("#find-layers-button")
      )
        close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, []);
  useEffect(() => {
    if (!current) return;
    const node = document.querySelector(`#canvas [data-id="${CSS.escape(current.id)}"]`);
    node?.scrollIntoView();
    node?.setAttribute("data-find-focus", "");
    document.getElementById(`find-option-${current.id}`)?.scrollIntoView({ block: "nearest" });
    return () => node?.removeAttribute("data-find-focus");
  }, [current]);
  // Window the result set in batches; every result remains reachable with the arrow keys.
  const start = Math.floor(position / 200) * 200;
  return (
    <div
      ref={panel}
      id="find-layers"
      role="search"
      aria-label="Find layers"
      className="absolute top-2 right-2 z-30 w-70 overflow-hidden rounded-xl border border-toolbar-edge bg-background text-xs text-foreground shadow-toolbar"
      onWheel={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "Enter" && current) {
          e.preventDefault();
          design().setSelection([current.id]);
          close();
        }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
          e.preventDefault();
          setPosition(
            (p) => (p + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length,
          );
        }
      }}
    >
      <div className="flex h-11 items-center gap-2 border-b border-edge px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          id="find-layers-input"
          aria-label="Find layers"
          placeholder="Find layers"
          maxLength={1000}
          value={query}
          aria-controls="find-layers-results"
          aria-activedescendant={current ? `find-option-${current.id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            lastQuery = e.target.value;
            setQuery(lastQuery);
            setPosition(0);
          }}
        />
        {current && (
          <span id="find-layers-count" className="shrink-0 text-muted-foreground tabular-nums">
            {position + 1} of {results.length}
          </span>
        )}
        <button
          type="button"
          aria-label="Close"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
          onClick={close}
        >
          <X className="size-4" />
        </button>
      </div>
      {!query.trim() ? (
        <p className="px-3 py-6 text-center text-muted-foreground">
          Search by layer name, text, or ID
        </p>
      ) : !results.length ? (
        <div className="flex flex-col items-center gap-3 px-3 py-6 text-muted-foreground">
          <SearchX className="size-4" />
          <p className="max-w-full truncate">No layers found for “{query.trim()}”</p>
        </div>
      ) : (
        <div
          id="find-layers-results"
          role="listbox"
          aria-label="Matching layers"
          className="max-h-83 overflow-y-auto overscroll-contain p-1.5"
        >
          {results.slice(start, start + 200).map((result, offset) => {
            const Icon =
              result.type === "text"
                ? Type
                : result.type === "frame"
                  ? Frame
                  : result.type === "image"
                    ? Image
                    : result.type === "shader"
                      ? Sparkles
                      : Square;
            return (
              <button
                type="button"
                tabIndex={-1}
                role="option"
                id={`find-option-${result.id}`}
                key={result.id}
                data-find-result={result.id}
                aria-selected={current?.id === result.id}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left",
                  current?.id === result.id
                    ? "bg-find-active text-primary-foreground"
                    : "hover:bg-muted",
                  (result.hidden || result.locked) && "opacity-60",
                )}
                onClick={() => {
                  setPosition(start + offset);
                  input.current?.focus();
                }}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {result.snippet.before}
                  <u>{result.snippet.hit}</u>
                  {result.snippet.after}
                </span>
                {result.idText && (
                  <span className="max-w-24 truncate text-right underline">{result.idText}</span>
                )}
              </button>
            );
          })}
          {results.length > 200 && (
            <p className="p-2 text-muted-foreground">
              Use arrow keys to browse all {results.length} matches
            </p>
          )}
        </div>
      )}
    </div>
  );
}
