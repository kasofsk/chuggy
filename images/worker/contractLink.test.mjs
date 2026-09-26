import assert from "node:assert/strict";
import test from "node:test";

import * as linked from "@chuggy/worker-contract/workerEnvironment";
import * as source from "../../src/contract/workerEnvironment.ts";

test("the package name reaches this tree's own contract module", () => {
  assert.equal(linked, source);
});
