// What a file link shows when it cannot open (links.ts): Wonder's in-app invitation (share-audit/wonder-web/collab
// 10-in-app-invitation.png: "You have an invitation" / "Join to work with your team in a shared workspace." / the
// workspace card "<inviter> invited you as <Role>" with Decline and Join / "Maybe later"), or a "You don’t have access"
// screen with "Sign in with another account" and "Back to files" (Wonder redirects to the owner's profile instead).
import { useState } from "react";
import { Building2Icon, LockIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { authRequest, organizationsChanged, useCloudAccount } from "@/lib/cloud-account";
import {
  backToFiles,
  openRoomLink,
  signInAgain,
  useLinkScreen,
  type Invitation,
  type RoomLink,
} from "./links";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
  admin: "Admin",
  owner: "Owner",
  member: "Member",
};

function NoAccess({ link, signedIn }: { link: RoomLink; signedIn: boolean }) {
  const account = useCloudAccount();
  return (
    <div
      id="room-no-access"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-no-access-title"
      data-signed-in={signedIn ? "true" : "false"}
      className="fixed inset-x-0 top-10 bottom-0 z-50 flex items-center justify-center bg-background px-6 text-foreground"
    >
      <div className="flex w-access-screen flex-col items-center text-center">
        <span className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LockIcon className="size-4" />
        </span>
        <h1 id="room-no-access-title" className="m-0 text-base font-medium">
          {signedIn ? "You don’t have access to this file" : "Sign in to open this file"}
        </h1>
        <p className="mt-2 mb-6 text-xs text-muted-foreground">
          {signedIn
            ? `Ask its owner to invite ${account?.account.email ?? "you"}, or sign in with an account that has access.`
            : "This file is private. Sign in with an account that has access."}
        </p>
        <div className="flex gap-2">
          <Button id="room-no-access-back" variant="outline" onClick={() => backToFiles(link)}>
            Back to files
          </Button>
          <Button id="room-no-access-sign-in" onClick={() => void signInAgain(link, signedIn)}>
            {signedIn ? "Sign in with another account" : "Sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InvitationDialog({ link, invitation }: { link: RoomLink; invitation: Invitation }) {
  const [busy, setBusy] = useState<"" | "join" | "decline">("");
  const answer = async (accept: boolean) => {
    setBusy(accept ? "join" : "decline");
    try {
      await authRequest(`/organization/${accept ? "accept" : "reject"}-invitation`, {
        invitationId: invitation.id,
      });
      await organizationsChanged().catch(() => {});
      if (accept) await openRoomLink(link);
      else {
        toast("Invitation declined");
        backToFiles(link);
      }
    } catch (error) {
      toast(message(error));
    } finally {
      setBusy("");
    }
  };
  const role = ROLE_LABEL[invitation.role || "viewer"] ?? invitation.role;
  return (
    <Dialog open onOpenChange={(open) => !open && backToFiles(link)}>
      <DialogContent id="room-invitation" showCloseButton={false}>
        <DialogTitle>You have an invitation</DialogTitle>
        <DialogDescription>Join to work with your team in a shared workspace.</DialogDescription>
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
            <Building2Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm text-foreground">
              {invitation.organizationName || "A workspace"}
            </p>
            <p className="m-0 truncate text-xs text-muted-foreground">
              {invitation.inviterName || "Someone"} invited you as {role}
            </p>
          </div>
          <Button
            id="room-invitation-decline"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void answer(false)}
          >
            Decline
          </Button>
          <Button id="room-invitation-join" disabled={!!busy} onClick={() => void answer(true)}>
            Join
          </Button>
        </div>
        <div className="flex justify-end">
          <Button
            id="room-invitation-later"
            variant="outline"
            disabled={!!busy}
            onClick={() => backToFiles(link)}
          >
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LinkScreens() {
  const screen = useLinkScreen();
  if (screen.kind === "no-access")
    return <NoAccess link={screen.link} signedIn={screen.signedIn} />;
  if (screen.kind === "invitation")
    return <InvitationDialog link={screen.link} invitation={screen.invitation} />;
  return null;
}
