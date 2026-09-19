import assert from "node:assert/strict";
import test from "node:test";

import { credentialScrub } from "./credentialScrub.mjs";

test("session output replaces mounted credentials and ignores short values", () => {
  const secret = "credential-long-enough";
  const scrub = credentialScrub(["short", secret, secret]);
  assert.equal(
    scrub(`short ${secret} ${secret}`),
    "short [redacted credential] [redacted credential]",
  );
});
