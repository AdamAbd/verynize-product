// Share popover state shared by its entry points (inspector Share button, sidebar file-header lock, File menu,
// code workspace): open/closed, the sign-in step, the pending visibility confirmation.
import { useSyncExternalStore } from "react";
import type { Visibility } from "./api";

type ShareUi = {
  open: boolean;
  /** Signed out and a share action is waiting: the popover asks to sign in, then runs it. */
  signIn: boolean;
  /** Visibility awaiting the confirmation dialog. */
  confirm: Visibility | null;
};

let state: ShareUi = { open: false, signIn: false, confirm: null };
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<ShareUi>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};

export function useShareUi(): ShareUi {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export const setShareOpen = (open: boolean) => {
  if (!open) pending = null;
  set(open ? { open } : { open, signIn: false });
};
/** Show the sign-in step in the popover; `then` runs once signed in. */
export const askSignIn = (then: () => void) => {
  pending = then;
  set({ open: true, signIn: true });
};
export const signedIn = () => {
  const next = pending;
  pending = null;
  set({ signIn: false });
  next?.();
};
export const cancelSignIn = () => {
  pending = null;
  set({ signIn: false });
};
export const confirmVisibility = (visibility: Visibility | null) => set({ confirm: visibility });
