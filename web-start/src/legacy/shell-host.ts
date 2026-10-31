// Start's router is the only router on the web page. The legacy editor's shell router
// (web/src/lib/router/shell-router.ts, inside web/dist/ui.js) runs "hosted" when it finds
// window.verynizeShellHost: it creates no history and no router of its own, navigates through this
// router, and Start's route components tell it which area to show (useShellArea).
import { useLayoutEffect } from "react";
import { useLocation, type AnyRouter } from "@tanstack/react-router";

/** An area of the editor page: a view, or the settings overlay (any /settings path). */
export type ShellArea = "/" | "/editor" | "/code" | "/settings";

type ShellLocation = { pathname: string; state: unknown };
declare global {
  interface Window {
    verynizeShellHost?: { router: AnyRouter; initialState: unknown };
    /** Set by the shell router once ui.js has run. */
    shellNavigation?: { applyLocation(area: ShellArea, location: ShellLocation): boolean };
  }
}

// The entry's own state before Start's browser history gives a state-less entry a key. router.tsx
// imports this module, so it is read before the router (and its history) exists. The shell router
// tells a fresh load from a reload or Back/Forward with it.
const initialState = typeof window === "undefined" ? null : (window.history.state as unknown);

/** Registers Start's router as the navigation owner. Must run before the legacy editor boots. */
export function installShellHost(router: AnyRouter) {
  window.verynizeShellHost ??= { router, initialState };
}

/**
 * Route components call this with the area they stand for. Each rendered location (keyed by its
 * history entry) is applied to the legacy views; before ui.js has run there is nothing to apply and
 * the shell router applies the current entry itself when it starts.
 */
export function useShellArea(area: ShellArea) {
  const location = useLocation();
  const key = location.state.__TSR_key;
  useLayoutEffect(() => {
    window.shellNavigation?.applyLocation(area, location);
  }, [key]); // oxlint-disable-line react-hooks/exhaustive-deps
}
