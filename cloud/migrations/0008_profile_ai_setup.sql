-- Web onboarding (cloud/web-access.js, docs: cloud/README.md "Web sign-in"): when the account
-- finished or skipped the AI setup steps shown after its first web sign-in (epoch ms). Null until
-- then, so the web app shows the steps once per account, on any browser.
alter table "profile" add column "aiSetupAt" integer;
