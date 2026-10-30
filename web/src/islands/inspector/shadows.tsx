// Shadow list (design/wonder/2026-10-30/16, validation/v07): any number of shadows per layer, each one
// Box (optionally inner), Drop (filter drop-shadow, follows the alpha of the content) or Text (text layers).
// Rows open an editor popover with X / Y / Blur / Spread and a colour that can bind to a Colors variable.
import { useState } from "react";
import { Square, SquareDashed, Type } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Affix, Caption, Field, Segmented } from "./controls";
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

const DEFAULT_SHADOW: Shadow = { type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#00000040" };

export function shadowLabel(shadow: Shadow) {
  if (shadow.type === "drop") return "Drop shadow";
  if (shadow.type === "text") return "Text shadow";
  return shadow.inset ? "Inner shadow" : "Box shadow";
}

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
    <ListSection id="shadow-section" title="Shadow" addLabel="Add shadow" onAdd={add}>
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
  const Icon = shadow.type === "text" ? Type : shadow.inset ? SquareDashed : Square;
  const types: { value: ShadowType; label: string; icon: typeof Square }[] = [
    { value: "box", label: "Box", icon: Square },
    { value: "drop", label: "Drop", icon: SquareDashed },
    ...(node.type === "text" ? [{ value: "text" as const, label: "Text", icon: Type }] : []),
  ];
  const number = (key: "x" | "y" | "blur" | "spread", min: number) => (raw: string) => {
    const value = readNumber(raw, min, 10000);
    if (typeof value === "string") return value;
    update({ [key]: value });
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <div
        className="flex items-center gap-2"
        data-shadow-row={index}
        data-shadow-type={shadow.type}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            data-shadow-edit={index}
            aria-expanded={open}
            className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input px-2 text-left text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[hidden=true]:text-muted-foreground"
            data-hidden={shadow.hidden === true}
            onClick={() => onOpenChange(!open)}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
        className="w-64"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("#color-dialog, [data-shadow-edit]")) event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-xs text-foreground">{label}</div>
          <Segmented
            label="Shadow type"
            value={shadow.type}
            items={types}
            dataKey="shadow-type"
            onChange={(type) =>
              update({ type: type as ShadowType, inset: type === "box" ? shadow.inset : undefined })
            }
          />
          <div className="grid grid-cols-2 gap-2">
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
              prefix={<Affix>B</Affix>}
              onCommit={number("blur", 0)}
            />
            {shadow.type === "box" ? (
              <Field
                name={`shadow-${index}-spread`}
                label="Shadow spread"
                numeric
                value={fmt(shadow.spread)}
                prefix={<Affix>S</Affix>}
                onCommit={number("spread", -10000)}
              />
            ) : null}
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
              onCommit={(color) => update({ color, token: undefined })}
            />
          </div>
          {shadow.type === "box" ? (
            <label className="flex h-6 items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name={`shadow-${index}-inset`}
                checked={shadow.inset === true}
                className="size-3.5 accent-primary"
                onChange={(event) => update({ inset: event.target.checked || undefined })}
              />
              Inner shadow
            </label>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
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
