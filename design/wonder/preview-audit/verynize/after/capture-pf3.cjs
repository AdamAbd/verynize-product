// PF3 after-captures (expanded preview tab), 1440×870 at 2×, next to wonder/PF3-expanded-verified.png.
//   npm run build:ui && node design/wonder/preview-audit/verynize/after/capture-pf3.cjs
// A temp folder "dipper" (the worktree name the tab shows) serves a Sunbird-like page with node; the real dev-server
// IPC starts and stops it. Writes PF3-expanded.png, PF3-canvas.png (after Show on canvas) and PF3-stopped.png here.
const ROOT = require('node:path').resolve(__dirname, '../../../../..');
const {_electron} = require(ROOT + '/node_modules/@playwright/test');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const PAGE = `<!doctype html><html><head><meta charset=utf-8><style>body{margin:0;padding:40px;background:#f4f6fe;font-family:system-ui;color:#172340}h1{font-size:36px;margin:0 0 24px}button,input{font:14px system-ui;padding:10px 12px;margin:0 0 16px;display:block}a{display:inline-block;margin:8px 10px 16px;font-size:18px}svg{display:block}</style></head><body><h1>Sunbird preview sandbox</h1><button onclick="this.textContent='Count: '+(++window.n)">Count: 0</button><input placeholder="Type a message"><a href="/about">About</a><svg width=154 height=96><rect width=154 height=96 fill=#95b3f0 /><circle cx=76 cy=48 r=24 fill=#f6cb6b /><path d="M95 42 L118 50 L95 56Z" fill=#ef6f6c /></svg><script>window.n=0</script></body></html>`;
const SERVER = `const page=${JSON.stringify(PAGE)};require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(q.url.startsWith('/about')?'<h1>About Sunbird</h1><a href="/">Home</a>':page)}).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port+'/')})`;
(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vz-pf3-')));
  const repo = path.join(tmp, 'dipper');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'server.js'), SERVER);
  const env = {...process.env, VERYNIZE_SKIP_ONBOARDING: '1'}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({cwd: ROOT, env, args: ['.', '--force-device-scale-factor=2', '--force-color-profile=srgb', `--user-data-dir=${path.join(tmp, 'profile')}`]});
  let root = '';
  const page = await app.firstWindow();
  try {
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 870));
    await page.waitForFunction(() => !!window.livePreview && !!window.previewTab);
    await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, repo);
    root = (await page.evaluate(() => window.desktop.openProject())).root;
    const started = await page.evaluate(async root => { await window.desktop.devServer.configure({root, command: ['node', 'server.js']}); return window.desktop.devServer.start({root}); }, root);
    const frameId = await page.evaluate(({url, root}) => { window.livePreview.show(url, {root, name: 'Dipper', chatId: ''}); return window.livePreview.getNodeId(); }, {url: started.url, root});
    await page.waitForTimeout(1200);
    await page.locator(`[data-id="${frameId}"] [data-part=live-expand]`).click();
    await page.waitForFunction(() => document.querySelector('iframe[name=verynize-preview-tab]')?.src);
    await page.waitForTimeout(1500);
    await page.mouse.move(1435, 450);
    await page.screenshot({path: path.join(__dirname, 'PF3-expanded.png')});
    await page.locator('#preview-tab-view [aria-label="Show on canvas"]').click();
    await page.waitForTimeout(800);
    await page.screenshot({path: path.join(__dirname, 'PF3-canvas.png')});
    await page.evaluate(id => window.previewTab.open(id), frameId);
    await page.evaluate(root => window.desktop.devServer.stop({root}), root);
    await page.waitForFunction(id => document.querySelector(`[data-preview-tab="${id}"]`)?.dataset.status === 'stopped', frameId, {timeout: 10000});
    await page.waitForTimeout(300);
    await page.screenshot({path: path.join(__dirname, 'PF3-stopped.png')});
    console.log('wrote PF3-expanded.png, PF3-canvas.png, PF3-stopped.png');
  } finally {
    if (root) await page.evaluate(root => window.desktop.devServer.stop({root}), root).catch(() => {});
    await app.close();
    await fs.rm(tmp, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
