/**
 * The bound the ancestry adapter gives an asker, held under the console's own
 * read timeout: an answer still waited for when the console gives up is a page
 * that shows a failed read where it would have shown the answer as unknown.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { gitCommitAncestryDefaults } from "../../src/adapters/git/gitCommitAncestry.ts";
import { apiTimeoutMsDefault } from "../../ui/chuggy-ui/app/core/apiRequest.ts";

test("the ancestry adapter answers an asker before the console gives up on the read", () => {
  assert.ok(
    gitCommitAncestryDefaults.answerTimeoutSecsMax * 1000 < apiTimeoutMsDefault,
  );
});
