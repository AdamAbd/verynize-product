import test from "node:test";
import assert from "node:assert/strict";
import { NODE_LIMITS } from "./document-core.mjs";
import { parseJsx } from "./jsx-codec.mjs";

test("JSX imports use the shared page cap and reject excess with a remedy", () => {
  const source = "<div />".repeat(NODE_LIMITS.perPage);
  assert.equal(parseJsx(source).elements.length, NODE_LIMITS.perPage);
  assert.throws(
    () => parseJsx(source + "<div />"),
    new RegExp(
      `Import has at least ${NODE_LIMITS.perPage + 1} elements; limit is ${NODE_LIMITS.perPage}.*Split the import`,
    ),
  );
});
