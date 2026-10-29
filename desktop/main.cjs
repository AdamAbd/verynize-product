const { app, BrowserWindow, session, dialog, Notification, shell } = require('electron');
const path = require('node:path');
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const exec=require('node:util').promisify(execFile);
const {pathToFileURL}=require('node:url');
const {Project}=require('./projects.cjs');
const agents=require('./agents.cjs');
const {registerPreview}=require('./preview.cjs');
const {registerDesignFiles}=require('./design-files.cjs');
const {registerGeneration}=require('./generate.cjs');
const {registerFigma}=require('./figma.cjs');
const {registerRendering}=require('./render.cjs');
const {registerAgentAuth}=require('./agent-auth.cjs');
const mcpBridge=require('./mcp-bridge.cjs'); // agent-bridge hook: live MCP server (getBridgeInfo for agent runtimes)
const {registerAgentRuntime}=require('./agent-runtime.cjs'); // agent chat runtime (Claude Agent SDK / Codex app-server)
const entry=path.join(__dirname,'../web/index.html');
let primaryRuntime=null; // agent runtime of the latest editor window (serves ask_agent)
app.setName('Better Design');
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // Design preferences: one file shared by the agent persona (agent-runtime.cjs) and the MCP tools.
  if(!process.env.BETTER_DESIGN_PREFERENCES)process.env.BETTER_DESIGN_PREFERENCES=path.join(app.getPath('userData'),'design-preferences.json');
  // ask_agent MCP tool: nested read-only helper run on the most recent window's agent runtime.
  const askAgent=options=>{if(!primaryRuntime)return Promise.reject(Error('The agent runtime is not ready'));return primaryRuntime.ask(options||{});};
  mcpBridge.startBridge(app,{askAgent}).catch(error=>console.error('MCP bridge failed to start:',error)); // agent-bridge hook
  const createWindow = () => {
    const win = new BrowserWindow({...process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:12,y:13}}:{},width: 1440, height: 950, minWidth: 900, minHeight: 600, backgroundColor: '#141416', webPreferences: {preload:path.join(__dirname,'preload.cjs'),nodeIntegration: false, contextIsolation: true, sandbox: true}});
    let project=null,agentRuntime=null;const agentsBusy=()=>agentRuntime?.active()>0;
    const current=()=>{if(!project)throw Error('Open a project folder first');return project;};
    const handle=(name,fn)=>win.webContents.ipc.handle('desktop:'+name,(event,...args)=>{
      if(event.sender!==win.webContents||!event.senderFrame||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==pathToFileURL(entry).href)throw Error('Untrusted IPC sender');return fn(...args);
    });
    registerPreview(handle,win);
    const designFiles=registerDesignFiles(handle,win);
    mcpBridge.registerWindow(win,{designFiles,entryURL:pathToFileURL(entry).href}); // agent-bridge hook
    registerGeneration(handle,win);
    registerFigma(handle,win);
    registerRendering(handle,win);
    registerAgentAuth(handle,win);
    handle('openExternal',value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP and HTTPS links are supported');return shell.openExternal(url.href);});
    let lastNotification=0;
    handle('notifyTask',options=>{if(!options||typeof options.title!=='string'||typeof options.body!=='string')throw Error('Invalid notification');if(Date.now()-lastNotification<3000||!Notification.isSupported())return false;lastNotification=Date.now();new Notification({title:options.title.slice(0,120),body:options.body.slice(0,300)}).show();return true;});
    handle('openProject',async()=>{if(agentsBusy())throw Error('Stop running agents before switching projects');const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(result.canceled)return null;project=await Project.open(result.filePaths[0]);return {root:project.root,name:path.basename(project.root)};});
    handle('createProject',async options=>{
      if(agentsBusy())throw Error('Stop running agents before switching projects');
      if(!options||typeof options.name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(options.name))throw Error('Use a project name with letters, numbers, dashes, or underscores');
      if(options.repository && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(options.repository))throw Error('Use an HTTPS GitHub repository URL');
      const chosen=await dialog.showOpenDialog(win,{title:'Choose parent folder',properties:['openDirectory']});if(chosen.canceled)return null;
      const parent=await fs.realpath(chosen.filePaths[0]),destination=path.join(parent,options.name);
      try{await fs.access(destination);throw Error('That folder already exists')}catch(e){if(e.code!=='ENOENT')throw e;}
      if(options.repository)await exec('git',['clone','--',options.repository,destination],{timeout:120000,maxBuffer:2*1024*1024});
      else{await fs.mkdir(destination);await fs.writeFile(path.join(destination,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>New project</title></head><body><h1>Make something yours.</h1></body></html>');await exec('git',['init',destination]);}
      project=await Project.open(destination);return {root:project.root,name:path.basename(project.root)};
    });
    handle('listFiles',()=>current().list());handle('readFile',p=>current().read(p));handle('writeFile',(p,c)=>current().write(p,c));
    handle('gitStatus',()=>current().status());handle('createWorktree',b=>current().worktree(b));
    handle('readMemory',()=>current().memory());handle('writeMemory',text=>current().write('BETTER_DESIGN.md',text));
    handle('discoverAgents',()=>agents.discover());
    // --- agent chat runtime (desktop/agent-runtime.cjs): runAgent, cancelAgent, respondAgentPermission, listAgentModels, saveAgentImage ---
    // --- also: respondAgentQuestion, steerAgent, listAgentRuns, listAllowRules, removeAllowRule, agentToolsVersion, agentTitle, designPreferences* ---
    agentRuntime=registerAgentRuntime(handle,win,{userData:app.getPath('userData'),getProject:()=>project});
    primaryRuntime=agentRuntime;win.on('closed',()=>{if(primaryRuntime===agentRuntime)primaryRuntime=null;});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadFile(entry);
  };
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('will-quit',()=>mcpBridge.stopBridge()); // agent-bridge hook
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
