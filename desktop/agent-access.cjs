// Settings › Agents › Access: what local agents may do, applied when a chat's agent next starts.
//
// Stored in userData/agent-access.json (like agent-allow-rules.json). desktop/agent-runtime.cjs reads it
// at the start of every turn and turns each switch into real launch options:
//   createFiles      persona + (Claude) a PreToolUse gate that asks before new files / canvas pages
//   shareMemory      the other agent's instruction and memory files are appended to the persona
//   askAgents        the `ask_agent` canvas tool (read-only second opinion from the other model)
//   claudeConnectors claude.ai connectors in Claude chats (ENABLE_CLAUDEAI_MCP_SERVERS)
//   claudeArtifacts  Claude artifact tools (CLAUDE_CODE_DISABLE_ARTIFACT + disallowedTools)
//   claudeChrome     Claude in Chrome (`--chrome` / `--no-chrome`)
//   codexApps        ChatGPT apps in Codex (`features.apps`)
//   codexComputerUse Computer Use in Codex (`features.computer_use`)
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const ACCESS_DEFAULTS = Object.freeze({
  createFiles: true,
  shareMemory: true,
  askAgents: false,
  claudeConnectors: true,
  claudeArtifacts: true,
  claudeChrome: false,
  codexApps: true,
  codexComputerUse: false,
});
const ACCESS_KEYS = Object.keys(ACCESS_DEFAULTS);
const ACCESS_FILE = 'agent-access.json';

function normalizeAccessSettings(value) {
  const out = { ...ACCESS_DEFAULTS };
  if (value && typeof value === 'object') for (const key of ACCESS_KEYS) if (typeof value[key] === 'boolean') out[key] = value[key];
  return out;
}

const accessFile = userData => path.join(userData, ACCESS_FILE);

async function loadAccessSettings(userData) {
  try { return normalizeAccessSettings(JSON.parse(await fs.readFile(accessFile(userData), 'utf8'))); }
  catch { return { ...ACCESS_DEFAULTS }; }
}

/** Merge `changes` (known boolean keys only) into the stored settings; returns {previous, settings}. */
async function saveAccessSettings(userData, changes) {
  if (!changes || typeof changes !== 'object') throw Error('Invalid access settings');
  const previous = await loadAccessSettings(userData);
  const next = { ...previous };
  for (const [key, value] of Object.entries(changes)) {
    if (!ACCESS_KEYS.includes(key)) throw Error(`Unknown access setting: ${key}`);
    if (typeof value !== 'boolean') throw Error(`${key} must be on or off`);
    next[key] = value;
  }
  await fs.mkdir(userData, { recursive: true });
  const file = accessFile(userData), temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
  return { previous, settings: next };
}

// --- persona ------------------------------------------------------------------------------------
function accessPersonaLines(access) {
  const lines = [];
  lines.push(access.createFiles
    ? 'When a task or the preview needs new files, folders or canvas pages, create them yourself instead of asking first.'
    : 'Ask the user before you create new files, folders or canvas pages; editing existing ones is fine.');
  if (access.askAgents) lines.push('You may consult the other local agent for a read-only second opinion with the `ask_agent` canvas tool when a decision is risky or you are unsure.');
  return lines.join('\n');
}

// --- shared memory -------------------------------------------------------------------------------
const MEMORY_LIMIT = 12000;
const FILE_LIMIT = 6000;
const claudeProjectSlug = cwd => String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');

/** Instruction / memory files the *other* agent keeps, which the given agent would not read itself. */
function otherAgentMemoryFiles(agent, { cwd, home = os.homedir() } = {}) {
  if (agent === 'claude') {
    return [
      { label: 'Codex global instructions (~/.codex/AGENTS.md)', file: path.join(home, '.codex', 'AGENTS.md') },
      ...(cwd ? [{ label: 'Codex project instructions (AGENTS.md)', file: path.join(cwd, 'AGENTS.md') }] : []),
      { label: 'Codex memories (~/.codex/memories)', dir: path.join(home, '.codex', 'memories') },
    ];
  }
  return [
    { label: 'Claude global memory (~/.claude/CLAUDE.md)', file: path.join(home, '.claude', 'CLAUDE.md') },
    ...(cwd ? [
      { label: 'Claude project memory (CLAUDE.md)', file: path.join(cwd, 'CLAUDE.md') },
      { label: 'Claude auto memory (MEMORY.md)', file: path.join(home, '.claude', 'projects', claudeProjectSlug(cwd), 'memory', 'MEMORY.md') },
    ] : []),
  ];
}

async function readSmall(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 512 * 1024) return '';
    return (await fs.readFile(file, 'utf8')).trim();
  } catch { return ''; }
}

/** Text block with what the other agent remembers, or '' when there is nothing. Bounded. */
async function sharedMemoryBlock(agent, options = {}) {
  let out = '';
  const add = (label, text) => {
    if (!text) return;
    const chunk = `### ${label}\n${text.slice(0, FILE_LIMIT)}`;
    if (out.length + chunk.length > MEMORY_LIMIT) return;
    out += (out ? '\n\n' : '') + chunk;
  };
  for (const item of otherAgentMemoryFiles(agent, options)) {
    if (item.file) { add(item.label, await readSmall(item.file)); continue; }
    let names = [];
    try { names = (await fs.readdir(item.dir)).filter(name => /\.md$/i.test(name)).sort().slice(0, 10); } catch {}
    for (const name of names) add(`${item.label}/${name}`, await readSmall(path.join(item.dir, name)));
  }
  if (!out) return '';
  return `Memory shared from your other local agent (${agent === 'claude' ? 'Codex' : 'Claude Code'}). Treat it as background about the user and their projects; the user's current request wins:\n\n${out}`;
}

// --- Claude launch options ----------------------------------------------------------------------
const CLAUDE_ARTIFACT_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData', 'ArtifactCheck'];

/** {env, disallowedTools, extraArgs, cliArgs} for a Claude chat. */
function claudeAccessOptions(access, { mcpServerName = 'verynize' } = {}) {
  const env = {}, disallowedTools = [], extraArgs = {};
  if (!access.claudeConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  if (!access.claudeArtifacts) { env.CLAUDE_CODE_DISABLE_ARTIFACT = '1'; disallowedTools.push(...CLAUDE_ARTIFACT_TOOLS); }
  if (!access.askAgents) disallowedTools.push(`mcp__${mcpServerName}__ask_agent`);
  extraArgs[access.claudeChrome ? 'chrome' : 'no-chrome'] = null;
  const cliArgs = [`--${access.claudeChrome ? 'chrome' : 'no-chrome'}`, ...(disallowedTools.length ? ['--disallowedTools', ...disallowedTools] : [])];
  return { env, disallowedTools, extraArgs, cliArgs };
}

// Tools that create something new; gated by `createFiles`.
const CREATE_CANVAS_TOOLS = ['create_page', 'create_document'];
/** Whether a Claude tool call creates a new file or page (and so needs approval when createFiles is off). */
async function claudeCreatesSomething(toolName, input = {}, { mcpServerName = 'verynize', cwd } = {}) {
  if (CREATE_CANVAS_TOOLS.some(name => toolName === `mcp__${mcpServerName}__${name}`)) return true;
  if (toolName === 'Write' || toolName === 'NotebookEdit') {
    const target = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '';
    if (!target) return false;
    try { await fs.access(path.resolve(cwd || '/', target)); return false; } catch { return true; }
  }
  if (toolName === 'Bash' && typeof input.command === 'string') return /(^|[;&|]\s*|\s)(mkdir|touch)\s/.test(input.command);
  return false;
}

// --- Codex launch options -----------------------------------------------------------------------
/** Extra `codex app-server` / `codex exec` arguments for the Codex switches. */
function codexAccessArgs(access, { mcpServerName = 'verynize', bridge = false } = {}) {
  const args = [access.codexApps ? '--enable' : '--disable', 'apps', access.codexComputerUse ? '--enable' : '--disable', 'computer_use'];
  if (bridge && !access.askAgents) args.push('-c', `mcp_servers.${mcpServerName}.disabled_tools=["ask_agent"]`);
  return args;
}

module.exports = {
  ACCESS_DEFAULTS, ACCESS_KEYS, ACCESS_FILE, normalizeAccessSettings, loadAccessSettings, saveAccessSettings,
  accessPersonaLines, otherAgentMemoryFiles, sharedMemoryBlock, claudeProjectSlug,
  claudeAccessOptions, claudeCreatesSomething, CLAUDE_ARTIFACT_TOOLS, CREATE_CANVAS_TOOLS, codexAccessArgs,
};
