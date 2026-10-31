// Keyboard shortcuts drawer (Wonder K1-open-verified): a 320px panel on the right under the title bar with
// "Search shortcuts…", a pinned "Command palette ⌘K" row and uppercase sections. Opened from the `?` help menu
// and from the command palette. Rows are a reference only; nothing runs from the listing (as in Wonder).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import {
  filterSections,
  registryCommands,
  setPanelOpen,
  shortcutSections,
  usePanelOpen,
  type ShortcutRow,
} from "./shortcuts";

const PINNED: ShortcutRow = {
  id: "app.palette.pinned",
  label: "Command palette",
  keys: ["⌘", "K"],
};

function Chips({ keys }: { keys: string[] }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {keys.map((key, i) => (
        <kbd
          key={`${key}-${i}`}
          className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-menu-edge px-1 font-sans text-2xs text-foreground-3"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsDrawer() {
  const open = usePanelOpen("shortcuts");
  if (!open) return null;
  return createPortal(<Drawer />, portalContainer());
}

function Drawer() {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const sections = useMemo(() => shortcutSections(registryCommands()), []);
  const visible = filterSections(sections, query);
  const q = query.trim().toLowerCase();
  const pinned = !q || PINNED.label.toLowerCase().includes(q);
  const close = () => setPanelOpen("shortcuts", false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (query) setQuery("");
    else close();
  };
  return (
    <div
      id="shortcuts-drawer"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onKeyDown={onKeyDown}
      className="fixed top-chrome right-0 bottom-0 z-40 flex w-80 flex-col border-l border-edge bg-background text-xs text-foreground"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h2 className="m-0 text-sm font-medium">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close keyboard shortcuts"
          onClick={close}
          className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4"
        >
          <X />
        </button>
      </div>
      <div className="shrink-0 px-3">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-edge bg-input px-2 focus-within:border-primary">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            id="shortcuts-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {pinned && (
          <div
            data-shortcut="Command palette"
            className="mt-2 flex h-9 items-center rounded-lg border border-edge px-3 text-sm"
          >
            <span className="truncate">{PINNED.label}</span>
            <Chips keys={PINNED.keys} />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        {visible.map((section) => (
          <section key={section.title} data-shortcut-section={section.title} className="pt-3">
            <h3 className="m-0 flex h-6 items-center text-2xs font-medium tracking-wide text-foreground">
              {section.title}
            </h3>
            {section.rows.map((row) => (
              <div
                key={row.id}
                data-shortcut={row.label}
                className="flex h-8 items-center gap-2 text-muted-foreground"
              >
                <span className="truncate">{row.label}</span>
                <Chips keys={row.keys} />
              </div>
            ))}
          </section>
        ))}
        {!visible.length && !pinned && (
          <p className="m-0 py-6 text-center text-muted-foreground">No shortcuts found</p>
        )}
      </div>
    </div>
  );
}
