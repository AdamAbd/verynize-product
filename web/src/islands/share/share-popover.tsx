// Share popover (Wonder share-audit SH2): "Share", email chips + role + Invite, the workspace note with Manage
// members, File visibility, Copy link. Anchored below the inspector's Share button, right-aligned, 384 wide.
// Opened by that button, the sidebar file-header lock and openSharePopover(); Escape and outside clicks close it
// and focus returns to Share. Tab wraps inside, like Wonder (SH3-focus-order).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { Link2, Check } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { useActiveOrganization, useCloudAccount, useOrganizations } from "@/lib/cloud-account";
import { cn } from "@/lib/utils";
import { needsSignIn, shareService, useCloudState, type InviteRole, type RoomAccess } from "./api";
import { EmailField, type Chip, type EmailFieldHandle } from "./email-field";
import { RoleMenu, VisibilityMenu } from "./menus";
import { SignInStep } from "./sign-in";
import { askSignIn, confirmVisibility, setShareOpen, useShareUi } from "./store";
import { shareToast } from "./toast";

const EMPTY_MESSAGE = "Enter an email address to invite.";
const INVALID_MESSAGE = "Fix or remove the highlighted address.";
const OWNERS_ONLY = "Only owners and admins can invite people.";
const VISIBILITY_OWNERS_ONLY = "Only owners and admins can change this";

/** Copy inside the popover: a field appended to the body would move focus outside and close it. */
async function copyText(text: string, host: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // The desktop denies the clipboard permission (desktop/main.cjs).
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("aria-hidden", "true");
  field.tabIndex = -1;
  field.className = "fixed size-px opacity-0";
  (host ?? document.body).append(field);
  const focused = document.activeElement as HTMLElement | null;
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  focused?.focus({ preventScroll: true });
  if (!copied) throw Error("Couldn't copy the link");
}

/** Layers that belong to the popover although they render elsewhere: its confirmation dialog and toasts. */
const OWNED = "[data-share-dialog], [data-sonner-toaster]";

const focusables = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]:not([tabindex='-1'])"),
  ).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && el.offsetParent !== null,
  );

function useWorkspaceName(access: RoomAccess | null, connected: boolean) {
  const { organizations } = useOrganizations();
  const active = useActiveOrganization();
  if (connected) return access?.organization?.name ?? null;
  return organizations.find((org) => org.id === active)?.name ?? organizations[0]?.name ?? null;
}

function OwnerAvatar() {
  const account = useCloudAccount();
  const profile = account?.account;
  // Signed out (a local file), the name the app knows from Preferences, like the inspector's account button.
  const prefs = (window.appPreferences?.get?.() ?? {}) as { displayName?: string; name?: string };
  const name =
    profile?.displayName || profile?.email || prefs.displayName || prefs.name || "Verynize";
  if (profile?.avatarUrl)
    return (
      <img src={profile.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
    );
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-base font-medium text-primary-text"
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

function ShareBody({ host }: { host: () => HTMLElement | null }) {
  const cloud = useCloudState();
  const field = useRef<EmailFieldHandle>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [role, setRole] = useState<InviteRole>("viewer");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const workspace = useWorkspaceName(access, cloud.connected);

  // The room's access (role, visibility, workspace) each time the popover opens or the room changes.
  useEffect(() => {
    let live = true;
    setAccess(null);
    if (cloud.connected)
      shareService()
        ?.access()
        .then((value) => live && setAccess(value))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [cloud.connected, cloud.roomId]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  const myRole = access?.you.role ?? cloud.role;
  // A local file becomes a room the user owns; in a room the server says what this account may do.
  const canInvite = !cloud.connected || (access ? access.you.canInvite : myRole === "owner");
  const canChangeVisibility =
    !cloud.connected || (access ? access.you.canChangeVisibility : myRole === "owner");
  const visibility = cloud.visibility ?? "private";

  const submit = async () => {
    const list = field.current?.commit() ?? chips;
    if (!list.length) return setMessage(EMPTY_MESSAGE);
    if (list.some((chip) => chip.invalid)) return setMessage(INVALID_MESSAGE);
    const service = shareService();
    if (!service) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await service.invite(
        list.map((chip) => chip.email),
        role,
      );
      const failed = new Map(
        result.errors.map((error) => [error.email.toLowerCase(), error.message]),
      );
      if (failed.size) {
        setChips(
          list
            .filter((chip) => failed.has(chip.email.toLowerCase()))
            .map((chip) => ({ ...chip, invalid: true })),
        );
        setMessage(
          failed.size === 1 && list.length === 1
            ? [...failed.values()][0] || INVALID_MESSAGE
            : INVALID_MESSAGE,
        );
      } else setChips([]);
      if (result.invited.some((item) => item.status === "invited")) shareToast("Invitation sent");
      else if (result.invited.length)
        shareToast(
          result.invited.length === 1
            ? `${result.invited[0].email} is already a member`
            : "Already members",
        );
    } catch (error) {
      if (needsSignIn(error)) askSignIn(() => void submit());
      else setMessage((error as Error).message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => field.current?.focus());
    }
  };

  const copyLink = async () => {
    const service = shareService();
    if (!service) return;
    try {
      await service.ensureRoom();
      await copyText(service.shareLink(), host());
      setCopied(true);
      shareToast("Link copied to clipboard.");
    } catch (error) {
      if (needsSignIn(error)) askSignIn(() => void copyLink());
      else toast.error((error as Error).message || "Couldn't copy the link");
    }
  };

  // Wonder rings the field red for both messages (SH3-empty-enter, SI1-invalid).
  const invalid =
    message === EMPTY_MESSAGE || message === INVALID_MESSAGE || chips.some((chip) => chip.invalid);
  return (
    <>
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <EmailField
            ref={field}
            chips={chips}
            onChipsChange={(next) => {
              setChips(next);
              if (next.some((chip) => chip.invalid)) setMessage(INVALID_MESSAGE);
              else if (message === INVALID_MESSAGE) setMessage("");
            }}
            onSubmit={() => void submit()}
            onEdit={() => message === EMPTY_MESSAGE && setMessage("")}
            disabled={busy || !canInvite}
            invalid={invalid}
          />
          {message && (
            <p
              id="share-invite-error"
              role="alert"
              className="m-0 mt-1 text-sm leading-4 text-share-error"
            >
              {message}
            </p>
          )}
        </div>
        <RoleMenu role={role} onRoleChange={setRole} disabled={busy || !canInvite} />
        <button
          type="button"
          id="share-invite"
          disabled={busy || !canInvite}
          aria-busy={busy || undefined}
          className="h-7 shrink-0 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-60 disabled:hover:bg-primary"
          onClick={() => void submit()}
        >
          Invite
        </button>
      </div>
      <p id="share-members-note" className="m-0 mt-2 text-sm leading-4 text-share-muted">
        {canInvite ? (
          <>
            New members can access all files in{" "}
            <b className="font-medium text-foreground">{workspace || "your workspace"}</b>.{" "}
          </>
        ) : (
          <>{OWNERS_ONLY} </>
        )}
        <button
          type="button"
          id="share-manage-members"
          className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => {
            setShareOpen(false);
            window.appSettings?.open("members");
          }}
        >
          Manage members
        </button>
      </p>
      <p className="m-0 mt-5 text-sm leading-4 text-menu-label">File visibility</p>
      <VisibilityMenu
        visibility={visibility}
        disabled={!canChangeVisibility}
        reason={VISIBILITY_OWNERS_ONLY}
        onSelect={(next) => confirmVisibility(next)}
        avatar={
          visibility === "public" ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-input text-muted-foreground">
              <Link2 className="size-4" aria-hidden />
            </span>
          ) : (
            <OwnerAvatar />
          )
        }
      />
      <button
        type="button"
        id="share-copy-link"
        data-copied={copied || undefined}
        className="-mx-0.5 mt-3.5 flex h-6 items-center justify-center gap-1.5 rounded-md bg-input text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => void copyLink()}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Link2 className="size-3.5" aria-hidden />
        )}
        Copy link
      </button>
    </>
  );
}

/** The inspector's Share button with its popover (`#cloud-toggle` stays the button's id for callers and tests). */
export function ShareButton() {
  const ui = useShareUi();
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // The canvas stops pointerdown from bubbling, which Radix's outside-click detection relies on: close on the
  // capture phase instead (Wonder SH3-outside: a click on the canvas dismisses the popover).
  useEffect(() => {
    if (!ui.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        !target?.closest ||
        content.current?.contains(target) ||
        trigger.current?.contains(target)
      )
        return;
      if (target.closest(`${OWNED}, [data-radix-popper-content-wrapper]`)) return;
      setShareOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ui.open]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !content.current) return;
    const items = focusables(content.current);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <Popover.Root open={ui.open} onOpenChange={setShareOpen}>
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          id="cloud-toggle"
          aria-label="Share file"
          className="static h-6 shrink-0 rounded-md border-0 bg-primary px-2 py-0 text-xs font-medium text-primary-foreground hover:bg-primary-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          Share
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer()}>
        <Popover.Content
          ref={content}
          id="share-popover"
          role="dialog"
          aria-label="Share"
          align="end"
          side="bottom"
          sideOffset={5}
          collisionPadding={8}
          data-step={ui.signIn ? "sign-in" : "share"}
          className={cn(
            "z-50 flex w-share flex-col rounded-share bg-background px-3 pt-2.5 pb-2.5 text-sm text-foreground shadow-share outline-none",
          )}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const target = content.current?.querySelector<HTMLElement>(
              ui.signIn
                ? "#share-sign-in-email"
                : "input[aria-label='Emails to invite']:not(:disabled)",
            );
            (target ?? (content.current && focusables(content.current)[0]))?.focus();
          }}
          onInteractOutside={(event) => {
            // The visibility confirmation and the share toasts belong to the popover.
            const target = event.target as Element | null;
            if (target?.closest?.(OWNED)) event.preventDefault();
          }}
        >
          <h2 className="m-0 h-4 text-sm leading-4 font-medium text-foreground">Share</h2>
          {/* The share step stays mounted under the sign-in step: typed chips and the waiting action survive it. */}
          {ui.signIn && (
            <div className="mt-3 flex flex-col">
              <SignInStep />
            </div>
          )}
          <div className="mt-3 flex flex-col" hidden={ui.signIn}>
            <ShareBody host={() => content.current} />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
