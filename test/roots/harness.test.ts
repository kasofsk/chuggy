import assert from "node:assert/strict";
import { test } from "node:test";

import { signalledCommandRun } from "./harness.ts";

test("an early child exit fails instead of waiting forever for readiness", async () => {
  await assert.rejects(
    signalledCommandRun(
      `process.stderr.write('startup refused\\n'); process.exit(7)`,
      () => false,
    ),
    /exited before readiness: code=7 signal=null stderr=startup refused/u,
  );
});

test("a silent live child has a bounded readiness wait", async () => {
  await assert.rejects(
    signalledCommandRun(`setInterval(() => undefined, 1_000)`, () => false, 25),
    /command readiness exceeded 25ms/u,
  );
});
