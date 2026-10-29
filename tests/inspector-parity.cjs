// Inspector parity with Wonder (design/wonder 23, 26–27, 41–42, 45–50): colour picker alpha + formats, per-fill
// opacity, typed variables (dimension/number/font family/font weight) with bindings, the font catalog picker with
// family-specific weights, and artwork export at 0.5×/4× and as PDF through the native save dialog.
const {_electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');

const pngSize=bytes=>({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});

(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inspector-parity-'));
 const fontCache=path.join(dir,'fonts'),out=path.join(dir,'out');
 await fs.mkdir(path.join(fontCache,'meta'),{recursive:true});await fs.mkdir(out);
 // Fresh catalog in the font cache: the picker must not need the network.
 await fs.writeFile(path.join(fontCache,'meta','catalog.json'),JSON.stringify([
  {id:'lora',family:'Lora',category:'serif',weights:[400,500,600,700],styles:['normal','italic'],kind:'web'},
  {id:'zilla-slab',family:'Zilla Slab',category:'serif',weights:[300,400,500,600,700],styles:['normal'],kind:'web'},
 ]));
 const env={...process.env,VERYNIZE_FONT_CACHE:fontCache};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({env,args:['.',`--user-data-dir=${path.join(dir,'profile')}`],timeout:20000});
 try{
  const page=await app.firstWindow({timeout:20000});
  await page.waitForSelector('#canvas .layer');
  const doc=()=>page.evaluate(()=>window.design.getDocument());
  // Menus/popovers animate out; wait until the previous one is gone before opening the next.
  const closed=()=>page.waitForFunction(()=>!document.querySelector('#font-weight-picker,#font-family-picker'));
  const node=async id=>(await doc()).pages[0].nodes.find(n=>n.id===id);
  await page.evaluate(()=>{const d=window.design.getDocument();d.tokens={};delete d.variables;d.pages[0].nodes=[
   {id:'card',name:'Card',type:'frame',x:20,y:20,w:100,h:80,color:'#ff0000',layout:'flex',gap:4,padding:8},
   {id:'title',name:'Title',type:'text',x:200,y:40,w:160,h:40,text:'Hello',color:'#111111',fontFamily:'Inter',fontWeight:'400',fontSize:24}];
   window.design.setDocument(d);window.design.setSelection(['card']);});

  // --- Colour picker: alpha slider value, formats, per-fill opacity -----------------------------------------
  await page.locator('[name=color]').click();
  await page.waitForSelector('#color-dialog #color-field');
  await page.getByRole('textbox',{name:'Opacity percent'}).fill('50');
  await page.getByRole('textbox',{name:'Opacity percent'}).press('Enter');
  assert.equal((await node('card')).color,'#ff000080');
  assert.equal((await node('card')).opacity??100,100,'fill alpha does not change layer opacity');
  assert.equal(await page.locator('#canvas [data-id=card]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(255, 0, 0, 0.5)');
  await page.locator('#color-dialog select[aria-label="Colour format"]').selectOption('rgb');
  assert.equal(await page.locator('#color-value').inputValue(),'rgb(255 0 0)');
  await page.locator('#color-value').fill('hsl(120 100% 25%)');await page.locator('#color-value').press('Tab');
  assert.equal((await node('card')).color,'#00800080','typed colours keep the alpha');
  await page.locator('#color-dialog select[aria-label="Colour format"]').selectOption('oklch');
  assert.match(await page.locator('#color-value').inputValue(),/^oklch\(/);
  // Drag on the saturation/value plane: top-right corner = fully saturated hue, committed once on release.
  const field=await page.locator('#color-field').boundingBox();
  await page.mouse.move(field.x+field.width/2,field.y+field.height/2);await page.mouse.down();await page.mouse.move(field.x+field.width-4,field.y+4,{steps:4});
  assert.equal((await node('card')).color,'#00800080','dragging previews without committing');
  await page.mouse.up();
  assert.match((await node('card')).color,/^#0[0-9a-f][ef][0-9a-f]0[0-9a-f]80$/,'released near the top-right corner: saturated green, alpha kept');
  await page.locator('#color-dialog .dialog-head button').click();
  await page.waitForSelector('#color-dialog',{state:'detached'});
  await page.getByRole('textbox',{name:'Fill opacity'}).fill('25');await page.getByRole('textbox',{name:'Fill opacity'}).press('Enter');
  assert.match((await node('card')).color,/40$/);
  await page.getByRole('textbox',{name:'Fill hex colour'}).fill('123456');await page.getByRole('textbox',{name:'Fill hex colour'}).press('Enter');
  assert.equal((await node('card')).color,'#12345640','retyping the hex keeps the fill alpha');
  console.log('PASS colour picker alpha, HEX/RGB/HSL/OKLCH formats, drag commit and per-fill opacity');

  // --- Variables: create every type, bind, follow value changes, detach on delete ---------------------------
  const create=async(type,name)=>{await page.locator('[id^=add-][id$=-variable]').first().waitFor({state:'detached'});await page.locator('#add-token').click();await page.locator(`#add-${type}-variable`).click();await page.locator('#text-prompt-input').fill(name);await page.locator('#text-prompt-ok').click();await page.waitForFunction(n=>window.design.getDocument().variables?.[n],name);};
  await create('dimension','space/md');await create('number','ratio');await create('fontFamily','font/body');await create('fontWeight','weight/strong');
  assert.deepEqual((await doc()).variables,{'space/md':{type:'dimension',value:16},ratio:{type:'number',value:1},'font/body':{type:'fontFamily',value:'Inter'},'weight/strong':{type:'fontWeight',value:'400'}});
  assert.deepEqual(await page.evaluate(()=>window.design.getSelection()),['card'],'creating a variable keeps the selection');
  await page.locator('#insp-variables [role=group][aria-label="Dimensions"] [data-variable="space/md"]').waitFor();
  // Bind the frame's corner radius and gap.
  await page.locator('[name=radius]').hover();await page.locator('[data-bind=radius]').click();
  await page.locator('[role=menuitem][data-variable="space/md"]').click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[0].bindings?.radius==='space/md');
  assert.equal((await node('card')).radius,16);
  await page.locator('[data-bound=radius]').waitFor();
  await page.locator('[name=gap]').hover();await page.locator('[data-bind=gap]').click();await page.locator('[role=menuitem][data-variable="space/md"]').click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[0].gap===16);
  // Change the variable value: bound layers follow (one undo step).
  const valueField=page.getByRole('textbox',{name:'space/md value'});
  await valueField.fill('24');await valueField.press('Enter');
  await page.waitForFunction(()=>window.design.getDocument().variables['space/md'].value===24);
  assert.equal((await node('card')).radius,24);assert.equal((await node('card')).gap,24);
  assert.equal(await page.locator('#canvas [data-id=card]').evaluate(el=>el.style.borderRadius),'24px');
  // Number variables drive unitless properties such as opacity.
  await page.locator('[name=opacity]').hover();await page.locator('[data-bind=opacity]').click();await page.locator('[role=menuitem][data-variable="ratio"]').click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[0].bindings?.opacity==='ratio');
  assert.equal((await node('card')).opacity,1);
  // Typing into a bound field is impossible (chip); detaching keeps the value.
  await page.locator('[data-bound=opacity]').click();await page.getByRole('menuitem',{name:'Detach variable'}).click();
  await page.waitForFunction(()=>!window.design.getDocument().pages[0].nodes[0].bindings?.opacity);
  // Deleting a variable unbinds layers but keeps their resolved values.
  const radiusBefore=(await node('card')).radius;
  await page.locator('[data-variable="space/md"]').hover();await page.getByRole('button',{name:'Delete variable space/md'}).click();
  await page.waitForFunction(()=>!window.design.getDocument().variables['space/md']);
  assert.equal((await node('card')).bindings,undefined);assert.equal((await node('card')).radius,radiusBefore);
  // validate() in app.js rejects malformed variables and bindings (mirrors integrations/design-store.mjs).
  const rejected=await page.evaluate(()=>{const out=[];for(const patch of [d=>{d.variables={x:{type:'dimension',value:'12px'}}},d=>{d.variables={'bad;':{type:'number',value:1}}},d=>{d.pages[0].nodes[0].bindings={color:'ratio'}},d=>{d.tokens={a:'#12345'}},d=>{d.variables={x:{type:'fontFamily',value:'a;b'}}}]){const d=window.design.getDocument();patch(d);try{window.design.setDocument(d);out.push(false)}catch{out.push(true)}}return out;});
  assert.deepEqual(rejected,[true,true,true,true,true]);
  // CSS variable export.
  await page.locator('#variables-css').click();await page.locator('#copy-variables-css').click();
  await page.getByText(/Copied \d+ variables as CSS/).first().waitFor();
  const css=await app.evaluate(({clipboard})=>clipboard.readText());
  assert.match(css,/^:root \{\n  --ratio: 1;\n  --font-body: Inter;\n  --weight-strong: 400;\n\}/);
  console.log('PASS dimension/number/font variables: create, bind, follow, detach, delete, validate, CSS export');

  // --- Typography: catalog font picker, weights limited to the family, font variables -----------------------
  await page.evaluate(()=>window.design.setSelection(['title']));
  await closed();await page.getByRole('button',{name:'Font family'}).click();
  await page.getByRole('combobox',{name:'Search fonts'}).fill('lor');
  await page.locator('#font-family-list [data-family="Lora"]').click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].fontFamily==='Lora');
  await closed();await page.getByRole('button',{name:'Font weight'}).click();
  const weights=await page.locator('#font-weight-picker [data-weight]').evaluateAll(els=>els.map(el=>el.dataset.weight));
  assert.deepEqual(weights,['400','500','600','700'],'only the weights Lora ships');
  await page.locator('#font-weight-picker [data-weight="600"]').click();
  assert.equal((await node('title')).fontWeight,'600');
  // Switching to a family without the current weight snaps to the nearest one it has.
  await closed();await page.getByRole('button',{name:'Font family'}).click();
  await page.getByRole('combobox',{name:'Search fonts'}).fill('zilla');await page.getByRole('combobox',{name:'Search fonts'}).press('Enter');
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].fontFamily==='Zilla Slab');
  await closed();await page.getByRole('button',{name:'Font weight'}).click();
  await page.locator('#font-weight-picker [data-weight="300"]').click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].fontWeight==='300');
  await closed();await page.getByRole('button',{name:'Font family'}).click();
  await page.getByRole('combobox',{name:'Search fonts'}).fill('Lora');await page.getByRole('combobox',{name:'Search fonts'}).press('Enter');
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].fontWeight==='400');
  // Font family / weight variables.
  await closed();await page.getByRole('button',{name:'Font weight'}).click();
  await page.locator('#font-weight-picker [role=menuitem]').filter({hasText:'weight/strong'}).click();
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].bindings?.fontWeight==='weight/strong');
  await page.locator('[data-variable="weight/strong"] select').selectOption('800');
  await page.waitForFunction(()=>window.design.getDocument().pages[0].nodes[1].fontWeight==='800');
  console.log('PASS font catalog picker, family-limited weights, font family/weight variables');

  // --- Export: 0.5× / 4× PNG and PDF through the native save dialog, success toast --------------------------
  await page.evaluate(()=>{const d=window.design.getDocument();d.pages[0].nodes[0].color='#ff0000';d.pages[0].nodes[0].radius=0;d.pages[0].nodes[0].opacity=100;window.design.setDocument(d);window.design.setSelection(['card']);});
  let target='';
  const saveAs=async file=>{target=path.join(out,file);await app.evaluate(({dialog},t)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:t})},target);};
  await page.locator('#export-section .insp-add').click();
  const scales=await page.locator('#artwork-scale option').evaluateAll(els=>els.map(el=>el.value));
  assert.deepEqual(scales,['0.5','1','2','3','4']);
  const formats=await page.locator('#artwork-format option').evaluateAll(els=>els.map(el=>el.value));
  assert.ok(formats.includes('PDF'));
  await saveAs('card@4x.png');
  await page.locator('#artwork-scale').selectOption('4');await page.locator('#artwork-format').selectOption('PNG');
  await page.locator('#artwork-download').click();
  await page.getByText('Exported 1 element').first().waitFor({timeout:20000});
  assert.deepEqual(pngSize(await fs.readFile(target)),{width:400,height:320});
  await saveAs('card@0.5x.png');
  await page.locator('#artwork-scale').selectOption('0.5');await page.locator('#artwork-download').click();
  await page.waitForFunction(()=>/card@0\.5x\.png/.test(document.querySelector('#artwork-status')?.textContent||''),null,{timeout:20000});
  assert.deepEqual(pngSize(await fs.readFile(target)),{width:50,height:40});
  await saveAs('card.pdf');
  await page.locator('#artwork-format').selectOption('PDF');
  assert.equal(await page.locator('#artwork-download').textContent(),'Export as PDF');
  await page.locator('#artwork-download').click();
  await page.waitForFunction(()=>/card\.pdf/.test(document.querySelector('#artwork-status')?.textContent||''),null,{timeout:20000});
  const pdf=await fs.readFile(target);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.match(pdf.toString('latin1'),/\/MediaBox \[0 0 75(\.\d+)? 60(\.\d+)?\]/,'one page at the artwork size (100×80 px = 75×60 pt)');assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1,'single page');assert.match(pdf.toString('latin1'),/\/Title \(Card\)/,'PDF title is the export name, not the HTML');
  // Cancelling the save dialog writes nothing and shows no error.
  await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true})});
  await page.locator('#artwork-format').selectOption('SVG');await page.locator('#artwork-download').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#artwork-status').textContent(),'');
  console.log('PASS export 0.5×/4× PNG, PDF and native save dialog with success toast');
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
