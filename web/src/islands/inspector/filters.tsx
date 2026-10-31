// Filters list (design/wonder/2026-10-30/17, properties-audit A5): each row picks a Layer or Backdrop filter
// (Blur, Brightness, Contrast, Grayscale, Hue rotation, Invert, Saturate, Sepia) from a menu with Layer and
// Backdrop groups (wonder A5-filters-type-menu), then its amount, with visibility and remove. Rows apply in
// list order (CSS filter / backdrop-filter, web/node-style.js).
import {
  Blend,
  Check,
  ChevronDown,
  Contrast,
  Droplets,
  Film,
  Rainbow,
  SquareSplitHorizontal,
  Sun,
} from "lucide-react";
import { BlurIcon, HashBoxIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, IconAffix, type IconType } from "./controls";
import {
  ListSection,
  RowTools,
  editList,
  listOf,
  readNumber,
  type EffectProps,
  type Filter,
  type FilterType,
} from "./effects";
import { fmt } from "./model";

/**
 * Ranges match FILTERS in web/node-style.js. `value` is the amount a newly picked filter starts at; a new row is
 * Blur 2 as in Wonder (A5-filters-added).
 */
export const FILTER_SPECS: Record<
  FilterType,
  { label: string; min: number; max: number; value: number; step: number; icon: IconType }
> = {
  blur: { label: "Blur", min: 0, max: 1000, value: 2, step: 1, icon: BlurIcon },
  brightness: { label: "Brightness", min: 0, max: 3, value: 1.2, step: 0.1, icon: Sun },
  contrast: { label: "Contrast", min: 0, max: 3, value: 1.2, step: 0.1, icon: Contrast },
  grayscale: { label: "Grayscale", min: 0, max: 1, value: 1, step: 0.1, icon: Blend },
  hueRotate: { label: "Hue rotation", min: -360, max: 360, value: 90, step: 1, icon: Rainbow },
  invert: { label: "Invert", min: 0, max: 1, value: 1, step: 0.1, icon: SquareSplitHorizontal },
  saturate: { label: "Saturate", min: 0, max: 3, value: 1.5, step: 0.1, icon: Droplets },
  sepia: { label: "Sepia", min: 0, max: 1, value: 1, step: 0.1, icon: Film },
};
const TYPES = Object.keys(FILTER_SPECS) as FilterType[];
const GROUPS = [
  { key: "layer", label: "Layer" },
  { key: "backdrop", label: "Backdrop" },
] as const;

export function FilterSection({ node, selection }: EffectProps) {
  const filters = listOf<Filter>(node, "filters");
  const edit = (fn: (list: Filter[]) => Filter[]) =>
    editList<Filter>(selection, node, "filters", fn);
  return (
    <ListSection
      id="filter-section"
      title="Filters"
      addLabel="Add filter"
      onAdd={() => edit((list) => [...list, { type: "blur", value: FILTER_SPECS.blur.value }])}
    >
      {filters.length
        ? filters.map((filter, index) => (
            <FilterRow key={index} index={index} filter={filter} edit={edit} />
          ))
        : null}
    </ListSection>
  );
}

function FilterRow({
  index,
  filter,
  edit,
}: {
  index: number;
  filter: Filter;
  edit: (fn: (list: Filter[]) => Filter[]) => void;
}) {
  const spec = FILTER_SPECS[filter.type] ?? FILTER_SPECS.blur;
  const update = (patch: Partial<Filter>) =>
    edit((list) =>
      list.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (!next.backdrop) delete next.backdrop;
        if (!next.hidden) delete next.hidden;
        return next;
      }),
    );
  const label = (filter.backdrop ? "backdrop " : "") + spec.label.toLowerCase();
  const selected = (filter.backdrop ? "backdrop:" : "layer:") + filter.type;
  const Icon = spec.icon;
  return (
    <div className="flex items-center gap-2" data-filter-row={index} data-filter-type={selected}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          {/* Wonder A5: 122px field, glyph centred 14px in, label 27px in, chevron 12px from the right. */}
          <button
            type="button"
            name={`filter-${index}-type`}
            aria-label={`Filter type: ${filter.backdrop ? "Backdrop " : ""}${spec.label}`}
            title="Filter type"
            data-hidden={filter.hidden === true}
            className="relative flex h-6 min-w-0 flex-1 items-center gap-1.25 rounded-md bg-input pr-6 pl-1.5 text-left text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[hidden=true]:text-muted-foreground data-[state=open]:bg-accent"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              {filter.backdrop ? <span className="text-muted-foreground">Backdrop </span> : null}
              {spec.label}
            </span>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-1.5 size-3 text-muted-foreground"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          data-filter-menu={index}
          className="max-h-90 w-52"
        >
          {GROUPS.map((group, g) => (
            <div key={group.key} role="group" aria-label={group.label}>
              {g ? <DropdownMenuSeparator /> : null}
              <div className="flex h-6 items-center px-2 text-xs text-muted-foreground">
                {group.label}
              </div>
              {TYPES.map((type) => {
                const value = `${group.key}:${type}`;
                return (
                  <DropdownMenuItem
                    key={type}
                    data-filter-option={value}
                    className="h-6"
                    onSelect={() => {
                      const backdrop = group.key === "backdrop";
                      // Keep the amount when only the group changes; a new kind starts at its default.
                      const amount = type === filter.type ? filter.value : FILTER_SPECS[type].value;
                      update({ type, value: amount, backdrop });
                    }}
                  >
                    <span className="flex-1">{FILTER_SPECS[type].label}</span>
                    {value === selected ? <Check className="size-3.5" aria-hidden /> : null}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Wonder A5: a 62px amount field with a boxed-hash prefix and no unit. */}
      <Field
        name={`filter-${index}-value`}
        label={spec.label + " amount"}
        numeric
        step={spec.step}
        value={fmt(filter.value)}
        prefix={<IconAffix icon={HashBoxIcon} />}
        className="w-15.5 shrink-0"
        onCommit={(raw) => {
          const value = readNumber(raw, spec.min, spec.max);
          if (typeof value === "string") return value;
          update({ value });
        }}
      />
      <RowTools
        label={label}
        hidden={filter.hidden === true}
        onToggle={() => update({ hidden: !filter.hidden })}
        onRemove={() => edit((list) => list.filter((_, i) => i !== index))}
      />
    </div>
  );
}
