// One component per settings section. Element ids and data attributes are test contracts (tests/settings.cjs).
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  CircleUserIcon,
  CopyIcon,
  ExternalLinkIcon,
  GaugeIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  ServerIcon,
  XIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ClaudeMark, CodexMark, FigmaIcon } from "@/components/icons";
import { AllowedActionsSection, DesignPreferencesSection, useToolsInfo } from "./agent-memory";
import { agentWorkspace, type AgentInfo, type AuthKind, type Preferences, type SettingsApi } from "./api";
import {
  Card,
  ChoiceTile,
  CommitField,
  IconTile,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
  Toggle,
} from "./controls";

type PageProps = {
  api: SettingsApi;
  preferences: Preferences;
  setPreference(changes: Partial<Preferences>): void;
  accounts: Record<string, string>;
};


function Pages({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-12.5">{children}</div>;
}

/* ---------- Account (61) ---------- */
export function AccountPage({ preferences, setPreference }: PageProps) {
  const name = preferences.displayName || "Personal workspace";
  return (
    <>
      <PageHeader title="Account" />
      <Pages>
        <Section id="settings-profile" title="Profile">
          <Card>
            <Row title="Avatar" description="Shown next to your cursor in shared rooms.">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-primary-tint text-lg font-medium text-primary-text"
              >
                {name.trim().charAt(0).toUpperCase() || "P"}
              </span>
            </Row>
            <Row
              title="Display name"
              description="Used for this local workspace and collaboration presence."
              htmlFor="settings-display-name"
            >
              <CommitField
                id="settings-display-name"
                data-pref="displayName"
                maxLength={80}
                className="w-64.5"
                value={preferences.displayName ?? ""}
                onCommit={(value) => setPreference({ displayName: value.trim() })}
              />
            </Row>
          </Card>
        </Section>
        <Section
          id="settings-storage"
          title="Storage"
          description="Better Design does not need a hosted account."
        >
          <Card>
            <Row
              title="Stored on this device"
              description="Your designs and preferences stay on this computer. Shared rooms use private invite links."
            >
              <span className="text-sm text-muted-foreground">Local</span>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Preferences (70) ---------- */
function ThemePreview({ theme }: { theme: "system" | "light" | "dark" }) {
  const card = (tone: "light" | "dark") => (
    <span
      className={cn(
        "absolute inset-x-2 top-6 bottom-0 rounded-t-md",
        tone === "light" ? "bg-preview-light-card" : "bg-preview-dark-card",
      )}
    >
      <span
        className={cn(
          "absolute top-2.5 left-3 h-1 w-6 rounded-full",
          tone === "light" ? "bg-preview-light-bar" : "bg-preview-dark-bar",
        )}
      />
      <span
        className={cn(
          "absolute top-2.5 right-3 size-1 rounded-full",
          tone === "light" ? "bg-preview-light-bar" : "bg-preview-dark-bar",
        )}
      />
    </span>
  );
  if (theme === "system")
    return (
      <>
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-preview-light">
          <span className="absolute inset-y-0 left-0 w-17.5">{card("light")}</span>
        </span>
        <span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-preview-dark">
          <span className="absolute inset-y-0 right-0 w-17.5">{card("dark")}</span>
        </span>
      </>
    );
  return (
    <span className={cn("absolute inset-0", theme === "light" ? "bg-preview-light" : "bg-preview-dark")}>
      {card(theme)}
    </span>
  );
}

function SelectionPreview({ deep }: { deep: boolean }) {
  return (
    <span className="absolute inset-0 bg-background">
      <span
        className={cn(
          "absolute inset-x-2 inset-y-2 rounded-md bg-muted",
          !deep && "outline outline-1 outline-foreground-3",
        )}
      >
        <span className="absolute top-1.5 left-1.5 h-0.5 w-3 rounded-full bg-subtle-foreground" />
        <span className="absolute inset-x-1.5 top-4 h-2 rounded-sm bg-accent" />
        <span
          className={cn(
            "absolute inset-x-1.5 bottom-1.5 flex h-2.5 items-center justify-center rounded-sm bg-accent",
            deep && "outline outline-1 outline-foreground-3",
          )}
        >
          <span className="size-1 rounded-full bg-subtle-foreground" />
        </span>
      </span>
    </span>
  );
}

export function PreferencesPage({ preferences, setPreference }: PageProps) {
  const themes = ["system", "light", "dark"] as const;
  return (
    <>
      <PageHeader title="Preferences" />
      <Pages>
        <Section id="settings-notifications" title="Notifications">
          <Card>
            <Row title="When a chat finishes" description="Choose a sound for completed tasks." htmlFor="settings-sound">
              <NativeSelect
                id="settings-sound"
                data-pref="sound"
                value={preferences.sound}
                onChange={(event) => setPreference({ sound: event.target.value as Preferences["sound"] })}
              >
                <option value="none">None</option>
                <option value="chime">Chime</option>
                <option value="pop">Pop</option>
              </NativeSelect>
            </Row>
            <Row title="Desktop notifications" description="Alerts when an agent task finishes.">
              <Toggle
                aria-label="Desktop notifications"
                data-pref="notifications"
                checked={Boolean(preferences.notifications)}
                onCheckedChange={(checked) => setPreference({ notifications: checked })}
              />
            </Row>
          </Card>
        </Section>

        <Section id="settings-appearance" title="Appearance">
          <Card>
            <Row title="Theme" description="System follows your device’s appearance." align="start">
              <div role="group" aria-label="Theme" className="mt-1 mr-1 flex gap-5">
                {themes.map((theme) => (
                  <ChoiceTile
                    key={theme}
                    data-theme={theme}
                    selected={preferences.theme === theme}
                    label={theme[0].toUpperCase() + theme.slice(1)}
                    onClick={() => setPreference({ theme })}
                  >
                    <ThemePreview theme={theme} />
                  </ChoiceTile>
                ))}
              </div>
            </Row>
            <Row title="Reduce motion" description="Pause animated gradients and use calmer transitions.">
              <Toggle
                aria-label="Reduce motion"
                data-pref="reduceMotion"
                checked={Boolean(preferences.reduceMotion)}
                onCheckedChange={(checked) => setPreference({ reduceMotion: checked })}
              />
            </Row>
          </Card>
        </Section>

        <Section id="settings-canvas" title="Canvas">
          <Card>
            <Row
              title="Selection behavior"
              description="Classic selects the outermost frame you click inside. Deep selects the innermost one."
              align="start"
            >
              <div role="group" aria-label="Selection behavior" className="mt-1 mr-1 flex gap-5">
                {(["classic", "deep"] as const).map((mode) => (
                  <ChoiceTile
                    key={mode}
                    data-selection={mode}
                    selected={preferences.selection === mode}
                    label={mode === "classic" ? "Classic" : "Deep"}
                    onClick={() => setPreference({ selection: mode })}
                  >
                    <SelectionPreview deep={mode === "deep"} />
                  </ChoiceTile>
                ))}
              </div>
            </Row>
            <Row title="Small nudge" description="How far an arrow key moves a layer, in pixels." htmlFor="settings-small-nudge">
              <CommitField
                id="settings-small-nudge"
                data-pref="smallNudge"
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                className="w-24"
                value={preferences.smallNudge}
                onCommit={(value) => setPreference({ smallNudge: Number(value) })}
              />
            </Row>
            <Row
              title="Large nudge"
              description="How far an arrow key moves a layer with Shift held, in pixels."
              htmlFor="settings-large-nudge"
            >
              <CommitField
                id="settings-large-nudge"
                data-pref="largeNudge"
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                className="w-24"
                value={preferences.largeNudge}
                onCommit={(value) => setPreference({ largeNudge: Number(value) })}
              />
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Agents (71) ---------- */
const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function AgentMark({ id }: { id: string }) {
  return id === "claude" ? (
    <ClaudeMark className="size-5" />
  ) : (
    <CodexMark className="size-5" />
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "flex size-3.5 items-center justify-center rounded-full ring-2 ring-card",
        ok ? "bg-success text-primary-foreground" : "bg-accent text-muted-foreground",
      )}
    >
      {ok ? <CheckIcon data-icon-weight="bold" className="size-2.5" /> : <XIcon data-icon-weight="bold" className="size-2.5" />}
    </span>
  );
}

function AgentCard({ agent, api, account }: { agent: AgentInfo; api: SettingsApi; account?: string }) {
  const name = AGENT_NAMES[agent.id] ?? agent.id;
  const run = (kind: AuthKind) => void api.actions.auth(kind, agent.id);
  return (
    <Card>
      <Row
        icon={
          <IconTile badge={<StatusBadge ok={agent.available} />}>
            <AgentMark id={agent.id} />
          </IconTile>
        }
        title={name}
        description={agent.available ? "Installed · uses your CLI account" : "Not found on this machine"}
      />
      {agent.available && (
        <Row
          icon={
            <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
              <CircleUserIcon className="size-5" />
            </span>
          }
          title={
            <span id={`account-status-${agent.id}`} className="inline-flex items-center gap-2">
              {account ?? "CLI account"}
            </span>
          }
          description={account ? "Machine-wide CLI sign-in" : "Check the account to see who is signed in."}
        >
          <SettingsButton onClick={() => run("check")}>Check account</SettingsButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SettingsButton variant="ghost" className="w-7 px-0" aria-label={`${name} account actions`}>
                <MoreHorizontalIcon />
              </SettingsButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onEscapeKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={() => run("check")}>Check account</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run("login")}>Sign in / switch…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run("cancel")}>Cancel sign-in</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run("logout")}>
                Sign out…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      )}
    </Card>
  );
}

export function AgentsPage({ api, accounts }: PageProps) {
  const tools = useToolsInfo();
  const [agents, setAgents] = useState<AgentInfo[] | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.actions
      .discoverAgents()
      .then((list) => live && setAgents(list))
      .catch((e: Error) => live && (setError(e.message), setAgents([])));
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <>
      <PageHeader title="Agents" />
      <Pages>
        <Section
          id="settings-providers"
          title="Provider accounts"
          description="Use the agents installed on your Mac with their existing accounts."
          action={
            <SettingsButton onClick={() => api.select("usage")}>
              <GaugeIcon />
              View usage
            </SettingsButton>
          }
        >
          <div id="settings-agent-list" className="flex flex-col gap-4">
            {agents === undefined && (
              <Card>
                <Row title="Checking installed agents…" />
              </Card>
            )}
            {agents === null && (
              <Card>
                <Row title="Desktop app required" description="Open Better Design as a desktop app to use local agents." />
              </Card>
            )}
            {agents?.length === 0 && (
              <Card>
                <Row title="No agents found" description={error || "Install Claude Code or Codex, then reopen settings."} />
              </Card>
            )}
            {agents?.map((agent) => (
              <AgentCard key={agent.id} agent={agent} api={api} account={accounts[agent.id]} />
            ))}
          </div>
        </Section>
        <Section
          id="settings-agent-runtime"
          title="How agents run"
          description="Claude runs through the Claude Agent SDK on your Claude Code install; Codex runs through codex app-server (or codex exec on older versions)."
        >
          <Card>
            <Row
              title="Agent workspace"
              description="Both agents get the live canvas tools while the Better Design MCP bridge is running."
            >
              <SettingsButton id="settings-open-agent" onClick={api.actions.openAgent}>
                Open agent workspace
                <ExternalLinkIcon />
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section id="settings-agent-about" title="About" description="The design tool set agents use on the canvas.">
          <Card>
            <Row
              title="Design tools version"
              description={
                tools?.toolsVersion
                  ? `Better Design MCP ${tools.serverVersion ?? ""} · changes whenever the tools, codec or design knowledge change.`
                  : "Shown once the live MCP bridge is running."
              }
            >
              <code id="settings-tools-version" className="font-mono text-xs text-foreground-3">
                {tools?.toolsVersion ?? "—"}
              </code>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Usage (72) ---------- */
export function UsagePage() {
  const stats = agentWorkspace()?.getUsage?.() ?? {};
  const items = [
    ["runs", "Tasks"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["queued", "Queued"],
  ] as const;
  return (
    <>
      <PageHeader
        title="Usage"
        description="Activity recorded on this device. Provider billing and quotas remain in your agent account."
      />
      <Pages>
        <Section id="settings-usage" title="Agent tasks">
          <Card className="grid grid-cols-4 px-0 [&>*+*]:border-t-0 [&>*+*]:border-l">
            {items.map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1 px-4 py-4">
                <span className="text-2xl font-medium text-foreground tabular-nums">{Number(stats[key]) || 0}</span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            ))}
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Default Models (73) ---------- */
export function ModelsPage({ api }: PageProps) {
  const initial = agentWorkspace()?.getDefaults?.() ?? {};
  const legacyAccess: Record<string, string> = { "read-only": "ask", "workspace-write": "edit" };
  const [agent, setAgent] = useState(initial.agent || "codex");
  const [model, setModel] = useState(initial.model || "");
  const [effort, setEffort] = useState(initial.effort || "");
  const [access, setAccess] = useState(legacyAccess[initial.access ?? ""] || initial.access || "edit");
  return (
    <>
      <PageHeader title="Default Models" />
      <Pages>
        <Section
          id="settings-default-models"
          title="Your default model"
          description="Choose your agent and model. Leave the model blank to use the CLI’s configured default."
        >
          <Card>
            <Row title="Agent" description="Provider for new tasks." htmlFor="settings-default-agent">
              <NativeSelect
                id="settings-default-agent"
                className="w-44"
                value={agent}
                onChange={(event) => setAgent(event.target.value)}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </NativeSelect>
            </Row>
            <Row title="Model" description="Enter a model ID supported by your account." htmlFor="settings-default-model">
              <TextField
                id="settings-default-model"
                className="w-44"
                placeholder="CLI default"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </Row>
            <Row
              title="Reasoning effort"
              description="Applied where supported by the chosen CLI."
              htmlFor="settings-default-effort"
            >
              <NativeSelect
                id="settings-default-effort"
                className="w-44"
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
              >
                {["", "low", "medium", "high", "xhigh", "max"].map((value) => (
                  <option key={value} value={value}>
                    {value || "Default"}
                  </option>
                ))}
              </NativeSelect>
            </Row>
            <Row
              title="Access"
              description="Ask approves each action in chat; Edit auto-approves file edits; Auto lets the provider reviewer decide; Full never asks."
              htmlFor="settings-default-access"
            >
              <NativeSelect
                id="settings-default-access"
                className="w-44"
                value={access}
                onChange={(event) => setAccess(event.target.value)}
              >
                <option value="ask">Ask</option>
                <option value="edit">Edit</option>
                <option value="auto">Auto</option>
                <option value="full">Full access</option>
              </NativeSelect>
            </Row>
          </Card>
          <div className="mt-4 flex justify-end">
            <SettingsButton
              id="settings-save-models"
              variant="primary"
              onClick={() => api.actions.saveModels({ agent, model: model.trim(), effort, access })}
            >
              Save defaults
            </SettingsButton>
          </div>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Connections (74) ---------- */
export function ConnectionsPage({ api, preferences }: PageProps) {
  const [cloud, setCloud] = useState(preferences.cloudServer ?? "");
  return (
    <>
      <PageHeader title="Connections" />
      <Pages>
        <Section id="settings-connections-design" title="Design">
          <Card>
            <Row
              icon={
                <IconTile>
                  <FigmaIcon className="size-4" />
                </IconTile>
              }
              title="Figma"
              description="Import designs using a transient access token."
            >
              <SettingsButton id="settings-figma" onClick={api.actions.openFigma}>
                <FigmaIcon />
                Import file
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section id="settings-connections-sharing" title="Sharing">
          <Card>
            <Row
              icon={
                <IconTile>
                  <GlobeIcon className="size-4" />
                </IconTile>
              }
              title="Cloudflare workspace"
              description="Origin serving your shared design rooms."
              htmlFor="settings-cloud"
            >
              <TextField
                id="settings-cloud"
                className="w-56"
                placeholder="https://your-app.workers.dev"
                value={cloud}
                onChange={(event) => setCloud(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && api.actions.saveCloud(cloud)}
              />
              <SettingsButton id="settings-save-cloud" onClick={() => api.actions.saveCloud(cloud)}>
                Save
              </SettingsButton>
            </Row>
          </Card>
        </Section>
        <Section id="settings-connections-mcp" title="MCP">
          <Card>
            <Row
              icon={
                <IconTile>
                  <ServerIcon className="size-4" />
                </IconTile>
              }
              title="Design MCP"
              description={
                <>
                  Use the local design server from your preferred agent:{" "}
                  <code className="font-mono text-xs text-foreground-3">npm run mcp -- --root /absolute/design-folder</code>
                </>
              }
            >
              <SettingsButton id="settings-mcp-copy" onClick={() => void api.actions.copyMcp()}>
                <CopyIcon />
                Copy command
              </SettingsButton>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Memory (75) ---------- */
export function MemoryPage({ api }: PageProps) {
  const [text, setText] = useState(agentWorkspace()?.getDefaults?.().instructions ?? "");
  return (
    <>
      <PageHeader
        title="Memory"
        description="Instructions and design preferences stay on this computer and are added to new agent tasks. Project memory can override them."
      />
      <Pages>
        <DesignPreferencesSection />
        <Section
          id="settings-instructions"
          title="Personal instructions"
          description="Added to new agent tasks."
        >
          <textarea
            id="settings-memory"
            aria-labelledby="settings-instructions-label"
            maxLength={12000}
            placeholder="Your preferred stack, design principles, and coding conventions…"
            className="min-h-45 resize-y rounded-2xl border border-card-border bg-card px-4 py-3.5 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-4 flex justify-end">
            <SettingsButton id="settings-save-memory" variant="primary" onClick={() => api.actions.saveMemory(text)}>
              Save instructions
            </SettingsButton>
          </div>
        </Section>
        <Section id="settings-project-memory" title="Project memory" description="Stored in the selected project.">
          <Card>
            <Row
              icon={
                <IconTile>
                  <BookOpenIcon className="size-4" />
                </IconTile>
              }
              title="BETTER_DESIGN.md"
              description="Project-specific guidance for agents working in this repository."
            >
              <SettingsButton id="settings-open-memory" onClick={api.actions.openMemory}>
                Edit project memory
                <ExternalLinkIcon />
              </SettingsButton>
            </Row>
          </Card>
        </Section>
      </Pages>
    </>
  );
}

/* ---------- Allowed actions (permissions remembered with “Always allow”) ---------- */
export function AllowedActionsPage() {
  return (
    <>
      <PageHeader title="Allowed actions" description="Agents ask before running tools that change files or run commands. These are the ones you allowed for good." />
      <Pages>
        <AllowedActionsSection />
      </Pages>
    </>
  );
}
