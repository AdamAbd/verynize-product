// Wonder selection marks: hidden-layer outline (CM6-hidden), constraint guides and no name label on nested layers
// (S2, CM3-text-menu), hover without child outlines (S1-hover-final), whole-number Alt distances (TR5) and caret-only
// text editing (TX1-click, TX1-drag).
const {_electron} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-selection-marks-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const PURPLE = 'rgb(196, 104, 247)';
    const near = (actual, expected, tolerance = 1, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({id, name: id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});
    const frame = (id, x, y, w, h, extra = {}) => ({id, name: id, type: 'frame', x, y, w, h, color: '#ffffff', layout: 'free', ...extra});
    async function seed(nodes) {
      await page.evaluate(nodes => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Page 1', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move'); window.design.setCamera(100, 100, 1);
      }, nodes);
    }
    const select = ids => page.evaluate(ids => window.design.setSelection(ids), ids);
    async function screen(x, y) {
      return page.evaluate(([x, y]) => {
        const r = document.querySelector('#canvas-wrap').getBoundingClientRect(), c = window.design.getCamera();
        return {x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom};
      }, [x, y]);
    }
    const boxOf = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }, sel);
    const shown = sel => page.locator(sel).first().isVisible();

    // ---- CM6-hidden: a selected hidden layer shows only its bounds as a 1px purple outline ----
    await seed([frame('board', 0, 0, 400, 300), rect('ghost', 500, 20, 120, 120, {hidden: true})]);
    await select(['ghost']);
    assert.equal(await shown('#canvas-overlay .hidden-outline'), true, 'hidden layer is outlined');
    const outline = await boxOf('#canvas-overlay .hidden-outline'), at = await screen(500, 20);
    near(outline.x, at.x, 1, 'outline x'); near(outline.y, at.y, 1, 'outline y'); near(outline.w, 120, 1, 'outline w'); near(outline.h, 120, 1, 'outline h');
    assert.deepEqual(await page.locator('#canvas-overlay .hidden-outline').evaluate(e => { const cs = getComputedStyle(e); return [cs.borderTopWidth, cs.borderTopColor, cs.backgroundColor]; }),
      ['1px', PURPLE, 'rgba(0, 0, 0, 0)'], 'empty 1px #c468f7 outline');
    assert.equal(await page.locator('#canvas [data-id=ghost]').evaluate(e => getComputedStyle(e).display), 'none', 'the layer itself stays hidden');
    for (const sel of ['#selection-name', '#selection-measure', '#selection-chat-chip']) assert.equal(await shown('#canvas-overlay ' + sel), false, sel + ' is not drawn for a hidden layer');
    await select(['board']);
    assert.equal(await shown('#canvas-overlay .hidden-outline'), false, 'the outline goes with the selection');

    // ---- S2: a nested child gets dashed guides to the parent edges it is pinned to, and no name label ----
    await seed([frame('board', 0, 0, 400, 300, {clipContent: true}), frame('kid', 49, 40, 100, 80, {parentId: 'board'}),
      rect('pinned', 0, 0, 50, 50, {parentId: 'board', inset: [150, 30, null, null]}),
      {id: 'stack', name: 'stack', type: 'frame', x: 0, y: 400, w: 300, h: 100, color: '#ffffff', layout: 'flex', direction: 'row'}, rect('item', 0, 0, 50, 50, {parentId: 'stack'})]);
    await select(['kid']);
    const guides = () => page.locator('#canvas-overlay .constraint-guide').evaluateAll(els => els.map(e => {
      const cs = getComputedStyle(e); return {side: e.dataset.side, x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2'), stroke: cs.stroke, opacity: cs.strokeOpacity, dash: cs.strokeDasharray, width: cs.strokeWidth};
    }));
    const wrap = await boxOf('#canvas-wrap'), local = async (x, y) => { const p = await screen(x, y); return {x: p.x - wrap.x, y: p.y - wrap.y}; };
    let lines = await guides();
    assert.deepEqual(lines.map(l => l.side).toSorted(), ['left', 'top'], 'Left/Top constraints draw guides to the left and top edges');
    const left = lines.find(l => l.side === 'left'), top = lines.find(l => l.side === 'top');
    const boardTL = await local(0, 0), kidTL = await local(49, 40), kidC = await local(99, 80);
    near(left.x1, boardTL.x, 1, 'left guide starts at the parent edge'); near(left.x2, kidTL.x, 1, 'and ends at the child'); near(left.y1, kidC.y, 1, 'at the child centre line');
    near(top.y1, boardTL.y, 1, 'top guide starts at the parent edge'); near(top.y2, kidTL.y, 1, 'and ends at the child'); near(top.x1, kidC.x, 1, 'at the child centre line');
    assert.ok(lines.every(l => l.stroke === PURPLE && l.opacity === '0.75' && l.dash === '2.5px, 2px' && l.width === '1px'), 'thin dashed purple guides: ' + JSON.stringify(lines[0]));
    assert.equal(await page.locator('#canvas-overlay .guide-label').count(), 0, 'no distance numbers');
    assert.equal(await shown('#canvas-overlay #selection-name'), false, 'no name label on a nested layer');
    assert.equal(await shown('#canvas-overlay #selection-measure'), true, 'the size badge stays');
    // Inside a clipping parent the overlay ring replaces the layer's own outline: one ring, not two.
    assert.equal(await page.locator('#canvas-overlay .clipped-selection .selection-ring').count(), 1);
    assert.equal(await page.locator('#canvas [data-id=kid]').evaluate(e => getComputedStyle(e).outlineStyle), 'none', 'no second outline under the ring');
    await select(['pinned']);
    assert.deepEqual((await guides()).map(l => l.side).toSorted(), ['right', 'top'], 'a Right constraint draws to the right edge');
    await select(['item']);
    assert.equal((await guides()).length, 0, 'auto-layout children have no constraint guides');
    await select(['board']);
    assert.equal((await guides()).length, 0, 'top-level layers have none');
    assert.equal(await shown('#canvas-overlay #selection-name'), true, 'a top-level frame keeps its name label');
    // CM3-text-menu: a selected nested text has no name label either.
    await page.evaluate(() => window.design.addNode('text', {text: 'Canvas au', x: 82, y: 160, parentId: 'board'}));
    assert.equal(await page.evaluate(() => window.design.getDocument().pages[0].nodes.find(n => window.design.getSelection().includes(n.id))?.type), 'text');
    assert.equal(await shown('#canvas-overlay #selection-name'), false, 'no name label on text');

    // ---- S1: hovering an unselected frame outlines it and tints its label, nothing else ----
    await seed([frame('board', 0, 0, 400, 300), rect('c1', 10, 10, 50, 50, {parentId: 'board'}), rect('c2', 100, 10, 50, 50, {parentId: 'board'})]);
    const over = await screen(300, 250); await page.mouse.move(over.x, over.y, {steps: 2}); await page.mouse.move(over.x + 1, over.y + 1);
    assert.equal(await page.locator('#canvas-overlay').getAttribute('data-hover'), 'board');
    assert.equal(await shown('#canvas-overlay .hover-box'), true, 'hovered frame is outlined');
    assert.equal(await page.locator('#canvas-overlay .hover-box ~ *[class*=hover], #canvas-overlay .hover-children, #canvas-overlay .hover-child').count(), 0, 'its children are not outlined');
    const label = page.locator('#canvas-overlay .frame-label[data-id=board]');
    assert.equal(await label.evaluate(e => e.classList.contains('hovered')), true, 'the frame label is marked hovered');
    assert.equal(await label.evaluate(e => getComputedStyle(e).color), await page.locator('#canvas-overlay .hover-box').evaluate(e => getComputedStyle(e).borderTopColor), 'label takes the outline purple');
    await page.mouse.move(5, 5);
    assert.equal(await label.evaluate(e => e.classList.contains('hovered')), false, 'the tint leaves with the pointer');

    // ---- TR5: Alt distances are whole numbers ----
    await seed([rect('a', 0, 0, 100, 80), rect('b', 136.4, 0, 100, 80)]);
    await select(['a']);
    const target = await screen(180, 40);
    await page.keyboard.down('Alt'); await page.mouse.move(target.x, target.y); await page.mouse.move(target.x + 2, target.y + 2);
    const distances = await page.locator('#canvas-overlay .guide-label').allTextContents();
    await page.keyboard.up('Alt');
    assert.deepEqual(distances, ['36'], 'a 36.4 px gap reads 36');
    await page.mouse.move(5, 5);

    // ---- TX1: a text being typed shows only its caret (in its ink colour) ----
    await seed([frame('board', 0, 0, 400, 300)]);
    let p = await screen(59, 160);
    await page.evaluate(() => window.design.setTool('text'));
    await page.mouse.click(p.x, p.y);
    const editor = page.locator('#canvas [data-text-editing]'); await editor.waitFor();
    assert.deepEqual(await editor.evaluate(e => [getComputedStyle(e).outlineStyle, getComputedStyle(e).color, e.querySelectorAll('.handle').length]), ['none', 'rgb(0, 0, 0)', 0], 'no selection ring or handles; black ink (and caret, text-caret.js) on the white frame');
    for (const sel of ['#selection-name', '#selection-measure', '#selection-chat-chip']) assert.equal(await shown('#canvas-overlay ' + sel), false, sel + ' hidden while typing a click text');
    await page.keyboard.press('Escape'); await editor.waitFor({state: 'detached'});
    p = await screen(515, 47);
    await page.evaluate(() => window.design.setTool('text'));
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 150, p.y + 60, {steps: 6}); await page.mouse.up();
    await editor.waitFor();
    assert.deepEqual(await editor.evaluate(e => [getComputedStyle(e).outlineStyle, getComputedStyle(e).color]), ['none', 'rgb(255, 255, 255)'], 'a drag box on the dark page: no ring, white ink');
    assert.equal(await shown('#canvas-overlay #selection-name'), false, 'no "Text" label');
    assert.equal(await shown('#canvas-overlay #selection-measure'), false, 'no size badge');
    assert.equal(await shown('#canvas-overlay #selection-chat-chip'), true, 'the ⊕ chip stays for a fixed box (TX1-drag)');
    await page.keyboard.type('Hi'); await page.keyboard.press('Escape'); await editor.waitFor({state: 'detached'});
    assert.equal(await shown('#canvas-overlay #selection-measure'), true, 'the badge returns when editing ends');
    assert.equal(await page.locator('#canvas .layer.selected').evaluate(e => getComputedStyle(e).outlineStyle), 'solid', 'and the selection ring');

    assert.deepEqual(errors, []);
    console.log('PASS canvas selection marks: hidden-layer outline, nested constraint guides without labels, single clipped ring, hover outline + label only, whole-number Alt distances, caret-only text editing');
  } finally {
    await app.close();
    await fs.rm(dir, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exit(1); });
