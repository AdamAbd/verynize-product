// One connection snapshot for settings. A CLI install/login is not a SIWC connection.
import { useSyncExternalStore } from "react";
import { desktopApi } from "./workspace-ipc";

const empty = { ready: false, connected: false, profiles: new Set<string>() };
let snapshot = empty;
let generation = 0;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();

export async function refreshCodexConnection() {
  const version = ++generation;
  const api = desktopApi();
  const connected = new Set<string>();
  try {
    const list = await api?.agentProfiles?.list();
    const ids = list
      ? list.profiles.filter((p) => p.agent === "codex").map((p) => p.id)
      : ["system"];
    await Promise.allSettled(
      ids.map(async (id) => {
        const status = await api?.agentAccountStatus({
          agent: "codex",
          ...(id === "system" ? {} : { profile: id }),
        });
        if (status?.installed && status.loggedIn) connected.add(id);
      }),
    );
  } catch {
    // Hide configuration if account status cannot be verified.
  }
  if (version !== generation) return;
  if (
    snapshot.ready &&
    snapshot.profiles.size === connected.size &&
    [...connected].every((id) => snapshot.profiles.has(id))
  )
    return;
  snapshot = { ready: true, connected: connected.size > 0, profiles: connected };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const reload = () => {
      void refreshCodexConnection();
    };
    const off = desktopApi()?.onAuthEvent((event) => {
      if (event.agent === "codex" && !["started", "waiting"].includes(event.type)) reload();
    });
    window.addEventListener("bd:agent-accounts-changed", reload);
    window.addEventListener("focus", reload);
    stop = () => {
      off?.();
      window.removeEventListener("bd:agent-accounts-changed", reload);
      window.removeEventListener("focus", reload);
    };
    reload();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop?.();
      stop = undefined;
      generation++;
      snapshot = empty;
    }
  };
}

export function useCodexConnection() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => empty,
  );
}
