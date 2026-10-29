// Artwork export for the inspector Export section (design/wonder 45–50): 0.5×–4× raster scales, PNG/JPG/WebP/SVG,
// vector PDF and HTML ("Code"), saved through the native save dialog (desktop/render.cjs `saveExport`).
// The artwork HTML comes from app.js `exportArtwork({format: "HTML"})`, so every format renders the same markup.

export type ExportFormat = "PNG" | "JPG" | "WEBP" | "SVG" | "PDF" | "HTML";
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "PNG", label: "PNG" },
  { value: "JPG", label: "JPG" },
  { value: "WEBP", label: "WebP" },
  { value: "SVG", label: "SVG" },
  { value: "PDF", label: "PDF" },
  { value: "HTML", label: "HTML" },
];
export const EXPORT_SCALES = ["0.5", "1", "2", "3", "4"];

type Artwork = { content?: string; dataURL?: string; width: number; height: number; mime?: string };
type DesktopExport = {
  renderDesign(options: {
    html: string;
    width: number;
    height: number;
    scale: number;
  }): Promise<{ dataURL: string; width: number; height: number }>;
  renderPDF?(options: {
    html: string;
    width: number;
    height: number;
    title?: string;
  }): Promise<{ dataURL: string; width: number; height: number }>;
  saveExport?(options: {
    name: string;
    data: string;
    extension: string;
  }): Promise<{ path: string; name: string; bytes: number } | null>;
};
const desktop = () => (window as unknown as { desktop?: DesktopExport }).desktop;
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

/** Render the selection (or page) in a format. Returns a data URL or text plus the output size. */
export async function renderArtwork({
  format,
  scale,
  selectionOnly,
  name = "Export",
}: {
  format: ExportFormat;
  scale: number;
  selectionOnly: boolean;
  name?: string;
}): Promise<{ data: string; extension: string; width: number; height: number }> {
  if (!EXPORT_SCALES.includes(String(scale))) throw Error("Unsupported export scale");
  const html = await artwork({ format: "HTML", selectionOnly });
  const width = Math.ceil(html.width - 1e-3),
    height = Math.ceil(html.height - 1e-3);
  if (format === "HTML") return { data: html.content!, extension: "html", width, height };
  if (format === "SVG") {
    const svg = await artwork({ format: "SVG", scale: 1, selectionOnly });
    const w = Math.ceil(html.width * scale),
      h = Math.ceil(html.height * scale);
    const content = svg.content!.replace(
      /^<svg([^>]*?) width="[^"]*" height="[^"]*"/,
      `<svg$1 width="${w}" height="${h}"`,
    );
    return { data: content, extension: "svg", width: w, height: h };
  }
  const native = desktop();
  if (format === "PDF") {
    if (!native?.renderPDF) throw Error("Open the desktop app for PDF export.");
    const pdf = await native.renderPDF({ html: html.content!, width, height, title: name });
    return { data: pdf.dataURL, extension: "pdf", width: pdf.width, height: pdf.height };
  }
  if (!native?.renderDesign) throw Error("Open the desktop app for pixel-accurate raster export.");
  const raster = await native.renderDesign({ html: html.content!, width, height, scale });
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
 * Render and save. Returns the saved file name, or null when the user cancelled the save dialog.
 * Without the desktop bridge (browser build) the file is downloaded instead.
 */
export async function exportArtwork(options: {
  format: ExportFormat;
  scale: number;
  selectionOnly: boolean;
  name: string;
}): Promise<string | null> {
  const out = await renderArtwork(options);
  const suffix =
    options.scale === 1 || options.format === "PDF" || options.format === "HTML"
      ? ""
      : `@${options.scale}x`;
  const name = (options.name.trim() || "export") + suffix;
  return saveFile(name, out.data, out.extension);
}

const MIME: Record<string, string> = { svg: "image/svg+xml", html: "text/html", css: "text/css" };
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
