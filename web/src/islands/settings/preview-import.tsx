// The responsive preview and Import HTML dialog (`#modal`), rendered by this island in place of the markup in
// web/index.html, the handlers in web/app.js and the desktop import options of the former web/html-import.js.
// Opened by the legacy #preview / #import commands (web/app.js dispatches `bd:open-modal` {mode}).
// - Preview: the exported page (window.design.exportHTML) in a sandboxed frame, scripts off unless the page has a
//   shader (the trusted shader runtime), with a viewport width picker.
// - Import: pasted HTML. On the desktop it goes through the main-process importer (desktop/html-import.cjs ->
//   integrations/codec-html.mjs: stylesheets relative to a chosen file, the CSS cascade for a viewport, :root
//   variables) and can import an .html file; the browser build keeps the in-page importer (window.design.importHTML).
// Ids are the legacy ones (tests and settings.css use them).
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { activePage, useWindowEvent, type DesignDocument } from "@/lib/bridge";
import { can, platform } from "@/lib/platform";

type Mode = "preview" | "import";
type ImportResult = {
  document: DesignDocument;
  rootIds?: string[];
  warnings?: string[];
  stats?: { elements?: number };
  file?: string;
} | null;
type ImportOptions = {
  document: DesignDocument;
  pageId: string;
  viewport: { width: number; height: number };
  allowRemote: boolean;
};
type NativeImporter = {
  importHtml(options: ImportOptions & { html: string }): Promise<ImportResult>;
  importHtmlFile(options: ImportOptions): Promise<ImportResult>;
};
type ImportApi = {
  exportHTML(): string;
  importHTML(html: string): number;
  loadDocument(document: DesignDocument): void;
};

const WIDTHS = [
  ["100%", "Responsive"],
  ["390px", "Phone · 390"],
  ["768px", "Tablet · 768"],
  ["1000px", "Desktop · 1000"],
] as const;
const VIEWPORTS = [
  ["1440x900", "Desktop · 1440"],
  ["1280x800", "Laptop · 1280"],
  ["768x1024", "Tablet · 768"],
  ["390x844", "Phone · 390"],
] as const;

const editor = () => window.design as unknown as ImportApi & typeof window.design;
const nativeImporter = (): NativeImporter | null =>
  can("htmlImport") ? (platform.desktop as unknown as NativeImporter) : null;

export function PreviewImportDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const [opened, setOpened] = useState(0);
  const [mode, setMode] = useState<Mode>("preview");
  const [srcdoc, setSrcdoc] = useState("");
  const [scripts, setScripts] = useState(false);
  const [width, setWidth] = useState<string>(WIDTHS[0][0]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState<string>(VIEWPORTS[0][0]);
  const [remote, setRemote] = useState(false);
  const native = nativeImporter();
  const importing = mode === "import";

  useWindowEvent("bd:open-modal", (event) => {
    const next: Mode =
      (event as CustomEvent<{ mode?: Mode }>).detail?.mode === "import" ? "import" : "preview";
    const shader = activePage(editor().getDocument()).nodes.some((node) => node.type === "shader");
    setMode(next);
    if (next === "import")
      setStatus(
        "Imports nested inline layouts and text. Scripts, external CSS, and app behavior are excluded.",
      );
    else {
      setScripts(shader);
      setSrcdoc(editor().exportHTML());
      setStatus(
        shader
          ? "Trusted shader runtime runs in an isolated preview. Imported scripts are excluded."
          : "Resize the viewport to check layout. Scripts are disabled.",
      );
    }
    setOpened((count) => count + 1);
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    if (opened && element && !element.open) element.showModal();
  }, [opened]);

  const close = () => dialog.current?.close();

  const options = (): ImportOptions => {
    const [w, h] = viewport.split("x").map(Number);
    const document = editor().getDocument();
    return {
      document,
      pageId: document.activePage,
      viewport: { width: w, height: h },
      allowRemote: remote,
    };
  };

  const run = async (task: () => Promise<ImportResult>) => {
    if (busy) return;
    setBusy(true);
    setStatus("Importing…");
    try {
      const result = await task();
      if (!result) {
        setStatus("");
        return;
      }
      editor().loadDocument(result.document);
      editor().setSelection(result.rootIds ?? []);
      const notes = result.warnings ?? [];
      const message = `Imported ${result.stats?.elements ?? ""} elements${result.file ? ` from ${result.file}` : ""}${
        notes.length
          ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"}: ${notes.slice(0, 3).join(" · ")}`
          : ""
      }`;
      setStatus(message);
      if (dialog.current) dialog.current.dataset.imported = String(result.rootIds?.length ?? 0);
      close();
      // Import notes (CSS without a canvas equivalent) stay readable after the dialog closes.
      toast(message, { duration: notes.length ? 12000 : 4000 });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const html = source.current?.value ?? "";
    if (native) {
      void run(() => native.importHtml({ ...options(), html }));
      return;
    }
    try {
      editor().importHTML(html);
      close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <dialog id="modal" ref={dialog} aria-labelledby="modal-title">
      <header>
        <strong id="modal-title">{importing ? "Import HTML" : "Responsive preview"}</strong>
        <select
          id="preview-width"
          aria-label="Preview width"
          hidden={importing}
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        >
          {WIDTHS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" id="close" onClick={close}>
          Close
        </button>
      </header>
      <textarea
        id="source"
        ref={source}
        spellCheck={false}
        hidden={!importing}
        placeholder={
          native
            ? "Paste HTML (with <style> or Tailwind classes), or choose a file to resolve its stylesheets"
            : "Paste HTML with inline styles"
        }
      />
      {native && (
        <div
          id="html-import-options"
          hidden={!importing}
          className="my-2 flex flex-wrap items-center gap-2"
        >
          <select
            id="import-viewport"
            aria-label="Import viewport"
            value={viewport}
            onChange={(event) => setViewport(event.target.value)}
          >
            {VIEWPORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              id="import-remote"
              checked={remote}
              onChange={(event) => setRemote(event.target.checked)}
            />{" "}
            Load remote stylesheets
          </label>
          <button
            type="button"
            id="import-file"
            disabled={busy}
            onClick={() => void run(() => native.importHtmlFile(options()))}
          >
            Choose HTML file…
          </button>
        </div>
      )}
      <button type="button" id="apply" hidden={!importing} disabled={busy} onClick={apply}>
        Import editable layers
      </button>
      {/* A new frame per sandbox value: the flags are in place before the document loads. */}
      <iframe
        key={scripts ? "scripts" : "static"}
        id="frame"
        sandbox={scripts ? "allow-scripts" : ""}
        title="Exported design preview"
        hidden={importing}
        srcDoc={srcdoc}
        style={{ "--preview-width": width } as CSSProperties}
      />
      <p id="status" role="status">
        {status}
      </p>
    </dialog>
  );
}
