// Variables (design/wonder 11, 41, 42): collapsible header with count, search, `+` create menu, colour rows.
import { useState, type ReactNode } from "react";
import {
  Baseline,
  Braces,
  ChevronRight,
  Copy,
  Diamond,
  Download,
  Hash,
  Palette,
  Ruler,
  Search,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/icons";
import { useDesign } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorPopover } from "./color-picker";
import { Field, IconButton, NativeSelect, Swatch, type IconType } from "./controls";
import { saveFile } from "./export";
import { createColorToken, deleteToken } from "./legacy";
import { FONTS, WEIGHTS } from "./model";
import {
  createVariable,
  deleteVariable,
  parseValue,
  renameVariable,
  setTokenColor,
  setVariableValue,
  variablesCss,
  variablesOf,
  VARIABLE_TYPES,
  type Variable,
  type VariableType,
} from "./vars";

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
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="truncate">{label}</span>
        {count ? <span className="text-subtle-foreground">{count}</span> : null}
      </button>
      {tools ? <div className="flex items-center gap-2">{tools}</div> : null}
    </div>
  );
}

function TokenRow({ name, color }: { name: string; color: string }) {
  const [open, setOpen] = useState(false);
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={color}
      onCommit={(next) => setTokenColor(name, next)}
    >
      <div
        data-color-anchor
        data-token={name}
        className="group/token flex h-7.5 items-center gap-2 rounded-md pr-1 pl-3 hover:bg-muted"
      >
        <button
          type="button"
          aria-label={`Edit ${name} colour`}
          aria-expanded={open}
          title="Edit colour"
          className="relative flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setOpen(!open)}
        >
          <Swatch color={color} />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-2">{name}</span>
        <span className="text-xs text-muted-foreground uppercase group-hover/token:hidden">
          {color}
        </span>
        <IconButton
          icon={Trash2}
          label={`Delete variable ${name}`}
          className="hidden group-hover/token:inline-flex group-focus-within/token:inline-flex"
          onClick={() => deleteToken(name)}
        />
      </div>
    </ColorPopover>
  );
}

/** Dimension / number / font family / font weight row: rename on double-click, inline value, delete. */
function VariableRow({ name, variable }: { name: string; variable: Variable }) {
  const [renaming, setRenaming] = useState(false);
  const Icon = TYPE_ICON[variable.type];
  const commitValue = (raw: string) => {
    const value = parseValue(variable.type, raw);
    if (value === null)
      return variable.type === "fontWeight"
        ? "Use a weight from 100 to 900"
        : "Enter a valid value";
    if (value !== variable.value) setVariableValue(name, value);
    return null;
  };
  return (
    <div
      data-variable={name}
      className="group/token flex h-7.5 items-center gap-2 rounded-md pr-1 pl-3 hover:bg-muted"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {renaming ? (
        <input
          autoFocus
          aria-label={`Rename variable ${name}`}
          defaultValue={name}
          className="h-6 min-w-0 flex-1 rounded-md bg-input px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onBlur={(event) => {
            const next = event.target.value.trim();
            setRenaming(false);
            if (next && next !== name) renameVariable(name, next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-xs text-foreground-2"
          title="Double-click to rename"
          onDoubleClick={() => setRenaming(true)}
        >
          {name}
        </span>
      )}
      {variable.type === "fontWeight" ? (
        <NativeSelect
          label={`${name} value`}
          className="w-24 shrink-0"
          value={String(variable.value)}
          options={WEIGHTS.map(([value, label]) => ({ value, label }))}
          onChange={(value) => commitValue(value)}
        />
      ) : (
        <Field
          label={`${name} value`}
          numeric={variable.type !== "fontFamily"}
          scrub={false}
          value={String(variable.value)}
          className={cn("shrink-0", variable.type === "fontFamily" ? "w-28" : "w-20")}
          inputClassName={variable.type === "fontFamily" ? "" : "text-right"}
          suffix={variable.type === "dimension" ? "px" : undefined}
          list={variable.type === "fontFamily" ? "bd-variable-fonts" : undefined}
          onCommit={commitValue}
        />
      )}
      <IconButton
        icon={Trash2}
        label={`Delete variable ${name}`}
        className="hidden group-hover/token:inline-flex group-focus-within/token:inline-flex"
        onClick={() => deleteVariable(name)}
      />
    </div>
  );
}

const TYPE_ICON: Record<VariableType, IconType> = {
  dimension: Ruler,
  number: Hash,
  fontFamily: Type,
  fontWeight: Baseline,
};

function GroupLabel({ children }: { children: string }) {
  return <div className="flex h-7 items-center px-3 text-xs text-foreground-3">{children}</div>;
}

export function VariablesSection({
  open,
  onToggle,
  grow,
}: {
  open: boolean;
  onToggle: () => void;
  grow: boolean;
}) {
  const doc = useDesign();
  const tokens = Object.entries(doc.tokens ?? {});
  const vars = Object.entries(variablesOf(doc));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (name: string, value: unknown) =>
    !q || name.toLowerCase().includes(q) || String(value).toLowerCase().includes(q);
  const shownTokens = tokens.filter(([name, color]) => match(name, color));
  const shownVars = vars.filter(([name, v]) => match(name, v.value));
  const total = tokens.length + vars.length;
  const reveal = () => {
    if (!open) onToggle();
  };
  const css = () => variablesCss(window.design.getDocument());
  return (
    <section
      id="insp-variables"
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-b border-divider",
        open && grow && "flex-1",
        open && !grow && "max-h-1/2",
      )}
    >
      <PanelSectionHeader
        label="Variables"
        count={total}
        open={open}
        onToggle={onToggle}
        className="h-9"
        tools={
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  id="variables-css"
                  icon={Braces}
                  label="Export variables as CSS"
                  disabled={!total}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-48">
                <DropdownMenuItem
                  id="copy-variables-css"
                  onSelect={async () => {
                    await copyText(css());
                    toast.success(
                      `Copied ${total} ${total === 1 ? "variable" : "variables"} as CSS`,
                    );
                  }}
                >
                  <Copy />
                  Copy as CSS
                </DropdownMenuItem>
                <DropdownMenuItem
                  id="save-variables-css"
                  onSelect={async () => {
                    try {
                      const saved = await saveFile(
                        `${doc.name || "design"}-variables`,
                        css(),
                        "css",
                      );
                      if (saved) toast.success("Exported CSS variables", { description: saved });
                    } catch (error) {
                      toast.error("Export failed", {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }}
                >
                  <Download />
                  Save CSS file…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              icon={Search}
              label="Search variables"
              active={searching}
              onClick={() => {
                setSearching(!searching);
                reveal();
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
                {VARIABLE_TYPES.map(({ type, label }) => {
                  const Icon = TYPE_ICON[type];
                  return (
                    <DropdownMenuItem
                      key={type}
                      id={`add-${type}-variable`}
                      onSelect={async () => {
                        if (await createVariable(type)) reveal();
                      }}
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div hidden={!open} className="min-h-0 flex-1 overflow-y-auto pb-2">
        <datalist id="bd-variable-fonts">
          {FONTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
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
        {total ? (
          <>
            {shownTokens.length ? <GroupLabel>Colors</GroupLabel> : null}
            {shownTokens.map(([name, color]) => (
              <TokenRow key={name} name={name} color={color} />
            ))}
            {VARIABLE_TYPES.map(({ type, group }) => {
              const rows = shownVars.filter(([, v]) => v.type === type);
              if (!rows.length) return null;
              return (
                <div key={type} role="group" aria-label={group}>
                  <GroupLabel>{group}</GroupLabel>
                  {rows.map(([name, v]) => (
                    <VariableRow key={name} name={name} variable={v} />
                  ))}
                </div>
              );
            })}
            {!shownTokens.length && !shownVars.length ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matching variables</p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 px-4 pt-8 pb-4 text-center">
            <Diamond className="size-4 text-foreground-3" aria-hidden />
            <p className="text-xs text-foreground-3">
              Variables let you reuse colours, sizes and type across this file. Use the + above to
              create one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}
