import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
// Imported here so it reads the page's initial history state before this router creates its history.
import "./legacy/shell-host";

export function getRouter() {
  return createRouter({
    routeTree,
    // This is the page's only router and history. The legacy shell router runs hosted on it
    // (legacy/shell-host.ts) and owns scrolling inside the editor; `#room=`/`#public=` fragments
    // are invitations, not anchors to scroll to.
    scrollRestoration: false,
    defaultHashScrollIntoView: false,
    defaultNotFoundComponent: NotFound,
  });
}

function NotFound() {
  return (
    <main className="not-found">
      <h1>Page not found</h1>
      <p>
        <a href="/">Open Verynize</a>
      </p>
    </main>
  );
}
