// Repositories / chats sidebar in Design mode (Wonder 29, 34): the title-bar sidebar toggle shows the same list as
// Code mode on the left of the window, beside the chat dock and the canvas. State: `body.chat-sidebar-open`; the
// chrome island shifts the title bar, chat dock and editor grid right while it is set (chrome/chrome.css).
import { PanelLeftIcon } from "@/components/icons";
import { useBodyClass } from "@/lib/bridge";
import type { ChatState } from "../chat/store";
import { CodeSidebar } from "./sidebar";

export function DesignChatSidebar({ state }: { state: ChatState }) {
  const open = useBodyClass("chat-sidebar-open");
  const codeMode = useBodyClass("code-mode");
  if (!open || codeMode) return null;
  return (
    <div id="design-chat-sidebar" className="fixed inset-y-0 left-0 z-50 flex">
      <CodeSidebar state={state} />
      <div
        data-chrome-bar=""
        className="absolute inset-x-0 top-0 flex h-chrome items-center pl-traffic"
      >
        <button
          type="button"
          id="chat-sidebar-close"
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => document.body.classList.remove("chat-sidebar-open")}
        >
          <PanelLeftIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
