import { useLayoutEffect } from "react";
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import "@/lib/bridge";

function currentView() {
  return document.body.classList.contains("files-view") ? "/" : "/editor";
}

let applyingRoute = false;
function applyView(path: "/" | "/editor") {
  if (currentView() === path) return;
  applyingRoute = true;
  try {
    window.appSettings?.close?.();
    const show = window.fileLibrary?.[path === "/" ? "showHome" : "showEditor"];
    if (typeof show === "function") show();
  } finally {
    applyingRoute = false;
  }
}

function HomeRoute() {
  useLayoutEffect(() => applyView("/"), []);
  return null;
}

function EditorRoute() {
  useLayoutEffect(() => applyView("/editor"), []);
  return null;
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
const root = createRootRoute();
const home = createRoute({ getParentRoute: () => root, path: "/", component: HomeRoute });
const editor = createRoute({ getParentRoute: () => root, path: "/editor", component: EditorRoute });

export const shellRouter = createRouter({
  routeTree: root.addChildren([home, editor]),
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

// Compare with history (updated immediately), not the asynchronously committed
// route state. Repeated legacy renders/open calls must not add history entries.
window.addEventListener("bd:view-change", () => {
  const to = currentView();
  if (applyingRoute || history.location.pathname === to) return;
  void shellRouter.navigate({
    to,
    hash: location.hash.slice(1),
    search: true,
    resetScroll: false,
  });
});

// A small imperative entry point for shell integrations (and file:// history).
declare global {
  interface Window {
    shellRouter: typeof shellRouter;
  }
}
window.shellRouter = shellRouter;
