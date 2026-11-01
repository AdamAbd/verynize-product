// Island entry: storage. Document size against the shared-file limits (web/storage-limits.js) and
// room asset uploads (web/cloud-assets.js): a meter in the Share panel (#cloud-dialog, rendered by
// web/cloud-panel.js), threshold toasts and the blocking size error.
import { createPortal } from "react-dom";
import { mountIsland, ensureContainer } from "@/lib/mount";
import { StorageMeter } from "./storage/storage-meter";
import { StorageAlerts } from "./storage/storage-alerts";

/** The meter's host inside the Share panel, right after its status line. */
function meterHost() {
  const status = document.getElementById("cloud-status");
  if (!status) return null;
  let host = document.getElementById("bd-storage-meter");
  if (!host) {
    host = document.createElement("div");
    host.id = "bd-storage-meter";
    host.setAttribute("data-bd", "");
    status.after(host);
  }
  return host;
}

function Island() {
  const host = meterHost();
  return (
    <>
      {host && createPortal(<StorageMeter />, host)}
      <StorageAlerts />
    </>
  );
}

mountIsland(
  "storage",
  () => ensureContainer("bd-storage-root"),
  () => <Island />,
);
