// Follow-up tasks queued behind the running turn, shown above the composer: edit inline, reorder, remove, send now.
import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, ImageIcon, ListOrderedIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { hook } from "./hooks";
import { workspace, type ChatState, type QueuedTask } from "./store";

const ACTION =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground-2 focus-visible:bg-muted focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-30";

function Item({ task, first, last }: { task: QueuedTask; first: boolean; last: boolean }) {
  const ws = workspace();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.text);
  const input = useRef<HTMLTextAreaElement>(null);
  const textButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing) setValue(task.text);
  }, [task.text, editing]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const commit = () => {
    const text = value.trim();
    setEditing(false);
    if (text && text !== task.text) ws?.editQueued?.(task.id, text);
    requestAnimationFrame(() => textButton.current?.focus());
  };
  const canEdit = !!ws?.editQueued;
  return (
    <li className={cn(hook.queueItem, "group/q flex min-h-8 items-start gap-1 rounded-lg px-1.5 py-1 hover:bg-muted/60")}>
      {editing ? (
        <textarea
          ref={input}
          value={value}
          aria-label="Edit queued message"
          rows={1}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setValue(task.text);
              setEditing(false);
            }
          }}
          className="min-h-6 min-w-0 flex-1 resize-none rounded-md bg-input px-1.5 py-0.5 text-sm leading-5 text-foreground outline-hidden field-sizing-content focus:ring-1 focus:ring-ring"
        />
      ) : (
        <button
          ref={textButton}
          type="button"
          disabled={!canEdit}
          title={canEdit ? "Edit" : undefined}
          onClick={() => setEditing(true)}
          className="flex min-h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-sm leading-5 text-foreground-2 focus-visible:bg-muted focus-visible:outline-hidden"
        >
          <span className="line-clamp-2 min-w-0 break-words">{task.text}</span>
          {!!task.images?.length && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-subtle-foreground">
              <ImageIcon className="size-3" />
              {task.images.length}
            </span>
          )}
        </button>
      )}
      <span className="flex shrink-0 items-center opacity-0 group-focus-within/q:opacity-100 group-hover/q:opacity-100">
        {ws?.moveQueued && (
          <>
            <button type="button" aria-label="Move up" title="Move up" disabled={first} className={ACTION} onClick={() => ws.moveQueued?.(task.id, -1)}>
              <ArrowUpIcon className="size-3.5" />
            </button>
            <button type="button" aria-label="Move down" title="Move down" disabled={last} className={ACTION} onClick={() => ws.moveQueued?.(task.id, 1)}>
              <ArrowDownIcon className="size-3.5" />
            </button>
          </>
        )}
        {ws?.removeQueued && (
          <button type="button" aria-label="Remove from queue" title="Remove" className={ACTION} onClick={() => ws.removeQueued?.(task.id)}>
            <Trash2Icon className="size-3.5" />
          </button>
        )}
      </span>
      {ws?.sendQueuedNow && (
        <button
          type="button"
          title="Stop the current turn and send this now"
          onClick={() => ws.sendQueuedNow?.(task.id)}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground-2 focus-visible:bg-muted focus-visible:outline-hidden"
        >
          <CornerDownLeftIcon className="size-3" />
          Send now
        </button>
      )}
    </li>
  );
}

export function QueueList({ state }: { state: ChatState }) {
  const queue = state.queue ?? [];
  if (!queue.length) return null;
  return (
    <section
      aria-label="Queued messages"
      className={cn(hook.queue, "mx-4 mb-2 shrink-0 rounded-xl border border-card-border bg-card p-1")}
    >
      <p className="flex h-6 items-center gap-2 px-1.5 text-sm text-muted-foreground">
        <ListOrderedIcon className="size-3.5" />
        {queue.length} queued {queue.length === 1 ? "message" : "messages"}
      </p>
      <ol className="m-0 flex max-h-40 list-none flex-col overflow-y-auto p-0">
        {queue.map((task, i) => (
          <Item key={task.id} task={task} first={i === 0} last={i === queue.length - 1} />
        ))}
      </ol>
    </section>
  );
}
