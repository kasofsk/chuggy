import assert from "node:assert/strict";
import { test } from "node:test";

import { systemPacing } from "../../src/adapters/runtime/systemPacing.ts";

test("completed pacing remains abortable after repeated waits", async () => {
  const control = new AbortController();
  for (let count = 0; count < 100; count += 1)
    await systemPacing.wait(1, control.signal);

  const waiting = systemPacing.wait(60_000, control.signal);
  control.abort();
  await waiting;
  assert.equal(control.signal.aborted, true);
});
