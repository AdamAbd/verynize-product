// The settings screen (`#settings-screen`, refs 61 and 70–79): 256px navigation + centred 704px content column.
import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BoxIcon,
  ChevronsUpDownIcon,
  CircleUserIcon,
  FolderGit2Icon,
  PlugIcon,
  UsersIcon,
  GaugeIcon,
  LayoutGridIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  Share2Icon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, type SectionId } from "./api";
import { AccountPage, AgentsPage, ConnectionsPage, MemoryPage, ModelsPage, PreferencesPage, UsagePage } from "./pages";
import { AccountsPage } from "./accounts";
import { ToolsPage } from "./tools-config";
import { ProjectsPage } from "./projects";

const SECTIONS: { id: SectionId; title: string; icon: LucideIcon; page: ComponentType<Parameters<typeof AccountPage>[0]> }[] = [
  { id: "account", title: "Account", icon: CircleUserIcon, page: AccountPage },
  { id: "preferences", title: "Preferences", icon: SettingsIcon, page: PreferencesPage },
  { id: "agents", title: "Agents", icon: SendIcon, page: AgentsPage },
  { id: "accounts", title: "Accounts", icon: UsersIcon, page: AccountsPage },
  { id: "tools", title: "Tools", icon: PlugIcon, page: ToolsPage },
  { id: "projects", title: "Projects", icon: FolderGit2Icon, page: ProjectsPage },
  { id: "usage", title: "Usage", icon: GaugeIcon, page: UsagePage },
  { id: "models", title: "Default Models", icon: BoxIcon, page: ModelsPage },
  { id: "connections", title: "Connections", icon: LayoutGridIcon, page: ConnectionsPage },
  { id: "memory", title: "Memory", icon: BookOpenIcon, page: MemoryPage },
];
// "permissions" (the old Allowed actions page) now lives in Agents › Allowed without asking.
const REDIRECT: Partial<Record<SectionId, SectionId>> = { permissions: "agents" };
// Sections that need a desktop capability (feature-detected on the preload).
const AVAILABLE: Partial<Record<SectionId, () => boolean>> = {};

const navRow =
  "flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm text-foreground-3 outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-subtle-foreground";

function Screen() {
  const { api, state, preferences, setPreference } = useSettings();
  const [query, setQuery] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);

  // Move focus into the screen when it opens so keyboard users land in settings, not on the hidden canvas.
  useEffect(() => {
    if (state.open) mainRef.current?.focus({ preventScroll: true });
  }, [state.open]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [state.section]);

  if (!api) return null;
  const sections = SECTIONS.filter((s) => AVAILABLE[s.id]?.() ?? true);
  const visible = sections.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()));
  const current = sections.find((s) => s.id === (REDIRECT[state.section] ?? state.section)) ?? SECTIONS[1];
  const Page = current.page;
  const name = preferences.displayName || "Personal workspace";

  return (
    <div className="flex size-full bg-settings font-sans text-sm text-foreground-2">
      <aside
        aria-label="Settings"
        className="flex w-settings-nav shrink-0 flex-col overflow-y-auto border-r border-divider bg-background px-3 pt-13.5 pb-5"
      >
        <button id="settings-back" type="button" className={cn(navRow, "m-0 py-0")} onClick={() => api.close()}>
          <ArrowLeftIcon className="size-4" />
          <span>Back to app</span>
        </button>
        <label className="mt-2.5 mb-0 flex h-7 items-center gap-2 rounded-lg border border-input px-2 text-subtle-foreground focus-within:border-primary">
          <SearchIcon className="size-3.5 shrink-0" aria-hidden />
          <input
            id="settings-search"
            type="search"
            aria-label="Search settings"
            placeholder="Search settings..."
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </label>
        <span className="mt-6 px-3 text-sm text-muted-foreground">Your account</span>
        <nav id="settings-nav" aria-label="Settings sections" className="mt-2 flex flex-col gap-px">
          {visible.map(({ id, title, icon: Icon }) => {
            const selected = id === current.id;
            return (
              <button
                key={id}
                type="button"
                data-wp="1"
                data-section={id}
                aria-current={selected ? "page" : undefined}
                className={cn(navRow, selected && "bg-row text-foreground hover:bg-row hover:text-foreground [&_svg]:text-foreground")}
                onClick={() => api.select(id)}
              >
                <Icon className="size-4" />
                <span>{title}</span>
              </button>
            );
          })}
          {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-subtle-foreground">No matching settings</p>}
        </nav>
        <button
          type="button"
          className={cn(navRow, "mt-4.5")}
          onClick={() => api.select("account")}
          aria-label={`Workspace: ${name} (local)`}
        >
          <span
            aria-hidden
            className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary-tint text-2xs font-medium text-primary-text"
          >
            {name.trim().charAt(0).toUpperCase() || "P"}
          </span>
          <span id="settings-workspace-name" className="min-w-0 truncate">
            {name}
          </span>
          <span className="shrink-0 rounded-sm bg-input px-1.5 text-2xs leading-4.5 text-muted-foreground">Local</span>
          <ChevronsUpDownIcon className="ml-auto size-3" aria-hidden />
        </button>
        <button id="settings-sharing" type="button" className={cn(navRow, "mt-px")} onClick={() => api.actions.share()}>
          <Share2Icon className="size-4" />
          <span>Share a design</span>
        </button>
      </aside>
      {/* Not a <main>: legacy CSS styles every `main` element as the editor grid. */}
      <div
        ref={mainRef}
        role="region"
        aria-label={current.title}
        tabIndex={-1}
        className="min-w-0 flex-1 overflow-y-auto px-6 pt-22.5 pb-20 outline-none"
      >
        <div className="mx-auto w-full max-w-settings-main">
          <Page api={api} preferences={preferences} setPreference={setPreference} accounts={state.accounts} />
        </div>
        <p id="settings-status" role="status" className="sr-only">
          {state.status}
        </p>
      </div>
    </div>
  );
}

/** Renders into the legacy `#settings-screen` element (settings.js keeps its open/close + `settings-open` contract). */
export function SettingsScreen() {
  const [host] = useState(() => {
    const el = document.getElementById("settings-screen");
    el?.setAttribute("data-bd", "");
    return el;
  });
  return host ? createPortal(<Screen />, host) : null;
}
