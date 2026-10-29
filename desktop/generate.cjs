const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {execFile}=require('node:child_process');const exec=require('node:util').promisify(execFile);const agents=require('./agents.cjs');
function registerGeneration(handle,parent){let active=null;
 parent.on('closed',()=>active?.cancel());
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
 handle('cancelGeneration',()=>{active?.cancel();return true;});
}
module.exports={registerGeneration};
