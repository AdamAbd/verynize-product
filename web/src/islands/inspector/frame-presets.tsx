// Frame tool presets (properties-audit D1): with the Frame tool on and nothing selected, Properties lists Wonder's
// seven collapsible categories of frame sizes instead of the Page section. A row inserts a named frame of that size.
import { useState, useSyncExternalStore, type ComponentType } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  LaptopMinimal,
  MessageSquare,
  Monitor,
  Smartphone,
  Tablet,
  Watch,
} from "lucide-react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { Section } from "./controls";
import { notify } from "./legacy";

type Preset = { name: string; w: number; h: number };
type Category = { category: string; presets: Preset[] };
type FrameApi = {
  framePresets?: () => Category[];
  insertFramePreset?: (name: string) => string | null;
};

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Phone: Smartphone,
  Tablet,
  Desktop: LaptopMinimal,
  Presentation: Monitor,
  Smartwatch: Watch,
  Paper: File,
  "Social media": MessageSquare,
};

const api = () => window.design as unknown as FrameApi;

/* ---------- Active canvas tool (`#workspace[data-tool]`, written by canvas-interactions.js setTool) ---------- */
const readTool = () => document.getElementById("workspace")?.dataset.tool || "move";
function subscribeTool(onChange: () => void) {
  const el = document.getElementById("workspace");
  if (!el) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(el, { attributes: true, attributeFilter: ["data-tool"] });
  return () => observer.disconnect();
}
export function useCanvasTool(): string {
  return useSyncExternalStore(subscribeTool, readTool, readTool);
}

/*
 * Wonder D1 geometry (CSS px from the panel's left edge): "Frame" heading x 12; rows 30 px apart, inset to x 16–264
 * with a #262626 hover; category chevron centred at x 24, icon at x 35–49, label at x 56; preset name at x 38 and
 * its size right-aligned at x 256. The first row starts 13 px under the heading, the divider 11 px under the last.
 */
export function FramePresetsSection() {
  const categories = api().framePresets?.() ?? [];
  return (
    <Section id="frame-presets-section" title="Frame" bodyClassName="gap-0 pt-3.25">
      {categories.map(({ category, presets }) => (
        <PresetCategory key={category} category={category} presets={presets} />
      ))}
    </Section>
  );
}

function PresetCategory({ category, presets }: Category) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[category] ?? File;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen}>
      <CollapsiblePrimitive.Trigger
        data-frame-category={category}
        className="mx-1 flex h-7.5 w-62 items-center rounded-md pl-0.5 text-left text-xs text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Chevron className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <Icon className="ml-1.25 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="ml-1.75 truncate">{category}</span>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="flex flex-col">
        {presets.map(({ name, w, h }) => (
          <button
            key={name}
            type="button"
            data-preset={name}
            className="mx-1 flex h-7.5 w-62 items-center justify-between gap-2 rounded-md pr-2 pl-5.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              try {
                api().insertFramePreset?.(name);
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <span className="truncate text-preset-name">{name}</span>
            <span className="shrink-0 text-muted-foreground">
              {w} × {h}
            </span>
          </button>
        ))}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
