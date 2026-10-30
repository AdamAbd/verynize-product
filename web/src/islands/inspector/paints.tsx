// Paint stack for Background Fill and Text Fill (design/wonder/2026-10-30 05–07, 23–26): several paints per
// layer (top paint first), each Solid, Linear, Radial or Conic gradient, or Image, with per-paint opacity and
// visibility. Solid colours and gradient stops bind to colour variables; detaching keeps the resolved colour.
// A stack of one visible solid paint is stored as the layer's plain `color`/`token` (older documents keep
// that shape); anything else is stored in `fills` (see web/node-style.js for rendering and validation).
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  Diamond,
  Eye,
  EyeOff,
  ImageIcon,
  Minus,
  Plus,
  RotateCw,
  Unlink,
  X,
} from "lucide-react";
import { ShaderIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorPicker, ColorPopover } from "./color-picker";
import { alphaPercent, parseColor, toHex, withAlpha } from "./color";
import { Field, IconButton, NativeSelect, Swatch } from "./controls";
import { VariableChip } from "./bind";
import { notify } from "./legacy";
import { HEX, hexLabel, pageNodes, parseHex, patchNodes, setField, type Node } from "./model";

export type Stop = { position: number; color: string; token?: string };
export type Paint = {
  type: "solid" | "linear" | "radial" | "conic" | "image";
  color?: string;
  token?: string;
  opacity?: number;
  hidden?: boolean;
  angle?: number;
  stops?: Stop[];
  src?: string;
  fit?: "fill" | "cover" | "contain" | "none";
  imageWidth?: number;
  imageHeight?: number;
};
type Tokens = Record<string, string>;
type PaintNode = Node & { fills?: Paint[] };

const TYPES: { value: Paint["type"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
  { value: "conic", label: "Conic" },
  { value: "image", label: "Image" },
];
const FITS: { value: NonNullable<Paint["fit"]>; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "none", label: "None" },
];
const isGradient = (p: Paint) => p.type === "linear" || p.type === "radial" || p.type === "conic";
const typeLabel = (p: Paint) => TYPES.find((t) => t.value === p.type)?.label ?? p.type;

type Css = {
  paintColor(hex: string, opacity?: number): string;
  fillsCss(n: { fills: Paint[] }, tokens: Tokens): { layers: { image: string }[] } | null;
};
const css = () => (window as unknown as { BetterNodeStyle: Css }).BetterNodeStyle;

/** The paints a layer shows, top first. Older layers have one solid paint from `color`/`token`. */
export function paintsOf(node: Node): Paint[] {
  const fills = (node as PaintNode).fills;
  if (Array.isArray(fills)) return structuredClone(fills);
  if (!HEX.test(node.color)) return [];
  return [{ type: "solid", color: node.color, ...(node.token ? { token: node.token } : {}) }];
}
const resolved = (c: { color?: string; token?: string }, tokens: Tokens) =>
  (c.token && tokens[c.token]) || c.color || "#000000";

/** Node patch for a stack: one plain visible solid paint collapses back into `color`/`token`. */
function stackPatch(node: Node, paints: Paint[], tokens: Tokens): Record<string, unknown> {
  const [only] = paints;
  // Removing the last paint leaves no fill at all: no stale `color` for readers that ignore `fills`.
  if (!paints.length) return { fills: undefined, color: "transparent", token: "" };
  if (
    paints.length === 1 &&
    only.type === "solid" &&
    !only.hidden &&
    (only.opacity ?? 100) === 100 &&
    HEX.test(only.color ?? "")
  )
    return { fills: undefined, color: only.color, token: only.token ?? "" };
  // Readers that ignore `fills` (codec class names, shader colour) see the top visible colour.
  const top = paints.find((p) => !p.hidden && (p.type === "solid" || isGradient(p)));
  const color = top
    ? top.type === "solid"
      ? resolved(top, tokens)
      : resolved(top.stops![0], tokens)
    : node.color;
  return { fills: paints, color: HEX.test(color) ? color : node.color, token: "" };
}

/** Apply a stack edit to every selected layer (each from its own paints): one validated undo step. */
export function editPaints(
  selection: string[],
  edit: (paints: Paint[], node: Node) => Paint[] | null,
) {
  const tokens = window.design.getDocument().tokens ?? {};
  patchNodes(selection, (node) => {
    if (node.type === "shader") return {};
    const next = edit(paintsOf(node), node);
    return next ? stackPatch(node, next, tokens) : {};
  });
}
const at = (i: number, fn: (p: Paint) => Paint | null) => (paints: Paint[]) =>
  paints[i] ? (paints.map((p, j) => (j === i ? fn(p) : p)).filter(Boolean) as Paint[]) : null;

/** Detach every colour variable of a paint, keeping the resolved colour. */
function detachPaint(p: Paint, tokens: Tokens): Paint {
  const free = <T extends { color?: string; token?: string }>(c: T): T => {
    const rest = { ...c };
    delete rest.token;
    return { ...rest, color: resolved(c, tokens) } as T;
  };
  return p.type === "solid" ? free(p) : p.stops ? { ...p, stops: p.stops.map(free) } : p;
}
export const paintBound = (p: Paint) => !!p.token || !!p.stops?.some((s) => !!s.token);

/** Convert a paint to another type, keeping its colours. */
function convert(p: Paint, type: Paint["type"], tokens: Tokens): Paint {
  const base = {
    ...(p.hidden ? { hidden: true } : {}),
    ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
  };
  if (type === "solid") {
    const c = p.type === "solid" ? p : p.stops?.[0];
    return { ...base, type, color: c?.color ?? "#d9d9d9", ...(c?.token ? { token: c.token } : {}) };
  }
  if (type === "image") return { ...base, type, src: p.src, fit: p.fit ?? "fill" };
  const stops: Stop[] = p.stops
    ? p.stops
    : [
        {
          position: 0,
          color: p.type === "solid" ? (p.color ?? "#d9d9d9") : "#d9d9d9",
          ...(p.token ? { token: p.token } : {}),
        },
        { position: 100, color: invertish(resolved(p, tokens)) },
      ];
  return {
    ...base,
    type,
    stops,
    ...(type !== "radial" ? { angle: p.angle ?? (type === "linear" ? 180 : 0) } : {}),
  };
}
/** A second stop that contrasts with the first. */
function invertish(hex: string) {
  const c = parseColor(hex);
  if (!c) return "#ffffff";
  const light = (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 128;
  return light ? "#172033" : "#f8fafc";
}

/** Live canvas preview while dragging in the colour picker (committed on release through updateNodes). */
function previewSolid(nodes: Node[], color: string) {
  for (const n of nodes) {
    const el = document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(n.id)}"]`);
    if (!el) continue;
    if (n.type === "text") el.style.color = color;
    else el.style.backgroundColor = color;
  }
}

/** Read an image file as an embedded data URL plus its natural size. */
async function readImage(file: File) {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type))
    throw Error("Choose a PNG, JPEG, WebP, GIF or SVG image");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("Unable to read the image"));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(Error("Unable to decode the image"));
    image.src = src;
  });
  return { src, imageWidth: image.naturalWidth || 1, imageHeight: image.naturalHeight || 1 };
}
function pickImage(onPick: (image: Awaited<ReturnType<typeof readImage>>) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      onPick(await readImage(file));
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  input.click();
}

/** Swatch preview of a paint (gradients and images included). */
function paintPreview(p: Paint, tokens: Tokens) {
  if (p.type === "solid") return css().paintColor(resolved(p, tokens), 100);
  const layer = css().fillsCss({ fills: [{ ...p, hidden: false, opacity: 100 }] }, tokens)
    ?.layers[0];
  return p.type === "image"
    ? `${layer?.image ?? "none"} center / cover no-repeat`
    : (layer?.image ?? "transparent");
}

/* ---------- Header tools: Apply variable + Add paint ---------- */
export function FillTools({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const tokens = Object.entries(doc.tokens ?? {});
  const paints = paintsOf(node);
  const solidIndex = paints.findIndex((p) => p.type === "solid");
  const bound = (node as PaintNode).fills ? paints.some(paintBound) : !!node.token;
  const boundName = (node as PaintNode).fills ? paints[solidIndex]?.token : node.token;
  const apply = (name: string) => {
    if (!(node as PaintNode).fills) return void setField(selection, node, "token", name);
    editPaints(selection, (ps) => {
      const i = ps.findIndex((p) => p.type === "solid");
      const color = doc.tokens[name];
      return i < 0
        ? [{ type: "solid", color, token: name }, ...ps]
        : at(i, (p) => ({ ...p, color, token: name }))(ps);
    });
  };
  const detach = () => {
    const colors = window.design.getDocument().tokens ?? {};
    patchNodes(selection, (n) =>
      (n as PaintNode).fills
        ? stackPatch(
            n,
            paintsOf(n).map((p) => detachPaint(p, colors)),
            colors,
          )
        : { color: colors[n.token] ?? n.color, token: "" },
    );
  };
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton icon={ShaderIcon} label="Apply variable" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-48">
          <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
            <Diamond className="size-3.5" aria-hidden />
            Apply variable
          </div>
          <DropdownMenuSeparator />
          {tokens.map(([name, color]) => (
            <DropdownMenuItem key={name} onSelect={() => apply(name)}>
              <Swatch color={color} className="size-3.5" />
              <span className="flex-1 truncate">{name}</span>
              {boundName === name ? <Check className="size-3.5" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
          {!tokens.length ? (
            <DropdownMenuItem disabled>No colour variables yet</DropdownMenuItem>
          ) : null}
          {bound ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={detach}>Detach variable</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {node.type !== "shader" ? (
        <IconButton
          icon={Plus}
          label="Add paint"
          onClick={() =>
            editPaints(selection, (ps, n) => [
              { type: "solid", color: n.type === "text" ? "#25252e" : "#d9d9d9" },
              ...ps,
            ])
          }
        />
      ) : null}
    </div>
  );
}

/* ---------- Stack ---------- */
export function PaintStack({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const paints = paintsOf(node);
  // Shader layers keep one colour (it drives the shader); the stack applies to boxes and text.
  if (node.type === "shader")
    return (
      <SolidRow doc={doc} node={node} selection={selection} paints={paints} index={0} legacy />
    );
  if (!paints.length)
    return <p className="text-2xs text-subtle-foreground">No paints. Add one with +.</p>;
  return (
    <div className="flex flex-col gap-1" data-paint-stack={paints.length}>
      {paints.map((p, i) =>
        p.type === "solid" ? (
          <SolidRow key={i} doc={doc} node={node} selection={selection} paints={paints} index={i} />
        ) : (
          <PaintRow key={i} doc={doc} node={node} selection={selection} paints={paints} index={i} />
        ),
      )}
    </div>
  );
}

type RowProps = {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  paints: Paint[];
  index: number;
  legacy?: boolean;
};

/** Visibility, reorder and remove buttons shared by every row. */
function RowTools({ selection, paints, index }: Omit<RowProps, "doc" | "node">) {
  const p = paints[index];
  return (
    <>
      <IconButton
        icon={p.hidden ? EyeOff : Eye}
        label={p.hidden ? "Show paint" : "Hide paint"}
        data-paint-visibility={index}
        onClick={() =>
          editPaints(
            selection,
            at(index, (q) => ({ ...q, hidden: !q.hidden || undefined })),
          )
        }
      />
      <IconButton
        icon={Minus}
        label="Remove paint"
        data-paint-remove={index}
        onClick={() =>
          editPaints(
            selection,
            at(index, () => null),
          )
        }
      />
    </>
  );
}

/** Move a paint up (towards the top) or down the stack. */
const move = (index: number, by: number) => (paints: Paint[]) => {
  const to = index + by;
  if (to < 0 || to >= paints.length) return null;
  const next = [...paints];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};
function MoveTools({ selection, paints, index }: Omit<RowProps, "doc" | "node">) {
  if (paints.length < 2) return null;
  return (
    <div className="flex items-center">
      <IconButton
        icon={ArrowUp}
        label="Move paint up"
        disabled={index === 0}
        onClick={() => editPaints(selection, move(index, -1))}
      />
      <IconButton
        icon={ArrowDown}
        label="Move paint down"
        disabled={index === paints.length - 1}
        onClick={() => editPaints(selection, move(index, 1))}
      />
    </div>
  );
}

const rowBox =
  "flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring";

/** A solid paint: hex (or bound variable), opacity, picker with Custom/Variables. */
function SolidRow({ doc, node, selection, paints, index, legacy }: RowProps) {
  const [open, setOpen] = useState(false);
  const p = paints[index] ?? { type: "solid", color: node.color, token: node.token };
  const tokens = doc.tokens ?? {};
  const stacked = !!(node as PaintNode).fills;
  const color = resolved(p, tokens);
  const first = index === 0;
  const selected = pageNodes(doc).filter((n) => selection.includes(n.id));
  const setPaint = (fn: (q: Paint) => Paint) =>
    legacy
      ? patchNodes(selection, () => {
          const next = fn(p);
          return { color: next.color, token: next.token ?? "" };
        })
      : editPaints(selection, at(index, fn));
  const commit = (next: string) => setPaint((q) => ({ ...q, color: next, token: undefined }));
  const bind = (name: string) =>
    setPaint((q) => ({ ...q, color: tokens[name] ?? q.color, token: name }));
  // Opacity of an unbound solid is its colour alpha (as before); a bound colour keeps the variable and uses
  // the paint opacity instead.
  const opacity = p.token ? (p.opacity ?? 100) : alphaPercent(color);
  return (
    <div className="flex items-center gap-1" data-paint={index} data-paint-type="solid">
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onPreview={
          stacked || paints.length > 1 ? undefined : (next) => previewSolid(selected, next)
        }
        onCommit={commit}
        tokens={tokens}
        token={p.token}
        onToken={bind}
        header={
          legacy ? undefined : (
            <PaintHeader
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
            />
          )
        }
      >
        <div data-color-anchor className={rowBox}>
          <button
            type="button"
            name={first ? "color" : undefined}
            aria-label={first ? "Fill colour" : `Paint ${index + 1} colour`}
            aria-expanded={open}
            title="Pick colour"
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(!open)}
          >
            <Swatch color={color} />
          </button>
          {p.token ? (
            <button
              type="button"
              data-paint-token={p.token}
              aria-label={`${first ? "Fill" : `Paint ${index + 1}`} variable ${p.token}`}
              title={
                tokens[p.token]
                  ? `${p.token} = ${tokens[p.token]}`
                  : `${p.token} (missing variable)`
              }
              className="-ml-px flex h-5 min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <VariableChip name={p.token} missing={!tokens[p.token]} />
            </button>
          ) : (
            <Field
              label={first ? "Fill hex colour" : `Paint ${index + 1} hex colour`}
              value={hexLabel(p.color ?? "")}
              placeholder={HEX.test(p.color ?? "") ? "" : p.color}
              className="h-5 flex-1 bg-transparent px-0 shadow-none focus-within:ring-0"
              inputClassName="uppercase"
              onCommit={(value) => {
                const hex =
                  parseHex(value, p.color) ??
                  (parseColor(value) ? toHex(parseColor(value)!) : null);
                if (!hex) return "Use a hex colour such as A58BDD";
                commit(hex);
              }}
            />
          )}
          {/* Wonder hides the percentage of a bound colour (05, 06, 35); a translucent bound paint keeps it. */}
          {p.token && (legacy || opacity === 100) ? null : (
            <Field
              label={first ? "Fill opacity" : `Paint ${index + 1} opacity`}
              numeric
              value={String(opacity)}
              className="h-5 w-12 shrink-0 bg-transparent px-0 shadow-none focus-within:ring-0"
              inputClassName="text-right"
              suffix="%"
              onCommit={(value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return "Enter a percentage";
                const pct = Math.max(0, Math.min(100, n));
                if (p.token)
                  return void setPaint((q) => ({ ...q, opacity: pct === 100 ? undefined : pct }));
                const next = withAlpha(p.color ?? color, pct);
                if (!next) return "Enter a percentage";
                commit(next);
              }}
            />
          )}
        </div>
      </ColorPopover>
      {legacy ? null : <RowTools selection={selection} paints={paints} index={index} />}
    </div>
  );
}

/** Gradient or image paint row: preview swatch + type label opening the paint editor, opacity, tools. */
function PaintRow({ doc, node, selection, paints, index }: RowProps) {
  const [open, setOpen] = useState(false);
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  const label =
    p.type === "image"
      ? `Image · ${FITS.find((f) => f.value === (p.fit ?? "fill"))?.label}`
      : typeLabel(p);
  return (
    <div className="flex items-center gap-1" data-paint={index} data-paint-type={p.type}>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor asChild>
          <div data-color-anchor className={rowBox}>
            <button
              type="button"
              name={index === 0 ? "color" : undefined}
              aria-label={`Edit ${typeLabel(p).toLowerCase()} paint`}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <Swatch color={paintPreview(p, tokens)} />
              <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
            </button>
            <Field
              label={index === 0 ? "Fill opacity" : `Paint ${index + 1} opacity`}
              numeric
              value={String(p.opacity ?? 100)}
              className="h-5 w-12 shrink-0 bg-transparent px-0 shadow-none focus-within:ring-0"
              inputClassName="text-right"
              suffix="%"
              onCommit={(value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return "Enter a percentage";
                const pct = Math.max(0, Math.min(100, n));
                editPaints(
                  selection,
                  at(index, (q) => ({ ...q, opacity: pct === 100 ? undefined : pct })),
                );
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          id="color-dialog"
          side="left"
          align="start"
          sideOffset={16}
          collisionPadding={8}
          className="w-72"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if ((event.target as HTMLElement | null)?.closest?.("[data-color-anchor]"))
              event.preventDefault();
          }}
        >
          {p.type === "image" ? (
            <ImageEditor
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
              onClose={() => setOpen(false)}
            />
          ) : (
            <GradientEditor
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
              onClose={() => setOpen(false)}
            />
          )}
        </PopoverContent>
      </Popover>
      <RowTools selection={selection} paints={paints} index={index} />
    </div>
  );
}

/** Paint type switch and reorder buttons at the top of every paint editor. */
function PaintHeader({ doc, selection, paints, index }: RowProps) {
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  return (
    <div className="flex items-center gap-1">
      <NativeSelect
        id="paint-type"
        label="Paint type"
        value={p.type}
        className="flex-1"
        options={TYPES}
        onChange={(value) => {
          const type = value as Paint["type"];
          if (type === "image" && !p.src)
            return pickImage((image) =>
              editPaints(
                selection,
                at(index, (q) => ({ ...convert(q, "image", tokens), ...image })),
              ),
            );
          editPaints(
            selection,
            at(index, (q) => convert(q, type, tokens)),
          );
        }}
      />
      <MoveTools selection={selection} paints={paints} index={index} />
    </div>
  );
}

/** Dynamic style through a ref (lint forbids inline style props in islands). */
function useRefStyle<T extends HTMLElement>(style: Partial<CSSStyleDeclaration>) {
  const ref = useRef<T>(null);
  const key = JSON.stringify(style);
  useLayoutEffect(() => {
    if (ref.current) Object.assign(ref.current.style, style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

function StopMarker({
  stop,
  active,
  index,
  color,
  onSelect,
  onDrag,
}: {
  stop: Stop;
  active: boolean;
  index: number;
  color: string;
  onSelect: () => void;
  onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const ref = useRefStyle<HTMLButtonElement>({ left: `calc(${stop.position}% - 6px)` });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Stop ${index + 1} at ${stop.position}%`}
      aria-pressed={active}
      data-stop={index}
      className="absolute top-0 flex size-3 touch-none items-center justify-center rounded-full ring-2 ring-primary-foreground shadow-menu aria-pressed:ring-ring"
      onClick={onSelect}
      onPointerDown={onDrag}
    >
      <Swatch color={color} className="size-2.5 rounded-full ring-0" />
    </button>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Gradient editor: preview bar with draggable stops, angle, add/remove/reverse stops, stop colour + variable. */
function GradientEditor({
  doc,
  node,
  selection,
  paints,
  index,
  onClose,
}: RowProps & { onClose: () => void }) {
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  const stops = p.stops ?? [];
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, stops.length - 1);
  const stop = stops[current];
  const bar = useRefStyle<HTMLDivElement>({
    background: paintPreview({ ...p, type: "linear", angle: 90 }, tokens),
  });
  const [drag, setDrag] = useState<{ i: number; position: number } | null>(null);
  const shown = drag
    ? stops.map((s, i) => (i === drag.i ? { ...s, position: drag.position } : s))
    : stops;
  const setStops = (fn: (s: Stop[]) => Stop[]) =>
    editPaints(
      selection,
      at(index, (q) => (q.stops ? { ...q, stops: fn(q.stops) } : q)),
    );
  const setStop = (i: number, fn: (s: Stop) => Stop) =>
    setStops((s) => s.map((x, j) => (j === i ? fn(x) : x)));
  const startDrag = (i: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const track = event.currentTarget.parentElement!;
    const r = track.getBoundingClientRect();
    const pos = (x: number) => round(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
    let last: number | null = null;
    const moveTo = (e: PointerEvent) => {
      last = pos(e.clientX);
      setDrag({ i, position: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (last !== null) setStop(i, (s) => ({ ...s, position: last! }));
    };
    setSelected(i);
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
  };
  const addStop = () => {
    // Midway between the selected stop and its neighbour, in the selected stop's colour.
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const k = sorted.indexOf(stop);
    const next = sorted[k + 1] ?? sorted[k - 1];
    const position = round(next ? (stop.position + next.position) / 2 : 50);
    setStops((s) => [...s, { position, color: resolved(stop, tokens) }]);
    setSelected(stops.length);
  };
  const header = (
    <div className="flex flex-col gap-2">
      <PaintHeader doc={doc} node={node} selection={selection} paints={paints} index={index} />
      <div className="relative h-3 px-1.5">
        <div ref={bar} aria-hidden className="h-3 rounded-sm ring-1 ring-card" />
        <div className="absolute inset-x-1.5 top-0 h-3">
          {shown.map((s, i) => (
            <StopMarker
              key={i}
              stop={s}
              index={i}
              active={i === current}
              color={resolved(s, tokens)}
              onSelect={() => setSelected(i)}
              onDrag={startDrag(i)}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {p.type !== "radial" ? (
          <Field
            label="Gradient angle"
            numeric
            value={String(p.angle ?? (p.type === "linear" ? 180 : 0))}
            suffix="°"
            className="w-20"
            onCommit={(value) => {
              const n = Number(value);
              if (!Number.isFinite(n)) return "Enter degrees";
              editPaints(
                selection,
                at(index, (q) => ({ ...q, angle: ((n % 360) + 360) % 360 })),
              );
            }}
          />
        ) : null}
        <span className="flex-1" />
        {p.type !== "radial" ? (
          <IconButton
            icon={RotateCw}
            label="Rotate gradient 90°"
            onClick={() =>
              editPaints(
                selection,
                at(index, (q) => ({
                  ...q,
                  angle: ((q.angle ?? (q.type === "linear" ? 180 : 0)) + 90) % 360,
                })),
              )
            }
          />
        ) : null}
        <IconButton
          icon={ArrowLeftRight}
          label="Reverse gradient stops"
          onClick={() =>
            setStops((s) => s.map((x) => ({ ...x, position: round(100 - x.position) })))
          }
        />
        <IconButton icon={Plus} label="Add stop" disabled={stops.length >= 16} onClick={addStop} />
      </div>
      <div className="flex flex-col gap-1" role="list" aria-label="Gradient stops">
        {stops.map((s, i) => (
          <div key={i} role="listitem" className="flex items-center gap-1" data-stop-row={i}>
            <button
              type="button"
              aria-label={`Select stop ${i + 1}`}
              aria-pressed={i === current}
              className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input px-2 text-xs text-foreground shadow-field aria-pressed:ring-1 aria-pressed:ring-ring"
              onClick={() => setSelected(i)}
            >
              <Swatch color={resolved(s, tokens)} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left">
                {s.token ?? hexLabel(s.color)}
              </span>
            </button>
            <Field
              label={`Stop ${i + 1} position`}
              numeric
              value={String(s.position)}
              suffix="%"
              className="w-16"
              onCommit={(value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return "Enter a percentage";
                setStop(i, (x) => ({ ...x, position: round(Math.max(0, Math.min(100, n))) }));
              }}
            />
            {s.token ? (
              <IconButton
                icon={Unlink}
                label={`Detach stop ${i + 1} variable`}
                onClick={() =>
                  setStop(i, (x) => ({ position: x.position, color: resolved(x, tokens) }))
                }
              />
            ) : null}
            <IconButton
              icon={Minus}
              label={`Remove stop ${i + 1}`}
              disabled={stops.length <= 2}
              onClick={() => {
                setStops((x) => x.filter((_, j) => j !== i));
                setSelected(0);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
  if (!stop) return null;
  return (
    <ColorPicker
      key={current}
      title={`${typeLabel(p)} gradient`}
      header={header}
      value={resolved(stop, tokens)}
      onCommit={(color) => setStop(current, (s) => ({ position: s.position, color }))}
      tokens={tokens}
      token={stop.token}
      onToken={(name) =>
        setStop(current, (s) => ({ ...s, color: tokens[name] ?? s.color, token: name }))
      }
      onClose={onClose}
    />
  );
}

/** Image paint: preview, replace, fit (Fill / Cover / Contain / None). */
function ImageEditor({
  doc,
  node,
  selection,
  paints,
  index,
  onClose,
}: RowProps & { onClose: () => void }) {
  const p = paints[index];
  const preview = useRefStyle<HTMLDivElement>({ background: paintPreview(p, doc.tokens ?? {}) });
  return (
    <div className="flex flex-col gap-2">
      <div className="-mt-1 flex h-7 items-center justify-between">
        <strong className="text-xs font-normal text-foreground">Image</strong>
        <IconButton icon={X} label="Close paint editor" onClick={onClose} />
      </div>
      <PaintHeader doc={doc} node={node} selection={selection} paints={paints} index={index} />
      <div ref={preview} aria-hidden className="h-32 rounded-md ring-1 ring-card" />
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect
          id="paint-image-fit"
          label="Image fit"
          value={p.fit ?? "fill"}
          options={FITS}
          onChange={(value) =>
            editPaints(
              selection,
              at(index, (q) => ({ ...q, fit: value as Paint["fit"] })),
            )
          }
        />
        <button
          type="button"
          className="flex h-6 items-center justify-center gap-1 rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() =>
            pickImage((image) =>
              editPaints(
                selection,
                at(index, (q) => ({ ...q, ...image })),
              ),
            )
          }
        >
          <ImageIcon className="size-3.5" aria-hidden />
          Replace…
        </button>
      </div>
    </div>
  );
}
