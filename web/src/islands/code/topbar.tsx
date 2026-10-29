// Code workspace top bars: the breadcrumb + chat switcher (rendered into the window title bar) and the toolbar
// row with the status line, "Start preview" split button and the right-panel toggle.
import { useEffect, useState } from "react";
import {
  CameraIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FileDownIcon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MonitorPlayIcon,
  PlayIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import { PanelRightIcon, PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { presetImplementPrompt } from "../chat/changes";
import { ChatMenu, ChatMenuContent, ChatMenuItem, ChatMenuLabel, ChatMenuSeparator, ChatMenuTrigger } from "../chat/menu";
import type { ChatState } from "../chat/store";
import { desktop, errorMessage, setStatus, workspace, type DevServerStatus } from "./api";
import { newChat, openChat, QUICK, repositoryByKey, useRepositories } from "./controller";
import { markStep } from "./next-steps";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring aria-pressed:text-foreground-2";

/** `repo / chat ⌃⌄` in the title bar. */
export function Breadcrumb({ state }: { state: ChatState }) {
  useRepositories();
  const quick = state.projectKey === QUICK;
  const repo = repositoryByKey(state.projectKey);
  const chats = workspace()?.chatSummaries?.(state.projectKey) ?? [];
  const title = state.conversations.find((c) => c.id === state.conversationId)?.title || (quick ? "New quick chat" : "New chat");
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      <span className="flex min-w-0 shrink items-center gap-2 px-1 text-foreground-2">
        {quick ? <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span id="code-breadcrumb-repo" className="truncate">
          {quick ? "Quick chats" : repo?.name || state.projectName}
        </span>
      </span>
      <span className="text-subtle-foreground">/</span>
      <ChatMenu modal={false}>
        <ChatMenuTrigger
          id="code-chat-switcher"
          title={state.branch ? `Branch ${state.branch}` : undefined}
          className="flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          {quick ? <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate">{title}</span>
          <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </ChatMenuTrigger>
        <ChatMenuContent align="start" className="w-64">
          <ChatMenuLabel>{quick ? "Quick chats" : repo?.name || state.projectName}</ChatMenuLabel>
          {chats.map((chat) => (
            <ChatMenuItem key={chat.id} checked={chat.id === state.conversationId} onSelect={() => openChat(state.projectKey, chat.id)}>
              {quick ? <MessageSquareIcon /> : <GitBranchIcon />}
              <span className="min-w-0 truncate">{chat.title}</span>
            </ChatMenuItem>
          ))}
          <ChatMenuSeparator />
          <ChatMenuItem onSelect={() => void newChat()}>
            <PlusIcon />
            {quick ? "Create quick chat" : "New chat"}
          </ChatMenuItem>
        </ChatMenuContent>
      </ChatMenu>
      {state.branch && (
        <span id="code-branch" className="ml-1 min-w-0 truncate text-xs text-subtle-foreground">
          {state.branch}
        </span>
      )}
    </div>
  );
}

/** Dev server of the active root (desktop/dev-server.cjs via preload `devServer`). */
function useDevServer(root: string | null | undefined) {
  const [status, setDevStatus] = useState<DevServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDevStatus(null);
    const api = desktop()?.devServer;
    if (!root || !api) return;
    let live = true;
    const poll = () =>
      api
        .status()
        .then((s) => live && s.root === root && setDevStatus(s))
        .catch(() => {});
    void poll();
    const timer = window.setInterval(poll, 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [root]);
  const run = async (fn: () => Promise<DevServerStatus>) => {
    setBusy(true);
    try {
      const next = await fn();
      setDevStatus(next);
      return next;
    } catch (error) {
      setStatus(errorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, run };
}

const showPreview = (url: string, separate: boolean) => {
  if (!separate && window.livePreview) {
    workspace()?.setCodeMode?.(false);
    window.livePreview.show(url);
  } else void desktop()?.previewApp?.({ url });
};

function PreviewButton({ state }: { state: ChatState }) {
  const root = state.activeRoot;
  const { status, busy, run } = useDevServer(root);
  const api = desktop()?.devServer;
  const running = status?.state === "running" || status?.state === "starting";
  const actions = workspace()?.actions;
  const start = async (separate = false) => {
    if (!api || !root) {
      actions?.livePreview?.();
      return;
    }
    if (running && status?.url) {
      showPreview(status.url, separate);
      return;
    }
    setStatus("Starting the dev server…");
    const next = await run(() => api.start());
    if (!next) return;
    if (next.url && next.state === "running") {
      markStep("published");
      setStatus(`Preview running at ${next.url}`);
      showPreview(next.url, separate);
    } else if (next.state === "starting") setStatus("The dev server is starting; its address will open when ready");
    else setStatus(next.error || `The dev server ${next.state}${next.tail ? `: ${next.tail.split("\n").slice(-2).join(" ")}` : ""}`);
  };
  const segment =
    "flex h-6.5 items-center text-sm text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted disabled:opacity-60";
  const label = busy ? "Starting…" : status?.state === "running" ? "Open preview" : status?.state === "starting" ? "Starting…" : "Start preview";
  return (
    <div className="flex shrink-0 items-center rounded-md border border-card-border bg-settings">
      <button type="button" id="code-start-preview" disabled={busy} className={cn(segment, "gap-2 rounded-l-md pr-2.5 pl-2")} onClick={() => void start()}>
        {busy ? (
          <LoaderCircleIcon className="size-3 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : (
          <PlayIcon className={cn("size-3 fill-current", status?.state === "running" ? "text-success" : "text-muted-foreground")} />
        )}
        {label}
      </button>
      <span className="h-6.5 w-px bg-card-border" />
      <ChatMenu modal={false}>
        <ChatMenuTrigger id="code-preview-menu" aria-label="Preview options" className={cn(segment, "w-5.5 justify-center rounded-r-md")}>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </ChatMenuTrigger>
        <ChatMenuContent align="end" className="w-56">
          <ChatMenuItem onSelect={() => void start(true)} disabled={!root}>
            <ExternalLinkIcon />
            Preview in a separate window
          </ChatMenuItem>
          {running && (
            <ChatMenuItem id="code-stop-preview" onSelect={() => api && void run(() => api.stop())}>
              <SquareIcon />
              Stop dev server
            </ChatMenuItem>
          )}
          <ChatMenuItem id="project-preview" onSelect={() => actions?.livePreview?.()}>
            <MonitorPlayIcon />
            Open a local URL…
          </ChatMenuItem>
          <ChatMenuSeparator />
          <ChatMenuItem id="project-capture" onSelect={() => actions?.captureApp?.()}>
            <CameraIcon />
            Capture app to canvas
          </ChatMenuItem>
          <ChatMenuItem id="project-pdf" onSelect={() => actions?.exportPDF?.()}>
            <FileDownIcon />
            Export PDF
          </ChatMenuItem>
          <ChatMenuItem onSelect={presetImplementPrompt}>
            <SparklesIcon />
            Implement selection in code
          </ChatMenuItem>
          <ChatMenuSeparator />
          <ChatMenuItem id="project-git" disabled={!root} onSelect={() => actions?.gitStatus?.()}>
            <GitBranchIcon />
            Git status
          </ChatMenuItem>
          <ChatMenuItem id="project-worktree" disabled={!root} onSelect={() => actions?.createWorktree?.()}>
            <GitForkIcon />
            Create worktree…
          </ChatMenuItem>
        </ChatMenuContent>
      </ChatMenu>
    </div>
  );
}

/** Status line: the latest workspace message, shown for a few seconds. */
function StatusLine({ state }: { state: ChatState }) {
  const at = state.statusAt ?? 0;
  const [expired, setExpired] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(at), Math.max(0, at + 8000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [at]);
  const visible = !!state.status && expired !== at;
  return (
    <p id="code-status" aria-live="polite" title={state.status} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      {visible ? state.status : ""}
    </p>
  );
}

export function Toolbar({ state, panelOpen, onTogglePanel }: { state: ChatState; panelOpen: boolean; onTogglePanel: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
      <StatusLine state={state} />
      <PreviewButton state={state} />
      <button
        type="button"
        id="code-panel-toggle"
        aria-label={panelOpen ? "Hide files and terminal" : "Show files and terminal"}
        title={panelOpen ? "Hide files and terminal" : "Show files and terminal"}
        aria-pressed={panelOpen}
        onClick={onTogglePanel}
        className={iconButton}
      >
        <PanelRightIcon className="size-4" />
      </button>
    </div>
  );
}
