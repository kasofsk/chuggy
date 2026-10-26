/**
 * What of git's own words a line may print: its first line that says anything,
 * with every secret the caller names and everything shaped like one redacted,
 * flattened and bounded.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { textCodePointsCount } from "../../src/contract/http.ts";
import {
  gitRunRedacted,
  gitRunSaid,
  gitRunSaidCharsMax,
} from "../../src/adapters/git/gitRun.ts";

test("what git wrote is said as its first line that says anything", () => {
  assert.equal(
    gitRunSaid(
      "\n  \r\nremote: Invalid username or token.\nfatal: Authentication failed\n",
      [],
    ),
    "remote: Invalid username or token.",
  );
  assert.equal(gitRunSaid("", []), "");
});

test("a secret the caller names is redacted wherever git wrote it", () => {
  const secret = "s3cr.t!";
  const said = gitRunSaid(`fatal: ${secret} refused ${secret}\n`, [secret]);

  assert.equal(said, `fatal: ${gitRunRedacted} refused ${gitRunRedacted}`);
  assert.equal(said.includes(secret), false);
});

test("a token the caller never named is redacted by its shape", () => {
  const token = `ghs_${"a1B2c3D4e5".repeat(4)}`;
  const said = gitRunSaid(
    `fatal: unable to access 'https://x-access-token:${token}@github.com/o/r/'\n`,
    [],
  );

  assert.equal(said.includes(token), false);
  assert.equal(
    said,
    `fatal: unable to access 'https://x-access-token:${gitRunRedacted}@github.com/o/r/'`,
  );
});

test("what a terminal would obey is flattened, and a long line is cut to the bound", () => {
  assert.equal(
    gitRunSaid("fatal:\u001b[31m red\t​there", []),
    "fatal: [31m red there",
  );
  const said = gitRunSaid(`${"word ".repeat(gitRunSaidCharsMax)}\n`, []);
  assert.equal(textCodePointsCount(said), gitRunSaidCharsMax + 1);
  assert.equal(said.endsWith("…"), true);
});
