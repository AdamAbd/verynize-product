// Renderer cache of the agent behaviour settings (desktop/agent-behavior.cjs, `window.desktop.agentBehavior`).
// Published as `window.agentBehavior = {get, set, subscribe}` so the legacy chat panel (web/desktop-panel.js: follow-ups,
// per-repository modes) and the chat island (expanded agent work) read the same values synchronously.
// Changes are announced with the `verynize:agent-behavior` window event.
import { useSyncExternalStore } from "react";
import { platform } from "@/lib/platform";
import "@/lib/account-store";

export type Access = "ask" | "edit" | "auto" | "full";
export type AgentBehavior = {
  followUp: "queue" | "steer";
  expandWork: boolean;
  claudeOutputStyle: string;
  codexPersonality: "default" | "none";
  creditAgent: boolean;
  folder: string;
  branchPrefix: string;
  repoModes: Record<string, Access>;
  /** Read-only, computed by main. */
  displayFolder?: string;
  defaultFolder?: string;
};
/** A change: repoModes entries set to null go back to the Default. */
export type BehaviorPatch = Partial<Omit<AgentBehavior, "repoModes">> & {
  repoModes?: Record<string, Access | null>;
};
export type OutputStyle = { id: string; name: string; description?: string; source?: string };
export type CommitAuthor = {
  name: string;
  email: string;
  login: string | null;
  linked: boolean | null;
};
export type AllowGroup = {
  id: string;
  agent: "verynize" | "claude" | "codex";
  scope: string;
  global: boolean;
  file: string;
  rules: { id: string; title: string; raw: string }[];
};
export type BehaviorIpc = {
  get(): Promise<AgentBehavior>;
  set(patch: BehaviorPatch): Promise<AgentBehavior>;
  chooseFolder(): Promise<AgentBehavior>;
  outputStyles(): Promise<{ styles: OutputStyle[]; current: string | null }>;
  commitAuthor(): Promise<CommitAuthor>;
  allowList(): Promise<AllowGroup[]>;
  allowRemove(id: string): Promise<{ removed: boolean }>;
  allowOpen(groupId: string): Promise<boolean>;
};

export const DEFAULT_BEHAVIOR: AgentBehavior = {
  followUp: "queue",
  expandWork: false,
  claudeOutputStyle: "",
  codexPersonality: "default",
  creditAgent: true,
  folder: "",
  branchPrefix: "",
  repoModes: {},
};

export const behaviorIpc = (): BehaviorIpc | null => platform.desktop?.agentBehavior ?? null;

let current: AgentBehavior = DEFAULT_BEHAVIOR;
let loaded = false;
let accountId = window.cloudAccount?.get()?.account.id ?? null;
const listeners = new Set<() => void>();
function publish(next: AgentBehavior) {
  current = next;
  loaded = true;
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new CustomEvent("verynize:agent-behavior", { detail: next }));
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const portableKeys = [
  "followUp",
  "expandWork",
  "claudeOutputStyle",
  "codexPersonality",
  "creditAgent",
  "branchPrefix",
] as const;
function portableBehavior() {
  const patch: BehaviorPatch = {};
  for (const [key, value] of window.accountStore?.entries("preference:behavior.") ?? []) {
    if (key === "followUp" && (value === "queue" || value === "steer")) patch.followUp = value;
    if (key === "codexPersonality" && (value === "default" || value === "none"))
      patch.codexPersonality = value;
    if ((key === "expandWork" || key === "creditAgent") && typeof value === "boolean")
      patch[key] = value;
    if ((key === "claudeOutputStyle" || key === "branchPrefix") && typeof value === "string")
      patch[key] = value;
  }
  return patch;
}
function syncBehavior() {
  const store = window.accountStore;
  const nextAccount = window.cloudAccount?.get()?.account.id ?? null;
  if (accountId && accountId !== nextAccount) {
    const reset = {
      followUp: DEFAULT_BEHAVIOR.followUp,
      expandWork: DEFAULT_BEHAVIOR.expandWork,
      claudeOutputStyle: DEFAULT_BEHAVIOR.claudeOutputStyle,
      codexPersonality: DEFAULT_BEHAVIOR.codexPersonality,
      creditAgent: DEFAULT_BEHAVIOR.creditAgent,
      branchPrefix: DEFAULT_BEHAVIOR.branchPrefix,
    };
    publish({ ...current, ...reset });
    void behaviorIpc()
      ?.set(reset)
      .catch(() => {});
  }
  accountId = nextAccount;
  if (!loaded || !store?.ready()) return;
  const patch = portableBehavior();
  for (const key of portableKeys)
    if (!(key in patch)) store.put(`preference:behavior.${key}`, current[key]);
  if (Object.entries(patch).every(([key, value]) => current[key as keyof AgentBehavior] === value))
    return;
  // The main process keeps the runtime's applied values; the account database owns them.
  const ipc = behaviorIpc();
  if (ipc)
    void ipc
      .set(patch)
      .then(publish)
      .catch(() => {});
  else publish({ ...current, ...patch, repoModes: current.repoModes });
}
window.addEventListener("account-store-changed", syncBehavior);

/** Saves a change; the returned promise rejects with the main-process validation error. */
export async function setBehavior(patch: BehaviorPatch) {
  const ipc = behaviorIpc();
  if (!ipc && !window.accountStore?.signedIn()) throw new Error("Sign in to save preferences");
  const next = ipc ? await ipc.set(patch) : { ...current, ...patch, repoModes: current.repoModes };
  if (window.accountStore?.signedIn()) {
    for (const key of portableKeys)
      if (key in patch) window.accountStore.put(`preference:behavior.${key}`, next[key]);
    await window.accountStore.flush();
  }
  publish(next);
  return next;
}
export async function chooseBehaviorFolder() {
  const ipc = behaviorIpc();
  if (!ipc) return current;
  const next = await ipc.chooseFolder();
  publish(next);
  return next;
}

export function reloadBehavior() {
  const ipc = behaviorIpc();
  if (!ipc) {
    loaded = true;
    syncBehavior();
    return Promise.resolve(current);
  }
  return ipc.get().then(
    (next) => {
      publish(next);
      syncBehavior();
      return next;
    },
    () => current,
  );
}

export function useBehavior() {
  return useSyncExternalStore(subscribe, () => current);
}
export const behaviorLoaded = () => loaded;

// Publish the global once, at bundle load.
if (
  typeof window !== "undefined" &&
  !(window as unknown as { agentBehavior?: unknown }).agentBehavior
) {
  (window as unknown as { agentBehavior: unknown }).agentBehavior = {
    get: () => current,
    set: setBehavior,
    subscribe,
  };
  void reloadBehavior();
}
