import assert from "node:assert/strict";
import test from "node:test";

import { workerMode } from "./entrypoint.mjs";

test("the default image entrypoint admits only a session task", () => {
  assert.equal(workerMode({ CHUG_SESSION_TASK: "{}" }), "Session");
  assert.throws(() => workerMode({}), /CHUG_SESSION_TASK/u);
  assert.throws(
    () => workerMode({ CHUG_WORKER_TASK: "{}" }),
    /CHUG_SESSION_TASK/u,
  );
});
