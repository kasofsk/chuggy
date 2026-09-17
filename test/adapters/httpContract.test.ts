import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeInventoryCursor,
  parseInventoryCursor,
  parseLeadInquiry,
  parsePartition,
  parseProjectRepositoryBind,
  parseThreadHide,
  parseThreadMessage,
  parseThreadRename,
} from "../../src/adapters/http/contract.ts";

test("inventory cursors are opaque, canonical, and round trip", () => {
  const partition = parsePartition("tenant/one", "project two");
  const cursor = encodeInventoryCursor(partition);
  assert.deepEqual(parseInventoryCursor(cursor), partition);
  assert.throws(() => parseInventoryCursor(`${cursor}=`));
  assert.throws(() => parseInventoryCursor("not-json"));
});

test("repository binding keeps its operation identity outside the body", () => {
  assert.deepEqual(
    parseProjectRepositoryBind({ repository: "forge/repository" }, "operation"),
    { repository: "forge/repository", operation: "operation" },
  );
  assert.throws(() =>
    parseProjectRepositoryBind(
      { repository: "forge/repository", operation: "body-operation" },
      "operation",
    ),
  );
});

test("thread requests reject unknown fields and brand caller identities", () => {
  assert.deepEqual(
    parseThreadMessage({ turn: "turn-1", message: "continue" }),
    { turn: "turn-1", message: "continue" },
  );
  assert.deepEqual(parseThreadRename({ title: "Investigation" }), {
    title: "Investigation",
  });
  assert.deepEqual(parseThreadHide({ hidden: true }), { hidden: true });
  assert.throws(() =>
    parseThreadMessage({ turn: "turn-1", message: "continue", extra: true }),
  );
});

test("lead inquiries preserve both idempotency identities", () => {
  assert.deepEqual(
    parseLeadInquiry({
      session: "inquiry-1",
      turn: "turn-1",
      question: "What blocks this work?",
    }),
    {
      session: "inquiry-1",
      turn: "turn-1",
      question: "What blocks this work?",
    },
  );
});
