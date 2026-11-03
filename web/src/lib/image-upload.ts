// Typed bridge to the shared policy loaded before the canvas and React islands.
declare global {
  interface Window {
    sanitizeSvg(markup: string): SVGSVGElement | null;
    imageUpload: {
      MAX_BYTES: number;
      OUTPUT_BYTES: number;
      MAX_SIDE: number;
      ACCEPT: string;
      batch(files: Blob[]): void;
      preflight(doc: unknown): void;
      preflightChange(doc: unknown, before: unknown): void;
      prepare(
        file: Blob,
        options?: { purpose?: "canvas" | "chat"; signal?: AbortSignal },
      ): Promise<{
        src: string;
        originalWidth: number;
        originalHeight: number;
        pixelWidth: number;
        pixelHeight: number;
        mime: string;
        hash: string;
        width: number;
        height: number;
        bytes: number;
        name: string;
      }>;
    };
  }
}

export const prepareImage = (
  file: Blob,
  options?: { purpose?: "canvas" | "chat"; signal?: AbortSignal },
) => window.imageUpload.prepare(file, options);

/** Storage refusals already opened the size dialog (web/src/islands/storage/storage-alerts.tsx). */
export const alreadyReported = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { reported?: boolean }).reported === true;
