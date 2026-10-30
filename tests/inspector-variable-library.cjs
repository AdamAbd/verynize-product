// Variable creation/export and malformed icon assets: real Electron UI regressions.
const { _electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bd-variable-library-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: ['.', `--user-data-dir=${profile}`], timeout: 20000 });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector('#canvas .layer');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const doc = () => page.evaluate(() => window.design.getDocument());
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { brand: '#123456' };
      d.variables = { spacing: { type: 'dimension', value: 24 } };
      d.pages[0].nodes = [{ id: 'card', name: 'Card', type: 'frame', x: 20, y: 20, w: 120, h: 80, color: '#ffffff', token: 'brand' }];
      window.design.setDocument(d);
      window.design.setSelection(['card']);
    });
    const createColor = async name => {
      await page.locator('#add-color-token').waitFor({ state: 'detached' });
      await page.locator('#add-token').click();
      await page.locator('#add-color-token').click();
      await page.locator('#text-prompt-input').fill(name);
      await page.locator('#text-prompt-ok').click();
      await page.locator('#text-prompt-input').waitFor({ state: 'hidden' });
    };
    for (const name of ['brand', 'spacing', ' constructor ', 'bad;name']) {
      const before = await doc();
      await createColor(name);
      await page.waitForFunction(() => /already exists|Use letters/.test(document.querySelector('footer').textContent));
      assert.deepEqual(await doc(), before, `Rejected color name ${name} leaves the document intact`);
    }
    await createColor('brand/accent');
    await page.waitForFunction(() => window.design.getDocument().tokens['brand/accent'] === '#a58bdd');
    await page.locator('#insp-variables [data-token="brand/accent"]').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), ['card']);
    assert.equal((await doc()).tokens.brand, '#123456');
    await page.locator('#undo').evaluate(button => button.click());
    await page.waitForFunction(() => !window.design.getDocument().tokens['brand/accent']);
    assert.equal((await doc()).tokens.brand, '#123456');

    // Ambiguous CSS export reports the alias and does not overwrite the clipboard.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { 'space-md': '#123456' };
      d.variables = { 'space/md': { type: 'dimension', value: 16 } };
      window.design.setDocument(d);
    });
    await app.evaluate(({ clipboard }) => clipboard.writeText('keep clipboard'));
    await page.locator('#variables-css').click();
    await page.locator('#copy-variables-css').click();
    await page.getByText(/both export as --space-md/).waitFor();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'keep clipboard');

    // Documents can retain bad imported assets; clicking them must not throw or insert broken layers.
    const badSources = ['***', Buffer.from('not SVG').toString('base64'), Buffer.from('<svg><path></svg>').toString('base64')];
    await page.evaluate(sources => {
      window.design.setIcons(sources.map((source, index) => ({ id: `bad-${index}`, name: `Bad ${index}`, src: `data:image/svg+xml;base64,${source}` })));
    }, badSources);
    const header = page.locator('#insp-icons button[aria-expanded]').first();
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
    const before = await doc();
    for (let index = 0; index < badSources.length; index++) {
      await page.locator(`#insp-icons [data-icon-id="bad-${index}"]`).click();
      await page.getByText('This icon contains invalid SVG data. Upload or paste it again.').first().waitFor();
      assert.deepEqual(await doc(), before, 'Invalid icon insertion leaves the document intact');
    }
    assert.deepEqual(errors, [], 'No uncaught renderer errors');
    console.log('PASS variable library: safe color creation, selection/undo, collision export error, malformed icon handling');
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
