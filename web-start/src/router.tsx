import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // The legacy shell router (web/src/lib/router/shell-router.ts) shares this window's history and
    // owns scrolling inside the editor.
    scrollRestoration: false,
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
