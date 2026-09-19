import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type pg from "pg";
import {
  postgresTicketExecution,
  postgresTicketExecutionTerminals,
} from "../../src/adapters/postgres/ticketExecution.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import { postgresTicketExecutionRun } from "../../src/adapters/postgres/ticketExecutionRun.ts";
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
import type {
  TicketExecutionClaim,
  TicketExecutionView,
} from "../../src/interpreter/ticketExecution.ts";
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
    mine(await store.claim("linux-pool", epoch, 30, 10, ["linux"], 3)),
    [],
  );
  const found = mine(
    await store.claim("macos-pool", epoch, 30, 10, ["linux", "macos"], 3),
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

test("a claim that expires in silence is counted, and the ceiling ends the cycle", async () => {
  const { partition, store, epoch, mine } = await queuedNeeding(
    "execution-unreported",
    [],
  );
  const expire = () =>
    harness.pool.query(
      "UPDATE ticket_execution SET claim_expires_at=now()-make_interval(secs=>1) WHERE tenant=$1 AND project=$2",
      [partition.tenant, partition.project],
    );
  assert.deepEqual(mine(await store.unreported("sweep", epoch, 30, 10, 2)), []);
  for (const taken of [1, 2, 3]) {
    assert.equal(
      mine(await store.claim(`pool-${String(taken)}`, epoch, 30, 10, [], 2))
        .length,
      1,
    );
    await expire();
  }
  assert.deepEqual(
    mine(await store.claim("pool-four", epoch, 30, 10, [], 2)),
    [],
  );
  assert.equal(
    mine(await store.unreported("sweep", epoch, 30, 10, 2)).length,
    1,
  );
});

test("a claim that reported an outcome is not a claim that said nothing", async () => {
  const { partition, store, epoch, mine } = await queuedNeeding(
    "execution-reported",
    [],
  );
  for (const taken of [1, 2, 3]) {
    assert.equal(
      mine(await store.claim(`pool-${String(taken)}`, epoch, 30, 10, [], 2))
        .length,
      1,
    );
    await harness.pool.query(
      `UPDATE ticket_execution SET worker_outcome='{"outcome":{}}'::jsonb,
         claim_expires_at=now()-make_interval(secs=>1) WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    );
  }
  assert.equal(
    mine(await store.claim("pool-four", epoch, 30, 10, [], 2)).length,
    1,
  );
});

test("a workload's own liveness is stamped by it and cleared by the next claim", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "execution-liveness",
  );
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    obligation(),
  );
  const store = postgresTicketExecution(scheduler);
  const epoch = await postgresHarnessEpoch(harness.store);
  const mine = (claims: readonly TicketExecutionClaim[]) =>
    claims.find((claim) => claim.partition.project === partition.project);
  const first = mine(await store.claim("scheduler", epoch, 30, 10, [], 3));
  assert.ok(first);
  const terminals = postgresTicketExecutionTerminals(scheduler);
  const reports = postgresTicketExecutionTerminals(worker);
  assert.equal(
    await terminals.bind(first, "first-capability", workerView),
    true,
  );
  const stamped = async (): Promise<Date | null> =>
    (
      await harness.pool.query<{ last_reported_at: Date | null }>(
        "SELECT last_reported_at FROM ticket_execution WHERE tenant=$1 AND project=$2",
        [partition.tenant, partition.project],
      )
    ).rows[0]?.last_reported_at ?? null;
  assert.equal(await stamped(), null, "a claim nobody has run says nothing");
  assert.equal(await reports.heartbeat("first-capability"), "Recorded");
  assert.notEqual(await stamped(), null);
  assert.equal(
    await reports.heartbeat("second-capability"),
    "Fenced",
    "a bearer no live attempt is bound to stamps nothing",
  );
  await harness.pool.query(
    "UPDATE ticket_execution SET claim_expires_at=now()-interval '1 second' WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  const second = mine(await store.claim("replacement", epoch, 30, 10, [], 3));
  assert.ok(second);
  assert.equal(
    await stamped(),
    null,
    "a stamp belongs to the attempt that wrote it",
  );
});

/** A blob store of this run's own, so a measure's bytes land somewhere the case owns. */
function sessionBlobs(root: string) {
  return artifactStore({ root });
}

/** One bound attempt, whose bearer is the whole of what a measure is addressed by. */
async function boundForMeasure(name: string, capability: string) {
  const partition = await postgresHarnessProject(harness.store, name);
  await postgresTicketExecution(writer).execute(
    partition,
    "execute",
    "work:1:1",
    obligation(),
  );
  const store = postgresTicketExecution(scheduler);
  const epoch = await postgresHarnessEpoch(harness.store);
  const claim = (await store.claim("scheduler", epoch, 30, 10, [], 3)).find(
    (held) => held.partition.project === partition.project,
  );
  assert.ok(claim);
  assert.equal(
    await postgresTicketExecutionTerminals(scheduler).bind(
      claim,
      capability,
      workerView,
    ),
    true,
  );
  return {
    partition,
    run: postgresTicketExecutionRun(
      worker,
      sessionBlobs(join(tmpdir(), `chug-run-${name}`)),
    ),
  };
}

const measuredTurn = {
  ordinal: 1,
  model: "sonnet",
  tokensInput: 4,
  tokensOutput: 1,
  tokensCacheCreation: 0,
  tokensCacheRead: 0,
};

const measuredTotals = {
  turns: 1,
  durationMs: 900,
  durationApiMs: 400,
  tokensInput: 4,
  tokensOutput: 1,
  tokensCacheCreation: 0,
  tokensCacheRead: 0,
  costUsdMicros: 12_500,
  costBasis: "List" as const,
  permissionDenials: 0,
  models: [
    {
      model: "sonnet",
      tokensInput: 4,
      tokensOutput: 1,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
      costUsdMicros: 2_000,
    },
  ],
};

test("a turn is stored once and one ordinal cannot hold two answers", async () => {
  const { run } = await boundForMeasure("execution-turns", "turn-capability");
  assert.equal(await run.turns("turn-capability", [measuredTurn]), "Stored");
  assert.equal(
    await run.turns("turn-capability", [measuredTurn]),
    "AlreadyStored",
  );
  assert.equal(
    await run.turns("turn-capability", [{ ...measuredTurn, tokensInput: 9 }]),
    "Conflict",
    "an ordinal is what a reader pages by",
  );
  assert.equal(await run.turns("no-such-capability", [measuredTurn]), "Fenced");
});

test("totals are stored once, with the per-model cost the run reported", async () => {
  const { partition, run } = await boundForMeasure(
    "execution-totals",
    "total-capability",
  );
  assert.equal(await run.totals("total-capability", measuredTotals), "Stored");
  assert.equal(
    await run.totals("total-capability", measuredTotals),
    "AlreadyStored",
  );
  assert.equal(
    await run.totals("total-capability", {
      ...measuredTotals,
      durationMs: 1,
    }),
    "Conflict",
  );
  assert.equal(
    await run.totals("no-such-capability", measuredTotals),
    "Fenced",
  );
  const stored = await harness.pool.query<{ cost_usd_micros: string }>(
    `SELECT cost_usd_micros FROM ticket_execution_run_model_usage
     WHERE tenant=$1 AND project=$2 AND model='sonnet'`,
    [partition.tenant, partition.project],
  );
  assert.equal(stored.rows[0]?.cost_usd_micros, "2000");
});

test("a transcript is measured by the plane and must arrive in order", async () => {
  const { partition, run } = await boundForMeasure(
    "execution-transcript",
    "transcript-capability",
  );
  const bytes = (text: string) => new TextEncoder().encode(text);
  assert.equal(
    await run.transcript("transcript-capability", 2, bytes("late\n")),
    "OutOfOrder",
    "a gap would be a transcript nobody can say is whole",
  );
  assert.equal(
    await run.transcript("transcript-capability", 1, bytes("one\ntwo\n")),
    "Stored",
  );
  assert.equal(
    await run.transcript("transcript-capability", 1, bytes("one\ntwo\n")),
    "AlreadyStored",
  );
  assert.equal(
    await run.transcript("transcript-capability", 1, bytes("different\n")),
    "Conflict",
  );
  assert.equal(
    await run.transcript("no-such-capability", 1, bytes("one\n")),
    "Fenced",
  );
  const stored = await harness.pool.query<{
    events: string;
    bytes: string;
    digest: string;
  }>(
    `SELECT events,bytes,digest FROM ticket_execution_run_transcript_batch
     WHERE tenant=$1 AND project=$2 AND batch=1`,
    [partition.tenant, partition.project],
  );
  assert.equal(
    stored.rows[0]?.events,
    "2",
    "the plane recounts the events rather than believing a field",
  );
  assert.equal(stored.rows[0]?.bytes, "8");
  assert.match(stored.rows[0]?.digest ?? "", /^[0-9a-f]{64}$/u);
});

test("a configuration snapshot is stored once for the attempt that ran under it", async () => {
  const { run } = await boundForMeasure(
    "execution-configuration",
    "configuration-capability",
  );
  const bytes = (text: string) => new TextEncoder().encode(text);
  assert.equal(
    await run.configuration("configuration-capability", bytes('{"argv":[]}')),
    "Stored",
  );
  assert.equal(
    await run.configuration("configuration-capability", bytes('{"argv":[]}')),
    "AlreadyStored",
  );
  assert.equal(
    await run.configuration(
      "configuration-capability",
      bytes('{"argv":["x"]}'),
    ),
    "Conflict",
  );
  assert.equal(
    await run.configuration("no-such-capability", bytes("{}")),
    "Fenced",
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
  const first = (await store.claim("scheduler", epoch, 30, 10, [], 3)).find(
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
      outcome: { result: "ProcessFailed" },
    }),
    "Recorded",
  );
  await harness.pool.query(
    "UPDATE ticket_execution SET claim_expires_at=now()-interval '1 second' WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  const second = (await store.claim("replacement", epoch, 30, 10, [], 3)).find(
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
    await store.claim("stale-scheduler", previous, 30, 10, [], 3),
    [],
  );
  const claims = await store.claim("current-scheduler", current, 30, 10, [], 3);
  const claim = claims.find(
    (value) => value.partition.project === partition.project,
  );
  assert.ok(claim);
  assert.equal(claim.recoveryEpoch, current);
  assert.equal(claim.attempt, 1);
});
