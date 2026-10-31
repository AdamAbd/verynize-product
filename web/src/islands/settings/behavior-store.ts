// Renderer cache of the agent behaviour settings (desktop/agent-behavior.cjs, `window.desktop.agentBehavior`).
// Published as `window.agentBehavior = {get, set, subscribe}` so the legacy chat panel (web/desktop-panel.js: follow-ups,
// per-repository modes) and the chat island (expanded agent work) read the same values synchronously.
// Changes are announced with the `verynize:agent-behavior` window event.
import { useSyncExternalStore } from "react";
import { platform } from "@/lib/platform";

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
export type BehaviorPatch = Partial<Omit<AgentBehavior, "repoModes">> & { repoModes?: Record<string, Access | null> };
export type OutputStyle = { id: string; name: string; description?: string; source?: string };
export type CommitAuthor = { name: string; email: string; login: string | null; linked: boolean | null };
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

/** Saves a change; the returned promise rejects with the main-process validation error. */
export async function setBehavior(patch: BehaviorPatch) {
  const ipc = behaviorIpc();
  if (!ipc) throw new Error("Available in the desktop app");
  const next = await ipc.set(patch);
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
  if (!ipc) return Promise.resolve(current);
  return ipc.get().then(
    (next) => (publish(next), next),
    () => current,
  );
}

export function useBehavior() {
  return useSyncExternalStore(subscribe, () => current);
}
export const behaviorLoaded = () => loaded;

// Publish the global once, at bundle load.
if (typeof window !== "undefined" && !(window as unknown as { agentBehavior?: unknown }).agentBehavior) {
  (window as unknown as { agentBehavior: unknown }).agentBehavior = {
    get: () => current,
    set: setBehavior,
    subscribe,
  };
  void reloadBehavior();
}
