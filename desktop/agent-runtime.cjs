// Session-based chat runtime for the in-app agent panel.
//
//  * Claude runs through @anthropic-ai/claude-agent-sdk `query()` using the user's installed Claude
//    Code (and therefore its existing login), with streamed partial messages, resume by session id
//    and `interrupt()`.
//  * Codex runs through `codex app-server` JSON-RPC (thread/start|resume → turn/start,
//    turn/interrupt) when the installed CLI supports it, otherwise the one-shot `codex exec` runner.
//  * Both stream the typed events described in desktop/agent-runtime-events.cjs.
//  * The live canvas MCP bridge (desktop/mcp-bridge.cjs, optional) is wired into both providers.
//  * Structured questions (Claude AskUserQuestion, Codex item/tool/requestUserInput), steering of a
//    running turn, "always allow" rules, nested read-only helper runs (ask_agent) and auto-titles
//    are handled here too; see registerAgentRuntime for the IPC surface.
//  * Rewind forks the provider session at an earlier turn (Claude resumeSessionAt + forkSession,
//    Codex thread/fork); second opinions send the latest answer and diff to the other provider.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const agents = require('./agents.cjs');
const settings = require('./agent-settings.cjs');
const agentAccess = require('./agent-access.cjs'); // Settings › Agents › Access switches
const agentBehavior = require('./agent-behavior.cjs');
const { createClaudeMapper, createCodexMapper, toolTitle } = require('./agent-runtime-events.cjs');
const agentCommands = require('./agent-commands.cjs'); // composer slash commands: Codex prompt/skill expansion
const agentMemory = require('./agent-memory.cjs'); // Settings › Memory: repo-less memory folder, ~/.codex/AGENTS.md for Claude

const VERSION = '0.6.0';
const MAX_RUNS = 3;
const PERMISSION_TIMEOUT = 10 * 60 * 1000;
const QUESTION_TIMEOUT = 10 * 60 * 1000;
const HELPER_TIMEOUT = 5 * 60 * 1000;
const TITLE_TIMEOUT = 20 * 1000;
const TITLE_MODEL = 'claude-haiku-5-5';
const MAX_HELPERS = 2;
// After a steered Claude turn reports `result`, wait this long for the folded-in follow-up to start
// a new turn before closing the input stream (session_state_changed:idle usually ends it sooner).
const STEER_SETTLE_MS = 6000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/;
const NODE_ID = /^[a-zA-Z0-9_.:#/-]{1,160}$/;
const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// ---------------------------------------------------------------------------------------------
// Persona and per-turn context. The designer persona comes from the design knowledge layer
// (integrations/design-knowledge/persona.mjs, loaded with require(esm)); runtime facts, the user's
// personal instructions and VERYNIZE.md are appended.
const FALLBACK_PERSONA = 'You are the designer inside Verynize, a local desktop design editor with a live canvas. Decide a short brief before you draw, build in small verifiable steps, screenshot your work and review it before you finish.';
let designPersona;
function loadDesignPersona() {
  if (designPersona === undefined) {
    try { designPersona = String(require('../integrations/design-knowledge/persona.mjs').persona || '') || FALLBACK_PERSONA; }
    catch { designPersona = FALLBACK_PERSONA; }
  }
  return designPersona;
}

function buildPersona({ bridge = false, quickChat = false, instructions = '', memory = '', preferences = [], homeInstructions = '' } = {}) {
  const lines = [
    loadDesignPersona(),
    bridge
      ? 'Canvas work goes through the `verynize` MCP tools: they read and edit the document that is open in the editor right now, and every change shows up live and can be undone by the user. Start with get_design_context and follow the workflow in the tool instructions. Use them whenever the request is about the design, a page, a frame, a component, tokens, or the current selection. Do not try to edit design files on disk directly while the editor has them open. A turn that changes an artboard ends with finish_artboard (with a reviewNote) after a screenshot and design review.'
      : 'The live canvas tools (`verynize` MCP server) are not connected in this session. If the request needs canvas edits, say so briefly and offer to work on project files instead.',
    'Each user turn may begin with a <verynize-context> block. It names the open document, the active page id and the ids of the selected elements. Ids are references only: fetch the content you need with the tools, and pass the given page id to every canvas tool call. Image paths listed there are files on disk that you may read or copy.',
    quickChat
      ? 'This is a quick chat with no project attached. The working directory is a private scratch folder; files you create there are temporary.'
      : 'The working directory is the user\'s project. Respect its conventions and do not make unrelated changes.',
  ];
  if (instructions) lines.push('Personal instructions from the user:\n' + String(instructions).slice(0, 4000));
  // Settings › Memory: ~/.codex/AGENTS.md for Claude Code chats (desktop/agent-memory.cjs homeInstructions).
  if (homeInstructions) lines.push('The user\'s personal agent instructions (~/.codex/AGENTS.md):\n' + String(homeInstructions).slice(0, 12000));
  if (memory) lines.push('Project memory (VERYNIZE.md):\n' + String(memory).slice(0, 12000));
  const prefs = preferenceLines(preferences);
  if (prefs) lines.push('User design preferences (apply unless the brief overrides):\n' + prefs);
  return lines.join('\n\n');
}

function preferenceLines(preferences) {
  if (!Array.isArray(preferences)) return '';
  let out = '';
  for (const item of preferences.slice(0, 60)) {
    const text = String(typeof item === 'string' ? item : item?.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!text) continue;
    if (out.length + text.length > 6000) break;
    out += (out ? '\n' : '') + '- ' + text;
  }
  return out;
}

// Design preferences live in integrations/preferences.mjs (optional; owned by the MCP layer). The
// desktop app sets VERYNIZE_PREFERENCES so this runtime and the MCP tools share one file.
async function preferenceStore() {
  const mod = await import('../integrations/preferences.mjs');
  if (typeof mod.createPreferenceStore !== 'function') throw Error('Design preferences are unavailable');
  return mod.createPreferenceStore(process.env.VERYNIZE_PREFERENCES || mod.defaultPreferencesPath());
}
async function defaultLoadPreferences() {
  try { const list = await (await preferenceStore()).list(); return Array.isArray(list) ? list : []; } catch { return []; }
}

// Version of the canvas tool set, used by the renderer to decide whether an old agent session can be
// resumed (tool schemas changed => start fresh with a transcript seed).
const TOOL_SOURCES = ['design-tools.mjs', 'design-edit.mjs', 'jsx-codec.mjs', 'tailwind-map.mjs'];
let toolsVersion;
function agentToolsVersion({ importTools = () => import('../integrations/design-tools.mjs'), root = path.join(__dirname, '../integrations') } = {}) {
  const compute = async () => {
    try { const mod = await importTools(); if (mod?.TOOLS_VERSION !== undefined && mod.TOOLS_VERSION !== null && String(mod.TOOLS_VERSION)) return String(mod.TOOLS_VERSION); } catch {}
    const hash = createHash('sha256');
    for (const file of TOOL_SOURCES) { try { hash.update(file + '\0'); hash.update(await fs.readFile(path.join(root, file))); } catch {} }
    return 'sha256-' + hash.digest('hex').slice(0, 16);
  };
  if (arguments.length) return compute();
  return (toolsVersion ||= compute());
}

// ---------------------------------------------------------------------------------------------
// Finish enforcement for Claude: a `Stop` hook refuses to end a turn that changed an artboard
// without a successful finish_artboard after the last change. It blocks at most `maxBlocks` times
// per turn and lets the agent stop when it made no canvas progress since the last block
// (stop_hook_active), so it can never loop. Codex has no equivalent hook: there the MCP-level
// finish gate (finish_artboard refuses on critical lint and reports "unverified" without a fresh
// screenshot receipt, integrations/verification.mjs) is the enforcement.
const DESIGN_TOOL = new RegExp(`^mcp__${settings.MCP_SERVER_NAME}__(.+)$`);
const MUTATING_DESIGN_TOOLS = new Set(['create_artboard', 'update_elements', 'duplicate_elements', 'delete_elements', 'apply_operations']);
const STOP_REASON = 'You changed the canvas in this turn but have not finished it. Take a screenshot of each changed artboard (take_screenshot), run the design-review skill (get_skills {name:"design-review"}) and fix what it finds, then call finish_artboard with a reviewNote. If finish_artboard is blocked, fix the critical problems it lists and try again. If verification is impossible (for example screenshots are unavailable), still call finish_artboard and tell the user the status it reports.';

/** Normalize a PostToolUse tool_response (content array, CallToolResult or string) into {ok, text}. */
function toolOutcome(response) {
  if (typeof response === 'string') return { ok: true, text: response };
  const content = Array.isArray(response) ? response : Array.isArray(response?.content) ? response.content : [];
  const text = content.map(block => (typeof block === 'string' ? block : block?.type === 'text' ? block.text : '')).join('\n');
  return { ok: !(response?.isError || response?.is_error), text };
}

function createDesignTurnGuard({ maxBlocks = 2 } = {}) {
  const state = { mutated: false, dirty: false, blocks: 0, progressSinceBlock: true };
  return {
    state,
    /** Record one verynize tool result. */
    toolResult(toolName, { ok = true, text = '' } = {}) {
      const name = DESIGN_TOOL.exec(String(toolName || ''))?.[1];
      if (!name) return;
      state.progressSinceBlock = true;
      if (!ok) return;
      if (MUTATING_DESIGN_TOOLS.has(name)) { state.mutated = true; state.dirty = true; }
      else if (name === 'finish_artboard' && !/Finish blocked|"status":\s*"blocked"/.test(text)) state.dirty = false;
    },
    /** Stop hook decision: {} lets the turn end; {decision:'block', reason} keeps the agent working. */
    stop(input = {}) {
      if (!state.dirty || state.blocks >= maxBlocks) return {};
      if (input.stop_hook_active && !state.progressSinceBlock) return {};
      state.blocks++; state.progressSinceBlock = false;
      return { decision: 'block', reason: STOP_REASON };
    },
  };
}

/** Claude Agent SDK hooks feeding a turn guard. */
function designHooks(guard) {
  const matcher = `mcp__${settings.MCP_SERVER_NAME}__.*`;
  return {
    PostToolUse: [{ matcher, hooks: [async input => { guard.toolResult(input?.tool_name, toolOutcome(input?.tool_response)); return {}; }] }],
    PostToolUseFailure: [{ matcher, hooks: [async input => { guard.toolResult(input?.tool_name, { ok: false }); return {}; }] }],
    Stop: [{ hooks: [async input => guard.stop(input || {})] }],
  };
}

function cleanText(value, limit) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, limit) : ''; }

// Validates renderer-supplied context. Image paths are accepted only inside `imageRoot`.
function normalizeContext(context, imageRoot) {
  if (!context || typeof context !== 'object') return null;
  const selection = Array.isArray(context.selection) ? context.selection.filter(id => typeof id === 'string' && NODE_ID.test(id)).slice(0, 200) : [];
  const images = Array.isArray(context.images)
    ? context.images.filter(p => typeof p === 'string' && imageRoot && path.isAbsolute(p) && path.resolve(p).startsWith(path.resolve(imageRoot) + path.sep)).slice(0, 10)
    : [];
  const pageId = typeof context.pageId === 'string' && NODE_ID.test(context.pageId) ? context.pageId : '';
  const mentions = Array.isArray(context.mentions)
    ? context.mentions.filter(m => m && typeof m.id === 'string' && NODE_ID.test(m.id)).slice(0, 50).map(m => ({
      id: m.id,
      label: cleanText(m.label, 120) || m.id,
      pageId: typeof m.pageId === 'string' && NODE_ID.test(m.pageId) ? m.pageId : '',
      type: cleanText(m.type, 40),
    }))
    : [];
  return {
    documentName: cleanText(context.documentName, 200),
    documentPath: typeof context.documentPath === 'string' && path.isAbsolute(context.documentPath) ? context.documentPath.slice(0, 1000) : '',
    documentId: typeof context.documentId === 'string' && NODE_ID.test(context.documentId) ? context.documentId : '',
    pageId,
    pageName: cleanText(context.pageName, 200),
    selection,
    images,
    mentions,
  };
}

function buildTurnContext(context) {
  if (!context) return '';
  const lines = ['<verynize-context>'];
  if (context.documentName || context.documentPath || context.documentId) {
    lines.push(`Open document: "${context.documentName || 'Untitled'}"${context.documentId ? ` (documentId ${context.documentId})` : ''}${context.documentPath ? ` saved at ${context.documentPath}` : ''}.`);
  }
  if (context.pageId) lines.push(`Active page: "${context.pageName || context.pageId}" (pageId ${context.pageId}). Use this pageId for canvas tool calls.`);
  if (context.pageId || context.selection.length) lines.push(context.selection.length ? `Selected element ids: ${context.selection.join(', ')}. Read their content with the canvas tools before editing.` : 'Selection: nothing is selected.');
  if (context.mentions?.length) {
    lines.push('Referenced elements (the user mentioned these; read them with get_element_code before you change or describe them):',
      ...context.mentions.map(m => `- "${m.label}" (id ${m.id}${m.type ? `, ${m.type}` : ''}${m.pageId ? `, pageId ${m.pageId}` : ''})`));
  }
  if (context.images.length) lines.push('Attached images (files on disk):', ...context.images.map(p => '- ' + p));
  if (context.directories?.length) lines.push('Additional working directories the user added to this chat (read and edit files there too):', ...context.directories.map(p => '- ' + p));
  if (lines.length === 1) return '';
  lines.push('</verynize-context>');
  return lines.join('\n');
}

const SEED_LIMIT = 60000;
/** Transcript summary of an earlier conversation whose provider session is not resumed. */
function buildSeedBlock(seed) {
  const text = typeof seed === 'string' ? seed.replace(/<\/?previous-conversation>/g, '').trim() : '';
  if (!text) return '';
  return [
    '<previous-conversation>',
    'This chat continues an earlier conversation that ran in a different agent session, which is not resumed. Summary of that transcript:',
    text.length > SEED_LIMIT ? '…' + text.slice(-SEED_LIMIT) : text,
    'Note: the Verynize tools and their capabilities may have changed since then. Do not rely on earlier tool results or element ids without checking them again with the current tools.',
    '</previous-conversation>',
  ].join('\n');
}

/** Composer slash command (`/name args`): sent as typed so the agent runs it, without the context preamble. */
const isSlashCommand = prompt => typeof prompt === 'string' && /^\/[a-zA-Z0-9][\w.:-]*(\s|$)/.test(prompt);

/** Extra working directories (composer /add-dir, linked worktrees): absolute existing folders, never `/` or $HOME. */
async function normalizeDirectories(list, cwd) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const dir of list.slice(0, 10)) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) continue;
    const real = await fs.realpath(dir).catch(() => null);
    if (!real || real === path.parse(real).root || real === os.homedir() || real === cwd || out.includes(real)) continue;
    if ((await fs.stat(real).catch(() => null))?.isDirectory()) out.push(real);
  }
  return out;
}

function composePrompt(prompt, context, seed) {
  const blocks = [buildSeedBlock(seed), buildTurnContext(context)].filter(Boolean);
  return blocks.length ? blocks.join('\n\n') + '\n\n' + prompt : prompt;
}

// ---------------------------------------------------------------------------------------------
// Rewind. Every finished turn reports `resumeAt` on its `done` event: the provider-specific id of
// the turn's last kept point (Claude: uuid of the last main-chain transcript entry; Codex: the turn
// id). Rewinding a chat to before user message N runs the next turn with
// `fork: {sessionId, at: <resumeAt of the reply before N>}`: Claude resumes a forked copy of the
// session cut at that entry (resume + resumeSessionAt + forkSession), Codex forks the thread
// through that turn (thread/fork lastTurnId). If the fork point is unusable the run falls back to
// the transcript `seed` sent with it, so a rewind never silently loses the earlier context.
const FORK_ID = /^[a-zA-Z0-9._:-]{1,200}$/;
function normalizeFork(fork) {
  if (!fork || typeof fork !== 'object') return null;
  const { sessionId, at } = fork;
  return typeof sessionId === 'string' && FORK_ID.test(sessionId) && typeof at === 'string' && FORK_ID.test(at) ? { sessionId, at } : null;
}
const REWIND_FALLBACK = 'Could not rewind the earlier agent session; starting a new session seeded from the transcript.';

// ---------------------------------------------------------------------------------------------
// Second opinion: the latest answer (and the project's uncommitted diff) is sent to the other
// provider through the read-only helper run (`ask`).
const REVIEW_LIMITS = { request: 8000, answer: 30000, diff: 50000 };
function clipMiddle(text, limit) {
  const value = String(text || '');
  return value.length > limit ? value.slice(0, Math.floor(limit * 0.6)) + `\n… (${value.length - limit} characters omitted) …\n` + value.slice(-Math.floor(limit * 0.4)) : value;
}
function buildReviewTask({ request = '', answer = '', diff = '', author = '' } = {}) {
  const lines = [
    `Give a second opinion on a turn another agent${author ? ` (${author})` : ''} just finished in Verynize. You are reviewing, not redoing the work: do not edit files, run commands or change the canvas.`,
    'Check whether the answer actually does what the user asked, whether claims in it are correct, and whether the changes (when a diff is included) contain bugs, regressions, unsafe edits or missed requirements. You may read project files and inspect the open design with the read-only tools to verify.',
    'Reply in this shape: a one-line verdict ("Looks good" or "Needs changes"), then at most five concrete findings ordered by severity, each naming the file, element or sentence it concerns. Say plainly when you could not verify something. Keep it short.',
  ];
  if (request.trim()) lines.push('<user-request>\n' + clipMiddle(request.trim(), REVIEW_LIMITS.request) + '\n</user-request>');
  lines.push('<agent-answer>\n' + clipMiddle(answer.trim(), REVIEW_LIMITS.answer) + '\n</agent-answer>');
  if (diff.trim()) lines.push('<uncommitted-changes>\n' + clipMiddle(diff.trim(), REVIEW_LIMITS.diff) + '\n</uncommitted-changes>');
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Structured questions. Claude: AskUserQuestion input {questions:[{question, header, options:[{label,
// description}], multiSelect}]}; the answer goes back as updatedInput.answers keyed by question text.
// Codex: item/tool/requestUserInput {questions:[{id, header, question, options}]} answered with
// {answers:{[id]:{answers:[text]}}}. The renderer sees one shape: [{id, question, header?, options?, multiSelect?}].
function questionOptions(options) {
  if (!Array.isArray(options) || !options.length) return undefined;
  const list = options.slice(0, 12).map(o => ({ label: String(o?.label ?? '').slice(0, 200), ...(o?.description ? { description: String(o.description).slice(0, 1000) } : {}) })).filter(o => o.label);
  return list.length ? list : undefined;
}
function claudeQuestions(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list.slice(0, 8).map((q, index) => {
    const options = questionOptions(q?.options);
    return { id: 'q' + (index + 1), question: String(q?.question ?? '').slice(0, 2000), ...(q?.header ? { header: String(q.header).slice(0, 60) } : {}), ...(options ? { options } : {}), ...(q?.multiSelect ? { multiSelect: true } : {}) };
  }).filter(q => q.question);
}
function claudeAnswerInput(input, questions, answers) {
  const byText = {};
  for (const q of questions) if (typeof answers?.[q.id] === 'string' && answers[q.id]) byText[q.question] = answers[q.id];
  return { ...input, answers: byText };
}
function codexQuestions(params) {
  const list = Array.isArray(params?.questions) ? params.questions : [];
  return list.slice(0, 8).map((q, index) => {
    const options = questionOptions(q?.options);
    return { id: typeof q?.id === 'string' && q.id ? q.id.slice(0, 200) : 'q' + (index + 1), question: String(q?.question ?? '').slice(0, 2000), ...(q?.header ? { header: String(q.header).slice(0, 60) } : {}), ...(options ? { options } : {}), ...(q?.isSecret ? { secret: true } : {}) };
  }).filter(q => q.question);
}
function codexAnswers(questions, answers) {
  const out = {};
  for (const q of questions) if (typeof answers?.[q.id] === 'string' && answers[q.id]) out[q.id] = { answers: [answers[q.id]] };
  return { answers: out };
}
/** Renderer answers -> {[questionId]: string}; arrays (multi-select) are joined with ", ". */
function normalizeAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(answers).slice(0, 20)) {
    if (typeof key !== 'string' || !key || key.length > 200) continue;
    const text = Array.isArray(value) ? value.filter(v => typeof v === 'string').join(', ') : typeof value === 'string' ? value : '';
    if (text.trim()) out[key] = text.slice(0, 8000);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// "Always allow" rules, persisted per project in <userData>/agent-allow-rules.json as
// {projectKey: ["ToolName", "Bash(npm run build)", "Bash(git status*)", ...]}. A rule without a
// pattern allows every call of that tool; a pattern is matched (with * wildcards) against the
// command, file path or URL of the call.
const RULE = /^([^()\s]{1,200})(?:\(([\s\S]{1,2000})\))?$/;
const COMMAND_TOOLS = new Set(['Bash', 'shell', 'PowerShell']);
const NEVER_ALWAYS = new Set(['AskUserQuestion', 'ExitPlanMode']);
function ruleSubject(input = {}) {
  const value = input?.command ?? input?.file_path ?? input?.path ?? input?.url;
  return Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
}
/** The rule an "Always allow" answer creates for one request, or null when none is safe. */
function allowRuleFor(toolName, input = {}) {
  const name = String(toolName || '');
  if (!name || name.length > 200 || /[()\s]/.test(name) || NEVER_ALWAYS.has(name)) return null;
  if (COMMAND_TOOLS.has(name)) {
    const command = ruleSubject(input).trim();
    return command && command.length <= 2000 ? `${name}(${command})` : null;
  }
  return name;
}
function ruleMatches(rule, toolName, input = {}) {
  const match = typeof rule === 'string' && RULE.exec(rule);
  if (!match || match[1] !== toolName || NEVER_ALWAYS.has(toolName)) return false;
  if (match[2] === undefined) return true;
  const subject = ruleSubject(input).trim();
  if (!subject) return false;
  const pattern = match[2].trim().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*');
  return new RegExp('^' + pattern + '$').test(subject);
}
class AllowRules {
  constructor(file) { this.file = file; this.data = null; this.queue = Promise.resolve(); }
  async load() {
    if (this.data) return this.data;
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch {}
    const data = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, rules] of Object.entries(raw)) if (key.length <= 4096 && Array.isArray(rules)) data[key] = [...new Set(rules.filter(r => typeof r === 'string' && RULE.test(r)))].slice(0, 500);
    }
    return (this.data ||= data);
  }
  async list(projectKey) {
    const data = await this.load();
    if (typeof projectKey === 'string') return { [projectKey]: [...(data[projectKey] || [])] };
    return Object.fromEntries(Object.entries(data).map(([key, rules]) => [key, [...rules]]));
  }
  async matches(projectKey, toolName, input) {
    const rules = (await this.load())[projectKey] || [];
    return rules.some(rule => ruleMatches(rule, toolName, input));
  }
  async add(projectKey, rule) {
    if (typeof projectKey !== 'string' || !projectKey || projectKey.length > 4096 || typeof rule !== 'string' || !RULE.test(rule)) throw Error('Invalid allow rule');
    const data = await this.load();
    const rules = data[projectKey] ||= [];
    if (!rules.includes(rule)) { rules.push(rule); if (rules.length > 500) rules.shift(); await this.save(); }
    return rule;
  }
  async remove(projectKey, rule) {
    const data = await this.load();
    const rules = data[projectKey];
    const index = rules ? rules.indexOf(rule) : -1;
    if (index < 0) return false;
    rules.splice(index, 1);
    if (!rules.length) delete data[projectKey];
    await this.save();
    return true;
  }
  save() {
    const write = async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.file);
    };
    this.queue = this.queue.then(write, write);
    return this.queue;
  }
}

/** Fallback chat title from the first message: first 6 words, no markup. */
function heuristicTitle(text) {
  const words = String(text || '').replace(/<[^>]*>/g, ' ').replace(/[`*_#>[\]()"]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const title = words.slice(0, 6).join(' ').slice(0, 60);
  return title ? title[0].toUpperCase() + title.slice(1) : 'New chat';
}
function cleanTitle(text) {
  const line = String(text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  const title = line.replace(/^(title\s*:\s*)/i, '').replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').replace(/\s+/g, ' ').trim();
  const words = title.split(' ').filter(Boolean);
  if (!title || words.length > 10 || title.length > 80) return '';
  return title;
}

// Tools a read-only helper must never call.
// Shell tools that act on the project or preview (the read-only ones stay available).
const HELPER_BLOCKED_SHELL_TOOLS = ['start_dev_server', 'stop_dev_server', 'configure_dev_server', 'preview_open', 'preview_click', 'preview_type', 'preview_scroll', 'capture_preview_to_canvas', 'run_terminal_command', 'execute_action'];
const HELPER_BLOCKED_DESIGN_TOOLS = [...MUTATING_DESIGN_TOOLS, 'finish_artboard', 'ask_agent', ...HELPER_BLOCKED_SHELL_TOOLS];
const HELPER_PERSONA = 'You are a read-only helper agent consulted by the designer agent inside Verynize (a local desktop design editor). Answer the task you are given precisely and concisely. You may read project files and inspect the open design with the read-only `verynize` MCP tools (get_design_context, get_element_code, take_screenshot and similar), but you must not edit files, run commands, or change the canvas. Reply with your findings only.';

// Pure option builder for the Claude Agent SDK, kept separate for unit tests.
function claudeQueryOptions({ cwd, access, model, effort, sessionId, fork, persona, bridge, executable, additionalDirectories, agentSettings, claudeSettings, memoryDir }) {
  const mode = settings.claudePermissionMode(access);
  const options = {
    cwd,
    permissionMode: mode,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: persona },
    includePartialMessages: true,
    maxTurns: 200,
  };
  if (mode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
  if (model) options.model = model;
  if (effort) options.effort = effort;
  if (fork?.sessionId && fork.at) {
    // Rewind: continue a copy of the earlier session cut after its last kept chain entry.
    options.resume = fork.sessionId;
    options.resumeSessionAt = fork.at;
    options.forkSession = true;
  } else if (sessionId) options.resume = sessionId;
  if (executable) options.pathToClaudeCodeExecutable = executable;
  if (additionalDirectories?.length) options.additionalDirectories = additionalDirectories;
  // Settings › Agents: response style and commit credit (desktop/agent-behavior.cjs claudeSettingsFor), flag-layer settings.
  // Chats without a repository share one memory folder (desktop/agent-memory.cjs).
  if (memoryDir || (claudeSettings && typeof claudeSettings === 'object')) options.settings = { ...(memoryDir ? { autoMemoryDirectory: memoryDir } : {}), ...(claudeSettings || {}) };
  if (bridge?.url) {
    options.mcpServers = { [settings.MCP_SERVER_NAME]: settings.claudeMcpServer(bridge, access) };
    options.allowedTools = [`mcp__${settings.MCP_SERVER_NAME}__*`];
  }
  if (agentSettings) {
    const extra = agentAccess.claudeAccessOptions(agentSettings, { mcpServerName: settings.MCP_SERVER_NAME });
    if (extra.disallowedTools.length) options.disallowedTools = extra.disallowedTools;
    options.extraArgs = extra.extraArgs;
  }
  return options;
}

function codexThreadParams({ cwd, access, model, persona, directories }) {
  const policy = settings.codexPolicy(access);
  // Extra working directories (composer /add-dir) become writable roots of the workspace-write sandbox.
  const roots = policy.sandbox === 'workspace-write' && directories?.length ? { config: { 'sandbox_workspace_write.writable_roots': directories } } : {};
  return { cwd, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, ...(policy.approvalsReviewer ? { approvalsReviewer: policy.approvalsReviewer } : {}), ...(model ? { model } : {}), developerInstructions: persona, ...roots };
}

// ---------------------------------------------------------------------------------------------
// Optional MCP bridge (owned by another module; may not exist).
async function defaultBridge() {
  let mod;
  try { mod = require('./mcp-bridge.cjs'); } catch { return null; }
  try {
    const info = await (mod.getBridgeInfo?.());
    return info && typeof info.url === 'string' ? { url: info.url, token: typeof info.token === 'string' ? info.token : '' } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// Minimal newline-delimited JSON-RPC client for `codex app-server`.
class JsonRpcChild {
  constructor(child) {
    this.child = child; this.next = 1; this.pending = new Map(); this.listeners = new Set(); this.requestHandler = null; this.closed = false; this.stderr = '';
    let buffer = '';
    child.stdout.on('data', data => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (line) this.receive(line); }
      if (buffer.length > 16 * 1048576) buffer = '';
    });
    child.stderr?.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-8000); });
    const end = error => {
      if (this.closed) return; this.closed = true;
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error || Error('Codex app-server exited' + (this.stderr ? ': ' + this.stderr.trim().slice(-400) : ''))); }
      this.pending.clear();
      for (const listener of this.listeners) listener({ method: '$exit', params: { error: error?.message } });
    };
    child.on('error', end); child.on('close', () => end());
    child.stdin.on('error', () => {});
  }
  receive(line) {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && message.method) { this.handleRequest(message); return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(Error(message.error.message || 'Codex request failed')); else pending.resolve(message.result);
      return;
    }
    if (message.method) for (const listener of this.listeners) listener(message);
  }
  async handleRequest(message) {
    let result, error;
    try { if (!this.requestHandler) throw Error('Unsupported request'); result = await this.requestHandler(message); } catch (e) { error = { code: -32601, message: e.message || 'Unsupported request' }; }
    this.write(error ? { id: message.id, error } : { id: message.id, result });
  }
  write(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeout = 60000) {
    if (this.closed) return Promise.reject(Error('Codex app-server is not running'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`Codex ${method} timed out`)); }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  notify(method, params) { this.write(params === undefined ? { method } : { method, params }); }
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { try { this.child.stdin.end(); } catch {} agents.killTree(this.child); }
}

// ---------------------------------------------------------------------------------------------
class AgentRuntime {
  constructor({
    userData,
    getProject = () => null,
    resolveProject = null,
    emit = () => {},
    discover = agents.discover,
    loadClaudeSdk = () => import('@anthropic-ai/claude-agent-sdk'),
    spawnProcess = spawn,
    getBridge = defaultBridge,
    startFallback = agents.start,
    loadPreferences = defaultLoadPreferences,
    loadAccess = dir => agentAccess.loadAccessSettings(dir),
    home = agentMemory.resolveHome(),
    getBehavior = null,
  } = {}) {
    if (!userData) throw Error('userData directory required');
    Object.assign(this, { userData, getProject, resolveProject, emitRaw: emit, discover, loadClaudeSdk, spawnProcess, getBridge, startFallback, loadPreferences, loadAccess, home, getBehavior });
    this.runs = new Map(); this.pendingStarts = 0; this.permissions = new Map(); this.questions = new Map(); this.codex = null; this.codexSupport = new Map(); this.modelCache = new Map(); this.seq = 0;
    this.helpers = new Set(); this.allowRules = new AllowRules(path.join(userData, 'agent-allow-rules.json'));
  }
  get attachmentRoot() { return path.join(this.userData, 'agent-attachments'); }
  active() { return this.runs.size + this.pendingStarts; }
  /** Running chats, so the renderer can rebuild per-chat busy state. */
  list() { return [...this.runs.values()].map(r => ({ runId: r.id, chatId: r.chatId, agent: r.agent, runtime: r.runtime || null, steerable: !!r.steer })); }
  projectKey() { return this.getProject()?.root || 'unattached'; }
  emit(run, event) {
    if (run.sink) { run.sink(event); return; }
    this.emitRaw({ id: run.id, runId: run.id, chatId: run.chatId, conversationId: run.chatId, seq: ++this.seq, ...event });
  }

  /** `root`: a chat's own folder (repository root or chat worktree, validated by resolveProject); null = quick chat. */
  async workdir(chatId, root) {
    let project = this.getProject();
    if (root === null) project = null;
    else if (typeof root === 'string') {
      if (!this.resolveProject) throw Error('This runtime cannot run chats in a chosen folder');
      project = await this.resolveProject(root);
    }
    if (project) return { cwd: project.root, project, quickChat: false };
    const cwd = path.join(this.userData, 'agent-workdirs', chatId);
    await fs.mkdir(cwd, { recursive: true });
    return { cwd, project: null, quickChat: true };
  }

  async saveImage({ chatId, name, data } = {}) {
    if (typeof chatId !== 'string' || !ID.test(chatId)) throw Error('Invalid chat');
    if (typeof data !== 'string' || data.length > 11 * 1024 * 1024) throw Error('Images must be under 8 MB');
    const bytes = Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
    const type = IMAGE_TYPES.find(t => t.test(bytes));
    if (!type) throw Error('Only PNG, JPEG, GIF and WebP images can be attached');
    const dir = path.join(this.attachmentRoot, chatId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.${type.ext}`);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return { path: file, name: cleanText(name, 120) || path.basename(file), mime: type.mime };
  }

  async run(options = {}) {
    if (!options || !['codex', 'claude'].includes(options.agent) || typeof options.prompt !== 'string' || !options.prompt.trim()) throw Error('Choose an agent and enter a task');
    if (options.prompt.length > 200000) throw Error('Enter a prompt under 200,000 characters');
    const chatId = typeof options.chatId === 'string' && ID.test(options.chatId) ? options.chatId : randomUUID();
    const normalized = settings.normalizeOptions(settings.withDefaults(options.agent, options));
    if (this.active() >= MAX_RUNS) throw Error('Three agents are already running');
    if ([...this.runs.values()].some(r => r.chatId === chatId)) throw Error('This chat already has a running task');
    this.pendingStarts++;
    try {
      const found = (await this.discover()).find(a => a.id === options.agent && a.available);
      const { cwd, project, quickChat } = await this.workdir(chatId, options.root);
      const memory = project?.memory ? String(await project.memory().catch(() => '')).slice(0, 12000) : '';
      const bridge = await this.getBridge().catch(() => null);
      const preferences = await Promise.resolve().then(() => this.loadPreferences()).catch(() => []);
      const agentSettings = await Promise.resolve().then(() => this.loadAccess(this.userData)).then(agentAccess.normalizeAccessSettings).catch(() => ({ ...agentAccess.ACCESS_DEFAULTS }));
      const shared = agentSettings.shareMemory ? await agentAccess.sharedMemoryBlock(options.agent, { cwd, ...(this.home ? { home: this.home } : {}) }).catch(() => '') : '';
      const homeText = agentSettings.shareMemory ? '' : await agentMemory.homeInstructions(options.agent, { home: this.home }).catch(() => '');
      const memoryDir = quickChat && options.agent === 'claude' ? await agentMemory.repoLessMemoryDir(this.userData).catch(() => null) : null;
      const persona = [buildPersona({ bridge: !!bridge, quickChat, instructions: typeof options.instructions === 'string' ? options.instructions : '', memory, preferences, homeInstructions: homeText }), agentAccess.accessPersonaLines(agentSettings), shared].filter(Boolean).join('\n\n');
      const rawContext = options.context && typeof options.context === 'object' ? { ...options.context } : Array.isArray(options.mentions) ? {} : null;
      if (rawContext && Array.isArray(options.mentions)) rawContext.mentions = options.mentions;
      const context = normalizeContext(rawContext, this.attachmentRoot);
      const directories = await normalizeDirectories(options.directories, cwd);
      if (directories.length && context) context.directories = directories;
      let prompt = options.prompt;
      if (options.agent === 'codex' && isSlashCommand(prompt)) prompt = await agentCommands.expandCodexCommand(prompt, { home: this.home, cwd }).catch(() => prompt);
      // A seed replaces resume: the old session is not continued, its summary is prepended instead.
      const seed = typeof options.seed === 'string' && options.seed.trim() ? options.seed.slice(-SEED_LIMIT) : '';
      // A fork (rewind) replaces resume too; the seed then only serves as its fallback.
      const fork = normalizeFork(options.fork);
      const sessionId = seed || fork ? '' : normalized.sessionId;
      const run = { id: randomUUID(), chatId, agent: options.agent, cwd, projectKey: project?.root || 'unattached', stopped: false, done: false, sessionId: sessionId || null, cancel: () => {}, computerUse: options.agent === 'codex' && agentSettings.codexComputerUse };
      const params = { ...normalized, sessionId, seed, fork, run, cwd, persona, bridge, context, prompt, directories, executable: found?.path || null, quickChat, agentSettings, memoryDir };
      // Settings › Agents (desktop/agent-behavior.cjs): Claude response style + commit credit, Codex personality.
      const behavior = this.getBehavior ? await Promise.resolve().then(() => this.getBehavior()).catch(() => null) : null;
      if (behavior) { params.claudeSettings = agentBehavior.claudeSettingsFor(behavior); params.codexPersonality = agentBehavior.codexPersonalityFor(behavior); }
      this.runs.set(run.id, run);
      let runtime;
      try {
        if (options.agent === 'claude') runtime = await this.startClaude(params);
        else {
          if (!found) throw Error('Codex CLI is not installed');
          runtime = (await this.supportsAppServer(found.path)) ? await this.startCodex(params) : this.startCodexExec(params);
        }
      } catch (error) { this.runs.delete(run.id); throw error; }
      run.runtime = runtime;
      return { id: run.id, runId: run.id, chatId, runtime, cwd, quickChat, access: normalized.access, mcp: !!bridge, steerable: !!run.steer, seeded: !!params.seed, rewound: !!run.rewound };
    } finally { this.pendingStarts--; }
  }

  finish(run, { code = 0, error } = {}) {
    if (run.done) return; run.done = true;
    clearTimeout(run.settleTimer);
    for (const [requestId, pending] of this.permissions) if (pending.runId === run.id) pending.resolve(false, requestId);
    for (const pending of [...this.questions.values()]) if (pending.runId === run.id) pending.resolve(null);
    if (this.codex) for (const [threadId, child] of this.codex.children) if (child.run === run) this.codex.children.delete(threadId);
    if (error && !run.stopped) this.emit(run, { type: 'error', text: String(error).slice(0, 4000) });
    this.runs.delete(run.id);
    this.emit(run, { type: 'done', code: run.stopped ? 130 : code, stopped: run.stopped, ...(run.sessionId ? { sessionId: run.sessionId } : {}), ...(run.sessionId && run.resumeAt ? { resumeAt: run.resumeAt } : {}) });
  }

  forward(run, event) {
    if (event.type === 'session') run.sessionId = event.sessionId;
    if (event.type === 'error') { if (run.stopped) return; run.failed = true; }
    this.emit(run, event);
  }

  // --- permissions -----------------------------------------------------------------------------
  async askPermission(run, toolName, input, signal, { toolCallId, canAlwaysAllow = true } = {}) {
    if (run.helper) return false; // read-only helpers never get extra permissions
    if (await this.allowRules.matches(run.projectKey || 'unattached', toolName, input).catch(() => false)) return true;
    if (signal?.aborted || run.done) return false;
    const requestId = randomUUID();
    const always = canAlwaysAllow && !!allowRuleFor(toolName, input);
    return new Promise(resolve => {
      const timer = setTimeout(() => settle(false), PERMISSION_TIMEOUT); timer.unref?.();
      const settle = (allow, extra = {}) => {
        if (!this.permissions.has(requestId)) return;
        this.permissions.delete(requestId); clearTimeout(timer);
        if (!run.done) this.emit(run, { type: 'permission-resolved', requestId, allow, ...extra });
        resolve(allow);
      };
      this.permissions.set(requestId, { runId: run.id, projectKey: run.projectKey || 'unattached', toolName, input, canAlwaysAllow: always, resolve: settle });
      signal?.addEventListener?.('abort', () => settle(false), { once: true });
      this.emit(run, { type: 'permission-request', requestId, toolName, title: toolTitle(toolName, input || {}), input: input ?? {}, canAlwaysAllow: always, ...(toolCallId ? { toolCallId } : {}) });
    });
  }
  async respondPermission({ requestId, allow, always } = {}) {
    const pending = typeof requestId === 'string' && this.permissions.get(requestId);
    if (!pending) return { resolved: false };
    let rule = null;
    if (allow === true && always === true && pending.canAlwaysAllow) {
      rule = allowRuleFor(pending.toolName, pending.input);
      if (rule) await this.allowRules.add(pending.projectKey, rule).catch(() => { rule = null; });
    }
    pending.resolve(allow === true, rule ? { always: true, rule } : {});
    // Other waiting requests in the same project that the new rule covers are allowed as well.
    if (rule) for (const other of [...this.permissions.values()]) if (other.projectKey === pending.projectKey && ruleMatches(rule, other.toolName, other.input)) other.resolve(true, { always: true, rule });
    return { resolved: true, ...(rule ? { rule } : {}) };
  }
  async listAllowRules({ projectKey } = {}) {
    return { current: this.projectKey(), rules: await this.allowRules.list(typeof projectKey === 'string' ? projectKey : undefined) };
  }
  async removeAllowRule({ projectKey, rule } = {}) {
    if (typeof projectKey !== 'string' || typeof rule !== 'string') throw Error('Choose a rule to remove');
    return { removed: await this.allowRules.remove(projectKey, rule) };
  }

  // --- structured questions ----------------------------------------------------------------------
  /** Ask the user; resolves with {[questionId]: answer} or null when cancelled / timed out / stopped. */
  askQuestion(run, questions, { toolCallId, signal } = {}) {
    if (run.helper || run.done || signal?.aborted || !questions.length) return Promise.resolve(null);
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => settle(null), QUESTION_TIMEOUT); timer.unref?.();
      const settle = answers => {
        if (!this.questions.has(requestId)) return;
        this.questions.delete(requestId); clearTimeout(timer);
        if (!run.done) this.emit(run, { type: 'question-resolved', requestId, answers, cancelled: !answers });
        resolve(answers);
      };
      this.questions.set(requestId, { runId: run.id, questions, resolve: settle });
      signal?.addEventListener?.('abort', () => settle(null), { once: true });
      this.emit(run, { type: 'question-request', requestId, questions, ...(toolCallId ? { toolCallId } : {}) });
    });
  }
  respondQuestion({ runId, requestId, answers, cancel } = {}) {
    const pending = typeof requestId === 'string' && this.questions.get(requestId);
    if (!pending || (runId && runId !== pending.runId)) return { resolved: false };
    const known = new Set(pending.questions.map(q => q.id));
    const clean = Object.fromEntries(Object.entries(normalizeAnswers(answers)).filter(([id]) => known.has(id)));
    pending.resolve(cancel === true || !Object.keys(clean).length ? null : clean);
    return { resolved: true };
  }

  // --- steering ------------------------------------------------------------------------------------
  /** Deliver a follow-up into the running turn. {steered:true} or {queued:true} (renderer queues it). */
  async steer({ runId, chatId, text, images, mentions, context } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw Error('Enter a message');
    if (text.length > 200000) throw Error('Enter a message under 200,000 characters');
    const run = (typeof runId === 'string' && this.runs.get(runId)) || (typeof chatId === 'string' && [...this.runs.values()].find(r => r.chatId === chatId));
    if (!run || run.done) return { queued: true, reason: 'not-running' };
    if (!run.steer) return { queued: true, reason: 'unsupported' };
    const raw = { ...(context && typeof context === 'object' ? context : {}), images: Array.isArray(images) ? images : context?.images, mentions: Array.isArray(mentions) ? mentions : context?.mentions };
    const normalized = normalizeContext(raw, this.attachmentRoot);
    try { return await run.steer({ text: composePrompt(text, normalized), display: text, images: normalized?.images || [] }); }
    catch (error) { return { queued: true, reason: error?.message || 'steer failed' }; }
  }

  // --- Claude Agent SDK ------------------------------------------------------------------------
  async startClaude(params) {
    const { run } = params;
    let sdk;
    try { sdk = await this.loadClaudeSdk(); if (typeof sdk?.query !== 'function') throw Error('query() missing'); }
    catch {
      if (!params.executable) throw Error('Claude Code is not installed');
      return this.startClaudeCli(params);
    }
    if (params.fork) {
      if (await claudeForkPointExists(sdk, params.fork, params.cwd)) { run.rewound = true; params.seed = ''; }
      else { params.fork = null; this.emit(run, { type: 'status', text: REWIND_FALLBACK }); }
    }
    const abort = new AbortController();
    // Streaming input stays open for the whole run: interrupt() control requests and steering
    // messages (priority 'next', folded into the running turn) go through it.
    const pending = []; let wake = null, inputClosed = false, turnOpen = true;
    const endInput = () => { if (inputClosed) return; inputClosed = true; clearTimeout(run.settleTimer); wake?.(); };
    const armSettle = () => { clearTimeout(run.settleTimer); run.settleTimer = setTimeout(endInput, STEER_SETTLE_MS); run.settleTimer.unref?.(); };
    // A slash command must reach Claude Code as typed (a leading `/`), so the context preamble is left out.
    const content = isSlashCommand(params.prompt) ? params.prompt : await claudeContent(composePrompt(params.prompt, params.context, params.seed), params.context?.images);
    async function* input() {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
      for (;;) {
        while (pending.length) yield pending.shift();
        if (inputClosed) return;
        await new Promise(resolve => { wake = resolve; });
        wake = null;
      }
    }
    run.steerCount = 0;
    run.steer = async ({ text, display, images }) => {
      if (inputClosed || run.done || run.stopped) return { queued: true, reason: 'turn-ended' };
      pending.push({ type: 'user', message: { role: 'user', content: await claudeContent(text, images) }, parent_tool_use_id: null, priority: 'next' });
      run.steerCount++;
      if (!turnOpen) armSettle(); // the turn already reported its result: give the follow-up time to start
      wake?.();
      this.emit(run, { type: 'steer', text: display ?? text });
      return { steered: true };
    };
    let stderr = '';
    const options = {
      ...claudeQueryOptions({ cwd: params.cwd, access: params.access, model: params.model, effort: params.effort, sessionId: params.sessionId, fork: params.fork, persona: params.persona, bridge: params.bridge, executable: params.executable, additionalDirectories: [...(params.context?.images?.length ? [path.dirname(params.context.images[0])] : []), ...(params.directories || [])], agentSettings: params.agentSettings, claudeSettings: params.claudeSettings, memoryDir: params.memoryDir }),
      abortController: abort,
      ...this.claudeHooks(run, params),
      env: agents.childEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: `verynize/${VERSION}`, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', ...(params.agentSettings ? agentAccess.claudeAccessOptions(params.agentSettings).env : {}) }),
      stderr: data => { stderr = (stderr + data).slice(-8000); },
      canUseTool: (toolName, toolInput, opts = {}) => this.claudeCanUseTool(run, toolName, toolInput, opts),
    };
    const q = sdk.query({ prompt: input(), options });
    // Composer indicators (desktop/agent-live-status.cjs): live MCP status and context breakdown while the run is open.
    run.mcpStatus = () => q.mcpServerStatus();
    run.contextUsage = () => q.getContextUsage({ detail: 'summary' });
    run.cancel = async () => {
      if (run.done) return; run.stopped = true;
      try { await Promise.race([q.interrupt(), new Promise(r => setTimeout(r, 3000))]); } catch {}
      endInput();
      setTimeout(() => { if (!run.done) { abort.abort(); try { q.close?.(); } catch {} } }, 4000).unref?.();
    };
    const map = createClaudeMapper();
    (async () => {
      try {
        for await (const message of q) {
          if (message?.type === 'stream_event' || message?.type === 'assistant' || message?.type === 'user') { turnOpen = true; clearTimeout(run.settleTimer); }
          if (message?.type === 'system' && message.subtype === 'init' && Array.isArray(message.slash_commands)) this.rememberClaudeCommands(params.cwd, message.slash_commands.map(name => ({ name: String(name).replace(/^\//, '') })));
          if (message?.type === 'system' && message.subtype === 'commands_changed' && Array.isArray(message.commands)) this.rememberClaudeCommands(params.cwd, message.commands, true);
          // Last main-chain transcript entry: the fork point a later rewind to after this turn uses.
          if ((message?.type === 'assistant' || message?.type === 'user') && !message.parent_tool_use_id && typeof message.uuid === 'string' && FORK_ID.test(message.uuid)) run.resumeAt = message.uuid;
          for (const event of map(message)) {
            if (event.type === 'turn-complete') {
              // No follow-up was sent: the run is over. Otherwise wait for idle / a new turn.
              turnOpen = false;
              if (!run.steerCount || run.stopped) endInput(); else armSettle();
              continue;
            }
            if (event.type === 'turn-idle') {
              // Authoritative turn-over. Follow-ups still pending are flushed before the input closes,
              // and the CLI runs input it received before EOF, so closing here never drops one.
              if (!turnOpen) endInput();
              continue;
            }
            this.forward(run, event);
          }
        }
        this.finish(run, { code: run.failed ? 1 : 0 });
      } catch (error) {
        endInput();
        this.finish(run, { code: 1, error: run.stopped ? null : (error?.message || 'Claude session failed') + (stderr ? '\n' + stderr.trim().slice(-600) : '') });
      }
    })();
    return 'claude-sdk';
  }

  /** SDK hooks for a chat: the canvas turn guard, plus the "create files and pages" approval gate when that switch is off. */
  claudeHooks(run, params) {
    const hooks = params.bridge?.url ? designHooks(createDesignTurnGuard()) : {};
    if (params.agentSettings && !params.agentSettings.createFiles && params.access !== 'full') {
      hooks.PreToolUse = [...(hooks.PreToolUse || []), { hooks: [async (input = {}, toolUseID, opts = {}) => {
        if (!(await agentAccess.claudeCreatesSomething(input.tool_name, input.tool_input || {}, { mcpServerName: settings.MCP_SERVER_NAME, cwd: params.cwd }))) return {};
        const allow = await this.askPermission(run, input.tool_name, input.tool_input || {}, opts.signal, { toolCallId: toolUseID, canAlwaysAllow: false });
        return allow ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } } : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The user did not allow creating this in Verynize. Ask before creating new files, folders or pages.' } };
      }] }];
    }
    return Object.keys(hooks).length ? { hooks } : {};
  }

  async claudeCanUseTool(run, toolName, toolInput, opts = {}) {
    if (toolName === 'AskUserQuestion') {
      const questions = claudeQuestions(toolInput);
      const answers = await this.askQuestion(run, questions, { toolCallId: opts.toolUseID, signal: opts.signal });
      if (!answers) return { behavior: 'deny', message: run.stopped ? 'The user stopped the task.' : 'The user did not answer the question. Continue with your best judgment and state the assumption you made.' };
      return { behavior: 'allow', updatedInput: claudeAnswerInput(toolInput, questions, answers) };
    }
    const allow = await this.askPermission(run, toolName, toolInput, opts.signal, { toolCallId: opts.toolUseID, canAlwaysAllow: !opts.suppressAlwaysAllowRule });
    return allow ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: 'The user declined this action in Verynize.' };
  }

  startClaudeCli(params) {
    const { run } = params;
    const handle = this.startFallback(params.executable, 'claude', composePrompt(params.prompt, params.context, params.seed), params.cwd, event => {
      if (event.type === 'done') { run.stopped = run.stopped || event.stopped; this.finish(run, { code: event.code }); return; }
      const { id: _id, ...rest } = event; this.forward(run, rest);
    }, { model: params.model, access: params.access, effort: params.effort, sessionId: params.sessionId, structured: true, appendSystemPrompt: params.persona, bridge: params.bridge, id: run.id, claudeSettings: params.claudeSettings, ...(params.agentSettings ? (({ env, cliArgs }) => ({ env, extraArgs: cliArgs }))(agentAccess.claudeAccessOptions(params.agentSettings)) : {}) });
    run.cancel = () => { run.stopped = true; handle.cancel(); };
    return 'claude-cli';
  }

  // --- Codex -----------------------------------------------------------------------------------
  supportsAppServer(executable) {
    if (!this.codexSupport.has(executable)) {
      this.codexSupport.set(executable, new Promise(resolve => {
        let output = '', child;
        try { child = this.spawnProcess(executable, ['app-server', '--help'], { env: agents.childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); } catch { resolve(false); return; }
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(false); }, 8000);
        const read = d => { output = (output + d).slice(0, 20000); };
        child.stdout?.on('data', read); child.stderr?.on('data', read);
        child.on('error', () => { clearTimeout(timer); resolve(false); });
        child.on('close', code => { clearTimeout(timer); resolve(code === 0 && /app server|app-server/i.test(output)); });
      }));
    }
    return this.codexSupport.get(executable);
  }

  async codexServer(executable, bridge, extraArgs = []) {
    const key = executable + '|' + (bridge?.url || '') + '|' + extraArgs.join(' ');
    if (this.codex && !this.codex.rpc.closed && this.codex.key === key) return this.codex;
    if (this.codex && !this.codex.rpc.closed && ([...this.runs.values()].some(r => r.runtime === 'codex-app-server' && !r.done) || [...this.helpers].some(h => h.agent === 'codex'))) return this.codex;
    this.codex?.rpc.close();
    const env = agents.childEnv(bridge?.token ? { [settings.MCP_TOKEN_ENV]: bridge.token } : {});
    const child = this.spawnProcess(executable, ['app-server', ...settings.codexMcpArgs(bridge), ...extraArgs], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const rpc = new JsonRpcChild(child);
    // threads: main thread id -> run. children: subagent thread id -> {run, map} (collabAgentToolCall).
    const server = { key, rpc, threads: new Map(), children: new Map() };
    rpc.requestHandler = message => this.codexRequest(server, message);
    const link = (run, { toolCallId, threadIds }) => {
      for (const id of threadIds) if (typeof id === 'string' && !server.threads.has(id) && !server.children.has(id)) server.children.set(id, { run, map: createCodexMapper({ parentToolCallId: toolCallId }) });
    };
    rpc.on(message => {
      if (message.method === '$exit') { for (const run of server.threads.values()) this.finish(run, { code: 1, error: 'Codex app-server stopped unexpectedly' }); server.threads.clear(); server.children.clear(); return; }
      if (message.method === 'account/rateLimits/updated' || (message.method === 'mcpServer/startupStatus/updated' && !message.params?.threadId)) { // account-wide: every running chat gets it
        for (const run of new Set(server.threads.values())) if (!run.done && !run.helper) for (const event of run.map(message)) this.forward(run, event);
        return;
      }
      const threadId = message.params?.threadId || message.params?.thread?.id;
      const child = threadId && server.children.get(threadId);
      if (child) {
        if (child.run.done) { server.children.delete(threadId); return; }
        for (const event of child.map(message)) { if (event.type === 'subagent-threads') link(child.run, event); else this.forward(child.run, event); }
        return;
      }
      const run = threadId && server.threads.get(threadId);
      if (!run || run.done) return;
      for (const event of run.map(message)) {
        if (event.type === 'turn-complete') {
          const turnId = message.params?.turn?.id || run.turnId;
          if (typeof turnId === 'string' && FORK_ID.test(turnId)) run.resumeAt = turnId;
          server.threads.delete(threadId); this.finish(run, { code: event.ok || event.interrupted ? 0 : 1 }); continue;
        }
        if (event.type === 'subagent-threads') { link(run, event); continue; }
        if (event.type === 'session') continue; // emitted when the thread is opened
        this.forward(run, event);
      }
    });
    this.codex = server;
    await rpc.request('initialize', { clientInfo: { name: 'verynize', title: 'Verynize', version: VERSION }, capabilities: { experimentalApi: true } }, 20000);
    rpc.notify('initialized');
    return server;
  }

  async codexRequest(server, { method, params = {} }) {
    const run = server.threads.get(params.threadId) || server.children.get(params.threadId)?.run;
    if (!run) throw Error('Unknown thread');
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const allow = await this.askPermission(run, 'shell', { command: params.command, cwd: params.cwd, reason: params.reason });
      return { decision: allow ? 'accept' : 'decline' };
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      const allow = await this.askPermission(run, 'edit', { reason: params.reason, grantRoot: params.grantRoot });
      return { decision: allow ? 'accept' : 'decline' };
    }
    if (method === 'mcpServer/elicitation/request') {
      const allow = await this.askPermission(run, `mcp__${params.serverName || 'server'}__elicitation`, { message: params.message });
      return { action: allow ? 'accept' : 'decline', content: null, _meta: null };
    }
    if (method === 'item/tool/requestUserInput') {
      const questions = codexQuestions(params);
      const answers = await this.askQuestion(run, questions, { toolCallId: params.itemId });
      return codexAnswers(questions, answers);
    }
    throw Error('Verynize does not handle ' + method);
  }

  async startCodex(params) {
    const { run } = params;
    const server = await this.codexServer(params.executable, params.bridge, params.agentSettings ? agentAccess.codexAccessArgs(params.agentSettings, { mcpServerName: settings.MCP_SERVER_NAME, bridge: !!params.bridge?.url }) : []);
    const threadParams = codexThreadParams(params);
    let thread;
    if (params.fork) {
      try { thread = (await server.rpc.request('thread/fork', { threadId: params.fork.sessionId, lastTurnId: params.fork.at, ...threadParams, excludeTurns: true })).thread; }
      catch {}
      if (thread?.id) { run.rewound = true; params.seed = ''; }
      else { thread = null; this.emit(run, { type: 'status', text: REWIND_FALLBACK }); }
    }
    if (!thread && params.sessionId) {
      try { thread = (await server.rpc.request('thread/resume', { threadId: params.sessionId, ...threadParams })).thread; }
      catch { this.emit(run, { type: 'status', text: 'Could not resume the previous Codex thread; starting a new one.' }); }
    }
    if (!thread) thread = (await server.rpc.request('thread/start', params.codexPersonality ? { ...threadParams, personality: params.codexPersonality } : threadParams)).thread;
    run.threadId = thread.id; run.map = createCodexMapper();
    run.mcpStatus = () => server.rpc.request('mcpServerStatus/list', { threadId: thread.id, detail: 'toolsAndAuthOnly' }, 15000);
    server.threads.set(thread.id, run);
    this.forward(run, { type: 'session', sessionId: thread.id });
    const input = codexInput(composePrompt(params.prompt, params.context, params.seed), params.context?.images);
    try {
      const response = await server.rpc.request('turn/start', { threadId: thread.id, input, ...(params.model ? { model: params.model } : {}), ...(params.effort ? { effort: params.effort } : {}) });
      run.turnId = response?.turn?.id;
    } catch (error) { server.threads.delete(thread.id); this.finish(run, { code: 1, error: error.message }); return 'codex-app-server'; }
    run.steer = async ({ text, display, images }) => {
      if (run.done || run.stopped || !run.turnId) return { queued: true, reason: 'turn-ended' };
      try {
        const result = await server.rpc.request('turn/steer', { threadId: thread.id, expectedTurnId: run.turnId, input: codexInput(text, images) }, 15000);
        if (typeof result?.turnId === 'string') run.turnId = result.turnId;
      } catch (error) { return { queued: true, reason: error.message }; }
      this.emit(run, { type: 'steer', text: display ?? text });
      return { steered: true };
    };
    run.cancel = async () => {
      if (run.done) return; run.stopped = true;
      try { if (run.turnId) await server.rpc.request('turn/interrupt', { threadId: thread.id, turnId: run.turnId }, 5000); } catch {}
      setTimeout(() => { if (!run.done) { server.threads.delete(thread.id); this.finish(run, { code: 130 }); } }, 5000).unref?.();
    };
    return 'codex-app-server';
  }

  startCodexExec(params) {
    const { run } = params;
    const prompt = [params.persona, composePrompt(params.prompt, params.context, params.seed)].join('\n\n');
    const handle = this.startFallback(params.executable, 'codex', prompt, params.cwd, event => {
      if (event.type === 'done') { run.stopped = run.stopped || event.stopped; this.finish(run, { code: event.code }); return; }
      const { id: _id, ...rest } = event; this.forward(run, rest);
    }, { model: params.model, access: params.access, effort: params.effort, structured: true, bridge: params.bridge, id: run.id, codexPersonality: params.codexPersonality, ...(params.agentSettings ? { extraArgs: agentAccess.codexAccessArgs(params.agentSettings, { mcpServerName: settings.MCP_SERVER_NAME, bridge: !!params.bridge?.url }) } : {}) });
    run.cancel = () => { run.stopped = true; handle.cancel(); };
    return 'codex-exec';
  }

  cancel(id) {
    const run = this.runs.get(id);
    if (!run) return false;
    Promise.resolve(run.cancel()).catch(() => {});
    return true;
  }

  /** Stop running Codex chats that were started with Computer Use (the switch was turned off). */
  stopComputerUse() {
    const stopped = [];
    for (const run of this.runs.values()) if (run.computerUse && !run.done) { stopped.push(run.id); this.emit(run, { type: 'status', text: 'Computer Use was turned off in Settings; stopping this chat.' }); this.cancel(run.id); }
    return stopped;
  }

  // --- one-shot helper runs (ask_agent reviewer, chat titles) ---------------------------------------
  /** `ask_agent` from a chat's agent: allowed only while "Let agents ask other agents" is on. */
  async askTool(options = {}) {
    const agentSettings = agentAccess.normalizeAccessSettings(await Promise.resolve().then(() => this.loadAccess(this.userData)).catch(() => null));
    if (!agentSettings.askAgents) throw Error('Asking other agents is turned off in Verynize (Settings › Agents › Access › Let agents ask other agents). Continue on your own.');
    return this.ask(options);
  }

  /** Nested read-only run for the `ask_agent` MCP tool. Resolves {text, agent, model}. */
  async ask({ agent, task, cwd } = {}) {
    if (!['claude', 'codex'].includes(agent)) throw Error('agent must be "claude" or "codex"');
    if (typeof task !== 'string' || !task.trim()) throw Error('Describe the task for the helper agent');
    if (task.length > 100000) throw Error('Keep the helper task under 100,000 characters');
    if (this.helpers.size >= MAX_HELPERS) throw Error('Two helper agents are already running; wait for one to finish');
    const found = (await this.discover()).find(a => a.id === agent && a.available);
    if (!found) throw Error(`${agent === 'claude' ? 'Claude Code' : 'Codex'} is not installed`);
    let dir = null;
    if (typeof cwd === 'string' && path.isAbsolute(cwd)) { try { if ((await fs.stat(cwd)).isDirectory()) dir = cwd; } catch {} }
    if (!dir) dir = this.getProject()?.root || null;
    if (!dir) { dir = path.join(this.userData, 'agent-workdirs', 'helper'); await fs.mkdir(dir, { recursive: true }); }
    const bridge = await this.getBridge().catch(() => null);
    const { model, effort } = settings.withDefaults(agent, {});
    const system = HELPER_PERSONA + (bridge ? '' : ' The canvas tools are not connected in this session.');
    const result = await this.oneShot({ agent, found, prompt: task, system, model, effort, cwd: dir, bridge, timeout: HELPER_TIMEOUT, purpose: 'review' });
    return { text: result.text || '(The helper agent returned no answer.)', agent, model: result.model || model || '' };
  }

  /**
   * Second opinion on the latest turn: `answer` (and, with includeDiff, the project's uncommitted
   * git diff) goes to `agent` (normally the other provider) as a read-only helper run. Falls back
   * to the other installed provider when the requested one is missing. Resolves
   * {text, agent, model, requested, diff}.
   */
  async review({ agent, author, request, answer, includeDiff = true } = {}) {
    if (!['claude', 'codex'].includes(agent)) throw Error('agent must be "claude" or "codex"');
    if (typeof answer !== 'string' || !answer.trim()) throw Error('There is no answer to review yet');
    const installed = (await this.discover()).filter(a => a.available).map(a => a.id);
    const chosen = installed.includes(agent) ? agent : installed.find(id => id === 'claude' || id === 'codex');
    if (!chosen) throw Error('Install Claude Code or Codex to get a second opinion');
    const root = this.getProject()?.root || null;
    const diff = includeDiff !== false && root ? await this.gitDiff(root) : '';
    const task = buildReviewTask({ request: typeof request === 'string' ? request : '', answer, diff, author: ['claude', 'codex'].includes(author) ? (author === 'claude' ? 'Claude' : 'Codex') : '' });
    const result = await this.ask({ agent: chosen, task, ...(root ? { cwd: root } : {}) });
    return { ...result, requested: agent, diff: !!diff };
  }

  /** `git status --short` + `git diff HEAD` of a project, bounded; '' when it is not a repository. */
  gitDiff(root) {
    const git = args => new Promise(resolve => {
      let out = '', child;
      try { child = this.spawnProcess('git', ['-C', root, ...args], { env: agents.childEnv({ GIT_OPTIONAL_LOCKS: '0' }), stdio: ['ignore', 'pipe', 'ignore'] }); } catch { resolve(''); return; }
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(''); }, 10000);
      timer.unref?.();
      child.stdout?.on('data', d => { if (out.length < 400000) out += d; });
      child.on('error', () => { clearTimeout(timer); resolve(''); });
      child.on('close', code => { clearTimeout(timer); resolve(code === 0 ? out : ''); });
    });
    return Promise.all([git(['status', '--short']), git(['diff', 'HEAD', '--no-color', '--no-ext-diff'])]).then(([status, diff]) => {
      if (!status.trim() && !diff.trim()) return '';
      return (status.trim() ? 'git status --short:\n' + status.replace(/^\n+|\s+$/g, '') + '\n\n' : '') + (diff.trim() ? diff.trim() : '(no tracked changes)');
    });
  }

  /** Short chat title for the first message. Never throws; falls back to a heuristic title. */
  async title({ agent, text } = {}) {
    const fallback = { title: heuristicTitle(text), source: 'heuristic' };
    if (!['claude', 'codex'].includes(agent) || typeof text !== 'string' || !text.trim()) return fallback;
    try {
      const found = (await this.discover()).find(a => a.id === agent && a.available);
      if (!found) return fallback;
      if (agent === 'codex' && !(await this.supportsAppServer(found.path))) return fallback;
      const dir = path.join(this.userData, 'agent-workdirs', 'titles');
      await fs.mkdir(dir, { recursive: true });
      const prompt = 'Write a 3 to 6 word title for a design chat that starts with the message below. Reply with the title only: no quotes, no trailing punctuation, no explanation.\n\n<message>\n' + text.slice(0, 4000) + '\n</message>';
      const result = await this.oneShot({ agent, found, prompt, system: 'You write short, specific titles for chat conversations.', model: agent === 'claude' ? TITLE_MODEL : '', effort: 'low', cwd: dir, bridge: null, timeout: TITLE_TIMEOUT, purpose: 'title' });
      const title = cleanTitle(result.text);
      return title ? { title, source: agent, model: result.model || '' } : fallback;
    } catch { return fallback; }
  }

  async oneShot({ agent, ...options }) {
    const helper = { agent };
    this.helpers.add(helper);
    try { return agent === 'claude' ? await this.claudeOneShot(options) : await this.codexOneShot(options); }
    finally { this.helpers.delete(helper); }
  }

  async claudeOneShot({ found, prompt, system, model, effort, cwd, bridge, timeout, purpose }) {
    const sdk = await this.loadClaudeSdk();
    if (typeof sdk?.query !== 'function') throw Error('Claude Agent SDK is unavailable');
    const abort = new AbortController();
    let release; const released = new Promise(resolve => { release = resolve; });
    async function* input() { yield { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, parent_tool_use_id: null }; await released; }
    const review = purpose === 'review';
    const options = {
      cwd, abortController: abort, permissionMode: 'default', persistSession: false,
      maxTurns: review ? 40 : 1,
      env: agents.childEnv({ CLAUDE_AGENT_SDK_CLIENT_APP: `verynize/${VERSION}` }),
      canUseTool: async () => ({ behavior: 'deny', message: 'This read-only helper cannot use that tool.' }),
      ...(found?.path ? { pathToClaudeCodeExecutable: found.path } : {}),
      ...(model ? { model } : {}), ...(effort ? { effort } : {}),
    };
    if (review) {
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: system };
      options.tools = ['Read', 'Glob', 'Grep'];
      options.disallowedTools = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent', 'Task', 'AskUserQuestion', ...HELPER_BLOCKED_DESIGN_TOOLS.map(name => `mcp__${settings.MCP_SERVER_NAME}__${name}`)];
      options.allowedTools = ['Read', 'Glob', 'Grep'];
      if (bridge?.url) { options.mcpServers = { [settings.MCP_SERVER_NAME]: settings.claudeMcpServer(bridge, 'readonly') }; options.allowedTools.push(`mcp__${settings.MCP_SERVER_NAME}__*`); }
    } else {
      options.systemPrompt = system;
      options.tools = [];
      options.settingSources = [];
    }
    const q = sdk.query({ prompt: input(), options });
    let timer;
    const timedOut = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Helper agent timed out after ${Math.round(timeout / 1000)}s`)), timeout); timer.unref?.(); });
    const collect = (async () => {
      let text = '', streamed = '', resolvedModel = model || '';
      for await (const message of q) {
        if (message?.type === 'system' && message.subtype === 'init' && message.model) resolvedModel = message.model;
        if (message?.type === 'assistant' && !message.parent_tool_use_id) for (const part of message.message?.content || []) if (part?.type === 'text' && part.text) streamed = part.text;
        if (message?.type === 'result') {
          if (message.is_error || (message.subtype && message.subtype !== 'success')) throw Error((Array.isArray(message.errors) && message.errors.join('\n')) || message.result || 'Helper agent failed');
          text = typeof message.result === 'string' && message.result ? message.result : streamed;
          break;
        }
      }
      return { text, model: resolvedModel };
    })();
    try { return await Promise.race([collect, timedOut]); }
    finally { clearTimeout(timer); release(); try { q.close?.(); } catch {} abort.abort(); }
  }

  async codexOneShot({ found, prompt, system, model, effort, cwd, bridge, timeout, purpose }) {
    if (!(await this.supportsAppServer(found.path))) throw Error('This Codex CLI does not support app-server');
    // One app-server serves every Codex thread; keep it configured with the canvas bridge.
    const server = await this.codexServer(found.path, bridge || await this.getBridge().catch(() => null));
    const base = { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, developerInstructions: system, ...(model ? { model } : {}) };
    let thread, resolvedModel = model || '';
    const config = purpose === 'review' ? { [`mcp_servers.${settings.MCP_SERVER_NAME}.disabled_tools`]: HELPER_BLOCKED_DESIGN_TOOLS } : null;
    try { const r = await server.rpc.request('thread/start', config ? { ...base, config } : base); thread = r.thread; resolvedModel = r.model || resolvedModel; }
    catch (error) { if (!config) throw error; const r = await server.rpc.request('thread/start', base); thread = r.thread; resolvedModel = r.model || resolvedModel; }
    let text = '', finalText = '', finished;
    const done = new Promise(resolve => { finished = resolve; });
    const run = { id: randomUUID(), chatId: 'helper', agent: 'codex', helper: true, projectKey: 'helper', done: false, stopped: false, map: createCodexMapper(), sink: event => {
      if (event.type === 'assistant-text-delta') text += event.text;
      else if (event.type === 'assistant-text') finalText = event.text;
      else if (event.type === 'error') run.error = event.text;
      else if (event.type === 'done') finished(event);
    } };
    server.threads.set(thread.id, run);
    let timer;
    try {
      const response = await server.rpc.request('turn/start', { threadId: thread.id, input: codexInput(prompt), ...(effort ? { effort } : {}), ...(model ? { model } : {}) });
      run.turnId = response?.turn?.id;
      const outcome = await Promise.race([done, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), timeout); timer.unref?.(); })]);
      if (outcome.timeout) {
        try { if (run.turnId) await server.rpc.request('turn/interrupt', { threadId: thread.id, turnId: run.turnId }, 5000); } catch {}
        throw Error(`Helper agent timed out after ${Math.round(timeout / 1000)}s`);
      }
      if (outcome.code !== 0) throw Error(run.error || 'Helper agent failed');
      return { text: (finalText || text).trim(), model: resolvedModel };
    } finally {
      clearTimeout(timer);
      server.threads.delete(thread.id);
      run.done = true;
    }
  }

  // --- model lists -----------------------------------------------------------------------------
  async models({ agent } = {}) {
    if (!['codex', 'claude'].includes(agent)) throw Error('Choose Codex or Claude');
    if (this.modelCache.has(agent)) return this.modelCache.get(agent);
    const found = (await this.discover()).find(a => a.id === agent && a.available);
    if (!found) return [];
    let list = [];
    if (agent === 'claude') {
      const sdk = await this.loadClaudeSdk();
      const abort = new AbortController();
      let release; const hold = new Promise(r => { release = r; });
      const q = sdk.query({ prompt: (async function* () { await hold; })(), options: { pathToClaudeCodeExecutable: found.path, abortController: abort, env: agents.childEnv(), cwd: this.userData } });
      try {
        const models = await Promise.race([q.supportedModels(), new Promise((_, reject) => setTimeout(() => reject(Error('Model list timed out')), 20000))]);
        list = models.map(m => ({ id: m.value, name: m.displayName || m.value, description: m.description || '', efforts: m.supportedEffortLevels || [] }));
      } finally { release(); try { q.close?.(); } catch {} abort.abort(); }
    } else if (await this.supportsAppServer(found.path)) {
      const server = await this.codexServer(found.path, await this.getBridge().catch(() => null));
      const result = await server.rpc.request('model/list', {}, 20000);
      list = (result?.data || []).filter(m => !m.hidden).map(m => ({ id: m.model || m.id, name: m.displayName || m.id, description: m.description || '', efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort) }));
    }
    this.modelCache.set(agent, list);
    return list;
  }

  // --- slash commands (desktop/agent-commands.cjs) ----------------------------------------------
  /** Commands Claude Code reported for `cwd` (init `slash_commands`, commands_changed or supportedCommands()). */
  rememberClaudeCommands(cwd, list, replace = false) {
    if (!this.claudeCommandCache) this.claudeCommandCache = new Map();
    const key = cwd || '';
    const previous = this.claudeCommandCache.get(key);
    const known = replace ? [] : previous?.list || [];
    const merged = agentCommands.mergeCommands(list.map(c => ({ name: c.name, description: c.description || '', argumentHint: c.argumentHint || '', source: c.builtin ? 'builtin' : 'agent' })), known);
    this.claudeCommandCache.set(key, { list: merged, full: replace || !!previous?.full });
  }

  /** Claude Code's own command list (built-ins, plugins, MCP prompts, skills) for `cwd`; waits at most ~3s. */
  async claudeCommands(cwd) {
    if (!this.claudeCommandCache) this.claudeCommandCache = new Map();
    if (!this.claudeCommandLoads) this.claudeCommandLoads = new Map();
    const key = cwd || '';
    const cached = this.claudeCommandCache.get(key);
    if (cached?.full) return cached.list;
    let load = this.claudeCommandLoads.get(key);
    if (!load) {
      load = (async () => {
        const found = (await this.discover()).find(a => a.id === 'claude' && a.available);
        if (!found) return [];
        const sdk = await this.loadClaudeSdk();
        const abort = new AbortController();
        let release; const hold = new Promise(r => { release = r; });
        const env = agents.childEnv(this.home && this.home !== os.homedir() ? { HOME: this.home } : {});
        const q = sdk.query({ prompt: (async function* () { await hold; })(), options: { pathToClaudeCodeExecutable: found.path, abortController: abort, env, cwd: cwd || this.userData } });
        try {
          const list = await Promise.race([q.supportedCommands(), new Promise((_, reject) => setTimeout(() => reject(Error('Command list timed out')), 20000).unref?.())]);
          this.rememberClaudeCommands(key, list, true);
          return this.claudeCommandCache.get(key).list;
        } finally { release(); try { q.close?.(); } catch {} abort.abort(); }
      })().catch(() => []).finally(() => this.claudeCommandLoads.delete(key));
      this.claudeCommandLoads.set(key, load);
    }
    const quick = await Promise.race([load, new Promise(r => setTimeout(() => r(null), 3000).unref?.())]);
    return quick || this.claudeCommandCache.get(key)?.list || [];
  }

  close() {
    for (const run of this.runs.values()) { try { run.cancel(); } catch {} }
    this.codex?.rpc.close(); this.codex = null;
  }
}

// IPC surface (all `desktop:<name>`, exposed by desktop/preload.cjs).
function registerAgentRuntime(handle, win, { userData, getProject, resolveProject, getBehavior = null }) {
  const runtime = new AgentRuntime({ userData, getProject, resolveProject, getBehavior, emit: event => { if (!win.isDestroyed()) win.webContents.send('desktop:agent-event', event); } });
  handle('runAgent', options => runtime.run(options));
  handle('cancelAgent', id => runtime.cancel(id));
  handle('listAgentRuns', () => runtime.list());
  handle('respondAgentPermission', options => runtime.respondPermission(options));
  handle('respondAgentQuestion', options => runtime.respondQuestion(options));
  handle('steerAgent', options => runtime.steer(options));
  handle('listAllowRules', options => runtime.listAllowRules(options));
  handle('removeAllowRule', options => runtime.removeAllowRule(options));
  handle('agentToolsVersion', () => agentToolsVersion());
  handle('agentTitle', options => runtime.title(options));
  handle('reviewAgent', options => runtime.review(options));
  handle('listAgentModels', options => runtime.models(options));
  handle('saveAgentImage', options => runtime.saveImage(options));
  handle('designPreferencesList', async () => { try { return await (await preferenceStore()).list(); } catch { return []; } });
  handle('designPreferencesSave', async text => (await preferenceStore()).save(validPreference(text)));
  handle('designPreferencesUpdate', async (id, text) => (await preferenceStore()).update(validPreferenceId(id), validPreference(text)));
  handle('designPreferencesRemove', async id => (await preferenceStore()).remove(validPreferenceId(id)));
  win.on('closed', () => runtime.close());
  return runtime;
}
function validPreference(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw Error('Enter a preference under 2,000 characters');
  return text.trim();
}
function validPreferenceId(id) {
  if (typeof id !== 'string' || !id || id.length > 200) throw Error('Invalid preference');
  return id;
}

/** Whether `fork.at` is an entry of the saved Claude session (read from its local transcript). */
async function claudeForkPointExists(sdk, fork, cwd) {
  if (typeof sdk?.getSessionMessages !== 'function') return true; // the CLI validates the fork itself
  try {
    const messages = await sdk.getSessionMessages(fork.sessionId, { dir: cwd, includeSystemMessages: true });
    return Array.isArray(messages) && messages.some(m => m?.uuid === fork.at);
  } catch { return false; }
}

function codexInput(text, images = []) {
  return [{ type: 'text', text, text_elements: [] }, ...(images || []).map(p => ({ type: 'localImage', path: p }))];
}
async function claudeContent(text, images = []) {
  const content = [{ type: 'text', text }];
  for (const image of images || []) {
    try {
      const bytes = await fs.readFile(image);
      const type = IMAGE_TYPES.find(t => t.test(bytes));
      if (type && bytes.length <= 5 * 1024 * 1024) content.push({ type: 'image', source: { type: 'base64', media_type: type.mime, data: bytes.toString('base64') } });
    } catch {}
  }
  return content;
}

module.exports = {
  AgentRuntime, registerAgentRuntime, buildPersona, createDesignTurnGuard, designHooks, toolOutcome, STOP_REASON, buildTurnContext, normalizeContext, composePrompt, buildSeedBlock, claudeQueryOptions, codexThreadParams, JsonRpcChild, defaultBridge,
  claudeQuestions, claudeAnswerInput, codexQuestions, codexAnswers, normalizeAnswers, allowRuleFor, ruleMatches, AllowRules, heuristicTitle, cleanTitle, agentToolsVersion, preferenceStore, MAX_RUNS,
  normalizeFork, buildReviewTask,
};
