// Dev server / terminal process manager (desktop/dev-server.cjs) against real child processes:
// a tiny Node http server fixture project started through `npm run dev`, URL detection, process
// group shutdown, the persisted per-project override, foreground/background commands and bounds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProcessManager, RingLog, detectURL, checkArgv } = require('../desktop/dev-server.cjs');

const SERVER = `const http=require('node:http'),fs=require('node:fs');
fs.writeFileSync('server.pid',String(process.pid));
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Fixture app</h1>');});
server.listen(0,'127.0.0.1',()=>{console.log('\\u001b[32m  ➜  Local:\\u001b[39m   http://localhost:'+server.address().port+'/');console.error('ready in 5 ms');});
process.on('SIGTERM',()=>{console.log('shutting down');server.close();process.exit(0);});
`;

async function fixture(t, scripts = { dev: 'node server.js' }, extra = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bd-dev-server-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts, ...extra }));
  await fs.writeFile(path.join(root, 'server.js'), SERVER);
  return root;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitGone(pid, ms = 3000) { const end = Date.now() + ms; while (alive(pid) && Date.now() < end) await new Promise(r => setTimeout(r, 50)); return !alive(pid); }

test('detects package.json scripts and the package manager', async t => {
  const m = new ProcessManager();
  const npm = await fixture(t, { build: 'x', start: 'node server.js', dev: 'node server.js' });
  assert.deepEqual((await m.detect(npm)).command, ['npm', 'run', 'dev']);
  const pnpm = await fixture(t, { start: 'node server.js' });
  await fs.writeFile(path.join(pnpm, 'pnpm-lock.yaml'), '');
  assert.deepEqual((await m.detect(pnpm)).command, ['pnpm', 'run', 'start']);
  const declared = await fixture(t, { dev: 'vite' }, { packageManager: 'yarn@4.1.0' });
  assert.equal((await m.detect(declared)).packageManager, 'yarn');
  const none = await fixture(t, { build: 'tsc' });
  assert.equal(await m.detect(none), null);
  await assert.rejects(m.start(none), /No dev server command found/);
});

test('URL detection, ANSI stripping, argv validation and ring buffer bounds', () => {
  assert.equal(detectURL('  Local:   http://0.0.0.0:5173/'), 'http://localhost:5173/');
  assert.equal(detectURL('ready on http://127.0.0.1:3000, press h'), 'http://127.0.0.1:3000/');
  assert.equal(detectURL('Network: http://192.168.1.4:5173/'), null);
  assert.equal(detectURL('see https://example.com'), null);
  assert.throws(() => checkArgv('npm run dev'), /argument array/);
  assert.throws(() => checkArgv(['npm', 'a\0b']), /NUL/);
  const log = new RingLog(2000);
  log.write('stdout', '\u001b[31mred\u001b[0m line\npartial');
  assert.equal(log.entries[0].text, 'red line');
  log.flush(); assert.equal(log.entries[1].text, 'partial');
  for (let i = 0; i < 200; i++) log.write('stdout', `line ${i}\n`);
  assert.ok(log.bytes <= 2000 && log.dropped > 0, 'oldest lines are dropped');
  const page = log.read({ since: 1, limit: 5 });
  assert.ok(page.dropped > 0); assert.equal(page.entries.length, 5); assert.equal(page.more, true);
});

test('starts the fixture through npm run dev, serves it, and stops the whole process group', async t => {
  const root = await fixture(t);
  const m = new ProcessManager();
  t.after(() => m.stopAll());
  const status = await m.start(root, { waitMs: 30000 });
  assert.equal(status.state, 'running', status.tail);
  assert.match(status.url, /^http:\/\/localhost:\d+\/$/);
  assert.deepEqual(status.command, ['npm', 'run', 'dev']); assert.equal(status.source, 'package.json');
  assert.match(await (await fetch(status.url)).text(), /Fixture app/);
  assert.doesNotMatch(status.tail, /\u001b/, 'ANSI escapes removed');
  const again = await m.start(root);
  assert.equal(again.alreadyRunning, true); assert.equal(again.pid, status.pid);
  const log = m.read('dev-server', { root });
  assert.ok(log.entries.some(e => e.stream === 'stderr' && /ready in/.test(e.text)), 'stderr captured');
  const serverPid = Number(await fs.readFile(path.join(root, 'server.pid'), 'utf8'));
  assert.notEqual(serverPid, status.pid, 'npm spawned the server as a child');
  const stopped = await m.stop(root);
  assert.equal(stopped.wasRunning, true); assert.equal(stopped.state, 'stopped');
  assert.ok(await waitGone(serverPid), 'the grandchild server process is gone');
  await assert.rejects(fetch(status.url));
});

test('saved per-project command persists across managers; failures report output', async t => {
  const root = await fixture(t, { build: 'tsc' });
  const configFile = path.join(root, 'state', 'dev-servers.json');
  const first = new ProcessManager({ configFile });
  const saved = await first.configure(root, { command: [process.execPath, 'server.js'] });
  assert.deepEqual(saved.config.command, [process.execPath, 'server.js']);
  assert.equal(((await fs.stat(configFile)).mode & 0o777), 0o600);
  const second = new ProcessManager({ configFile });
  t.after(() => second.stopAll());
  const status = await second.start(root, { waitMs: 20000 });
  assert.equal(status.state, 'running'); assert.equal(status.source, 'saved'); assert.equal(status.config.command[1], 'server.js');
  await second.stop(root);
  await second.configure(root, { command: null });
  assert.equal((await second.status(root)).config, null);
  const failing = new ProcessManager();
  const failed = await failing.start(root, { command: [process.execPath, '-e', 'console.error("boom: missing module");process.exit(3)'], waitMs: 5000 });
  assert.equal(failed.state, 'failed'); assert.equal(failed.exitCode, 3); assert.match(failed.tail, /boom: missing module/);
  await assert.rejects(failing.start(root, { command: ['definitely-not-a-real-binary-bd'] }), /Command not found/);
});

test('terminal commands: foreground output, timeout, background read/stop and stopAll', async t => {
  const root = await fixture(t);
  const m = new ProcessManager();
  t.after(() => m.stopAll());
  const ok = await m.run(root, [process.execPath, '-e', 'console.log(process.cwd());console.error("warn");process.exit(2)']);
  assert.equal(ok.state, 'exited'); assert.equal(ok.exitCode, 2); assert.match(ok.output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.match(ok.output, /warn/);
  const big = await m.run(root, [process.execPath, '-e', 'for(let i=0;i<20000;i++)console.log("row "+i)']);
  assert.equal(big.truncated, true); assert.ok(big.output.length <= 30000); assert.match(big.output, /row 19999$/);
  const slow = await m.run(root, [process.execPath, '-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 1000 });
  assert.equal(slow.state, 'timed-out'); assert.ok(slow.durationMs < 8000);
  const bg = await m.run(root, [process.execPath, '-e', 'let i=0;setInterval(()=>console.log("tick "+(i++)),50)'], { background: true });
  assert.equal(bg.state, 'running'); assert.match(bg.id, /^job-/);
  await new Promise(r => setTimeout(r, 400));
  const first = m.read(bg.id, { root });
  assert.ok(first.entries.length >= 2); assert.match(first.entries[0].text, /tick/);
  await new Promise(r => setTimeout(r, 200));
  const next = m.read(bg.id, { since: first.nextSeq, root });
  assert.ok(next.entries.length >= 1 && next.entries[0].seq > first.nextSeq, 'since returns only newer lines');
  assert.ok(m.list(root).some(j => j.id === bg.id && j.state === 'running'));
  assert.throws(() => m.read(bg.id, { root: os.tmpdir() }), /Unknown terminal id/, 'jobs are scoped to their project');
  const killed = await m.kill(bg.id, { root });
  assert.equal(killed.state, 'stopped');
  const orphan = await m.run(root, [process.execPath, '-e', 'setInterval(()=>{},1000)'], { background: true });
  const server = await m.start(root, { waitMs: 30000 });
  const serverPid = Number(await fs.readFile(path.join(root, 'server.pid'), 'utf8'));
  assert.equal(m.stopAll(), 2);
  assert.ok(await waitGone(orphan.pid) && await waitGone(server.pid) && await waitGone(serverPid), 'app quit stops every process group');
});
