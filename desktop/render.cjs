const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
const {BrowserWindow,dialog,app}=require('electron');
function renderOptions(options){
 if(!options||typeof options.html!=='string'||Buffer.byteLength(options.html)>20*1024*1024)throw Error('Export HTML must be under 20 MB');
 const width=Number(options.width),height=Number(options.height),scale=Number(options.scale??1);
 if(![width,height,scale].every(Number.isFinite)||width<1||height<1||scale<0.1||scale>4||width>10000||height>10000||width*height*scale*scale>32e6)throw Error('Export dimensions exceed 32 megapixels or supported scale (0.1–4×)');
 const fonts=Array.isArray(options.fonts)?options.fonts.slice(0,40):null;
 return {html:options.html,width:Math.ceil(width),height:Math.ceil(height),scale,fonts,measure:options.measure!==false};
}

// ---------------------------------------------------------------------------------------------
// Web fonts. The capture page runs under `font-src data:`, so every family the HTML uses is
// downloaded once into the font cache (integrations/fonts.mjs) and injected as embedded
// @font-face rules. Families that cannot be loaded are reported back as `fonts.missing`.
let fontsModule=null;
const loadFonts=()=>fontsModule||(fontsModule=import(pathToFileURL(path.join(__dirname,'../integrations/fonts.mjs')).href));
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#0*39;|&#x0*27;|&apos;/gi,"'").replace(/&amp;/g,'&');
/** [{family, weights, styles}] for every font-family declared in inline styles / style blocks. */
function familiesFromHtml(html,splitFontStack){
 const source=String(html),byFamily=new Map();
 // Attribute values are matched before entity decoding (font names arrive as &quot;Name&quot;).
 const declarations=[...source.matchAll(/style\s*=\s*"([^"]*)"/gi),...source.matchAll(/style\s*=\s*'([^']*)'/gi)].map(m=>decode(m[1]));
 for(const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))declarations.push(...m[1].split('}'));
 for(const block of declarations){
  const family=/font-family\s*:\s*([^;}]+)/i.exec(block);if(!family)continue;
  const weight=/font-weight\s*:\s*(\d{3}|bold|normal)/i.exec(block)?.[1],style=/font-style\s*:\s*italic/i.test(block)?'italic':'normal';
  const first=splitFontStack(family[1])[0];if(!first)continue;
  const key=first.toLowerCase(),entry=byFamily.get(key)||{family:first,weights:new Set([400]),styles:new Set(['normal'])};
  entry.weights.add(weight==='bold'?700:weight==='normal'||!weight?400:Number(weight));entry.styles.add(style);byFamily.set(key,entry);
 }
 for(const m of decode(source).matchAll(/font-weight\s*:\s*(\d{3}|bold)/gi))for(const entry of byFamily.values())entry.weights.add(m[1]==='bold'?700:Number(m[1]));
 return [...byFamily.values()].slice(0,40).map(e=>({family:e.family,weights:[...e.weights].sort((a,b)=>a-b),styles:[...e.styles]}));
}
async function embedFonts(html,families){
 try{
  const fonts=await loadFonts();
  const wanted=(families||familiesFromHtml(html,fonts.splitFontStack)).filter(f=>f&&typeof f.family==='string');
  const loadable=wanted.filter(f=>!fonts.isGenericFamily(f.family));
  if(!loadable.length)return {css:'',loaded:0,missing:[]};
  const ensured=await fonts.ensureFonts(loadable);
  const face=await fonts.fontFaceCss(loadable,{embed:true});
  const missing=[...ensured.missing,...face.missing].map(m=>({family:m.family,...(m.weight?{weight:m.weight}:{}),reason:m.reason||'not loaded'}));
  return {css:face.css,loaded:face.faces.length,missing:[...new Map(missing.map(m=>[m.family+'|'+(m.weight||''),m])).values()].slice(0,40)};
 }catch(error){return {css:'',loaded:0,missing:[{family:'*',reason:'font loader failed: '+(error?.message||error)}]};}
}

// Per-element layout boxes of the rendered page ([data-id] elements), in CSS px of the page
// (zoom factor divided out). Text elements also report scroll/client sizes for overflow checks.
const MEASURE=`(()=>{const out={};let n=0;for(const el of document.querySelectorAll('[data-id]')){if(++n>5000)break;const r=el.getBoundingClientRect();const b={x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height};if(el.dataset.designType==='text'){b.scrollWidth=el.scrollWidth;b.scrollHeight=el.scrollHeight;b.clientWidth=el.clientWidth;b.clientHeight=el.clientHeight;}out[el.dataset.id]=b;}return out;})()`;

// Offscreen rasterizer shared by the export handler and the MCP bridge's take_screenshot.
// Renders are serialized so concurrent callers never share a capture window.
let renderQueue=Promise.resolve();
function renderHTML(input,parent=null){const options=renderOptions(input);const run=()=>renderNow(options,parent);const result=renderQueue.then(run,run);renderQueue=result.catch(()=>{});return result;}
async function renderNow({html,width,height,scale,fonts:families,measure},parent){
  const outputWidth=Math.ceil(width*scale),outputHeight=Math.ceil(height*scale);
  const fonts=await embedFonts(html,families);
  const window=new BrowserWindow({show:false,useContentSize:true,width:outputWidth,height:outputHeight,transparent:true,frame:false,webPreferences:{partition:'render-'+Date.now(),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const close=()=>{if(!window.isDestroyed())window.destroy();};parent?.once('closed',close);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  window.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
  const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:">';
  try{
   window.webContents.setZoomFactor(scale);
   await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(csp+html));
   // Inserted after load so large embedded fonts never inflate the navigation URL.
   if(fonts.css)await window.webContents.insertCSS(fonts.css);
   await window.webContents.executeJavaScript(`Promise.race([Promise.all([document.body&&document.body.offsetHeight,...[...document.fonts].map(face=>face.load().catch(()=>{}))]).then(()=>Promise.all([document.fonts.ready,...[...document.images].map(image=>image.decode().catch(()=>{}))])).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),new Promise(resolve=>setTimeout(resolve,4000))])`);
   const boxes=measure?await window.webContents.executeJavaScript(MEASURE).catch(()=>null):null;
   const image=await window.webContents.capturePage({x:0,y:0,width:outputWidth,height:outputHeight},{stayHidden:true,stayAwake:true});
   return {dataURL:image.resize({width:outputWidth,height:outputHeight,quality:'best'}).toDataURL(),width:outputWidth,height:outputHeight,...(boxes&&Object.keys(boxes).length?{boxes}:{}),fonts:{loaded:fonts.loaded,missing:fonts.missing}};
  }finally{close();parent?.removeListener('closed',close);}
}
function registerRendering(handle,parent){let active=false;registerArtworkExport(handle,parent);
 handle('renderDesign',async input=>{if(active)throw Error('An export is already rendering');renderOptions(input);active=true;try{return await renderHTML(input,parent)}finally{active=false}});
 // Editor canvas fonts: the renderer asks for embedded @font-face CSS for the families a document uses.
 handle('fontFaces',async families=>{
  if(!Array.isArray(families))throw Error('Expected a list of font families');
  const list=families.slice(0,40).filter(f=>f&&typeof f.family==='string'&&f.family.length<=120).map(f=>({family:f.family,weights:(Array.isArray(f.weights)?f.weights:[400]).filter(Number.isFinite).slice(0,9),styles:(Array.isArray(f.styles)?f.styles:['normal']).filter(s=>s==='normal'||s==='italic')}));
  const fonts=await embedFonts('',list);
  return {css:fonts.css,loaded:fonts.loaded,missing:fonts.missing};
 });
}

// ---------------------------------------------------------------------------------------------
// Artwork export (inspector Export section): vector PDF of the selection, native save dialog and the
// font catalog for the font family picker.
const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:">';
async function renderPDF(input,parent=null){
 const {html,width,height}=renderOptions({...input,scale:1});
 const fonts=await embedFonts(html,null);
 const window=new BrowserWindow({show:false,width,height,webPreferences:{partition:'pdf-'+Date.now(),sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
 const close=()=>{if(!window.isDestroyed())window.destroy();};parent?.once('closed',close);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
 try{
  // One page exactly the artwork size (CSS px → inches at 96 dpi), no margins.
  const title=String(input.title||'Export').replace(/[<>&]/g,'').slice(0,120);
  const page=`<title>${title}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}</style>`;
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(csp+page+html));
  if(fonts.css)await window.webContents.insertCSS(fonts.css);
  const pdf=await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{marginType:'none'},pageSize:{width:width/96,height:height/96}});
  return {dataURL:'data:application/pdf;base64,'+pdf.toString('base64'),width,height,bytes:pdf.length,fonts:{loaded:fonts.loaded,missing:fonts.missing}};
 }finally{close();parent?.removeListener('closed',close);}
}
const EXPORT_TYPES={png:['PNG image','image/png'],jpg:['JPEG image','image/jpeg'],webp:['WebP image','image/webp'],svg:['SVG image','image/svg+xml'],pdf:['PDF document','application/pdf'],html:['HTML document','text/html'],css:['CSS stylesheet','text/css']};
/** Validate a save request: {name, data: data URL or text, extension}. */
function saveRequest(options){
 if(!options||typeof options.name!=='string'||typeof options.data!=='string')throw Error('Invalid export');
 const extension=String(options.extension||'').toLowerCase();if(!EXPORT_TYPES[extension])throw Error('Unsupported export format');
 const base=options.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/^[.\s-]+/,'').slice(0,120)||'export';
 let bytes;const data=/^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(options.data);
 if(data)bytes=Buffer.from(data[2],'base64');else if(options.data.startsWith('data:'))throw Error('Unsupported data URL');else bytes=Buffer.from(options.data,'utf8');
 if(bytes.length>200*1024*1024)throw Error('Export exceeds 200 MB');
 return {name:base.toLowerCase().endsWith('.'+extension)?base:base+'.'+extension,extension,bytes};
}
let catalogPromise=null;
function registerArtworkExport(handle,parent){
 handle('renderPDF',input=>renderPDF(input,parent));
 handle('saveExport',async options=>{
  const {name,extension,bytes}=saveRequest(options);
  const result=await dialog.showSaveDialog(parent,{title:'Export',defaultPath:path.join(app.getPath('downloads'),name),filters:[{name:EXPORT_TYPES[extension][0],extensions:[extension]}]});
  if(result.canceled||!result.filePath)return null;
  await fs.writeFile(result.filePath,bytes);
  return {path:result.filePath,name:path.basename(result.filePath),bytes:bytes.length};
 });
 handle('fontCatalog',async()=>{
  catalogPromise??=loadFonts().then(f=>f.fontCatalog()).catch(()=>null);
  const result=await catalogPromise;if(!result||result.source==='bundled')catalogPromise=null;
  return result||{fonts:[],source:'none'};
 });
}
module.exports={registerRendering,registerArtworkExport,saveRequest,renderPDF,renderOptions,renderHTML,familiesFromHtml,embedFonts};
