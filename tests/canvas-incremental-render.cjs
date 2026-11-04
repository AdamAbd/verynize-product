// Canvas rendering does only the work an edit needs: a drag moves the dragged layers without rendering the document
// (one render and one undo step at release).
const {_electron} = require('@playwright/test');
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-incremental-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000}); await moveOffCursor(app);
    await waitForUiReady(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const near = (actual, expected, tolerance = 0.5, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const node = id => page.evaluate(id => window.design.getDocument().pages[0].nodes.find(n => n.id === id), id);
    async function seed(nodes, camera = [100, 100, 1]) {
      await page.evaluate(([nodes, camera]) => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move');
        window.design.setCamera(...camera);
      }, [nodes, camera]);
    }
    async function screen(x, y) {
      return page.evaluate(([x, y]) => {
        const r = document.querySelector('#canvas-wrap').getBoundingClientRect(), c = window.design.getCamera();
        return {x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom};
      }, [x, y]);
    }
    // Renders are counted through document subscribers, which every render() notifies once.
    await page.evaluate(() => { window.__renders = 0; window.design.subscribe(() => { window.__renders++; }); });
    const renders = () => page.evaluate(() => window.__renders);
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({id, name: id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});
    const box = id => page.evaluate(id => { const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }, id);

    // ---- 1. Live drag: no render while the pointer moves, one render and one undo step at release ----
    await seed([
      {id: 'F', name: 'Frame', type: 'frame', x: 600, y: 0, w: 300, h: 300, color: '#ffffff', layout: 'free', clipContent: true},
      rect('inside', 20, 20, 60, 40, {parentId: 'F'}),
      rect('R', 0, 0, 100, 80),
      rect('anchor', 0, 400, 100, 80, {rotation: 30}),
    ]);
    await page.evaluate(() => window.design.updateNodes(['inside'], {name: 'inside'})); // a known previous undo step
    await page.evaluate(() => window.design.setSelection(['R']));
    const start = await screen(50, 40), startBox = await box('R');
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    const before = await renders();
    await page.mouse.move(start.x + 120, start.y + 90, {steps: 12});
    const during = await page.evaluate(() => ({n: window.design.getDocument().pages[0].nodes.find(n => n.id === 'R'), translate: document.querySelector('#canvas [data-id=R]').style.translate, renders: window.__renders}));
    const heldBox = await box('R');
    assert.equal(during.renders - before, 0, 'no render while the layer follows the pointer');
    near(during.n.x, 120, 0.01, 'x follows the pointer live'); near(during.n.y, 90, 0.01, 'y follows the pointer live');
    near(heldBox.x - startBox.x, 120, 0.5, 'the element is drawn where the pointer put it'); near(heldBox.y - startBox.y, 90, 0.5);
    assert.ok(during.translate, 'the element is offset by a translate while held');
    await page.mouse.up();
    assert.equal(await renders() - before, 1, 'one render at release');
    const dropped = await node('R');
    assert.deepEqual([dropped.x, dropped.y], [120, 90], 'the drop lands where the pointer left it');
    assert.equal(await page.locator('#canvas [data-id=R]').evaluate(e => e.style.translate), '', 'the drag offset is gone after release');
    assert.equal(await page.locator('#canvas [data-id=R]').evaluate(e => e.style.left), '120px', 'the layer is drawn from its new x');
    await page.keyboard.press(mod('KeyZ'));
    assert.deepEqual(await node('R').then(n => [n.x, n.y]), [0, 0], 'the drag is one undo step');
    assert.equal((await node('inside')).name, 'inside', 'undo stops at the drag');
    await page.keyboard.press(mod('Shift+KeyZ'));
    assert.deepEqual(await node('R').then(n => [n.x, n.y]), [120, 90], 'redo replays the drag');

    // A rotated layer moves in its parent's space: the translate composes with its rotation.
    await page.evaluate(() => window.design.setSelection(['anchor']));
    const a0 = await screen(50, 440), anchorBox = await box('anchor');
    await page.mouse.move(a0.x, a0.y); await page.mouse.down(); await page.mouse.move(a0.x + 60, a0.y - 30, {steps: 6});
    const anchorHeld = await box('anchor'), anchorLive = await node('anchor'); // snapping may adjust the pointer delta
    near(anchorHeld.x - anchorBox.x, anchorLive.x, 0.5, 'rotated layer is drawn at its live x'); near(anchorHeld.y - anchorBox.y, anchorLive.y - 400, 0.5, 'rotated layer is drawn at its live y');
    near(anchorLive.x, 60, 6, 'rotated layer follows the pointer'); near(anchorLive.y, 370, 6);
    await page.mouse.up();
    assert.deepEqual(await node('anchor').then(n => [n.x, n.y]), [anchorLive.x, anchorLive.y], 'released where it was held');
    const anchorAfter = await box('anchor');
    near(anchorAfter.x, anchorHeld.x, 0.5, 'no jump on release'); near(anchorAfter.y, anchorHeld.y, 0.5);

    // Nesting on the way still re-renders once, and the layer keeps following inside the frame.
    await page.evaluate(() => window.design.setSelection(['R']));
    const r0 = await screen(170, 130), into = await screen(650, 120);
    await page.mouse.move(r0.x, r0.y); await page.mouse.down(); await page.mouse.move(into.x, into.y, {steps: 10});
    const nested = await page.evaluate(() => ({parent: window.design.getDocument().pages[0].nodes.find(n => n.id === 'R').parentId, dom: document.querySelector('#canvas [data-id=R]').parentElement.closest('.layer')?.dataset.id}));
    assert.deepEqual(nested, {parent: 'F', dom: 'F'}, 'the layer nests while the pointer is over the frame');
    await page.mouse.move(into.x + 20, into.y + 10, {steps: 4});
    await page.mouse.up();
    const inF = await node('R');
    assert.equal(inF.parentId, 'F'); near(inF.x, 120 + 480 + 20 - 600, 0.5, 'x is relative to the frame'); near(inF.y, 90 - 10 + 10, 0.5);
    await page.keyboard.press(mod('KeyZ'));
    assert.equal((await node('R')).parentId, null, 'nesting drag is one undo step');

    // Alt-drag moves a copy and leaves the original in place.
    await page.evaluate(() => window.design.setSelection(['R']));
    const c0 = await screen(170, 130);
    await page.mouse.move(c0.x, c0.y); await page.keyboard.down('Alt'); await page.mouse.down();
    await page.mouse.move(c0.x + 200, c0.y + 200, {steps: 8}); await page.mouse.up(); await page.keyboard.up('Alt');
    const copies = await page.evaluate(() => window.design.getDocument().pages[0].nodes.filter(n => n.type === 'rectangle' && /^R( \d+)?$/.test(n.name)).map(n => [n.x, n.y]));
    assert.deepEqual(copies.toSorted((a, b) => a[0] - b[0]), [[120, 90], [320, 290]], 'the original stays, the copy lands under the pointer');

    assert.deepEqual(errors, []);
    console.log('PASS canvas incremental render: live drag without renders (one render + one undo step at release, rotated layers, nesting, Alt copy)');
  } finally {
    await app.close().catch(() => {});
    await fs.rm(dir, {recursive: true, force: true}).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
