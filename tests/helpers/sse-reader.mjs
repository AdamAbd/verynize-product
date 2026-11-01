// Read a model API SSE response (docs/ai-runtime.md) incrementally: `next(predicate)` waits for an
// event, `all()` for the end of the stream, `cancel()` disconnects like a closed tab.
import assert from "node:assert/strict";

export function sseReader(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let ended = false;
  let index = 0;
  async function pump() {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return {
    events,
    async next(predicate, timeout = 15_000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        while (index < events.length) {
          const event = events[index++];
          if (predicate(event)) return event;
        }
        if (ended) throw new Error("Stream ended before the expected event");
        if (Date.now() > deadline) throw new Error("Timed out waiting for an event");
        await pump();
      }
    },
    async all(timeout = 20_000) {
      const deadline = Date.now() + timeout;
      while (!ended) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the stream to end");
        await pump();
      }
      return events;
    },
    cancel: () => reader.cancel().catch(() => {}),
  };
}
