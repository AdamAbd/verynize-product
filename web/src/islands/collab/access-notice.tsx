// Removal or "made private" while the file is open (B5): web/cloud-panel.js detaches the room (the local copy stays)
// and fires `cloud-access-revoked`; the canvas says so with Wonder's string.
import { useCallback } from "react";
import { toast } from "sonner";
import { useWindowEvent } from "@/lib/bridge";

type Detail = { reason?: string; fileName?: string };

export function AccessNotice() {
  useWindowEvent(
    "cloud-access-revoked",
    useCallback((event: Event) => {
      const { reason, fileName } = ((event as CustomEvent<Detail>).detail ?? {}) as Detail;
      toast(`You no longer have access to “${fileName || "Untitled"}”`, {
        id: "cloud-access-revoked",
        description:
          reason === "private"
            ? "The owner made this file private. Your copy stays on this device."
            : "Your copy stays on this device.",
        duration: 10000,
      });
    }, []),
  );
  return null;
}
