import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkOutputSchema } from "../../src/contract/checkOutput.ts";

/** One entry as the worker core writes it, ending as a case names. */
function checkEntry(
  ended: { exitStatus: number } | { exitStatus: null; signal: string },
  truncated = false,
): Record<string, unknown> {
  return {
    command: ".chug/tasks/ci.sh",
    ...ended,
    truncated,
    output: "check-comments: clean\ncheck-paths: clean\n",
  };
}

test("the check document parses every way the worker core writes a command's end", () => {
  for (const checks of [
    [checkEntry({ exitStatus: 0 })],
    [checkEntry({ exitStatus: 0 }), checkEntry({ exitStatus: 1 })],
    [checkEntry({ exitStatus: null, signal: "SIGKILL" })],
    [checkEntry({ exitStatus: null, signal: "unknown" })],
    [checkEntry({ exitStatus: 1 }, true)],
  ])
    assert.equal(checkOutputSchema.safeParse({ checks }).success, true);
});

test("an entry that is not exactly one the worker core writes is refused", () => {
  for (const entry of [
    checkEntry({ exitStatus: null, signal: "" }),
    { ...checkEntry({ exitStatus: 1 }), signal: "SIGTERM" },
    { ...checkEntry({ exitStatus: 0 }), elapsedMs: 4 },
    { command: "true", exitStatus: 0, output: "" },
  ])
    assert.equal(
      checkOutputSchema.safeParse({ checks: [entry] }).success,
      false,
    );
});

/** An export of the worker contract's package moves its wire, and this
 * document is the console's to read and no worker's to send. */
test("the worker contract's package does not export the check document", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../src/contract/package.json", import.meta.url), {
      encoding: "utf8",
    }),
  ) as { readonly exports: Readonly<Record<string, string>> };
  assert.equal(
    Object.values(manifest.exports).some((path) =>
      path.includes("checkOutput"),
    ),
    false,
  );
});
