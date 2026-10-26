/**
 * The excerpt the server prints of what git wrote, held to the one the setup
 * program prints of another program's words. A line of either is redacted,
 * flattened and bounded alike, so a secret one of them keeps out of a line the
 * other keeps out too.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { gitRunSaid } from "../../src/adapters/git/gitRun.ts";
import { setupExcerpt } from "../../ui/chuggy-ui/app/core/setupText.ts";

const secret = "s3cr.t!";

/** Single lines, since a line is all either is asked to keep, each carrying something one of the rules acts on. */
const lines = [
  "fatal: Authentication failed for 'https://github.com/o/r/'",
  `fatal: ${secret} refused ${secret}`,
  `remote: token ghs_${"a1B2c3D4e5".repeat(4)} rejected`,
  `fatal: just under the shape ${"x".repeat(23)} and at it ${"y".repeat(24)}`,
  "fatal:\u001b[31m red\t​there ",
  "word ".repeat(100),
];

test("git's words are excerpted exactly as the setup program excerpts another program's", () => {
  for (const line of lines)
    assert.equal(
      gitRunSaid(line, [secret]),
      setupExcerpt(line, [secret]),
      line,
    );
});
