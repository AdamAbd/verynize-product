// The one-line text prompt behind `window.askText(title, value)` (file and folder names, variable names, repository
// URLs, …), rendered by this island in place of the legacy web/ui.js dialog. It keeps the native modal <dialog> and
// its ids (#text-prompt, #text-prompt-label, #text-prompt-input, #text-prompt-ok): settings.css styles them and
// tests drive them (DialogEnhancer in dialogs.tsx adds the primary button look). Resolves the entered text on
// Continue (Enter) and null on Cancel or Escape; a call while a prompt
// is open resolves null at once, like the legacy prompt.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

type Request = { title: string; value: string; resolve: (value: string | null) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function askText(title: string, value = ""): Promise<string | null> {
  if (current) return Promise.resolve(null);
  return new Promise((resolve) => {
    current = { title: String(title), value: String(value ?? ""), resolve };
    emit();
  });
}

function settle(result: string | null) {
  const request = current;
  current = null;
  emit();
  request?.resolve(result);
}

// Registered when the UI bundle runs, before the islands mount; a prompt asked before the first render opens with it.
window.askText = askText;

export function TextPrompt() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    const field = input.current;
    if (!element || !field) return;
    if (!request) {
      if (element.open) element.close();
      return;
    }
    field.value = request.value;
    element.returnValue = "cancel";
    if (!element.open) element.showModal();
    field.focus();
    field.select();
  }, [request]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const closed = () => {
      if (!current) return;
      settle(element.returnValue === "ok" ? (input.current?.value ?? "") : null);
    };
    element.addEventListener("close", closed);
    return () => element.removeEventListener("close", closed);
  }, []);

  return (
    <dialog id="text-prompt" ref={dialog} aria-labelledby="text-prompt-label">
      <form method="dialog">
        <label id="text-prompt-label" htmlFor="text-prompt-input">
          {request?.title}
        </label>
        <input id="text-prompt-input" ref={input} autoComplete="off" />
        <div>
          {/* Not a submit button, so Enter in the field means Continue. */}
          <button type="button" onClick={() => dialog.current?.close("cancel")}>
            Cancel
          </button>
          <button type="submit" value="ok" id="text-prompt-ok">
            Continue
          </button>
        </div>
      </form>
    </dialog>
  );
}
