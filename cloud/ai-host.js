// What the AiRun Durable Object does (cloud/ai-run.js; docs/ai-runtime.md, "Hosting"). Loaded on
// first use. `object` is the AiRun instance: {ctx, env, sql, hosted}.
//
// - start: claims the object's one run, schedules the heartbeat alarm and executes the run
//   (launchRun in cloud/ai.js, the same path as request-scoped runs) under ctx.waitUntil.
// - Events are stored in the database before they are published to this object's subscribers.
//   A subscriber replays stored events after its `after`, buffering live ones meanwhile, then
//   follows live events (deduplicated by seq) until `done`.
// - wake: the cancel and approval endpoints write the database, then call it; the object reads
//   the cancel flag (aborting the executor) and wakes a waiting approval, which re-reads its row.
// - alarm (every ALARM_MS while running): renews the lease, re-checks cancel, wakes the approval
//   wait (whose deadline is the approval timeout), and after a reset (no executor in memory)
//   closes the run as `done {code: "error"}` once its lease has expired. A reset run is not
//   resumed: the model stream and any in-flight tool call are gone, and replaying the turn could
//   repeat writes the at-most-once record would then refuse, so ending it is the honest outcome.
import { cancelRequested, eventsAfter, getRun, renewLease } from "./ai-store.js";
import {
  closeExpired,
  followStream,
  frame,
  heartbeat,
  HEARTBEAT_MS,
  launchRun,
  runAccount,
  sseHeaders,
} from "./ai.js";

/** Heartbeat alarm period while a run executes (the lease is 30 s). */
export const ALARM_MS = 5_000;
/** Longest an approval wait sleeps without a notification before it re-reads the database. */
const WAIT_CAP_MS = 5_000;
const RUN_ID = /^[0-9a-f-]{36}$/;
const REPLAY_PAGE = 200;

/** Wakes waits on a change; a wake with nobody waiting is kept for the next wait. */
class Notifier {
  waiters = new Set();
  pending = false;
  wake() {
    if (!this.waiters.size) {
      this.pending = true;
      return;
    }
    for (const waiter of this.waiters) waiter();
  }
  wait(ms) {
    if (this.pending) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(1, Math.min(ms, WAIT_CAP_MS)));
      this.waiters.add(done);
    });
  }
}

class HostedRun {
  constructor(runId) {
    this.runId = runId;
    this.controller = new AbortController();
    this.notifier = new Notifier();
    this.subscribers = new Set();
    this.ended = false;
  }
  publish(event) {
    for (const subscriber of this.subscribers) subscriber.push(event);
  }
  end() {
    this.ended = true;
    for (const subscriber of this.subscribers) subscriber.end();
  }
}

/** One subscriber's SSE body: stored events after `after`, then live ones until `done`. */
function subscription(env, hosted, after) {
  let controller;
  let timer;
  let open = true;
  let ready = false;
  let last = after;
  const queue = [];
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    hosted.subscribers.delete(subscriber);
    try {
      controller.close();
    } catch {}
  };
  const send = (event) => {
    if (!open || event.seq <= last) return;
    try {
      controller.enqueue(frame(event));
    } catch {
      return close();
    }
    last = event.seq;
    if (event.type === "done") close();
  };
  const subscriber = {
    push(event) {
      if (!ready) queue.push(event);
      else send(event);
    },
    // The executor ended: a live subscriber has had everything (done included, unless it could
    // not be stored); one still replaying closes after its replay.
    end() {
      if (ready) close();
    },
  };
  return new ReadableStream({
    async start(c) {
      controller = c;
      hosted.subscribers.add(subscriber);
      timer = setInterval(() => {
        try {
          if (open) controller.enqueue(heartbeat);
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      try {
        for (;;) {
          const events = await eventsAfter(env, hosted.runId, last, REPLAY_PAGE);
          for (const event of events) send(event);
          if (!open || events.length < REPLAY_PAGE) break;
        }
      } catch (error) {
        console.error("ai run replay failed", hosted.runId, error?.message);
        return close();
      }
      ready = true;
      for (const event of queue.splice(0)) send(event);
      if (hosted.ended) close();
    },
    cancel() {
      open = false;
      clearInterval(timer);
      hosted.subscribers.delete(subscriber);
    },
  });
}

const storedRun = (object) => object.sql.exec("SELECT id, state FROM run LIMIT 1").toArray()[0];

export async function startHosted(object, payload) {
  const { runId, accountId } = payload || {};
  if (!RUN_ID.test(String(runId))) throw new Error("Invalid run id");
  if (object.hosted || storedRun(object)) return { started: false };
  const run = await getRun(object.env, runId);
  if (!run || run.status !== "running") return { started: false };
  if (run.accountId !== accountId) throw new Error("The run belongs to another account");
  object.sql.exec(
    "INSERT INTO run (id, account_id, state, started_at) VALUES (?, ?, 'running', ?)",
    runId,
    accountId,
    Date.now(),
  );
  const hosted = new HostedRun(runId);
  object.hosted = hosted;
  await object.ctx.storage.setAlarm(Date.now() + ALARM_MS);
  const execution = launchRun(object.env, {
    run,
    account: runAccount(payload),
    request: new Request(new URL("/api/ai/runs", payload.origin)),
    input: payload.input,
    onEvent: (event) => hosted.publish(event),
    signal: hosted.controller.signal,
    heartbeat: false,
    waitForChange: (ms) => hosted.notifier.wait(ms),
  }).finally(async () => {
    hosted.end();
    if (object.hosted === hosted) object.hosted = null;
    try {
      object.sql.exec("UPDATE run SET state = 'done' WHERE id = ?", runId);
      await object.ctx.storage.deleteAlarm();
    } catch (error) {
      console.error("ai run host cleanup failed", runId, error?.message);
    }
  });
  // Keeps the object in memory while the run executes (Cloudflare: up to 15 minutes per call,
  // renewed by the heartbeat alarm; Node: the actor is not swept while it runs).
  object.ctx.waitUntil?.(execution);
  return { started: true };
}

export async function wakeHosted(object) {
  const hosted = object.hosted;
  if (!hosted) return { hosted: false };
  if (await cancelRequested(object.env, hosted.runId)) hosted.controller.abort("cancelled");
  hosted.notifier.wake();
  return { hosted: true };
}

export async function subscribeHosted(object, request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run") || "";
  const after = Number(url.searchParams.get("after") ?? 0);
  if (url.pathname !== "/events" || !RUN_ID.test(runId) || !Number.isInteger(after) || after < 0)
    return new Response("Not found", { status: 404 });
  const hosted = object.hosted;
  // Not executing here (finished, never started, or the object was reset): follow the database,
  // which also closes a run whose lease expired.
  const body =
    hosted?.runId === runId
      ? subscription(object.env, hosted, after)
      : followStream(object.env, runId, after);
  return new Response(body, {
    status: 200,
    headers: {
      ...sseHeaders,
      "x-verynize-ai-stream": hosted?.runId === runId ? "object" : "database",
    },
  });
}

export async function alarmHosted(object) {
  const row = storedRun(object);
  if (!row || row.state !== "running") return;
  const hosted = object.hosted;
  if (hosted) {
    try {
      if (await renewLease(object.env, hosted.runId)) hosted.controller.abort("cancelled");
    } catch (error) {
      // The next alarm retries; the lease has slack.
      console.error("ai run lease renewal failed", hosted.runId, error?.message);
    }
    hosted.notifier.wake();
    if (object.hosted === hosted) await object.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    return;
  }
  // No executor in memory: the object was reset mid-run. Close the run once its lease expired
  // (no other host can hold it, so waiting for the lease is only a safety margin).
  const run = await getRun(object.env, row.id);
  if (run?.status === "running") {
    if (run.leaseUntil >= Date.now()) {
      await object.ctx.storage.setAlarm(run.leaseUntil + 1_000);
      return;
    }
    await closeExpired(object.env, run, "The run stopped: its host was restarted mid-run.");
  }
  object.sql.exec("UPDATE run SET state = 'done' WHERE id = ?", row.id);
}
