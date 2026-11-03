# CI

GitHub Actions runs on [Boat](https://docs.boat.dev/ci.md) VMs (`runs-on: boat*`): a fresh Ubuntu 24.04 VM per job, with sudo, Docker and `actions/cache`. Boat has no macOS runners, so CI covers the Linux build, lint and tests. macOS packaging (`npm run package:mac`) and live agent tests stay local.

## Branch flow

```
feature/*  --PR-->  staging  --PR-->  main
```

- Feature branches open PRs into `staging`.
- Only this repository's `staging` branch may open a PR into `main`. `branch-policy.yml` (`staging-promotion`) enforces this. It is a metadata-only `pull_request_target` job and never checks out PR code.
- Production deploys are manual (`deploy.yml`, `workflow_dispatch` on `main`, gated by `vars.ENABLE_PRODUCTION_DEPLOY` and the `production` environment).

## What runs where

| Event | `quality` | `tests` | `identity` | `staging-promotion` |
| - | - | - | - | - |
| PR into `staging` | yes | affected tests only (`base.sha..head.sha`) | yes | no |
| PR into `main` | yes | full suite | yes | yes |
| Push to `staging` | yes | full suite | (per `identity.yml`) | no |
| Nightly (19:17 UTC, checks out `staging`) | yes | full suite | no | no |
| Manual (`workflow_dispatch`) | yes | full suite | no | no |

`tests.yml` jobs:

- `quality` (`boat`): `npm ci`, `build:ui`, `check`, `lint`, `typecheck:ui`, `format:check`.
- `plan` (`boat-small`): `node scripts/run-tests.mjs --ci-event --list` per lane. It counts the selected tests and builds the Electron shard matrix: 4 shards for the full suite, 1 for affected.
- `node + cloud` (`boat`): `--lane node --lane cloud`. No display is needed. Playwright Chromium is installed only when `tests/web-*` is selected.
- `electron (i/n)` (`boat-large`, matrix): `--lane electron --shard i/n`. The job installs the Electron system libraries and `xvfb`. The runner wraps each test in `xvfb-run -a` when `DISPLAY` is unset.
- `serial` (`boat-large`): `--lane serial`, for tests that must run alone (for example the two-client cloud desktop tests).
- `tests` (`boat-small`): an aggregate job that always runs. It fails if `plan` failed or any lane failed or was cancelled. It passes when lanes were skipped because nothing was affected. Use this stable name as the required check.

Each lane writes `--report $RUNNER_TEMP/report` (`results.json`, `junit.xml`, `summary.md`, plus the job summary). The report is uploaded as a `test-report-*` artifact, kept for 14 days.

Electron on Ubuntu 24.04: AppArmor blocks unprivileged user namespaces, and npm cannot make `chrome-sandbox` setuid root. Without a fix, the Chromium sandbox aborts. The Electron jobs turn namespaces back on with `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (the VM is thrown away after the job), so tests keep the real sandbox. Only if that fails do they set `ELECTRON_DISABLE_SANDBOX=1`, with a warning.

## Required status checks

Set these in branch protection (or a ruleset):

- `staging`: `quality`, `tests`, `identity`
- `main`: `quality`, `tests`, `identity`, `staging-promotion`

Branch protection on a private repository needs GitHub Pro, Team or Enterprise. The commands below replace the existing protection settings for each branch; review them before you run them:

```sh
REPO=AdamAbd/verynize-product

gh api -X PUT "repos/$REPO/branches/staging/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["quality", "tests", "identity"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON

gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["quality", "tests", "identity", "staging-promotion"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON

# Inspect
gh api "repos/$REPO/branches/main/protection/required_status_checks"
```

To change only the checks and keep the other settings, use `PATCH repos/$REPO/branches/<branch>/protection/required_status_checks` with `{"strict": true, "contexts": [...]}`.

## Boat setup (one time)

1. Install the Boat CI GitHub App for the account that owns the repo: `boat ci connect` (or `boat ci connect --org <org>`). Select `verynize-product`.
2. Make sure the Boat account has the **$20/month plan or higher**. Without a plan, or on the free trial, Boat refuses each job and gives the reason. The free trial also has no `large` size, which the Electron jobs use.
3. Add the Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) as GitHub Actions secrets in the `production` environment. Boat jobs read GitHub secrets, not Boat environments.

Inspect jobs:

```sh
boat ci                                   # setup problems, 7-day stats, last jobs
boat ci --repo AdamAbd/verynize-product --state failed
boat ci job <job id>                      # wait, run time, cost, error
boat ci logs <job id> --follow
```

Debug a failure: run **Tests** manually (Actions → Tests → Run workflow) with `debug: true`. Lanes then use `boat/debug` and `boat-large/debug`, so a failed VM is kept for 30 minutes. Find its id in `boat ci`, then run `boat ssh <id>`.

A job stopped by a plan start limit shows as "Paused by plan limit" and does not restart by itself. Re-run it with `gh run rerun <run-id> --failed`.

## Local commands

```sh
npm run test:list-changed   # what CI would select for your branch against staging
npm run test:changed        # run only affected tests
npm test                    # full suite
node scripts/run-tests.mjs --lane electron --shard 1/4   # reproduce one CI shard
```

Before you push, run `npm run lint:ui && npm run typecheck:ui && npm run format:check`.

## Cost

Boat bills per second: `boat-small` $0.018/h, `boat` $0.036/h, `boat-large` $0.072/h. VM time is cheap. Starts are the real limit: the $20 plan includes 12 starts per minute, 60 per hour and 200 per day. Each job is one start.

- PR into `staging`: about 4 to 6 starts (quality, plan, the lanes that have tests, the aggregate).
- PR into `main`, push to `staging`, nightly: about 9 starts (quality, plan, node + cloud, 4 Electron shards, serial, aggregate).
- `cancel-in-progress` cancels superseded PR runs, so a burst of pushes does not stack runs.
- With these numbers, about 20 full runs a day fit in the plan's starts. Past that, extra starts cost $0.03 to $0.07 each from the wallet. If starts become the bottleneck, lower the full-suite shard count in the `plan` job.
