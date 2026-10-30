// Filters list (design/wonder/2026-10-30/17, validation/v30): each row picks a Layer or Backdrop filter
// (Blur, Brightness, Contrast, Grayscale, Hue rotation, Invert, Saturate, Sepia) and its amount, with
// visibility and remove. Rows apply in list order (CSS filter / backdrop-filter).
import { ChevronDown } from "lucide-react";
import { Affix, Field } from "./controls";
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

/** Ranges and starting values match FILTERS in web/node-style.js. */
export const FILTER_SPECS: Record<
  FilterType,
  { label: string; min: number; max: number; value: number; step: number; unit: string }
> = {
  blur: { label: "Blur", min: 0, max: 1000, value: 4, step: 1, unit: "px" },
  brightness: { label: "Brightness", min: 0, max: 3, value: 1.2, step: 0.1, unit: "" },
  contrast: { label: "Contrast", min: 0, max: 3, value: 1.2, step: 0.1, unit: "" },
  grayscale: { label: "Grayscale", min: 0, max: 1, value: 1, step: 0.1, unit: "" },
  hueRotate: { label: "Hue rotation", min: -360, max: 360, value: 90, step: 1, unit: "°" },
  invert: { label: "Invert", min: 0, max: 1, value: 1, step: 0.1, unit: "" },
  saturate: { label: "Saturate", min: 0, max: 3, value: 1.5, step: 0.1, unit: "" },
  sepia: { label: "Sepia", min: 0, max: 1, value: 1, step: 0.1, unit: "" },
};
const TYPES = Object.keys(FILTER_SPECS) as FilterType[];

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
  return (
    <div className="flex items-center gap-2" data-filter-row={index} data-filter-type={selected}>
      <div className="group/field relative flex h-6 min-w-0 flex-1 items-center rounded-md bg-input px-2 text-xs text-foreground shadow-field focus-within:ring-1 focus-within:ring-ring">
        <select
          name={`filter-${index}-type`}
          aria-label="Filter type"
          title="Filter type"
          value={selected}
          className="h-full w-full min-w-0 cursor-default appearance-none truncate bg-transparent pr-5 text-xs text-foreground outline-none data-[hidden=true]:text-muted-foreground"
          data-hidden={filter.hidden === true}
          onChange={(event) => {
            const [group, type] = event.target.value.split(":") as [string, FilterType];
            const backdrop = group === "backdrop";
            // Keep the amount when only the group changes; a new kind starts at its default.
            const value = type === filter.type ? filter.value : FILTER_SPECS[type].value;
            update({ type, value, backdrop });
          }}
        >
          {(["layer", "backdrop"] as const).map((group) => (
            <optgroup key={group} label={group === "layer" ? "Layer" : "Backdrop"}>
              {TYPES.map((type) => (
                <option
                  key={type}
                  value={`${group}:${type}`}
                  className="bg-popover text-foreground"
                >
                  {FILTER_SPECS[type].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 size-3 text-muted-foreground"
        />
      </div>
      <Field
        name={`filter-${index}-value`}
        label={spec.label + " amount"}
        numeric
        step={spec.step}
        value={fmt(filter.value)}
        prefix={<Affix>#</Affix>}
        suffix={spec.unit || undefined}
        className="w-20 shrink-0"
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
