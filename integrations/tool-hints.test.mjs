import test from "node:test";
import assert from "node:assert/strict";
import { toolHints } from "./tool-hints.mjs";
const receipt = {
  documentRevision: "r",
  screenshot: { sha256: "hash", source: "live" },
  lint: { counts: { critical: 0 } },
};
const state = (extra) => ({
  page: { id: "p", nodes: [] },
  artboards: ["abc"],
  revision: "r",
  receiptFor: () => receipt,
  ...extra,
});
test("screenshot hint on for absent/stale/estimated receipts, off for current real screenshot", () => {
  assert.equal(toolHints(state()), "");
  for (const r of [
    null,
    { ...receipt, documentRevision: "old" },
    { ...receipt, screenshot: { source: "estimated" } },
  ])
    assert.match(toolHints(state({ receiptFor: () => r })), /take_screenshot/);
});
test("critical lint only uses current receipt, zero is silent", () => {
  const r = { ...receipt, lint: { counts: { critical: 2 } } };
  assert.match(toolHints(state({ receiptFor: () => r })), /2 critical/);
  assert.doesNotMatch(
    toolHints(state({ receiptFor: () => ({ ...r, documentRevision: "old" }) })),
    /critical/,
  );
  assert.equal(toolHints(state()), "");
});
test("pending/missing assets on, loaded assets off", () => {
  const page = {
    id: "p",
    nodes: [{ assetStatus: "pending" }, { assetStatus: "missing" }, { assetStatus: "ready" }],
  };
  assert.match(toolHints(state({ page })), /2 image/);
  assert.equal(toolHints(state({ page: { ...page, nodes: [{ assetStatus: "ready" }] } })), "");
});
test("node capacity threshold on/off and two-line deterministic cap", () => {
  assert.equal(toolHints(state({ page: { id: "p", nodes: Array(4499).fill({}) } })), "");
  const s = state({
    page: { id: "p", nodes: Array(4800).fill({ assetStatus: "pending" }) },
    receiptFor: () => null,
  });
  assert.match(toolHints(s), /4,800\/5,000/);
  assert.equal(toolHints(s).split("\n").length, 2);
  assert.equal(toolHints(s), toolHints(s));
  assert.equal(toolHints(state({ receiptFor: () => null, omit: new Set(["screenshot"]) })), "");
});
