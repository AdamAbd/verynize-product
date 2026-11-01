// Island entry: storage. Document size against the shared-file limits (web/storage-limits.js) and
// room asset uploads (web/cloud-assets.js): a meter in the Share panel (#cloud-dialog, rendered by
// web/cloud-panel.js), threshold toasts and the blocking size error.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { mountIsland, ensureContainer } from "@/lib/mount";
import { useDesign } from "@/lib/bridge";
import { limits } from "./storage/limits";
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

/** Forwards document changes to the debounced measurement (web/storage-limits.js). */
function MeasureFeed() {
  const doc = useDesign();
  useEffect(() => limits()?.noteChange(doc), [doc]);
  return null;
}

function Island() {
  const host = meterHost();
  return (
    <>
      <MeasureFeed />
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
