// Colors for simple monochrome SVG images. The original source remains intact; rendering uses its alpha mask.
import { useState } from "react";
import { RotateCcw, Unlink } from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { ColorPopover } from "./color-picker";
import { VariableChip } from "./bind";
import { Field, IconButton, Section, Swatch } from "./controls";
import { parseColor, toHex } from "./color";
import { hexLabel, parseHex, patchNodes, type Node } from "./model";

/** Deliberately excludes multicolor SVGs, stylesheets, references, gradients and effects. */
export function monochromeSvgColor(node: Node): string | null {
  if (node.type !== "image" || node.icon || typeof node.src !== "string") return null;
  const match = /^data:image\/svg\+xml;base64,(.*)$/s.exec(node.src);
  if (!match) return null;
  try {
    const markup = new TextDecoder().decode(
      Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)),
    );
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    if (root.localName !== "svg") return null;
    const colors = new Set<string>();
    const walk = (el: Element, fill: string, stroke: string, ink: string): boolean => {
      if (!/^(svg|g|path|rect|circle|ellipse|line|polyline|polygon|title|desc)$/.test(el.localName))
        return false;
      if (
        Array.from(el.attributes).some(
          (a) => /^(style|class|filter|mask|clip-path)$/i.test(a.name) || /href$|^on/i.test(a.name),
        )
      )
        return false;
      ink = el.getAttribute("color") || ink;
      fill = el.getAttribute("fill") || fill;
      stroke = el.getAttribute("stroke") || stroke;
      if (!/^(svg|g|title|desc)$/.test(el.localName)) {
        for (let value of [fill, stroke]) {
          if (value === "none" || value === "transparent") continue;
          if (value === "currentColor") value = ink;
          const parsed = parseColor(
            value === "black" ? "#000000" : value === "white" ? "#ffffff" : value,
          );
          if (!parsed || parsed.a !== 1) return false;
          colors.add(toHex(parsed));
        }
      }
      return Array.from(el.children).every((child) => walk(child, fill, stroke, ink));
    };
    return walk(root, "#000000", "none", "#000000") && colors.size === 1 ? [...colors][0] : null;
  } catch {
    return null;
  }
}

export function SvgColorsSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const [open, setOpen] = useState(false);
  const original = monochromeSvgColor(node);
  if (!original) return <SvgPaintsSection node={node} selection={selection} />;
  const token = typeof node.svgColorToken === "string" ? node.svgColorToken : undefined;
  const color =
    (token && doc.tokens[token]) || (typeof node.svgColor === "string" ? node.svgColor : original);
  const update = (value: string, binding?: string) =>
    patchNodes(selection, (target) =>
      monochromeSvgColor(target) ? { svgColor: value, svgColorToken: binding } : {},
    );
  const detach = () =>
    patchNodes(selection, (target) => {
      const fallback = monochromeSvgColor(target);
      if (!fallback) return {};
      const binding = typeof target.svgColorToken === "string" ? target.svgColorToken : "";
      const own = typeof target.svgColor === "string" ? target.svgColor : fallback;
      return { svgColor: doc.tokens[binding] || own, svgColorToken: undefined };
    });
  return (
    <Section
      id="svg-colors-section"
      title="Colors"
      tools={
        <>
          {token ? (
            <IconButton icon={Unlink} label="Detach SVG color variable" onClick={detach} />
          ) : null}
          {node.svgColor ? (
            <IconButton
              icon={RotateCcw}
              label="Restore original SVG color"
              onClick={() =>
                patchNodes(selection, (target) =>
                  monochromeSvgColor(target)
                    ? { svgColor: undefined, svgColorToken: undefined }
                    : {},
                )
              }
            />
          ) : null}
        </>
      }
    >
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onCommit={(value) => update(value)}
        tokens={doc.tokens}
        token={token}
        onToken={(name) => update(doc.tokens[name], name)}
      >
        {/* Same geometry as a fill row (Wonder 13): 16px swatch 5px in, variable chip 4px after it. */}
        <div
          data-color-anchor
          className="flex h-6 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field"
        >
          <button
            type="button"
            aria-label="SVG color"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Swatch color={color} />
          </button>
          {token ? (
            <button
              type="button"
              data-svg-color-token={token}
              aria-label={`SVG color variable ${token}`}
              title={
                doc.tokens[token]
                  ? `${token} = ${doc.tokens[token]}`
                  : `${token} (missing variable)`
              }
              onClick={() => setOpen(!open)}
              className="-ml-px flex h-5 min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
            >
              <VariableChip name={token} missing={!doc.tokens[token]} />
            </button>
          ) : (
            <Field
              label="SVG hex color"
              value={hexLabel(color)}
              className="h-5 flex-1 bg-transparent px-0 shadow-none"
              onCommit={(value) => {
                const next = parseHex(value, color);
                if (!next) return "Use a hex color such as A58BDD";
                update(next);
              }}
            />
          )}
        </div>
      </ColorPopover>
    </Section>
  );
}

/* ---------- Multicolour SVG: one row per distinct paint, replaced individually ---------- */
type SvgApi = { svgPaintList(src: string): string[] };
const svgApi = () => (window as unknown as { BetterNodeStyle: SvgApi }).BetterNodeStyle;
const svgPaintsOf = (node: Node) =>
  node.svgPaints && typeof node.svgPaints === "object"
    ? (node.svgPaints as Record<string, string>)
    : {};
/** Distinct explicit paints of an editable SVG image (not catalog icons), in document order. */
export function svgPaints(node: Node): string[] {
  if (node.type !== "image" || node.icon || typeof node.src !== "string") return [];
  if (!node.src.startsWith("data:image/svg+xml;base64,")) return [];
  return svgApi().svgPaintList(node.src);
}

function SvgPaintsSection({ node, selection }: { node: Node; selection: string[] }) {
  const paints = svgPaints(node);
  const replaced = svgPaintsOf(node);
  if (!paints.length) return null;
  // Every selected SVG that uses the same original paint gets the same replacement.
  const replace = (from: string, to: string | null) =>
    patchNodes(selection, (target) => {
      if (!svgPaints(target).includes(from)) return {};
      const map = { ...svgPaintsOf(target) };
      if (!to || to === from) delete map[from];
      else map[from] = to;
      return { svgPaints: Object.keys(map).length ? map : undefined };
    });
  return (
    <Section
      id="svg-colors-section"
      title="Colors"
      tools={
        Object.keys(replaced).length ? (
          <IconButton
            icon={RotateCcw}
            label="Restore original SVG colors"
            onClick={() => patchNodes(selection, () => ({ svgPaints: undefined }))}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-1" data-svg-paints={paints.length}>
        {paints.map((from, i) => (
          <SvgPaintRow
            key={from}
            index={i}
            from={from}
            color={replaced[from] ?? from}
            onChange={(to) => replace(from, to)}
          />
        ))}
      </div>
    </Section>
  );
}

function SvgPaintRow({
  index,
  from,
  color,
  onChange,
}: {
  index: number;
  from: string;
  color: string;
  onChange: (to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1" data-svg-paint={from}>
      <ColorPopover open={open} onOpenChange={setOpen} value={color} onCommit={onChange}>
        <div
          data-color-anchor
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field"
        >
          <button
            type="button"
            aria-label={`SVG color ${index + 1}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Swatch color={color} />
          </button>
          <Field
            label={`SVG color ${index + 1} hex`}
            value={hexLabel(color)}
            className="h-5 flex-1 bg-transparent px-0 shadow-none"
            onCommit={(value) => {
              const next = parseHex(value, color);
              if (!next) return "Use a hex color such as A58BDD";
              onChange(next);
            }}
          />
        </div>
      </ColorPopover>
      {color !== from ? (
        <IconButton
          icon={RotateCcw}
          label={`Restore SVG color ${index + 1}`}
          onClick={() => onChange(null)}
        />
      ) : null}
    </div>
  );
}
