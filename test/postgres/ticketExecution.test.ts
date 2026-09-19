import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type pg from "pg";
import {
  postgresTicketExecution,
  postgresTicketExecutionTerminals,
} from "../../src/adapters/postgres/ticketExecution.ts";
import { postgresTicketMachineInbox } from "../../src/adapters/postgres/ticketMachineInbox.ts";
import {
  schedulerRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import * as task from "../../src/domain/chuggernaut/task.js";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  Driver,
  released,
  dispatch,
  work_obligation,
} from "../chuggernaut/domain/testing.js";
import type { TicketExecutionView } from "../../src/interpreter/ticketExecution.ts";
import { obligationNeeding } from "./executionFixtures.ts";
import {
  postgresHarnessOpen,
  postgresHarnessEpoch,
  postgresHarnessNewEpoch,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let writer: pg.Pool;
let scheduler: pg.Pool;
let worker: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  writer = postgresHarnessRolePool(ticketServiceRole);
  scheduler = postgresHarnessRolePool(schedulerRole);
  worker = postgresHarnessRolePool(workerPlaneRole);
});
after(async () => {
  await Promise.all([writer.end(), scheduler.end(), worker.end()]);
  await harness.close();
});

/** The view an attempt's harness is served, which the bind writes beside its bearer. */
const workerView = {
  workload: { runner: "script", command: ["just", "check"] },
  inputs: {},
  resultContract: { type: "object" },
  requiredCapabilities: [],
  context: [],
  repository: "https://git.invalid/owner/repository.git",
  commit: "0123456789012345678901234567890123456789",
  access: "ReadRepository",
} as unknown as TicketExecutionView;

function obligation() {
  const driver = new Driver();
  driver.submit(new ticket.CreateTicket(released(1)));
  driver.submit(dispatch(1));
  return work_obligation(driver.graph, 1);
}

/** One project holding one queued task that asks for what it names, and the reads over it. */
async function queuedNeeding(name: string, capabilities: readonly string[]) {
  const partition = await postgresHarnessProject(harness.store, name);
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    obligationNeeding(capabilities),
  );
  return {
    partition,
    store: postgresTicketExecution(scheduler),
    epoch: await postgresHarnessEpoch(harness.store),
    mine: (claims: readonly { partition: { project: string } }[]) =>
      claims.filter((held) => held.partition.project === partition.project),
  };
}

test("a claimant is offered only the work its capabilities cover", async () => {
  const { store, epoch, mine } = await queuedNeeding("execution-capabilities", [
    "macos",
  ]);
  assert.deepEqual(
    mine(await store.claim("linux-pool", epoch, 30, 10, ["linux"])),
    [],
  );
  const found = mine(
    await store.claim("macos-pool", epoch, 30, 10, ["linux", "macos"]),
  );
  assert.equal(found.length, 1);
});

test("cancellation tombstones defeat late and racing execution delivery", async () => {
  const store = postgresTicketExecution(writer);
  for (const mode of ["before", "racing"] as const) {
    const partition = await postgresHarnessProject(
      harness.store,
      `execution-cancel-${mode}`,
    );
    const cancel = store.cancel(partition, "cancel", "work:1:1");
    if (mode === "before") await cancel;
    await Promise.all([
      cancel,
      store.execute(partition, "execute", "work:1:1", obligation()),
    ]);
    const found = await harness.pool.query<{ state: string }>(
      "SELECT state FROM ticket_execution WHERE tenant=$1 AND project=$2",
      [partition.tenant, partition.project],
    );
    assert.ok(found.rows.length === 0 || found.rows[0]?.state === "Cancelled");
  }
});

function terminalInput(held: task.TaskObligation) {
  return {
    identity: "terminal",
    origin: "Execution" as const,
    authorization: {
      principal: "scheduler",
      authorizedOperation: "ReportTaskTerminal",
      authorityKind: "Scheduler",
      authoritySubject: "scheduler",
      policyRevision: "test-policy-v1",
    },
    command: new ticket.ReportTaskTerminal(
      new ticket.TerminalFailureReport(
        task.TicketId(1),
        new task.TaskFailure(held.task, task.ContentRef(1)),
        new ticket.ProcessFailure(),
      ),
    ),
  };
}

test("queued work nobody claims is taken once its window has passed", async () => {
  const { partition, store, epoch, mine } = await queuedNeeding(
    "execution-unclaimable",
    ["macos"],
  );
  assert.deepEqual(
    mine(await store.unclaimable("sweep", epoch, 30, 10, 60)),
    [],
  );
  await harness.pool.query(
    "UPDATE ticket_execution SET queued_at=now()-make_interval(secs=>120) WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  assert.equal(
    mine(await store.unclaimable("sweep", epoch, 30, 10, 60)).length,
    1,
  );
  assert.deepEqual(
    mine(await store.unclaimable("sweep", epoch, 30, 10, 60)),
    [],
  );
});

test("attempt takeover fences worker capabilities and terminal queue acceptance", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "execution-attempt",
  );
  const held = obligation();
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    held,
  );
  const store = postgresTicketExecution(scheduler);
  const epoch = await postgresHarnessEpoch(harness.store);
  const first = (await store.claim("scheduler", epoch, 30, 10, [])).find(
    (claim) => claim.partition.project === partition.project,
  );
  assert.ok(first);
  const terminals = postgresTicketExecutionTerminals(scheduler);
  const reports = postgresTicketExecutionTerminals(worker);
  assert.equal(
    await terminals.bind(first, "first-capability", workerView),
    true,
  );
  assert.deepEqual(await reports.view("first-capability"), workerView);
  assert.equal(
    await reports.report("first-capability", {
      taskKey: first.taskKey,
      outcome: { result: "ProcessFailed" },
    }),
    "Recorded",
  );
  await harness.pool.query(
    "UPDATE ticket_execution SET claim_expires_at=now()-interval '1 second' WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  const second = (await store.claim("replacement", epoch, 30, 10, [])).find(
    (claim) => claim.partition.project === partition.project,
  );
  assert.ok(second);
  assert.equal(second.attempt, first.attempt + 1);
  assert.equal(await terminals.outcome(second), undefined);
  assert.equal(
    await terminals.bind(second, "second-capability", workerView),
    true,
  );
  assert.equal(await reports.view("first-capability"), undefined);
  assert.equal(
    await reports.report("first-capability", {
      taskKey: first.taskKey,
      outcome: { result: "ProcessFailed" },
    }),
    "Fenced",
  );
  const input = terminalInput(held);
  assert.equal(await store.terminal(first, input), false);
  const before = await harness.pool.query(
    "SELECT identity FROM ticket_machine_submission WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  assert.equal(before.rows.length, 0);
  assert.equal(await store.terminal(second, input), true);
  assert.equal(
    (await postgresTicketMachineInbox(scheduler).submit(partition, input))
      .accepted,
    "AlreadyAccepted",
  );
});

test("a scheduler from a prior recovery epoch cannot claim fresh work", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "execution-epoch",
  );
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    obligation(),
  );
  const previous = await postgresHarnessEpoch(harness.store);
  const current = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const store = postgresTicketExecution(scheduler);
  assert.deepEqual(
    await store.claim("stale-scheduler", previous, 30, 10, []),
    [],
  );
  const claims = await store.claim("current-scheduler", current, 30, 10, []);
  const claim = claims.find(
    (value) => value.partition.project === partition.project,
  );
  assert.ok(claim);
  assert.equal(claim.recoveryEpoch, current);
  assert.equal(claim.attempt, 1);
});
