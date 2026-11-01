// Size alerts outside the Share panel: a toast when the open document crosses 80 % of a limit or
// goes over one, and a blocking dialog when a sync, save or share was stopped by a limit while the
// Share panel is closed (inside it, the meter shows the error: a native modal dialog would cover ours).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWindowEvent } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStorageReport, type Level, type StorageProblem } from "./limits";
import { worstLevel } from "./storage-meter";

const RANK: Record<Level, number> = { ok: 0, warn: 1, over: 2 };

export function StorageAlerts() {
  const report = useStorageReport();
  // The problem the toast is about ("level:scope:page"): a new one is announced once, a cleared
  // one dismisses it, and growing or shrinking sizes of the same problem stay quiet.
  const previous = useRef("ok");
  useEffect(() => {
    if (!report) return;
    const level = worstLevel(report.problems);
    const problem = report.problems[0];
    const key = problem ? `${level}:${problem.scope}:${problem.pageId ?? ""}` : "ok";
    const before = previous.current;
    previous.current = key;
    if (key === before) return;
    if (!problem) toast.dismiss("storage-limit");
    else if (RANK[level] < RANK[(before.split(":")[0] as Level) || "ok"])
      toast.dismiss("storage-limit");
    else if (level === "over") toast.error(problem.message, { id: "storage-limit" });
    else toast.warning(problem.message, { id: "storage-limit" });
  }, [report]);

  const [blocked, setBlocked] = useState<StorageProblem | null>(null);
  useWindowEvent(
    "storage-limit-error",
    useCallback((event: Event) => {
      if (document.getElementById("cloud-dialog")?.hasAttribute("open")) return;
      setBlocked((event as CustomEvent<StorageProblem>).detail);
    }, []),
  );
  return (
    <Dialog open={!!blocked} onOpenChange={(open) => !open && setBlocked(null)}>
      <DialogContent id="storage-limit-dialog" className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>File is too large to {blocked?.action ?? "sync"}</DialogTitle>
          <DialogDescription>{blocked?.message}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Your changes are kept on this device. Split large pages into several pages or files, or
          replace large embedded files, then try again.
        </p>
        <DialogFooter>
          <Button size="sm" onClick={() => setBlocked(null)} aria-label="Close size error">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
