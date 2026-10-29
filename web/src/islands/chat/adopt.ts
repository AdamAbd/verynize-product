// Legacy controls that desktop-panel.js keeps writing to (prompt value, Send/Queue text, Stop disabled, model input)
// are *adopted*: the original element (same id, same listeners) is moved into an island slot and restyled, then put
// back where it came from when the slot unmounts. Tests and legacy code keep finding them by id.
import { useCallback } from "react";

export function useAdopt(id: string, setup?: (el: HTMLElement) => (() => void) | void) {
  return useCallback(
    (slot: HTMLElement | null) => {
      if (!slot) return;
      const el = document.getElementById(id);
      if (!el) return;
      const parent = el.parentNode;
      const next = el.nextSibling;
      const previousClass = el.getAttribute("class");
      const wasHidden = el.dataset.bdHidden;
      delete el.dataset.bdHidden;
      slot.append(el);
      const teardown = setup?.(el);
      return () => {
        teardown?.();
        if (previousClass === null) el.removeAttribute("class");
        else el.setAttribute("class", previousClass);
        if (wasHidden) el.dataset.bdHidden = wasHidden;
        if (parent) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      };
    },
    // `setup` is expected to be stable for the slot's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
}
