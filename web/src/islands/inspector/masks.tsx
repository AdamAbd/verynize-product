// Gradient masks (design/wonder/2026-10-30/18–21, validation/v09): Linear / Radial / Conic fades with alpha,
// rotation, invert and visibility. Several masks stack as mask-image layers. A free-form CSS mask stays
// available underneath for gradients the structured editor does not describe.
import { useState } from "react";
import { Circle, CircleDot, Columns2 } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Affix, Caption, Field, Segmented } from "./controls";
import {
  ListSection,
  RowTools,
  editList,
  listOf,
  readNumber,
  type EffectProps,
  type Mask,
  type MaskType,
} from "./effects";
import { fmt, setField } from "./model";

const MASK_LABEL: Record<MaskType, string> = { linear: "Linear", radial: "Radial", conic: "Conic" };
const MASK_ICON = { linear: Columns2, radial: Circle, conic: CircleDot };

export function MaskSection({ node, selection }: EffectProps) {
  const masks = listOf<Mask>(node, "masks");
  const [editing, setEditing] = useState<number | null>(null);
  const edit = (fn: (list: Mask[]) => Mask[]) => editList<Mask>(selection, node, "masks", fn);
  const [custom, setCustom] = useState(false);
  const showCustom = custom || masks.length > 0 || !!node.mask;
  return (
    <ListSection
      id="mask-section"
      title="Mask"
      addLabel="Add mask"
      onAdd={() => {
        edit((list) => [...list, { type: "linear", rotation: 180, alpha: 100 }]);
        setEditing(masks.length);
        setCustom(true);
      }}
    >
      {showCustom ? (
        <>
          {masks.map((mask, index) => (
            <MaskRow
              key={index}
              index={index}
              mask={mask}
              open={editing === index}
              onOpenChange={(open) => setEditing(open ? index : null)}
              edit={edit}
            />
          ))}
          <Caption label="Custom mask (CSS)">
            <Field
              name="mask"
              label="Mask gradient (CSS)"
              value={node.mask}
              placeholder="linear-gradient(black, transparent)"
              onCommit={(value) => setField(selection, node, "mask", value)}
            />
          </Caption>
        </>
      ) : null}
    </ListSection>
  );
}

function MaskRow({
  index,
  mask,
  open,
  onOpenChange,
  edit,
}: {
  index: number;
  mask: Mask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edit: (fn: (list: Mask[]) => Mask[]) => void;
}) {
  const update = (patch: Partial<Mask>) =>
    edit((list) =>
      list.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (!next.invert) delete next.invert;
        if (!next.hidden) delete next.hidden;
        return next;
      }),
    );
  const label = MASK_LABEL[mask.type] ?? "Linear";
  const Icon = MASK_ICON[mask.type] ?? Columns2;
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <div className="flex items-center gap-2" data-mask-row={index} data-mask-type={mask.type}>
        <PopoverAnchor asChild>
          <button
            type="button"
            data-mask-edit={index}
            aria-expanded={open}
            data-hidden={mask.hidden === true}
            className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input px-2 text-left text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[hidden=true]:text-muted-foreground"
            onClick={() => onOpenChange(!open)}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        </PopoverAnchor>
        <RowTools
          label={label.toLowerCase() + " mask"}
          hidden={mask.hidden === true}
          onToggle={() => update({ hidden: !mask.hidden })}
          onRemove={() => {
            onOpenChange(false);
            edit((list) => list.filter((_, i) => i !== index));
          }}
        />
      </div>
      <PopoverContent
        id="mask-editor"
        data-mask-editor={index}
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-64"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if ((event.target as HTMLElement | null)?.closest?.("[data-mask-edit]"))
            event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-xs text-foreground">{label}</div>
          <Segmented
            label="Mask type"
            value={mask.type}
            dataKey="mask-type"
            items={(["linear", "radial", "conic"] as const).map((type) => ({
              value: type,
              label: MASK_LABEL[type],
              icon: MASK_ICON[type],
            }))}
            onChange={(type) => update({ type: type as MaskType })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Caption label="Alpha">
              <Field
                name={`mask-${index}-alpha`}
                label="Mask alpha"
                numeric
                value={fmt(mask.alpha ?? 100)}
                prefix={<Affix>A</Affix>}
                suffix="%"
                onCommit={(raw) => {
                  const value = readNumber(raw, 0, 100);
                  if (typeof value === "string") return value;
                  update({ alpha: value });
                }}
              />
            </Caption>
            {mask.type !== "radial" ? (
              <Caption label="Rotation">
                <Field
                  name={`mask-${index}-rotation`}
                  label="Mask rotation"
                  numeric
                  value={fmt(mask.rotation ?? 0)}
                  prefix={<Affix>R</Affix>}
                  suffix="°"
                  onCommit={(raw) => {
                    const value = readNumber(raw, -3600, 3600);
                    if (typeof value === "string") return value;
                    update({ rotation: value });
                  }}
                />
              </Caption>
            ) : null}
          </div>
          <label className="flex h-6 items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              name={`mask-${index}-invert`}
              checked={mask.invert === true}
              className="size-3.5 accent-primary"
              onChange={(event) => update({ invert: event.target.checked })}
            />
            Invert
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
