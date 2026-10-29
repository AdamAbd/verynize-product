// Changes panel in Electron: a repo-backed project chat shows "N files changed +a −b" after an agent turn
// (fake Codex app-server), the dialog shows colored unified diffs, discards a file after confirmation, commits,
// publishes the branch to a local bare remote and opens a pull request through a stub `gh` on PATH (no network).
const { _electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const identity = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...identity } });

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'changes-panel-')));
  const bin = path.join(root, 'bin'), project = path.join(root, 'project'), remote = path.join(root, 'remote.git'), ghLog = path.join(root, 'gh.log'), ghState = path.join(root, 'gh-state');
  await fs.mkdir(bin); await fs.mkdir(project);
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(project, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(project, 'index.html'), '<h1>Hello</h1>\n');
  git(project, 'add', '.');
  git(project, 'commit', '-m', 'Initial');
  git(project, 'remote', 'add', 'origin', remote);
  await fs.copyFile(path.join(__dirname, 'fixtures/fake-codex.cjs'), path.join(bin, 'codex'));
  await fs.chmod(path.join(bin, 'codex'), 0o755);
  // Explicit stub for the GitHub CLI: records argv, one PR per branch.
  await fs.writeFile(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + '\\n');
const pr = { number: 12, url: 'https://github.com/acme/site/pull/12', state: 'OPEN', title: 'Hero section', isDraft: false, baseRefName: 'main', headRefName: 'main' };
if (args[1] === 'view') { if (!fs.existsSync(${JSON.stringify(ghState)})) { process.stderr.write('no pull requests found\\n'); process.exit(1); } process.stdout.write(JSON.stringify(pr)); process.exit(0); }
if (args[1] === 'create') { fs.writeFileSync(${JSON.stringify(ghState)}, '1'); process.stdout.write(pr.url + '\\n'); process.exit(0); }
process.exit(2);
`);
  await fs.chmod(path.join(bin, 'gh'), 0o755);
  const env = { ...process.env, ...identity, PATH: bin + path.delimiter + process.env.PATH, FAKE_CODEX_LOG: path.join(root, 'codex.log') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], timeout: 20000 });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector('#project-toggle', { state: 'attached' });
    await app.evaluate(({ dialog }, dir) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })), project);
    await page.evaluate(() => window.agentWorkspace.openProject());
    await page.locator('#project-open').click();
    await page.waitForFunction(() => document.getElementById('project-name').textContent === 'project');
    await page.evaluate(() => window.agentWorkspace.openChat());
    const button = page.locator('#changes-button');
    await button.waitFor({ timeout: 10000 });
    assert.match(await button.textContent(), /No changes/);

    // An agent turn finishes after files changed on disk → the summary refreshes.
    await fs.writeFile(path.join(project, 'index.html'), '<h1>Hello</h1>\n<section class="hero">Hero</section>\n');
    await fs.writeFile(path.join(project, 'notes.txt'), 'scratch\n');
    await page.evaluate(() => window.agentWorkspace.setDefaults({ agent: 'codex', access: 'edit' }));
    await page.locator('#project-prompt').fill('Build the hero section');
    await page.locator('#project-run').click();
    await page.waitForFunction(() => window.agentWorkspace.getUsage().completed === 1 && !window.agentWorkspace.isBusy(), null, { timeout: 15000 });
    await page.waitForFunction(() => /2 files changed\s*\+2\s*−0/.test(document.getElementById('changes-button')?.textContent || ''), null, { timeout: 5000 });

    // Dialog: file list, colored diff, suggested commit message.
    await button.click();
    const panel = page.locator('#changes-panel');
    await panel.waitFor();
    assert.equal(await panel.locator('#changes-branch').textContent(), 'main');
    assert.equal(await panel.locator('[data-changes=file]').count(), 2);
    await panel.locator('[data-changes=file][data-path="index.html"]').click();
    await panel.locator('#changes-diff [data-kind=add]').first().waitFor();
    assert.match(await panel.locator('#changes-diff [data-kind=add]').first().textContent(), /\+<section class="hero">Hero<\/section>/);
    assert.match(await panel.locator('#changes-diff [data-kind=add]').first().evaluate(el => getComputedStyle(el).backgroundColor), /rgb|color/);
    assert.equal(await panel.locator('#changes-message').inputValue(), 'Build the hero section');
    if (process.env.CHANGES_PANEL_SHOT) await page.screenshot({ path: process.env.CHANGES_PANEL_SHOT });

    // Discard needs a confirmation click.
    const notes = panel.locator('li', { has: page.locator('[data-path="notes.txt"]') });
    await notes.hover();
    await notes.locator('[data-changes=discard]').click();
    await notes.locator('[data-changes=discard-confirm]').click();
    await page.waitForFunction(() => document.querySelectorAll('#changes-panel [data-changes=file]').length === 1);
    await assert.rejects(fs.access(path.join(project, 'notes.txt')));

    // Commit → publish branch → create PR.
    await panel.locator('#changes-commit').click();
    await page.waitForFunction(() => /Committed [0-9a-f]{7} on main/.test(document.getElementById('changes-status')?.textContent || ''));
    assert.equal(git(project, 'log', '-1', '--format=%s').trim(), 'Build the hero section');
    assert.equal(await panel.locator('#changes-push').textContent(), 'Publish branch');
    await panel.locator('#changes-push').click();
    await page.waitForFunction(() => /Pushed main to origin\/main/.test(document.getElementById('changes-status')?.textContent || ''), null, { timeout: 30000 });
    assert.equal(git(remote, 'rev-parse', 'main'), git(project, 'rev-parse', 'HEAD'));
    assert.equal(await panel.locator('#changes-push').isDisabled(), true);
    await panel.locator('#changes-create-pr').click();
    await panel.locator('#changes-pr-link').waitFor({ timeout: 15000 });
    assert.match(await panel.locator('#changes-pr-link').textContent(), /#12 Open/);
    const calls = (await fs.readFile(ghLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.find(c => c[1] === 'create'), ['pr', 'create', '--head', 'main', '--fill']);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.match(await button.textContent(), /No changes/);
    console.log('PASS changes panel: agent-turn refresh, diff, discard confirm, commit, publish, pull request');
  } finally { await app.close(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
