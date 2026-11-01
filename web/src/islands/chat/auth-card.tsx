// "Sign in to Codex" card: the runtime's `auth-required` event (desktop/agent-runtime.cjs requireAuth) becomes one
// `auth` part on the reply. The button runs the installed CLI's browser sign-in for the run's account
// (desktop/agent-auth.cjs, the same flow as Settings › Accounts); after it completes, Retry resends the message.
import { useEffect, useState } from "react";
import { LogInIcon, RotateCcwIcon, UserRoundCheckIcon, UserRoundXIcon } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { can, platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { ChatActionButton } from "./controls";
import { hook, stateHook } from "./hooks";
import { workspace, type ChatPart } from "./store";

type Phase = "signed-out" | "waiting" | "signed-in" | "error";
const AGENT_NAME: Record<string, string> = { codex: "Codex", claude: "Claude Code" };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AuthCard({ part, index, busy }: { part: ChatPart; index: number; busy: boolean }) {
  const api = platform.desktop;
  const agent = part.agent || "codex";
  const name = AGENT_NAME[agent] ?? agent;
  const account = part.account;
  const profile = account && !account.system ? account.id : undefined;
  const [phase, setPhase] = useState<Phase>("signed-out");
  const [message, setMessage] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const canSignIn = can("agentAccounts") && !!api;
  const ws = workspace();

  // Any sign-in of this account (this card, Settings, onboarding) updates the card.
  useEffect(
    () =>
      api?.onAuthEvent?.((event) => {
        if (event.agent !== agent || (event.profile ?? undefined) !== profile) return;
        if (event.type === "started" || event.type === "waiting") {
          setPhase("waiting");
          setLoginId(event.id);
        } else if (event.type === "complete") {
          setPhase("signed-in");
          setLoginId(null);
        } else {
          setPhase("error");
          setMessage(event.message);
          setLoginId(null);
        }
      }),
    [api, agent, profile],
  );

  const signIn = () => {
    if (!api) return;
    setPhase("waiting");
    setMessage("");
    api.startAgentLogin({ agent, ...(profile ? { profile } : {}) }).then(
      (result) => setLoginId(result.id),
      (error: unknown) => {
        setPhase("error");
        setMessage(errorText(error));
      },
    );
  };
  const cancel = () => {
    if (loginId) void api?.cancelAgentLogin({ id: loginId }).catch(() => {});
  };

  const who = account?.name && !account.system ? ` (${account.name})` : "";
  const description =
    phase === "signed-in"
      ? `Signed in to ${name}${who}. Retry to send your message again.`
      : phase === "waiting"
        ? "Finish signing in in the browser window that opened."
        : phase === "error" && message
          ? message
          : `${name}${who} is signed out on this Mac, so the message was not sent.`;

  return (
    <div
      className={cn(hook.auth, stateHook(phase))}
      data-auth-agent={agent}
      data-auth-account={account?.id ?? "system"}
    >
      <Card>
        <CardHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              {phase === "signed-in" ? (
                <UserRoundCheckIcon className="size-3.5 text-primary-text" />
              ) : (
                <UserRoundXIcon className="size-3.5 text-primary-text" />
              )}
              {phase === "signed-in" ? "Signed in" : "Sign-in needed"}
            </span>
          </CardDescription>
          <CardTitle>
            <span className="block text-base leading-5.25 font-normal break-words">
              {phase === "signed-in" ? `${name} is ready` : `Sign in to ${name}`}
            </span>
          </CardTitle>
          <CardDescription>
            <span className="block break-words">{description}</span>
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <div className="flex w-full justify-end gap-1.5">
            {phase === "waiting" ? (
              <>
                <ChatActionButton variant="outline" onClick={cancel} disabled={!loginId}>
                  Cancel
                </ChatActionButton>
                <ChatActionButton disabled>
                  <Spinner />
                  Waiting for browser…
                </ChatActionButton>
              </>
            ) : phase === "signed-in" ? (
              ws?.retry && (
                <ChatActionButton
                  hook={hook.authRetry}
                  disabled={busy}
                  onClick={() => ws.retry?.(index)}
                >
                  <RotateCcwIcon />
                  Retry
                </ChatActionButton>
              )
            ) : canSignIn ? (
              <>
                {ws?.retry && (
                  <ChatActionButton
                    variant="outline"
                    hook={hook.authRetry}
                    disabled={busy}
                    onClick={() => ws.retry?.(index)}
                  >
                    Retry
                  </ChatActionButton>
                )}
                <ChatActionButton hook={hook.authSignIn} onClick={signIn}>
                  <LogInIcon />
                  Sign in to {name}
                </ChatActionButton>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run `{agent} login` in a terminal, then retry.
              </p>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
