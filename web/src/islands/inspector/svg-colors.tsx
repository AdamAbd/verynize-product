// SVG image colours: the one colour of a simple monochrome SVG (`svgColor`/`svgColorToken`; rendering uses its
// alpha mask) and the distinct paints of a multicolour SVG (`svgPaints` replacements). The original source stays
// intact. Their rows live in Selection colors (selection-colors.tsx), which replaced the SVG-only Colors section.
import { parseColor, toHex } from "./color";
import { type Node } from "./model";

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

/* ---------- Multicolour SVG: each distinct paint is replaced on its own (`svgPaints`) ---------- */
type SvgApi = { svgPaintList(src: string): string[] };
const svgApi = () => (window as unknown as { BetterNodeStyle: SvgApi }).BetterNodeStyle;
/** Distinct explicit paints of an editable SVG image (not catalog icons), in document order. */
export function svgPaints(node: Node): string[] {
  if (node.type !== "image" || node.icon || typeof node.src !== "string") return [];
  if (!node.src.startsWith("data:image/svg+xml;base64,")) return [];
  return svgApi().svgPaintList(node.src);
}
