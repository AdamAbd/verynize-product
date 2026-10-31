// ⌘K command palette: a searchable list over the canvas command registry (`window.design.commands()`) plus a few
// app commands (shortcuts drawer, settings, file search, snap, saved views). Wonder binds ⌘K to its command palette
// (K1 transcript, APPLICATION section); file search stays on the title bar Search button and in this list.
import { useEffect, useMemo } from "react";
import { Dialog } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { run } from "./legacy";
import { keyChips, registryCommands, setPanelOpen, usePanelOpen } from "./shortcuts";

type PaletteCommand = {
  id: string;
  label: string;
  section: string;
  shortcut?: string;
  run: () => void;
};

/** Commands that live outside the canvas registry. */
function appCommands(): PaletteCommand[] {
  return [
    {
      id: "app.shortcuts",
      label: "Keyboard shortcuts",
      section: "Application",
      run: () => setPanelOpen("shortcuts", true),
    },
    {
      id: "app.settings",
      label: "Go to settings",
      section: "Application",
      shortcut: "⌘,",
      run: () => window.appSettings?.open(),
    },
    {
      id: "app.searchFiles",
      label: "Search files",
      section: "Application",
      run: () => run("shell-search"),
    },
    {
      id: "view.savedViews",
      label: "Saved views…",
      section: "View",
      run: () => run("saved-views-open"),
    },
    {
      id: "view.snap",
      label: "Toggle snap to objects",
      section: "View",
      // The hidden `#snap` checkbox (zoom proxies) owns the state legacy drag code reads.
      run: () => (document.getElementById("snap") as HTMLInputElement | null)?.click(),
    },
  ];
}

function paletteCommands(): PaletteCommand[] {
  const registry = registryCommands().map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    section: c.section ?? "Commands",
    shortcut: c.keys?.[0] ? keyChips(c.keys[0]).join("") : undefined,
    run: () => window.design.runCommand(c.id),
  }));
  return [...appCommands(), ...registry];
}

/** Whether ⌘K belongs to the palette here: the code workspace terminal and the Files home keep their own ⌘K. */
function paletteKeyAllowed() {
  const body = document.body.classList;
  return !["code-mode", "files-view", "settings-open", "onboarding-open"].some((c) =>
    body.contains(c),
  );
}

export function CommandPalette() {
  const open = usePanelOpen("palette");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.code !== "KeyK" || !paletteKeyAllowed()) return;
      // Capture phase: runs before wonder-shell's window ⌘K (Files search) and stops it.
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanelOpen("palette", true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <Palette /> : null;
}

/**
 * Rank by the command's label first: a label that starts with the query beats one that contains it, which beats a
 * match that only hits the command id. Every query word must appear, so "select all" never ranks "Paste over selection"
 * (cmdk's default fuzzy score does) above "Select all".
 */
function scoreCommand(value: string, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const text = value.toLowerCase();
  const label = text.slice(0, text.lastIndexOf(" "));
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 0.8;
  const words = query.split(/\s+/);
  if (words.every((word) => label.includes(word))) return 0.6;
  if (words.every((word) => text.includes(word))) return 0.3;
  return 0;
}

function Palette() {
  const commands = useMemo(paletteCommands, []);
  const sections = useMemo(() => [...new Set(commands.map((c) => c.section))], [commands]);
  const choose = (command: PaletteCommand) => {
    setPanelOpen("palette", false);
    // After the dialog has closed and returned focus, so canvas commands see the normal focus state.
    requestAnimationFrame(() => command.run());
  };
  return (
    <Dialog.Root open onOpenChange={(value) => setPanelOpen("palette", value)}>
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-command-palette=""
          className="fixed top-1/4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-menu-edge bg-popover shadow-menu outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search for a command to run</Dialog.Description>
          <Command filter={scoreCommand}>
            <CommandInput placeholder="Search commands…" />
            <CommandList>
              <CommandEmpty>No commands found</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section} heading={section}>
                  {commands
                    .filter((c) => c.section === section)
                    .map((command) => (
                      <CommandItem
                        key={command.id}
                        value={`${command.label} ${command.id}`}
                        data-command-id={command.id}
                        onSelect={() => choose(command)}
                      >
                        <span className="truncate">{command.label}</span>
                        {command.shortcut ? (
                          <CommandShortcut>{command.shortcut}</CommandShortcut>
                        ) : null}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
