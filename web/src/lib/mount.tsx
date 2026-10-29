import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/styles/globals.css";

// The shell is a fixed one-viewport layout; undo any document scroll caused by focus or scrollIntoView
// (panels scroll inside their own containers).
let scrollGuard = false;
function guardDocumentScroll() {
  if (scrollGuard) return;
  scrollGuard = true;
  document.addEventListener("scroll", () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
}

/**
 * Mount an island once the legacy scripts have run.
 * `target` is the element the island renders into (created if it is a string id that does not exist yet).
 */
export function mountIsland(name: string, target: HTMLElement | (() => HTMLElement), node: () => ReactNode) {
  guardDocumentScroll();
  const start = () => {
    const container = typeof target === "function" ? target() : target;
    container.setAttribute("data-bd", "");
    container.dataset.island = name;
    createRoot(container).render(
      <StrictMode>
        <TooltipProvider delayDuration={400}>{node()}</TooltipProvider>
      </StrictMode>,
    );
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

/** Create (or reuse) a container element with an id, appended to `parent` (default: body). */
export function ensureContainer(id: string, parent: Element = document.body, tag = "div"): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    parent.append(el);
  }
  return el;
}
