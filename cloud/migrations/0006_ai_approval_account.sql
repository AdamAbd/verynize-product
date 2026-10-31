-- Model API runtime approvals (docs/ai-runtime.md, "Policy"): each permission request is bound to
-- the account that owns the run as well as to the run, the tool call and the hash of its
-- arguments. The approvals endpoint refuses a decision from any other account.
alter table "ai_approval" add column "accountId" text not null default '';
