// Staged preview edits (Wonder X2 / PP2): the amber "N changes" badge on each preview frame with its "Preview changes"
// popover, and the "Discard preview edits?" confirmation that stop paths await (window.previewEdits.confirmBeforeStop).
// The edits themselves live in web/preview-edit.js; this file only renders them.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertDialog, Popover } from "radix-ui";
import {
  ChevronDownIcon,
  DiffIcon,
  EyeClosedIcon,
  EyeIcon,
  EyeOffIcon,
  Undo2Icon,
} from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import "./preview-changes.css";

type Change = {
  key: string;
  path: string;
  kind: "text" | "style";
  prop: string;
  label: string;
  tag: string;
  text: string;
  from: string;
  after: string;
  hidden: boolean;
};
type EditsApi = {
  frames(): string[];
  count(id: string): number;
  changes(id: string): Change[];
  hiddenAll(id: string): boolean;
  toggleHidden(id: string, key: string): void;
  toggleHideAll(id: string): void;
  revert(id: string, key: string): void;
  revertAll(id: string): void;
};
type ConfirmDetail = {
  frameId: string;
  count: number;
  handled: boolean;
  resolve(ok: boolean): void;
};
const edits = () => (window as unknown as { previewEdits?: EditsApi }).previewEdits;
const frameElement = (id: string) =>
  (
    window as unknown as { livePreview?: { nodeElement(id: string): HTMLElement | undefined } }
  ).livePreview?.nodeElement(id);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const quoted = (text: string) => `“${text}”`;

function useEditsVersion() {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("bd:preview-edits", bump);
    window.addEventListener("bd:preview-state", bump);
    return () => {
      window.removeEventListener("bd:preview-edits", bump);
      window.removeEventListener("bd:preview-state", bump);
    };
  }, []);
  return version;
}

function ChangeGroup({ frameId, changes }: { frameId: string; changes: Change[] }) {
  const first = changes[0];
  const hidden = changes.every((c) => c.hidden);
  const label = first.text
    ? quoted(first.text.length > 40 ? first.text.slice(0, 40) + "…" : first.text)
    : "";
  return (
    <li data-pe="preview-change" data-change-path={first.path}>
      <div data-pe="preview-change-head">
        <span data-pe="preview-change-name">
          <b>{first.tag}</b> {label}
        </span>
        <button
          type="button"
          aria-label={hidden ? "Show change" : "Hide change"}
          aria-pressed={hidden}
          title={hidden ? "Show change" : "Hide change"}
          onClick={() => {
            for (const c of changes) if (c.hidden === hidden) edits()?.toggleHidden(frameId, c.key);
          }}
        >
          {hidden ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
        <button
          type="button"
          aria-label="Revert change"
          title="Revert change"
          onClick={() => {
            for (const c of changes) edits()?.revert(frameId, c.key);
          }}
        >
          <Undo2Icon className="size-4" />
        </button>
      </div>
      {changes.map((c) => (
        <div key={c.key} data-pe="preview-change-row" data-prop={c.prop}>
          <span>{c.label}</span>
          <span data-pe="preview-change-values">
            <s>{c.kind === "text" ? quoted(c.from) : c.from}</s>
            <span>{c.kind === "text" ? quoted(c.after) : c.after}</span>
          </span>
        </div>
      ))}
    </li>
  );
}

function ChangesBadge({ frameId, host }: { frameId: string; host: HTMLElement }) {
  const [open, setOpen] = useState(false);
  const api = edits();
  const count = api?.count(frameId) ?? 0;
  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);
  // Wonder PF4-resize: the badge shares the breadcrumb row, so the breadcrumb ends before it and truncates.
  const badge = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const width = count ? (badge.current?.offsetWidth ?? 0) : 0;
    if (width) host.style.setProperty("--pf-badge-space", width + 8 + "px");
    else host.style.removeProperty("--pf-badge-space");
  }, [count, host]);
  useEffect(
    () => () => {
      host.style.removeProperty("--pf-badge-space");
    },
    [host],
  );
  if (!api) return null;
  const changes = api.changes(frameId);
  const groups = [
    ...new Map(changes.map((c) => [c.path, changes.filter((o) => o.path === c.path)])).values(),
  ];
  const hideAll = api.hiddenAll(frameId);
  return createPortal(
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          ref={badge}
          data-pe="preview-changes-badge"
          data-frame-id={frameId}
          hidden={!count}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DiffIcon className="size-3.5" />
          {plural(count, "change")}
          <ChevronDownIcon className="size-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer()}>
        <Popover.Content
          id="preview-changes"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div data-pe="preview-changes-head">
            <span data-pe="preview-changes-icon">
              <DiffIcon className="size-4" />
            </span>
            <span>
              <strong>Preview changes</strong>
              <small>Not in your code yet</small>
            </span>
          </div>
          <ul>
            {groups.map((group) => (
              <ChangeGroup key={group[0].path} frameId={frameId} changes={group} />
            ))}
          </ul>
          <div data-pe="preview-changes-actions">
            <button
              type="button"
              id="preview-changes-hide"
              aria-pressed={hideAll}
              onClick={() => api.toggleHideAll(frameId)}
            >
              <span data-pe="preview-changes-icon" data-tone="muted">
                {hideAll ? <EyeIcon className="size-4" /> : <EyeClosedIcon className="size-4" />}
              </span>
              <span>
                <strong>{hideAll ? "Show all changes" : "Hide all changes"}</strong>
                <small>Compare with the original</small>
              </span>
            </button>
            <button
              type="button"
              id="preview-changes-revert"
              onClick={() => {
                api.revertAll(frameId);
                setOpen(false);
              }}
            >
              <span data-pe="preview-changes-icon" data-tone="danger">
                <Undo2Icon className="size-4" />
              </span>
              <span>
                <strong data-tone="danger">Revert all changes</strong>
                <small>Puts back the original values</small>
              </span>
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>,
    host,
  );
}

function DiscardDialog() {
  const [pending, setPending] = useState<ConfirmDetail | null>(null);
  useEffect(() => {
    const ask = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmDetail>).detail;
      detail.handled = true;
      setPending((current) => {
        current?.resolve(false);
        return detail;
      });
    };
    window.addEventListener("bd:preview-discard-confirm", ask);
    return () => window.removeEventListener("bd:preview-discard-confirm", ask);
  }, []);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const n = pending?.count ?? 0;
  return (
    <AlertDialog.Root
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <AlertDialog.Portal container={portalContainer()}>
        <AlertDialog.Overlay data-pe="preview-discard-overlay" />
        <AlertDialog.Content
          id="preview-discard-dialog"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div data-pe="preview-discard-body">
            <AlertDialog.Title>Discard preview edits?</AlertDialog.Title>
            <AlertDialog.Description>
              <b>{plural(n, "unsaved edit")}</b> will be lost when this preview stops.
              <br />
              This can’t be undone.
            </AlertDialog.Description>
          </div>
          <div data-pe="preview-discard-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" id="preview-discard-keep">
                Keep editing
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button type="button" id="preview-discard-confirm" onClick={() => close(true)}>
                Discard and stop
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Mounted with the preview toolbar; badges portal into every preview frame that has staged edits. */
export function PreviewChanges() {
  useEditsVersion();
  const frames = edits()?.frames() ?? [];
  return (
    <>
      {frames.map((id) => {
        const host = frameElement(id);
        return host ? <ChangesBadge key={id} frameId={id} host={host} /> : null;
      })}
      <DiscardDialog />
    </>
  );
}
