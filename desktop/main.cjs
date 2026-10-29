const { app, BrowserWindow, session, dialog, Notification, shell } = require('electron');
const path = require('node:path');
const {pathToFileURL}=require('node:url');
const {Project}=require('./projects.cjs');
const agents=require('./agents.cjs');
const {registerPreview}=require('./preview.cjs');
const {registerDesignFiles}=require('./design-files.cjs');
const {registerGeneration}=require('./generate.cjs');
const {registerFigma}=require('./figma.cjs');
const {registerRendering}=require('./render.cjs');
const {registerAgentAuth}=require('./agent-auth.cjs');
const {registerGitChanges}=require('./git-changes.cjs');
const {RepositoryRegistry,registerRepositories,createProjectFolder}=require('./repositories.cjs'); // Code workspace: repositories + per-chat worktrees
const mcpBridge=require('./mcp-bridge.cjs'); // agent-bridge hook: live MCP server (getBridgeInfo for agent runtimes)
const {registerAgentRuntime}=require('./agent-runtime.cjs'); // agent chat runtime (Claude Agent SDK / Codex app-server)
const agentBehavior=require('./agent-behavior.cjs'); // Settings › Agents: follow-ups, response style, attribution, folder, branch prefix, modes, allowed rules
const entry=path.join(__dirname,'../web/index.html');
let primaryRuntime=null,repositories=null,behaviorStore=null; // agent runtime of the latest editor window (serves ask_agent)
app.setName('Verynize');
require('./app-preferences.cjs').attachDeepLinks(app); // verynize:// design links (Settings › Preferences › Advanced)
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // Design preferences: one file shared by the agent persona (agent-runtime.cjs) and the MCP tools.
  if(!process.env.VERYNIZE_PREFERENCES)process.env.VERYNIZE_PREFERENCES=path.join(app.getPath('userData'),'design-preferences.json');
  // ask_agent MCP tool: nested read-only helper run on the most recent window's agent runtime.
  const askAgent=options=>{if(!primaryRuntime)return Promise.reject(Error('The agent runtime is not ready'));return primaryRuntime.askTool(options||{});}; // gated by Settings › Agents › Access
  behaviorStore=new agentBehavior.AgentBehaviorStore({file:path.join(app.getPath('userData'),'agent-behavior.json')});
  const behaviorFolder=async()=>agentBehavior.folderOf(await behaviorStore.get());
  repositories=new RepositoryRegistry({file:path.join(app.getPath('userData'),'repositories.json'),workspacesRoot:async()=>agentBehavior.workspacesOf(await behaviorStore.get()),branchPrefix:async()=>agentBehavior.resolveBranchPrefix(await behaviorStore.get())});
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
    // Settings › Preferences (desktop/app-preferences.cjs): soundChoose/soundRead/soundClear, linksReady/linksSetEnabled, worktreeLineStats.
    require('./app-preferences.cjs').registerAppPreferences(handle,win,{app,dialog,registry:repositories,userData:app.getPath('userData')});
    // Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs): agentUsage, agentLayerUsage, agentMemory*.
    require('./agent-usage.cjs').registerAgentUsage(handle,{userData:app.getPath('userData')});
    require('./agent-memory.cjs').registerAgentMemory(handle,{userData:app.getPath('userData'),shell});
    handle('openExternal',value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP and HTTPS links are supported');return shell.openExternal(url.href);});
    let lastNotification=0;
    handle('notifyTask',options=>{if(!options||typeof options.title!=='string'||typeof options.body!=='string')throw Error('Invalid notification');if(Date.now()-lastNotification<3000||!Notification.isSupported())return false;lastNotification=Date.now();new Notification({title:options.title.slice(0,120),body:options.body.slice(0,300)}).show();return true;});
    // Legacy single-project entry points: the chosen folder is also added to the repository list.
    handle('openProject',async()=>{if(agentsBusy())throw Error('Stop running agents before switching projects');const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(result.canceled)return null;const repo=await repositories.add(result.filePaths[0]);project=await Project.open(repo.root);return {root:project.root,name:path.basename(project.root),repoId:repo.id};});
    handle('createProject',async options=>{
      if(agentsBusy())throw Error('Stop running agents before switching projects');
      if(!options||typeof options.name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(options.name))throw Error('Use a project name with letters, numbers, dashes, or underscores');
      if(options.repository && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(options.repository))throw Error('Use an HTTPS GitHub repository URL');
      const parent=await behaviorFolder();await require('node:fs/promises').mkdir(parent,{recursive:true}); // new projects go to the Verynize folder
      const repo=await repositories.add(await createProjectFolder(parent,options));
      project=await Project.open(repo.root);return {root:project.root,name:path.basename(project.root),repoId:repo.id};
    });
    // --- Code workspace (desktop/repositories.cjs): repositories*, per-chat worktrees, setActiveRoot (repositoriesActivate) ---
    registerRepositories(handle,win,{registry:repositories,dialog,getProject:()=>project,setProject:value=>{project=value;},Project,projectsRoot:behaviorFolder});
    handle('listFiles',()=>current().list());handle('readFile',p=>current().read(p));handle('writeFile',(p,c)=>current().write(p,c));
    handle('gitStatus',()=>current().status());handle('createWorktree',async b=>current().worktree(b,{parent:path.join(agentBehavior.workspacesOf(await behaviorStore.get()),path.basename(current().root))}));
    // Changes panel (desktop/git-changes.cjs): gitChanges, gitDiff, gitCommit, gitDiscard, gitPush, gitPullRequest, gitCreatePullRequest.
    registerGitChanges(handle,{getProject:()=>project});
    handle('readMemory',()=>current().memory());handle('writeMemory',text=>current().write('VERYNIZE.md',text));
    handle('discoverAgents',()=>agents.discover());
    // --- agent chat runtime (desktop/agent-runtime.cjs): runAgent, cancelAgent, respondAgentPermission, listAgentModels, saveAgentImage ---
    // --- also: respondAgentQuestion, steerAgent, listAgentRuns, listAllowRules, removeAllowRule, agentToolsVersion, agentTitle, designPreferences* ---
    agentRuntime=registerAgentRuntime(handle,win,{userData:app.getPath('userData'),getProject:()=>project,resolveProject:async root=>Project.open((await repositories.resolveRoot(root)).root),getBehavior:()=>behaviorStore.get()});
    agentBehavior.registerAgentBehavior(handle,win,{store:behaviorStore,registry:repositories,dialog,shell,getRuntime:()=>agentRuntime,userData:app.getPath('userData')});
    primaryRuntime=agentRuntime;win.on('closed',()=>{if(primaryRuntime===agentRuntime)primaryRuntime=null;});
    // Settings › Agents (desktop/agent-tools.cjs): agentProviderAccounts, agentMcp{List,Add,Remove,Login}, agentAccess{Get,Set}
    require('./agent-tools.cjs').registerAgentTools(handle,win,{userData:app.getPath('userData'),getRuntime:()=>agentRuntime});
    // Composer indicators (desktop/agent-live-status.cjs): agentLiveMcpStatus, agentLiveContext.
    require('./agent-live-status.cjs').registerAgentLiveStatus(handle,{getRuntime:()=>agentRuntime});
    // --- agent shell (desktop/agent-shell.cjs): open project for the dev server / terminal MCP tools ---
    require('./agent-shell.cjs').registerShellWindow(win,{getProject:()=>project});
    require('./agent-shell.cjs').registerDevServerIPC(handle,{getProject:()=>project}); // devServerStatus/Start/Stop for the Start preview button
    // --- end agent shell ---
    // --- integrated terminal (desktop/terminal.cjs): terminalCreate, terminalWrite, terminalResize, terminalKill ---
    // PTY shells for the code-mode terminal panel; output arrives as desktop:terminal-data / desktop:terminal-exit.
    // The cwd guard accepts the open project (and its worktrees) or ~/Verynize/workspaces/; the repository registry
    // can install its own policy with require('./terminal.cjs').setTerminalCwdValidator(fn).
    require('./terminal.cjs').registerTerminal(handle,win,{getProject:()=>project});
    // Registered repository roots and their chat worktrees may host a terminal even when another chat is active.
    require('./terminal.cjs').setTerminalCwdValidator(async(real,{defaultAllowed})=>{if(defaultAllowed)return true;try{await repositories.resolveRoot(real);return true}catch{return false}});
    // --- end integrated terminal ---
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadFile(entry);
  };
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('will-quit',()=>mcpBridge.stopBridge()); // agent-bridge hook
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
