import { useLayoutEffect } from "react";
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  type NavigateOptions,
  type RouterHistory,
} from "@tanstack/react-router";
import type { SectionId } from "@/islands/settings/api";
import { DEFAULT_SETTINGS_SECTION, isSettingsSection } from "@/lib/router/settings-sections";
import { hosted, shellHost } from "@/lib/router/host";
import "@/lib/bridge";

// Shell routes (docs/spikes/tanstack-router.md). The URL is the single source of truth for the top-level shell:
//   /                    Files home      body.files-view
//   /editor              editor          (no view class)
//   /code                Code workspace  body.code-mode
//   /settings[/section]  settings overlay (body.settings-open) over the view named in history state
// Legacy entry points (fileLibrary.showHome/showEditor, appSettings.open/close/select, agentWorkspace.setCodeMode)
// are requests: they call request() (via window.shellRequest, web/shell-request.js), which writes history and applies
// the resulting shell. Router-driven changes (navigate(), Back/Forward, reload, typed URLs) are applied by the route
// components. Both apply through applyShell(), which calls the legacy appliers (applyHome/applyEditor,
// applyOpen/applyClose, applyCodeMode) and nothing else.
// Cloud fragments (#room=<id>&token=<capability>, #public=<id>) are never routes and never move into
// the query string: every shell navigation keeps them unless clearRoomHash() drops them.
//
// One router owns navigation per page:
// - Standalone (desktop app://verynize, file://, a static web/ server): this module creates the router, its history and
//   the route components below.
// - Hosted (the web app, web-start/): TanStack Start registers window.verynizeShellHost before booting the legacy
//   editor. This module then creates no history and no router: it uses Start's router and history, navigate() goes
//   through Start's router, and Start's route components (web-start/src/routes/_editor/*) apply their location with
//   window.shellNavigation.applyLocation. Requests, settings history and the cloud fragment rules are the same.

export type ViewPath = "/" | "/editor" | "/code";
type Shell = { view: ViewPath; settings: SectionId | null };
type EntryState = { settingsUnder?: ViewPath; settingsPushed?: boolean; __TSR_key?: string };
export type ShellRequest = { view: ViewPath } | { settings: string | null };

const DEFAULT_SECTION = DEFAULT_SETTINGS_SECTION;
const isSection = isSettingsSection;
const VIEWS: readonly string[] = ["/", "/editor", "/code"];
const isView = (value: unknown): value is ViewPath => VIEWS.includes(value as string);
const isSettingsPath = (path: string) => path === "/settings" || path.startsWith("/settings/");

const host = shellHost();
/** Whether Start's router owns navigation (the web app). Desktop and file:// run standalone. */
export { hosted };

/* ---------- Legacy appliers (DOM + body classes only; they never touch history) ---------- */

type LegacyShell = {
  fileLibrary?: { applyHome?(): void; applyEditor?(): void };
  appSettings?: {
    applyOpen?(section: string): void;
    applyClose?(): void;
    getState(): { open: boolean; section: string };
  };
  agentWorkspace?: { applyCodeMode?(on: boolean): void };
};
const legacy = () => window as unknown as LegacyShell;
const body = () => document.body.classList;

/** The shell the DOM shows right now. */
function shown(): Shell {
  const section = legacy().appSettings?.getState().section;
  return {
    view: body().contains("code-mode") ? "/code" : body().contains("files-view") ? "/" : "/editor",
    settings: body().contains("settings-open")
      ? isSection(section)
        ? section
        : DEFAULT_SECTION
      : null,
  };
}
const same = (a: Shell, b: Shell) => a.view === b.view && a.settings === b.settings;

function applyShell(next: Shell) {
  const { fileLibrary, appSettings, agentWorkspace } = legacy();
  agentWorkspace?.applyCodeMode?.(next.view === "/code");
  if (next.view === "/") fileLibrary?.applyHome?.();
  else fileLibrary?.applyEditor?.();
  // Hosted, Start's settings route renders the overlay and owns its open state and section
  // (web-start/src/routes/_editor/settings.tsx); here only the view underneath is applied.
  if (hosted) return;
  if (next.settings) appSettings?.applyOpen?.(next.settings);
  else appSettings?.applyClose?.();
}

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

// A file URL cannot push /editor and its fragment belongs to cloud invitations: memory history, starting on the
// legacy startup view (editor). Desktop (app://verynize) and the web own the real path.
// Hosted, Start's server already redirects /index.html and its history is the page's history.
const fileProtocol = !host && location.protocol === "file:";
if (!host && !fileProtocol && location.pathname === "/index.html") {
  window.history.replaceState(window.history.state, "", `/${location.search}${location.hash}`);
}
// The entry's own state, before createBrowserHistory gives a state-less entry a fresh key.
const rawStartState = (host ? host.initialState : window.history.state) as EntryState | null;
const history: RouterHistory = host
  ? host.router.history
  : fileProtocol
    ? createMemoryHistory({ initialEntries: [shown().view] })
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

/* ---------- History ---------- */

const entryState = () => history.location.state as EntryState;
const settingsStateOf = ({ settingsUnder, settingsPushed }: EntryState): EntryState => ({
  ...(settingsUnder ? { settingsUnder } : {}),
  ...(settingsPushed ? { settingsPushed } : {}),
});
// Shell requests write the history directly (search kept; the wrapper keeps the cloud fragment) and the router
// follows its notification. router.navigate compares against router.latestLocation, which lags a push made in the
// same tick (showHome(); showEditor()), and would drop the second change as "same location".
function commit(path: string, mode: "push" | "replace", state: EntryState = {}) {
  history[mode](path + history.location.search, { ...state, __hashScrollIntoViewOptions: false });
}
const pathOf = (shell: Shell) => (shell.settings ? `/settings/${shell.settings}` : shell.view);

/** The shell a history location names; settings entries without state open over the shown view. */
function shellAt(location: { pathname: string; state: unknown }): Shell | null {
  const { pathname } = location;
  if (isView(pathname)) return { view: pathname, settings: null };
  if (!isSettingsPath(pathname)) return null;
  const section = pathname.slice("/settings/".length);
  const under = (location.state as EntryState).settingsUnder;
  return {
    view: isView(under) ? under : shown().view,
    settings: isSection(section) ? section : DEFAULT_SECTION,
  };
}

// Closing settings steps back to the entry it was pushed from, so no entry is added and Forward can reopen it.
// history.back() lands asynchronously (popstate); until then the current entry is still /settings/…:
// - requests made meanwhile are applied at once and committed after landing (`desired`);
// - routes skip applying (the settings entry they render is no longer the shell);
// - the settings entry's key is kept in sessionStorage, so a reload before landing comes back closed.
let closing: { key: string | undefined; landed: Shell; desired: Shell | null } | null = null;
const CLOSING_KEY = "verynize.shell.closing";
type ClosingMark = { key?: string; path: string; under: ViewPath };
const storeClosing = (mark: ClosingMark | null) => {
  try {
    if (mark) sessionStorage.setItem(CLOSING_KEY, JSON.stringify(mark));
    else sessionStorage.removeItem(CLOSING_KEY);
  } catch {}
};
const storedClosing = (): Partial<ClosingMark> | null => {
  try {
    return JSON.parse(sessionStorage.getItem(CLOSING_KEY) ?? "null");
  } catch {
    return null;
  }
};

/** The shell the URL stands for once pending work lands. */
function logical(): Shell {
  if (closing) return closing.desired ?? closing.landed;
  return shellAt(history.location) ?? shown();
}

function transition(from: Shell, next: Shell, replace = false) {
  const state = entryState();
  if (next.settings) {
    // Opening settings pushes one entry that remembers the view underneath; switching sections replaces it, so Back
    // always closes settings in one step.
    if (from.settings) commit(pathOf(next), "replace", settingsStateOf(state));
    else
      commit(pathOf(next), replace ? "replace" : "push", {
        settingsUnder: from.view,
        ...(replace ? {} : { settingsPushed: true }),
      });
    return;
  }
  if (from.settings && from.view === next.view) {
    if (state.settingsPushed && state.settingsUnder === next.view && history.canGoBack()) {
      const key = state.__TSR_key;
      closing = { key, landed: next, desired: null };
      storeClosing({ key, path: history.location.pathname, under: next.view });
      history.flush();
      history.back();
      // A traversal that never lands (blocked, or a cross-document entry that reloads the page anyway) must not
      // leave the shell waiting: replace the settings entry instead.
      setTimeout(() => {
        if (!closing || closing.key !== key || entryState().__TSR_key !== key) return;
        const target = closing.desired ?? closing.landed;
        closing = null;
        storeClosing(null);
        commit(pathOf(target), "replace", target.settings ? { settingsUnder: target.view } : {});
      }, 1000);
    } else commit(next.view, "replace");
    return;
  }
  commit(next.view, replace ? "replace" : "push");
}

// The mark outlives landing until the next history change: Chromium can deliver the landing popstate and still
// reload the settings entry when a reload was requested before it landed.
let landedKey: string | undefined;
history.subscribe(({ location }) => {
  const key = (location.state as EntryState).__TSR_key;
  if (landedKey !== undefined && key !== landedKey) {
    landedKey = undefined;
    storeClosing(null);
  }
  if (!closing || key === closing.key) return;
  const { desired } = closing;
  closing = null;
  landedKey = key;
  const at = shellAt(location);
  if (desired && at && !same(at, desired)) transition(at, desired);
});

function resolve(from: Shell, target: ShellRequest): Shell {
  if ("view" in target) return { view: target.view, settings: null };
  if (target.settings === null) return { view: from.view, settings: null };
  return {
    view: from.view,
    settings: isSection(target.settings) ? target.settings : DEFAULT_SECTION,
  };
}

/**
 * A shell change requested by app code (legacy entry points go through window.shellRequest). It writes history at
 * once and applies the shell synchronously, so callers that read body classes or getState() right after still see
 * the new view. Repeated requests for the current shell do not touch history.
 *   {view}       show a view (closes settings)
 *   {settings}   open settings at that section over the current view, or switch sections
 *   {settings: null}  close settings
 */
export function request(target: ShellRequest, { replace = false }: { replace?: boolean } = {}) {
  const from = logical();
  const next = resolve(from, target);
  applyShell(next);
  if (same(from, next)) return true;
  if (closing) closing.desired = next;
  else transition(from, next, replace);
  return true;
}

/**
 * Whether the page still shows the entry it was loaded on, at `path`, and that load was a fresh navigation (no
 * history state: not a reload or Back/Forward).
 */
export const isLaunchEntry = (path: ViewPath) =>
  !rawStartState?.__TSR_key &&
  entryState().__TSR_key === launchKey &&
  history.location.pathname === path;

/* ---------- Route components: URL → shell ---------- */

// The last history change, so a settings entry pushed by a plain router navigation (no state) can still record
// the view it was pushed from.
let lastPath = history.location.pathname;
let fromPath = "";
let lastAction = "";
history.subscribe(({ location, action }) => {
  fromPath = lastPath;
  lastPath = location.pathname;
  lastAction = action.type;
});

/** The area a route stands for: a view, or the settings overlay (any /settings path). */
export type ShellArea = ViewPath | "/settings";
type RenderedLocation = { pathname: string; state: unknown };
const ownsPath = (area: ShellArea, path: string) =>
  area === "/settings" ? isSettingsPath(path) : path === area;

/**
 * Applies a location rendered by the route of `area` (this module's route components standalone, Start's route
 * components hosted). Skipped when it is not the current history entry (a request already committed and applied a
 * newer one, which the router renders next, or settings is closing through history.back()), and when it is not that
 * area's path: a leaving route component renders the next location once before it unmounts.
 */
export function applyLocation(area: ShellArea, location: RenderedLocation) {
  const key = (location.state as EntryState).__TSR_key;
  if (closing || key !== entryState().__TSR_key || !ownsPath(area, location.pathname)) return false;
  if (area === "/settings") applySettingsLocation(location);
  else applyShell({ view: area, settings: null });
  return true;
}

/** Applies the current history entry (hosted: Start's routes rendered it before this bundle ran). */
export function applyCurrentLocation() {
  const { pathname } = history.location;
  const area = isView(pathname) ? pathname : isSettingsPath(pathname) ? "/settings" : null;
  return area ? applyLocation(area, history.location) : false;
}

function areaRoute(area: ShellArea) {
  return function AreaRoute() {
    const location = useLocation();
    const key = (location.state as EntryState).__TSR_key;
    useLayoutEffect(() => {
      applyLocation(area, location);
      // Every push/replace gets a new entry key, so the key identifies the location.
    }, [key]); // oxlint-disable-line react-hooks/exhaustive-deps
    return null;
  };
}

// The section comes from the location, not useParams(): a route component can render the next location once with
// the previous match's params.
function applySettingsLocation(location: RenderedLocation) {
  const state = location.state as EntryState;
  const section = location.pathname.slice("/settings/".length);
  const wanted = isSection(section) ? section : DEFAULT_SECTION;
  // A reloaded or Back/Forward-reached settings entry restores the view it was opened over. Without state: a push
  // from a view entry opens over that view; a typed/shared URL over the shown view (the editor, the legacy startup
  // view, on a fresh load).
  let record: EntryState | null = null;
  if (!isView(state.settingsUnder))
    record =
      lastAction === "PUSH" && isView(fromPath)
        ? { settingsUnder: fromPath, settingsPushed: true }
        : { settingsUnder: shown().view };
  const view = record?.settingsUnder ?? state.settingsUnder ?? "/editor";
  applyShell({ view, settings: wanted });
  // Canonical URL (/settings and unknown sections become /settings/<section>) and recorded state, both in place.
  if (record || location.pathname !== `/settings/${wanted}`)
    commit(`/settings/${wanted}`, "replace", { ...settingsStateOf(state), ...record });
}

// The standalone route tree. Hosted, Start's file routes (web-start/src/routes/_editor/) have the same paths and
// apply the same areas.
function createShellRouter() {
  const root = createRootRoute();
  const route = <const Path extends string>(path: Path, area: ShellArea) =>
    createRoute({ getParentRoute: () => root, path, component: areaRoute(area) });
  return createRouter({
    routeTree: root.addChildren([
      route("/", "/"),
      route("/editor", "/editor"),
      route("/code", "/code"),
      route("/settings", "/settings"),
      route("/settings/$section", "/settings"),
    ]),
    history,
    scrollRestoration: false,
    defaultHashScrollIntoView: false,
    defaultNotFoundComponent: () => null,
  });
}
// Registered as the app router in register.d.ts (desktop program only; the web app registers Start's router).
export type ShellRouter = ReturnType<typeof createShellRouter>;

/* ---------- Startup ---------- */

const launchKey = entryState().__TSR_key;

// A reload while settings was closing (history.back() not landed yet) comes back closed, on the view underneath.
// Chromium can drop the entry's state when a reload cancels the traversal, so a state-less entry on the same path
// counts too.
const closingAtLoad = storedClosing();
storeClosing(null);
if (
  closingAtLoad &&
  closingAtLoad.path === history.location.pathname &&
  isView(closingAtLoad.under) &&
  (!rawStartState?.__TSR_key || rawStartState.__TSR_key === closingAtLoad.key)
)
  commit(closingAtLoad.under, "replace");

// Requests made before this bundle ran (web/shell-request.js applied and queued them) are newer than the startup
// URL: fold them onto it and replace the entry, so the first route render applies the same shell.
type ShellRequestFn = ((target: ShellRequest, apply?: () => void) => unknown) & {
  pending?: ShellRequest[];
};
const queued = (window as unknown as { shellRequest?: ShellRequestFn }).shellRequest?.pending ?? [];
if (queued.length) {
  const start = shellAt(history.location) ?? shown();
  let next = start;
  for (const target of queued.splice(0)) next = resolve(next, target);
  if (!same(start, next))
    commit(pathOf(next), "replace", next.settings ? { settingsUnder: next.view } : {});
}

/**
 * The page's router. Hosted, this is Start's router (same public paths), so app code, Back/Forward and Start's own
 * navigation go through one router and one history.
 */
export const shellRouter: ShellRouter = host ? (host.router as ShellRouter) : createShellRouter();

/**
 * The one entry point for shell navigation from app code. Search is kept, scroll is left alone, and
 * the cloud fragment is kept by the history wrapper above (hosted, it wraps Start's history).
 */
export function navigate(options: NavigateOptions) {
  return shellRouter.navigate({ search: true, resetScroll: false, ...options });
}

// A small imperative entry point for shell integrations, legacy requests and tests (file:// history included).
declare global {
  interface Window {
    shellRouter: typeof shellRouter;
    shellNavigation: {
      navigate: typeof navigate;
      request: typeof request;
      clearRoomHash: typeof clearRoomHash;
      applyLocation: typeof applyLocation;
    };
  }
}
window.shellRouter = shellRouter;
window.shellNavigation = { navigate, request, clearRoomHash, applyLocation };
