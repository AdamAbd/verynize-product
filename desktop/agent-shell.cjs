/**
 * Agent shell host (desktop main process)
 * =======================================
 * Backs the bridge-only MCP shell tools of integrations/shell-tools.mjs: the project's dev server
 * (desktop/dev-server.cjs), the embedded running-app preview (desktop/preview.cjs automation),
 * terminal commands in the project folder, and the editor's command registry (execute_action,
 * answered by web/agent-bridge.js). The stdio server without the app never reaches this file, so
 * those tools report that they need the desktop app.
 *
 *   registerShellWindow(win, {getProject})   per editor window; getProject() -> {root} | null
 *   createShell({activeEditor, request, options}) -> {call(op, args, context)}   used by mcp-bridge
 *   options() -> {shellExec?: boolean, confirmExec?: ({title, detail, root, access}) => Promise<boolean>}
 *
 * Access policy (context.access comes from the request header `x-verynize-access`, which the
 * agent runtime may set to the chat's access level; external clients usually send none):
 *   read      status, snapshots, screenshots, console, terminal output, action list: always allowed
 *   interact  preview open/click/type/scroll, capture to canvas, execute_action, stopping processes:
 *             refused for "readonly" (helper agents)
 *   exec      start_dev_server, configure_dev_server, run_terminal_command: refused for "readonly" or
 *             when shell exec is disabled (bridge option shellExec:false or env
 *             VERYNIZE_SHELL_EXEC=0); runs without asking for "auto" and "full"; otherwise
 *             (ask, edit, or no header) the user approves in a native dialog, with an option to
 *             allow the project until the app quits.
 */
const path = require('node:path');
const { app, dialog } = require('electron');
const { ProcessManager } = require('./dev-server.cjs');
const { previewAutomation } = require('./preview.cjs');

const ACCESS = new Set(['readonly', 'ask', 'edit', 'auto', 'full']);
const parseAccess = value => { const v = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase(); return ACCESS.has(v) ? v : null; };

const OPS = {
  devStatus: 'read', devStart: 'exec', devStop: 'interact', devConfigure: 'exec',
  previewOpen: 'interact', previewSnapshot: 'read', previewScreenshot: 'read', previewClick: 'interact', previewType: 'interact', previewScroll: 'interact', previewConsole: 'read', previewCapture: 'interact',
  terminalRun: 'exec', terminalRead: 'read', terminalStop: 'interact',
  actions: 'read', action: 'interact',
};

const projects = new Map(); // webContents.id -> getProject
function registerShellWindow(win, { getProject } = {}) {
  const id = win.webContents.id;
  projects.set(id, typeof getProject === 'function' ? getProject : () => null);
  win.on('closed', () => projects.delete(id));
}

let manager = null;
function processManager() {
  if (manager) return manager;
  manager = new ProcessManager({ configFile: path.join(app.getPath('userData'), 'dev-servers.json') });
  app.on('will-quit', () => manager.stopAll());
  process.on('exit', () => { try { manager.stopAll(); } catch {} });
  return manager;
}

const shellQuote = argv => argv.map(arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(' ');

async function askUser(entry, { title, detail, root }) {
  const result = await dialog.showMessageBox(entry.win, {
    type: 'question', buttons: ['Run', 'Don’t run'], defaultId: 1, cancelId: 1, noLink: true,
    message: title, detail: `${detail}\n\nFolder: ${root}`,
    checkboxLabel: 'Allow agent commands in this project until Verynize quits',
    signal: AbortSignal.timeout(120000),
  });
  return { allowed: result.response === 0, remember: result.response === 0 && result.checkboxChecked };
}

function createShell({ activeEditor, request, options = () => ({}) }) {
  const approved = new Set(); // project roots allowed for this app session

  const projectRoot = entry => {
    const project = projects.get(entry.win.webContents.id)?.();
    if (!project?.root) throw new Error('No project folder is open in Verynize. Open one (File › Open project) so the dev server and terminal tools know where to run.');
    return project.root;
  };
  const automation = entry => {
    const auto = previewAutomation(entry.win);
    if (!auto) throw new Error('This editor window has no running-app preview');
    return auto;
  };

  async function authorizeExec(entry, access, root, title, detail) {
    const opts = options() || {};
    if (opts.shellExec === false || process.env.VERYNIZE_SHELL_EXEC === '0') throw new Error('Running commands from agents is turned off in this Verynize app (shell exec disabled). Ask the user to run it, or to enable agent commands.');
    if (access === 'auto' || access === 'full') return;
    if (approved.has(root)) return;
    const decide = typeof opts.confirmExec === 'function' ? opts.confirmExec : details => askUser(entry, details);
    let answer;
    try { answer = await decide({ title, detail, root, access }); } catch { answer = false; }
    const allowed = answer === true || answer?.allowed === true;
    if (!allowed) throw new Error(`The user did not allow this command (${title}). Do not retry it unchanged; ask the user how to proceed.`);
    if (answer?.remember) approved.add(root);
  }

  async function call(op, args = {}, context = {}) {
    const kind = OPS[op];
    if (!kind) throw new Error(`Unknown shell operation ${op}`);
    const access = parseAccess(context.access);
    if (access === 'readonly' && kind !== 'read') throw new Error('This agent has read-only access: it may inspect the dev server, preview and terminal output, but not change them.');
    const entry = activeEditor();
    if (!entry) throw new Error('No Verynize editor window is open');
    const pm = processManager();
    switch (op) {
      case 'devStatus': { const root = projectRoot(entry); return { ...(await pm.status(root)), terminals: pm.list(root) }; }
      case 'devStart': {
        const root = projectRoot(entry);
        const running = pm.servers.get(root);
        if (!running || running.exited) {
          const resolved = await pm.resolveCommand(root, args.command);
          if (!resolved) throw new Error('No dev server command found: package.json has no dev/start/serve/preview script. Pass command (an argument array such as ["npx","vite"]) or save one with configure_dev_server.');
          await authorizeExec(entry, access, root, 'Start the dev server?', `The agent wants to run: ${shellQuote(resolved.command)}`);
        }
        const status = await pm.start(root, { command: args.command, url: args.url, waitMs: args.waitMs ?? 20000 });
        if (args.open !== false && status.url && status.state === 'running') {
          try { status.preview = await automation(entry).open({ url: status.url, reload: false }); } catch (error) { status.previewError = error.message; }
        }
        return status;
      }
      case 'devStop': return pm.stop(projectRoot(entry));
      case 'devConfigure': {
        const root = projectRoot(entry);
        if (args.command === null) return pm.configure(root, { command: null });
        await authorizeExec(entry, access, root, 'Save a dev server command?', `The agent wants this project's dev server to run: ${shellQuote(args.command)}${args.url ? `\nPreview URL: ${args.url}` : ''}`);
        return pm.configure(root, { command: args.command, url: args.url });
      }
      case 'terminalRun': {
        const root = projectRoot(entry);
        await authorizeExec(entry, access, root, args.background ? 'Run a background command?' : 'Run a command?', `The agent wants to run: ${shellQuote(args.argv)}`);
        return pm.run(root, args.argv, { timeoutMs: args.timeoutMs, background: !!args.background });
      }
      case 'terminalRead': {
        const root = projectRoot(entry);
        if (!args.id) return { terminals: pm.list(root) };
        return pm.read(args.id, { since: args.since, limit: args.limit, root });
      }
      case 'terminalStop': return pm.kill(args.id, { root: projectRoot(entry) });
      case 'previewOpen': {
        let url = args.url;
        if (!url) {
          const state = await automation(entry).state();
          if (!state.url) { const root = projects.get(entry.win.webContents.id)?.()?.root; const server = root && pm.servers.get(root); url = server && !server.exited ? server.url : null; }
          if (!url && !state.url) throw new Error('Nothing to open: pass url (http://localhost:…) or start the dev server first');
        }
        return automation(entry).open({ url, reload: args.reload !== false });
      }
      case 'previewSnapshot': return automation(entry).snapshot(args);
      case 'previewScreenshot': return automation(entry).screenshot(args);
      case 'previewClick': return automation(entry).click(args);
      case 'previewType': return automation(entry).type(args);
      case 'previewScroll': return automation(entry).scroll(args);
      case 'previewConsole': return automation(entry).console(args);
      case 'previewCapture': { const captured = await automation(entry).capture(args); const { html: _html, ...rest } = captured; return rest; }
      case 'actions': return request(entry, 'actions', {}, 5000);
      case 'action': return request(entry, 'action', { id: args.id, ids: args.ids, pageId: args.pageId }, 10000);
    }
    throw new Error(`Unhandled shell operation ${op}`);
  }

  return { call, parseAccess };
}

/**
 * Renderer controls for the dev server of the open project (the Code workspace "Start preview" button).
 * These are explicit user actions, so no approval dialog: devServerStatus(), devServerStart(), devServerStop().
 */
function registerDevServerIPC(handle, { getProject }) {
  const root = () => { const project = getProject(); if (!project?.root) throw new Error('Open a repository first'); return project.root; };
  handle('devServerStatus', () => { const project = getProject(); return project?.root ? processManager().status(project.root) : { state: 'stopped', root: null }; });
  handle('devServerStart', () => processManager().start(root(), { waitMs: 20000 }));
  handle('devServerStop', () => processManager().stop(root()));
}

module.exports = { registerShellWindow, registerDevServerIPC, createShell, parseAccess, processManager };
