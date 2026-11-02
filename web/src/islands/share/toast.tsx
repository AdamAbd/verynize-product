// Share confirmations (Wonder SI3-result "Invitation sent", SL1-copied "Link copied to clipboard."): a 360 × 40
// toast with a green check and a round Dismiss button, in the app's bottom-right toaster (settings island).
import { toast } from "sonner";
import { Check, X } from "lucide-react";

export function shareToast(message: string) {
  toast.custom(
    (id) => (
      <div
        data-share-toast=""
        role="status"
        className="relative flex h-10 w-share-toast items-center gap-2.5 rounded-xl bg-background px-3.5 text-base text-foreground shadow-share"
      >
        <Check className="size-4 shrink-0 text-share-success" aria-hidden />
        <span className="truncate">{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          className="absolute -top-2.5 -right-2.5 flex size-6 items-center justify-center rounded-full border border-edge bg-background text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => toast.dismiss(id)}
        >
          <X className="size-3" />
        </button>
      </div>
    ),
    { duration: 4000 },
  );
}
