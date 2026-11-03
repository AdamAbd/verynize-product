# CI

GitHub Actions runs on GitHub-hosted runners (`runs-on: ubuntu-24.04`): a fresh Ubuntu 24.04 VM per job, with sudo. Electron tests are Linux-portable (`tests/helpers/keys.cjs`) so CI covers the Linux build, lint and tests; macOS runners bill at 10× on private repos. macOS packaging (`npm run package:mac`) and live agent tests stay local.

## Branch flow

```
feature/*  --PR-->  staging  --PR-->  main
```

- Feature branches open PRs into `staging`.
- Only this repository's `staging` branch may open a PR into `main`. `branch-policy.yml` (`staging-promotion`) enforces this. It is a metadata-only `pull_request_target` job and never checks out PR code.
- Production deploys are manual (`deploy.yml`, `workflow_dispatch` on `main`, gated by `vars.ENABLE_PRODUCTION_DEPLOY` and the `production` environment).

## What runs where

| Event                                     | `quality` | `tests`                                    | `identity`           | `staging-promotion` |
| ----------------------------------------- | --------- | ------------------------------------------ | -------------------- | ------------------- |
| PR into `staging`                         | yes       | affected tests only (`base.sha..head.sha`) | yes                  | no                  |
| PR into `main`                            | yes       | full suite                                 | yes                  | yes                 |
| Push to `staging`                         | yes       | full suite                                 | (per `identity.yml`) | no                  |
| Nightly (19:17 UTC, checks out `staging`) | yes       | full suite                                 | no                   | no                  |
| Manual (`workflow_dispatch`)              | yes       | full suite                                 | no                   | no                  |

`tests.yml` jobs:

- `quality`: `npm ci`, `build:ui`, `check`, `lint`, `typecheck:ui`, format check of files the PR adds (the existing tree predates the formatter).
- `plan`: `node scripts/run-tests.mjs --ci-event --list` per lane. It counts the selected tests and builds the Electron shard matrix: about 20 Electron tests per shard, at most 4. The runner imports only Node built-ins, so this job skips `npm ci`.
- `node + cloud`: `--lane node --lane cloud`. No display is needed. Playwright Chromium is installed only when `tests/web-*` is selected.
- `electron (i/n)` (matrix): `--lane electron --shard i/n`. The job installs the Electron system libraries, `xvfb`, Mesa (software WebGL), `zsh` (terminal tests), `poppler-utils` (`pdftoppm`, PDF export check), `fonts-inter` (made fontconfig's `system-ui`/`Sans` font, close to macOS SF metrics, so text-layout tests wrap as on macOS) and a build toolchain for `node-pty`, then downloads the Electron binary (`node node_modules/electron/install.js`). The runner wraps each test in `xvfb-run -a -s "-screen 0 3840x2160x24"` when `DISPLAY` is unset.
- `serial`: `--lane serial`, for tests that must run alone (today `integrations/design-files.test.mjs`, whose `fs.watch` wait misses under parallel load). Same system setup as the Electron jobs.
- `tests`: an aggregate job that always runs. It fails if `plan` failed or any lane failed or was cancelled. It passes when lanes were skipped because nothing was affected. Use this stable name as the required check.

Each lane writes `--report $RUNNER_TEMP/report` (`results.json`, `junit.xml`, `summary.md`, plus the job summary). The report is uploaded as a `test-report-*` artifact, kept for 14 days.

Install scripts: npm 11 can skip dependency install scripts that `allowScripts` in `package.json` does not list. `workerd`, `node-pty` and `fsevents` are allowed there; Electron has no install script and is downloaded by the explicit step above.

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

## Setup (one time)

Add the Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) as GitHub Actions secrets in the `production` environment.

Debug a failure: download the `test-report-*` artifact, or reproduce the shard locally (below). Re-run only failed jobs with `gh run rerun <run-id> --failed`.

## Local commands

```sh
npm run test:list-changed   # what CI would select for your branch against staging
npm run test:changed        # run only affected tests
npm test                    # full suite
node scripts/run-tests.mjs --lane electron --shard 1/4   # reproduce one CI shard
```

Before you push, run `npm run lint:ui && npm run typecheck:ui && npm run format:check`.

## Cost

Private repositories get a monthly allowance of GitHub-hosted Linux minutes (2,000 on Free, 3,000 on Pro/Team); beyond that Linux minutes are billed per minute. Standard Linux runners for private repos have 2 vCPU / 7 GB.

- PR into `staging`: quality plus only the affected lanes, usually a few minutes.
- PR into `main`, push to `staging`, nightly: quality, node + cloud, 4 Electron shards and serial run in parallel. Expect the most minutes here; lower the shard count in the `plan` job or drop the push trigger if minutes run short.
- `cancel-in-progress` cancels superseded PR runs, so a burst of pushes does not stack runs.
