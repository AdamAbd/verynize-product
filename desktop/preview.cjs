const {BrowserWindow, dialog} = require('electron');
const fs = require('node:fs/promises');
function localURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Enter a localhost app URL, such as http://localhost:3000');
  return url.href;
}
function snapshotDocument(region) {
 const numBrowser=v=>parseFloat(v)||0;
 const warnings=[],records=[],assets=[],seen=new Map();let count=0;
 const area=region||{x:0,y:0,width:innerWidth,height:innerHeight};
 const styleKeys=['color','backgroundColor','fontSize','fontFamily','fontWeight','textAlign','borderRadius','opacity','borderTopWidth','borderTopColor','boxShadow','lineHeight','letterSpacing','display','flexDirection','gap','paddingTop','paddingRight','paddingBottom','paddingLeft','alignItems','justifyContent','gridTemplateColumns','overflow'];
 const ignored=new Set(['SCRIPT','STYLE','LINK','IFRAME','OBJECT','EMBED','NOSCRIPT','META','HEAD']);
 function walk(el,parent=null){if(count>=500)return;if(ignored.has(el.tagName))return;const measured=el.getBoundingClientRect(),rect=el===document.body?{x:measured.x,y:measured.y,left:measured.left,top:measured.top,width:Math.max(measured.width,innerWidth),height:Math.max(measured.height,innerHeight),right:Math.max(measured.right,innerWidth),bottom:Math.max(measured.bottom,innerHeight)}:measured,css=getComputedStyle(el);if(!rect.width||!rect.height||css.display==='none'||css.visibility==='hidden'||rect.bottom<area.y||rect.top>area.y+area.height||rect.right<area.x||rect.left>area.x+area.width)return;
 const control=['INPUT','TEXTAREA','SELECT'].includes(el.tagName);const children=control?[]:[...el.children].filter(child=>!ignored.has(child.tagName));const text=control?(el.type==='password'?(el.value?'••••••':''):el.type==='file'?'':el.tagName==='SELECT'?[...el.selectedOptions].map(o=>o.textContent).join(', '):el.value):[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();const image=el.tagName==='IMG';const frame=children.length>0;const color=css.backgroundColor;const gradient=/^(linear|radial|conic)-gradient\(/.test(css.backgroundImage)?css.backgroundImage:'';if(!image&&!frame&&!text&&color==='rgba(0, 0, 0, 0)'&&!gradient)return;
 const id='captured-'+(++count),style={};for(const key of styleKeys)style[key]=css[key];let rotation=0;if(css.transform!=='none'){try{const m=new DOMMatrix(css.transform);rotation=Math.atan2(m.b,m.a)*180/Math.PI;if(Math.abs(m.a*m.d-m.b*m.c-1)>.05)warnings.push('Transformed scale/skew approximated: '+el.tagName);}catch{}}
 const width=rotation?el.offsetWidth:rect.width,height=rotation?el.offsetHeight:rect.height;const box={x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
 const item={id,parentId:parent?.id||null,type:image?'image':frame?'frame':text?'text':'rectangle',name:el.getAttribute('aria-label')||el.tagName.toLowerCase(),x:box.x-(parent?.box.x??area.x),y:box.y-(parent?.box.y??area.y),w:width,h:height,style,gradient,rotation,text:frame?'':text};records.push(item);seen.set(el,{id,box});
 if(image){const src=el.currentSrc||el.src;if(src)assets.push({id,url:src});}
 if(css.backgroundImage.includes('url('))warnings.push('CSS background image omitted: '+item.name);
 if(frame&&text){records.push({id:'captured-'+(++count),parentId:id,type:'text',name:item.name+' text',x:parseFloat(css.paddingLeft)||0,y:parseFloat(css.paddingTop)||0,w:Math.max(1,el.clientWidth),h:parseFloat(css.lineHeight)||parseFloat(css.fontSize)*1.2,style,gradient:'',rotation:0,text});}
 for(const child of children)walk(child,{id,box:{...box,x:box.x+numBrowser(css.borderLeftWidth),y:box.y+numBrowser(css.borderTopWidth)}});
 }
 walk(document.body);if(count>=500)warnings.push('Capture limited to 500 elements');warnings.push('Layout captured as fixed positioned layers; responsive rules and pseudo-elements are not reconstructed');return {records,assets,warnings,area,title:document.title};
}
const num=(value,fallback=0)=>Number.isFinite(parseFloat(value))?parseFloat(value):fallback;
async function embedImage(url,origin,budget){
 if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)){const size=Buffer.byteLength(url);if(size>2*1024*1024||budget.bytes+size>8*1024*1024)throw Error('Embedded image asset limit exceeded');budget.bytes+=size;return url;}
 const target=new URL(url);if(target.origin!==origin||target.username||target.password||!['http:','https:'].includes(target.protocol))throw Error('Only same-origin images are embedded');
 const response=await fetch(target,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Image returned '+response.status);const mime=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/gif','image/webp'].includes(mime))throw Error('Image format not supported');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.byteLength;if(size>2*1024*1024||budget.bytes+size>8*1024*1024){await response.body.cancel().catch(()=>{});throw Error('Image asset limit exceeded');}chunks.push(chunk);}budget.bytes+=size;return 'data:'+mime+';base64,'+Buffer.concat(chunks).toString('base64');
}
function captureModel(snapshot){const id='capture-page';const nodes=snapshot.records.map(item=>{const c=item.style,frame=item.type==='frame';const padding=[c.paddingTop,c.paddingRight,c.paddingBottom,c.paddingLeft].map(v=>num(v));return {id:item.id,parentId:item.parentId||'capture-region',type:item.type,name:item.name,x:item.x,y:item.y,w:Math.max(1,item.w),h:Math.max(1,item.h),color:item.type==='text'?c.color:c.backgroundColor,text:item.text||'',fontSize:num(c.fontSize,16),fontFamily:c.fontFamily,fontWeight:c.fontWeight,textAlign:c.textAlign,radius:num(c.borderRadius),opacity:num(c.opacity,1)*100,rotation:item.rotation,strokeWidth:num(c.borderTopWidth),strokeColor:c.borderTopColor,shadow:c.boxShadow==='none'?'':c.boxShadow,clipContent:['hidden','clip'].includes(c.overflow),lineHeight:num(c.lineHeight,num(c.fontSize,16)*1.2)/num(c.fontSize,16),letterSpacing:num(c.letterSpacing),layout:'free',direction:c.flexDirection,gap:num(c.gap),padding:padding[0],columns:c.gridTemplateColumns==='none'?2:c.gridTemplateColumns.split(' ').length,alignItems:c.alignItems,justifyContent:c.justifyContent,gradient:item.gradient,mask:'',animated:'',token:'',zIndex:0,...(item.src?{src:item.src}:{})};});nodes.unshift({id:'capture-region',parentId:null,type:'frame',name:'Captured region',x:0,y:0,w:snapshot.area.width,h:snapshot.area.height,color:'transparent',text:'',fontSize:16,radius:0,clipContent:true,layout:'free'});return {version:2,name:snapshot.title||'Captured app',activePage:id,pages:[{id,name:'Capture',nodes}],tokens:{}};}
function escapeHTML(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function captureHTML(snapshot,document){const draw=id=>snapshot.records.filter(n=>n.parentId===id).map(item=>{const c=item.style;const style=`position:absolute;left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;color:${c.color};background-color:${c.backgroundColor};font-size:${c.fontSize};border:${c.borderTopWidth} solid ${c.borderTopColor};box-shadow:${c.boxShadow};`;return `<div data-design-type="${item.type}" style="${escapeHTML(style)}">${escapeHTML(item.text||'')}${item.src?'<img src="'+item.src+'">':''}${draw(item.id)}</div>`}).join('');return '<!doctype html><html><body><main style="position:relative;width:'+snapshot.area.width+'px;height:'+snapshot.area.height+'px;overflow:hidden">'+draw(null)+'</main><script type="application/json" id="verynize-document">'+JSON.stringify(document).replaceAll('<','\\u003c')+'</script></body></html>';}
async function finishSnapshot(snapshot,origin,extraWarnings=[]){
 const budget={bytes:0};for(const asset of snapshot.assets.slice(0,20)){try{const src=await embedImage(asset.url,origin,budget);snapshot.records.find(n=>n.id===asset.id).src=src;}catch(error){snapshot.warnings.push(error.message);}}
 if(snapshot.assets.length>20)snapshot.warnings.push('Only the first 20 images embedded');snapshot.warnings.push(...extraWarnings);const document=captureModel(snapshot);return {html:captureHTML(snapshot,document),document,warnings:[...new Set(snapshot.warnings)],region:snapshot.area};
}
function registerPreview(handle, parent) {
  const windows = new Set();
  parent.on('closed',()=>{for(const window of windows)if(!window.isDestroyed())window.destroy();});
  handle('previewApp', async ({url,width=1200,height=800,capture=false,region=null}) => {
    const target=localURL(url);
    width=Math.max(320,Math.min(1920,Number(width)||1200));height=Math.max(320,Math.min(1400,Number(height)||800));
    if(region){if(!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.x<0||region.y<0||region.width<1||region.height<1||region.x+region.width>width||region.y+region.height>height)throw Error('Capture region must lie inside the viewport');}
    const window=new BrowserWindow({width,height,useContentSize:true,show:!capture,title:'Local app preview',webPreferences:{partition:'preview-'+Date.now(),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    windows.add(window);window.on('closed',()=>windows.delete(window));
    window.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const restrict=(event,next)=>{try{localURL(next)}catch{event.preventDefault()}};
    window.webContents.on('will-navigate',restrict);window.webContents.on('will-redirect',restrict);
    const blocked=new Set();if(capture)window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{let allow=true;try{const u=new URL(details.url);allow=['data:','blob:','about:'].includes(u.protocol)||u.origin===new URL(target).origin;}catch{allow=false;}if(!allow)blocked.add('Cross-origin resource omitted');callback({cancel:!allow});});
    try { await window.loadURL(target);if(!capture)return {opened:true};
      const snapshot=await window.webContents.executeJavaScript('('+snapshotDocument.toString()+')('+JSON.stringify(region)+')');return finishSnapshot(snapshot,new URL(target).origin,[...blocked]); }

    finally { if(capture&&!window.isDestroyed())window.destroy(); }
  });
  handle('captureLivePreview',async ({url,region=null}={})=>{
    const expected=new URL(localURL(url));
    const frame=parent.webContents.mainFrame.frames.find(candidate=>candidate.name==='verynize-live-preview');
    if(!frame||frame.parent!==parent.webContents.mainFrame)throw Error('Open the running app preview first');
    const actual=new URL(localURL(frame.url));if(actual.origin!==expected.origin)throw Error('Preview navigated to a different origin; load it explicitly before capturing');
    const viewport=await frame.executeJavaScript('({width:innerWidth,height:innerHeight})');
    if(region&&(!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.x<0||region.y<0||region.width<1||region.height<1||region.x+region.width>viewport.width||region.y+region.height>viewport.height))throw Error('Capture region must lie inside the live viewport');
    const snapshot=await frame.executeJavaScript('('+snapshotDocument.toString()+')('+JSON.stringify(region)+')');
    if(frame.url!==actual.href)throw Error('Preview navigated during capture; retry after loading completes');
    return finishSnapshot(snapshot,actual.origin);
  });
  handle('exportPDF', async html => {
    if(typeof html!=='string'||Buffer.byteLength(html)>5*1024*1024)throw Error('Design exceeds PDF size limit');
    const result=await dialog.showSaveDialog(parent,{defaultPath:'design.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(result.canceled)return false;
    const window=new BrowserWindow({show:false,webPreferences:{partition:'pdf-'+Date.now(),nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:false}});
    try {
      const locked=html.replace(/<head[^>]*>/i,'$&<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">');
      await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(locked));
      const pdf=await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});await fs.writeFile(result.filePath,pdf);return true;
    } finally {window.destroy();}
  });
}
module.exports={registerPreview,localURL,captureModel};
