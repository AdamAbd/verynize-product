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
// caller's role (cloud/design-backend.js, shared with the model API runtime in cloud/ai.js). Tools
// that need the desktop app or this computer are absent from tools/list.
import { z } from "zod";
import { SERVER_NAME, SERVER_VERSION, TOOLS_VERSION } from "../integrations/design-tools.mjs";
import { corsHeaders, readJson, HttpError } from "./http.js";
import {
  HOSTED_INSTRUCTIONS,
  accountRooms,
  callHostedTool,
  createRoomBackend,
  hostedToolDefinitions,
} from "./design-backend.js";

export { HOSTED_INSTRUCTIONS, accountRooms };
export const MCP_PATH = "/api/mcp";
/** Newest first; the first is answered when a client asks for a version this server does not know. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 8 * 1024 * 1024;

let toolList;
/** tools/list entries: the shared tool definitions minus the unavailable ones, plus the cloud overrides. */
export function hostedTools() {
  toolList ||= Object.entries(hostedToolDefinitions()).map(([name, tool]) => {
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
    const result = await callHostedTool(backend, name, params.arguments);
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
  const backend = createRoomBackend(env, request, url, account);
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
