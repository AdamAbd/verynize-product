// Typography (design/wonder 25–27): font family picker, weight names, size, line height, letter spacing,
// alignment segments, text content and rich-range buttons.
import { useRef, useState } from "react";
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
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Affix, Caption, Field, IconAffix, IconButton, Section, Segmented, type IconType } from "./controls";
import { notify } from "./legacy";
import { FONTS, WEIGHTS, fmt, patchNodes, setField, weightName, type Node } from "./model";

const pickerTrigger =
  "flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-input pr-2 pl-2 text-xs text-foreground shadow-field outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:ring-1 data-[state=open]:ring-primary";

function FontFamilyPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const fonts = [...new Set([value, ...FONTS])].filter((f) => !q || f.toLowerCase().includes(q));
  const choose = (font: string) => {
    setOpen(false);
    setQuery("");
    if (font && font !== value) onChange(font);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Font family" className={pickerTrigger}>
          <span className="truncate">{value}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={12} className="w-60">
        <div className="-m-1.5">
        <input
          autoFocus
          aria-label="Search fonts"
          placeholder="Search fonts"
          value={query}
          className="mb-1 h-7 w-full rounded-md bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") choose(fonts[0] ?? query.trim());
          }}
        />
        <div role="listbox" aria-label="Fonts" className="max-h-72 overflow-y-auto">
          {fonts.map((font) => (
            <button
              key={font}
              type="button"
              role="option"
              aria-selected={font === value}
              className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent focus-visible:bg-accent"
              onClick={() => choose(font)}
            >
              <span className="truncate">{font}</span>
              {font === value ? <Check className="size-3.5 text-foreground-3" aria-hidden /> : null}
            </button>
          ))}
          {!fonts.length && q ? (
            <button
              type="button"
              className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent"
              onClick={() => choose(query.trim())}
            >
              Use “{query.trim()}”
            </button>
          ) : null}
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FontWeightPicker({ value, onChange }: { value: string; onChange: (weight: string) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Font weight" className={pickerTrigger}>
          <span className="truncate">{weightName(value)}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-44">
        <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
          <Diamond className="size-3.5" aria-hidden />
          Weights
        </div>
        <DropdownMenuSeparator />
        {WEIGHTS.map(([weight, label]) => (
          <DropdownMenuItem key={weight} onSelect={() => onChange(weight)} className="justify-between">
            {label}
            {String(value) === weight ? <Check className="size-3.5" aria-hidden /> : null}
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

export function TypographySection({ node, selection }: { node: Node; selection: string[] }) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
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
          ? { start, end, bold: false, italic: false, color: n.color, fontSize: n.fontSize }
          : { start, end, bold: style === "bold", italic: style === "italic" },
      ],
    }));
  };
  return (
    <Section
      id="typography-section"
      title="Typography"
      tools={<IconButton icon={SlidersVertical} label="Edit text content" onClick={() => text.current?.focus()} />}
    >
      <FontFamilyPicker value={node.fontFamily} onChange={set("fontFamily")} />
      <div className="grid grid-cols-2 gap-2">
        <FontWeightPicker value={node.fontWeight} onChange={set("fontWeight")} />
        <Field
          name="fontSize"
          label="Font size"
          numeric
          value={fmt(node.fontSize)}
          onCommit={set("fontSize")}
          prefix={<IconAffix icon={ALargeSmall} />}
          suffix="px"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Caption label="Line height">
          <Field
            name="lineHeight"
            label="Line height"
            numeric
            step={0.05}
            value={fmt(node.lineHeight)}
            onCommit={set("lineHeight")}
            prefix={<IconAffix icon={Baseline} />}
          />
        </Caption>
        <Caption label="Letter spacing">
          <Field
            name="letterSpacing"
            label="Letter spacing"
            numeric
            step={0.1}
            value={fmt(node.letterSpacing)}
            onCommit={set("letterSpacing")}
            prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
            suffix="px"
          />
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
        <RangeButton id="range-bold" label="Bold selected range" icon={Bold} onClick={() => range("bold")} />
        <RangeButton id="range-italic" label="Italic selected range" icon={Italic} onClick={() => range("italic")} />
        <RangeButton
          id="range-style"
          label="Apply fill colour and size to selected range"
          icon={Paintbrush}
          onClick={() => range("style")}
        />
        <span className="ml-1 truncate text-2xs text-subtle-foreground">Select text above, then style the range</span>
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
