// Scale section (Wonder T4-scale-retry, design/wonder/canvas-audit/wonder): while the Scale tool (K) is active with
// one layer selected, the Properties panel shows only "Scale" with a close ✕, a W | H row and a full-width % row
// ("W 150 · H 105 · 150 %" after a 100×70 frame was scaled up by half). Geometry is the standard section: 31px
// header, 24px fields 8px apart (W 1172–1296, H 1304–1428, % 1172–1428 CSS px).
// The percentage is relative to the size the layer had when the section appeared (tool armed or layer selected), so
// a Scale-tool drag reads 150 % there. Editing W, H or % scales the layer the way the tool does — proportionally,
// children, type size, radius, gap, padding and border included — through `transform.scaleBy` (one undo step).
import { useState } from "react";
import { ChevronDown, SquareArrowUpRight, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Affix, Field, IconAffix, IconButton, Section } from "./controls";
import { fmt, type Node } from "./model";

// Quick percentages behind the % field's chevron. Wonder's menu content was not captured (assumption).
const PRESETS = [50, 100, 200];

const scaleBy = (id: string, factor: number) =>
  window.design.runCommand("transform.scaleBy", { id, factor });

export function ScaleSection({ node }: { node: Node }) {
  // The reference size: the layer's size when this section mounted (it is keyed by the layer id).
  const [base] = useState(() => ({ w: Number(node.w) || 0, h: Number(node.h) || 0 }));
  const w = Number(node.w) || 0;
  const h = Number(node.h) || 0;
  const percent = base.w ? (w / base.w) * 100 : 100;
  const commit = (current: number, raw: string) => {
    const next = Number(raw.replace(/%\s*$/, "").trim());
    if (!Number.isFinite(next) || next <= 0 || !current) return;
    scaleBy(node.id, next / current);
  };
  const toPercent = (p: number) => {
    if (base.w && w) scaleBy(node.id, (base.w * p) / 100 / w);
  };
  return (
    <Section
      id="scale-section"
      title="Scale"
      tools={
        <IconButton
          icon={X}
          label="Close scale"
          id="scale-close"
          onClick={() => window.design.setTool("move")}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Field
          name="scaleW"
          label="Scaled width"
          numeric
          value={fmt(w)}
          onCommit={(raw) => commit(w, raw)}
          prefix={<Affix>W</Affix>}
        />
        <Field
          name="scaleH"
          label="Scaled height"
          numeric
          value={fmt(h)}
          onCommit={(raw) => commit(h, raw)}
          prefix={<Affix>H</Affix>}
        />
      </div>
      <Field
        name="scalePercent"
        label="Scale percentage"
        numeric
        value={fmt(percent)}
        onCommit={(raw) => commit(percent, raw) /* factor = new % / current % */}
        prefix={<IconAffix icon={SquareArrowUpRight} />}
        suffix={
          <>
            <span>%</span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Scale presets"
                  className="group/unit flex h-6 items-center text-muted-foreground outline-none hover:text-foreground"
                >
                  <ChevronDown
                    aria-hidden
                    className="size-3 shrink-0 group-aria-expanded/unit:rotate-180"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" alignOffset={-4} sideOffset={8} className="w-24">
                {PRESETS.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    className="h-6"
                    data-scale-preset={p}
                    onSelect={() => toPercent(p)}
                  >
                    {p}%
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
    </Section>
  );
}
