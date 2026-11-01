// Run, event, approval and tool-result state of the model API runtime (cloud/ai.js) in the backend
// database (D1 on Cloudflare, node:sqlite on Node, libSQL on Vercel; schema in
// cloud/migrations/0005_ai_runs.sql). Nothing lives in process memory, so cancel, approvals and
// reconnect work from any instance.
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { database } from "./db.js";
import { aiApproval, aiRun, aiRunEvent, aiToolResult } from "./schema.js";

/** How long a run stays owned by its executing instance without a renewal. */
export const LEASE_MS = 30_000;

/**
 * Create a run, or return the account's existing run with the same idempotency key.
 * @returns {Promise<{run: object, created: boolean}>}
 */
export async function createRun(env, fields, now = Date.now()) {
  const db = database(env);
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(aiRun)
    .values({
      id,
      ...fields,
      status: "running",
      code: null,
      cancelRequested: false,
      leaseUntil: now + LEASE_MS,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [aiRun.accountId, aiRun.idempotencyKey] })
    .run();
  const run = await runByKey(env, fields.accountId, fields.idempotencyKey);
  return { run, created: !!inserted.meta?.changes && run?.id === id };
}

export const runByKey = (env, accountId, idempotencyKey) =>
  database(env)
    .select()
    .from(aiRun)
    .where(and(eq(aiRun.accountId, accountId), eq(aiRun.idempotencyKey, idempotencyKey)))
    .get();

export const getRun = (env, runId) =>
  database(env).select().from(aiRun).where(eq(aiRun.id, runId)).get();

/** Runs of an account that are running and still leased. */
export const activeRuns = (env, accountId, now = Date.now()) =>
  database(env)
    .select({ id: aiRun.id, chatId: aiRun.chatId })
    .from(aiRun)
    .where(
      and(eq(aiRun.accountId, accountId), eq(aiRun.status, "running"), gt(aiRun.leaseUntil, now)),
    )
    .all();

/** Store one event; fails if the sequence number is taken (two writers for one run). */
export async function appendEvent(env, runId, event, now = Date.now()) {
  await database(env)
    .insert(aiRunEvent)
    .values({ runId, seq: event.seq, event: JSON.stringify(event), createdAt: now })
    .run();
}

/** Stored events after `after`, in order, parsed. */
export async function eventsAfter(env, runId, after = 0, limit = 200) {
  const rows = await database(env)
    .select({ event: aiRunEvent.event })
    .from(aiRunEvent)
    .where(and(eq(aiRunEvent.runId, runId), gt(aiRunEvent.seq, after)))
    .orderBy(asc(aiRunEvent.seq))
    .limit(limit)
    .all();
  return rows.map((row) => JSON.parse(row.event));
}

export async function lastSeq(env, runId) {
  const row = await database(env)
    .select({ seq: sql`max(${aiRunEvent.seq})` })
    .from(aiRunEvent)
    .where(eq(aiRunEvent.runId, runId))
    .get();
  return Number(row?.seq) || 0;
}

/** Extend the lease of a running run; returns whether cancel was requested. */
export async function renewLease(env, runId, now = Date.now()) {
  const db = database(env);
  await db
    .update(aiRun)
    .set({ leaseUntil: now + LEASE_MS, updatedAt: now })
    .where(and(eq(aiRun.id, runId), eq(aiRun.status, "running")))
    .run();
  return cancelRequested(env, runId);
}

export async function cancelRequested(env, runId) {
  const row = await database(env)
    .select({ cancelRequested: aiRun.cancelRequested })
    .from(aiRun)
    .where(eq(aiRun.id, runId))
    .get();
  return !!row?.cancelRequested;
}

export async function requestCancel(env, runId, now = Date.now()) {
  await database(env)
    .update(aiRun)
    .set({ cancelRequested: true, updatedAt: now })
    .where(eq(aiRun.id, runId))
    .run();
}

/** Mark a running run done with `code`. */
export async function finishRun(env, runId, code, now = Date.now()) {
  await database(env)
    .update(aiRun)
    .set({ status: "done", code, updatedAt: now })
    .where(and(eq(aiRun.id, runId), eq(aiRun.status, "running")))
    .run();
}

/** Claim a running run whose lease expired, to finish it as an error; true if this call won. */
export async function claimExpired(env, runId, now = Date.now()) {
  const result = await database(env)
    .update(aiRun)
    .set({ status: "done", code: "error", updatedAt: now })
    .where(and(eq(aiRun.id, runId), eq(aiRun.status, "running"), lt(aiRun.leaseUntil, now)))
    .run();
  return !!result.meta?.changes;
}

// Approvals (permission requests of write tool calls).

export async function createApproval(env, fields, now = Date.now()) {
  await database(env)
    .insert(aiApproval)
    .values({ ...fields, decision: null, reason: null, createdAt: now, decidedAt: null })
    .run();
}

export const approvalForCall = (env, runId, toolCallId) =>
  database(env)
    .select()
    .from(aiApproval)
    .where(and(eq(aiApproval.runId, runId), eq(aiApproval.toolCallId, toolCallId)))
    .get();

export const getApproval = (env, runId, requestId) =>
  database(env)
    .select()
    .from(aiApproval)
    .where(and(eq(aiApproval.runId, runId), eq(aiApproval.requestId, requestId)))
    .get();

/** Decide an undecided approval once; false if it was already decided. */
export async function decideApproval(env, runId, requestId, allow, reason, now = Date.now()) {
  const result = await database(env)
    .update(aiApproval)
    .set({ decision: allow ? "allow" : "deny", reason, decidedAt: now })
    .where(
      and(
        eq(aiApproval.runId, runId),
        eq(aiApproval.requestId, requestId),
        isNull(aiApproval.decision),
      ),
    )
    .run();
  return !!result.meta?.changes;
}

/** Deny every undecided approval of a run (the run ended); returns their request ids. */
export async function denyPending(env, runId, reason, now = Date.now()) {
  const pending = await database(env)
    .select({ requestId: aiApproval.requestId })
    .from(aiApproval)
    .where(and(eq(aiApproval.runId, runId), isNull(aiApproval.decision)))
    .all();
  const denied = [];
  for (const { requestId } of pending)
    if (await decideApproval(env, runId, requestId, false, reason, now)) denied.push(requestId);
  return denied;
}

// Recorded results of write tool calls (at most once per run and tool call). A write first claims
// its row with PENDING_RESULT, then runs, then stores its output: a claim that was never completed
// (the instance stopped mid-call) is never run again.

export const PENDING_RESULT = "\u0000pending";

export const getToolResult = (env, runId, toolCallId) =>
  database(env)
    .select()
    .from(aiToolResult)
    .where(and(eq(aiToolResult.runId, runId), eq(aiToolResult.toolCallId, toolCallId)))
    .get();

/** Record a result; false if one was already recorded for this tool call. */
export async function recordToolResult(env, fields, now = Date.now()) {
  const result = await database(env)
    .insert(aiToolResult)
    .values({ ...fields, createdAt: now })
    .onConflictDoNothing()
    .run();
  return !!result.meta?.changes;
}

/** Store the output of a claimed tool call (recordToolResult with PENDING_RESULT). */
export async function completeToolResult(env, runId, toolCallId, { output, isError }) {
  await database(env)
    .update(aiToolResult)
    .set({ output, isError })
    .where(and(eq(aiToolResult.runId, runId), eq(aiToolResult.toolCallId, toolCallId)))
    .run();
}
