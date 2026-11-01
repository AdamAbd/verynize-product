const {onWindowClosed}=require('./window-cleanup.cjs');
const { app, BrowserWindow, session, dialog, Notification, shell, screen, protocol, net } = require('electron');
const path = require('node:path');
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
// The editor is served from app://verynize/ (desktop/app-protocol.cjs), not file://: IPC trust is
// origin-based, so client-side routes (app://verynize/editor) keep working.
const appProtocol=require('./app-protocol.cjs');
appProtocol.registerSchemes(protocol); // must run before app ready
let primaryRuntime=null,repositories=null,behaviorStore=null,agentStores=null;const liveRuntimes=new Set(); // agent runtime of the latest editor window (serves ask_agent)
app.setName('Verynize');
require('./app-preferences.cjs').attachDeepLinks(app); // verynize:// design links (Settings › Preferences › Advanced)
app.whenReady().then(async () => {
  appProtocol.registerHandler(protocol, net);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  require('./cloud-defaults.cjs').guardProduction(session.defaultSession); // automated runs never reach the production cloud
  const storageMigration=require('./storage-migration.cjs');const migration=await storageMigration.migrateStorage({app,BrowserWindow}); // one-time file:// → app://verynize localStorage/IndexedDB copy; applies staged old-build edits
  // Design preferences: one file shared by the agent persona (agent-runtime.cjs) and the MCP tools.
  if(!process.env.VERYNIZE_PREFERENCES)process.env.VERYNIZE_PREFERENCES=path.join(app.getPath('userData'),'design-preferences.json');
  // ask_agent MCP tool: nested read-only helper run on the most recent window's agent runtime.
  const askAgent=options=>{if(!primaryRuntime)return Promise.reject(Error('The agent runtime is not ready'));return primaryRuntime.askTool(options||{});}; // gated by Settings › Agents › Access
  behaviorStore=new agentBehavior.AgentBehaviorStore({file:path.join(app.getPath('userData'),'agent-behavior.json')});
  const behaviorFolder=async()=>agentBehavior.folderOf(await behaviorStore.get());
  repositories=new RepositoryRegistry({file:path.join(app.getPath('userData'),'repositories.json'),workspacesRoot:async()=>agentBehavior.workspacesOf(await behaviorStore.get()),branchPrefix:async()=>agentBehavior.resolveBranchPrefix(await behaviorStore.get())});
  // Named accounts, Verynize MCP servers/permission defaults and per-chat autonomy: one store each for all windows.
  agentStores={profiles:new (require('./agent-profiles.cjs').AgentProfiles)({userData:app.getPath('userData')}),tools:new (require('./agent-tool-config.cjs').AgentToolConfig)({userData:app.getPath('userData')}),autonomy:new (require('./agent-autonomy.cjs').AgentAutonomy)({userData:app.getPath('userData')})};
  mcpBridge.startBridge(app,{askAgent}).catch(error=>console.error('MCP bridge failed to start:',error)); // agent-bridge hook
  // Editor windows only: the storage probe's hidden window must not count as an open editor on macOS activate.
  const editorWindows = new Set();
  const createWindow = () => {
    // Keep normal/restored bounds inside the display; an oversized initial window is clamped
    // by macOS but retains off-screen restore bounds, making zoom/resize inconsistent.
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1440, workArea.width), height = Math.min(950, workArea.height);
    const win = new BrowserWindow({...process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:12,y:13}}:{},x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2), width, height, minWidth: Math.min(900, workArea.width), minHeight: Math.min(600, workArea.height), backgroundColor: '#141416', webPreferences: {preload:path.join(__dirname,'preload.cjs'),nodeIntegration: false, contextIsolation: true, sandbox: true}});
    let project=null,agentRuntime=null;const agentsBusy=()=>agentRuntime?.active()>0;
    const current=()=>{if(!project)throw Error('Open a project folder first');return project;};
    const handle=(name,fn)=>win.webContents.ipc.handle('desktop:'+name,(event,...args)=>{
      if(!appProtocol.isTrustedSender(event,win))throw Error('Untrusted IPC sender');return fn(...args);
    });
    registerPreview(handle,win);
    const designFiles=registerDesignFiles(handle,win);
    mcpBridge.registerWindow(win,{designFiles,trusted:event=>appProtocol.isTrustedSender(event,win)}); // agent-bridge hook
    registerGeneration(handle,win);
    registerFigma(handle,win);
    require('./figma-oauth.cjs').registerFigmaOAuth(handle,win); // Figma account (OAuth PKCE, safeStorage tokens)
    registerRendering(handle,win);
    require('./html-import.cjs').registerHtmlImport(handle,win); // Import HTML: codec-html importer (stylesheets, cascade, viewport, :root variables)
    registerAgentAuth(handle,win,{profiles:agentStores.profiles});
    // Settings › Preferences (desktop/app-preferences.cjs): soundChoose/soundRead/soundClear, linksReady/linksSetEnabled, worktreeLineStats.
    require('./app-preferences.cjs').registerAppPreferences(handle,win,{app,dialog,registry:repositories,userData:app.getPath('userData')});
    // Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs): agentUsage, agentLayerUsage, agentMemory*.
    const agentUsage=require('./agent-usage.cjs').registerAgentUsage(handle,{userData:app.getPath('userData'),profiles:agentStores.profiles});
    // Settings › Accounts / Tools and the chat Autonomy panel: agentProfiles*, agentToolConfig*, agentAutonomy{Get,Set}.
    require('./agent-profiles.cjs').registerAgentProfiles(handle,{store:agentStores.profiles,usage:agentUsage});
    require('./agent-tool-config.cjs').registerAgentToolConfig(handle,{store:agentStores.tools});
    require('./agent-autonomy.cjs').registerAgentAutonomy(handle,{store:agentStores.autonomy});
    require('./agent-memory.cjs').registerAgentMemory(handle,{userData:app.getPath('userData'),shell});
    // First-run onboarding (web/src/islands/onboarding): automated runs skip it with VERYNIZE_SKIP_ONBOARDING=1.
    handle('onboardingState',()=>({skip:process.env.VERYNIZE_SKIP_ONBOARDING==='1'}));
    require('./cloud-defaults.cjs').registerCloudDefaults(handle); // Share panel server default: production or VERYNIZE_CLOUD_SERVER
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
    // Changes panel (desktop/git-changes.cjs): gitChanges, gitBranchChanges, gitDiff, gitCommit, gitDiscard, gitPush, gitPullRequest, gitCreatePullRequest.
    registerGitChanges(handle,{getProject:()=>project});
    require('./app-publish.cjs').registerAppPublish(handle,{getProject:()=>project}); // Share › Publish app: cloudAppDetect, cloudAppPublish
    require('./cloud-passkey.cjs').registerCloudPasskey(handle,win); // Share › Account passkeys: cloudPasskeyOpen, cloudPasskeyClose
    handle('readMemory',()=>current().memory());handle('writeMemory',text=>current().write('VERYNIZE.md',text));
    handle('discoverAgents',()=>agents.discover());
    // --- agent chat runtime (desktop/agent-runtime.cjs): runAgent, cancelAgent, respondAgentPermission, listAgentModels, saveAgentImage ---
    // --- also: respondAgentQuestion, steerAgent, listAgentRuns, listAllowRules, removeAllowRule, agentToolsVersion, agentTitle, designPreferences*, designStylesList ---
    agentRuntime=registerAgentRuntime(handle,win,{userData:app.getPath('userData'),getProject:()=>project,resolveProject:async root=>{const resolved=await repositories.resolveRoot(root);const opened=await Project.open(resolved.root);opened.repositoryRoot=resolved.repository.root;return opened;},getBehavior:()=>behaviorStore.get(),...agentStores});
    const windowRuntime=agentRuntime;liveRuntimes.add(windowRuntime);onWindowClosed(win,()=>liveRuntimes.delete(windowRuntime));
    // Global search and history-preserving moves (desktop/project-search.cjs, desktop/repository-moves.cjs): projectSearch*, repositoryMove*, repositoryRelocate.
    require('./project-search.cjs').registerProjectSearch(handle,{registry:repositories,shell});
    require('./template-packs.cjs').registerTemplatePacks(handle); // Templates gallery: .zip packs (templatePackEncode/Decode)
    require('./repository-moves.cjs').registerRepositoryMoves(handle,{registry:repositories,dialog,win,busy:async root=>{const data=await repositories.load();const repo=data.repositories.find(r=>r.root===root);const roots=[root,...(repo?data.worktrees.filter(w=>w.repoId===repo.id).map(w=>w.path):[])];return [...liveRuntimes].some(rt=>[...rt.runs.values()].some(r=>roots.some(x=>r.cwd===x||String(r.cwd).startsWith(x+path.sep))));}});
    agentBehavior.registerAgentBehavior(handle,win,{store:behaviorStore,registry:repositories,dialog,shell,getRuntime:()=>agentRuntime,userData:app.getPath('userData')});
    primaryRuntime=agentRuntime;onWindowClosed(win,()=>{if(primaryRuntime===agentRuntime)primaryRuntime=null;});
    // Settings › Agents (desktop/agent-tools.cjs): agentProviderAccounts, agentMcp{List,Add,Remove,Login}, agentAccess{Get,Set}
    require('./agent-tools.cjs').registerAgentTools(handle,win,{userData:app.getPath('userData'),getRuntime:()=>agentRuntime});
    // Chat composer "+" menu and slash commands: listAgentCommands (desktop/agent-commands.cjs); designReferences*, worktreeAddFiles, pickWorkingDirectory (desktop/chat-attachments.cjs).
    require('./agent-commands.cjs').registerAgentCommands(handle,{getRuntime:()=>agentRuntime});
    require('./chat-attachments.cjs').registerChatAttachments(handle,win,{userData:app.getPath('userData'),dialog,resolveRoot:root=>repositories.resolveRoot(root)});
    // Composer indicators (desktop/agent-live-status.cjs): agentLiveMcpStatus, agentLiveContext.
    require('./agent-live-status.cjs').registerAgentLiveStatus(handle,{getRuntime:()=>agentRuntime});
    // --- agent shell (desktop/agent-shell.cjs): open project for the dev server / terminal MCP tools ---
    require('./agent-shell.cjs').registerShellWindow(win,{getProject:()=>project});
    require('./agent-shell.cjs').registerDevServerIPC(handle,{getProject:()=>project,resolveRoot:root=>repositories.resolveRoot(root)}); // devServerStatus/Start/Stop for the Start preview button
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
    // Same-origin navigations (a client-side route reloaded as app://verynize/editor) are allowed; anything else is blocked.
    win.webContents.on('will-navigate', (event, url) => { if(!appProtocol.isAppURL(url)) event.preventDefault(); });
    win.webContents.on('will-redirect', (event, url) => { if(!appProtocol.isAppURL(url)) event.preventDefault(); });
    win.loadURL(appProtocol.ENTRY_URL);
    editorWindows.add(win); win.on('closed', () => editorWindows.delete(win));
    return win;
  };
  storageMigration.probeAfterLaunch({app,BrowserWindow,editor:createWindow(),startup:migration}); // background check for old-build (file://) edits, staged for the next launch
  app.on('activate', () => { if (!editorWindows.size) createWindow(); });
});
app.on('will-quit',()=>mcpBridge.stopBridge()); // agent-bridge hook
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
