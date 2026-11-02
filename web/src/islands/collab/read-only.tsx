// Viewers and commenters (body.cloud-read-only, set by web/cloud-panel.js setRole) see the file, select and pan, and
// cannot change it (B4). Wonder's viewer keeps only Move and Hand in the toolbar (chrome/CanvasOverlays.tsx) and
// leaves edits inert without an error (share-audit/wonder-web/collab 13-new-viewer-attempt); the canvas guards are in
// web/canvas-interactions.js. Here: a "View only" pill at the top of the canvas and an inert inspector body (its
// header — panel toggle, presence, Share — stays usable).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { EyeIcon } from "lucide-react";
import { useBodyClass } from "@/lib/bridge";

function inspectorBody(readOnly: boolean) {
  const panel = document.querySelector("#bd-inspector-root > div");
  if (!panel) return;
  Array.from(panel.children).forEach((child, index) => {
    if (index === 0) return; // the header
    (child as HTMLElement).inert = readOnly;
  });
}

function useInertInspector(readOnly: boolean) {
  useEffect(() => {
    inspectorBody(readOnly);
    const root = document.getElementById("bd-inspector-root");
    if (!root) return;
    // Sections mount and unmount with the selection (preview element, icons): keep them inert.
    const observer = new MutationObserver(() => inspectorBody(readOnly));
    observer.observe(root, { childList: true, subtree: false });
    const panel = root.firstElementChild;
    if (panel) observer.observe(panel, { childList: true });
    return () => {
      observer.disconnect();
      if (readOnly) inspectorBody(false);
    };
  }, [readOnly]);
}

export function ReadOnly() {
  const readOnly = useBodyClass("cloud-read-only");
  const filesView = useBodyClass("files-view");
  useInertInspector(readOnly);
  const host = document.getElementById("workspace");
  if (!readOnly || filesView || !host) return null;
  return createPortal(
    <div
      id="view-only-pill"
      role="status"
      className="pointer-events-none absolute top-3 left-1/2 z-30 flex h-6 -translate-x-1/2 items-center gap-1.5 rounded-full border border-toolbar-edge bg-background px-2.5 text-xs text-foreground-3"
    >
      <EyeIcon className="size-3.5" aria-hidden />
      View only
    </div>,
    host,
  );
}
