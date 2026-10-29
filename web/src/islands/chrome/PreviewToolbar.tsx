import { useEffect, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { ExternalLinkIcon, KeyboardIcon, EllipsisIcon, MousePointerSquareDashedIcon, ScanIcon, TargetIcon } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import "./preview-toolbar.css";

type PreviewSelection = {nodeId: string; state: string; mode: string; inputToApp: boolean; url: string};
type PreviewApi = {
  getSelectionState(): PreviewSelection | null;
  navigateMode(): void;
  editMode(): void;
  captureSelected(): Promise<void>;
  sendAllInput(): void | Promise<void>;
  openInBrowser(): Promise<void>;
};
const api = () => (window as unknown as {livePreview?: PreviewApi}).livePreview;

/** Screen-space preview controls: independent of the selected frame's size or camera zoom. */
export function PreviewToolbar() {
  const [selection, setSelection] = useState<PreviewSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const sendingInput = useRef(false);
  useEffect(() => {
    const refresh = () => setSelection(api()?.getSelectionState?.() || null);
    refresh();
    window.addEventListener("bd:preview-state", refresh);
    return () => window.removeEventListener("bd:preview-state", refresh);
  }, []);
  useEffect(() => {setMenuOpen(false); setError("");}, [selection?.nodeId]);
  if (!selection) return null;
  const running = selection.state === "running";
  const perform = async (action: () => void | Promise<void>) => {
    setError("");
    try {await action();} catch (caught) {setError(caught instanceof Error ? caught.message : String(caught));}
  };
  const capture = async () => {
    setBusy(true);
    try {await perform(() => api()?.captureSelected());} finally {setBusy(false);}
  };
  return <div id="preview-toolbar" role="toolbar" aria-label="Preview tools" onPointerDown={event => event.stopPropagation()}>
    <button id="preview-navigate" type="button" aria-pressed={selection.mode === "navigate"} disabled={!running} onClick={() => void perform(() => api()?.navigateMode())}><MousePointerSquareDashedIcon className="size-4" />Navigate</button>
    <button id="preview-edit" type="button" aria-pressed={selection.mode === "edit"} disabled={!running} onClick={() => void perform(() => api()?.editMode())}><TargetIcon className="size-4" />Edit</button>
    <button id="live-capture" type="button" disabled={!running || busy} onClick={() => void capture()}><ScanIcon className="size-4" />{busy ? "Capturing…" : "Capture"}</button>
    <span role="separator" aria-orientation="vertical" />
    <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenu.Trigger asChild><button id="preview-more" type="button" aria-label="More preview options"><EllipsisIcon className="size-4" /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer()}>
        <DropdownMenu.Content id="preview-options-menu" side="top" align="end" sideOffset={8} collisionPadding={8} onCloseAutoFocus={event => {if (sendingInput.current) {event.preventDefault(); sendingInput.current = false;}}}>
          <DropdownMenu.CheckboxItem id="preview-send-input" title="Send keyboard input to the app. Press Command/Ctrl+Shift+Escape to return to the canvas." checked={selection.inputToApp} disabled={!running} onSelect={() => {sendingInput.current = true; requestAnimationFrame(() => void perform(() => api()?.sendAllInput()));}}><KeyboardIcon className="size-4" />Send all input to app</DropdownMenu.CheckboxItem>
          <DropdownMenu.Item id="preview-open-browser" disabled={!running || !selection.url} onSelect={() => void perform(() => api()?.openInBrowser())}><ExternalLinkIcon className="size-4" />Open in browser</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {error && <p role="status">{error}</p>}
  </div>;
}
