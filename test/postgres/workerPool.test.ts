import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type pg from "pg";

import {
  postgresTicketExecution,
  postgresTicketExecutionTerminals,
} from "../../src/adapters/postgres/ticketExecution.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  poolPlaneRole,
  schedulerRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import type { TicketExecutionView } from "../../src/interpreter/ticketExecution.ts";
import { obligationNeeding } from "./executionFixtures.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let writer: pg.Pool;
let scheduler: pg.Pool;
let plane: pg.Pool;
let worker: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  writer = postgresHarnessRolePool(ticketServiceRole);
  scheduler = postgresHarnessRolePool(schedulerRole);
  plane = postgresHarnessRolePool(poolPlaneRole);
  worker = postgresHarnessRolePool(workerPlaneRole);
});
after(async () => {
  await Promise.all([writer.end(), scheduler.end(), plane.end(), worker.end()]);
  await harness.close();
});

const preparedView = {
  workload: {
    runner: "script",
    execution_profile: { cpu: 2000, memory_mb: 8192 },
  },
  inputs: {},
  resultContract: { type: "object" },
  requiredCapabilities: [],
  context: [],
  repository: "https://git.invalid/owner/repository.git",
  commit: "0123456789012345678901234567890123456789",
  access: "ReadRepository",
} as unknown as TicketExecutionView;

/** One project with one queued task and a pool registered against it. */
async function registered(
  name: string,
  needs: readonly string[],
  declares: readonly string[],
) {
  const partition = await postgresHarnessProject(harness.store, name);
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    obligationNeeding(needs),
  );
  const registry = postgresWorkerPoolRegistry(writer);
  const credential = `credential-${name}`;
  assert.equal(
    await registry.register(partition, "pool-one", declares, credential),
    true,
  );
  const identity =
    await postgresWorkerPoolRegistry(plane).authenticate(credential);
  assert.ok(identity);
  return {
    partition,
    credential,
    names: { one: `${name}-one`, two: `${name}-two` },
    bearer: `bearer-${name}`,
    identity,
    registry,
    assignments: postgresWorkerPoolAssignments(plane),
    prepare: () =>
      postgresTicketExecution(scheduler).prepare(
        partition,
        "work:1:1",
        preparedView,
      ),
  };
}

test("a pool claims only prepared work its declared capabilities cover", async () => {
  const held = await registered("pool-claim", ["linux"], ["linux"]);
  assert.equal(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
    ),
    undefined,
    "work with no materialised view is work a pool cannot be assigned",
  );
  assert.equal(await held.prepare(), true);
  const narrow = { ...held.identity, capabilities: ["macos"] };
  assert.equal(
    await held.assignments.claim(
      narrow,
      30,
      held.names.two,
      `${held.bearer}-two`,
    ),
    undefined,
  );
  const claimed = await held.assignments.claim(
    held.identity,
    30,
    held.names.one,
    held.bearer,
  );
  assert.deepEqual(claimed?.capabilities, ["linux"]);
  assert.deepEqual(
    (claimed?.view as { workload: unknown }).workload,
    preparedView.workload,
  );
});

test("a pool's credential authenticates no attempt and reports no terminal", async () => {
  const held = await registered("pool-separation", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
    ),
  );
  const reports = postgresTicketExecutionTerminals(worker);
  assert.equal(await reports.view(held.credential), undefined);
  assert.notEqual(
    await reports.view(held.bearer),
    undefined,
    "the attempt's own bearer is what that plane answers",
  );
  assert.equal(
    await reports.report(held.credential, {
      taskKey: "work:1:1",
      outcome: { type: "process_failed", evidence: "a pool said so" },
    }),
    "Fenced",
  );
  const outcome = await harness.pool.query<{ worker_outcome: unknown }>(
    "SELECT worker_outcome FROM ticket_execution WHERE tenant=$1 AND project=$2",
    [held.partition.tenant, held.partition.project],
  );
  assert.equal(outcome.rows[0]?.worker_outcome, null);
});

test("the plane serving harnesses cannot read the relation a pool is registered in", async () => {
  assert.match(
    (await harness.attemptAs(
      workerPlaneRole,
      "SELECT credential_digest FROM worker_pool",
    )) ?? "",
    /permission denied for table worker_pool/u,
  );
  assert.match(
    (await harness.attemptAs(
      poolPlaneRole,
      "UPDATE ticket_execution SET worker_outcome='{}'::jsonb",
    )) ?? "",
    /permission denied for table ticket_execution/u,
  );
});

test("an assignment is renewed, refused and released by the pool holding it", async () => {
  const held = await registered("pool-lifecycle", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
    ),
  );
  const other = { ...held.identity, pool: "pool-two" };
  assert.equal(
    await held.assignments.renew(other, held.names.one, 30),
    false,
    "an assignment is another pool's to renew only if it holds it",
  );
  assert.equal(
    await held.assignments.renew(held.identity, held.names.one, 60),
    true,
  );
  assert.equal(
    await held.assignments.held(held.identity, held.names.one),
    true,
  );
  assert.equal(
    await held.assignments.release(held.identity, held.names.one, 30),
    true,
  );
  assert.equal(
    await held.assignments.renew(held.identity, held.names.one, 30),
    false,
    "released work is queued again and no longer held",
  );
  assert.equal(
    await held.prepare(),
    false,
    "a view is materialised once and a release does not clear it",
  );
  await harness.pool.query(
    "UPDATE ticket_execution SET available_at=now() WHERE tenant=$1 AND project=$2",
    [held.partition.tenant, held.partition.project],
  );
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.two,
      `${held.bearer}-two`,
    ),
  );
  assert.equal(
    await held.assignments.refuse(held.identity, held.names.two, "no runner"),
    true,
  );
  assert.equal(
    await held.assignments.renew(held.identity, held.names.two, 30),
    false,
    "a refused assignment is the orchestrator's to settle and not the pool's to hold",
  );
});

test("deregistration takes the credential and leaves the work it held", async () => {
  const held = await registered("pool-deregister", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
    ),
  );
  assert.equal(
    await held.registry.deregister(held.partition, "pool-one"),
    true,
  );
  assert.equal(
    await postgresWorkerPoolRegistry(plane).authenticate(held.credential),
    undefined,
  );
  const row = await harness.pool.query<{ state: string; pool: string }>(
    "SELECT state,pool FROM ticket_execution WHERE tenant=$1 AND project=$2",
    [held.partition.tenant, held.partition.project],
  );
  assert.deepEqual(row.rows[0], { state: "Running", pool: "pool-one" });
});
