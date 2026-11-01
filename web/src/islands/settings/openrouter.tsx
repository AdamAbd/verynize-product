// Settings › Agents › "Model API (OpenRouter)" (web only): the signed-in account's own OpenRouter credential, which
// pays for web chat turns. Kept apart from the Claude Code / Codex provider accounts (desktop agents). Status comes
// from GET /api/ai/credentials (never the key); Connect / Reconnect run OpenRouter's OAuth PKCE sign-in in this tab and
// come back here; "Paste API key" is the fallback. Test contract: `#settings-openrouter-card[data-status]`,
// `#settings-openrouter-connect`, `#settings-openrouter-reconnect`, `#settings-openrouter-disconnect`,
// `#settings-openrouter-paste`, `#settings-openrouter-key`, `#settings-openrouter-save`, `#settings-openrouter-error`.
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { webAgentScope } from "@/lib/agent-transport";
import {
  aiCredentialsQuery,
  connectOpenRouter,
  disconnectOpenRouter,
  openRouterReturn,
  openRouterReturnMessage,
  saveOpenRouterKey,
  type OpenRouterCredential,
} from "@/lib/ai-credentials";
import { openSignIn, useCloudAccount } from "@/lib/cloud-account";
import { platform } from "@/lib/platform";
import { SIGNED_OUT } from "@/lib/query/keys";
import { Card, IconTile, Row, Section, SettingsButton, TextField } from "./controls";

const RETURN_TO = "/settings/agents";
const money = (value: number) => `$${value.toFixed(2)}`;

function describe(credential: OpenRouterCredential) {
  if (!credential.connected)
    return credential.serverFallback
      ? "Not connected. This server's shared key covers runs for now; connect your own account to use your credits."
      : "Not connected. Connect your OpenRouter account to chat with the model API on the web.";
  const via = credential.source === "oauth" ? "connected with OpenRouter" : "pasted API key";
  const parts = [`Key ending ${credential.last4} · ${via}`];
  if (credential.label) parts.push(credential.label);
  if (credential.state === "rejected") parts.push("OpenRouter rejects this key: reconnect");
  if (credential.state === "unreadable")
    parts.push("This key can no longer be read on the server: reconnect");
  if (typeof credential.usage === "number")
    parts.push(
      typeof credential.limit === "number"
        ? `${money(credential.usage)} of ${money(credential.limit)} used`
        : `${money(credential.usage)} used`,
    );
  return parts.join(" · ");
}

export function OpenRouterSection() {
  const account = useCloudAccount();
  const scope = platform.kind === "web" ? webAgentScope(account) : null;
  const query = useQuery({ ...aiCredentialsQuery(scope ?? SIGNED_OUT), enabled: !!scope });
  const returned = openRouterReturn();
  const [error, setError] = useState(
    returned?.status === "error" ? openRouterReturnMessage(returned.reason) : "",
  );
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [key, setKey] = useState("");
  if (platform.kind !== "web") return null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    if (await act(() => saveOpenRouterKey(key.trim()))) {
      setKey("");
      setPasting(false);
    }
  };
  const credential = query.data?.openrouter;
  const status = !scope
    ? "signed-out"
    : query.isPending
      ? "loading"
      : query.error
        ? "error"
        : credential?.connected
          ? "connected"
          : "missing";

  return (
    <Section
      id="settings-openrouter"
      title="Model API (OpenRouter)"
      description="Web chat runs on your own OpenRouter account and credits. Separate from the Claude Code and Codex accounts, which the desktop app uses."
    >
      <Card data-status={status} id="settings-openrouter-card">
        <Row
          icon={
            <IconTile>
              <KeyRoundIcon className="size-4" />
            </IconTile>
          }
          title="OpenRouter"
          description={
            <span id="settings-openrouter-status">
              {status === "signed-out"
                ? "Sign in to your Verynize account to connect OpenRouter."
                : status === "loading"
                  ? "Checking…"
                  : status === "error"
                    ? query.error?.message
                    : credential && describe(credential)}
            </span>
          }
        >
          {status === "signed-out" && <SettingsButton onClick={openSignIn}>Sign in</SettingsButton>}
          {status === "missing" && (
            <>
              <SettingsButton
                id="settings-openrouter-paste"
                variant="ghost"
                aria-expanded={pasting}
                onClick={() => setPasting(!pasting)}
              >
                Paste API key
              </SettingsButton>
              <SettingsButton
                id="settings-openrouter-connect"
                variant="primary"
                disabled={busy}
                onClick={() => void act(() => connectOpenRouter(RETURN_TO))}
              >
                Connect OpenRouter
              </SettingsButton>
            </>
          )}
          {status === "connected" && (
            <>
              <SettingsButton
                id="settings-openrouter-disconnect"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(disconnectOpenRouter)}
              >
                Disconnect
              </SettingsButton>
              <SettingsButton
                id="settings-openrouter-reconnect"
                disabled={busy}
                onClick={() => void act(() => connectOpenRouter(RETURN_TO))}
              >
                Reconnect
              </SettingsButton>
            </>
          )}
        </Row>
        {status === "missing" && pasting && (
          <form className="flex items-center gap-2 py-3.5" onSubmit={(event) => void save(event)}>
            <TextField
              id="settings-openrouter-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="OpenRouter API key"
              placeholder="sk-or-v1-…"
              className="min-w-0 flex-1"
              value={key}
              disabled={busy}
              onChange={(event) => setKey(event.target.value)}
            />
            <SettingsButton
              id="settings-openrouter-save"
              type="submit"
              disabled={busy || !key.trim()}
            >
              Save key
            </SettingsButton>
          </form>
        )}
        {error && (
          <p
            id="settings-openrouter-error"
            role="alert"
            className="m-0 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </Card>
    </Section>
  );
}
