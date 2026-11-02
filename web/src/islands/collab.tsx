// Island entry: collab. Collaboration in shared rooms (design/wonder/share-audit/CONTRACT.md §3 "C"): presence avatars
// and the Multiplayer tools popover next to Share, remote cursors and selections, viewer read-only mode, the removal
// notice, and opening file links in the editor (no-access screen, invitation).
import { ensureContainer, mountIsland } from "@/lib/mount";
import { installPresence } from "./collab/presence-engine";
import { installLinks } from "./collab/links";
import { Presence } from "./collab/presence";
import { ReadOnly } from "./collab/read-only";
import { AccessNotice } from "./collab/access-notice";
import { LinkScreens } from "./collab/link-screens";
import "./collab/collab.css";

installPresence();
// Links open once the shell's controls are claimed (bd:ui-ready), so the editor can show the file.
installLinks(
  new Promise<void>((resolve) => {
    if (document.documentElement.dataset.uiReady === "true") return resolve();
    window.addEventListener("bd:ui-ready", () => resolve(), { once: true });
  }),
);

mountIsland(
  "collab",
  () => ensureContainer("bd-collab-root"),
  () => (
    <>
      <Presence />
      <ReadOnly />
      <AccessNotice />
      <LinkScreens />
    </>
  ),
);
