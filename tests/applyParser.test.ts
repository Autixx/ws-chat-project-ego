import assert from "node:assert/strict";
import test from "node:test";
import { parseApplyExpression } from "../src/drafts/applyParser.js";

test("parseApplyExpression applies all by default", () => {
  assert.deepEqual(parseApplyExpression("all", 3), {
    apply: [1, 2, 3],
    keep: [],
    drop: []
  });
});

test("parseApplyExpression resolves keep/drop precedence", () => {
  assert.deepEqual(parseApplyExpression("1,2 keep 2,3 drop 1", 4), {
    apply: [2],
    keep: [3, 4],
    drop: [1]
  });
});

test("parseApplyExpression supports drop other", () => {
  assert.deepEqual(parseApplyExpression("1,2 drop other", 5), {
    apply: [1, 2],
    keep: [],
    drop: [3, 4, 5]
  });
});
