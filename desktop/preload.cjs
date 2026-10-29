const {contextBridge,ipcRenderer}=require('electron');
const call=(method,...args)=>ipcRenderer.invoke('desktop:'+method,...args);
contextBridge.exposeInMainWorld('desktop',{
 agentAccountStatus:options=>call('agentAccountStatus',options),startAgentLogin:options=>call('startAgentLogin',options),cancelAgentLogin:options=>call('cancelAgentLogin',options),agentLogout:options=>call('agentLogout',options),openExternal:url=>call('openExternal',url),
 onAuthEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:auth-event',listener);return()=>ipcRenderer.removeListener('desktop:auth-event',listener)},
 notifyTask:options=>call('notifyTask',options),
 // Settings › Preferences hook (desktop/app-preferences.cjs): custom chat sound, verynize:// links, worktree line counts.
 appPreferences:{chooseSound:()=>call('soundChoose'),readSound:()=>call('soundRead'),clearSound:()=>call('soundClear'),linksReady:options=>call('linksReady',options),setLinksEnabled:enabled=>call('linksSetEnabled',enabled),worktreeLineStats:roots=>call('worktreeLineStats',roots),onOpenLink:callback=>{const listener=(_event,url)=>callback(url);ipcRenderer.on('desktop:open-link',listener);return()=>ipcRenderer.removeListener('desktop:open-link',listener)}},
 // end Settings › Preferences hook
 // Settings › Usage and Memory (desktop/agent-usage.cjs, desktop/agent-memory.cjs).
 agentUsage:{read:options=>call('agentUsage',options),layers:()=>call('agentLayerUsage')},
 // Composer indicators (desktop/agent-live-status.cjs): live MCP server status and context breakdown of a chat's run.
 agentLiveStatus:{mcp:options=>call('agentLiveMcpStatus',options),context:options=>call('agentLiveContext',options)},
 agentMemory:{overview:()=>call('agentMemoryOverview'),reveal:options=>call('agentMemoryReveal',options),open:options=>call('agentMemoryOpen',options)},
 // integrated terminal hook (desktop/terminal.cjs): PTY shells for the code-mode terminal panel.
 terminalCreate:options=>call('terminalCreate',options),terminalWrite:options=>call('terminalWrite',options),terminalResize:options=>call('terminalResize',options),terminalKill:options=>call('terminalKill',options),
 onTerminalData:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:terminal-data',listener);return()=>ipcRenderer.removeListener('desktop:terminal-data',listener)},
 onTerminalExit:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:terminal-exit',listener);return()=>ipcRenderer.removeListener('desktop:terminal-exit',listener)},
 // end integrated terminal hook
 // agent-runtime parity hook: second-opinion review of the latest answer (desktop/agent-runtime.cjs review()).
 reviewAgent:options=>call('reviewAgent',options),
 // end agent-runtime parity hook
 // Settings › Agents (desktop/agent-tools.cjs): provider accounts, the agents' own MCP servers, Access switches.
 agentTools:{accounts:()=>call('agentProviderAccounts'),listServers:options=>call('agentMcpList',options),addServer:options=>call('agentMcpAdd',options),removeServer:options=>call('agentMcpRemove',options),loginServer:options=>call('agentMcpLogin',options),getAccess:()=>call('agentAccessGet'),setAccess:changes=>call('agentAccessSet',changes)},
 // agent-bridge hook: MCP tool requests from main (bd:mcp-call) and replies (bd:mcp-reply) only.
 agentBridge:{onCall:callback=>{const listener=(_event,request)=>callback(request);ipcRenderer.on('bd:mcp-call',listener);return()=>ipcRenderer.removeListener('bd:mcp-call',listener)},reply:(requestId,payload)=>ipcRenderer.send('bd:mcp-reply',String(requestId),payload)},
 // end agent-bridge hook
 renderDesign:options=>call('renderDesign',options),fontFaces:families=>call('fontFaces',families),
 // inspector export hook (desktop/render.cjs registerArtworkExport): artwork PDF, native save dialog, font catalog.
 renderPDF:options=>call('renderPDF',options),saveExport:options=>call('saveExport',options),fontCatalog:()=>call('fontCatalog'),
 // end inspector export hook
 importFigma:options=>call('importFigma',options),
 generateVector:options=>call('generateVector',options),cancelGeneration:()=>call('cancelGeneration'),
 designDetach:()=>call('designDetach'),
 designOpen:()=>call('designOpen'),designSave:options=>call('designSave',options),designReload:()=>call('designReload'),
 onDesignFileChanged:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('design:file-changed',listener);return()=>ipcRenderer.removeListener('design:file-changed',listener)},
 previewInput:options=>call('previewInput',options),
 previewOpenBrowser:()=>call('previewOpenBrowser'),
 previewNavigate:options=>call('previewNavigate',options),
 previewInspect:options=>call('previewInspect',options),
 previewEdit:options=>call('previewEdit',options),
 captureLivePreview:options=>call('captureLivePreview',options),
 previewApp:options=>call('previewApp',options),exportPDF:html=>call('exportPDF',html),
 createProject:options=>call('createProject',options),
 // Code workspace (desktop/repositories.cjs): repository list, per-chat git worktrees, active root; dev server controls.
 repositories:{list:()=>call('repositoriesList'),addLocal:()=>call('repositoriesAddLocal'),create:options=>call('repositoriesCreate',options),archive:id=>call('repositoriesArchive',id),createChatWorktree:options=>call('repositoriesCreateChatWorktree',options),removeChatWorktree:options=>call('repositoriesRemoveChatWorktree',options),activate:root=>call('repositoriesActivate',root)},
 devServer:{dismissProposal:options=>call('devServerDismissProposal',options),configure:options=>call('devServerConfigure',options),setup:options=>call('devServerSetup',options),status:options=>call('devServerStatus',options),start:options=>call('devServerStart',options),stop:options=>call('devServerStop',options)},
 openProject:()=>call('openProject'), listFiles:()=>call('listFiles'),readFile:p=>call('readFile',p),writeFile:(p,c)=>call('writeFile',p,c),gitStatus:()=>call('gitStatus'),createWorktree:b=>call('createWorktree',b),discoverAgents:()=>call('discoverAgents'),runAgent:options=>call('runAgent',options),cancelAgent:id=>call('cancelAgent',id),respondAgentPermission:options=>call('respondAgentPermission',options),respondAgentQuestion:options=>call('respondAgentQuestion',options),steerAgent:options=>call('steerAgent',options),listAgentRuns:()=>call('listAgentRuns'),listAllowRules:options=>call('listAllowRules',options),removeAllowRule:options=>call('removeAllowRule',options),agentToolsVersion:()=>call('agentToolsVersion'),agentTitle:options=>call('agentTitle',options),
 gitChanges:options=>call('gitChanges',options),gitBranchChanges:options=>call('gitBranchChanges',options),gitDiff:options=>call('gitDiff',options),gitCommit:options=>call('gitCommit',options),gitDiscard:options=>call('gitDiscard',options),gitPush:options=>call('gitPush',options),gitPullRequest:options=>call('gitPullRequest',options),gitCreatePullRequest:options=>call('gitCreatePullRequest',options),
 designPreferences:{list:()=>call('designPreferencesList'),save:text=>call('designPreferencesSave',text),update:(id,text)=>call('designPreferencesUpdate',id,text),remove:id=>call('designPreferencesRemove',id)},
 // Settings › Agents behaviour (desktop/agent-behavior.cjs): follow-ups, response style, attribution, folder, branch prefix, modes, allowed rules.
 agentBehavior:{get:()=>call('agentBehaviorGet'),set:patch=>call('agentBehaviorSet',patch),chooseFolder:()=>call('agentBehaviorChooseFolder'),outputStyles:()=>call('agentOutputStyles'),commitAuthor:()=>call('agentCommitAuthor'),allowList:()=>call('agentAllowList'),allowRemove:id=>call('agentAllowRemove',id),allowOpen:groupId=>call('agentAllowOpen',groupId)},
 listAgentModels:options=>call('listAgentModels',options),listAgentCommands:options=>call('listAgentCommands',options),designReferencesList:()=>call('designReferencesList'),designReferencesSave:options=>call('designReferencesSave',options),designReferencesAttach:options=>call('designReferencesAttach',options),designReferencesRemove:id=>call('designReferencesRemove',id),worktreeAddFiles:options=>call('worktreeAddFiles',options),pickWorkingDirectory:()=>call('pickWorkingDirectory'),terminalRecentOutput:options=>call('terminalRecentOutput',options),saveAgentImage:options=>call('saveAgentImage',options),readMemory:()=>call('readMemory'),writeMemory:text=>call('writeMemory',text),
 onAgentEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:agent-event',listener);return()=>ipcRenderer.removeListener('desktop:agent-event',listener);}
});
