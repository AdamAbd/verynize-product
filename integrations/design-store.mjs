import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateEffects } from './node-style.mjs';
import { paintError, eachPaintColor } from './node-style.mjs';
import { typographyError } from './node-style.mjs';
import { sizingError } from './node-style.mjs';
import { validateAliases, dropAliases } from './variables.mjs';
import { presetIds, shaderError } from './shaders.mjs';

const TYPES = new Set(['rectangle', 'text', 'frame', 'image', 'shader']);
const LIMIT = 20 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
function requireString(value, label, max=200) { if(typeof value !== 'string' || !value.trim() || value.length>max) throw new Error(`${label} must be a nonempty string of at most ${max} characters`); }
// Typed design variables (Wonder: Dimensions, Numbers, Font family, Font weight) live next to the color
// `tokens` map: `variables: {name: {type, value}}`. Layers bind a property to one with
// `bindings: {property: name}`; the property itself always holds the resolved value, so every reader that
// ignores variables still renders correctly. Keep in sync with validate() in web/app.js.
export const VARIABLE_TYPES = ['dimension', 'number', 'fontFamily', 'fontWeight'];
// Dimensions also drive size, min/max size, axis padding and each corner radius (see variables.mjs for how
// derived keys are written); a Dimension bound to line height is converted from pixels to a multiplier.
export const BINDABLE = { radius: ['dimension', 'number'], gap: ['dimension', 'number'], padding: ['dimension', 'number'], strokeWidth: ['dimension', 'number'], fontSize: ['dimension', 'number'], letterSpacing: ['dimension', 'number'], lineHeight: ['number', 'dimension'], opacity: ['number'], fontFamily: ['fontFamily'], fontWeight: ['fontWeight'], w: ['dimension'], h: ['dimension'], minW: ['dimension'], maxW: ['dimension'], minH: ['dimension'], maxH: ['dimension'], paddingX: ['dimension'], paddingY: ['dimension'], radiusTopLeft: ['dimension'], radiusTopRight: ['dimension'], radiusBottomRight: ['dimension'], radiusBottomLeft: ['dimension'] };
export const VARIABLE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
// Room asset URLs (cloud/assets.js): https (http only on loopback), no credentials, exactly
// /api/rooms/<uuid>/assets/<uuid> with an optional ?sig=<64 hex>. Mirrors roomAssetUrl() in web/app.js.
const ROOM_ASSET_PATH = /^\/api\/rooms\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isRoomAssetUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return false;
  let url; try { url = new URL(value); } catch { return false; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return url.href === value && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) && !url.username && !url.password && !url.hash && ROOM_ASSET_PATH.test(url.pathname) && /^(\?sig=[0-9a-f]{64})?$/.test(url.search);
}
const RESERVED_NAMES = ['__proto__', 'prototype', 'constructor'];
export function checkVariableValue(type, value) {
  if (type === 'dimension' || type === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e6;
  if (type === 'fontFamily') return typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[;{}<>\\]/.test(value) && !/url\s*\(/i.test(value);
  if (type === 'fontWeight') return /^(normal|bold|[1-9][0-9]{0,2}|1000)$/.test(String(value));
  return false;
}
function validateVariables(document) {
  if (document.variables === undefined) return;
  const vars = document.variables;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) throw new Error('variables must be an object');
  const entries = Object.entries(vars);
  if (entries.length > 500) throw new Error('At most 500 variables');
  for (const [name, variable] of entries) {
    if (!VARIABLE_NAME.test(name) || RESERVED_NAMES.includes(name)) throw new Error(`Invalid variable name ${JSON.stringify(name)}`);
    if (Object.hasOwn(document.tokens, name)) throw new Error(`Variable ${name} collides with a color token`);
    if (!variable || typeof variable !== 'object' || !VARIABLE_TYPES.includes(variable.type) || !checkVariableValue(variable.type, variable.value)) throw new Error(`Invalid variable ${name}`);
  }
}
function validateIcons(document) {
  if (document.icons === undefined) return;
  if (!Array.isArray(document.icons) || document.icons.length > 500) throw new Error('icons must be an array of at most 500 icons');
  const ids = new Set();
  for (const icon of document.icons) {
    if (!icon || typeof icon.id !== 'string' || !icon.id || ids.has(icon.id)) throw new Error('Icons need unique ids');
    ids.add(icon.id);
    if (typeof icon.name !== 'string' || !icon.name.trim() || icon.name.length > 100) throw new Error('Invalid icon name');
    if (typeof icon.src !== 'string' || icon.src.length > 200000 || !/^data:image\/svg\+xml;base64,/.test(icon.src)) throw new Error('Icon source must be an embedded SVG');
  }
}
// Embedded @font-face fonts from web page capture (desktop/capture-core.cjs); mirrors validate() in web/app.js.
function validateFontFaces(document) {
  if (document.fontFaces === undefined) return;
  if (!Array.isArray(document.fontFaces) || document.fontFaces.length > 40) throw new Error('fontFaces must be an array of at most 40 fonts');
  for (const f of document.fontFaces) {
    if (!f || typeof f.family !== 'string' || !/^[^;{}<>\\"]{1,100}$/.test(f.family) || !/^(normal|bold|[1-9]00( [1-9]00)?)$/.test(String(f.weight)) || !['normal', 'italic', 'oblique'].includes(f.style)) throw new Error('Invalid embedded font descriptor');
    if (typeof f.src !== 'string' || f.src.length > 3e6 || !/^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(f.src)) throw new Error('Embedded font source must be a base64 font data URL');
    if (f.unicodeRange !== undefined && (typeof f.unicodeRange !== 'string' || !/^[\w+?, -]{1,2000}$/.test(f.unicodeRange))) throw new Error('Invalid embedded font unicode-range');
  }
}
function validateBindings(bindings) {
  if (bindings === undefined) return;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('Invalid node bindings');
  for (const [key, name] of Object.entries(bindings)) if (!Object.hasOwn(BINDABLE, key) || typeof name !== 'string' || !VARIABLE_NAME.test(name)) throw new Error(`Invalid binding ${key}`);
}
export function validateDocument(document) {
  if(!document || document.version!==2 || !Array.isArray(document.pages) || !document.pages.length || document.pages.length>100) throw new Error('Expected version 2 document with 1–100 pages');
  requireString(document.name, 'Document name');
  if(!document.tokens || Array.isArray(document.tokens) || typeof document.tokens!=='object') throw new Error('tokens must be an object');
  for(const [key,value] of Object.entries(document.tokens)) { requireString(key,'Token name'); requireString(value,'Token value',1000); if(!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))throw new Error('Token values must be six- or eight-digit hex colors'); if(['__proto__','prototype','constructor'].includes(key)) throw new Error('Reserved token name'); }
  validateVariables(document);
  validateAliases(document);
  validateIcons(document);
  validateFontFaces(document);
  const ids=new Set(); let total=0;
  for(const page of document.pages) {
    requireString(page.id,'Page id'); requireString(page.name,'Page name');
    if(page.background!==undefined && (typeof page.background!=='string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(page.background))) throw new Error('Page background must be a six- or eight-digit hex colour');
    // The Page row's eye (Wonder C8): hides the page background in the editor without forgetting the colour.
    if(page.backgroundHidden!==undefined && page.backgroundHidden!==true) throw new Error('Page backgroundHidden must be true when set');
    if(ids.has(page.id)) throw new Error('Duplicate id'); ids.add(page.id);
    if(!Array.isArray(page.nodes) || page.nodes.length>5000 || (total+=page.nodes.length)>10000) throw new Error('Maximum 10000 nodes');
    const nodes=new Map();
    for(const node of page.nodes) {
      requireString(node.id,'Node id'); if(ids.has(node.id))throw new Error('Duplicate id'); ids.add(node.id); nodes.set(node.id,node);
      if(!TYPES.has(node.type))throw new Error('Unsupported node type');
      requireString(node.name,'Node name');
      for(const key of ['x','y','w','h'])if(!Number.isFinite(node[key]) || Math.abs(node[key])>1e6 || (['w','h'].includes(key)&&node[key]<1))throw new Error(`Invalid node ${key}`);
      if(node.text!==undefined && (typeof node.text!=='string'||node.text.length>1000000))throw new Error('Invalid node text');
      if(node.textRuns!==undefined&&(!Array.isArray(node.textRuns)||node.textRuns.some(r=>!r||!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>(node.text||'').length||typeof r.bold!=='boolean'||typeof r.italic!=='boolean'||(r.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(r.color))||(r.fontSize!==undefined&&(!Number.isFinite(r.fontSize)||r.fontSize<8||r.fontSize>200)))))throw new Error('Invalid text ranges');
      if(node.src && (!/^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(node.src)) && !isRoomAssetUrl(node.src))throw new Error('Image source must be an embedded image or a room asset URL');
      for(const key of ['fontSize','radius','gap','padding','columns','zIndex','rotation','opacity','strokeWidth','letterSpacing'])if(node[key]!==undefined&&!Number.isFinite(node[key]))throw new Error(`Invalid node ${key}`);
      { const te = typographyError(node); if (te) throw new Error(te); } // line height (number | 'auto') + type settings, shared with validate() in web/app.js
      if(node.preview!==undefined){const v=node.preview;if(node.type!=='frame'||node.parentId||!v||typeof v!=='object'||Array.isArray(v)||typeof v.root!=='string'||v.root.length>4096||['name','chatId','url'].some(k=>v[k]!==undefined&&(typeof v[k]!=='string'||v[k].length>4096)))throw Error('Invalid preview configuration');if(v.url){let u;try{u=new URL(v.url)}catch{throw Error('Invalid preview URL')}if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('Invalid preview URL')}}
      if(node.opacity!==undefined&&(node.opacity<0||node.opacity>100))throw Error('Invalid opacity');if(node.clipContent!==undefined&&typeof node.clipContent!=='boolean')throw Error('Invalid clipping');for(const key of ['locked','hidden','flipX','flipY','ellipse'])if(node[key]!==undefined&&typeof node[key]!=='boolean')throw new Error(`Invalid node ${key}`);
      if(node.type==='shader'||node.shaderFill===true){if(!presetIds.includes(node.shaderPreset||'aurora'))throw new Error('Invalid shader preset');for(const [key,max] of [['shaderSpeed',5],['shaderIntensity',2]])if(node[key]!==undefined&&(!Number.isFinite(node[key])||node[key]<0||node[key]>max))throw new Error('Invalid shader uniform '+key);}
      if(node.animated!==undefined&&!['','aurora','sunset','ocean'].includes(node.animated))throw new Error('Invalid animated palette');
      if(node.layout!==undefined&&!['free','flex','grid','block','inline'].includes(node.layout))throw new Error('Invalid node layout');
      if(node.fontWeight!==undefined&&!/^(normal|bold|[1-9][0-9]{0,2}|1000)$/.test(String(node.fontWeight)))throw new Error('Invalid node fontWeight');
      if (node.svgColor !== undefined && (node.type !== 'image' || typeof node.src !== 'string' || !/^data:image\/svg\+xml;base64,/.test(node.src) || typeof node.svgColor !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(node.svgColor))) throw new Error('Invalid SVG color');
      if (node.svgColorToken !== undefined && (typeof node.svgColorToken !== 'string' || !VARIABLE_NAME.test(node.svgColorToken) || node.svgColor === undefined)) throw new Error('Invalid SVG color variable');
      validateBindings(node.bindings);
      { const sz = sizingError(node); if (sz) throw new Error(sz); } // wMode/hMode (fixed|hug|fill|auto|calc) + wCalc/hCalc, shared with validate() in web/app.js
      { const fx = validateEffects(node); if (fx) throw new Error(fx); } // structured effects, shared with validate() in web/app.js
      { const se = shaderError(node); if (se) throw new Error(se); } // shader preset/colours/sliders, shared with validate() in web/app.js
      { const pe = paintError(node); if (pe) throw new Error(pe); } // paint stack + SVG paints, shared with validate() in web/app.js
      for(const key of ['color','fontFamily','textAlign','direction','layout','token','gradient','mask','strokeColor','shadow','alignItems','justifyContent','variantClasses'])if(node[key]!==undefined&&(typeof node[key]!=='string'||node[key].length>4000))throw new Error(`Invalid node ${key}`);
    }
    for(const node of page.nodes) {
      const chain=new Set([node.id]);let parent=node.parentId;
      while(parent) { if(chain.has(parent))throw new Error('Parent cycle');chain.add(parent);const p=nodes.get(parent);if(!p||p.type!=='frame')throw new Error('Parent must reference a frame on the same page');parent=p.parentId; }
    }
  }
  if(document.views!==undefined){if(!Array.isArray(document.views)||document.views.length>100)throw Error('Invalid saved views');const ids=new Set();for(const view of document.views){requireString(view.id,'View id');requireString(view.name,'View name',100);if(ids.has(view.id)||!document.pages.some(p=>p.id===view.page)||!Number.isFinite(view.zoom)||view.zoom<.05||view.zoom>32||!['scrollLeft','scrollTop'].every(k=>Number.isFinite(view[k])&&view[k]>=0&&view[k]<=1e7)||!['x','y'].every(k=>view[k]===undefined||(Number.isFinite(view[k])&&Math.abs(view[k])<=1e7)))throw Error('Invalid saved view');ids.add(view.id);}}
  if(document.activePage && !document.pages.some(p=>p.id===document.activePage)) throw new Error('Invalid active page');
  if(Buffer.byteLength(JSON.stringify(document))>LIMIT)throw new Error('Document exceeds 20 MiB');
  return document;
}
export function applyOperations(document, operations) {
  const d=clone(document);
  if(!Array.isArray(operations)||!operations.length||operations.length>500)throw new Error('Provide 1–500 operations');
  for(const op of operations) {
    const page=op.pageId?d.pages.find(p=>p.id===op.pageId):null;
    if(op.pageId&&!page)throw new Error('Page not found');
    switch(op.type) {
      case 'create_page': d.pages.push({id:op.id||randomUUID(),name:op.name,nodes:[]});break;
      case 'rename_page':page.name=op.name;break;
      case 'delete_page':if(d.views)d.views=d.views.filter(v=>v.page!==op.pageId);d.pages=d.pages.filter(p=>p.id!==op.pageId);if(d.activePage===op.pageId)d.activePage=d.pages[0]?.id;break;
      case 'create_node':page.nodes.push({id:randomUUID(),type:'rectangle',name:'Rectangle',x:0,y:0,w:200,h:120,color:'#8b7cf8',text:'',fontSize:24,radius:0,parentId:null,...clone(op.node)});break;
      case 'update_node': {const node=page.nodes.find(n=>n.id===op.nodeId);if(!node)throw new Error('Node not found');if('id' in op.properties)throw new Error('Node id cannot be changed');if('text' in op.properties&&!('textRuns' in op.properties))node.textRuns=[];Object.assign(node,clone(op.properties));break;}
      case 'delete_node': {if(!page.nodes.some(n=>n.id===op.nodeId))throw new Error('Node not found');const removed=new Set([op.nodeId]);let changed=true;while(changed){changed=false;for(const n of page.nodes)if(removed.has(n.parentId)&&!removed.has(n.id)){removed.add(n.id);changed=true;}}page.nodes=page.nodes.filter(n=>!removed.has(n.id));break;}
      case 'set_token': if(['__proto__','prototype','constructor'].includes(op.name))throw new Error('Reserved token name');d.tokens[op.name]=op.value;break;
      case 'set_variable': if(RESERVED_NAMES.includes(op.name))throw new Error('Reserved token name');if(Object.hasOwn(d.tokens,op.name))throw new Error(`${op.name} is a color token`);{const value=op.variableType==='dimension'||op.variableType==='number'?Number(op.value):String(op.value);if(!checkVariableValue(op.variableType,value))throw new Error(`Invalid ${op.variableType} value for ${op.name}`);d.variables={...d.variables,[op.name]:{type:op.variableType,value}};}break;
      case 'delete_token': {const color=Object.hasOwn(d.tokens,op.name),typed=Object.hasOwn(d.variables||{},op.name);if(!color&&!typed)throw new Error(`Token ${op.name} does not exist`);dropAliases(d,op.name);for(const p of d.pages)for(const n of p.nodes){if(color){if(n.token===op.name){n.color=d.tokens[op.name];n.token='';}if(n.svgColorToken===op.name){n.svgColor=d.tokens[op.name];delete n.svgColorToken;}eachPaintColor(n,c=>{if(c.token===op.name){c.color=d.tokens[op.name];delete c.token;}});}if(typed&&n.bindings){for(const [k,v] of Object.entries(n.bindings))if(v===op.name)delete n.bindings[k];if(!Object.keys(n.bindings).length)delete n.bindings;}}if(color)delete d.tokens[op.name];else{delete d.variables[op.name];if(!Object.keys(d.variables).length)delete d.variables;}break;}
      case 'rename_document':d.name=op.name;break;
      default:throw new Error('Unknown operation');
    }
  }
  for(const page of d.pages)for(const node of page.nodes)if(node.fontWeight!==undefined)node.fontWeight=String(node.fontWeight);
  return validateDocument(d);
}
const revision = bytes => createHash('sha256').update(bytes).digest('hex');
export class DesignStore {
  constructor(root) { this.root=root; }
  static async open(root) { if(!root)throw new Error('Explicit existing document root required');const real=await fs.realpath(root);if(!(await fs.stat(real)).isDirectory())throw new Error('Document root must be a directory');return new DesignStore(real); }
  file(name) { if(typeof name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name))throw new Error('Document name must contain only letters, numbers, hyphen or underscore');return path.join(this.root,name+'.verynize.json'); }
  async list(){return (await fs.readdir(this.root,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.verynize.json')).map(e=>e.name.slice(0,-'.verynize.json'.length)).sort();}
  async read(name){const file=this.file(name);const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw new Error('Not a regular document or exceeds 20 MiB');const bytes=await fs.readFile(file,'utf8');return {document:validateDocument(JSON.parse(bytes)),revision:revision(bytes)};}
  async mutate(name,fn){const file=this.file(name),lock=file+'.lock';const handle=await fs.open(lock,'wx',0o600).catch(()=>{throw new Error('Document is locked; another writer may be active')});let temp;try{const document=await fn();validateDocument(document);const bytes=JSON.stringify(document,null,2)+'\n';temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,file);return {document,revision:revision(bytes)};}finally{if(temp)await fs.unlink(temp).catch(()=>{});await handle.close();await fs.unlink(lock).catch(()=>{});}}
  async create(name,title){return this.mutate(name,async()=>{try{await fs.lstat(this.file(name));throw new Error('Document already exists');}catch(e){if(e.code!=='ENOENT')throw e;}return {version:2,name:title,pages:[{id:randomUUID(),name:'Page 1',nodes:[]}],tokens:{}};});}
  async update(name,expectedRevision,operations){return this.mutate(name,async()=>{const current=await this.read(name);if(current.revision!==expectedRevision)throw new Error('Revision conflict; read the document again before editing');return applyOperations(current.document,operations);});}
}
