// Per-chat autonomy: how far an agent may go on its own in one chat.
//
// Stored in `userData/agent-autonomy.json` as {version:1, chats:{<chatId>: settings}} and read by
// desktop/agent-runtime.cjs at the start of every run of that chat. Settings:
//   allowedTools  tool names / `prefix*` patterns approved without asking
//   deniedTools   patterns that are always refused (also passed to Claude as disallowedTools)
//   autoApprove   [{tool, match}] approve a tool call when its command/path/description contains `match`
//                 (e.g. {tool:'Bash', match:'npm test'}, {tool:'shell', match:'git status'})
//   maxTurns      Claude: SDK maxTurns. Codex: the run stops after this many tool steps.
//   maxBudgetUsd  Claude: SDK maxBudgetUsd. Both: the run stops when a reported cost passes it.
//   planFirst     Claude: permissionMode 'plan' (the plan is approved through an approval card before edits).
//                 Codex: read-only sandbox + "untrusted" approvals and a persona instruction, so every edit
//                 needs explicit approval after the plan.
// The access level stays the chat's own (`chat.access` in the renderer); the panel changes it there.
// Every run reports the effective settings as an `autonomy` event and each automatic decision as a `policy`
// event, so both appear in the transcript.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { toolMatches } = require("./agent-tool-config.cjs");

const CHAT_ID = /^[a-zA-Z0-9-]{1,80}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,120}\*?$/;
const DEFAULTS = Object.freeze({
  allowedTools: [],
  deniedTools: [],
  autoApprove: [],
  maxTurns: null,
  maxBudgetUsd: null,
  planFirst: false,
});

function toolList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value.slice(0, 50)) {
    const tool = typeof item === "string" ? item.trim() : "";
    if (!TOOL.test(tool))
      throw Error(`"${String(item).slice(0, 40)}" is not a tool name or pattern`);
    if (!out.includes(tool)) out.push(tool);
  }
  return out;
}

function normalizeAutonomy(input) {
  const o = input && typeof input === "object" ? input : {};
  const allowedTools = toolList(o.allowedTools),
    deniedTools = toolList(o.deniedTools);
  const clash = allowedTools.find((t) => deniedTools.includes(t));
  if (clash) throw Error(`${clash} cannot be both allowed and denied`);
  const autoApprove = [];
  for (const rule of Array.isArray(o.autoApprove) ? o.autoApprove.slice(0, 30) : []) {
    const tool = typeof rule?.tool === "string" ? rule.tool.trim() : "";
    const match = typeof rule?.match === "string" ? rule.match.trim().slice(0, 200) : "";
    if (!TOOL.test(tool)) throw Error("Each auto-approve rule needs a tool name");
    if (!match) throw Error("Each auto-approve rule needs text to match");
    autoApprove.push({ tool, match });
  }
  const maxTurns = o.maxTurns == null || o.maxTurns === "" ? null : Number(o.maxTurns);
  if (maxTurns !== null && (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 500))
    throw Error("Max turns must be a whole number from 1 to 500");
  const maxBudgetUsd =
    o.maxBudgetUsd == null || o.maxBudgetUsd === "" ? null : Number(o.maxBudgetUsd);
  if (
    maxBudgetUsd !== null &&
    (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0 || maxBudgetUsd > 1000)
  )
    throw Error("Budget must be between $0.01 and $1,000");
  return {
    allowedTools,
    deniedTools,
    autoApprove,
    maxTurns,
    maxBudgetUsd: maxBudgetUsd === null ? null : Math.round(maxBudgetUsd * 100) / 100,
    planFirst: o.planFirst === true,
  };
}

const isDefault = (s) =>
  !s.allowedTools.length &&
  !s.deniedTools.length &&
  !s.autoApprove.length &&
  s.maxTurns === null &&
  s.maxBudgetUsd === null &&
  !s.planFirst;

/** Text an auto-approve rule is matched against. */
function subjectOf(input = {}) {
  const parts = [];
  for (const key of [
    "command",
    "cmd",
    "file_path",
    "path",
    "notebook_path",
    "url",
    "pattern",
    "description",
    "reason",
  ]) {
    const v = input?.[key];
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string").join(" "));
  }
  return parts.join("\n");
}

/**
 * Decide a tool request from the chat's autonomy alone: {decision:'allow'|'deny', reason} or null (ask as usual).
 * Denied patterns win over everything else.
 */
function autonomyDecision(settings, toolName, input) {
  if (!settings) return null;
  const denied = settings.deniedTools.find((p) => toolMatches(p, toolName));
  if (denied) return { decision: "deny", reason: `${denied} is denied for this chat` };
  const allowed = settings.allowedTools.find((p) => toolMatches(p, toolName));
  if (allowed) return { decision: "allow", reason: `${allowed} is allowed for this chat` };
  const subject = subjectOf(input);
  const rule = settings.autoApprove.find(
    (r) => toolMatches(r.tool, toolName) && subject.includes(r.match),
  );
  if (rule)
    return { decision: "allow", reason: `Auto-approved: ${rule.tool} matching “${rule.match}”` };
  return null;
}

/** Short human summary for the transcript. */
function describeAutonomy(settings, { access, account } = {}) {
  const parts = [];
  if (access) parts.push(`${access[0].toUpperCase()}${access.slice(1)} access`);
  if (account) parts.push(`account: ${account}`);
  if (settings.planFirst) parts.push("plan before edits");
  if (settings.maxTurns) parts.push(`max ${settings.maxTurns} turns`);
  if (settings.maxBudgetUsd) parts.push(`budget $${settings.maxBudgetUsd.toFixed(2)}`);
  if (settings.allowedTools.length) parts.push(`allowed: ${settings.allowedTools.join(", ")}`);
  if (settings.deniedTools.length) parts.push(`denied: ${settings.deniedTools.join(", ")}`);
  if (settings.autoApprove.length)
    parts.push(
      `${settings.autoApprove.length} auto-approve rule${settings.autoApprove.length === 1 ? "" : "s"}`,
    );
  return parts.join(" · ");
}

const PLAN_FIRST_PERSONA =
  "Plan before editing (set by the user for this chat): first inspect what you need and reply with a short numbered plan of the changes you intend to make. Do not modify files or the canvas until that plan has been approved; edits you attempt before approval will be refused.";

class AgentAutonomy {
  constructor({ userData } = {}) {
    if (!userData) throw Error("userData directory required");
    this.file = path.join(userData, "agent-autonomy.json");
    this.data = null;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async load() {
    if (this.data) return this.data;
    const data = { version: 1, chats: {} };
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      for (const [chatId, value] of Object.entries(parsed?.chats || {})) {
        if (!CHAT_ID.test(chatId)) continue;
        try {
          data.chats[chatId] = normalizeAutonomy(value);
        } catch {}
      }
    } catch {}
    this.data = data;
    return data;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  async get(chatId) {
    if (typeof chatId !== "string" || !CHAT_ID.test(chatId))
      return { ...DEFAULTS, allowedTools: [], deniedTools: [], autoApprove: [] };
    const data = await this.load();
    return data.chats[chatId]
      ? structuredClone(data.chats[chatId])
      : { ...DEFAULTS, allowedTools: [], deniedTools: [], autoApprove: [] };
  }
  set(chatId, settings) {
    return this.serial(async () => {
      if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) throw Error("Invalid chat");
      const clean = normalizeAutonomy(settings);
      const data = await this.load();
      if (isDefault(clean)) delete data.chats[chatId];
      else data.chats[chatId] = clean;
      const keys = Object.keys(data.chats);
      if (keys.length > 2000)
        for (const key of keys.slice(0, keys.length - 2000)) delete data.chats[key];
      await this.save();
      return structuredClone(clean);
    });
  }
}

function registerAgentAutonomy(handle, { userData, store: shared = null } = {}) {
  const store = shared || new AgentAutonomy({ userData });
  handle("agentAutonomyGet", (options) => store.get(options?.chatId));
  handle("agentAutonomySet", (options) => store.set(options?.chatId, options?.settings));
  return store;
}

module.exports = {
  AgentAutonomy,
  registerAgentAutonomy,
  normalizeAutonomy,
  autonomyDecision,
  describeAutonomy,
  subjectOf,
  PLAN_FIRST_PERSONA,
  AUTONOMY_DEFAULTS: DEFAULTS,
};
