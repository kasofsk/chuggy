import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/** Read off the resolver rather than imported, since this directory reaches the tree only by the package's name. */
test("the package name reaches this tree's own contract module", () => {
  const resolved = import.meta
    .resolve("@chuggy/worker-contract/workerEnvironment");

  assert.equal(
    realpathSync(fileURLToPath(resolved)),
    realpathSync(
      fileURLToPath(
        new URL("../../src/contract/workerEnvironment.ts", import.meta.url),
      ),
    ),
  );
});
