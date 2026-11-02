// Island entry: share. The Share popover itself renders with the inspector's Share button
// (share/share-popover.tsx); this root owns what outlives it: opening requests from other areas
// (`bd:open-share`), the File menu's visibility requests (`bd:share-visibility`) and their confirmation dialog.
import { useCallback } from "react";
import { ensureContainer, mountIsland } from "@/lib/mount";
import { useWindowEvent } from "@/lib/bridge";
import { OPEN_SHARE, REQUEST_VISIBILITY, type Visibility } from "./share/api";
import { confirmVisibility, setShareOpen } from "./share/store";
import { VisibilityDialog } from "./share/visibility-dialog";

function Island() {
  useWindowEvent(
    OPEN_SHARE,
    useCallback(() => setShareOpen(true), []),
  );
  useWindowEvent(
    REQUEST_VISIBILITY,
    useCallback((event: Event) => {
      const visibility = (event as CustomEvent<{ visibility?: Visibility }>).detail?.visibility;
      if (visibility === "public" || visibility === "private") confirmVisibility(visibility);
    }, []),
  );
  return <VisibilityDialog />;
}

mountIsland(
  "share",
  () => ensureContainer("bd-share-root"),
  () => <Island />,
);
