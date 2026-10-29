// Context usage ring beside Send (29, 35, 51, 72): a 16px progress ring of inputTokens / contextWindow with a
// tooltip listing tokens, cost and provider rate limits.
import type { CSSProperties } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { hook } from "./hooks";
import type { ChatUsage } from "./store";

export const formatTokens = (value?: number) => {
  if (value === undefined || !Number.isFinite(value)) return "–";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
};
export const formatCost = (value?: number) =>
  value === undefined || !Number.isFinite(value) ? "" : value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
const formatReset = (at?: number) => {
  if (!at) return "";
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Share of the context window in use, 0–1 (0 when the window is unknown). */
export function contextShare(usage?: ChatUsage): number {
  if (!usage?.contextWindow || !usage.inputTokens) return 0;
  return Math.min(1, Math.max(0, usage.inputTokens / usage.contextWindow));
}

/** One-line turn summary: "12k in · 840 out · $0.04". */
export function usageSummary(usage: ChatUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`${formatTokens(usage.inputTokens)} in`);
  if (usage.outputTokens !== undefined) parts.push(`${formatTokens(usage.outputTokens)} out`);
  const cost = formatCost(usage.costUsd);
  if (cost) parts.push(cost);
  return parts.join(" · ");
}

function Ring({ share }: { share: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const high = share >= 0.8;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn(hook.usageRing, "size-4 -rotate-90")}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="1.75" className="text-edge" />
      {share > 0 && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.5, share * c)} ${c}`}
          className={cn("transition-all duration-300 motion-reduce:transition-none", high ? "text-destructive" : "text-muted-foreground")}
        />
      )}
    </svg>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-foreground-2 tabular-nums">{value}</span>
  </div>
);

export function UsageRing({ usage }: { usage?: ChatUsage }) {
  const share = contextShare(usage);
  const percent = Math.round(share * 100);
  const label = usage?.contextWindow ? `Context ${percent}% used` : "Context usage";
  const cost = formatCost(usage?.costUsd);
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(hook.usage, "flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden")}
        >
          <Ring share={share} />
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={portalContainer()}>
        <TooltipPrimitive.Content
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex w-56 flex-col gap-1 rounded-xl border border-card-border bg-background p-2.5 text-sm text-foreground-2 shadow-menu data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {!usage ? (
            <span className="text-muted-foreground">No usage yet in this chat</span>
          ) : (
            <>
              <span className="text-foreground">
                {usage.contextWindow ? `${percent}% of context used` : "Context"}
              </span>
              {usage.contextWindow ? (
                <Row label="Tokens" value={`${formatTokens(usage.inputTokens)} / ${formatTokens(usage.contextWindow)}`} />
              ) : (
                <Row label="Input tokens" value={formatTokens(usage.inputTokens)} />
              )}
              {usage.outputTokens !== undefined && <Row label="Output tokens" value={formatTokens(usage.outputTokens)} />}
              {cost && <Row label="Cost" value={cost} />}
              {!!usage.rateLimit?.length && <div className="my-1 h-px bg-border" />}
              {usage.rateLimit?.map((limit) => (
                <div key={limit.label} className="flex flex-col gap-1">
                  <Row label={limit.label} value={`${Math.round(limit.usedPercent)}%`} />
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full w-(--bd-used) rounded-full", limit.usedPercent >= 80 ? "bg-destructive" : "bg-primary")}
                      style={{ "--bd-used": `${Math.min(100, Math.max(0, limit.usedPercent))}%` } as CSSProperties}
                    />
                  </div>
                  {limit.resetsAt && <span className="text-xs text-subtle-foreground">Resets {formatReset(limit.resetsAt)}</span>}
                </div>
              ))}
            </>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
