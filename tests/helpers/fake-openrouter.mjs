// A local stand-in for OpenRouter's OpenAI-compatible chat completions endpoint
// (POST <base>/chat/completions with stream: true), for the model API runtime tests. It is the
// only fake in those tests: the backend, rooms, database and tools are real.
//
// Scenarios are chosen by a marker in the latest user message, `[scenario:<name>]`, and the turn
// within a scenario by the number of tool results already in the request (0 for the first model
// call, 1 after one tool round, …). A turn is a list of steps:
//   {text: "..."}                          assistant text, streamed in a few deltas
//   {tool: "name", args: {...}, id?}       one tool call (arguments streamed in two pieces); any
//                                          tool name, read or write (create_artboard, …); `args`
//                                          may be a function of the request body, and `id` fixes
//                                          the tool call id (the same id twice scripts a repeat)
//   {delay: ms}                            wait before the next step
//   {hang: true}                           keep the stream open until the client goes away
// Every request is recorded (`requests`), so tests can assert what the backend sent (for writes:
// the tool message the model got back, e.g. a denial). `userText(body)` and `toolMessages(body)`
// read a recorded request.
import http from "node:http";

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

/** Text of the latest user message of a chat completions request body. */
export function userText(body) {
  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === "user");
  return typeof lastUser?.content === "string"
    ? lastUser.content
    : (lastUser?.content || []).map((part) => part.text || "").join("");
}

/** The tool result messages of a request body, as {id, content}. */
export const toolMessages = (body) =>
  (body.messages || [])
    .filter((m) => m.role === "tool")
    .map((m) => ({
      id: m.tool_call_id,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content || []).map((part) => part.text || "").join(""),
    }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Record<string, Array<Array<object>> | ((body: object) => Array<object>)>} scenarios
 * @returns {Promise<{baseUrl: string, requests: object[], close(): Promise<void>}>}
 */
export async function startFakeOpenRouter(scenarios) {
  const requests = [];
  let counter = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "not found", code: 404 } }));
    }
    const body = JSON.parse(raw || "{}");
    requests.push({ headers: req.headers, body });
    const messages = body.messages || [];
    const name = /\[scenario:([\w-]+)\]/.exec(userText(body))?.[1] || "default";
    const scenario = scenarios[name] || scenarios.default;
    const turnIndex = messages.filter((m) => m.role === "tool").length;
    const turns = typeof scenario === "function" ? null : scenario;
    const steps =
      typeof scenario === "function"
        ? scenario(body)
        : turns?.[Math.min(turnIndex, turns.length - 1)] || [{ text: "(no script)" }];

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let closed = false;
    res.on("close", () => (closed = true));
    const id = `gen-${++counter}`;
    const model = body.model || "fake/model";
    const base = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
    };
    const chunk = (delta, finishReason = null) =>
      sse(res, { ...base, choices: [{ index: 0, delta, finish_reason: finishReason }] });
    chunk({ role: "assistant", content: "" });
    let toolIndex = 0;
    for (const step of steps) {
      if (closed) return;
      if (step.delay) await sleep(step.delay);
      else if (step.hang) {
        while (!closed) await sleep(50);
        return;
      } else if (step.text !== undefined) {
        const words = String(step.text).match(/\S+\s*/g) || [""];
        for (const word of words) {
          chunk({ content: word });
          await sleep(5);
        }
      } else if (step.tool) {
        const args = JSON.stringify(
          (typeof step.args === "function" ? step.args(body) : step.args) || {},
        );
        const half = Math.ceil(args.length / 2);
        const callId = step.id || `call_${counter}_${toolIndex}`;
        chunk({
          tool_calls: [
            {
              index: toolIndex,
              id: callId,
              type: "function",
              function: { name: step.tool, arguments: args.slice(0, half) },
            },
          ],
        });
        chunk({ tool_calls: [{ index: toolIndex, function: { arguments: args.slice(half) } }] });
        toolIndex++;
      }
    }
    if (closed) return;
    chunk({}, toolIndex ? "tool_calls" : "stop");
    sse(res, {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 100 + turnIndex,
        completion_tokens: 10,
        total_tokens: 110 + turnIndex,
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
