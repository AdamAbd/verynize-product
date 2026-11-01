// Artwork export for the inspector Export section (design/wonder 21–22, 41, 45–50).
// Formats: PNG/JPG/WebP (pixel-accurate offscreen render, desktop/render.cjs), vector PDF, Code (Tailwind JSX
// through the codec, or HTML with CSS classes) and — only when every exported layer is an SVG image — SVG.
// Sizes: 0.5×–4×, a target height (720p–2160p) or a 512 px width/height. Saved through the native save dialog.
// The artwork HTML comes from app.js `exportArtwork({format: "HTML"})`, so every format renders the same markup.
import type { DesignDocument } from "@/lib/bridge";
import { platform } from "@/lib/platform";

export type ExportFormat = "SVG" | "PNG" | "JPG" | "WEBP" | "PDF" | "CODE";
export type CodeFlavor = "tailwind" | "css";
const RASTER: { value: ExportFormat; label: string }[] = [
  { value: "PNG", label: "PNG" },
  { value: "JPG", label: "JPG" },
  { value: "WEBP", label: "WebP" },
  { value: "PDF", label: "PDF" },
  { value: "CODE", label: "Code" },
];
/** Formats on offer: SVG leads the list only when every exported layer is an SVG image. */
export const exportFormats = (allSvg: boolean) =>
  allSvg ? [{ value: "SVG" as ExportFormat, label: "SVG" }, ...RASTER] : RASTER;
export const CODE_FLAVORS: { value: CodeFlavor; label: string }[] = [
  { value: "tailwind", label: "Tailwind" },
  { value: "css", label: "CSS" },
];
export const EXPORT_SCALES: { value: string; label: string }[] = [
  ...["0.5", "1", "2", "3", "4"].map((v) => ({ value: v, label: `${v}x` })),
  ...["720p", "1080p", "1440p", "2160p"].map((v) => ({ value: v, label: v })),
  { value: "512w", label: "512w" },
  { value: "512h", label: "512h" },
];
/** Formats whose size is fixed by the artwork (no scale). */
export const UNSCALED = new Set<ExportFormat>(["PDF", "CODE"]);

/** Scale factor for a preset and an artwork size: "2" → 2, "1080p" → 1080/height, "512w" → 512/width. */
export function resolveScale(preset: string, width: number, height: number): number {
  const m = /^(\d+)(p|w|h)$/.exec(preset);
  if (!m) {
    const n = Number(preset);
    if (!Number.isFinite(n) || n <= 0) throw Error("Unsupported export scale");
    return n;
  }
  return Number(m[1]) / (m[2] === "w" ? width : height);
}
/** File name suffix a preset adds by default ("@2x", "@1080p"; nothing at 1×). */
export const defaultSuffix = (preset: string) =>
  preset === "1" ? "" : `@${preset}${/^\d/.test(preset) && !/[pwh]$/.test(preset) ? "x" : ""}`;

const SVG_SRC = /^data:image\/svg\+xml;base64,/;
type ExportNode = {
  id: string;
  type: string;
  parentId?: string | null;
  src?: unknown;
  icon?: unknown;
  svgColor?: unknown;
  svgColorToken?: unknown;
  svgPaints?: unknown;
};
/** Layers an export covers: the selection without layers inside another selected layer, or the page's top level. */
export function exportedNodes(doc: DesignDocument, selection: string[], selectionOnly: boolean) {
  const page = doc.pages.find((p) => p.id === doc.activePage) ?? doc.pages[0];
  const nodes = page.nodes as ExportNode[];
  if (!selectionOnly) return nodes.filter((n) => !n.parentId);
  const ids = new Set(selection);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inside = (n: ExportNode) => {
    for (let p = byId.get(n.parentId ?? ""); p; p = byId.get(p.parentId ?? ""))
      if (ids.has(p.id)) return true;
    return false;
  };
  return nodes.filter((n) => ids.has(n.id) && !inside(n));
}
export const isSvgNode = (n: ExportNode) =>
  n.type === "image" && !n.icon && typeof n.src === "string" && SVG_SRC.test(n.src);

type Artwork = { content?: string; dataURL?: string; width: number; height: number; mime?: string };
type Paints = {
  recolorSvg(src: string, map: Record<string, string>): string;
  svgPaintList(src: string): string[];
};
const desktop = () => platform.desktop;
const paints = () => (window as unknown as { BetterNodeStyle: Paints }).BetterNodeStyle;
const artwork = (options: { format: string; scale?: number; selectionOnly: boolean }) =>
  (window.design.exportArtwork as (o: typeof options) => Promise<Artwork>)(options);

async function convert(dataURL: string, mime: "image/jpeg" | "image/webp"): Promise<string> {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(Error("Unable to convert raster"));
    image.src = dataURL;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  if (mime === "image/jpeg") {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL(mime, 0.92);
}

const decodeSvg = (src: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(src.replace(SVG_SRC, "")), (c) => c.charCodeAt(0)));

/** The SVG markup a layer shows: per-colour replacements and a single tint applied to a copy of the source. */
export function nodeSvgMarkup(doc: DesignDocument, n: ExportNode): string {
  const api = paints();
  let src = n.src as string;
  if (n.svgPaints && typeof n.svgPaints === "object")
    src = api.recolorSvg(src, n.svgPaints as Record<string, string>);
  const tint =
    (typeof n.svgColorToken === "string" && doc.tokens[n.svgColorToken]) ||
    (typeof n.svgColor === "string" ? n.svgColor : "");
  let markup = decodeSvg(src);
  if (tint) {
    const map = Object.fromEntries(api.svgPaintList(src).map((c) => [c, tint]));
    markup = decodeSvg(api.recolorSvg(src, map));
    // Shapes without an explicit paint inherit black from the root: tint that default too.
    markup = markup.replace(/<svg\b(?![^>]*\sfill=)/, `<svg fill="${tint}"`);
  }
  return markup;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Vector SVG of SVG layers, positioned as in the artwork HTML (one nested <svg> per layer). */
function svgDocument(
  doc: DesignDocument,
  nodes: ExportNode[],
  html: string,
  scale: number,
  w: number,
  h: number,
) {
  const page = new DOMParser().parseFromString(html, "text/html");
  const shift = page.querySelector<HTMLElement>("body > div > div");
  const dx = parseFloat(shift?.style.left || "0") || 0,
    dy = parseFloat(shift?.style.top || "0") || 0;
  const parts = nodes.map((n) => {
    const el = page.querySelector<HTMLElement>(`[data-id="${CSS.escape(n.id)}"]`);
    const svg = new DOMParser().parseFromString(
      nodeSvgMarkup(doc, n),
      "image/svg+xml",
    ).documentElement;
    if (svg.localName !== "svg") throw Error("An SVG layer has unreadable markup");
    svg.setAttribute("x", String(r2((parseFloat(el?.style.left || "0") || 0) + dx)));
    svg.setAttribute("y", String(r2((parseFloat(el?.style.top || "0") || 0) + dy)));
    svg.setAttribute("width", String(r2(parseFloat(el?.style.width || "0") || w)));
    svg.setAttribute("height", String(r2(parseFloat(el?.style.height || "0") || h)));
    return new XMLSerializer().serializeToString(svg);
  });
  // Canvas measurements carry float noise (rects divided by the zoom): keep 0.01 px precision.
  const vw = r2(w),
    vh = r2(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r2(vw * scale)}" height="${r2(vh * scale)}" viewBox="0 0 ${vw} ${vh}">${parts.join("")}</svg>`;
}

export type ExportOptions = {
  format: ExportFormat;
  /** Scale preset value from EXPORT_SCALES. */
  scale: string;
  selectionOnly: boolean;
  name?: string;
  flavor?: CodeFlavor;
};

/** Render the selection (or page) in a format. Returns a data URL or text plus the output size. */
export async function renderArtwork({
  format,
  scale: preset,
  selectionOnly,
  name = "Export",
  flavor = "tailwind",
}: ExportOptions): Promise<{ data: string; extension: string; width: number; height: number }> {
  if (!EXPORT_SCALES.some((s) => s.value === preset)) throw Error("Unsupported export scale");
  const doc = window.design.getDocument();
  const nodes = exportedNodes(doc, window.design.getSelection(), selectionOnly);
  const html = await artwork({ format: "HTML", selectionOnly });
  const width = Math.ceil(html.width - 1e-3),
    height = Math.ceil(html.height - 1e-3);
  const native = desktop();
  if (format === "CODE") {
    if (!native?.exportCode) throw Error("Open the desktop app for code export.");
    const code =
      flavor === "css"
        ? await native.exportCode({ flavor, html: html.content, tokens: doc.tokens })
        : await native.exportCode({
            flavor,
            document: doc,
            pageId: doc.activePage,
            nodeIds: nodes.map((n) => n.id),
            name,
          });
    return { data: code.content, extension: code.extension, width, height };
  }
  const scale = resolveScale(preset, width, height);
  if (format === "SVG") {
    if (!nodes.length || !nodes.every(isSvgNode)) throw Error("SVG export needs SVG layers only.");
    const data = svgDocument(doc, nodes, html.content!, scale, html.width, html.height);
    return {
      data,
      extension: "svg",
      width: Math.ceil(html.width * scale),
      height: Math.ceil(html.height * scale),
    };
  }
  // The offscreen renderer loads no network URLs: room assets (images, fonts) become data URIs.
  const offline = (await window.cloudAssets?.inlineHtml?.(html.content!)) ?? html.content!;
  if (format === "PDF") {
    if (!native?.renderPDF) throw Error("Open the desktop app for PDF export.");
    const pdf = await native.renderPDF({ html: offline, width, height, title: name });
    return { data: pdf.dataURL, extension: "pdf", width: pdf.width, height: pdf.height };
  }
  if (!native?.renderDesign) throw Error("Open the desktop app for pixel-accurate raster export.");
  const raster = await native.renderDesign({ html: offline, width, height, scale });
  const data =
    format === "PNG"
      ? raster.dataURL
      : await convert(raster.dataURL, format === "JPG" ? "image/jpeg" : "image/webp");
  return {
    data,
    extension: format === "JPG" ? "jpg" : format.toLowerCase(),
    width: raster.width,
    height: raster.height,
  };
}

/**
 * Render and save as `name + suffix`. Returns the saved file name, or null when the user cancelled the save
 * dialog. Without the desktop bridge (browser build) the file is downloaded instead.
 */
export async function exportArtwork(
  options: ExportOptions & { name: string; suffix?: string },
): Promise<string | null> {
  const out = await renderArtwork(options);
  const suffix =
    options.suffix ?? (UNSCALED.has(options.format) ? "" : defaultSuffix(options.scale));
  const name = (options.name.trim() || "export") + suffix;
  return saveFile(name, out.data, out.extension);
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  html: "text/html",
  css: "text/css",
  jsx: "text/jsx",
};
/** Save through the native dialog (desktop) or a download link (browser). */
export async function saveFile(
  name: string,
  data: string,
  extension: string,
): Promise<string | null> {
  const native = desktop();
  if (native?.saveExport) {
    const saved = await native.saveExport({ name, data, extension });
    return saved ? saved.name : null;
  }
  const a = document.createElement("a");
  a.href = data.startsWith("data:")
    ? data
    : URL.createObjectURL(new Blob([data], { type: MIME[extension] ?? "text/plain" }));
  a.download = `${name}.${extension}`;
  a.click();
  if (!data.startsWith("data:")) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}
