// The AiRun Durable Object: the host of one model API run (one instance per run id,
// `env.AI_RUNS.getByName(runId)`; docs/ai-runtime.md, "Hosting"). The run executes here, not in
// the HTTP request that started it, so it keeps going after the client disconnects, waits the
// whole approval timeout, receives cancel and approval notifications from any request, and pushes
// its events to every subscribed stream.
//
// The class is thin: the runtime code (TanStack AI, the design engine) is loaded on first use from
// cloud/ai-host.js, as the router loads cloud/ai.js, so the Worker's main chunk stays small.
//
// Storage: one row (`run`) naming the hosted run and whether it is still running, so an alarm
// after a reset (eviction, deploy, crash) knows which run lost its executor. Run state, events,
// approvals and tool results stay in the backend database (cloud/ai-store.js), the source of
// truth for decide-once approvals, at-most-once writes and `events?after=` from any instance. No
// provider credential is stored: the executor resolves it per run (resolveProvider in cloud/ai.js).
//
// On Node the same class runs as an in-process actor (cloud/platform/node/actors.js: waitUntil
// keeps the instance, alarms are process timers). It does not run on Vercel: there an actor turn
// holds a lease and runs on any instance, which cannot host a minutes-long executor that other
// requests must reach, so Vercel runs stay request-scoped (cloud/platform/vercel/env.js skips
// classes marked `longLived`).
import { DurableObject } from "#cloud-runtime";

export class AiRun extends DurableObject {
  /** Needs an instance that stays in memory for minutes (not available on Vercel). */
  static longLived = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS run (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL)",
    );
    /** The run executing in this instance (memory only; lost on reset). */
    this.hosted = null;
  }

  /** Start executing the run (once): {runId, accountId, authUserId, origin, input}. */
  async start(payload) {
    const { startHosted } = await import("./ai-host.js");
    return startHosted(this, payload);
  }

  /** The run's cancel flag or one of its approvals changed in the database. */
  async wake() {
    const { wakeHosted } = await import("./ai-host.js");
    return wakeHosted(this);
  }

  /** GET /events?run=<id>&after=<seq>: the run's SSE stream (stored events, then live ones). */
  async fetch(request) {
    const { subscribeHosted } = await import("./ai-host.js");
    return subscribeHosted(this, request);
  }

  /** Heartbeat while running: lease renewal, cancel and approval-timeout checks, reset recovery. */
  async alarm() {
    const { alarmHosted } = await import("./ai-host.js");
    return alarmHosted(this);
  }
}
