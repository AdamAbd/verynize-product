const {contextBridge,ipcRenderer}=require('electron');
const call=(method,...args)=>ipcRenderer.invoke('desktop:'+method,...args);
contextBridge.exposeInMainWorld('desktop',{
 agentAccountStatus:options=>call('agentAccountStatus',options),startAgentLogin:options=>call('startAgentLogin',options),cancelAgentLogin:options=>call('cancelAgentLogin',options),agentLogout:options=>call('agentLogout',options),openExternal:url=>call('openExternal',url),
 onAuthEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:auth-event',listener);return()=>ipcRenderer.removeListener('desktop:auth-event',listener)},
 notifyTask:options=>call('notifyTask',options),
 // agent-bridge hook: MCP tool requests from main (bd:mcp-call) and replies (bd:mcp-reply) only.
 agentBridge:{onCall:callback=>{const listener=(_event,request)=>callback(request);ipcRenderer.on('bd:mcp-call',listener);return()=>ipcRenderer.removeListener('bd:mcp-call',listener)},reply:(requestId,payload)=>ipcRenderer.send('bd:mcp-reply',String(requestId),payload)},
 // end agent-bridge hook
 renderDesign:options=>call('renderDesign',options),fontFaces:families=>call('fontFaces',families),
 importFigma:options=>call('importFigma',options),
 generateVector:options=>call('generateVector',options),cancelGeneration:()=>call('cancelGeneration'),
 designDetach:()=>call('designDetach'),
 designOpen:()=>call('designOpen'),designSave:options=>call('designSave',options),designReload:()=>call('designReload'),
 onDesignFileChanged:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('design:file-changed',listener);return()=>ipcRenderer.removeListener('design:file-changed',listener)},
 captureLivePreview:options=>call('captureLivePreview',options),
 previewApp:options=>call('previewApp',options),exportPDF:html=>call('exportPDF',html),
 createProject:options=>call('createProject',options),
 openProject:()=>call('openProject'), listFiles:()=>call('listFiles'),readFile:p=>call('readFile',p),writeFile:(p,c)=>call('writeFile',p,c),gitStatus:()=>call('gitStatus'),createWorktree:b=>call('createWorktree',b),discoverAgents:()=>call('discoverAgents'),runAgent:options=>call('runAgent',options),cancelAgent:id=>call('cancelAgent',id),respondAgentPermission:options=>call('respondAgentPermission',options),respondAgentQuestion:options=>call('respondAgentQuestion',options),steerAgent:options=>call('steerAgent',options),listAgentRuns:()=>call('listAgentRuns'),listAllowRules:options=>call('listAllowRules',options),removeAllowRule:options=>call('removeAllowRule',options),agentToolsVersion:()=>call('agentToolsVersion'),agentTitle:options=>call('agentTitle',options),
 designPreferences:{list:()=>call('designPreferencesList'),save:text=>call('designPreferencesSave',text),update:(id,text)=>call('designPreferencesUpdate',id,text),remove:id=>call('designPreferencesRemove',id)},
 listAgentModels:options=>call('listAgentModels',options),saveAgentImage:options=>call('saveAgentImage',options),readMemory:()=>call('readMemory'),writeMemory:text=>call('writeMemory',text),
 onAgentEvent:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('desktop:agent-event',listener);return()=>ipcRenderer.removeListener('desktop:agent-event',listener);}
});
