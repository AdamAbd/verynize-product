// `?` help menu at the bottom-left of the canvas (Wonder T5-help): Docs ↗, Keyboard shortcuts, Restart onboarding,
// Give feedback, Contact us ↗, Discord community ↗, Export diagnostic logs | What's new. Items without a Verynize
// mechanism use placeholder URLs for now (see help-links.ts); Wonder's own news entries are not reproduced.
import { useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  AtSign,
  BookText,
  Download,
  Keyboard,
  MessageSquare,
  MessagesSquare,
  Undo2,
} from "lucide-react";
import { HELP_LINKS, openExternal } from "./help-links";
import {
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "./menu";
import { setPanelOpen } from "./shortcuts";
import { Tip } from "./tip";

type Item = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  external?: boolean;
  /** Null when Verynize has no target for it yet (item disabled). */
  action: (() => void) | null;
};

const link = (url: string | null) => (url ? () => openExternal(url) : null);

const ITEMS: Item[] = [
  { id: "help-docs", label: "Docs", icon: BookText, external: true, action: link(HELP_LINKS.docs) },
  {
    id: "help-shortcuts",
    label: "Keyboard shortcuts",
    icon: Keyboard,
    action: () => setPanelOpen("shortcuts", true),
  },
  {
    id: "help-onboarding",
    label: "Restart onboarding",
    icon: Undo2,
    action: () => window.dispatchEvent(new Event("bd:open-onboarding")),
  },
  { id: "help-feedback", label: "Give feedback", icon: MessageSquare, action: link(HELP_LINKS.feedback) },
  {
    id: "help-contact",
    label: "Contact us",
    icon: AtSign,
    external: true,
    action: link(HELP_LINKS.contact),
  },
  {
    id: "help-discord",
    label: "Discord community",
    icon: MessagesSquare,
    external: true,
    action: link(HELP_LINKS.discord),
  },
  {
    id: "help-diagnostics",
    label: "Export diagnostic logs",
    icon: Download,
    action: link(HELP_LINKS.diagnostics),
  },
];

const row = "h-7.25 gap-2.5 px-2";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const whatsNew = link(HELP_LINKS.whatsNew);
  return (
    <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
      <Tip label="Help" side="right">
        <MenuTrigger asChild>
          <button
            type="button"
            id="bd-canvas-help"
            aria-label="Help"
            className="absolute bottom-1.75 left-1.75 z-30 flex size-6.5 items-center justify-center rounded-full border border-edge bg-help text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:text-foreground"
          >
            ?
          </button>
        </MenuTrigger>
      </Tip>
      <MenuContent
        id="bd-help-menu"
        aria-label="Help"
        side="top"
        align="start"
        sideOffset={8}
        className="w-45"
      >
        <MenuGroup>
          {ITEMS.map(({ id, label, icon: Icon, external, action }) => (
            <MenuItem
              key={id}
              id={id}
              className={row}
              disabled={!action}
              onSelect={() => action?.()}
            >
              <Icon />
              <span className="truncate">{label}</span>
              {external ? <ArrowUpRight className="ml-auto size-3 text-muted-foreground" /> : null}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuLabel className="px-2">What&apos;s new</MenuLabel>
          <MenuItem
            id="help-whats-new"
            className={row}
            disabled={!whatsNew}
            onSelect={() => whatsNew?.()}
          >
            <span className="truncate">View all</span>
            <ArrowUpRight className="ml-auto size-3 text-muted-foreground" />
          </MenuItem>
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}
