#!/usr/bin/env node
// Deterministic stand-in for the `codex` CLI used by agent tests. Never calls a model.
//  codex app-server --help     -> advertises app-server support (unless FAKE_CODEX_NO_APP_SERVER=1)
//  codex app-server [...]      -> newline-delimited JSON-RPC server
//  codex exec ... -            -> legacy one-shot JSONL output
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.FAKE_CODEX_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ args, token: process.env.VERYNIZE_MCP_TOKEN || null }) + '\n');

if (args[0] === 'app-server' && args.includes('--help')) {
  if (process.env.FAKE_CODEX_NO_APP_SERVER === '1') { console.error('unrecognized subcommand'); process.exit(2); }
  console.log('[experimental] Run the app server or related tooling');
  process.exit(0);
}

if (args[0] === 'exec') {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', () => {
    const out = o => console.log(JSON.stringify(o));
    out({ type: 'thread.started', thread_id: 'exec-thread' });
    out({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Exec reply ARGS ' + JSON.stringify(args) + ' PROMPT ' + input.slice(-400) } });
    out({ type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 3 } });
  });
  return;
}

if (args[0] !== 'app-server') { console.error('fake codex: unsupported'); process.exit(2); }

let buffer = '', nextServerId = 1000;
const pendingServer = new Map();
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => send({ method, params });
const turns = new Map();

function completeTurn(threadId, turnId, status) {
  if (!turns.has(turnId)) return;
  turns.delete(turnId);
  notify('turn/completed', { threadId, turn: { id: turnId, status, error: null, items: [] } });
}

async function runTurn(threadId, turnId, text, images) {
  notify('turn/started', { threadId, turn: { id: turnId } });
  if (/slow/.test(text)) { notify('item/agentMessage/delta', { threadId, turnId, itemId: 'msg-slow', delta: 'Thinking slowly…' }); return; }
  notify('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: 'r1', delta: 'Plan the change.', summaryIndex: 0 });
  notify('item/started', { threadId, turnId, item: { type: 'commandExecution', id: 'cmd-1', command: 'ls', cwd: '/tmp', status: 'inProgress' } });
  let declined = false;
  if (/approve/.test(text)) {
    const id = nextServerId++;
    const decision = await new Promise(resolve => { pendingServer.set(id, resolve); send({ id, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd-1', command: 'ls' } }); });
    declined = decision?.decision !== 'accept';
  }
  notify('item/completed', { threadId, turnId, item: { type: 'commandExecution', id: 'cmd-1', command: 'ls', cwd: '/tmp', status: declined ? 'declined' : 'completed', aggregatedOutput: declined ? '' : 'hello.txt\n', exitCode: declined ? null : 0 } });
  notify('item/started', { threadId, turnId, item: { type: 'mcpToolCall', id: 'mcp-1', server: 'verynize', tool: 'get_design_context', arguments: { pageId: 'page-1' }, status: 'inProgress' } });
  notify('item/completed', { threadId, turnId, item: { type: 'mcpToolCall', id: 'mcp-1', server: 'verynize', tool: 'get_design_context', arguments: { pageId: 'page-1' }, status: 'completed', result: { content: [{ type: 'text', text: 'page ok' }] }, error: null } });
  const reply = `Reply to ${JSON.stringify(text.slice(-300))} images=${images.length} declined=${declined}`;
  for (const part of [reply.slice(0, 9), reply.slice(9)]) notify('item/agentMessage/delta', { threadId, turnId, itemId: 'msg-1', delta: part });
  notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: 'msg-1', text: reply } });
  notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { last: { inputTokens: 5, outputTokens: 7 } } });
  completeTurn(threadId, turnId, 'completed');
}

let threadCount = 0;
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (log) fs.appendFileSync(log, JSON.stringify({ rpc: message.method || 'response', params: message.params, result: message.result }) + '\n');
    if (message.id !== undefined && !message.method) { pendingServer.get(message.id)?.(message.result); pendingServer.delete(message.id); continue; }
    const { id, method, params = {} } = message;
    if (method === 'initialize') send({ id, result: { userAgent: 'fake-codex' } });
    else if (method === 'initialized') {}
    else if (method === 'thread/start') { const thread = { id: 'thr-' + ++threadCount }; send({ id, result: { thread, model: params.model || 'fake-model', cwd: params.cwd } }); notify('thread/started', { thread }); }
    else if (method === 'thread/fork') {
      if (params.threadId === 'thr-missing' || params.lastTurnId === 'turn-missing') send({ id, error: { code: -32000, message: 'cannot fork: unknown turn' } });
      else { const thread = { id: 'thr-fork-' + ++threadCount }; send({ id, result: { thread, model: params.model || 'fake-model', cwd: params.cwd } }); notify('thread/started', { thread }); }
    }
    else if (method === 'thread/resume') { if (params.threadId === 'thr-missing') send({ id, error: { code: -32000, message: 'no rollout found' } }); else send({ id, result: { thread: { id: params.threadId } } }); }
    else if (method === 'turn/start') {
      const turnId = 'turn-' + Math.random().toString(36).slice(2, 8);
      turns.set(turnId, params.threadId);
      send({ id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } });
      const text = params.input.filter(i => i.type === 'text').map(i => i.text).join('\n');
      setTimeout(() => runTurn(params.threadId, turnId, text, params.input.filter(i => i.type === 'localImage')), 5);
    } else if (method === 'turn/interrupt') { send({ id, result: {} }); completeTurn(params.threadId, params.turnId, 'interrupted'); }
    else if (method === 'model/list') send({ id, result: { data: [{ id: 'fake-large', model: 'fake-large', displayName: 'Fake Large', description: 'fixture', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { id: 'hidden', model: 'hidden', hidden: true }], nextCursor: null } });
    else if (id !== undefined) send({ id, error: { code: -32601, message: 'unknown method ' + method } });
  }
});
