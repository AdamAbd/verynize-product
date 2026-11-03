// Confirmation before changing a file's visibility (Wonder SV2-confirm / SV2-private-confirm), shared by the
// Share popover and the File menu ("Make file public" / "Make file private").
import { useState } from "react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { needsSignIn, shareService, type Visibility } from "./api";
import { askSignIn, confirmVisibility, useShareUi } from "./store";

const COPY: Record<Visibility, { title: string; action: string }> = {
  public: { title: "Make this file public?", action: "Make public" },
  private: { title: "Make this file private?", action: "Make private" },
};

/** Change the visibility (creating the room first for a local file); a signed-out user signs in, then it runs. */
export async function applyVisibility(visibility: Visibility): Promise<boolean> {
  const service = shareService();
  if (!service) return false;
  try {
    await service.setVisibility(visibility);
    return true;
  } catch (error) {
    if (needsSignIn(error)) askSignIn(() => void applyVisibility(visibility));
    else toast.error((error as Error).message || "The file visibility could not be changed.");
    return false;
  }
}

export function VisibilityDialog() {
  const { confirm } = useShareUi();
  const [shown, setShown] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  if (confirm && confirm !== shown) setShown(confirm);
  const copy = COPY[shown];

  const run = async () => {
    setBusy(true);
    try {
      await applyVisibility(shown);
    } finally {
      setBusy(false);
      confirmVisibility(null);
    }
  };

  return (
    <Dialog.Root
      open={!!confirm}
      onOpenChange={(open) => !open && !busy && confirmVisibility(null)}
    >
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay data-share-dialog="" className="fixed inset-0 z-50 bg-share-scrim" />
        <Dialog.Content
          id="share-visibility-dialog"
          data-share-dialog=""
          data-visibility={shown}
          className="fixed top-1/2 left-1/2 z-50 w-share-dialog -translate-1/2 overflow-hidden rounded-2xl bg-share-dialog text-sm shadow-share outline-none"
        >
          <div className="flex flex-col px-4 pt-4 pb-6">
            <Dialog.Title className="m-0 text-lg leading-5.5 font-semibold text-foreground">
              {copy.title}
            </Dialog.Title>
            {shown === "public" ? (
              <>
                <Dialog.Description className="m-0 mt-2 text-base leading-5 text-muted-foreground">
                  Review what changes before making this file public.
                </Dialog.Description>
                <ul className="m-0 mt-4 flex list-disc flex-col gap-2 pl-4 text-base leading-5 text-foreground-2 marker:text-muted-foreground">
                  <li>Anyone with the link can view in read-only mode.</li>
                  <li>No Verynize sign-in is needed to open.</li>
                  <li>You can make it private again at any time.</li>
                </ul>
              </>
            ) : (
              <>
                <Dialog.Description className="m-0 mt-2 text-base leading-5 text-muted-foreground">
                  Only members of this organization will be able to open it.
                </Dialog.Description>
                <p
                  role="note"
                  className="m-0 mt-4 flex gap-2.5 rounded-lg bg-share-warning px-3 py-2.5 text-base leading-5 text-share-warning-foreground"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Existing public links will stop working and anyone currently viewing will lose
                  access.
                </p>
              </>
            )}
          </div>
          <div className="flex h-13 items-center justify-end gap-2 border-t border-card-border bg-card px-3">
            <Dialog.Close
              disabled={busy}
              className="h-7 rounded-md px-3 text-base text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              id="share-visibility-confirm"
              disabled={busy}
              aria-busy={busy || undefined}
              className="h-7 rounded-md bg-share-danger px-3 text-base text-primary-foreground outline-none hover:bg-share-danger-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card disabled:opacity-60"
              onClick={() => void run()}
            >
              {copy.action}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
