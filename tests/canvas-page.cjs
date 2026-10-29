const {_electron}=require(process.cwd()+'/node_modules/@playwright/test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');
(async()=>{
  const profile=await fs.mkdtemp(os.tmpdir()+'/bd-page-'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({timeout:20000,env,args:['.',`--user-data-dir=${profile}`]});
  try{
    const p=await app.firstWindow({timeout:15000});await p.waitForSelector('#canvas .layer');
    // A new page is empty: no white artboard behind it.
    await p.locator('#add-page').click();
    assert.equal(await p.locator('#canvas .layer').count(),0);
    assert.equal(await p.locator('#canvas').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
    // Frames carry no grey outline unless selected.
    await p.locator('#add-frame').click();
    await p.evaluate(()=>window.design.setSelection([]));
    assert.equal(await p.locator('#canvas .frame-layer').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    // Nothing selected: Variables collapsed, Properties shows the page colour.
    assert.equal(await p.locator('#insp-variables button[aria-expanded]').first().getAttribute('aria-expanded'),'false');
    await p.locator('#page-section').waitFor();
    await p.locator('#page-section input').fill('112233');await p.locator('#page-section input').press('Enter');
    await p.waitForFunction(()=>{const d=window.design.getDocument();return d.pages.find(x=>x.id===d.activePage).background==='#112233'});
    assert.equal(await p.locator('#workspace').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(17, 34, 51)');
    assert.equal(await p.evaluate(()=>{try{window.design.updatePage({background:'red'});return false}catch{return true}}),true);
    await p.locator('[aria-label="Reset page colour"]').click();
    assert.equal(await p.evaluate(()=>{const d=window.design.getDocument();return 'background' in d.pages.find(x=>x.id===d.activePage)}),false);
    // Selecting a layer keeps Variables collapsed and hides the page section.
    await p.evaluate(()=>{const d=window.design.getDocument();window.design.setSelection([d.pages.find(x=>x.id===d.activePage).nodes[0].id])});
    await p.locator('#page-section').waitFor({state:'detached'});
    assert.equal(await p.locator('#insp-variables button[aria-expanded]').first().getAttribute('aria-expanded'),'false');
    console.log('PASS page: empty new page, no frame outline, page colour with variables collapsed');
  }finally{await app.close();await fs.rm(profile,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
