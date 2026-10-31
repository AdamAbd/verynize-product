// Design style picker in the composer: a chip beside the model and access controls that pins one entry of the
// runtime's design style catalog (window.desktop.designStylesList) for the next runs. "Auto" (no style) lets the agent
// choose. The pick is remembered for the session (localStorage) and read by web/desktop-panel.js when it composes a
// task, through window.chatDesignStyle.get(); the run request then carries it as `designStyle`.
// Hidden when the desktop build has no style catalog. "/style" (slash command) opens it.
import { useEffect, useState, useSyncExternalStore } from "react";
import { PaletteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatChipButton } from "./controls";
import { ChatMenu, ChatMenuContent, ChatMenuLabel, ChatMenuOptionItem, ChatMenuRadioGroup, ChatMenuSeparator, ChatMenuTrigger } from "./menu";

export type DesignStyle = { id: string; name: string; summary?: string };
type StyleDesktop = { designStylesList?(): Promise<DesignStyle[]> };

const STORAGE_KEY = "verynize.chat.design-style";
export const OPEN_STYLE_PICKER_EVENT = "bd:open-style-picker";

const styleDesktop = () => (window as unknown as { desktop?: StyleDesktop }).desktop;
/** Whether this desktop build offers the style catalog. */
export const hasStyleCatalog = () => typeof styleDesktop()?.designStylesList === "function";

/* ---------- Selected style (one value for the session, shared with desktop-panel.js) ---------- */
const listeners = new Set<() => void>();
let current = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
})();

function setDesignStyle(id: string) {
  const next = typeof id === "string" ? id.trim() : "";
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage full or unavailable: the choice still holds until reload.
  }
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

declare global {
  interface Window {
    /** Composer design style (empty = Auto). Read by web/desktop-panel.js when a task is composed. */
    chatDesignStyle?: { get(): string; set(id: string): void };
  }
}
// Only a style the catalog offers is sent; an unknown leftover id (older catalog) falls back to Auto.
let known: Set<string> | null = null;
window.chatDesignStyle = {
  get: () => (current && hasStyleCatalog() && (!known || known.has(current)) ? current : ""),
  set: setDesignStyle,
};

/* ---------- Catalog (loaded once per page) ---------- */
let catalog: Promise<DesignStyle[]> | null = null;
function loadStyles(): Promise<DesignStyle[]> {
  const list = styleDesktop()?.designStylesList;
  if (!list) return Promise.resolve([]);
  catalog ??= list()
    .then((items) => {
      const styles = (Array.isArray(items) ? items : []).filter((s) => s && typeof s.id === "string" && s.id);
      known = new Set(styles.map((s) => s.id));
      return styles;
    })
    .catch(() => {
      catalog = null;
      return [];
    });
  return catalog;
}

function useStyles(): DesignStyle[] {
  const [styles, setStyles] = useState<DesignStyle[]>([]);
  useEffect(() => {
    let live = true;
    loadStyles().then((value) => live && setStyles(value));
    return () => {
      live = false;
    };
  }, []);
  return styles;
}

const AUTO = "";

export function StylePicker() {
  const selected = useSyncExternalStore(subscribe, () => current);
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_STYLE_PICKER_EVENT, show);
    return () => window.removeEventListener(OPEN_STYLE_PICKER_EVENT, show);
  }, []);

  if (!hasStyleCatalog() || styles.length === 0) return null;
  const active = styles.find((s) => s.id === selected);
  const label = active ? active.name : "Auto";
  return (
    <ChatMenu open={open} onOpenChange={setOpen} modal={false}>
      <ChatMenuTrigger asChild>
        <ChatChipButton
          id="chat-style-picker"
          data-style-id={active?.id ?? AUTO}
          aria-label={`Design style: ${label}`}
          title={active?.summary ?? "Design style: the agent picks one that fits the brief"}
        >
          <PaletteIcon className={cn("size-3.5", active ? "text-foreground-2" : "text-muted-foreground")} />
          <span className="max-w-28 truncate">{active ? active.name : "Style"}</span>
        </ChatChipButton>
      </ChatMenuTrigger>
      <ChatMenuContent
        id="chat-style-menu"
        align="start"
        side="top"
        className="max-h-(--radix-dropdown-menu-content-available-height) w-72 overflow-y-auto"
      >
        <ChatMenuLabel>Design style</ChatMenuLabel>
        <ChatMenuRadioGroup value={active?.id ?? AUTO} onValueChange={setDesignStyle}>
          <ChatMenuOptionItem value={AUTO} data-style-id={AUTO}>
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground">Auto</span>
              <span className="text-xs leading-4 text-muted-foreground">Let the agent choose a direction from the brief.</span>
            </span>
          </ChatMenuOptionItem>
          <ChatMenuSeparator />
          {styles.map((style) => (
            <ChatMenuOptionItem key={style.id} value={style.id} data-style-id={style.id} textValue={style.name}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-foreground">{style.name}</span>
                {style.summary && <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{style.summary}</span>}
              </span>
            </ChatMenuOptionItem>
          ))}
        </ChatMenuRadioGroup>
      </ChatMenuContent>
    </ChatMenu>
  );
}
