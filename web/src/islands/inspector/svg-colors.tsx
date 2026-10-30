// Colors for simple monochrome SVG images. The original source remains intact; rendering uses its alpha mask.
import { useState } from "react";
import { RotateCcw, Unlink } from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { ColorPopover } from "./color-picker";
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
  if (!original) return null;
  const token = typeof node.svgColorToken === "string" ? node.svgColorToken : undefined;
  const color =
    (token && doc.tokens[token]) || (typeof node.svgColor === "string" ? node.svgColor : original);
  const update = (value: string, binding?: string) =>
    patchNodes(selection, (target) =>
      monochromeSvgColor(target) ? { svgColor: value, svgColorToken: binding } : {},
    );
  const detach = () => patchNodes(selection, target => {
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
            <IconButton
              icon={Unlink}
              label="Detach SVG color variable"
              onClick={detach}
            />
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
        <div
          data-color-anchor
          className="flex h-6 items-center gap-2 rounded-md bg-input px-2 text-xs shadow-field"
        >
          <button
            type="button"
            aria-label="SVG color"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex size-4 shrink-0 items-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Swatch color={color} />
          </button>
          {token ? (
            <button
              type="button"
              data-svg-color-token={token}
              onClick={() => setOpen(!open)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {token}
            </button>
          ) : (
            <Field
              label="SVG hex color"
              value={hexLabel(color)}
              className="h-5 flex-1 bg-transparent px-1 shadow-none"
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
