import { useLayoutEffect } from "react";
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type NavigateOptions,
  type RouterHistory,
} from "@tanstack/react-router";
import type { SectionId } from "@/islands/settings/api";
import "@/lib/bridge";

// Shell routes (docs/spikes/tanstack-router.md):
//   /                    Files home
//   /editor              editor
//   /settings[/section]  settings overlay; the view underneath lives in history state, not the URL
// Cloud fragments (#room=<id>&token=<capability>, #public=<id>) are never routes and never move into
// the query string: every shell navigation keeps them unless clearRoomHash() drops them.

type ViewPath = "/" | "/editor";
type SettingsState = { settingsUnder?: ViewPath; settingsPushed?: boolean };

const SECTIONS: readonly SectionId[] = [
  "account",
  "preferences",
  "agents",
  "accounts",
  "tools",
  "projects",
  "usage",
  "models",
  "connections",
  "memory",
  "members",
  "permissions",
];
const DEFAULT_SECTION: SectionId = "preferences";
const isSection = (value: unknown): value is SectionId => SECTIONS.includes(value as SectionId);

const body = () => document.body.classList;
const currentView = (): ViewPath => (body().contains("files-view") ? "/" : "/editor");
const settingsOpen = () => body().contains("settings-open");
// The bridge types only open/close; settings.js also exposes select and getState.
type SettingsApi = {
  open(section?: string): void;
  close(): void;
  select(section: string): void;
  getState(): { open: boolean; section: string };
};
const appSettings = () => window.appSettings as SettingsApi | undefined;
const settingsSection = (): SectionId => {
  const section = appSettings()?.getState().section;
  return isSection(section) ? section : DEFAULT_SECTION;
};
/** The path the legacy shell currently shows. */
const shellPath = () =>
  settingsOpen() ? `/settings/${settingsSection()}` : (currentView() as string);
const isSettingsPath = (path: string) => path === "/settings" || path.startsWith("/settings/");

/* ---------- Cloud fragment preservation (by construction) ---------- */

const ROOM_HASH = /^#(?:room|public)=/;
const roomHash = (hash: string) => (ROOM_HASH.test(hash) ? hash : "");
const roomOf = (hash: string) => new URLSearchParams(hash.slice(1)).get("room");
// Rooms left in this page session. Back/Forward onto an older entry of a left room drops its fragment
// again instead of resurrecting the invite (a later reload would re-prompt to join).
const leftRooms = new Set<string>();

/**
 * Every push/replace keeps the current #room=/#public= fragment unless the target names its own
 * fragment. This wraps the history object itself, so router.navigate, <Link>, history.push and
 * window.shellRouter all preserve it; no caller has to remember `hash: true`.
 */
function preserveCloudFragment(history: RouterHistory) {
  const raw = { push: history.push, replace: history.replace };
  const withFragment = (path: string) => {
    const keep = roomHash(history.location.hash);
    return keep && !path.includes("#") ? path + keep : path;
  };
  const currentHref = () => history.location.href;
  history.push = (path, state, opts) => {
    const next = withFragment(path);
    // The fragment can turn a push into the current URL (navigate({to: "/editor"}) on
    // /editor#room=…): replace instead of adding a duplicate entry.
    if (next === currentHref()) raw.replace(next, state, opts);
    else raw.push(next, state, opts);
  };
  history.replace = (path, state, opts) => raw.replace(withFragment(path), state, opts);
  const dropFragment = () => {
    const { pathname, search, state } = history.location;
    raw.replace(pathname + search, state);
  };
  history.subscribe(({ action }) => {
    if (action.type === "PUSH" || action.type === "REPLACE") return;
    const room = roomOf(history.location.hash);
    if (room && leftRooms.has(room)) dropFragment();
  });
  return dropFragment;
}

// A file URL cannot push /editor and its fragment belongs to cloud invitations.
// Preserve the existing desktop startup view; only web/app URLs own the path.
const fileProtocol = location.protocol === "file:";
if (!fileProtocol && location.pathname === "/index.html") {
  window.history.replaceState(window.history.state, "", `/${location.search}${location.hash}`);
}
const history = fileProtocol
  ? createMemoryHistory({ initialEntries: [currentView()] })
  : createBrowserHistory();
// Memory history never owns the address bar, so the real fragment is already untouched there.
const dropFragment = fileProtocol
  ? () => window.history.replaceState(window.history.state, "", location.pathname + location.search)
  : preserveCloudFragment(history);

/**
 * Leaving a room removes its fragment from the current entry (and from older entries when Back/
 * Forward reaches them), so a reload does not offer to join it again. `#public=` is never cleared.
 */
export function clearRoomHash(roomId?: string) {
  const room = roomOf(location.hash);
  if (!room || (roomId && room !== roomId)) return;
  leftRooms.add(room);
  dropFragment();
}

/* ---------- Route effects: route → legacy shell ---------- */

let applyingRoute = false;
// Set while our own history.back() (closing settings) is in flight: the shell is already right, the
// entry we land on adopts it instead of re-applying its own view.
let adoptShellOnLanding = false;

function applyView(path: ViewPath) {
  applyingRoute = true;
  try {
    if (settingsOpen()) appSettings()?.close();
    if (currentView() === path) return;
    const show = window.fileLibrary?.[path === "/" ? "showHome" : "showEditor"];
    if (typeof show === "function") show();
  } finally {
    applyingRoute = false;
  }
}

function viewRoute(path: ViewPath) {
  return function ViewRoute() {
    useLayoutEffect(() => {
      if (adoptShellOnLanding) {
        adoptShellOnLanding = false;
        syncFromShell();
        return;
      }
      // A stale route: the shell moved on (e.g. settings opened before the router's first render) and
      // history already points elsewhere; the router renders that entry next, so don't undo it here.
      if (history.location.pathname !== path) return;
      applyView(path);
    }, []);
    return null;
  };
}

// The last history change, so a settings entry pushed by a plain router navigation (no state) can
// still record the view it was pushed from.
let lastPath = history.location.pathname;
let fromPath = "";
let lastAction = "";
history.subscribe(({ location, action }) => {
  fromPath = lastPath;
  lastPath = location.pathname;
  lastAction = action.type;
});

function applySettings(section: string | undefined) {
  const state = history.location.state as SettingsState;
  const wanted = isSection(section) ? section : DEFAULT_SECTION;
  // A reloaded or Back/Forward-reached settings entry restores the view it was opened over. Without
  // state: a push from a view entry opens over that view; a typed/shared URL over the current view
  // (the editor, the legacy startup view, on a fresh load).
  let record: SettingsState | null = null;
  if (!state.settingsUnder)
    record =
      lastAction === "PUSH" && (fromPath === "/" || fromPath === "/editor")
        ? { settingsUnder: fromPath, settingsPushed: true }
        : { settingsUnder: currentView() };
  const under = state.settingsUnder ?? record?.settingsUnder ?? "/editor";
  applyingRoute = true;
  try {
    if (!settingsOpen() && currentView() !== under) {
      const show = window.fileLibrary?.[under === "/" ? "showHome" : "showEditor"];
      if (typeof show === "function") show();
    }
    if (!settingsOpen()) appSettings()?.open(wanted);
    else if (settingsSection() !== wanted) appSettings()?.select(wanted);
  } finally {
    applyingRoute = false;
  }
  // Canonical URL (/settings and unknown sections become /settings/<section>) and recorded state,
  // both in place.
  if (record || history.location.pathname !== `/settings/${wanted}`)
    commit(`/settings/${wanted}`, "replace", { ...settingsStateOf(state), ...record });
}

function useSettingsRoute(section?: string) {
  useLayoutEffect(() => applySettings(section), [section]);
}

const root = createRootRoute();
const home = createRoute({ getParentRoute: () => root, path: "/", component: viewRoute("/") });
const editor = createRoute({
  getParentRoute: () => root,
  path: "/editor",
  component: viewRoute("/editor"),
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: function SettingsRoute() {
    useSettingsRoute();
    return null;
  },
});
const settingsSectionRoute = createRoute({
  getParentRoute: () => root,
  path: "/settings/$section",
  component: function SettingsSectionRoute() {
    useSettingsRoute(settingsSectionRoute.useParams().section);
    return null;
  },
});

// The shell can change before this bundle runs (settings opened or the Files home shown while ui.js is
// still loading, before any bd:view-change listener exists). Adopt it so the first route doesn't undo
// it. A reload of a routed URL lands on the legacy default (editor, settings closed) and the routes
// apply the URL as usual.
if (settingsOpen() || (currentView() === "/" && history.location.pathname !== "/")) {
  const to = shellPath();
  commit(to, "replace", isSettingsPath(to) ? { settingsUnder: currentView() } : {});
}

export const shellRouter = createRouter({
  routeTree: root.addChildren([home, editor, settings, settingsSectionRoute]),
  history,
  scrollRestoration: false,
  defaultHashScrollIntoView: false,
  defaultNotFoundComponent: () => null,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof shellRouter;
  }
}

/**
 * The one entry point for shell navigation from app code. Search is kept, scroll is left alone, and
 * the cloud fragment is kept by the history wrapper above.
 */
export function navigate(options: NavigateOptions) {
  return shellRouter.navigate({ search: true, resetScroll: false, ...options });
}

/* ---------- Shell → URL ---------- */

const settingsStateOf = ({ settingsUnder, settingsPushed }: SettingsState): SettingsState => ({
  ...(settingsUnder ? { settingsUnder } : {}),
  ...(settingsPushed ? { settingsPushed } : {}),
});
// Shell-driven URL changes write the history directly (search kept; the wrapper keeps the cloud
// fragment) and the router follows its notification. router.navigate compares against
// router.latestLocation, which lags a push made in the same tick (showHome(); showEditor()), and
// would drop the second change as "same location".
function commit(path: string, mode: "push" | "replace", state: SettingsState = {}) {
  history[mode](path + history.location.search, { ...state, __hashScrollIntoViewOptions: false });
}

// Compare with history (updated immediately), not the asynchronously committed
// route state. Repeated legacy renders/open calls must not add history entries.
function syncFromShell() {
  if (applyingRoute || adoptShellOnLanding) return;
  const to = shellPath();
  const at = history.location.pathname;
  if (at === to) return;
  const state = history.location.state as SettingsState;
  if (isSettingsPath(to)) {
    // Opening settings pushes one entry that remembers the view underneath; switching
    // sections replaces it, so Back always closes settings in one step.
    if (isSettingsPath(at)) commit(to, "replace", settingsStateOf(state));
    else
      commit(to, "push", {
        settingsUnder: at === "/" || at === "/editor" ? at : currentView(),
        settingsPushed: true,
      });
    return;
  }
  if (isSettingsPath(at)) {
    // Closing settings returns to the entry it was opened from instead of adding one.
    if (state.settingsPushed && state.settingsUnder === to) {
      adoptShellOnLanding = true;
      history.back();
    } else commit(to, "replace");
    return;
  }
  commit(to, "push");
}
window.addEventListener("bd:view-change", syncFromShell);

// A small imperative entry point for shell integrations (and file:// history).
declare global {
  interface Window {
    shellRouter: typeof shellRouter;
    shellNavigation: { navigate: typeof navigate; clearRoomHash: typeof clearRoomHash };
  }
}
window.shellRouter = shellRouter;
window.shellNavigation = { navigate, clearRoomHash };
