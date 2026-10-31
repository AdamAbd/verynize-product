// Shadow list (design/wonder/2026-10-30/16, properties-audit A4): any number of shadows per layer, each one
// Box (optionally inner), Drop (filter drop-shadow, follows the alpha of the content) or Text (text layers).
// Rows open a 288px editor (wonder A4-shadow-editor): title + close, labelled Box / Drop segments, a live
// preview, one row of X / Y / blur / spread, the colour (bindable to a Colors variable) and "Inner shadow".
import { useLayoutEffect, useRef, useState } from "react";
import { Type, X } from "lucide-react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { BlurIcon, BoxShadowIcon, DropShadowIcon, SpreadIcon } from "@/components/icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { CheckField } from "./check-field";
import { Affix, Caption, Field, IconAffix, IconButton, type IconType } from "./controls";
import {
  EffectColorField,
  ListSection,
  RowTools,
  editList,
  listOf,
  readNumber,
  type EffectProps,
  type Shadow,
  type ShadowType,
} from "./effects";
import { fmt, setField } from "./model";

/** Wonder's new shadow: Box, X 0, Y 4, blur 4, spread 0, #000000 at 25 %. */
export const DEFAULT_SHADOW: Shadow = {
  type: "box",
  x: 0,
  y: 4,
  blur: 4,
  spread: 0,
  color: "#00000040",
};

export function shadowLabel(shadow: Shadow) {
  if (shadow.type === "drop") return "Drop Shadow";
  if (shadow.type === "text") return "Text Shadow";
  return shadow.inset ? "Inner Shadow" : "Box Shadow";
}

const shadowIcon = (shadow: Shadow): IconType =>
  shadow.type === "text" ? Type : shadow.type === "drop" ? DropShadowIcon : BoxShadowIcon;

export function ShadowSection({ doc, node, selection }: EffectProps) {
  const shadows = listOf<Shadow>(node, "shadows");
  const [editing, setEditing] = useState<number | null>(null);
  const edit = (fn: (list: Shadow[]) => Shadow[]) =>
    editList<Shadow>(selection, node, "shadows", fn);
  const add = () => {
    edit((list) => [...list, { ...DEFAULT_SHADOW }]);
    setEditing(shadows.length);
  };
  const hasBody = shadows.length > 0 || !!node.shadow;
  return (
    <ListSection
      id="shadow-section"
      title="Shadow"
      addLabel="Add shadow"
      onAdd={add}
      variant="rows"
    >
      {hasBody ? (
        <>
          {shadows.map((shadow, index) => (
            <ShadowRow
              key={index}
              doc={doc}
              node={node}
              index={index}
              shadow={shadow}
              open={editing === index}
              onOpenChange={(open) => setEditing(open ? index : null)}
              edit={edit}
            />
          ))}
          {node.shadow ? (
            <Caption label="Custom shadow (CSS)">
              <Field
                name="shadow"
                label="Box shadow (CSS)"
                value={node.shadow}
                placeholder="0 8px 24px #0003"
                onCommit={(value) => setField(selection, node, "shadow", value)}
              />
            </Caption>
          ) : null}
        </>
      ) : null}
    </ListSection>
  );
}

function ShadowRow({
  doc,
  node,
  index,
  shadow,
  open,
  onOpenChange,
  edit,
}: Omit<EffectProps, "selection"> & {
  index: number;
  shadow: Shadow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edit: (fn: (list: Shadow[]) => Shadow[]) => void;
}) {
  const update = (patch: Partial<Shadow>) =>
    edit((list) => list.map((item, i) => (i === index ? clean({ ...item, ...patch }) : item)));
  const label = shadowLabel(shadow);
  const Icon = shadowIcon(shadow);
  const types: { value: ShadowType; label: string; icon: IconType }[] = [
    { value: "box", label: "Box", icon: BoxShadowIcon },
    { value: "drop", label: "Drop", icon: DropShadowIcon },
    ...(node.type === "text" ? [{ value: "text" as const, label: "Text", icon: Type }] : []),
  ];
  const number = (key: "x" | "y" | "blur" | "spread", min: number) => (raw: string) => {
    const value = readNumber(raw, min, 10000);
    if (typeof value === "string") return value;
    update({ [key]: value });
  };
  const color =
    shadow.token && doc.tokens?.[shadow.token] ? doc.tokens[shadow.token] : shadow.color;
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      {/* While its editor is open the row becomes a full-width #2b2b2b band with a #363636 field. */}
      <div
        className="group/row -mx-3 -my-1 flex items-center gap-2 px-3 py-1 data-[open=true]:bg-input"
        data-shadow-row={index}
        data-shadow-type={shadow.type}
        data-open={open}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            data-shadow-edit={index}
            aria-expanded={open}
            className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input pr-2 pl-1.5 text-left text-xs text-foreground shadow-field group-data-[open=true]/row:bg-accent hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[hidden=true]:text-muted-foreground"
            data-hidden={shadow.hidden === true}
            onClick={() => onOpenChange(!open)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        </PopoverAnchor>
        <RowTools
          label={label.toLowerCase()}
          hidden={shadow.hidden === true}
          onToggle={() => update({ hidden: !shadow.hidden })}
          onRemove={() => {
            onOpenChange(false);
            edit((list) => list.filter((_, i) => i !== index));
          }}
        />
      </div>
      <PopoverContent
        id="shadow-editor"
        data-shadow-editor={index}
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-72"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("#color-dialog, [data-shadow-edit]")) event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="-mt-1 -mr-1.5 flex h-7 items-center justify-between gap-2">
            <h4 className="truncate text-sm text-foreground">{label}</h4>
            <IconButton
              icon={X}
              label="Close shadow editor"
              data-shadow-close
              onClick={() => onOpenChange(false)}
            />
          </div>
          <ToggleGroupPrimitive.Root
            type="single"
            aria-label="Shadow type"
            value={shadow.type}
            onValueChange={(type) => {
              if (!type) return;
              update({
                type: type as ShadowType,
                inset: type === "box" ? shadow.inset : undefined,
              });
            }}
            className="flex h-6 w-full items-stretch rounded-md bg-muted"
          >
            {types.map(({ value, label: text, icon: TypeIcon }) => (
              <ToggleGroupPrimitive.Item
                key={value}
                value={value}
                aria-label={text}
                data-shadow-type={value}
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md text-xs text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground"
              >
                <TypeIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{text}</span>
              </ToggleGroupPrimitive.Item>
            ))}
          </ToggleGroupPrimitive.Root>
          <ShadowPreview shadow={shadow} color={color} />
          <div className="grid grid-cols-4 gap-2">
            <Field
              name={`shadow-${index}-x`}
              label="Shadow X"
              numeric
              value={fmt(shadow.x)}
              prefix={<Affix>X</Affix>}
              onCommit={number("x", -10000)}
            />
            <Field
              name={`shadow-${index}-y`}
              label="Shadow Y"
              numeric
              value={fmt(shadow.y)}
              prefix={<Affix>Y</Affix>}
              onCommit={number("y", -10000)}
            />
            <Field
              name={`shadow-${index}-blur`}
              label="Shadow blur"
              numeric
              value={fmt(shadow.blur)}
              prefix={<IconAffix icon={BlurIcon} />}
              onCommit={number("blur", 0)}
            />
            {/* Drop and text shadows have no spread (CSS drop-shadow / text-shadow); the slot stays. */}
            <Field
              name={`shadow-${index}-spread`}
              label="Shadow spread"
              numeric
              disabled={shadow.type !== "box"}
              value={fmt(shadow.type === "box" ? shadow.spread : 0)}
              prefix={<IconAffix icon={SpreadIcon} />}
              onCommit={number("spread", -10000)}
            />
          </div>
          <div className="flex items-center gap-2">
            <EffectColorField
              name={`shadow-${index}-color`}
              label="Shadow colour"
              value={shadow.color}
              tokens={doc.tokens}
              token={shadow.token}
              onToken={(name) =>
                update({ token: name || undefined, color: doc.tokens?.[name] ?? shadow.color })
              }
              onCommit={(next) => update({ color: next, token: undefined })}
            />
          </div>
          {shadow.type === "box" ? (
            <CheckField
              name={`shadow-${index}-inset`}
              label="Inner shadow"
              checked={shadow.inset === true}
              onChange={(inset) => update({ inset: inset || undefined })}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Live preview well: a neutral sample card wearing the shadow (styles set through the DOM). */
function ShadowPreview({ shadow, color }: { shadow: Shadow; color: string }) {
  const sample = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const css = `${shadow.x}px ${shadow.y}px ${shadow.blur}px`;
  useLayoutEffect(() => {
    const el = sample.current;
    if (!el) return;
    el.style.boxShadow =
      shadow.type === "box"
        ? `${shadow.inset ? "inset " : ""}${css} ${shadow.spread}px ${color}`
        : "";
    el.style.filter = shadow.type === "drop" ? `drop-shadow(${css} ${color})` : "";
    if (text.current)
      text.current.style.textShadow = shadow.type === "text" ? `${css} ${color}` : "";
  }, [shadow.type, shadow.inset, shadow.spread, css, color]);
  return (
    <div
      data-shadow-preview
      aria-hidden
      className="flex h-35 items-center justify-center rounded-md border border-card-border bg-background"
    >
      {shadow.type === "text" ? (
        <span ref={text} className="text-xl text-foreground">
          Aa
        </span>
      ) : (
        <div ref={sample} className="h-18 w-10 rounded-sm bg-foreground-3" />
      )}
    </div>
  );
}

/** Drop keys that are undefined/false so stored shadows stay minimal (and validate). */
function clean(shadow: Shadow): Shadow {
  const out = { ...shadow };
  if (out.type !== "box" || !out.inset) delete out.inset;
  if (!out.hidden) delete out.hidden;
  if (!out.token) delete out.token;
  if (out.type !== "box") out.spread = 0;
  return out;
}
