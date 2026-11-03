import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-account-state-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
try {
  const server = (await mf.ready).origin;
  const ana = await passwordUser(server, "state-ana@example.test", "Ana");
  const budi = await passwordUser(server, "state-budi@example.test", "Budi");
  const send = (session, key, value, revision = 0) =>
    fetch(server + "/api/me/state" + (key ? "/" + encodeURIComponent(key) : ""), {
      method: key ? "PUT" : "GET",
      headers: {
        "content-type": "application/json",
        ...(session ? { "x-verynize-session": session } : {}),
      },
      ...(key
        ? {
            body: JSON.stringify({
              value: value === null ? null : JSON.stringify(value),
              revision,
            }),
          }
        : {}),
    });
  assert.equal((await send(null)).status, 401);
  assert.equal((await send(ana, "preference:theme", "light")).status, 200);
  assert.equal(
    (await send(ana, "chat:one", { messages: [{ role: "user", text: "A private transcript" }] }))
      .status,
    200,
  );
  assert.deepEqual(
    (await (await send(budi)).json()).items,
    [],
    "another account cannot read private state",
  );
  const writes = await Promise.all(
    ["dark", "system"].map((value) => send(ana, "preference:theme", value, 1)),
  );
  assert.deepEqual(
    writes.map((r) => r.status).sort(),
    [200, 409],
    "concurrent edits use atomic revision checks",
  );
  assert.equal((await send(ana, "preference:theme", "stale", 1)).status, 409);
  assert.equal((await send(budi, "preference:theme", "own theme")).status, 200);
  assert.equal((await send(ana, "chat:one", null, 1)).status, 200);
  const items = (await (await send(ana)).json()).items;
  assert.equal(
    items.find((item) => item.key === "chat:one").value,
    null,
    "deleted chats keep a revision tombstone",
  );
  assert.equal((await send(ana, "session:secret", "no")).status, 400);
  assert.equal((await send(ana, "preference:theme", "no", -1)).status, 400);
  console.log(
    "PASS private account state, independent records, atomic conflicts and deletion tombstones",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
