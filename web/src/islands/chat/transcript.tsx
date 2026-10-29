// Chat transcript (29, 36, 37, 51): user bubbles, "Wondered for 18s" thinking rows, Markdown replies,
// tool-call cards, permission cards. Keeps the test contract classes: .chat-message(.user|.assistant),
// .chat-tool > summary, .chat-thinking, .chat-permission-allow/-deny, .chat-error.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FrameIcon,
  HistoryIcon,
  PencilIcon,
  RotateCcwIcon,
  CircleDotIcon,
  CircleAlertIcon,
  FileIcon,
  FilePenIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  ImageIcon,
  LoaderCircleIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  ShieldXIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { LogoIcon } from "@/components/icons";
import { legacySet } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Markdown, openAppLink } from "./markdown";
import { ChatMenu, ChatMenuContent, ChatMenuItem, ChatMenuLabel, ChatMenuSeparator, ChatMenuTrigger } from "./menu";
import { MentionIcon } from "./mention-popover";
import { QuestionCard } from "./question-card";
import { usageSummary } from "./usage-ring";
import { useAdopt } from "./adopt";
import { hook, stateHook } from "./hooks";
import { useNow, workspace, type ChatMessage, type ChatPart, type ChatState } from "./store";

const pretty = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const seconds = (from?: number, to?: number) => Math.max(1, Math.round(((to ?? from ?? 0) - (from ?? 0)) / 1000));

/** Wonder's 3×3 dot grid: "Wondering…" marker while a turn runs (37, 39). */
function DotGrid({ live, className }: { live?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn(hook.dots, "size-3 shrink-0", className)}>
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 4.5}
            y={row * 4.5}
            width="3"
            height="3"
            rx="0.6"
            fill="currentColor"
            className={live ? "animate-pulse" : undefined}
          />
        )),
      )}
    </svg>
  );
}

/** "Wondered for 18s ›" — the turn header: collapsible, with a divider under it (29, 37, 51). */
function TurnHeader({ label, live, children }: { label: string; live?: boolean; children?: ReactNode }) {
  const body = (
    <>
      {live && <DotGrid live className="text-muted-foreground" />}
      <span>{label}</span>
    </>
  );
  const row = "flex list-none items-center gap-2 border-b border-border p-0 pb-2 text-base leading-5.25 text-muted-foreground";
  if (!children)
    return (
      <div className={cn(hook.thinking, "mb-0.5")}>
        <div className={row}>{body}</div>
      </div>
    );
  return (
    <details
      className={cn(hook.thinking, "group/think m-0 mb-0.5 rounded-none border-0 bg-transparent p-0 text-base leading-5.25")}
    >
      <summary className={cn(row, "hover:text-foreground-3")}>
        {body}
        <ChevronRightIcon className="size-3 transition-transform group-open/think:rotate-90" />
      </summary>
      <div className="flex flex-col gap-1 pt-2.5">{children}</div>
    </details>
  );
}

/** Reasoning text inside the turn header. */
function ThinkingText({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <p className="py-1 text-sm leading-5 whitespace-pre-wrap text-muted-foreground">{text.trim()}</p>;
}

/* ---------- Tool calls: Wonder shows "Ran 5 commands ›" and the live step ("Editing the canvas", 39). ---------- */

const CANVAS = /^mcp__verynize__/;
const SHELL = /^(shell|bash|exec_command|local_shell)$/i;
const input = (part: ChatPart) => (part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {});
const base = (value: unknown) => String(value ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
const humanize = (name: string) => {
  const text = name.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : name;
};

/** Icon, row label and the progressive "doing" label of a tool call. */
function describeTool(part: ChatPart) {
  const name = part.name ?? "";
  const args = input(part);
  const title = part.title || name;
  if (CANVAS.test(name)) {
    const tool = name.replace(CANVAS, "");
    const live = /screenshot|capture/.test(tool)
      ? "Taking a screenshot"
      : /^(get|list|read|search|find|describe|inspect)/.test(tool)
        ? "Reading the canvas"
        : /export/.test(tool)
          ? "Exporting from the canvas"
          : "Editing the canvas";
    return { Icon: SquareTerminalIcon, label: humanize(tool), mono: false, live };
  }
  if (SHELL.test(name)) {
    const command = String(args.command ?? title.replace(/^\S+\s/, ""));
    return { Icon: SquareTerminalIcon, label: command, mono: true, live: `Running ${command}` };
  }
  const file = base(args.file_path ?? args.path ?? (Array.isArray(args.files) ? args.files[0] : ""));
  if (/^(read|view_image|notebookread)$/i.test(name)) return { Icon: FileTextIcon, label: `Read ${file}`, mono: false, live: `Reading ${file}` };
  if (/^(edit|write|multiedit|notebookedit|apply_patch)$/i.test(name))
    return { Icon: FilePenIcon, label: `Edited ${file || "files"}`, mono: false, live: `Editing ${file || "files"}` };
  if (/^(grep|glob|ls)$/i.test(name))
    return { Icon: SearchIcon, label: title, mono: false, live: `Searching ${String(args.pattern ?? args.path ?? "")}`.trim() };
  if (/web_?search|webfetch/i.test(name)) return { Icon: GlobeIcon, label: title, mono: false, live: "Searching the web" };
  return { Icon: SquareTerminalIcon, label: title, mono: false, live: title };
}

const toolCount = (count: number) => `Ran ${count} ${count === 1 ? "command" : "commands"}`;

type Indexed = { part: ChatPart; index: number };
/** Subagent calls nested under their parent tool call (parentToolCallId → parent's id). */
type Nesting = { children: Map<string, Indexed[]>; nested: Set<number> };
function nestTools(parts: ChatPart[]): Nesting {
  const ids = new Set(parts.filter((p) => p.kind === "tool" && p.id).map((p) => p.id!));
  const children = new Map<string, Indexed[]>();
  const nested = new Set<number>();
  parts.forEach((part, index) => {
    const parent = part.parentToolCallId;
    if (!parent || parent === part.id || !ids.has(parent)) return;
    // Pending approvals and questions stay at the top level where they can be answered.
    if (part.kind !== "tool" && !(part.kind === "permission" && part.state !== "pending")) return;
    nested.add(index);
    children.set(parent, [...(children.get(parent) ?? []), { part, index }]);
  });
  return { children, nested };
}

/** Collapsible list of a tool call's subagent steps, indented under it. */
function SubSteps({ items, nesting, onToggle }: { items: Indexed[]; nesting: Nesting; onToggle: (index: number, open: boolean) => void }) {
  const live = items.some(({ part }) => part.kind === "tool" && (part.state ?? "running") === "running");
  return (
    <details open={live || undefined} className="group/sub m-0 ml-1.5 border-l border-border pl-3.5">
      <summary className="flex h-6 list-none items-center gap-2 p-0 text-sm text-subtle-foreground hover:text-foreground-3">
        {items.length} {items.length === 1 ? "step" : "steps"}
        <ChevronRightIcon className="size-3 transition-transform group-open/sub:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col">
        {items.map(({ part, index }) =>
          part.kind === "tool" ? (
            <ToolRow key={index} part={part} nesting={nesting} onToggle={(open) => onToggle(index, open)} onToggleChild={onToggle} />
          ) : part.kind === "permission" ? (
            <PermissionRow key={index} part={part} />
          ) : null,
        )}
      </div>
    </details>
  );
}

function ToolRow({
  part,
  onToggle,
  nesting,
  onToggleChild,
}: {
  part: ChatPart;
  onToggle: (open: boolean) => void;
  nesting?: Nesting;
  onToggleChild?: (index: number, open: boolean) => void;
}) {
  const kids = (part.id && nesting?.children.get(part.id)) || [];
  const state = part.state || "running";
  const { Icon, label, mono } = describeTool(part);
  const args = input(part);
  const shell = SHELL.test(part.name ?? "");
  const body = !part.hasInput && part.partialInput ? part.partialInput : shell && args.command ? String(args.command) : pretty(part.input ?? {});
  const block = "m-0 max-h-55 overflow-auto font-mono text-xs leading-4.5 break-words whitespace-pre-wrap";
  const row = (
    <details
      className={cn(hook.tool, "group/tool m-0 rounded-none border-0 bg-transparent p-0", stateHook(state))}
      open={!!part.open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary
        title={part.title || part.name}
        className="flex h-6 list-none items-center gap-2 p-0 text-sm text-muted-foreground hover:text-foreground-3"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className={cn(hook.toolTitle, "min-w-0 truncate", mono && "font-mono text-xs")}>{label}</span>
        {state === "running" && (
          <LoaderCircleIcon aria-label="running" className={cn(hook.toolState, "size-3.5 shrink-0 animate-spin")} />
        )}
        {(state === "error" || state === "interrupted") && (
          <CircleAlertIcon
            aria-label={state}
            className={cn(hook.toolState, "size-3.5 shrink-0", state === "error" ? "text-destructive" : "text-subtle-foreground")}
          />
        )}
        <ChevronRightIcon
          className="size-3 shrink-0 opacity-0 transition-transform group-open/tool:rotate-90 group-open/tool:opacity-100 group-hover/tool:opacity-100"
        />
      </summary>
      <div className={cn(hook.toolBody, "mt-1 mb-1.5 ml-5.5 overflow-hidden rounded-lg border border-card-border bg-card")}>
        <pre className={cn(block, "px-2.5 py-2 text-foreground-3")}>{body}</pre>
        {part.result !== undefined && (
          <pre
            className={cn(
              block,
              "border-t border-card-border px-2.5 py-2",
              state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {part.result || "(no output)"}
          </pre>
        )}
      </div>
    </details>
  );
  if (!kids.length || !nesting || !onToggleChild) return row;
  return (
    <div className="flex flex-col">
      {row}
      <SubSteps items={kids} nesting={nesting} onToggle={onToggleChild} />
    </div>
  );
}

/** Completed tool calls of a running turn, collapsed to "Ran N commands ›" (39). */
function ToolGroup({ tools, nesting, onToggle }: { tools: Indexed[]; nesting: Nesting; onToggle: (index: number, open: boolean) => void }) {
  return (
    <details className="group/tools m-0 rounded-none border-0 bg-transparent p-0">
      <summary className="flex list-none items-center gap-2 p-0 text-base leading-5.25 text-muted-foreground hover:text-foreground-3">
        {toolCount(tools.length)}
        <ChevronRightIcon className="size-3 transition-transform group-open/tools:rotate-90" />
      </summary>
      <div className="flex flex-col pt-1.5">
        {tools.map(({ part, index }) => (
          <ToolRow key={index} part={part} nesting={nesting} onToggle={(open) => onToggle(index, open)} onToggleChild={onToggle} />
        ))}
      </div>
    </details>
  );
}

/** The step a running turn is on: "Editing the canvas" with a shimmer-free pulse (39). */
function LiveStep({ part, nesting }: { part: ChatPart; nesting: Nesting }) {
  const child = (part.id && nesting.children.get(part.id)?.findLast(({ part: p }) => p.kind === "tool" && (p.state ?? "running") === "running")?.part) || null;
  const { Icon, live } = describeTool(child ?? part);
  return (
    <p className={cn("flex min-w-0 items-center gap-2 text-base leading-5.25 text-muted-foreground")}>
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 animate-pulse truncate">{live}</span>
    </p>
  );
}

function PermissionCard({ part, onAnswer }: { part: ChatPart; onAnswer: (allow: boolean, always?: boolean) => void }) {
  const args = input(part);
  const detail = typeof args.command === "string" ? args.command : pretty(part.input).slice(0, 2000);
  return (
    <div className={cn(hook.permission, "m-0 rounded-xl border border-card-border bg-card p-3 text-base leading-5.25", stateHook(part.state))}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldQuestionIcon className="size-3.5 text-primary-text" />
        Approval needed
      </p>
      <p className="mt-1 break-words text-foreground">Allow {part.title || part.toolName}?</p>
      {detail && detail !== "{}" && (
        <pre className="m-0 mt-2 max-h-40 overflow-auto rounded-lg border border-card-border bg-settings px-2.5 py-2 font-mono text-xs leading-4.5 break-words whitespace-pre-wrap text-foreground-3">
          {detail}
        </pre>
      )}
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          type="button"
          className={cn(hook.deny, "flex h-6 items-center rounded-md border border-edge px-2.5 text-sm text-foreground-2 hover:bg-muted")}
          onClick={() => onAnswer(false)}
        >
          Deny
        </button>
        <button
          type="button"
          title={`Allow ${part.toolName || "this tool"} for the rest of this chat`}
          className="flex h-6 items-center rounded-md border border-edge px-2.5 text-sm text-foreground-2 hover:bg-muted"
          onClick={() => onAnswer(true, true)}
        >
          Always allow
        </button>
        <button
          type="button"
          className={cn(hook.allow, "flex h-6 items-center rounded-md bg-primary px-2.5 text-sm text-primary-foreground hover:bg-primary-hover")}
          onClick={() => onAnswer(true)}
        >
          Allow
        </button>
      </div>
    </div>
  );
}

/** A permission that was answered (or expired): one quiet row in the turn's details. */
function PermissionRow({ part }: { part: ChatPart }) {
  const allowed = part.state === "allowed";
  const Icon = allowed ? ShieldCheckIcon : ShieldXIcon;
  const verb = { allowed: "Allowed", denied: "Denied", expired: "Expired" }[part.state ?? ""] ?? part.state;
  return (
    <p className={cn(hook.permission, stateHook(part.state), "flex h-6 min-w-0 items-center gap-2 text-sm text-muted-foreground")}>
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {verb}: {part.title || part.toolName}
      </span>
    </p>
  );
}

function ErrorRow({ text }: { text?: string }) {
  return (
    <div className={cn(hook.error, "flex gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive")}>
      <CircleAlertIcon className="mt-0.75 size-3.5 shrink-0" />
      <p className="min-w-0 break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}

const STATE_NOTE: Record<string, string> = {
  stopped: "Agent stopped",
  failed: "Agent failed",
  interrupted: "Agent interrupted",
  error: "Agent error",
};

/* ---------- Per-message actions (hover / focus-within; absolutely placed, so no layout shift) ---------- */

const ACTION =
  "flex size-5 shrink-0 items-center justify-center rounded-sm text-subtle-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-hidden data-[state=open]:bg-muted data-[state=open]:text-foreground";

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={ACTION}>
      {children}
    </button>
  );
}

/** Text of a message for the clipboard: the visible reply, not tool output. */
function messageText(message: ChatMessage) {
  const parts = (message.parts ?? []).filter((p) => p.kind === "text" && p.text?.trim()).map((p) => p.text!.trim());
  return parts.length ? parts.join("\n\n") : message.text;
}

function CopyButton({ index, message }: { index: number; message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        const ws = workspace();
        if (ws?.copyMessage) ws.copyMessage(index);
        else void navigator.clipboard?.writeText(messageText(message));
        setCopied(true);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </ActionButton>
  );
}

/** "Restore to here" with an inline confirmation: reverts the canvas to the checkpoint before this message. */
function RestoreButton({ index }: { index: number }) {
  return (
    <ChatMenu modal={false}>
      <ChatMenuTrigger title="Restore checkpoint" aria-label="Restore checkpoint" className={ACTION}>
        <HistoryIcon className="size-3.5" />
      </ChatMenuTrigger>
      <ChatMenuContent align="end" side="bottom" className="w-64">
        <ChatMenuLabel className="h-auto py-1 leading-4.5">
          Restore the canvas to how it was before this message? Later messages are removed from the chat.
        </ChatMenuLabel>
        <ChatMenuSeparator />
        <ChatMenuItem onSelect={() => workspace()?.rewindTo?.(index)}>
          <HistoryIcon />
          Restore to here
        </ChatMenuItem>
        <ChatMenuItem>Cancel</ChatMenuItem>
      </ChatMenuContent>
    </ChatMenu>
  );
}

function ActionBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        hook.messageActions,
        "absolute top-full z-10 mt-0.5 flex items-center gap-0.5 opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 has-[[data-state=open]]:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ForkButton({ index }: { index: number }) {
  return (
    <ActionButton label="Continue from here (forks the transcript; files are not reverted)" onClick={() => workspace()?.forkAt(index)}>
      <GitBranchIcon className="size-3.5" />
    </ActionButton>
  );
}

// Context chip inside a user bubble (37): bordered, on the bubble's fill.
const USER_CHIP = "flex h-6 max-w-full items-center gap-1.5 rounded-md border border-chat-chip-border px-2 text-foreground-2";

function EditBox({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => {
    const text = value.trim();
    if (text && text !== initial.trim()) onSave(text);
    else onCancel();
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        aria-label="Edit message"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        className="max-h-60 min-h-10 w-full resize-none bg-transparent text-base leading-5.25 text-foreground outline-hidden field-sizing-content"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-xs text-subtle-foreground">Resends from here</span>
        <button type="button" onClick={onCancel} className="flex h-6 items-center rounded-md border border-edge px-2.5 text-sm text-foreground-2 hover:bg-muted">
          Cancel
        </button>
        <button type="button" onClick={save} className="flex h-6 items-center rounded-md bg-primary px-2.5 text-sm text-primary-foreground hover:bg-primary-hover">
          Send
        </button>
      </div>
    </div>
  );
}

function UserMessage({ message, index, busy }: { message: ChatMessage; index: number; busy: boolean }) {
  const ws = workspace();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLSpanElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.querySelector("button")?.focus());
  };
  const mentions = message.mentions ?? [];
  return (
    <article className={cn(hook.userMessage, "group/msg relative m-0 flex w-full max-w-none flex-col items-end rounded-none border-0 bg-transparent p-0 text-base leading-5.25 text-foreground")}>
      <div className={cn("relative max-w-full rounded-2xl bg-input px-3 py-2", editing && "w-full")}>
        {(!!message.images?.length || !!message.canvas || mentions.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.canvas && (
              <span className={cn(USER_CHIP)}>
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{message.canvas}</span>
              </span>
            )}
            {mentions.map((mention) => (
              <span key={mention.id} className={cn(hook.mention, USER_CHIP)} title={mention.type ? `${mention.label} (${mention.type})` : mention.label}>
                {mention.type ? <MentionIcon type={mention.type} /> : <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{mention.label}</span>
              </span>
            ))}
            {message.images?.map((name, i) => (
              <span key={i} className={cn(hook.images, USER_CHIP)}>
                <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        )}
        {editing ? (
          <EditBox
            initial={message.text}
            onCancel={close}
            onSave={(text) => {
              setEditing(false);
              ws?.editMessage?.(index, text);
            }}
          />
        ) : (
          <div className={cn(hook.messageContent, "break-words whitespace-pre-wrap")}>{message.text}</div>
        )}
        {!busy && !editing && (
          // Fork stays the first button of a user message (tests/agent-chat.cjs clicks `.chat-message.user button`).
          <ActionBar className="right-0">
            <ForkButton index={index} />
            <CopyButton index={index} message={message} />
            {ws?.editMessage && (
              <span ref={editButton} className="contents">
                <ActionButton label="Edit message" onClick={() => setEditing(true)}>
                  <PencilIcon className="size-3.5" />
                </ActionButton>
              </span>
            )}
            {ws?.rewindTo && message.checkpoint && <RestoreButton index={index} />}
          </ActionBar>
        )}
      </div>
    </article>
  );
}

type Block =
  | { type: "text"; key: string; text: string }
  | { type: "tools"; key: string; done: Indexed[]; live?: Indexed }
  | { type: "permission"; key: string; item: Indexed }
  | { type: "question"; key: string; item: Indexed }
  | { type: "error"; key: string; text?: string };

/** Visible blocks of a running turn: text, "Ran N commands" + live step, pending approvals, errors. */
function runningBlocks(parts: ChatPart[], nesting: Nesting): Block[] {
  const blocks: Block[] = [];
  parts.forEach((part, index) => {
    if (nesting.nested.has(index)) return;
    const key = `${index}-${part.kind}`;
    if (part.kind === "text" && part.text?.trim()) blocks.push({ type: "text", key, text: part.text });
    else if (part.kind === "tool") {
      let last = blocks.at(-1);
      if (last?.type !== "tools") {
        last = { type: "tools", key, done: [] };
        blocks.push(last);
      }
      if (part.state === "running") last.live = { part, index };
      else last.done.push({ part, index });
    } else if (part.kind === "permission") blocks.push({ type: "permission", key, item: { part, index } });
    else if (part.kind === "question") blocks.push({ type: "question", key, item: { part, index } });
    else if (part.kind === "error") blocks.push({ type: "error", key, text: part.text });
  });
  return blocks;
}

/** verynize:// links reported by finish_artboard tool results (designLink), deduplicated. */
function artboardLinks(parts: ChatPart[]): { url: string; name?: string }[] {
  const out = new Map<string, string | undefined>();
  for (const part of parts) {
    if (part.kind !== "tool" || !/finish_artboard/i.test(part.name ?? "") || !part.result) continue;
    let name: string | undefined;
    try {
      const parsed = JSON.parse(part.result) as Record<string, unknown>;
      if (typeof parsed.name === "string") name = parsed.name;
      if (typeof parsed.designLink === "string" && /^verynize:\/\//i.test(parsed.designLink)) out.set(parsed.designLink, name);
    } catch {
      // Plain-text result: fall through to the URL scan.
    }
    for (const match of part.result.matchAll(/verynize:\/\/[^\s"'<>()`\]]+/gi)) if (!out.has(match[0])) out.set(match[0], name);
  }
  return [...out].map(([url, name]) => ({ url, name }));
}

function ArtboardPill({ url, name }: { url: string; name?: string }) {
  return (
    <button
      type="button"
      title={url}
      onClick={() => openAppLink(url)}
      className={cn(
        hook.artboardLink,
        "flex h-7 max-w-full items-center gap-2 self-start rounded-lg border border-card-border bg-card px-2.5 text-sm text-foreground-2 hover:bg-muted",
      )}
    >
      <FrameIcon className="size-3.5 shrink-0 text-primary-text" />
      <span className="truncate">{name ? `Open ${name}` : "Open artboard"}</span>
    </button>
  );
}

function AssistantMessage({
  message,
  index,
  busy,
  live,
}: {
  message: ChatMessage;
  index: number;
  busy: boolean;
  live: boolean;
}) {
  const ws = workspace();
  const running = live && message.state === "running";
  const now = useNow(running);
  const parts = message.parts ?? [];
  const nesting = nestTools(parts);
  const toggle = (partIndex: number, open: boolean) => ws?.setPartOpen(index, partIndex, open);
  const answer = (partIndex: number, allow: boolean, always?: boolean) =>
    always ? ws?.answerPermission(index, partIndex, allow, true) : ws?.answerPermission(index, partIndex, allow);
  const answerQuestion = ws?.answerQuestion ? (partIndex: number) => (answers: Record<string, string>) => ws.answerQuestion?.(index, partIndex, answers) : null;
  const question = (part: ChatPart, partIndex: number, key: string | number) => (
    <QuestionCard key={key} part={part} onSubmit={answerQuestion?.(partIndex)} />
  );
  const thinking = parts.filter((p) => p.kind === "thinking" && p.text?.trim());
  const links = ws?.openLink ? artboardLinks(parts) : [];
  let content: ReactNode;
  if (running) {
    const blocks = runningBlocks(parts, nesting);
    content = (
      <>
        <TurnHeader live label={`Wondering for ${seconds(message.at, now)}s`}>
          {thinking.length ? thinking.map((part, i) => <ThinkingText key={i} text={part.text} />) : undefined}
        </TurnHeader>
        {blocks.length === 0 && <p className="text-muted-foreground">Thinking</p>}
        {blocks.map((block) => {
          if (block.type === "text") return <Markdown key={block.key} text={block.text} />;
          if (block.type === "error") return <ErrorRow key={block.key} text={block.text} />;
          if (block.type === "question") return question(block.item.part, block.item.index, block.key);
          if (block.type === "permission")
            return block.item.part.state === "pending" ? (
              <PermissionCard
                key={block.key}
                part={block.item.part}
                onAnswer={(allow, always) => answer(block.item.index, allow, always)}
              />
            ) : (
              <PermissionRow key={block.key} part={block.item.part} />
            );
          return (
            <div key={block.key} className="flex flex-col gap-3">
              {block.done.length > 0 && <ToolGroup tools={block.done} nesting={nesting} onToggle={toggle} />}
              {block.live && <LiveStep part={block.live.part} nesting={nesting} />}
            </div>
          );
        })}
      </>
    );
  } else {
    // Finished turn: "Wondered for Ns ›" holds the work (reasoning, tool calls, approvals); the answer stays visible.
    const work = parts.flatMap((part, partIndex) => {
      if (nesting.nested.has(partIndex)) return [];
      if (part.kind === "thinking") return [<ThinkingText key={partIndex} text={part.text} />];
      if (part.kind === "tool")
        return [
          <ToolRow key={partIndex} part={part} nesting={nesting} onToggle={(open) => toggle(partIndex, open)} onToggleChild={toggle} />,
        ];
      if (part.kind === "permission") return [<PermissionRow key={partIndex} part={part} />];
      return [];
    });
    const tools = parts.filter((p) => p.kind === "tool").length;
    const timed = message.at && message.end;
    const label = timed ? `Wondered for ${seconds(message.at, message.end)}s` : tools ? toolCount(tools) : "Thought";
    const answerParts = parts
      .map((part, partIndex) => ({ part, index: partIndex }))
      .filter(({ part: p }) => (p.kind === "text" && p.text?.trim()) || p.kind === "error" || p.kind === "question");
    content = (
      <>
        {(work.length > 0 || (timed && parts.length > 0)) && <TurnHeader label={label}>{work.length ? work : undefined}</TurnHeader>}
        {parts.length === 0 &&
          message.text &&
          (message.state === "error" ? <ErrorRow text={message.text} /> : <Markdown text={message.text} />)}
        {answerParts.map(({ part, index: partIndex }) =>
          part.kind === "error" ? (
            <ErrorRow key={partIndex} text={part.text} />
          ) : part.kind === "question" ? (
            question(part, partIndex, partIndex)
          ) : (
            <Markdown key={partIndex} text={part.text ?? ""} />
          ),
        )}
      </>
    );
  }

  const usage = !running && message.usage ? usageSummary(message.usage) : "";
  return (
    <article
      className={cn(
        hook.assistantMessage,
        "group/msg relative m-0 flex w-full max-w-none flex-col gap-2.5 rounded-none border-0 bg-transparent p-0 text-base leading-5.25 text-foreground",
      )}
    >
      {content}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <ArtboardPill key={link.url} url={link.url} name={link.name} />
          ))}
        </div>
      )}
      {message.state && STATE_NOTE[message.state] && <p className="text-sm text-subtle-foreground">{STATE_NOTE[message.state]}</p>}
      {usage && <p className={cn(hook.usage, "self-end text-xs text-subtle-foreground tabular-nums")}>{usage}</p>}
      {!busy && (
        <ActionBar className="left-0">
          <ForkButton index={index} />
          <CopyButton index={index} message={message} />
          {ws?.retry && (
            <ActionButton label="Retry" onClick={() => ws.retry?.(index)}>
              <RotateCcwIcon className="size-3.5" />
            </ActionButton>
          )}
        </ActionBar>
      )}
    </article>
  );
}

/** Empty chat (34, 35): logo + prompt, with the workspace's suggestions as cards that fill the composer. */
function EmptyState({ suggestions }: { suggestions: { title: string; prompt: string }[] }) {
  const fill = (prompt: string) => {
    const el = document.getElementById("project-prompt") as HTMLTextAreaElement | null;
    if (!el) return;
    legacySet(el, prompt);
    el.focus();
    el.setSelectionRange(prompt.length, prompt.length);
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-42 text-center">
      <LogoIcon className="size-7 text-muted-foreground" />
      <p className="text-base leading-5.25 font-medium text-foreground">What would you like to work on?</p>
      {suggestions.length > 0 && (
        <ul aria-label="Suggestions" className="m-0 mt-3 grid w-full max-w-100 list-none grid-cols-2 gap-1.5 p-0">
          {suggestions.slice(0, 4).map((item) => (
            <li key={item.title} className="flex">
              <button
                type="button"
                title={item.prompt}
                onClick={() => fill(item.prompt)}
                className={cn(
                  hook.suggestion,
                  "flex w-full flex-col items-start gap-0.5 rounded-xl border border-card-border bg-card px-3 py-2 text-left hover:bg-muted focus-visible:border-ring focus-visible:outline-hidden",
                )}
              >
                <span className="w-full truncate text-sm text-foreground-2">{item.title}</span>
                <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{item.prompt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Transcript({ state }: { state: ChatState }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const lastLength = useRef(0);
  const lastConversation = useRef<string | null>(null);
  const sessionSlot = useAdopt("chat-session", (el) => {
    // Session line (test contract) stays readable by assistive tech but is not shown, as in Wonder.
    el.className = cn(hook.session, "sr-only");
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastConversation.current !== state.conversationId) {
      lastConversation.current = state.conversationId;
      pinned.current = true;
    }
    // A new turn (the user's own message) always follows the bottom again.
    if (state.messages.length > lastLength.current) pinned.current = true;
    lastLength.current = state.messages.length;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [state]);

  // Stay pinned to the bottom when the content or the viewport resizes (fonts, composer chips, streaming).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.lastElementChild ?? el.firstElementChild);
    return () => observer.disconnect();
  }, [state.messages.length]);

  const lastAssistant = state.messages.findLastIndex((m) => m.role === "assistant");
  return (
    <div
      ref={scroller}
      onClick={(event) => {
        // Expanding a row is reading, not following: keep the row where it is instead of jumping to the bottom.
        if ((event.target as HTMLElement).closest("summary")) pinned.current = false;
      }}
      onScroll={(event) => {
        const el = event.currentTarget;
        // Re-pin near the bottom; unpin only when the user scrolls up (resizes and zoom changes must not unpin).
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) pinned.current = true;
        else if (el.scrollTop < lastTop.current - 1) pinned.current = false;
        lastTop.current = el.scrollTop;
      }}
      className={cn(hook.scroll, "flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 pr-4 pb-6 pl-6")}
    >
      <div ref={sessionSlot} className="contents" />
      {state.messages.length === 0 ? (
        <EmptyState suggestions={state.suggestions ?? []} />
      ) : (
        <div className="flex flex-col gap-5">
          {state.messages.map((message, index) =>
            message.role === "user" ? (
              <UserMessage key={index} message={message} index={index} busy={state.busy} />
            ) : (
              <AssistantMessage
                key={index}
                message={message}
                index={index}
                busy={state.busy}
                live={state.busy && index === lastAssistant}
              />
            ),
          )}
        </div>
      )}
      {state.queued > 0 && !state.queue?.length && (
        <p className="mt-4 text-xs text-primary-text">
          {state.queued} {state.queued === 1 ? "task" : "tasks"} queued
        </p>
      )}
    </div>
  );
}
