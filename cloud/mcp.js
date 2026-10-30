// Hosted MCP endpoint (POST /api/mcp): agents read and edit the shared cloud rooms of the signed-in
// account without an editor open. Open editors receive the edits as ordinary room `ops` messages.
//
// Transport: the stateless JSON subset of MCP Streamable HTTP (initialize,
// notifications/initialized, ping, tools/list, tools/call), one JSON response per POST, no SSE and
// no Mcp-Session-Id. Auth: a Better Auth bearer token (or legacy vs_ session) in Authorization or
// X-Verynize-Session, resolved by the router's accountOf. Room capability links are not accepted.
//
// Tools are the ones of integrations/design-tools.mjs (same names, schemas and behaviour), run
// against a cloud backend: list = the account's rooms, read = a room snapshot, transact = the pure
// transform, diffed to operations with VerynizeOps and applied by DesignRoom.agentApply with the
// caller's role. Tools that need the desktop app or this computer are absent from tools/list.
import "./mcp-env.js";
import "../web/cloud-ops.js";
import { z } from "zod";
import {
  INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS_VERSION,
  revisionOf,
  sessionFor,
  toolTable,
} from "../integrations/design-tools.mjs";
import { SHELL_TOOL_NAMES } from "../integrations/shell-tools.mjs";
import { validateDocument } from "../integrations/design-store.mjs";
import { fetchImageAsDataUrl } from "../integrations/images.mjs";
import { provideIconSets } from "../integrations/assets.mjs";
import { loadIconSets } from "./mcp-env.js";
import { corsHeaders, readJson, roleRank, atLeast, rpc, HttpError } from "./http.js";
import {
  addRoom,
  ensurePersonalOrganization,
  membership,
  orgRoomRole,
  syncTitle,
  userOrganizationRooms,
} from "./orgs.js";
import { createAuth } from "./auth.js";
import * as profiles from "./profiles.js";

const Ops = globalThis.VerynizeOps;
export const MCP_PATH = "/api/mcp";
/** Newest first; the first is answered when a client asks for a version this server does not know. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 8 * 1024 * 1024;
const MAX_IMAGE = 512 * 1024; // room documents are limited to 2 MB in total
const ASSET_WAIT_MS = 25_000;
const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Tools that cannot run here, with the reason a caller gets if it calls one anyway. */
const UNAVAILABLE = {
  take_screenshot:
    'take_screenshot is unavailable on the hosted (headless) server: there is no renderer. Inspect elements with get_element_code or get_element_tree; finish_artboard reports "unverified" without a screenshot. Open the room in the Verynize desktop app to render it.',
  ask_agent:
    "ask_agent is unavailable on the hosted server: it runs the other agent inside the Verynize desktop app.",
  import_html:
    "import_html is unavailable on the hosted server (it reads local files and remote pages). Convert the page to JSX and use import_jsx or create_artboard.",
  save_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  list_design_preferences:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  update_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  delete_design_preference:
    "Design preferences are stored on the user's computer; the hosted server has none.",
  export_document:
    "export_document is unavailable on the hosted server; use export_css (lossless HTML + CSS) or export_jsx.",
};
for (const name of SHELL_TOOL_NAMES)
  UNAVAILABLE[name] =
    `${name} needs the Verynize desktop app (running app, terminal and editor actions); it is unavailable on the hosted server.`;
const ICON_TOOLS = new Set(["get_icons", "create_artboard", "update_elements", "import_jsx"]);

const roomArg = z
  .string()
  .regex(ROOM_ID, "Use a room id (a UUID) from list_documents")
  .optional()
  .describe("Room id from list_documents. Omit when the account reaches exactly one room.");

/** Cloud variants of the document tools: rooms instead of files, and no desktop editor to open. */
const OVERRIDES = {
  list_documents: {
    description:
      'List the shared cloud rooms this account reaches (its own, shared with it, and its organizations\' rooms) with title, role and editor URL. Pass a room id as "document" to the other tools.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    run: (backend) => backend.list(),
  },
  open_document: {
    description:
      "Hosted server: returns the editor URL of a room (<origin>/#room=<id>) to give the user. Nothing is opened; editors already showing the room receive edits live.",
    inputSchema: { name: roomArg },
    annotations: { readOnlyHint: true },
    run: (backend, { name }) => backend.open({ name }),
  },
  create_document: {
    description:
      'Create a new shared cloud room holding an empty document titled `title`, owned by you, in your personal organization or the organization named by organizationId (you must be a member). Returns its room id (pass it as "document") and editor URL. `name` is accepted for compatibility and ignored: rooms are addressed by id.',
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      name: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/)
        .optional()
        .describe("Ignored on the hosted server"),
      organizationId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .optional()
        .describe("Organization to create the room in; defaults to your personal organization"),
      open: z.boolean().optional().describe("Ignored on the hosted server"),
    },
    run: (backend, { name, title, organizationId }) =>
      backend.create(name, title, { organizationId }),
  },
};

export const HOSTED_INSTRUCTIONS = `${INSTRUCTIONS.split("## Live editing")[0].trimEnd()}

## Hosted server (headless)
This is the hosted Verynize MCP server. Documents are the shared cloud rooms of the signed-in account: list_documents lists them and every tool takes a room id as "document" (or "name" on the low-level tools). Edits are applied to the room immediately and appear live in every editor that has the room open; each tool call is one change for the room's collaborators. Your role in a room decides what you may do: viewers and commenters can read but not edit.
- take_screenshot, ask_agent, import_html, design preferences and the desktop shell tools are not available here. Skip the screenshot steps of the workflow: check your work with get_element_code / get_element_tree and the lint report finish_artboard returns; finish_artboard reports "unverified" (say so honestly).
- Remote <img src="https://…"> photos are embedded while the call runs when they are small enough (room documents are limited to 2 MB in total); larger ones are marked missing.
- Give the user the room's editor URL (open_document or list_documents) so they can open it.`;

let toolList;
/** tools/list entries: the shared tool definitions minus the unavailable ones, plus the cloud overrides. */
export function hostedTools() {
  toolList ||= Object.entries({ ...toolTable({}), ...OVERRIDES })
    .filter(([name]) => !Object.hasOwn(UNAVAILABLE, name))
    .map(([name, tool]) => {
      const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(z.object(tool.inputSchema), {
        io: "input",
        unrepresentable: "any",
      });
      return {
        name,
        description: tool.description,
        inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      };
    });
  return toolList;
}

// ---------------------------------------------------------------------------------------------
// Cloud backend (the backend interface of integrations/design-tools.mjs over rooms)

const editorUrl = (origin, id) => `${origin}/#room=${id}`;

/** Every room the account reaches, like GET /api/me/rooms: direct memberships plus organizations. */
export async function accountRooms(env, account) {
  const rooms = new Map();
  for (const room of await profiles.rooms(env, account.id)) rooms.set(room.id, room);
  if (account.authUser)
    for (const room of await userOrganizationRooms(env, account.authUser.id)) {
      const direct = rooms.get(room.id);
      const role = direct && roleRank(direct.role) > roleRank(room.role) ? direct.role : room.role;
      rooms.set(room.id, { ...direct, ...room, role });
    }
  return [...rooms.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function cloudBackend(env, request, url, account) {
  const origin = url.origin;
  const orgRole = async (id) =>
    account.authUser ? await orgRoomRole(env, id, account.authUser.id) : null;
  const resolve = async (ref) => {
    if (ref !== undefined && ref !== null && ref !== "") {
      if (!ROOM_ID.test(ref))
        throw new Error(`"${ref}" is not a room id; use an id (UUID) from list_documents`);
      return ref;
    }
    const rooms = await accountRooms(env, account);
    if (rooms.length === 1) return rooms[0].id;
    throw new Error(
      rooms.length
        ? `Pass "document" to choose one of these rooms: ${rooms
            .slice(0, 50)
            .map((r) => `${r.id} (${r.title})`)
            .join(", ")}`
        : "This account has no rooms yet; call create_document first",
    );
  };
  const readRoom = async (id) => {
    const role = await orgRole(id);
    const state = await rpc(
      env.ROOMS.getByName(id).agentRead({ accountId: account.id, orgRole: role }),
    );
    try {
      validateDocument(clone(state.document));
    } catch (error) {
      throw new Error(`Room ${id} does not hold a valid version 2 design: ${error.message}`);
    }
    return { ...state, orgRole: role };
  };
  return {
    mode: "cloud",
    async list() {
      const rooms = await accountRooms(env, account);
      return {
        documents: rooms.map((room) => ({
          name: room.id,
          title: room.title,
          role: room.role,
          ...(room.organizationId
            ? { organizationId: room.organizationId, organizationName: room.organizationName }
            : {}),
          updatedAt: room.updatedAt ?? null,
          url: editorUrl(origin, room.id),
          live: false,
        })),
        editor: null,
        headless: true,
      };
    },
    async read(ref) {
      const id = await resolve(ref);
      const state = await readRoom(id);
      return {
        document: state.document,
        revision: revisionOf(state.document),
        roomRevision: state.revision,
        role: state.role,
        name: id,
        live: false,
        headless: true,
        selection: [],
      };
    },
    async transact(ref, fn) {
      const id = await resolve(ref);
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = await readRoom(id);
        if (!atLeast(state.role, "editor"))
          throw new Error(
            `Your role in this room (${state.role}) cannot edit; ask an owner for editor access`,
          );
        const out = fn(clone(state.document), { revision: revisionOf(state.document) });
        validateDocument(out.document);
        const ops = Ops.diff(state.document, out.document);
        if (!ops.length)
          return {
            result: out.result,
            revision: revisionOf(state.document),
            live: false,
            headless: true,
            name: id,
          };
        const applied = await rpc(
          env.ROOMS.getByName(id).agentApply({
            accountId: account.id,
            orgRole: state.orgRole,
            baseRevision: state.revision,
            ops,
          }),
        );
        if (applied.conflict) continue; // someone edited in between: recompute on the new snapshot
        if (!applied.applied && applied.rejected)
          throw new Error(
            `The room rejected the edit: ${(applied.reasons || []).map((r) => r?.reason || JSON.stringify(r)).join("; ") || "invalid operations"}`,
          );
        if (applied.document?.name !== state.document.name)
          await syncTitle(env, id, String(applied.document?.name || ""));
        return {
          result: out.result,
          revision: revisionOf(applied.document),
          live: false,
          headless: true,
          name: id,
        };
      }
      throw new Error("The room kept changing while this edit was applied; try again");
    },
    async create(_name, title, { organizationId: requested } = {}) {
      if (env.ROOM_CREATION) {
        const ip = request.headers.get("CF-Connecting-IP") || "local";
        if (!(await env.ROOM_CREATION.limit({ key: ip })).success)
          throw new Error("Too many new rooms. Try again in a minute.");
      }
      let organizationId = null;
      if (account.authUser) {
        if (requested !== undefined) {
          if (!(await membership(env, requested, account.authUser.id)))
            throw new Error("You are not a member of this organization");
          organizationId = requested;
        } else
          organizationId = await ensurePersonalOrganization(
            env,
            createAuth(env, request),
            account.authUser,
          );
      } else if (requested !== undefined)
        throw new Error("Sign in with your email and password to create rooms in an organization");
      const pageId = crypto.randomUUID();
      const document = {
        version: 2,
        name: title,
        pages: [{ id: pageId, name: "Page 1", nodes: [] }],
        tokens: {},
      };
      const id = crypto.randomUUID();
      const identity = {
        id: account.id,
        email: account.email,
        handle: account.handle,
        displayName: account.displayName,
      };
      const response = await env.ROOMS.getByName(id).fetch(
        new Request("https://room/create", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-verynize-account": JSON.stringify(identity),
          },
          body: JSON.stringify({ document }),
        }),
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the room");
      await profiles.linkRoom(env, account.id, id, "owner", result.title);
      if (organizationId)
        await addRoom(env, {
          id,
          organizationId,
          title: result.title,
          userId: account.authUser.id,
        });
      return {
        name: id,
        roomId: id,
        title: result.title,
        pageId,
        role: "owner",
        organizationId,
        revision: revisionOf(document),
        url: editorUrl(origin, id),
        live: false,
        opened: false,
        headless: true,
      };
    },
    async open({ name }) {
      const id = await resolve(name);
      const state = await readRoom(id);
      return {
        opened: false,
        headless: true,
        name: id,
        title: state.title,
        role: state.role,
        url: editorUrl(origin, id),
        note: "Give the user this URL to open the room in Verynize; open editors already show edits live.",
      };
    },
    focus: async () => ({ focused: false, headless: true }),
    fetchImage: (src) => fetchImageAsDataUrl(src, { maxBytes: MAX_IMAGE }),
    preferences: { list: async () => [] },
  };
}

/** Wait (bounded) until the background image jobs design-tools queued for this backend finish. */
async function settleAssets(backend) {
  const deadline = Date.now() + ASSET_WAIT_MS;
  while (Date.now() < deadline) {
    const jobs = [...sessionFor(backend).pending.values()].flatMap((set) => [...set]);
    if (!jobs.length) return;
    let timer;
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((resolve) => {
        timer = setTimeout(resolve, deadline - Date.now());
      }),
    ]);
    clearTimeout(timer);
  }
}

const textResult = (value) => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const toolError = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

async function callTool(backend, name, args) {
  if (Object.hasOwn(UNAVAILABLE, name)) return toolError(UNAVAILABLE[name]);
  const override = OVERRIDES[name];
  const tool = override || toolTable(backend)[name];
  if (!tool) return null;
  const parsed = z
    .object(tool.inputSchema)
    .strict()
    .safeParse(args ?? {});
  if (!parsed.success)
    return toolError(
      `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
    );
  try {
    if (ICON_TOOLS.has(name)) provideIconSets(await loadIconSets());
    const result = override
      ? await override.run(backend, parsed.data)
      : await tool.run(parsed.data);
    await settleAssets(backend);
    return tool.raw && Array.isArray(result?.content) ? result : textResult(result);
  } catch (error) {
    return toolError(error?.message || String(error));
  }
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC over HTTP

const rpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});
function reply(body, status = 200, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "access-control-expose-headers": "WWW-Authenticate",
      "cache-control": "no-store",
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...extra,
    },
  });
}
const httpError = (status, message, extra) => reply(rpcError(null, -32000, message), status, extra);

async function handleMessage(message, backend) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return rpcError(null, -32600, "Invalid request");
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (message.jsonrpc !== "2.0" || (typeof method !== "string" && isRequest))
    return isRequest ? rpcError(id, -32600, "Invalid request") : null;
  if (typeof method !== "string") return null; // a response from the client: nothing to answer
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled, …
  if (typeof id !== "string" && typeof id !== "number")
    return rpcError(null, -32600, "Invalid request id");
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_NAME,
          title: "Verynize (hosted)",
          version: SERVER_VERSION,
        },
        instructions: HOSTED_INSTRUCTIONS,
        _meta: { "verynize/headless": true, "verynize/toolsVersion": TOOLS_VERSION },
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: hostedTools() } };
  if (method === "tools/call") {
    const name = params?.name;
    if (typeof name !== "string") return rpcError(id, -32602, "tools/call needs a tool name");
    const result = await callTool(backend, name, params.arguments);
    if (!result) return rpcError(id, -32602, `Unknown tool: ${name}`);
    return { jsonrpc: "2.0", id, result: { ...result, _meta: { "verynize/headless": true } } };
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

/**
 * POST /api/mcp. `accountOf(env, request, url)` and `limited(binding, key)` come from the router
 * (cloud/worker.js) so sessions resolve exactly like the rest of the API.
 */
export async function handleMcp(request, env, url, { accountOf, limited }) {
  if (request.method !== "POST")
    return httpError(
      405,
      "This MCP endpoint answers POST with JSON; it does not offer SSE streams",
      {
        allow: "POST, OPTIONS",
      },
    );
  // Browsers send Origin: only the server's own pages may call it from a browser.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return httpError(403, "Cross-origin requests are not allowed");
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (await limited(env.MCP_LIMIT, `ip:${ip}`))
    return httpError(429, "Too many requests. Try again in a minute.", { "retry-after": "60" });
  let account = null;
  try {
    account = await accountOf(env, request, url);
  } catch {}
  if (!account)
    return httpError(
      401,
      "Sign in first: send Authorization: Bearer <Verynize session token> (or X-Verynize-Session)",
      { "www-authenticate": 'Bearer realm="verynize", error="invalid_token"' },
    );
  if (await limited(env.MCP_LIMIT, `account:${account.id}`))
    return httpError(429, "Too many requests. Try again in a minute.", { "retry-after": "60" });
  const version = request.headers.get("mcp-protocol-version");
  if (version && !PROTOCOL_VERSIONS.includes(version))
    return httpError(400, `Unsupported MCP-Protocol-Version ${version}`);
  let body;
  try {
    body = await readJson(request, MAX_BODY);
  } catch (error) {
    return reply(
      rpcError(null, -32700, error.message || "Parse error"),
      error instanceof HttpError ? error.status : 400,
    );
  }
  const backend = cloudBackend(env, request, url, account);
  if (Array.isArray(body)) {
    if (!body.length) return reply(rpcError(null, -32600, "Empty batch"), 400);
    const answers = [];
    for (const message of body.slice(0, 50)) {
      const answer = await handleMessage(message, backend);
      if (answer) answers.push(answer);
    }
    return answers.length ? reply(answers) : reply(null, 202);
  }
  const answer = await handleMessage(body, backend);
  return answer ? reply(answer) : reply(null, 202);
}
