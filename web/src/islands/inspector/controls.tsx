// Compact inspector controls measured from design/wonder 22/25/43: 24px fields, 6px radius, #2b2b2b fill,
// 12px Inter, 8px prefix inset, 31px section headers, 3 × 80px columns with 8px gaps.
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Add a plain (non-Tailwind) hook class that tests and legacy selectors rely on (e.g. `.insp-display`).
 * Applied after every render because React rewrites `className` when it changes.
 */
export function useHookClass<T extends HTMLElement>(ref: RefObject<T | null>, name: string) {
  useLayoutEffect(() => {
    ref.current?.classList.add(name);
  });
}

/**
 * Any icon component: lucide glyphs or the shared set in @/components/icons. Sizes follow the role scale in
 * components/icons.tsx (size-3 chevrons, size-3.5 chips/menus/field prefixes, size-4 icon buttons); the 1px stroke
 * comes from globals.css, so never pass `strokeWidth`.
 */
export type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/* ---------- Icon button (24px hit area, 16px icon: panel-header and section tools) ---------- */
export function IconButton({
  icon: Icon,
  label,
  className,
  iconClassName,
  active,
  ...props
}: ComponentProps<"button"> & { icon: IconType; label: string; iconClassName?: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-3 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-active:bg-accent data-active:text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className={cn("size-4", iconClassName)} aria-hidden />
    </button>
  );
}

/* ---------- Sections ---------- */
export function Section({
  title,
  tools,
  children,
  id,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  tools?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cn("border-b border-border", className)}>
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        {tools ? <div className="flex items-center gap-2">{tools}</div> : null}
      </div>
      {children ? <div className={cn("flex flex-col gap-2 px-3 pt-1 pb-2.75", bodyClassName)}>{children}</div> : null}
    </section>
  );
}

/** Wonder's optional sections (Border, Shadow, Mask, Export…): a 31px row with `+` that reveals the body. */
export function OptionalSection({
  title,
  id,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const plus = useRef<HTMLButtonElement>(null);
  useHookClass(plus, "insp-add");
  return (
    <section id={id} className="border-b border-border">
      <div
        className="flex h-7.75 items-center justify-between gap-2 px-3"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) onOpenChange(!open);
        }}
      >
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        <IconButton
          icon={PlusIcon}
          label={(open ? "Hide " : "Add ") + title.toLowerCase()}
          aria-expanded={open}
          ref={plus}
          iconClassName={cn("transition-transform", open && "rotate-45")}
          onClick={() => onOpenChange(!open)}
        />
      </div>
      <div hidden={!open} className={cn(open ? "flex" : "hidden", "flex-col gap-2 px-3 pt-1 pb-2.75")}>
        {children}
      </div>
    </section>
  );
}

export function Caption({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ---------- Field shell ---------- */
const fieldBox =
  "group/field flex h-6 min-w-0 items-center gap-1 rounded-md bg-input px-2 text-xs text-foreground shadow-field focus-within:ring-1 focus-within:ring-ring";

/** 14px field-prefix icon (opacity, radius, rotation, line height…), measured on design/wonder 22/25. Overhangs its
 * 12px slot by 1px each side so values line up with letter prefixes (X, Y, W…). */
export function IconAffix({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="-mx-px flex w-3.5 shrink-0 select-none items-center justify-center text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

export function Affix({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("flex w-3 shrink-0 select-none items-center justify-center text-muted-foreground", className)}>
      {children}
    </span>
  );
}

type FieldProps = {
  name?: string;
  label: string;
  value: string;
  onCommit: (value: string) => string | null | void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  numeric?: boolean;
  step?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Drag the prefix horizontally to scrub numeric values (committed once on release). */
  scrub?: boolean;
};

/** Commit on Enter/blur, Escape reverts, ArrowUp/Down ±step (Shift ×10). */
export function Field({
  name,
  label,
  value,
  onCommit,
  prefix,
  suffix,
  numeric,
  step = 1,
  placeholder,
  className,
  inputClassName,
  disabled,
  scrub = numeric,
}: FieldProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const commit = () => {
    const next = draftRef.current;
    if (next === null) return;
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  const nudge = (direction: number, big: boolean) => {
    const base = Number(draftRef.current ?? value);
    if (!Number.isFinite(base)) return;
    const next = Math.round((base + direction * step * (big ? 10 : 1)) * 1000) / 1000;
    setDraft(null);
    onCommit(String(next));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      event.currentTarget.blur();
    } else if (numeric && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
    }
  };
  const onScrubStart = (event: PointerEvent<HTMLSpanElement>) => {
    if (!scrub || disabled || event.button !== 0) return;
    const start = Number(value);
    if (!Number.isFinite(start)) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const x0 = event.clientX;
    let moved = false;
    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - x0;
      if (Math.abs(dx) < 2 && !moved) return;
      moved = true;
      const next = Math.round((start + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1)) * 1000) / 1000;
      setDraft(String(next));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (moved) commit();
      else inputRef.current?.focus();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  return (
    <div className={cn(fieldBox, disabled && "opacity-50", className)}>
      {prefix ? (
        <span
          className={cn("flex shrink-0 items-center", scrub && !disabled && "cursor-ew-resize")}
          onPointerDown={onScrubStart}
        >
          {prefix}
        </span>
      ) : null}
      <input
        ref={inputRef}
        name={name}
        aria-label={label}
        title={label}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={numeric ? "decimal" : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn("h-full w-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none", prefix ? "pl-1" : "", inputClassName)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix ? <span className="flex shrink-0 select-none items-center text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/* ---------- Native select (tests use Playwright selectOption on these) ---------- */
export function NativeSelect({
  name,
  label,
  value,
  options,
  onChange,
  prefix,
  className,
  selectClassName,
  bare,
  id,
}: {
  name?: string;
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  prefix?: ReactNode;
  className?: string;
  selectClassName?: string;
  /** Render without the field background (e.g. the px/Hug/Fill unit inside the W/H fields). */
  bare?: boolean;
}) {
  return (
    <div className={cn(bare ? "relative flex h-6 items-center" : cn(fieldBox, "relative pr-0"), className)}>
      {prefix}
      <select
        id={id}
        name={name}
        aria-label={label}
        title={label}
        value={value}
        className={cn(
          "h-full w-full min-w-0 cursor-default appearance-none truncate bg-transparent pr-5 text-xs text-foreground outline-none",
          bare && "pr-4 text-right text-muted-foreground",
          selectClassName,
        )}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-popover text-foreground">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={cn("pointer-events-none absolute size-3 text-muted-foreground", bare ? "right-0" : "right-2")}
      />
    </div>
  );
}

/* ---------- Segmented control (Radix ToggleGroup) ---------- */
export function Segmented({
  value,
  onChange,
  items,
  label,
  className,
  itemClassName,
  dataKey,
  hook,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; icon: IconType }[];
  label: string;
  className?: string;
  itemClassName?: string;
  /** Adds `data-<dataKey>=<value>` to each item (e.g. `data-layout`). */
  dataKey?: string;
  /** Plain hook class for selectors (e.g. `insp-display`). */
  hook?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useHookClass(root, hook ?? "insp-segmented");
  return (
    <ToggleGroupPrimitive.Root
      ref={root}
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onChange(next)}
      className={cn("flex h-6 w-full items-stretch overflow-hidden rounded-md bg-muted", className)}
    >
      {items.map(({ value: v, label: l, icon: Icon }) => (
        <ToggleGroupPrimitive.Item
          key={v}
          value={v}
          aria-label={l}
          title={l}
          {...(dataKey ? { [`data-${dataKey}`]: v } : {})}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground",
            itemClassName,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ---------- Colour swatch (dynamic colour set through the DOM, no inline style props) ---------- */
export function Swatch({ color, className }: { color: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.style.background = color || "transparent";
  }, [color]);
  return <span ref={ref} aria-hidden className={cn("block size-4 shrink-0 rounded-sm ring-1 ring-card", className)} />;
}
