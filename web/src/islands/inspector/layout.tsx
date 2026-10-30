// Layout section (design/wonder Layout panel): Display, size + min/max limits, then the controls of the chosen display
// (Flex: direction, 3×3 alignment, distribution, reverse, wrap, gaps · Grid: tracks, gaps, cell alignment · Block:
// vertical spacing), the layer's own placement inside its parent (Grid child spans, Margin) and Padding.
import { useState, type ReactNode } from "react";
import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignVerticalDistributeCenter,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowLeftRight,
  Columns2,
  Columns3,
  CornerDownLeft,
  FoldHorizontal,
  FoldVertical,
  GitCommitHorizontal,
  LayoutGrid,
  Proportions,
  Rows2,
  Rows3,
  SeparatorHorizontal,
  SeparatorVertical,
  Shapes,
  Square,
} from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import {
  MarginBottomIcon,
  MarginLeftIcon,
  MarginRightIcon,
  MarginSidesIcon,
  MarginTopIcon,
  MarginXIcon,
  MarginYIcon,
  PaddingBottomIcon,
  PaddingLeftIcon,
  PaddingRightIcon,
  PaddingSidesIcon,
  PaddingTopIcon,
  PaddingXIcon,
  PaddingYIcon,
  StackColumnIcon,
  StackRowIcon,
} from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BindableField } from "./bind";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  NativeSelect,
  Section,
  Segmented,
  type IconType,
} from "./controls";
import { notify } from "./legacy";
import {
  fmt,
  parentOf,
  patchNodes,
  setField,
  sizingAllowed,
  sizingMode,
  type Node,
  type SizingMode,
} from "./model";

type Props = { doc: DesignDocument; node: Node; selection: string[] };
type Patch = Record<string, unknown>;
type Side = number | "auto";

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};
const isFlow = (n: Node | undefined) => !!n && n.type === "frame" && n.layout !== "free";
/** Patch that drops a variable binding, so typing a value detaches the property (as in model.setField). */
function unbind(node: Node, key: string): Patch {
  if (!node.bindings?.[key]) return {};
  const { [key]: _detached, ...rest } = node.bindings;
  return { bindings: Object.keys(rest).length ? rest : undefined };
}
/** Parse a typed length; `min` clamps (padding and gap cannot go negative). */
function parseLength(raw: string, min = -Infinity): number | null {
  const v = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(v)) {
    notify("Enter a number.");
    return null;
  }
  return Math.max(min, Math.round(v * 100) / 100);
}

/* ---------- Shared rows ---------- */
/** Two field columns plus Wonder's 24px trailing tool column. */
function Row({ children, tool }: { children: ReactNode; tool?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">{children}</div>
      <div className="flex w-6 shrink-0 flex-col items-center gap-2">{tool}</div>
    </div>
  );
}

function NumberField({
  name,
  label,
  icon,
  value,
  placeholder,
  unit,
  disabled,
  className,
  onCommit,
}: {
  name: string;
  label: string;
  icon: IconType;
  value: string;
  placeholder?: string;
  unit?: ReactNode;
  disabled?: boolean;
  className?: string;
  onCommit: (raw: string) => void;
}) {
  return (
    <Field
      name={name}
      label={label}
      numeric
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onCommit={onCommit}
      prefix={<IconAffix icon={icon} />}
      suffix={unit}
    />
  );
}

/* ---------- Display + size ---------- */
const DISPLAY = (direction: string) => [
  { value: "free", label: "Free position", icon: Shapes },
  {
    value: "flex",
    label: "Flexbox",
    icon: direction === "column" ? StackColumnIcon : StackRowIcon,
  },
  { value: "block", label: "Block flow", icon: Square },
  { value: "grid", label: "Grid", icon: LayoutGrid },
];
const UNIT_LABEL: Record<SizingMode, string> = { fixed: "px", hug: "Hug", fill: "Fill" };
const LIMITS = [
  { key: "minW", label: "Min width", icon: FoldHorizontal },
  { key: "maxW", label: "Max width", icon: FoldHorizontal },
  { key: "minH", label: "Min height", icon: FoldVertical },
  { key: "maxH", label: "Max height", icon: FoldVertical },
] as const;
type LimitKey = (typeof LIMITS)[number]["key"];
const hasLimit = (node: Node, key: LimitKey) => node[key] !== undefined && node[key] !== null;

function SizeField({
  node,
  parent,
  axis,
  selection,
}: Props & { parent: Node | undefined; axis: "w" | "h" }) {
  const mode = sizingMode(node, axis, parent);
  return (
    <Field
      name={axis}
      label={axis === "w" ? "Width" : "Height"}
      numeric
      value={fmt(node[axis])}
      onCommit={(value) => setField(selection, node, axis, value)}
      prefix={<Affix>{axis.toUpperCase()}</Affix>}
      className="pr-1"
      suffix={
        <NativeSelect
          bare
          name={axis + "Mode"}
          label={(axis === "w" ? "Width" : "Height") + " sizing"}
          value={mode}
          className="text-muted-foreground"
          options={(["fixed", "hug", "fill"] as SizingMode[]).map((m) => ({
            value: m,
            label: UNIT_LABEL[m],
            disabled: !sizingAllowed(node, parent, m),
          }))}
          onChange={(value) => setField(selection, node, axis + "Mode", value)}
        />
      }
    />
  );
}

/** Trailing size tool: hug contents, and add min/max limits (Figma's W/H menu). */
function SizeMenu({ node, parent, selection }: Props & { parent: Node | undefined }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Proportions} label="Size options" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-44">
        <DropdownMenuItem
          disabled={!sizingAllowed(node, parent, "hug")}
          onSelect={() => patchNodes([node.id], () => ({ wMode: "hug", hMode: "hug" }))}
        >
          Hug contents
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {LIMITS.map((l) => (
          <DropdownMenuItem
            key={l.key}
            data-limit={l.key}
            disabled={hasLimit(node, l.key)}
            onSelect={() =>
              patchNodes(selection, (n) => ({
                [l.key]: Math.round(l.key.endsWith("W") ? n.w : n.h),
              }))
            }
          >
            Add {l.label.toLowerCase()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One row per min/max limit that is set: value + which limit (switch or remove). */
function LimitRows({ node, selection }: Props) {
  const rows = LIMITS.filter((l) => hasLimit(node, l.key));
  if (!rows.length) return null;
  return (
    <>
      {rows.map((l) => {
        const value = node[l.key] as number | string;
        return (
          <Row key={l.key}>
            <Field
              name={l.key}
              label={l.label}
              numeric={typeof value === "number"}
              value={String(value)}
              className="col-span-2 pr-1"
              prefix={<IconAffix icon={l.icon} />}
              onCommit={(raw) => {
                const pct = /^\s*\d+(\.\d+)?%\s*$/.test(raw) ? raw.trim() : null;
                const v = pct ?? parseLength(raw, 0);
                if (v !== null) patchNodes(selection, () => ({ [l.key]: v }));
              }}
              suffix={
                <NativeSelect
                  bare
                  name={l.key + "Kind"}
                  label={l.label + " limit"}
                  value={l.key}
                  options={[
                    ...LIMITS.map((o) => ({
                      value: o.key,
                      label: o.label,
                      disabled: o.key !== l.key && hasLimit(node, o.key),
                    })),
                    { value: "remove", label: "Remove" },
                  ]}
                  onChange={(next) =>
                    patchNodes(selection, (n) =>
                      next === "remove"
                        ? { [l.key]: undefined }
                        : { [l.key]: undefined, [next]: n[l.key] },
                    )
                  }
                />
              }
            />
          </Row>
        );
      })}
    </>
  );
}

/* ---------- Alignment matrix ---------- */
const AXIS = ["start", "center", "end"] as const;
const JUSTIFY_AT = ["flex-start", "center", "flex-end"];
const indexOf = (value: unknown) =>
  value === "center" ? 1 : value === "flex-end" || value === "end" ? 2 : 0;
const DISTRIBUTED = ["space-around", "space-between", "space-evenly"];

/** Wonder's active-cell glyph: three bars along the main axis, aligned on the cross axis (equal when stretched). */
function Bars({ column, cross, stretch }: { column: boolean; cross: number; stretch: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex gap-px",
        column ? "flex-col" : "flex-row",
        cross === 1 ? "items-center" : cross === 2 ? "items-end" : "items-start",
      )}
    >
      {column ? (
        <>
          <span className={cn("h-0.5 rounded-full bg-primary", stretch ? "w-2.5" : "w-1.5")} />
          <span className="h-0.5 w-2.5 rounded-full bg-primary" />
          <span className={cn("h-0.5 rounded-full bg-primary", stretch ? "w-2.5" : "w-1.5")} />
        </>
      ) : (
        <>
          <span className={cn("w-0.5 rounded-full bg-primary", stretch ? "h-2.5" : "h-1.5")} />
          <span className="h-2.5 w-0.5 rounded-full bg-primary" />
          <span className={cn("w-0.5 rounded-full bg-primary", stretch ? "h-2.5" : "h-1.5")} />
        </>
      )}
    </span>
  );
}

function Matrix({
  label,
  isActive,
  glyph,
  onPick,
  className,
}: {
  label: string;
  isActive: (row: number, col: number) => boolean;
  glyph: ReactNode;
  onPick: (row: number, col: number) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid h-14 grid-cols-3 grid-rows-3 rounded-md bg-input p-0.5 shadow-field",
        className,
      )}
    >
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const active = isActive(row, col);
          return (
            <button
              key={row + "-" + col}
              type="button"
              data-cell={row + "-" + col}
              aria-label={`${label}: ${AXIS[row]} ${AXIS[col]}`}
              aria-pressed={active}
              title={`${AXIS[row]} ${AXIS[col]}`}
              className={cn(
                "group/cell flex items-center rounded-sm px-1 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
                col === 1 ? "justify-center" : col === 2 ? "justify-end" : "justify-start",
              )}
              onClick={() => onPick(row, col)}
            >
              {active ? (
                glyph
              ) : (
                <span className="mx-1 size-0.5 rounded-full bg-muted-foreground group-hover/cell:bg-foreground" />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

/** Space-around / between / evenly; pressing the active mode returns to packed alignment. */
function Distribution({
  value,
  column,
  onChange,
}: {
  value: string;
  column: boolean;
  onChange: (value: string) => void;
}) {
  const items = column
    ? [
        { value: "space-around", label: "Space around", icon: AlignVerticalSpaceAround },
        { value: "space-between", label: "Space between", icon: AlignVerticalSpaceBetween },
        { value: "space-evenly", label: "Space evenly", icon: AlignVerticalDistributeCenter },
      ]
    : [
        { value: "space-around", label: "Space around", icon: AlignHorizontalSpaceAround },
        { value: "space-between", label: "Space between", icon: AlignHorizontalSpaceBetween },
        { value: "space-evenly", label: "Space evenly", icon: AlignHorizontalDistributeCenter },
      ];
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label="Distribution"
      value={DISTRIBUTED.includes(value) ? value : ""}
      onValueChange={onChange}
      className="flex h-6 w-full items-stretch overflow-hidden rounded-md bg-muted"
    >
      {items.map(({ value: v, label, icon: Icon }) => (
        <ToggleGroupPrimitive.Item
          key={v}
          value={v}
          aria-label={label}
          title={label}
          data-distribute={v}
          className="flex flex-1 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground"
        >
          <Icon className="size-4" aria-hidden />
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ---------- Gaps ---------- */
/**
 * Gap fields on physical axes (`)(` column gap, `≍` row gap). The main-axis field edits `gap` (bindable to a
 * variable) and clears that axis' override; the cross-axis field edits its own override (`gapX` / `gapY`).
 */
function GapField({
  doc,
  node,
  selection,
  axis,
  main,
  disabled,
  className,
}: Props & { axis: "x" | "y"; main: boolean; disabled?: boolean; className?: string }) {
  const key = axis === "x" ? "gapX" : "gapY";
  const value = num(node[key], num(node.gap));
  const icon = axis === "x" ? SeparatorVertical : SeparatorHorizontal;
  const label = axis === "x" ? "Column gap" : "Row gap";
  const commit = (raw: string) => {
    const v = parseLength(raw, 0);
    if (v === null) return;
    patchNodes(selection, (n) =>
      main ? { gap: v, [key]: undefined, ...unbind(n, "gap") } : { [key]: v },
    );
  };
  if (!main)
    return (
      <NumberField
        name={key}
        label={label}
        icon={icon}
        value={fmt(value)}
        disabled={disabled}
        className={className}
        onCommit={commit}
      />
    );
  return (
    <div className={cn("min-w-0", className)}>
      <BindableField
        doc={doc}
        node={node}
        selection={selection}
        field="gap"
        label={label}
        prefix={<IconAffix icon={icon} />}
      >
        {(suffix) => (
          <Field
            name="gap"
            label={label}
            numeric
            value={fmt(value)}
            onCommit={commit}
            prefix={<IconAffix icon={icon} />}
            suffix={suffix}
          />
        )}
      </BindableField>
    </div>
  );
}

/* ---------- Flex ---------- */
const DIRECTION = [
  { value: "row", label: "Horizontal", icon: Columns2 },
  { value: "column", label: "Vertical", icon: Rows2 },
];

function FlexGroup(props: Props) {
  const { node, selection } = props;
  const column = node.direction === "column";
  const reverse = node.reverse === true;
  const wrap = !!node.flexWrap;
  const distributed = DISTRIBUTED.includes(node.justifyContent);
  // Visual main-axis position (reverse flips which edge flex-start is on).
  const mainOf = (justify: unknown) => {
    const i = indexOf(justify);
    return reverse ? 2 - i : i;
  };
  const cross = indexOf(node.alignItems);
  const set = (patch: Patch) => patchNodes(selection, () => patch);
  return (
    <Caption label="Flex">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-3 gap-2">
          <Segmented
            label="Direction"
            hook="insp-direction"
            dataKey="direction"
            value={column ? "column" : "row"}
            onChange={(direction) => set({ direction })}
            items={DIRECTION}
            className="col-start-1 row-start-1"
          />
          <Matrix
            label="Alignment"
            className="col-start-2 row-span-2 row-start-1"
            isActive={(row, col) => {
              const [m, c] = column ? [row, col] : [col, row];
              return c === cross && (distributed || m === mainOf(node.justifyContent));
            }}
            glyph={<Bars column={column} cross={cross} stretch={node.alignItems === "stretch"} />}
            onPick={(row, col) => {
              const [m, c] = column ? [row, col] : [col, row];
              const patch: Patch = { alignItems: JUSTIFY_AT[c] };
              if (!distributed) patch.justifyContent = JUSTIFY_AT[reverse ? 2 - m : m];
              set(patch);
            }}
          />
          <GapField
            {...props}
            axis="x"
            main={!column}
            disabled={column && !wrap}
            className="col-start-1 row-start-2"
          />
          <GapField
            {...props}
            axis="y"
            main={column}
            disabled={!column && !wrap}
            className="col-start-1 row-start-3"
          />
          <div className="col-start-2 row-start-3">
            <Distribution
              value={node.justifyContent}
              column={column}
              onChange={(v) => set({ justifyContent: v || "flex-start" })}
            />
          </div>
        </div>
        <div className="flex w-6 shrink-0 flex-col items-center gap-2">
          <IconButton
            icon={ArrowLeftRight}
            label="Reverse order"
            active={reverse}
            aria-pressed={reverse}
            onClick={() => set({ reverse: reverse ? undefined : true })}
          />
          <IconButton
            icon={CornerDownLeft}
            label="Wrap"
            active={wrap}
            aria-pressed={wrap}
            onClick={() => set({ flexWrap: wrap ? undefined : true })}
          />
        </div>
      </div>
    </Caption>
  );
}

/* ---------- Grid ---------- */
function TrackEditor({ node, selection }: Props) {
  const columns = Math.max(1, Math.floor(num(node.columns, 2)));
  const rows = num(node.rows) >= 1 ? Math.floor(num(node.rows)) : 0;
  const commit = (key: "columns" | "rows") => (raw: string) => {
    if (key === "rows" && (raw.trim() === "" || /^auto$/i.test(raw.trim()))) {
      patchNodes(selection, () => ({ rows: undefined }));
      return;
    }
    const v = parseLength(raw, 1);
    if (v !== null) patchNodes(selection, () => ({ [key]: Math.min(12, Math.round(v)) }));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          id="grid-tracks"
          aria-label="Grid tracks"
          title="Edit grid tracks"
          className="relative flex h-14 w-full items-stretch gap-px rounded-md bg-input p-1 text-xs text-foreground shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {Array.from({ length: Math.min(columns, 12) }, (_, i) => (
            <span key={i} aria-hidden className="flex-1 rounded-xs border border-border" />
          ))}
          <span className="absolute inset-0 flex items-center justify-center">
            {columns} × {rows || "Auto"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={12} className="w-52">
        <div className="flex flex-col gap-2">
          <Caption label="Columns">
            <NumberField
              name="columns"
              label="Grid columns"
              icon={Columns3}
              value={String(columns)}
              onCommit={commit("columns")}
            />
          </Caption>
          <Caption label="Rows">
            <NumberField
              name="rows"
              label="Grid rows"
              icon={Rows3}
              value={rows ? String(rows) : ""}
              placeholder="Auto"
              onCommit={commit("rows")}
            />
          </Caption>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GridGroup(props: Props) {
  const { node, selection } = props;
  const stretched = (v: unknown) => v === undefined || v === "stretch" || v === "normal";
  const free = stretched(node.alignItems) && stretched(node.justifyItems);
  const row = indexOf(node.alignItems),
    col = indexOf(node.justifyItems);
  return (
    <>
      <Row>
        <Caption label="Grid">
          <TrackEditor {...props} />
        </Caption>
        <Caption label="Gap">
          <GapField {...props} axis="x" main />
          <GapField {...props} axis="y" main={false} />
        </Caption>
      </Row>
      <Row>
        <Caption label="Align">
          <Matrix
            label="Cell alignment"
            isActive={(r, c) => !free && r === row && c === col}
            glyph={<span aria-hidden className="mx-0.5 size-1.5 rounded-xs bg-primary" />}
            onPick={(r, c) =>
              patchNodes(selection, () =>
                !free && r === row && c === col
                  ? { alignItems: "stretch", justifyItems: undefined }
                  : { alignItems: JUSTIFY_AT[r], justifyItems: JUSTIFY_AT[c] },
              )
            }
          />
        </Caption>
      </Row>
    </>
  );
}

/* ---------- Block ---------- */
function BlockGroup({ node, selection }: Props) {
  return (
    <Caption label="Block">
      <Row>
        <NumberField
          name="gapY"
          label="Vertical spacing"
          icon={SeparatorHorizontal}
          value={fmt(num(node.gapY))}
          onCommit={(raw) => {
            const v = parseLength(raw, 0);
            if (v !== null) patchNodes(selection, () => ({ gapY: v || undefined }));
          }}
        />
      </Row>
    </Caption>
  );
}

/* ---------- Grid child ---------- */
function GridChild({ node, selection }: Props) {
  const span = (key: "colSpan" | "rowSpan") => (raw: string) => {
    const text = raw.trim().toLowerCase();
    if (text === "" || text === "1") return patchNodes(selection, () => ({ [key]: undefined }));
    if (key === "colSpan" && text === "full")
      return patchNodes(selection, () => ({ colSpan: "full" }));
    const v = parseLength(raw, 1);
    if (v !== null) patchNodes(selection, () => ({ [key]: Math.min(24, Math.round(v)) }));
  };
  return (
    <Caption label="Grid child">
      <Row>
        <NumberField
          name="colSpan"
          label="Column span"
          icon={Columns2}
          value={node.colSpan === "full" ? "Full" : String(node.colSpan ?? 1)}
          onCommit={span("colSpan")}
        />
        <NumberField
          name="rowSpan"
          label="Row span"
          icon={Rows2}
          value={String(node.rowSpan ?? 1)}
          onCommit={span("rowSpan")}
        />
      </Row>
    </Caption>
  );
}

/* ---------- Padding ---------- */
const PAD_KEYS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;
const padsOf = (n: Node) => PAD_KEYS.map((k) => num(n[k], num(n.padding)));

function PaddingGroup({ doc, node, selection }: Props) {
  const [t, r, b, l] = padsOf(node);
  const [split, setSplit] = useState(() => t !== b || l !== r);
  // Sides are [top, right, bottom, left]; equal sides collapse back to the single `padding` value.
  const edit = (sides: number[]) => (raw: string) => {
    const v = parseLength(raw, 0);
    if (v === null) return;
    patchNodes(selection, (n) => {
      const next = padsOf(n).map((p, i) => (sides.includes(i) ? v : p));
      const binding = unbind(n, "padding");
      return next.every((p) => p === next[0])
        ? {
            padding: next[0],
            ...Object.fromEntries(PAD_KEYS.map((k) => [k, undefined])),
            ...binding,
          }
        : { ...Object.fromEntries(PAD_KEYS.map((k, i) => [k, next[i]])), ...binding };
    });
  };
  const mixed = (a: number, z: number) => (a === z ? fmt(a) : "");
  const field = (name: string, label: string, icon: IconType, value: string, sides: number[]) => (
    <NumberField
      name={name}
      label={label}
      icon={icon}
      value={value}
      placeholder="Mixed"
      unit="px"
      onCommit={edit(sides)}
    />
  );
  const uniform = t === r && r === b && b === l;
  const horizontal = uniform ? (
    <BindableField
      doc={doc}
      node={node}
      selection={selection}
      field="padding"
      label="Padding"
      prefix={<IconAffix icon={PaddingXIcon} />}
    >
      {(suffix) => (
        <NumberField
          name="paddingX"
          label="Horizontal padding"
          icon={PaddingXIcon}
          value={fmt(l)}
          unit={<span className="flex items-center gap-1">px{suffix}</span>}
          onCommit={edit([1, 3])}
        />
      )}
    </BindableField>
  ) : (
    field("paddingX", "Horizontal padding", PaddingXIcon, mixed(l, r), [1, 3])
  );
  const bound = !!node.bindings?.padding;
  return (
    <Caption label="Padding">
      <Row
        tool={
          <IconButton
            icon={PaddingSidesIcon}
            label="Independent padding"
            active={split}
            aria-pressed={split}
            onClick={() => setSplit(!split)}
          />
        }
      >
        {split && !bound ? (
          <>
            {field("paddingLeft", "Left padding", PaddingLeftIcon, fmt(l), [3])}
            {field("paddingTop", "Top padding", PaddingTopIcon, fmt(t), [0])}
            {field("paddingRight", "Right padding", PaddingRightIcon, fmt(r), [1])}
            {field("paddingBottom", "Bottom padding", PaddingBottomIcon, fmt(b), [2])}
          </>
        ) : bound ? (
          <div className="col-span-2">{horizontal}</div>
        ) : (
          <>
            {horizontal}
            {field("paddingY", "Vertical padding", PaddingYIcon, mixed(t, b), [0, 2])}
          </>
        )}
      </Row>
    </Caption>
  );
}

/* ---------- Margin (layers placed by a flow parent) ---------- */
const marginOf = (n: Node): Side[] =>
  Array.isArray(n.margin) && n.margin.length === 4
    ? (n.margin as unknown[]).map((v) => (v === "auto" ? "auto" : num(v)))
    : [0, 0, 0, 0];

function MarginGroup({ node, selection }: Props) {
  const m = marginOf(node);
  const [split, setSplit] = useState(() => m[1] !== m[3] || m[0] !== m[2]);
  const write = (sides: number[], v: Side) =>
    patchNodes(selection, (n) => {
      const next = marginOf(n).map((s, i) => (sides.includes(i) ? v : s));
      return { margin: next.every((s) => s === 0) ? undefined : next };
    });
  const field = (name: string, label: string, icon: IconType, sides: number[]) => {
    const values = sides.map((i) => m[i]);
    const same = values.every((v) => v === values[0]);
    const auto = same && values[0] === "auto";
    return (
      <NumberField
        name={name}
        label={label}
        icon={icon}
        value={!same ? "" : auto ? "Auto" : fmt(values[0])}
        placeholder="Mixed"
        onCommit={(raw) => {
          if (/^\s*auto\s*$/i.test(raw)) return write(sides, "auto");
          const v = parseLength(raw);
          if (v !== null) write(sides, v);
        }}
        unit={
          <NativeSelect
            bare
            name={name + "Unit"}
            label={label + " unit"}
            value={auto ? "auto" : "px"}
            options={[
              { value: "px", label: "px" },
              { value: "auto", label: "Auto" },
            ]}
            onChange={(unit) => write(sides, unit === "auto" ? "auto" : 0)}
          />
        }
      />
    );
  };
  return (
    <Caption label="Margin">
      <Row
        tool={
          <IconButton
            icon={MarginSidesIcon}
            label="Independent margins"
            active={split}
            aria-pressed={split}
            onClick={() => setSplit(!split)}
          />
        }
      >
        {split ? (
          <>
            {field("marginLeft", "Left margin", MarginLeftIcon, [3])}
            {field("marginTop", "Top margin", MarginTopIcon, [0])}
            {field("marginRight", "Right margin", MarginRightIcon, [1])}
            {field("marginBottom", "Bottom margin", MarginBottomIcon, [2])}
          </>
        ) : (
          <>
            {field("marginX", "Horizontal margin", MarginXIcon, [1, 3])}
            {field("marginY", "Vertical margin", MarginYIcon, [0, 2])}
          </>
        )}
      </Row>
    </Caption>
  );
}

/* ---------- Section ---------- */
export function LayoutSection(props: Props) {
  const { doc, node, selection } = props;
  const parent = parentOf(doc, node);
  const frame = node.type === "frame";
  const layout = node.layout === "inline" ? "block" : node.layout;
  const flow = frame && node.layout !== "free";
  const inFlow = isFlow(parent) && node.position !== "absolute";
  return (
    <Section
      id="layout-section"
      title="Layout"
      tools={
        frame ? (
          <IconButton
            icon={GitCommitHorizontal}
            label={flow ? "Remove auto layout" : "Add auto layout"}
            active={flow}
            onClick={() => setField(selection, node, "layout", flow ? "free" : "flex")}
          />
        ) : null
      }
    >
      {frame ? (
        <Caption label="Display">
          <Segmented
            label="Display"
            hook="insp-display"
            dataKey="layout"
            value={layout}
            onChange={(value) => setField(selection, node, "layout", value)}
            items={DISPLAY(node.direction)}
          />
        </Caption>
      ) : null}
      <Row tool={<SizeMenu {...props} parent={parent} />}>
        <SizeField {...props} parent={parent} axis="w" />
        <SizeField {...props} parent={parent} axis="h" />
      </Row>
      <LimitRows {...props} />
      {frame && node.layout === "flex" ? <FlexGroup {...props} /> : null}
      {frame && node.layout === "grid" ? <GridGroup {...props} /> : null}
      {frame && node.layout === "block" ? <BlockGroup {...props} /> : null}
      {inFlow && parent?.layout === "grid" ? <GridChild {...props} /> : null}
      {/* Sibling keys must differ: a shared key makes React keep stale copies when the groups above change. */}
      {flow ? <PaddingGroup key={"padding-" + node.id} {...props} /> : null}
      {inFlow ? <MarginGroup key={"margin-" + node.id} {...props} /> : null}
    </Section>
  );
}
