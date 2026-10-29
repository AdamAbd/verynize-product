const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
 if(process.platform!=='darwin')throw Error('This packaging script targets macOS');
 const root=path.resolve(__dirname,'..'),target=path.join(root,'dist','Verynize.app');
 try{await fs.access(target);if(!process.argv.includes('--replace'))throw Error('dist/Verynize.app already exists. Use --replace to rebuild this generated application.');const id=execFileSync('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw',path.join(target,'Contents/Info.plist')],{encoding:'utf8'}).trim();if(id!=='local.verynize.desktop')throw Error('Refusing to replace an unrelated application');await fs.rm(target,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(path.dirname(target),{recursive:true});
 await fs.cp(path.join(root,'node_modules/electron/dist/Electron.app'),target,{recursive:true,verbatimSymlinks:true});
 const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
 const resources=path.join(target,'Contents/Resources');
 await fs.rm(path.join(resources,'default_app.asar'),{force:true});
 for(const name of ['LICENSE','LICENSES.chromium.html'])await fs.copyFile(path.join(root,'node_modules/electron/dist',name),path.join(resources,name));
 const app=path.join(resources,'app');await fs.mkdir(app);
 for(const directory of ['desktop','web','integrations'])await fs.cp(path.join(root,directory),path.join(app,directory),{recursive:true,filter:source=>!source.endsWith('.test.mjs')});
 // Runtime node_modules: every non-dev package in package-lock.json that is installed (MCP SDK, zod,
 // Claude Agent SDK, tailwindcss for the codec, @iconify/* icon sets, @fontsource/inter, …). Nested
 // node_modules travel with their parent package; optional platform packages missing here are skipped.
 const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
 const runtime=Object.entries(lock.packages||{}).filter(([key,meta])=>/^node_modules\/(@[^/]+\/)?[^/]+$/.test(key)&&!meta.dev&&!meta.devOptional&&!meta.link).map(([key])=>key);
 for(const required of ['node_modules/tailwindcss','node_modules/@iconify/utils','node_modules/@iconify-json/lucide','node_modules/@fontsource/inter','node_modules/@modelcontextprotocol/sdk','node_modules/zod'])if(!runtime.includes(required))throw Error(`${required} must be a production dependency`);
 let shipped=0;
 for(const key of runtime){const from=path.join(root,key);try{await fs.access(from)}catch{continue}await fs.cp(from,path.join(app,key),{recursive:true,verbatimSymlinks:true,filter:source=>!/\/node_modules\/\.bin(\/|$)/.test(source)});shipped++;}
 console.error(`Shipped ${shipped} runtime packages`);
 await fs.writeFile(path.join(app,'package.json'),JSON.stringify({name:'verynize',productName:'Verynize',version,main:'desktop/main.cjs',type:'module'}));
 const plist=path.join(target,'Contents/Info.plist');
 for(const [key,value]of Object.entries({CFBundleName:'Verynize',CFBundleDisplayName:'Verynize',CFBundleIdentifier:'local.verynize.desktop',CFBundleShortVersionString:version,CFBundleVersion:version}))execFileSync('/usr/bin/plutil',['-replace',key,'-string',value,plist]);
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',target],{stdio:'pipe'});
 console.log(target);
})().catch(error=>{console.error(error.message);process.exitCode=1});
