/**
 * The memory the console's setup says a run of the project's takes, held to
 * the memory an execution naming none runs with on a pool: the console cannot
 * import the interpreter, so it states the figure itself, and a default moved
 * there is a finding here until the console states the same.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { workerPoolMemoryMibDefault } from "../../src/interpreter/workerPool.ts";
import { setupJobMemoryMib } from "../../ui/chuggy-ui/app/core/setupRunnerMachine.ts";

test("the memory setup says a run takes, and sizes the chat host beside, is the memory an execution naming none runs with on a pool", () => {
  assert.equal(setupJobMemoryMib, workerPoolMemoryMibDefault);
});
