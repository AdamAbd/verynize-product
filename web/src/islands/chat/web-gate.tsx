// Web chat gate (in place of the composer): why the model API chat cannot run a turn here yet. The three credentials
// stay separate: the Verynize account (sign in), the server's OpenRouter key (an operator setting), and Claude Code /
// Codex sign-ins, which only the desktop app uses. Test contract: `#chat-web-gate[data-state]`.
import type { AgentTransport } from "@/lib/agent-transport";
import { openSignIn } from "@/lib/cloud-account";
import { ChatActionButton } from "./controls";

const DETAIL: Partial<Record<AgentTransport["state"], string>> = {
  "signed-out":
    "The web chat runs on this server's model API with your Verynize account. Claude Code and Codex sign-ins work in the desktop app only.",
  "not-configured":
    "This server has no OpenRouter key, so its model API is off. Claude Code and Codex run in the desktop app.",
  "no-room":
    "The model API works on shared cloud rooms. Share this design or open one of your rooms, then chat here.",
};

export function WebChatGate({ transport }: { transport: AgentTransport }) {
  const detail = DETAIL[transport.state];
  return (
    <div
      id="chat-web-gate"
      data-state={transport.state}
      role="status"
      className="mx-4 mb-4 flex shrink-0 flex-col items-start gap-1.5 rounded-2xl border border-card-border bg-card px-4 py-3"
    >
      <p className="m-0 text-base leading-5.25 font-medium text-foreground">{transport.message}</p>
      {detail && <p className="m-0 text-sm leading-5 text-muted-foreground">{detail}</p>}
      {transport.state === "signed-out" && (
        <ChatActionButton id="chat-web-sign-in" className="mt-1.5" onClick={openSignIn}>
          Sign in
        </ChatActionButton>
      )}
      {transport.state === "no-room" && (
        <ChatActionButton
          id="chat-web-share"
          variant="outline"
          className="mt-1.5"
          onClick={() => document.getElementById("cloud-toggle")?.click()}
        >
          Share this design
        </ChatActionButton>
      )}
    </div>
  );
}
