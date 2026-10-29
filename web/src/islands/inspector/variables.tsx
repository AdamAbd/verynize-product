// Variables (design/wonder 11, 41, 42): collapsible header with count, search, `+` create menu, colour rows.
import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, Diamond, Hash, Palette, Search, Trash2, Type, Baseline, Ruler } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { useDesign } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton, Swatch } from "./controls";
import { createColorToken, deleteToken, setTokenColor } from "./legacy";

/** 36px panel header row with a chevron, label and tools (Variables / Properties). */
export function PanelSectionHeader({
  label,
  count,
  open,
  onToggle,
  tools,
  className,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  tools?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-2 pr-3 pl-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="truncate">{label}</span>
        {count ? <span className="text-subtle-foreground">{count}</span> : null}
      </button>
      {tools ? <div className="flex items-center gap-2">{tools}</div> : null}
    </div>
  );
}

function TokenRow({ name, color }: { name: string; color: string }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="group/token flex h-7.5 items-center gap-2 rounded-md pr-1 pl-3 hover:bg-muted">
      <button
        type="button"
        aria-label={`Edit ${name} colour`}
        title="Edit colour"
        className="relative flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => picker.current?.click()}
      >
        <Swatch color={color} />
        <input
          ref={picker}
          type="color"
          tabIndex={-1}
          aria-hidden
          value={color}
          className="pointer-events-none absolute inset-0 size-full opacity-0"
          onChange={(event) => setTokenColor(name, event.target.value)}
        />
      </button>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground-2">{name}</span>
      <span className="text-xs text-muted-foreground uppercase group-hover/token:hidden">{color}</span>
      <IconButton
        icon={Trash2}
        label={`Delete variable ${name}`}
        className="hidden group-hover/token:inline-flex group-focus-within/token:inline-flex"
        onClick={() => deleteToken(name)}
      />
    </div>
  );
}

export function VariablesSection({ open, onToggle, grow }: { open: boolean; onToggle: () => void; grow: boolean }) {
  const doc = useDesign();
  const tokens = Object.entries(doc.tokens ?? {});
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = tokens.filter(([name, color]) => !q || name.toLowerCase().includes(q) || color.includes(q));
  return (
    <section
      id="insp-variables"
      className={cn("flex min-h-0 shrink-0 flex-col border-b border-divider", open && grow && "flex-1", open && !grow && "max-h-1/2")}
    >
      <PanelSectionHeader
        label="Variables"
        count={tokens.length}
        open={open}
        onToggle={onToggle}
        className="h-9"
        tools={
          <>
            <IconButton
              icon={Search}
              label="Search variables"
              active={searching}
              onClick={() => {
                setSearching(!searching);
                if (!open) onToggle();
                if (searching) setQuery("");
              }}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton id="add-token" icon={PlusIcon} label="Create variable" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-44">
                <DropdownMenuItem id="add-color-token" onSelect={() => createColorToken()}>
                  <Palette />
                  Colors
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Ruler />
                  Dimensions
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Hash />
                  Numbers
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Type />
                  Font family
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Baseline />
                  Font weight
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div hidden={!open} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {searching ? (
          <div className="px-3 pb-2">
            <input
              autoFocus
              aria-label="Search variables"
              placeholder="Search variables"
              value={query}
              className="h-6 w-full rounded-md bg-input px-2 text-xs text-foreground shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
          </div>
        ) : null}
        {tokens.length ? (
          <>
            <div className="flex h-7 items-center px-3 text-xs text-foreground-3">Colors</div>
            {shown.map(([name, color]) => (
              <TokenRow key={name} name={name} color={color} />
            ))}
            {!shown.length ? <p className="px-3 py-2 text-xs text-muted-foreground">No matching variables</p> : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-4 pt-8 pb-4 text-center">
            <Diamond className="size-4 text-foreground-3" aria-hidden />
            <p className="text-xs text-foreground-3">
              Variables let you reuse colours, sizes and type across this file. Use the + above to create one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
