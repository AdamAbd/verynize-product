// Typed view of the share service in web/cloud-share.js (window.cloudWorkspace, CONTRACT.md §2) and the
// `verynize:cloud-state` event, plus the share island's own events.
import { useSyncExternalStore } from "react";

export type Visibility = "private" | "public";
export type InviteRole = "viewer" | "editor" | "admin";
export type CloudPeer = {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  self: boolean;
  busy: boolean;
};
export type CloudState = {
  connected: boolean;
  roomId: string | null;
  role: string | null;
  visibility: Visibility | null;
  peers: CloudPeer[];
};
export type RoomAccess = {
  role: string | null;
  visibility: Visibility;
  organization: { id: string; name: string } | null;
  you: { role: string | null; canInvite: boolean; canChangeVisibility: boolean };
  visibilitySupported: boolean;
};
export type InviteResult = {
  invited: { email: string; status: "invited" | "already-member" }[];
  errors: { email: string; message: string }[];
};
type ShareWorkspace = {
  ensureRoom(): Promise<{ server: string; roomId: string }>;
  access(): Promise<RoomAccess | null>;
  setVisibility(visibility: Visibility): Promise<Visibility>;
  invite(emails: string[], role: InviteRole): Promise<InviteResult>;
  shareLink(): string;
  state(): CloudState;
};

/** The share service, or null before web/cloud-share.js ran (or in a build without it). */
export const shareService = () =>
  (window as unknown as { cloudWorkspace?: Partial<ShareWorkspace> }).cloudWorkspace?.ensureRoom
    ? (window as unknown as { cloudWorkspace: ShareWorkspace }).cloudWorkspace
    : null;

/** Errors the service throws when the user must sign in first. */
export const needsSignIn = (error: unknown) =>
  (error as { code?: string } | null)?.code === "sign-in";

const EMPTY: CloudState = {
  connected: false,
  roomId: null,
  role: null,
  visibility: null,
  peers: [],
};
let current: CloudState = EMPTY;
const read = () => {
  const next = shareService()?.state() ?? EMPTY;
  if (JSON.stringify(next) !== JSON.stringify(current)) current = next;
  return current;
};
const subscribe = (fn: () => void) => {
  window.addEventListener("verynize:cloud-state", fn);
  return () => window.removeEventListener("verynize:cloud-state", fn);
};
/** Live room state: connected, role, visibility and presence. */
export function useCloudState(): CloudState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Open the Share popover from anywhere (sidebar lock, code workspace, chat gate). */
export const OPEN_SHARE = "bd:open-share";
export const openSharePopover = () => window.dispatchEvent(new Event(OPEN_SHARE));
/** Ask to change the file's visibility (File menu); the share island confirms first. */
export const REQUEST_VISIBILITY = "bd:share-visibility";
export const requestVisibility = (visibility: Visibility) =>
  window.dispatchEvent(new CustomEvent(REQUEST_VISIBILITY, { detail: { visibility } }));
