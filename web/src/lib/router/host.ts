// Whether the page runs hosted by the web app (TanStack Start, web-start/): Start's router is then the page's router
// and Start's routes render the areas moved out of ui.js (web-start/README.md "One router"). Desktop and file://
// run standalone. Side-effect free, so islands can read it without starting the shell router.
import type { AnyRouter } from "@tanstack/react-router";

/** Registered by the Start app (web-start/src/legacy/shell-host.ts) before the legacy editor boots. */
export type ShellHost = {
  /** Start's router: the only router and history on the page. */
  router: AnyRouter;
  /** window.history.state as the page was loaded, before Start's history keyed the entry. */
  initialState: unknown;
};

export const shellHost = (): ShellHost | undefined =>
  (window as unknown as { verynizeShellHost?: ShellHost }).verynizeShellHost;
/** Whether Start's router owns navigation and renders the moved areas (the web app). */
export const hosted = !!shellHost();
