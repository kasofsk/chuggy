import assert from "node:assert/strict";
import test from "node:test";

import { ticketWorkerEntrypoint, workerMode } from "./entrypoint.mjs";

test("the image entrypoint reads its mode off the task it was given", () => {
  assert.equal(workerMode({ CHUG_SESSION_TASK: "{}" }), "Session");
  assert.equal(workerMode({ CHUG_TICKET_WORKER_TASK: "{}" }), "Ticket");
  assert.throws(() => workerMode({}), /CHUG_SESSION_TASK/u);
  assert.throws(
    () => workerMode({ CHUG_WORKER_TASK: "{}" }),
    /CHUG_TICKET_WORKER_TASK/u,
  );
});

test("a ticket pod's root is the image's to name", () => {
  assert.equal(
    ticketWorkerEntrypoint({ CHUG_TICKET_WORKER_ENTRYPOINT: "/root.ts" }),
    "/root.ts",
  );
  assert.throws(
    () => ticketWorkerEntrypoint({}),
    /CHUG_TICKET_WORKER_ENTRYPOINT/u,
  );
});
