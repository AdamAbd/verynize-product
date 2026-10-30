// Typed view of the cloud account kept by web/cloud-panel.js (window.cloudAccount): the one
// email + password session shared by onboarding, the workspace switcher and Settings › Members.
// Organizations are Better Auth's (cloud/auth.js); room access follows them (cloud/orgs.js).
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type CloudProfile = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
};
export type CloudAccountState = {
  server: string;
  account: CloudProfile;
  /** True for email + password (Better Auth) sessions; false for legacy passkey sessions. */
  emailAccount: boolean;
  personalOrganizationId: string | null;
};
type CloudAccountApi = {
  defaultServer(): string;
  get(): CloudAccountState | null;
  signIn(o: { server: string; email: string; password: string }): Promise<CloudProfile>;
  signUp(o: { server: string; email: string; password: string; name?: string }): Promise<void>;
  forgotPassword(o: { server: string; email: string }): Promise<void>;
  signOut(everywhere?: boolean): Promise<void>;
  request<T = unknown>(path: string, options?: RequestInit): Promise<T>;
  activeOrganization(): string | null;
  setActiveOrganization(id: string): void;
};

declare global {
  interface Window {
    cloudAccount?: CloudAccountApi;
  }
}

export const cloudAccount = () => window.cloudAccount ?? null;

const subscribe = (fn: () => void) => {
  const events = ["cloud-account-changed", "cloud-organization-changed"];
  for (const name of events) window.addEventListener(name, fn);
  return () => {
    for (const name of events) window.removeEventListener(name, fn);
  };
};
let cached: { key: string; value: CloudAccountState | null } = { key: "", value: null };
const snapshot = () => {
  const value = cloudAccount()?.get() ?? null;
  const key = value ? `${value.server}|${value.account.email}|${value.account.displayName}` : "";
  if (key !== cached.key) cached = { key, value };
  return cached.value;
};
/** The signed-in cloud account, re-rendering on sign in, sign out and profile changes. */
export function useCloudAccount(): CloudAccountState | null {
  return useSyncExternalStore(subscribe, snapshot);
}
/** The active workspace (organization id) of the file browser. */
export function useActiveOrganization(): string | null {
  return useSyncExternalStore(subscribe, () => cloudAccount()?.activeOrganization() ?? null);
}

export type Organization = {
  id: string;
  name: string;
  slug: string;
  metadata?: unknown;
  createdAt?: string;
};
export type OrganizationMember = {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; image?: string | null };
};
export type OrganizationInvitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  organizationId: string;
  organizationName?: string;
};
export type FullOrganization = Organization & {
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
};

const metadataOf = (org: Pick<Organization, "metadata">): Record<string, unknown> => {
  if (org.metadata && typeof org.metadata === "object")
    return org.metadata as Record<string, unknown>;
  try {
    return JSON.parse(String(org.metadata || "null")) || {};
  } catch {
    return {};
  }
};
export const isPersonal = (org: Pick<Organization, "metadata">) =>
  metadataOf(org).personal === true;
export const MEMBER_ROOM_ROLES = ["viewer", "commenter", "editor"] as const;
export type MemberRoomRole = (typeof MEMBER_ROOM_ROLES)[number];
export const memberRoomRole = (org: Pick<Organization, "metadata">): MemberRoomRole => {
  const role = metadataOf(org).roomRole;
  return MEMBER_ROOM_ROLES.includes(role as MemberRoomRole) ? (role as MemberRoomRole) : "editor";
};
export const roleNames = (role: string | null | undefined) =>
  String(role || "member")
    .split(",")
    .map((value) => value.trim());
export const canManage = (role: string | null | undefined) =>
  roleNames(role).some((value) => value === "owner" || value === "admin");

/** Better Auth endpoint under /api/auth on the account's server. */
export function authRequest<T = unknown>(path: string, body?: unknown): Promise<T> {
  const api = cloudAccount();
  if (!api) return Promise.reject(Error("Cloud accounts are not available"));
  return api.request<T>(
    "/api/auth" + path,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
}

// One shared organization list for every island, so a workspace that was just created or joined
// is listed before it becomes the active one.
const orgStore = {
  key: "",
  list: [] as Organization[],
  error: "",
  listeners: new Set<() => void>(),
  pending: null as Promise<void> | null,
};
const notifyOrganizations = () => orgStore.listeners.forEach((fn) => fn());
/** Reload the organizations of the signed-in email account (personal first). */
export function reloadOrganizations(): Promise<void> {
  const account = cloudAccount()?.get() ?? null;
  const key = account?.emailAccount ? `${account.server}|${account.account.email}` : "";
  if (!key) {
    orgStore.key = "";
    orgStore.list = [];
    notifyOrganizations();
    return Promise.resolve();
  }
  const run = authRequest<Organization[]>("/organization/list").then(
    (list) => {
      list.sort(
        (a, b) => Number(isPersonal(b)) - Number(isPersonal(a)) || a.name.localeCompare(b.name),
      );
      orgStore.key = key;
      orgStore.list = list;
      orgStore.error = "";
      notifyOrganizations();
    },
    (e: unknown) => {
      orgStore.error = e instanceof Error ? e.message : String(e);
      notifyOrganizations();
    },
  );
  orgStore.pending = run;
  return run;
}
const subscribeOrganizations = (fn: () => void) => {
  orgStore.listeners.add(fn);
  return () => orgStore.listeners.delete(fn);
};
/** The organizations of the signed-in email account, personal first; refreshes on changes. */
export function useOrganizations() {
  const account = useCloudAccount();
  const organizations = useSyncExternalStore(subscribeOrganizations, () => orgStore.list);
  const error = useSyncExternalStore(subscribeOrganizations, () => orgStore.error);
  useEffect(() => {
    void reloadOrganizations();
  }, [account]);
  const reload = useCallback(() => reloadOrganizations(), []);
  return { account, organizations, error, reload };
}
/** Reload the shared list (after create, leave, accept…); resolves once it is current. */
export const organizationsChanged = () => reloadOrganizations();

/** Sign-in entry: the desktop onboarding, or the Share panel's account section on the web. */
export function openSignIn() {
  if ((window as unknown as { desktop?: unknown }).desktop)
    window.dispatchEvent(new Event("bd:open-onboarding"));
  else {
    document.getElementById("cloud-toggle")?.click();
    const section = document.getElementById("cloud-account-section") as HTMLDetailsElement | null;
    if (section) section.open = true;
  }
}
