import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { DropdownMenu, Tooltip } from "radix-ui";
import {
  ExternalLinkIcon,
  KeyboardIcon,
  EllipsisIcon,
  MousePointerSquareDashedIcon,
  FocusIcon,
  TargetIcon,
} from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { PreviewChanges } from "./preview-changes";
import "./preview-toolbar.css";

type PreviewSelection = {
  nodeId: string;
  state: string;
  mode: string;
  inputToApp: boolean;
  url: string;
  capturing?: boolean;
};
type PreviewApi = {
  getSelectionState(): PreviewSelection | null;
  navigateMode(): void;
  setMode(mode: string): void;
  sendAllInput(): void | Promise<void>;
  openInBrowser(): Promise<void>;
};
const api = () => (window as unknown as { livePreview?: PreviewApi }).livePreview;

/** Wonder PM1 tooltip: 24px chip with a muted shortcut, or a two-line title + description. */
function ModeTip({
  label,
  shortcut,
  description,
  children,
}: {
  label: string;
  shortcut?: string;
  description?: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root disableHoverableContent>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={portalContainer()}>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          data-pe="preview-mode-tip"
          data-two-line={description ? "" : undefined}
        >
          {description ? (
            <>
              <span>{label}</span>
              <span data-pe="preview-mode-tip-note">{description}</span>
            </>
          ) : (
            <>
              <span>{label}</span>
              {shortcut ? <kbd>{shortcut}</kbd> : null}
            </>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Screen-space preview controls (Wonder PM1): independent of the selected frame's size or camera zoom. */
export function PreviewToolbar() {
  const [selection, setSelection] = useState<PreviewSelection | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const sendingInput = useRef(false);
  useEffect(() => {
    const refresh = () => setSelection(api()?.getSelectionState?.() || null);
    refresh();
    window.addEventListener("bd:preview-state", refresh);
    return () => window.removeEventListener("bd:preview-state", refresh);
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    setError("");
  }, [selection?.nodeId]);
  // Same element tree in both branches so the badge/dialog state survives selection changes.
  if (!selection)
    return (
      <>
        <PreviewChanges />
        {null}
      </>
    );
  const running = selection.state === "running";
  const perform = async (action: () => void | Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  // Clicking the active mode again returns to plain selection.
  const toggle = (mode: string) =>
    void perform(() => api()?.setMode(selection.mode === mode ? "select" : mode));
  return (
    <>
      <PreviewChanges />
      <div
        id="preview-toolbar"
        role="toolbar"
        aria-label="Preview tools"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ModeTip label="Navigate inside">
          <button
            id="preview-navigate"
            type="button"
            aria-pressed={selection.mode === "navigate"}
            onClick={() => toggle("navigate")}
          >
            <MousePointerSquareDashedIcon className="size-4" />
            Navigate
          </button>
        </ModeTip>
        <ModeTip label="Inspect element" shortcut="⌘⇧I">
          <button
            id="preview-edit"
            type="button"
            aria-pressed={selection.mode === "edit"}
            disabled={!running}
            onClick={() => toggle("edit")}
          >
            <TargetIcon className="size-4" />
            Edit
          </button>
        </ModeTip>
        <ModeTip label="Capture" description="Add an editable design to canvas">
          <button
            id="live-capture"
            type="button"
            aria-pressed={selection.mode === "capture"}
            disabled={!running || selection.capturing}
            onClick={() => toggle("capture")}
          >
            <FocusIcon className="size-4" />
            {selection.capturing ? "Capturing…" : "Capture"}
          </button>
        </ModeTip>
        <span role="separator" aria-orientation="vertical" />
        <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button id="preview-more" type="button" aria-label="More preview options">
              <EllipsisIcon className="size-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={portalContainer()}>
            <DropdownMenu.Content
              id="preview-options-menu"
              side="top"
              align="end"
              sideOffset={8}
              collisionPadding={8}
              onCloseAutoFocus={(event) => {
                if (sendingInput.current) {
                  event.preventDefault();
                  sendingInput.current = false;
                }
              }}
            >
              <DropdownMenu.CheckboxItem
                id="preview-send-input"
                title="Send keyboard input to the app. Press Command/Ctrl+Shift+Escape to return to the canvas."
                checked={selection.inputToApp}
                disabled={!running}
                onSelect={() => {
                  sendingInput.current = true;
                  requestAnimationFrame(() => void perform(() => api()?.sendAllInput()));
                }}
              >
                <KeyboardIcon className="size-4" />
                Send all input to app
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Item
                id="preview-open-browser"
                disabled={!running || !selection.url}
                onSelect={() => void perform(() => api()?.openInBrowser())}
              >
                <ExternalLinkIcon className="size-4" />
                Open in browser
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {error && <p role="status">{error}</p>}
      </div>
    </>
  );
}
