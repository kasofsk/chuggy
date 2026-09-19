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
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
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

/** The issuer every principal in this suite is derived under, which no server here is. */
const issuer = "https://issuer.invalid";

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
  const clientId = `client-${name}`;
  const principal = oidcPrincipal(issuer, clientId);
  assert.equal(
    await registry.register({
      partition,
      pool: "pool-one",
      capabilities: declares,
      clientId,
      principal,
    }),
    true,
  );
  const identity = await postgresWorkerPoolRegistry(plane).identify(principal);
  assert.ok(identity);
  return {
    partition,
    clientId,
    principal,
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
      3,
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
      3,
    ),
    undefined,
  );
  const claimed = await held.assignments.claim(
    held.identity,
    30,
    held.names.one,
    held.bearer,
    3,
  );
  assert.deepEqual(claimed?.capabilities, ["linux"]);
  assert.deepEqual(
    (claimed?.view as { workload: unknown }).workload,
    preparedView.workload,
  );
});

test("a pool is offered nothing whose claims kept expiring in silence", async () => {
  const held = await registered("pool-unreported", [], []);
  assert.equal(await held.prepare(), true);
  const expire = () =>
    harness.pool.query(
      "UPDATE ticket_execution SET claim_expires_at=now()-make_interval(secs=>1) WHERE tenant=$1 AND project=$2",
      [held.partition.tenant, held.partition.project],
    );
  for (const taken of [1, 2, 3]) {
    assert.ok(
      await held.assignments.claim(
        held.identity,
        30,
        `${held.names.one}-${String(taken)}`,
        `${held.bearer}-${String(taken)}`,
        2,
      ),
    );
    await expire();
  }
  assert.equal(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.two,
      `${held.bearer}-last`,
      2,
    ),
    undefined,
  );
});

test("what names a pool authenticates no attempt and reports no terminal", async () => {
  const held = await registered("pool-separation", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
      3,
    ),
  );
  const reports = postgresTicketExecutionTerminals(worker);
  assert.equal(await reports.view(held.clientId), undefined);
  assert.notEqual(
    await reports.view(held.bearer),
    undefined,
    "the attempt's own bearer is what that plane answers",
  );
  assert.equal(
    await reports.report(held.clientId, {
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

/**
 * A pool-placed harness holds its bearer and nothing else about the work it
 * ran, so a terminal keyed on anything the pool never saw is a terminal it
 * cannot write. What it reports is what the orchestrator then finds to settle.
 */
test("a harness holding only its bearer reports the terminal the pool's attempt settles on", async () => {
  const held = await registered("pool-report", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
      3,
    ),
  );
  const reports = postgresTicketExecutionTerminals(worker);
  const outcome = { type: "result", manifest: { verdict: "done" } };
  assert.equal(await reports.report(held.bearer, { outcome }), "Recorded");
  assert.equal(
    await reports.report(held.bearer, { outcome }),
    "Recorded",
    "one harness retrying its own terminal is the terminal it already wrote",
  );
  const settlements = await postgresTicketExecution(scheduler).settlements(10);
  const settled = settlements.find(
    (candidate) => candidate.claim.partition.project === held.partition.project,
  );
  assert.equal(settled?.claim.taskKey, "work:1:1");
  assert.deepEqual(settled?.outcome, outcome);
});

/**
 * The bearer a terminal is resolved by identifies one attempt or it identifies
 * nothing. A second claim offering a bearer already bound is refused by the
 * relation rather than allowed to make two live attempts answer one credential.
 */
test("one bearer binds one attempt and a second claim under it is refused", async () => {
  const held = await registered("pool-bearer", [], []);
  assert.equal(await held.prepare(), true);
  await postgresTicketExecution(writer).execute(
    held.partition,
    "execute-two",
    "work:1:2",
    obligationNeeding([]),
  );
  assert.equal(
    await postgresTicketExecution(scheduler).prepare(
      held.partition,
      "work:1:2",
      preparedView,
    ),
    true,
  );
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
      3,
    ),
  );
  await assert.rejects(
    () =>
      held.assignments.claim(held.identity, 30, held.names.two, held.bearer, 3),
    /capability_digest/u,
  );
});

test("the plane serving harnesses cannot read the relation a pool is registered in", async () => {
  assert.match(
    (await harness.attemptAs(
      workerPlaneRole,
      "SELECT principal FROM worker_pool",
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
      3,
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
      3,
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

test("deregistration answers with the client it removed and leaves the work it held", async () => {
  const held = await registered("pool-deregister", [], []);
  assert.equal(await held.prepare(), true);
  assert.ok(
    await held.assignments.claim(
      held.identity,
      30,
      held.names.one,
      held.bearer,
      3,
    ),
  );
  assert.equal(
    await held.registry.deregister(held.partition, "pool-one"),
    held.clientId,
  );
  assert.equal(
    await postgresWorkerPoolRegistry(plane).identify(held.principal),
    undefined,
  );
  const row = await harness.pool.query<{ state: string; pool: string }>(
    "SELECT state,pool FROM ticket_execution WHERE tenant=$1 AND project=$2",
    [held.partition.tenant, held.partition.project],
  );
  assert.deepEqual(row.rows[0], { state: "Running", pool: "pool-one" });
});
