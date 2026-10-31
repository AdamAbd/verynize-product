// Inspector for a live preview frame (preview audit PF6, design/wonder/preview-audit/wonder/PF6-inspector.png and
// PF4-presets.png). Wonder replaces the ordinary frame sections with a viewport inspector: Screen template (preset
// dropdown + rotate), Position, Layout (W/H in px + aspect), Appearance (Opacity) and Export. Position and Export are
// the shared sections; this file holds the three preview-specific ones.
import { useState, type ComponentType } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  LaptopMinimal,
  Monitor,
  Smartphone,
  SquareDashed,
  Tablet,
  Tv,
} from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { ClosedEyeIcon, OpacityIcon, RotateRightIcon, SizeOptionsIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Tip } from "../chrome/tip";
import { Affix, Caption, Field, fieldShell, IconAffix, IconButton, Section } from "./controls";
import { BlendMenu } from "./effects";
import { fmt, normalize, patchNodes, setField, type Node } from "./model";
import { notify } from "./legacy";
import {
  matchPreset,
  PREVIEW_PRESETS,
  type PreviewKind,
  type PreviewPreset,
} from "./preview-presets";

type Props = { doc: DesignDocument; node: Node; selection: string[] };
type PreviewData = { root: string; template?: string; [key: string]: unknown };

/** A top-level frame that hosts a running-app preview (`node.preview`, see web/live-preview.js). */
export function isPreviewFrame(node: Node | undefined): boolean {
  return !!node && node.type === "frame" && !node.parentId && !!node.preview;
}

const KIND_ICONS: Record<PreviewKind, ComponentType<{ className?: string }>> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: LaptopMinimal,
  desktop: Monitor,
  tv: Tv,
};

/** Wonder groups the list as phones | tablets | laptops, desktop and TV. */
const GROUPS: PreviewKind[][] = [["phone"], ["tablet"], ["laptop", "desktop", "tv"]];

function applyPreset(node: Node, preset: PreviewPreset) {
  const preview = node.preview as PreviewData;
  patchNodes([node.id], () => ({
    w: preset.w,
    h: preset.h,
    preview: { ...preview, template: preset.name },
  }));
}

/* ---------- Screen template ---------- */
export function PreviewTemplateSection({ node }: { node: Node }) {
  const preview = node.preview as PreviewData;
  const current = matchPreset(node.w, node.h, preview.template);
  const Icon = current ? KIND_ICONS[current.kind] : SquareDashed;
  const rotateLabel = node.w > node.h ? "Rotate to portrait" : "Rotate to landscape";
  return (
    <Section
      id="screen-template-section"
      title="Screen template"
      tools={
        <Tip label={rotateLabel}>
          <IconButton
            id="screen-template-rotate"
            icon={RotateRightIcon}
            label={rotateLabel}
            title={undefined}
            onClick={() => patchNodes([node.id], (n) => ({ w: n.h, h: n.w }))}
          />
        </Tip>
      }
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            id="screen-template"
            aria-label="Screen template"
            data-template={current?.name ?? "Custom"}
            className={cn(
              fieldShell,
              "w-full justify-between pr-2.5 pl-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring aria-expanded:ring-1 aria-expanded:ring-ring",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconAffix icon={Icon} />
              <span className="truncate">{current?.name ?? "Custom"}</span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          id="screen-template-menu"
          align="start"
          sideOffset={4}
          className="w-56"
        >
          {GROUPS.map((kinds, index) => (
            <div key={kinds.join()} className="contents">
              {index ? <DropdownMenuSeparator /> : null}
              {PREVIEW_PRESETS.filter((p) => kinds.includes(p.kind)).map((preset) => (
                <DropdownMenuItem
                  key={preset.name}
                  data-preset={preset.name}
                  className="h-6"
                  onSelect={() => applyPreset(node, preset)}
                >
                  <span className="mr-1 min-w-0 flex-1 truncate">{preset.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {preset.w} × {preset.h}
                  </span>
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {preset === current ? (
                      <Check className="size-3 text-foreground" aria-hidden />
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Section>
  );
}

/* ---------- Layout: viewport width and height ---------- */
export function PreviewLayoutSection({ node }: Props) {
  // The aspect lock is a view setting of this panel, per frame (Wonder does not store one in the document).
  const [locked, setLocked] = useState<string | null>(null);
  const lock = locked === node.id;
  const commit = (axis: "w" | "h") => (raw: string) => {
    if (!lock) return setField([node.id], node, axis, raw);
    const result = normalize(axis, raw);
    if ("error" in result) {
      notify(result.error);
      return result.error;
    }
    const value = result.value as number;
    const other = axis === "w" ? "h" : "w";
    const scaled = Math.max(10, Math.round((value * node[other]) / (node[axis] || 1)));
    patchNodes([node.id], () => ({ [axis]: value, [other]: scaled }));
    return null;
  };
  return (
    <Section id="layout-section" title="Layout">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          {(["w", "h"] as const).map((axis) => (
            <Field
              key={axis}
              name={axis}
              label={axis === "w" ? "Width" : "Height"}
              numeric
              value={fmt(node[axis])}
              onCommit={commit(axis)}
              prefix={<Affix>{axis.toUpperCase()}</Affix>}
              suffix={<span className="shrink-0 text-muted-foreground">px</span>}
            />
          ))}
        </div>
        <div className="flex w-6 shrink-0 flex-col items-center">
          <IconButton
            id="preview-aspect-lock"
            icon={SizeOptionsIcon}
            label={lock ? "Unlock aspect ratio" : "Lock aspect ratio"}
            aria-pressed={lock}
            active={lock}
            onClick={() => setLocked(lock ? null : node.id)}
          />
        </div>
      </div>
    </Section>
  );
}

/* ---------- Appearance: opacity only ---------- */
export function PreviewAppearanceSection({ doc, node, selection }: Props) {
  const hidden = !!node.hidden;
  return (
    <Section
      id="appearance-section"
      title="Appearance"
      tools={
        <>
          <IconButton
            id="appearance-visibility"
            icon={hidden ? ClosedEyeIcon : Eye}
            label={hidden ? "Show layer" : "Hide layer"}
            onClick={() => patchNodes([node.id], () => ({ hidden: !hidden }))}
          />
          <BlendMenu doc={doc} node={node} selection={selection} />
        </>
      }
    >
      <Caption label="Opacity">
        <Field
          name="opacity"
          label="Opacity"
          numeric
          value={fmt(node.opacity)}
          onCommit={(raw) => setField([node.id], node, "opacity", raw)}
          prefix={<IconAffix icon={OpacityIcon} />}
          suffix="%"
        />
      </Caption>
    </Section>
  );
}
