// Export section (design/wonder/2026-10-30 21, 22, 41; properties-audit A7): a full-width file name, then size
// preset and format in two columns, then the Export button, as in Wonder. The file suffix follows the size
// ("@2x"); a custom suffix and the Selection / Page scope live in the "Export options" popover, whose trigger
// sits inside the name field and shows on hover (or while an option differs from its default).
// SVG is offered only when every exported layer is an SVG image; Code exports Tailwind JSX or HTML + CSS.
import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Caption, Field, NativeSelect, OptionalSection } from "./controls";
import {
  CODE_FLAVORS,
  EXPORT_SCALES,
  UNSCALED,
  defaultSuffix,
  exportArtwork,
  exportFormats,
  exportedNodes,
  isSvgNode,
  type CodeFlavor,
  type ExportFormat,
} from "./export";
import type { Node } from "./model";

export function ExportSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [flavor, setFlavor] = useState<CodeFlavor>("tailwind");
  const [scale, setScale] = useState("2");
  const [scope, setScope] = useState("selection");
  const [name, setName] = useState<string | null>(null);
  const [suffix, setSuffix] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [options, setOptions] = useState(false);
  useEffect(() => {
    setOpen(false);
    setName(null);
    setStatus("");
    setOptions(false);
  }, [node.id]);
  const exported = exportedNodes(doc, selection, scope === "selection");
  const formats = exportFormats(exported.length > 0 && exported.every(isSvgNode));
  // SVG disappears when the selection gains a non-SVG layer: fall back to PNG.
  const active = formats.some((f) => f.value === format) ? format : "PNG";
  const unscaled = UNSCALED.has(active);
  const fileName = name ?? node.name;
  const fileSuffix = suffix ?? (unscaled ? "" : defaultSuffix(scale));
  const customised = suffix !== null || scope !== "selection";
  const label =
    active === "CODE"
      ? (CODE_FLAVORS.find((f) => f.value === flavor)?.label ?? "Code")
      : formats.find((f) => f.value === active)!.label;
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const count = exported.length;
      const saved = await exportArtwork({
        format: active,
        flavor,
        scale: unscaled ? "1" : scale,
        selectionOnly: scope === "selection",
        name: fileName,
        suffix: fileSuffix,
      });
      if (!saved) return; // save dialog cancelled
      const message = `Exported ${count} ${count === 1 ? "element" : "elements"}`;
      setStatus(`${message} · ${saved}`);
      toast.success(message, { id: "artwork-export", description: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      toast.error("Export failed", { id: "artwork-export", description: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <OptionalSection
      id="export-section"
      title="Export"
      present={open}
      onAdd={() => setOpen(true)}
      onRemove={() => setOpen(false)}
    >
      {/* The options popover is anchored to the whole name field so it opens beside the panel. */}
      <Popover open={options} onOpenChange={setOptions} modal={false}>
        <PopoverAnchor asChild>
          <div className="flex min-w-0 flex-col">
            <Field
              label="Export file name"
              value={fileName}
              onCommit={(value) => setName(value.trim() || null)}
              suffix={
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    id="artwork-options"
                    aria-label="Export options"
                    title="Export options"
                    data-custom={customised || undefined}
                    className="-mr-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/field:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring data-custom:opacity-100 data-[state=open]:opacity-100"
                  >
                    <SlidersHorizontal className="size-3.5" aria-hidden />
                  </button>
                </PopoverTrigger>
              }
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="left"
          align="start"
          sideOffset={20}
          collisionPadding={8}
          className="w-56"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-2">
            <Caption label="Suffix">
              <Field
                label="Export file suffix"
                value={fileSuffix}
                placeholder="None"
                onCommit={(value) => setSuffix(value.trim())}
              />
            </Caption>
            <Caption label="Export">
              <NativeSelect
                id="artwork-scope"
                label="Export scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "selection", label: "Selection" },
                  { value: "page", label: "Whole page" },
                ]}
              />
            </Caption>
          </div>
        </PopoverContent>
      </Popover>
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect
          id="artwork-scale"
          label="Export size"
          value={unscaled ? "1" : scale}
          disabled={unscaled}
          onChange={(value) => {
            setScale(value);
            setSuffix(null);
          }}
          options={EXPORT_SCALES}
        />
        <NativeSelect
          id="artwork-format"
          label="Export format"
          value={active}
          onChange={(value) => setFormat(value as ExportFormat)}
          options={formats}
        />
      </div>
      {active === "CODE" ? (
        <NativeSelect
          id="artwork-code"
          label="Code flavor"
          value={flavor}
          onChange={(value) => setFlavor(value as CodeFlavor)}
          options={CODE_FLAVORS}
        />
      ) : null}
      <button
        type="button"
        id="artwork-download"
        disabled={busy}
        className="flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        onClick={run}
      >
        {busy ? "Exporting…" : `Export as ${label}`}
      </button>
      <p
        id="artwork-status"
        role="status"
        className="truncate text-2xs text-subtle-foreground empty:hidden"
        title={status}
      >
        {status}
      </p>
    </OptionalSection>
  );
}
