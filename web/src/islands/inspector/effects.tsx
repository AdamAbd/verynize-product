// Effects inspector: blend mode menu, Outline section, border style, and the shared pieces used by the
// Shadow / Filters / Mask lists (shadows.tsx, filters.tsx, masks.tsx). Data model and CSS mapping live in
// web/node-style.js (effectsOf / validateEffects), so the canvas, HTML export and JSX codec agree.
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Check, Droplet, Eye, EyeOff, Minus, Unlink } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { type DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Affix,
  Caption,
  Field,
  IconButton,
  NativeSelect,
  OptionalSection,
  Swatch,
  useHookClass,
} from "./controls";
import { ColorPopover } from "./color-picker";
import { VariableChip } from "./bind";
import { alphaPercent, withAlpha } from "./color";
import { fmt, hexLabel, parseHex, patchNodes, type Node } from "./model";

/* ---------- Model ---------- */
export type ShadowType = "box" | "drop" | "text";
export type Shadow = {
  type: ShadowType;
  inset?: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  token?: string;
  hidden?: boolean;
};
export type FilterType =
  | "blur"
  | "brightness"
  | "contrast"
  | "grayscale"
  | "hueRotate"
  | "invert"
  | "saturate"
  | "sepia";
export type Filter = { type: FilterType; value: number; backdrop?: boolean; hidden?: boolean };
export type MaskType = "linear" | "radial" | "conic" | "image" | "custom";
export type Mask = {
  type: MaskType;
  rotation?: number;
  alpha?: number;
  invert?: boolean;
  hidden?: boolean;
  /** Image mask: embedded data URL. */
  src?: string;
  /** Custom mask: a CSS gradient. */
  css?: string;
  mode?: "auto" | "alpha" | "luminance";
  repeat?: string;
  x?: number;
  y?: number;
  size?: string;
  composite?: "add" | "subtract" | "intersect" | "exclude";
};
export type EffectNode = Node & {
  blendMode?: string;
  outlineWidth?: number;
  outlineOffset?: number;
  outlineColor?: string;
  outlineStyle?: string;
  outlineToken?: string;
  outlineHidden?: boolean;
  strokeStyle?: string;
  strokeHidden?: boolean;
  shadows?: Shadow[];
  filters?: Filter[];
  masks?: Mask[];
};
export type EffectProps = { doc: DesignDocument; node: Node; selection: string[] };
type ListKey = "shadows" | "filters" | "masks";

/** Read one of the effect lists of a layer (always an array). */
export function listOf<T>(node: Node, key: ListKey): T[] {
  const value = (node as EffectNode)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Replace an effect list on the selection from the primary layer's list (validated, one undo step). */
export function editList<T>(
  selection: string[],
  node: Node,
  key: ListKey,
  edit: (list: T[]) => T[],
) {
  const next = edit(listOf<T>(node, key).map((item) => ({ ...item })));
  patchNodes(selection, () => ({ [key]: next.length ? next : undefined }));
}

/** Parse a numeric draft; returns the clamped number or an error message. */
export function readNumber(raw: string, min = -Infinity, max = Infinity): number | string {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(value)) return "Enter a number.";
  return Math.min(max, Math.max(min, value));
}

/* ---------- Row tools (visibility + remove), as in Wonder's Fill/Shadow/Filter rows ---------- */
export function RowTools({
  label,
  hidden,
  onToggle,
  onRemove,
}: {
  label: string;
  hidden: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <IconButton
        icon={hidden ? EyeOff : Eye}
        label={(hidden ? "Show " : "Hide ") + label}
        data-effect-tool="visibility"
        onClick={onToggle}
      />
      <IconButton
        icon={Minus}
        label={"Remove " + label}
        data-effect-tool="remove"
        onClick={onRemove}
      />
    </>
  );
}

/* ---------- Colour field: swatch + hex + alpha, optional Colors variable binding ---------- */
export function EffectColorField({
  name,
  label,
  value,
  onCommit,
  tokens,
  token,
  onToken,
}: {
  name: string;
  label: string;
  value: string;
  onCommit: (color: string) => void;
  tokens?: Record<string, string>;
  token?: string;
  onToken?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const bound = token && tokens?.[token] ? tokens[token] : undefined;
  const color = bound ?? value;
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={color}
      onCommit={onCommit}
      tokens={tokens}
      token={token}
      onToken={onToken}
    >
      <div data-color-anchor className="flex min-w-0 flex-1 items-center gap-2">
        {bound && token ? (
          // Bound: swatch + variable chip, no hex or alpha (Wonder 05/13); the chip opens the Variables tab.
          <div
            data-bound-color={name}
            className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field"
          >
            <button
              type="button"
              aria-label={"Pick " + label.toLowerCase()}
              aria-expanded={open}
              className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <Swatch color={color} />
            </button>
            <button
              type="button"
              aria-label={`${label} variable ${token}`}
              title={`${token} = ${bound}`}
              className="-ml-px flex h-5 min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <VariableChip name={token} />
            </button>
          </div>
        ) : (
          <>
            <Field
              name={name}
              label={label}
              value={hexLabel(value)}
              inputClassName="uppercase"
              className="flex-1 pl-1"
              scrub={false}
              prefix={
                // 16px swatch 5px in, hex 26px in, as in a fill row (Wonder 16).
                <button
                  type="button"
                  aria-label={"Pick " + label.toLowerCase()}
                  aria-expanded={open}
                  className="flex size-4.5 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setOpen(!open)}
                >
                  <Swatch color={color} />
                </button>
              }
              onCommit={(raw) => {
                const hex = parseHex(raw, value);
                if (!hex) return "Use a hex colour such as A58BDD";
                onCommit(hex);
              }}
            />
            <Field
              name={name + "Alpha"}
              label={label + " opacity"}
              numeric
              value={String(alphaPercent(color))}
              className="w-16 shrink-0"
              inputClassName="text-right"
              suffix="%"
              onCommit={(raw) => {
                const next = withAlpha(value, Number(raw));
                if (!next || !Number.isFinite(Number(raw))) return "Enter a percentage";
                onCommit(next);
              }}
            />
          </>
        )}
        {bound ? (
          <IconButton
            icon={Unlink}
            label={`Detach ${label.toLowerCase()} variable`}
            data-detach-token={token}
            onClick={() => onCommit(bound)}
          />
        ) : null}
      </div>
    </ColorPopover>
  );
}

/* ---------- Blend mode (Appearance tool) ---------- */
// Wonder's order (design/wonder/2026-10-30/27): normal, darken group, lighten group, contrast group,
// difference group, component group.
export const BLEND_GROUPS: [string, string][][] = [
  [["normal", "Normal"]],
  [
    ["darken", "Darken"],
    ["multiply", "Multiply"],
    ["plus-darker", "Plus darker"],
    ["color-burn", "Color burn"],
  ],
  [
    ["lighten", "Lighten"],
    ["screen", "Screen"],
    ["plus-lighter", "Plus lighter"],
    ["color-dodge", "Color dodge"],
  ],
  [
    ["overlay", "Overlay"],
    ["soft-light", "Soft light"],
    ["hard-light", "Hard light"],
  ],
  [
    ["difference", "Difference"],
    ["exclusion", "Exclusion"],
  ],
  [
    ["hue", "Hue"],
    ["saturation", "Saturation"],
    ["color", "Color"],
    ["luminosity", "Luminosity"],
  ],
];

export function BlendMenu({ node, selection }: EffectProps) {
  const current = (node as EffectNode).blendMode || "normal";
  const label = BLEND_GROUPS.flat().find(([value]) => value === current)?.[1] ?? "Normal";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          id="blend-mode"
          icon={Droplet}
          label={`Blend mode: ${label}`}
          active={current !== "normal"}
          data-blend-mode={current}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-44">
        <DropdownMenuLabel>Blend mode</DropdownMenuLabel>
        {BLEND_GROUPS.map((group, index) => (
          <div key={group[0][0]} role="group">
            {index ? <DropdownMenuSeparator /> : null}
            {group.map(([value, text]) => (
              <DropdownMenuItem
                key={value}
                data-blend={value}
                onSelect={() =>
                  patchNodes(selection, () => ({
                    blendMode: value === "normal" ? undefined : value,
                  }))
                }
              >
                <span className="flex-1">{text}</span>
                {value === current ? <Check className="size-3.5" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Border style (Solid / Dashed / Dotted) ---------- */
const LINE_STYLES = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

export function BorderStyleSelect({ node, selection }: Omit<EffectProps, "doc">) {
  const value = (node as EffectNode).strokeStyle || "solid";
  return (
    <NativeSelect
      name="strokeStyle"
      label="Border style"
      value={LINE_STYLES.some((s) => s.value === value) ? value : "solid"}
      options={LINE_STYLES}
      className="flex-1"
      onChange={(next) =>
        patchNodes(selection, () => ({ strokeStyle: next === "solid" ? undefined : next }))
      }
    />
  );
}

/* ---------- Outline (a real CSS outline: width, offset, colour, style) ---------- */
export function OutlineSection({ doc, node, selection }: EffectProps) {
  const n = node as EffectNode;
  const width = typeof n.outlineWidth === "number" ? n.outlineWidth : 0;
  const hidden = n.outlineHidden === true;
  const color = n.outlineColor || "#000000";
  const patch = (values: Partial<EffectNode>) =>
    patchNodes(selection, (current) => {
      const c = current as EffectNode;
      return {
        outlineColor: c.outlineColor ?? color,
        outlineOffset: c.outlineOffset ?? n.outlineOffset ?? 0,
        ...values,
      };
    });
  const reset = {
    outlineWidth: undefined,
    outlineOffset: undefined,
    outlineColor: undefined,
    outlineStyle: undefined,
    outlineToken: undefined,
    outlineHidden: undefined,
  };
  const remove = () => patchNodes(selection, () => reset);
  return (
    <OptionalSection
      id="outline-section"
      title="Outline"
      present={width > 0}
      // Adding an outline starts at Wonder's default (1px #000000, offset 0) so the change is visible at
      // once; nothing from an earlier outline comes back.
      onAdd={() =>
        patchNodes(selection, () => ({
          ...reset,
          outlineWidth: 1,
          outlineOffset: 0,
          outlineColor: "#000000",
        }))
      }
    >
      <div className="flex items-end gap-2">
        <Caption label="Width" className="flex-1">
          <Field
            name="outlineWidth"
            label="Outline width"
            numeric
            value={fmt(width)}
            prefix={<Affix>W</Affix>}
            onCommit={(raw) => {
              const value = readNumber(raw, 0, 1000);
              if (typeof value === "string") return value;
              patch({ outlineWidth: value });
            }}
          />
        </Caption>
        <Caption label="Offset" className="flex-1">
          <Field
            name="outlineOffset"
            label="Outline offset"
            numeric
            value={fmt(n.outlineOffset ?? 0)}
            prefix={<Affix>O</Affix>}
            onCommit={(raw) => {
              const value = readNumber(raw, -1000, 1000);
              if (typeof value === "string") return value;
              patch({ outlineOffset: value, outlineWidth: Math.max(width, 1) });
            }}
          />
        </Caption>
        <IconButton
          icon={hidden ? EyeOff : Eye}
          label={hidden ? "Show outline" : "Hide outline"}
          data-effect-tool="visibility"
          onClick={() =>
            patchNodes(selection, () => ({ outlineHidden: hidden ? undefined : true }))
          }
        />
        <IconButton
          icon={Minus}
          label="Remove outline"
          data-effect-tool="remove"
          onClick={remove}
        />
      </div>
      <div className="flex items-center gap-2">
        <EffectColorField
          name="outlineColor"
          label="Outline colour"
          value={color}
          tokens={doc.tokens}
          token={n.outlineToken}
          onToken={(name) =>
            patch({
              outlineToken: name || undefined,
              outlineColor: doc.tokens?.[name] ?? color,
              outlineWidth: Math.max(width, 1),
            })
          }
          onCommit={(next) =>
            patch({ outlineColor: next, outlineToken: undefined, outlineWidth: Math.max(width, 1) })
          }
        />
      </div>
      <NativeSelect
        name="outlineStyle"
        label="Outline style"
        value={n.outlineStyle || "solid"}
        options={LINE_STYLES}
        onChange={(next) =>
          patch({
            outlineStyle: next === "solid" ? undefined : next,
            outlineWidth: Math.max(width, 1),
          })
        }
      />
    </OptionalSection>
  );
}

/** Section header tools: one `+` that appends a list item (Wonder's Shadow / Filters / Mask headers). */
export function ListSection({
  id,
  title,
  addLabel,
  onAdd,
  addMenu,
  children,
}: {
  id: string;
  title: string;
  addLabel: string;
  onAdd?: () => void;
  addMenu?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="border-b border-border">
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        {addMenu ?? <AddButton label={addLabel} onClick={onAdd} />}
      </div>
      {children ? <div className="flex flex-col gap-2 px-3 pt-1 pb-2.75">{children}</div> : null}
    </section>
  );
}

export function AddButton({ label, ref, ...props }: ComponentProps<"button"> & { label: string }) {
  const local = useRef<HTMLButtonElement | null>(null);
  useHookClass(local, "insp-add");
  return (
    <IconButton
      icon={PlusIcon}
      label={label}
      ref={(el) => {
        local.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      {...props}
    />
  );
}
