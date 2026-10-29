const path=require('node:path');
const fs=require('node:fs');
const {promises:fsp}=fs;
const {pathToFileURL}=require('node:url');
const engine=()=>import(pathToFileURL(path.join(__dirname,'../integrations/design-store.mjs')).href);
class DesignFileSession {
 constructor(onChange=()=>{}){this.onChange=onChange;this.selected=null;this.watcher=null;this.timer=null;this.lastNotified=null;this.generation=0;} 
 async target(file){const suffix='.better-design.json';const base=path.basename(file);if(!base.endsWith(suffix))throw Error('Choose a .better-design.json filename');const name=base.slice(0,-suffix.length);const {DesignStore}=await engine();const store=await DesignStore.open(path.dirname(file));store.file(name);return {store,name,path:store.file(name)};}
 async open(file){const generation=++this.generation;const target=await this.target(file);const state=await target.store.read(target.name);if(generation!==this.generation)throw Error('Document switched while opening.');this.select(target,state.revision);return {path:target.path,...state};}
 select(target,revision){this.close();this.selected={...target,revision};this.lastNotified=revision;this.watcher=fs.watch(target.store.root,(_event,file)=>{if(!file||file.toString()===path.basename(target.path)){clearTimeout(this.timer);this.timer=setTimeout(()=>this.changed(),80);}});this.watcher.on('error',error=>this.onChange({path:target.path,error:error.message}));}
 async changed(){const target=this.selected;if(!target)return;try{const state=await target.store.read(target.name);if(this.selected!==target||state.revision===this.lastNotified)return;this.lastNotified=state.revision;this.onChange({path:target.path,...state});}catch(error){if(this.selected===target)this.onChange({path:target.path,error:error.message});}}
 async reload(){if(!this.selected)throw Error('No design file is open');const target=this.selected,state=await target.store.read(target.name);if(this.selected!==target)throw Error('Document switched while reloading.');target.revision=state.revision;this.lastNotified=state.revision;return {path:target.path,...state};}
 detach(){this.generation++;this.close();this.selected=null;this.lastNotified=null;}
 async save(document,saveAsPath,generation=this.generation){const {validateDocument}=await engine();validateDocument(document);let target=this.selected,expected=target?.revision;
  if(saveAsPath){target=await this.target(saveAsPath);try{expected=(await target.store.read(target.name)).revision;}catch(error){if(error.code!=='ENOENT')throw error;expected=null;}}
  if(generation!==this.generation)throw Error('Document switched while saving. Save the active document again.');
  if(!target)throw Error('Choose a destination first');
  const result=await target.store.mutate(target.name,async()=>{if(generation!==this.generation)throw Error('Document switched while saving.');let current=null;try{current=await target.store.read(target.name);}catch(error){if(error.code!=='ENOENT')throw error;}if((current?.revision??null)!==expected)throw Error('Design changed on disk. Reload the external version before saving.');return document;});
  if(generation===this.generation)this.select(target,result.revision);return {path:target.path,...result,detached:generation!==this.generation};
 }
 close(){clearTimeout(this.timer);this.watcher?.close();this.watcher=null;}
}
function registerDesignFiles(handle,parent){const {dialog}=require('electron');const files=new DesignFileSession(data=>{if(!parent.isDestroyed())parent.webContents.send('design:file-changed',data);});
 handle('designOpen',async()=>{const selected=await dialog.showOpenDialog(parent,{title:'Open Better Design document',filters:[{name:'Better Design JSON',extensions:['json']}],properties:['openFile']});if(selected.canceled)return null;return files.open(selected.filePaths[0]);});
 handle('designSave',async options=>{if(!options||typeof options!=='object')throw Error('Document required');const generation=files.generation;let destination;
  if(options.saveAs||!files.selected){const selected=await dialog.showSaveDialog(parent,{title:'Save Better Design document',defaultPath:files.selected?.path||'untitled.better-design.json',filters:[{name:'Better Design JSON',extensions:['json']}],properties:['showOverwriteConfirmation','createDirectory']});if(selected.canceled)return null;destination=selected.filePath;}
  if(generation!==files.generation)return null;return files.save(options.document,destination,generation);
 });
 handle('designDetach',()=>{files.detach();return true;});
 handle('designReload',()=>files.reload());parent.once('closed',()=>files.close());return files;
}
module.exports={DesignFileSession,registerDesignFiles};
