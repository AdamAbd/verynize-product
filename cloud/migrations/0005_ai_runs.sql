-- Model API runtime (cloud/ai.js, docs/ai-runtime.md): run, event, approval and tool-result
-- state kept in the database so cancel, approvals and reconnect work across instances.
-- "ai_run": one chat turn. "status" is 'running' or 'done'; "code" is the done code
-- (ok, error, cancelled, budget). "leaseUntil" is renewed by the executing instance; a running
-- run whose lease has expired is finished as an error by the next reader. "idempotencyKey" is
-- unique per account so a retried request returns the existing run. Times are epoch ms.
create table "ai_run" ("id" text not null primary key, "accountId" text not null, "roomId" text not null, "chatId" text not null, "model" text not null, "access" text not null, "status" text not null, "code" text, "idempotencyKey" text not null, "cancelRequested" integer not null default 0, "leaseUntil" integer not null, "createdAt" integer not null, "updatedAt" integer not null, unique ("accountId", "idempotencyKey"));

create index "ai_run_account_status_idx" on "ai_run" ("accountId", "status");

-- "ai_run_event": the events of a run in order ("seq" from 1), stored before they are sent.
create table "ai_run_event" ("runId" text not null, "seq" integer not null, "event" text not null, "createdAt" integer not null, primary key ("runId", "seq"));

-- "ai_approval": one permission request of a run, bound to the tool call and a hash of its
-- arguments; "decision" ('allow' or 'deny') is set once.
create table "ai_approval" ("runId" text not null, "requestId" text not null, "toolCallId" text not null, "toolName" text not null, "argsHash" text not null, "decision" text, "reason" text, "createdAt" integer not null, "decidedAt" integer, primary key ("runId", "requestId"), unique ("runId", "toolCallId"));

-- "ai_tool_result": the recorded result of a write tool call, so it is applied at most once per
-- (runId, toolCallId).
create table "ai_tool_result" ("runId" text not null, "toolCallId" text not null, "toolName" text not null, "output" text not null, "isError" integer not null default 0, "createdAt" integer not null, primary key ("runId", "toolCallId"));
