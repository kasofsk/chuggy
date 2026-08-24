import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { id } from "../domain/fixtures.ts";
import {
  schedulerClaimFor,
  schedulerExecutions,
  schedulerIngressPool,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;
let ingress: ReturnType<typeof schedulerIngressPool>;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await rig.close();
});

test("operational reads page scheduler-owned execution state", async () => {
  const project = await schedulerProject(rig, "operational-page", {
    tasks: 2,
  });
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner("operational-page"),
  );
  assert.equal(
    (await rig.store.registerSpawn(claim, executionSchedulerDefaults.nTasks))
      .registered,
    "Registered",
  );
  const durable = await schedulerExecutions(rig, project.partition);
  const reads = postgresOperationalReads(ingress);
  const page = await reads.executions(project.partition, {
    limit: 1,
    ticket: id(project.ticket),
    selection: { selection: "NonTerminal" },
  });
  assert.equal(page.executions.length, 1);
  assert.equal(page.executions[0]?.status, "Queued");
  assert.ok(page.nextAfter !== undefined);
  assert.deepEqual(
    await reads.executions(project.partition, {
      limit: 10,
      ticket: id(project.ticket + 1),
      selection: { selection: "Selected", states: ["Queued"] },
    }),
    { executions: [] },
  );
  const detail = await reads.execution(
    project.partition,
    asExecutionId(durable[0]?.execution ?? "absent"),
  );
  assert.equal(detail?.ticket, project.ticket);
  assert.deepEqual(detail?.attempts, []);
  const status = await reads.status(project.partition);
  assert.equal(status.queued, 2);
  assert.equal(status.schedulerFreshness, "Unknown");
});
