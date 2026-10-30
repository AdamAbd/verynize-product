// Typography (design/wonder 25–27): font family picker, weight names, size, line height, letter spacing,
// alignment segments, text content and rich-range buttons.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ALargeSmall,
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Diamond,
  Italic,
  Paintbrush,
  SlidersVertical,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  X,
} from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  Section,
  Segmented,
  type IconType,
} from "./controls";
import { notify } from "./legacy";
import { WEIGHTS, fmt, pageNodes, patchNodes, setField, weightName, type Node } from "./model";
import { BindableField, VariableChip } from "./bind";
import {
  ALL_WEIGHTS,
  loadCatalog,
  loadLocalFonts,
  nearestWeight,
  previewFont,
  weightsFor,
  type FontEntry,
} from "./fonts";
import { bindVariable, bindingsOf, variablesOf } from "./vars";

const pickerTrigger =
  "flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-input pr-2 pl-2 text-xs text-foreground shadow-field outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:ring-1 data-[state=open]:ring-primary";

/** Family name rendered in its own typeface (dynamic font-family set through the DOM, no inline style props). */
function FontName({ family, className }: { family: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current)
      ref.current.style.fontFamily = `"${family.replace(/"/g, "")}", var(--font-sans)`;
  }, [family]);
  return (
    <span ref={ref} className={cn("truncate", className)}>
      {family}
    </span>
  );
}

const LIMIT = 150;
const KIND_LABEL: Record<FontEntry["kind"], string> = {
  bundled: "Bundled",
  system: "System",
  generic: "Generic",
  web: "Google Fonts",
  local: "Installed",
};

function FontFamilyPicker({
  doc,
  node,
  selection,
  fonts,
  onLocalFonts,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  fonts: FontEntry[];
  onLocalFonts: () => void;
}) {
  const value = node.fontFamily;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [source, setSource] = useState<"all" | FontEntry["kind"]>("all");
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const familyVars = Object.entries(variablesOf(doc)).filter(([, v]) => v.type === "fontFamily");
  const bound = bindingsOf(node).fontFamily;
  const used = [
    ...new Set(
      pageNodes(doc)
        .map((n) => n.fontFamily)
        .filter(Boolean),
    ),
  ];
  const matches = useMemo(() => {
    const seen = new Set<string>();
    const out: FontEntry[] = [];
    const add = (f: FontEntry) => {
      const key = f.family.toLowerCase();
      if (
        seen.has(key) ||
        (q && !key.includes(q)) ||
        (source !== "all" && f.kind !== source && !(source === "system" && f.kind === "generic"))
      )
        return;
      seen.add(key);
      out.push(f);
    };
    if (source === "all")
      for (const family of [value, ...used])
        add(
          fonts.find((f) => f.family.toLowerCase() === family.toLowerCase()) ?? {
            family,
            kind: "system",
            weights: ALL_WEIGHTS,
          },
        );
    for (const f of fonts) add(f);
    // Prefix matches first when searching.
    return q
      ? out.sort(
          (a, b) =>
            Number(!a.family.toLowerCase().startsWith(q)) -
            Number(!b.family.toLowerCase().startsWith(q)),
        )
      : out;
  }, [fonts, q, source, value, used.join("\u0000")]);
  const shown = matches.slice(0, LIMIT);
  const current = shown[Math.min(active, shown.length - 1)];
  useEffect(() => {
    if (current) void previewFont(current);
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, active]);
  const choose = (family: string) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    family = family.trim();
    if (!family || (family === value && !bound)) return;
    const weights = weightsFor(family, fonts);
    patchNodes(selection, (n) => {
      const b = { ...bindingsOf(n) };
      delete b.fontFamily;
      const weight = Number(n.fontWeight) || 400;
      const fontWeight =
        weights.includes(weight) || bindingsOf(n).fontWeight
          ? n.fontWeight
          : String(nearestWeight(weights, weight));
      return { fontFamily: family, fontWeight, bindings: Object.keys(b).length ? b : undefined };
    });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onLocalFonts();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Font family"
          className={pickerTrigger}
          data-bound={bound ? "fontFamily" : undefined}
        >
          {bound ? (
            <VariableChip
              name={bound}
              missing={!familyVars.some(([name]) => name === bound)}
              className="ml-0.75"
            />
          ) : (
            <>
              <span className="truncate">{value}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={8}
        className="w-72"
        id="font-family-picker"
      >
        <div className="-m-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              aria-label="Search fonts"
              placeholder="Search fonts"
              value={query}
              role="combobox"
              aria-expanded
              aria-controls="font-family-list"
              aria-activedescendant={current ? `font-option-${active}` : undefined}
              className="h-7 min-w-0 flex-1 rounded-md bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((i) =>
                    Math.max(
                      0,
                      Math.min(shown.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)),
                    ),
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(current?.family ?? query);
                }
              }}
            />
            <IconButton icon={X} label="Close font picker" onClick={() => setOpen(false)} />
          </div>
          <div
            role="tablist"
            aria-label="Font source"
            className="flex h-6 gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(["all", "web", "local", "system"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={source === k}
                className="flex-1 rounded-sm text-2xs text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
                onClick={() => {
                  setSource(k);
                  setActive(0);
                }}
              >
                {k === "all"
                  ? "All"
                  : k === "web"
                    ? "Google"
                    : k === "local"
                      ? "Installed"
                      : "System"}
              </button>
            ))}
          </div>
          {familyVars.length ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent"
                >
                  <Diamond className="size-3.5" aria-hidden />
                  <span className="flex-1">Apply variable</span>
                  {bound ? <span className="truncate text-muted-foreground">{bound}</span> : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="left" align="start" sideOffset={8} className="w-48">
                {familyVars.map(([name, v]) => (
                  <DropdownMenuItem
                    key={name}
                    onSelect={() => {
                      bindVariable(doc, selection, "fontFamily", name);
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1 truncate">{name}</span>
                    <span className="truncate text-muted-foreground">{String(v.value)}</span>
                  </DropdownMenuItem>
                ))}
                {bound ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => bindVariable(doc, selection, "fontFamily", null)}
                    >
                      Detach variable
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div
            ref={list}
            id="font-family-list"
            role="listbox"
            aria-label="Fonts"
            className="max-h-80 min-h-40 overflow-y-auto"
          >
            {shown.map((font, i) => (
              <button
                key={font.family}
                id={`font-option-${i}`}
                data-index={i}
                data-family={font.family}
                type="button"
                role="option"
                aria-selected={font.family === value}
                data-active={i === active || undefined}
                className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent data-active:bg-accent"
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(font.family)}
              >
                <FontName family={font.family} className="text-sm" />
                <span className="flex shrink-0 items-center gap-1 text-2xs text-subtle-foreground">
                  {KIND_LABEL[font.kind]}
                  {font.family === value ? (
                    <Check className="size-3.5 text-foreground-3" aria-hidden />
                  ) : null}
                </span>
              </button>
            ))}
            {!shown.length && q ? (
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent"
                onClick={() => choose(query.trim())}
              >
                Use “{query.trim()}”
              </button>
            ) : null}
            {matches.length > LIMIT ? (
              <p className="px-2 py-1.5 text-2xs text-subtle-foreground">
                {matches.length - LIMIT} more — type to narrow the list
              </p>
            ) : null}
          </div>
          {current ? (
            <div className="flex h-9 items-center border-t border-border px-2" aria-hidden>
              <FontName family={current.family} className="text-base text-foreground" />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FontWeightPicker({
  doc,
  node,
  selection,
  weights,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  weights: number[];
}) {
  const value = node.fontWeight;
  const weightVars = Object.entries(variablesOf(doc)).filter(([, v]) => v.type === "fontWeight");
  const bound = bindingsOf(node).fontWeight;
  const options = WEIGHTS.filter(([w]) => weights.includes(Number(w)));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Font weight"
          className={pickerTrigger}
          data-bound={bound ? "fontWeight" : undefined}
        >
          {bound ? (
            <VariableChip
              name={bound}
              missing={!weightVars.some(([name]) => name === bound)}
              className="ml-0.75"
            />
          ) : (
            <>
              <span className="truncate">{weightName(value)}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="left"
        align="start"
        sideOffset={12}
        className="w-48"
        id="font-weight-picker"
      >
        <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
          <Diamond className="size-3.5" aria-hidden />
          Apply variable
        </div>
        {weightVars.map(([name, v]) => (
          <DropdownMenuItem
            key={name}
            onSelect={() => bindVariable(doc, selection, "fontWeight", name)}
            className="justify-between"
          >
            <span className="truncate">{name}</span>
            <span className="text-muted-foreground">{weightName(String(v.value))}</span>
            {bound === name ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        {bound ? (
          <DropdownMenuItem onSelect={() => bindVariable(doc, selection, "fontWeight", null)}>
            Detach variable
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {options.map(([weight, label]) => (
          <DropdownMenuItem
            key={weight}
            data-weight={weight}
            onSelect={() => setField(selection, node, "fontWeight", weight)}
            className="justify-between"
          >
            {label}
            {!bound && String(value) === weight ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ALIGN = [
  { value: "left", label: "Align left", icon: TextAlignStart },
  { value: "center", label: "Align center", icon: TextAlignCenter },
  { value: "right", label: "Align right", icon: TextAlignEnd },
  { value: "justify", label: "Justify", icon: TextAlignJustify },
];

export function TypographySection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [installed, setInstalled] = useState<FontEntry[]>([]);
  useEffect(() => {
    let live = true;
    void loadCatalog().then((fonts) => live && setCatalog(fonts));
    return () => {
      live = false;
    };
  }, []);
  // Installed fonts need a user gesture: requested when the family picker opens.
  const requestLocal = () => void loadLocalFonts().then(setInstalled);
  const fonts = useMemo(() => [...catalog, ...installed], [catalog, installed]);
  const weights = weightsFor(node.fontFamily, fonts);
  const text = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const commitText = () => {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next !== node.text) setField(selection, node, "text", next);
  };
  const range = (style: "bold" | "italic" | "style") => {
    const t = text.current;
    if (!t || t.selectionStart === t.selectionEnd) {
      notify("Select a range in the text field first.");
      return;
    }
    const start = t.selectionStart,
      end = t.selectionEnd;
    patchNodes([node.id], (n) => ({
      textRuns: [
        ...(n.textRuns || []),
        style === "style"
          ? {
              start,
              end,
              bold: false,
              italic: false,
              color: /^#[0-9a-f]{6}/i.exec(n.color)?.[0] ?? "#000000",
              fontSize: n.fontSize,
            }
          : { start, end, bold: style === "bold", italic: style === "italic" },
      ],
    }));
  };
  return (
    <Section
      id="typography-section"
      title="Typography"
      tools={
        <IconButton
          icon={SlidersVertical}
          label="Edit text content"
          onClick={() => text.current?.focus()}
        />
      }
    >
      <FontFamilyPicker
        doc={doc}
        node={node}
        selection={selection}
        fonts={fonts}
        onLocalFonts={requestLocal}
      />
      <div className="grid grid-cols-2 gap-2">
        <FontWeightPicker doc={doc} node={node} selection={selection} weights={weights} />
        <BindableField
          doc={doc}
          node={node}
          selection={selection}
          field="fontSize"
          label="Font size"
          prefix={<IconAffix icon={ALargeSmall} />}
        >
          {(suffix) => (
            <Field
              name="fontSize"
              label="Font size"
              numeric
              value={fmt(node.fontSize)}
              onCommit={set("fontSize")}
              prefix={<IconAffix icon={ALargeSmall} />}
              suffix={<>px{suffix}</>}
            />
          )}
        </BindableField>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Caption label="Line height">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="lineHeight"
            label="Line height"
            prefix={<IconAffix icon={Baseline} />}
          >
            {(suffix) => (
              <Field
                name="lineHeight"
                label="Line height"
                numeric
                step={0.05}
                value={fmt(node.lineHeight)}
                onCommit={set("lineHeight")}
                prefix={<IconAffix icon={Baseline} />}
                suffix={suffix}
              />
            )}
          </BindableField>
        </Caption>
        <Caption label="Letter spacing">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="letterSpacing"
            label="Letter spacing"
            prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
          >
            {(suffix) => (
              <Field
                name="letterSpacing"
                label="Letter spacing"
                numeric
                step={0.1}
                value={fmt(node.letterSpacing)}
                onCommit={set("letterSpacing")}
                prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
                suffix={<>px{suffix}</>}
              />
            )}
          </BindableField>
        </Caption>
      </div>
      <Caption label="Alignment">
        <Segmented
          label="Text alignment"
          className="w-31"
          value={node.textAlign}
          onChange={set("textAlign")}
          items={ALIGN}
        />
      </Caption>
      <Caption label="Text">
        <textarea
          ref={text}
          name="text"
          aria-label="Text content"
          rows={3}
          value={draft ?? node.text}
          spellCheck={false}
          className="min-h-16 w-full resize-y rounded-md bg-input px-2 py-1 text-xs text-foreground shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commitText();
          }}
        />
      </Caption>
      <div className="flex items-center gap-1" role="group" aria-label="Text ranges">
        <RangeButton
          id="range-bold"
          label="Bold selected range"
          icon={Bold}
          onClick={() => range("bold")}
        />
        <RangeButton
          id="range-italic"
          label="Italic selected range"
          icon={Italic}
          onClick={() => range("italic")}
        />
        <RangeButton
          id="range-style"
          label="Apply fill colour and size to selected range"
          icon={Paintbrush}
          onClick={() => range("style")}
        />
        <span className="ml-1 truncate text-2xs text-subtle-foreground">
          Select text above, then style the range
        </span>
      </div>
    </Section>
  );
}

function RangeButton({
  id,
  label,
  icon,
  onClick,
}: {
  id: string;
  label: string;
  icon: IconType;
  onClick: () => void;
}) {
  return (
    <IconButton
      id={id}
      icon={icon}
      label={label}
      className={cn("bg-input shadow-field")}
      iconClassName="size-3.5"
      // Keep the textarea selection: don't move focus on mousedown.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    />
  );
}
