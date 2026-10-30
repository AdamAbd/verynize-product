const {onWindowClosed}=require('./window-cleanup.cjs');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {execFile}=require('node:child_process');const {app,safeStorage}=require('electron');const {pathToFileURL}=require('node:url');const exec=require('node:util').promisify(execFile);const agents=require('./agents.cjs');
function registerGeneration(handle,parent){let active=null;
 onWindowClosed(parent,()=>active?.cancel());
 handle('generateVector',async options=>{
  if(active)throw Error('A vector is already being generated');
  if(!options||!['claude','codex'].includes(options.agent)||typeof options.prompt!=='string'||!options.prompt.trim()||options.prompt.length>4000)throw Error('Choose an agent and a prompt under 4000 characters');
  const provider=(await agents.discover()).find(a=>a.id===options.agent&&a.available);if(!provider)throw Error('Selected agent CLI is not installed');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'better-vector-'));
  try{
   await exec('git',['init',root]);
   const svg=await new Promise((resolve,reject)=>{
    let output='',done=false,timer;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    active=agents.start(provider.path,provider.id,'Create one original standalone SVG illustration for the following request. Return only the SVG markup, starting with <svg and ending with </svg>. Use a viewBox of 0 0 512 512. Use vector shapes, paths and text only. No external references, images, scripts, foreignObject, event handlers, or tools. Do not read or change any files. Request: '+options.prompt,root,event=>{
     if(event.type==='stdout'){output+=event.text;if(output.length>2*1024*1024){active?.cancel();finish(Error('Generated SVG exceeded 2 MB'));}}
     if(event.type==='error')finish(Error(event.text));
     if(event.type==='exit'){if(event.code!==0){finish(Error('Agent generation failed; check CLI account and permissions'));return;}const match=output.match(/<svg\b[\s\S]*?<\/svg>/i);if(!match)finish(Error('Agent did not return SVG; try a more specific illustration prompt'));else finish(null,match[0]);}
    });timer=setTimeout(()=>{active?.cancel();finish(Error('Vector generation timed out'));},90000);
   });return {svg};
  }finally{active=null;await fs.rm(root,{recursive:true,force:true});}
 });
 handle('cancelGeneration',()=>{active?.cancel();imageAbort?.abort();return true;});
 // Photographic image providers (integrations/image-provider.mjs). Settings live in
 // userData/image-provider.json; the API key is stored only as safeStorage ciphertext (macOS Keychain
 // backed). When OS encryption is unavailable the key is kept in memory for this session and never
 // written. The key is never returned to the renderer, logged, or included in error messages.
 const settingsFile=()=>path.join(app.getPath('userData'),'image-provider.json');
 let sessionKey='',imageAbort=null;
 const loadProvider=()=>import(pathToFileURL(path.join(__dirname,'../integrations/image-provider.mjs')).href);
 async function readSettings(){try{return JSON.parse(await fs.readFile(settingsFile(),'utf8'));}catch{return {};}}
 function storedKey(saved){if(saved.key&&safeStorage.isEncryptionAvailable()){try{return safeStorage.decryptString(Buffer.from(saved.key,'base64'));}catch{return '';}}return sessionKey;}
 async function publicSettings(){const provider=await loadProvider(),saved=await readSettings();let settings;try{settings=provider.normalizeSettings(saved);}catch{settings=provider.normalizeSettings({});}const secure=safeStorage.isEncryptionAvailable();const hasKey=!!storedKey(saved);return {...settings,hasKey,keyStorage:hasKey?(saved.key?'keychain':'session'):'none',secureStorage:secure,configured:!!saved.baseURL};}
 handle('imageProviderGet',()=>publicSettings());
 handle('imageProviderSet',async(options={})=>{
  if(!options||typeof options!=='object')throw Error('Provider settings are required');
  const provider=await loadProvider(),saved=await readSettings();
  const settings=provider.normalizeSettings({...saved,...Object.fromEntries(['provider','baseURL','model','size'].filter(k=>options[k]!==undefined).map(k=>[k,options[k]]))});
  const next={...settings,...(saved.key?{key:saved.key}:{})};
  if(options.clearKey){delete next.key;sessionKey='';}
  if(options.apiKey!==undefined&&options.apiKey!==''){
   if(typeof options.apiKey!=='string'||options.apiKey.length>4096||/\s/.test(options.apiKey))throw Error('Invalid API key');
   if(safeStorage.isEncryptionAvailable()){next.key=safeStorage.encryptString(options.apiKey).toString('base64');sessionKey='';}
   else{delete next.key;sessionKey=options.apiKey;}
  }
  await fs.mkdir(path.dirname(settingsFile()),{recursive:true});
  const temp=settingsFile()+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(next,null,1),{mode:0o600});await fs.rename(temp,settingsFile());
  return publicSettings();
 });
 handle('generateImage',async(options={})=>{
  if(imageAbort)throw Error('An image is already being generated');
  const provider=await loadProvider(),saved=await readSettings();
  if(!saved.baseURL&&!saved.provider)throw Error('Configure an image provider first');
  imageAbort=new AbortController();
  try{return await provider.generateImage({settings:{...saved,...(options.size?{size:options.size}:{})},apiKey:storedKey(saved),prompt:options.prompt,signal:imageAbort.signal});}
  finally{imageAbort=null;}
 });
}
module.exports={registerGeneration};
