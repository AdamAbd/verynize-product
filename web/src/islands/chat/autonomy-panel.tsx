// Composer "Autonomy" popover: how far the agent may go on its own in this chat. Access level (the chat's own
// mode), the account the chat's agent uses (Settings › Accounts), allowed / denied tools, auto-approve rules,
// max turns, budget and "plan before edits". Stored per chat in desktop/agent-autonomy.cjs and enforced by
// desktop/agent-runtime.cjs; each run shows the effective settings in the transcript.
import { useEffect, useState } from "react";
import { GaugeIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { workspace, type ChatState } from "./store";
import { platform } from "@/lib/platform";

type Agent = "claude" | "codex";
type Autonomy = {
  allowedTools: string[];
  deniedTools: string[];
  autoApprove: { tool: string; match: string }[];
  maxTurns: number | null;
  maxBudgetUsd: number | null;
  planFirst: boolean;
};
type Profile = { id: string; agent: Agent; name: string; system: boolean };
const desktop = () => platform.desktop;
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

const ACCESS = [
  { value: "ask", label: "Ask" },
  { value: "edit", label: "Edit" },
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
];
const list = (text: string) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const rules = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      return i < 0
        ? { tool: line, match: "" }
        : { tool: line.slice(0, i).trim(), match: line.slice(i + 1).trim() };
    });

type Form = {
  allowed: string;
  denied: string;
  auto: string;
  maxTurns: string;
  budget: string;
  planFirst: boolean;
  account: string;
};
const fromSettings = (s: Autonomy, account: string): Form => ({
  allowed: s.allowedTools.join(", "),
  denied: s.deniedTools.join(", "),
  auto: s.autoApprove.map((r) => `${r.tool}: ${r.match}`).join("\n"),
  maxTurns: s.maxTurns ? String(s.maxTurns) : "",
  budget: s.maxBudgetUsd ? String(s.maxBudgetUsd) : "",
  planFirst: s.planFirst,
  account,
});
const field =
  "h-7 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary";

function Label({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
      {children}
    </label>
  );
}

export function AutonomyPopover({ state }: { state: ChatState }) {
  const api = desktop();
  const chatId = state.conversationId;
  const agent: Agent = state.defaults.agent === "codex" ? "codex" : "claude";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState(false);

  // Show a dot on the trigger when this chat has its own autonomy settings.
  useEffect(() => {
    if (!chatId || !api?.agentAutonomy) return setActive(false);
    let live = true;
    api.agentAutonomy.get({ chatId }).then(
      (s) =>
        live &&
        setActive(
          !!(
            s.allowedTools.length ||
            s.deniedTools.length ||
            s.autoApprove.length ||
            s.maxTurns ||
            s.maxBudgetUsd ||
            s.planFirst
          ),
        ),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, chatId, open]);

  useEffect(() => {
    if (!open || !chatId || !api?.agentAutonomy) return;
    let live = true;
    Promise.all([
      api.agentAutonomy.get({ chatId }),
      api.agentProfiles?.chat({ chatId }).catch(() => ({})) ?? Promise.resolve({}),
      api.agentProfiles?.list().catch(() => null) ?? Promise.resolve(null),
    ]).then(
      ([settings, picks, all]) => {
        if (!live) return;
        setProfiles((all?.profiles ?? []).filter((p) => p.agent === agent));
        setForm(fromSettings(settings, (picks as Partial<Record<Agent, string>>)[agent] ?? ""));
      },
      (e: unknown) => toast(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [api, chatId, open, agent]);

  if (!api?.agentAutonomy) return null;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const save = async () => {
    if (!form || !chatId) return;
    try {
      await api.agentAutonomy!.set({
        chatId,
        settings: {
          allowedTools: list(form.allowed),
          deniedTools: list(form.denied),
          autoApprove: rules(form.auto),
          maxTurns: form.maxTurns.trim() ? Number(form.maxTurns) : null,
          maxBudgetUsd: form.budget.trim() ? Number(form.budget) : null,
          planFirst: form.planFirst,
        },
      });
      await api.agentProfiles?.setChat({ chatId, agent, id: form.account || null });
      toast("Autonomy saved for this chat. It applies from the next message.");
      setOpen(false);
    } catch (error) {
      toast(errorText(error));
    }
  };
  const access = state.defaults.access;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="chat-autonomy"
          variant="ghost"
          size="icon-sm"
          aria-label="Autonomy"
          title="Autonomy"
          data-chat-indicator="autonomy"
          data-active={active ? "true" : "false"}
          disabled={!chatId}
          className="relative"
        >
          <GaugeIcon className="size-4" />
          {active && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary-text"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        data-chat-popover="autonomy"
        className="w-80"
      >
        {!form ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form
            id="autonomy-form"
            className="flex flex-col gap-2.5 p-1"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Autonomy for this chat</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Access</span>
              <div role="radiogroup" aria-label="Access" className="flex gap-1">
                {ACCESS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={access === a.value}
                    data-access={a.value}
                    className={cn(
                      "h-6 flex-1 rounded-md text-xs",
                      access === a.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-input text-foreground hover:bg-accent",
                    )}
                    onClick={() => {
                      const ws = workspace();
                      if (ws) ws.setDefaults({ ...ws.getDefaults(), access: a.value });
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="autonomy-account">
                {agent === "claude" ? "Claude Code account" : "Codex account"}
              </Label>
              <select
                id="autonomy-account"
                name="autonomyAccount"
                className={field}
                value={form.account}
                onChange={(e) => set({ account: e.target.value })}
              >
                <option value="">Default account</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="autonomy-allowed">Allowed without asking</Label>
              <input
                id="autonomy-allowed"
                name="autonomyAllowed"
                className={field}
                placeholder="Read, Grep, mcp__docs__*"
                value={form.allowed}
                onChange={(e) => set({ allowed: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="autonomy-denied">Never allowed</Label>
              <input
                id="autonomy-denied"
                name="autonomyDenied"
                className={field}
                placeholder="WebFetch, mcp__github__*"
                value={form.denied}
                onChange={(e) => set({ denied: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="autonomy-auto">Auto-approve (Tool: text it contains)</Label>
              <textarea
                id="autonomy-auto"
                name="autonomyAuto"
                rows={2}
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-subtle-foreground focus:border-primary"
                placeholder={"Bash: npm test\nshell: git status"}
                value={form.auto}
                onChange={(e) => set({ auto: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="autonomy-turns">Max turns</Label>
                <input
                  id="autonomy-turns"
                  name="autonomyTurns"
                  inputMode="numeric"
                  className={field}
                  placeholder="No limit"
                  value={form.maxTurns}
                  onChange={(e) => set({ maxTurns: e.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="autonomy-budget">Budget (USD)</Label>
                <input
                  id="autonomy-budget"
                  name="autonomyBudget"
                  inputMode="decimal"
                  className={field}
                  placeholder="No limit"
                  value={form.budget}
                  onChange={(e) => set({ budget: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center justify-between gap-2 text-sm text-foreground">
              Plan before edits
              <Switch
                id="autonomy-plan"
                checked={form.planFirst}
                onCheckedChange={(planFirst) => set({ planFirst })}
              />
            </label>
            <p className="text-xs text-subtle-foreground">
              Codex counts tool steps for Max turns; the budget uses the cost the agent reports.
            </p>
            <Button id="autonomy-save" type="submit" size="sm">
              Save for this chat
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
