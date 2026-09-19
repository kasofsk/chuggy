import assert from "node:assert/strict";
import test from "node:test";

import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import {
  chuggyToolCapabilities,
  leadSessionCapabilities,
} from "../../src/interpreter/leadTools.ts";

test("every session capability has one explicit tool roster", () => {
  assert.deepEqual(Object.keys(chuggyToolCapabilities), [
    ...allSessionCapabilities,
  ]);
});

test("the interactive lead holds project reads and adopted authorship", () => {
  assert.deepEqual(leadSessionCapabilities, [
    "RepositoryRead",
    "ProjectRead",
    "DraftAuthor",
  ]);
});
