// Dock header (29, 33, 34): project / chat switcher on the left, "Start preview" split button on the right.
import { CameraIcon, ChevronDownIcon, ChevronsUpDownIcon, FileDownIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GitForkIcon, LaptopIcon, MessageSquareIcon, ChevronLeftIcon, PlayIcon } from "lucide-react";
import { PanelLeftIcon, PlusIcon } from "@/components/icons";
import { legacyClick } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  ChatMenu,
  ChatMenuContent,
  ChatMenuItem,
  ChatMenuLabel,
  ChatMenuSeparator,
  ChatMenuSub,
  ChatMenuSubContent,
  ChatMenuSubTrigger,
  ChatMenuTrigger,
} from "./menu";
import { hook } from "./hooks";
import { workspace, type ChatState } from "./store";

/** Parallel chats: the workspace reports which conversations are running (busyChats); switching stays enabled. */
const parallel = (state: ChatState) => Array.isArray(state.busyChats);
const running = (state: ChatState, id: string | null) =>
  !!id && (parallel(state) ? state.busyChats!.includes(id) : state.busy && id === state.conversationId);

/** Small pulsing dot marking a conversation whose agent is running. */
function RunningDot({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Running" className={cn("relative flex size-1.5 shrink-0", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-primary-text opacity-60 motion-reduce:animate-none" />
      <span className="relative size-1.5 rounded-full bg-primary-text" />
    </span>
  );
}

function ChatList({ state, createLabel }: { state: ChatState; createLabel: string }) {
  const ws = workspace();
  const locked = state.busy && !parallel(state);
  return (
    <>
      {state.conversations.map((chat) => (
        <ChatMenuItem
          key={chat.id}
          disabled={locked && chat.id !== state.conversationId}
          checked={chat.id === state.conversationId}
          onSelect={() => ws?.selectChat(chat.id)}
        >
          <MessageSquareIcon />
          <span className="min-w-0 truncate">{chat.title}</span>
          {running(state, chat.id) && <RunningDot className={chat.id === state.conversationId ? "ml-auto" : "mr-1 ml-auto"} />}
        </ChatMenuItem>
      ))}
      <ChatMenuSeparator />
      <ChatMenuItem disabled={locked} onSelect={() => ws?.newChat()}>
        <PlusIcon />
        {createLabel}
      </ChatMenuItem>
    </>
  );
}

function Switcher({ state }: { state: ChatState }) {
  const attached = state.projectKey !== "unattached";
  const title = state.conversations.find((c) => c.id === state.conversationId)?.title || "New chat";
  const elsewhere = (state.busyChats ?? []).filter((id) => id !== state.conversationId).length;
  return (
    <ChatMenu modal={false}>
      <div className="flex min-w-0 items-center gap-1 text-base leading-5.25">
        {attached && (
          <>
            <span className="flex min-w-0 shrink items-center gap-2 px-1.5 text-foreground-3">
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate">{state.projectName}</span>
            </span>
            <span className="text-subtle-foreground">/</span>
          </>
        )}
        <ChatMenuTrigger
          id="chat-switcher"
          className="flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-foreground-2 hover:bg-muted data-[state=open]:bg-muted"
        >
          {attached ? (
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
          {elsewhere > 0 && (
            <span title={`${elsewhere} other ${elsewhere === 1 ? "chat is" : "chats are"} running`} className="flex">
              <RunningDot />
            </span>
          )}
          <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </ChatMenuTrigger>
      </div>
      <ChatMenuContent align="start" className="w-56">
        {!attached ? (
          <ChatMenuSub>
            <ChatMenuSubTrigger>
              <MessageSquareIcon />
              Quick chats
            </ChatMenuSubTrigger>
            <ChatMenuSubContent className="w-60">
              <ChatList state={state} createLabel="Create quick chat" />
            </ChatMenuSubContent>
          </ChatMenuSub>
        ) : (
          <ChatMenuItem onSelect={() => workspace()?.openProject()}>
            <FolderOpenIcon />
            Project files
          </ChatMenuItem>
        )}
        <ChatMenuSeparator />
        <ChatMenuLabel>Repositories</ChatMenuLabel>
        {attached && (
          <ChatMenuSub>
            <ChatMenuSubTrigger>
              <FolderIcon />
              <span className="min-w-0 truncate">{state.projectName}</span>
            </ChatMenuSubTrigger>
            <ChatMenuSubContent className="w-60">
              <ChatList state={state} createLabel="New chat" />
            </ChatMenuSubContent>
          </ChatMenuSub>
        )}
        {attached && <ChatMenuSeparator />}
        <ChatMenuItem onSelect={() => legacyClick("project-new")}>
          <PlusIcon />
          Create new repository
        </ChatMenuItem>
        <ChatMenuItem onSelect={() => legacyClick("project-clone")}>
          <GitForkIcon />
          Start from GitHub
        </ChatMenuItem>
        <ChatMenuItem onSelect={() => legacyClick("project-open")}>
          <LaptopIcon />
          Start from local folder
        </ChatMenuItem>
      </ChatMenuContent>
    </ChatMenu>
  );
}

function PreviewButton() {
  const segment = "flex h-6.5 items-center text-base leading-5.25 text-foreground-2 hover:bg-muted data-[state=open]:bg-muted";
  return (
    <div className="flex shrink-0 items-center rounded-md border border-card-border bg-background">
      <button
        type="button"
        className={cn(segment, "gap-2 rounded-l-md pr-2.5 pl-2")}
        onClick={() => legacyClick("project-preview")}
      >
        <PlayIcon className="size-3 fill-current text-muted-foreground" />
        Start preview
      </button>
      <span className="h-6.5 w-px bg-card-border" />
      <ChatMenu modal={false}>
        <ChatMenuTrigger aria-label="Preview options" className={cn(segment, "w-5.5 justify-center rounded-r-md")}>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </ChatMenuTrigger>
        <ChatMenuContent align="end" className="w-52">
          <ChatMenuItem onSelect={() => legacyClick("project-preview")}>
            <PlayIcon />
            Start preview…
          </ChatMenuItem>
          <ChatMenuItem onSelect={() => legacyClick("project-capture")}>
            <CameraIcon />
            Capture app to canvas
          </ChatMenuItem>
          <ChatMenuItem onSelect={() => legacyClick("project-pdf")}>
            <FileDownIcon />
            Export PDF
          </ChatMenuItem>
          <ChatMenuSeparator />
          <ChatMenuItem onSelect={() => legacyClick("project-git")}>
            <GitBranchIcon />
            Git status
          </ChatMenuItem>
          <ChatMenuItem onSelect={() => legacyClick("project-worktree")}>
            <GitForkIcon />
            Create worktree…
          </ChatMenuItem>
          <ChatMenuItem onSelect={() => workspace()?.openProject()}>
            <FolderOpenIcon />
            Project files
          </ChatMenuItem>
        </ChatMenuContent>
      </ChatMenu>
    </div>
  );
}

export function DockHeader({ state }: { state: ChatState }) {
  const attached = state.projectKey !== "unattached";
  const iconButton =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground-2";
  return (
    <>
      {/* Top row shares the window title bar (chrome island leaves the left 499px to the dock): traffic-light inset. */}
      <div className={cn(hook.drag, "flex h-10 shrink-0 items-center gap-1 border-b border-border bg-settings pr-1.5 pl-20")}>
        <button
          type="button"
          aria-label="Show layers"
          title="Show layers"
          className={iconButton}
          onClick={() => {
            document.body.classList.remove("left-collapsed");
            workspace()?.closeChat();
          }}
        >
          <PanelLeftIcon className="size-4" />
        </button>
        <Switcher state={state} />
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Hide chat"
          title="Hide chat"
          onClick={() => workspace()?.closeChat()}
          className={iconButton}
        >
          <ChevronLeftIcon className="size-3" />
        </button>
      </div>
      {attached && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-border bg-settings pr-2">
          <PreviewButton />
        </div>
      )}
    </>
  );
}
