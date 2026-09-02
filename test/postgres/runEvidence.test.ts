/**
 * The run-evidence boundary against a real server: contiguity, idempotency,
 * the refusals, the immutability triggers, the change-log appends and the
 * ticket rollup.
 *
 * EVERY VERDICT HERE IS THE DATABASE'S. The plane maps a string to a status and
 * decides nothing, so a case that asked an adapter would be asserting the
 * adapter's beliefs back at it; each case below drives the boundary function as
 * the worker plane role and reads the rows the owner can see.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresTicketRunTotals,
  postgresAttemptRuns,
  postgresRunEvidenceReads,
} from "../../src/adapters/postgres/runEvidence.ts";
import {
  postgresWorkerRunConfiguration,
  postgresWorkerRunEnded,
  postgresWorkerRunTotal,
  postgresWorkerRunTranscript,
  postgresWorkerRunTurns,
} from "../../src/adapters/postgres/workerPlane.ts";
import {
  nativeHttpPageItemsMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
} from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import type {
  RunEndedEvidence,
  RunTotals,
} from "../../src/interpreter/runEvidence.ts";
import {
  postgresHarnessNewEpoch,
  postgresHarnessRolePool,
  postgresHarnessUrl,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const workerUrl = new URL(postgresHarnessUrl());
workerUrl.searchParams.set("options", `-c role=${workerPlaneRole}`);
const workerPool = postgresPool(workerUrl.toString());
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await Promise.all([workerPool.end(), apiPool.end()]);
  await rig.close();
});

const configurations = postgresWorkerRunConfiguration(workerPool);
const transcripts = postgresWorkerRunTranscript(workerPool);
const turns = postgresWorkerRunTurns(workerPool);
const totals = postgresWorkerRunTotal(workerPool);
const endings = postgresWorkerRunEnded(workerPool);

const digestOf = (seed: string) =>
  asArtifactDigest(seed.repeat(64).slice(0, 64));

/** One placed, live attempt on its own project, which is what a run writes as. */
async function placedAttempt(label: string, project?: SchedulerProject) {
  const drawn = project ?? (await schedulerProject(rig, label));
  if (project === undefined)
    await rig.store.registerSpawn(
      await schedulerClaimFor(
        rig,
        drawn.partition,
        drawn.request,
        schedulerOwner(label),
      ),
      200,
    );
  const placed = await schedulerPlacedAttempt(rig, drawn, label);
  return { attempt: placed.attempt, project: drawn };
}

/** The figures one run reports, which a case varies one field of at a time. */
function runTotalsFixture(costUsdMicros: number): RunTotals {
  return {
    turns: 3,
    durationMs: 1_200,
    durationApiMs: 900,
    tokensInput: 10,
    tokensOutput: 20,
    tokensCacheCreation: 30,
    tokensCacheRead: 40,
    costUsdMicros,
    costBasis: "List",
    models: [
      {
        model: "claude-fixture",
        tokensInput: 10,
        tokensOutput: 20,
        tokensCacheCreation: 30,
        tokensCacheRead: 40,
        costUsdMicros,
      },
    ],
    permissionDenials: 1,
    resultSubtype: "success",
    stopReason: "end_turn",
  };
}

async function changeCount(
  partition: SchedulerProject["partition"],
  kind: string,
): Promise<number> {
  const found = (await rig.harness.query(
    `SELECT count(*)::text AS appended FROM project_change
      WHERE tenant=$1 AND project=$2 AND kind=$3`,
    [partition.tenant, partition.project, kind],
  )) as readonly { appended: string }[];
  return Number(found[0]?.appended ?? "0");
}

test("a transcript batch is contiguous, idempotent and refuses a rewrite", async () => {
  const { attempt } = await placedAttempt("run-transcript");
  const write = (batch: number, seed: string, bytes = 8) =>
    transcripts.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      batch,
      digest: digestOf(seed),
      bytes,
      events: 1,
    });
  assert.equal(await write(2, "a"), "OutOfOrder");
  assert.equal(await write(1, "a"), "Stored");
  assert.equal(await write(1, "a"), "AlreadyStored");
  assert.equal(await write(1, "b"), "Conflict");
  assert.equal(await write(1, "a", 9), "Conflict");
  assert.equal(await write(3, "c"), "OutOfOrder");
  assert.equal(await write(2, "c"), "Stored");
  await assert.rejects(
    () => write(runTranscriptBatchesMax + 1, "d"),
    RangeError,
    "the port derived a path for a batch past the run's bound",
  );
  const past = await workerPool.query<{ stored: string }>(
    `SELECT record_worker_run_transcript_batch($1,$2,$3,$4,$5,$6,$7)::text AS stored`,
    [
      createHash("sha256")
        .update(attempt.capability.secret, "utf8")
        .digest("hex"),
      attempt.generation,
      runTranscriptBatchesMax + 1,
      ".chuggy/run/transcript/past.jsonl",
      digestOf("d"),
      4,
      1,
    ],
  );
  assert.equal(past.rows[0]?.stored, "QuotaExceeded");
});

test("a run's turns are absolute, idempotent and refuse a contradiction", async () => {
  const { attempt } = await placedAttempt("run-turns");
  const offer = (ordinal: number, model: string) => ({
    ordinal,
    model,
    tokensInput: 1,
    tokensOutput: 2,
    tokensCacheCreation: 3,
    tokensCacheRead: 4,
  });
  const record = (offered: readonly ReturnType<typeof offer>[]) =>
    turns.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      turns: offered,
    });
  assert.deepEqual(await record([offer(1, "one"), offer(2, "two")]), {
    recorded: "Recorded",
    turnsRecorded: 2,
  });
  assert.deepEqual(await record([offer(1, "one"), offer(2, "two")]), {
    recorded: "Recorded",
    turnsRecorded: 2,
  });
  assert.deepEqual(await record([offer(2, "other")]), {
    recorded: "Conflict",
  });
  assert.deepEqual(await record([offer(1, "one"), offer(1, "one")]), {
    recorded: "Conflict",
  });
  assert.deepEqual(await record([offer(runTurnSeriesMax + 1, "past")]), {
    recorded: "Conflict",
  });
  assert.deepEqual(
    await rig.harness.query(
      `SELECT ordinal::text AS ordinal,model FROM execution_run_turn
        WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4
        ORDER BY ordinal`,
      [
        attempt.partition.tenant,
        attempt.partition.project,
        attempt.execution,
        attempt.attempt,
      ],
    ),
    [
      { ordinal: "1", model: "one" },
      { ordinal: "2", model: "two" },
    ],
  );
});

test("a turn ordinal past the series bound is refused by the relation itself", async () => {
  const { attempt } = await placedAttempt("run-turn-check");
  await rig.harness.query(
    `INSERT INTO execution_run (tenant,project,execution,attempt)
     VALUES ($1,$2,$3,$4)`,
    [
      attempt.partition.tenant,
      attempt.partition.project,
      attempt.execution,
      attempt.attempt,
    ],
  );
  await assert.rejects(
    rig.harness.query(
      `INSERT INTO execution_run_turn
         (tenant,project,execution,attempt,ordinal,model,
          tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read)
       VALUES ($1,$2,$3,$4,$5,'past',0,0,0,0)`,
      [
        attempt.partition.tenant,
        attempt.partition.project,
        attempt.execution,
        attempt.attempt,
        runTurnSeriesMax + 1,
      ],
    ),
    /execution_run_turn_ordinal_is_bounded/u,
  );
});

test("a run's totals are written once and a different figure is refused", async () => {
  const { attempt } = await placedAttempt("run-totals");
  const record = (costUsdMicros: number) =>
    totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: runTotalsFixture(costUsdMicros),
    });
  assert.equal(await record(4_200), "Stored");
  assert.equal(await record(4_200), "AlreadyStored");
  assert.equal(await record(9_900), "Conflict");
  assert.equal(
    await totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: {
        ...runTotalsFixture(4_200),
        models: [
          {
            model: "totally-different",
            tokensInput: 999,
            tokensOutput: 999,
            tokensCacheCreation: 999,
            tokensCacheRead: 999,
            costUsdMicros: 999,
          },
        ],
      },
    }),
    "Conflict",
  );
  assert.equal(
    await totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: { ...runTotalsFixture(4_200), models: [] },
    }),
    "Conflict",
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT cost_usd_micros::text AS cost FROM execution_run_total
        WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
      [
        attempt.partition.tenant,
        attempt.partition.project,
        attempt.execution,
        attempt.attempt,
      ],
    ),
    [{ cost: "4200" }],
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT model,cost_usd_micros::text AS cost FROM execution_run_model_usage
        WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
      [
        attempt.partition.tenant,
        attempt.partition.project,
        attempt.execution,
        attempt.attempt,
      ],
    ),
    [{ model: "claude-fixture", cost: "4200" }],
  );
});

test("a run's configuration is recorded once and a second snapshot is refused", async () => {
  const { attempt } = await placedAttempt("run-configuration");
  const record = (seed: string, bytes = 64) =>
    configurations.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      digest: digestOf(seed),
      bytes,
    });
  assert.equal(await record("a"), "Stored");
  assert.equal(await record("a"), "AlreadyStored");
  assert.equal(await record("b"), "Conflict");
});

test("a configuration that follows a batch fills the run it already opened", async () => {
  const { attempt } = await placedAttempt("run-configuration-late");
  assert.equal(
    await transcripts.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Stored",
  );
  assert.equal(
    await configurations.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      digest: digestOf("c"),
      bytes: 16,
    }),
    "Stored",
  );
  const run = await postgresAttemptRuns(
    apiPool,
    attempt.partition,
    attempt.execution,
  );
  assert.equal(run.get(attempt.attempt)?.configuration?.digest, digestOf("c"));
});

test("every run evidence row refuses an update and a delete", async () => {
  const { attempt } = await placedAttempt("run-immutable");
  const keys = [
    attempt.partition.tenant,
    attempt.partition.project,
    attempt.execution,
    attempt.attempt,
  ];
  assert.equal(
    await transcripts.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Stored",
  );
  assert.deepEqual(
    await turns.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      turns: [
        {
          ordinal: 1,
          model: "one",
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheCreation: 1,
          tokensCacheRead: 1,
        },
      ],
    }),
    { recorded: "Recorded", turnsRecorded: 1 },
  );
  assert.equal(
    await totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: runTotalsFixture(1),
    }),
    "Stored",
  );
  const where =
    "WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4";
  for (const [relation, column] of [
    ["execution_run", "started_at=now()"],
    ["execution_run_transcript_batch", "events=events+1"],
    ["execution_run_turn", "model='rewritten'"],
    ["execution_run_total", "turns=turns+1"],
    ["execution_run_model_usage", "cost_usd_micros=0"],
  ] as const) {
    await assert.rejects(
      rig.harness.query(`UPDATE ${relation} SET ${column} ${where}`, keys),
      /written once/u,
      `${relation} accepted an update`,
    );
    await assert.rejects(
      rig.harness.query(`DELETE FROM ${relation} ${where}`, keys),
      /written once/u,
      `${relation} accepted a delete`,
    );
  }
});

/** What one bearer may offer, which a fence refuses whichever precondition it fails. */
type RunBearer = Awaited<ReturnType<typeof placedAttempt>>["attempt"];

/**
 * Every durable evidence write one bearer can make, each refused and each
 * having opened no run: a precondition that let one of the four through would
 * leave a row behind whatever the other three answered.
 */
async function runWritesAreFenced(
  attempt: RunBearer,
  generation: number,
  what: string,
): Promise<void> {
  const write = { secret: attempt.capability.secret, generation };
  assert.equal(
    await configurations.record({ ...write, digest: digestOf("a"), bytes: 4 }),
    "Fenced",
    `${what}: a configuration`,
  );
  assert.equal(
    await transcripts.record({
      ...write,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Fenced",
    `${what}: a transcript batch`,
  );
  assert.deepEqual(
    await turns.record({ ...write, turns: [] }),
    { recorded: "Fenced" },
    `${what}: a turn page`,
  );
  assert.equal(
    await totals.record({ ...write, totals: runTotalsFixture(1) }),
    "Fenced",
    `${what}: the totals`,
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT count(*)::text AS opened FROM execution_run
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [attempt.partition.tenant, attempt.partition.project, attempt.execution],
    ),
    [{ opened: "0" }],
    `${what}: a run was opened anyway`,
  );
}

test("a run's configuration fills once and carries no other column with it", async () => {
  const { attempt } = await placedAttempt("run-fill-only");
  const keys = [
    attempt.partition.tenant,
    attempt.partition.project,
    attempt.execution,
    attempt.attempt,
  ];
  assert.equal(
    await transcripts.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Stored",
  );
  const where =
    "WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4";
  await assert.rejects(
    rig.harness.query(
      `UPDATE execution_run
          SET configuration_path='.chuggy/run/configuration.json',
              configuration_digest=$5,configuration_bytes=16,
              configuration_recorded_at=now(),
              started_at=now()-interval '5 days' ${where}`,
      [...keys, digestOf("c")],
    ),
    /written once/u,
    "a fill carried another column with it",
  );
  assert.equal(
    await configurations.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      digest: digestOf("c"),
      bytes: 16,
    }),
    "Stored",
  );
  await assert.rejects(
    rig.harness.query(
      `UPDATE execution_run SET configuration_digest=$5 ${where}`,
      [...keys, digestOf("d")],
    ),
    /written once/u,
    "a filled configuration was rewritten",
  );
});

test("a bearer naming a generation its attempt has left writes nothing", async () => {
  const { attempt } = await placedAttempt("run-fenced-generation");
  await runWritesAreFenced(
    attempt,
    attempt.generation + 1,
    "a stale generation",
  );
});

test("a bearer whose attempt has ended writes nothing, its epoch current", async () => {
  const { attempt } = await placedAttempt("run-fenced-attempt");
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT state FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
    ),
    [{ state: "Lost" }],
  );
  await runWritesAreFenced(attempt, attempt.generation, "an ended attempt");
});

test("a bearer whose execution has stopped writes nothing, its attempt live", async () => {
  const { attempt } = await placedAttempt("run-fenced-execution");
  await rig.harness.query(
    `UPDATE execution SET status='Cancelled',terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.execution],
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT a.state,e.status FROM execution_attempt a
         JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                         AND e.execution=a.execution
        WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
      [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
    ),
    [{ state: "Running", status: "Cancelled" }],
  );
  await runWritesAreFenced(attempt, attempt.generation, "a stopped execution");
});

test("a bearer under a superseded recovery epoch writes nothing", async () => {
  const { attempt } = await placedAttempt("run-fenced-epoch");
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  await runWritesAreFenced(attempt, attempt.generation, "a superseded epoch");
});

test("a batch appends one execution change and the totals append a ticket change", async () => {
  const { attempt, project } = await placedAttempt("run-changes");
  const executions = await changeCount(project.partition, "Execution");
  const tickets = await changeCount(project.partition, "Ticket");
  assert.equal(
    await transcripts.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Stored",
  );
  assert.equal(
    await changeCount(project.partition, "Execution"),
    executions + 2,
  );
  assert.equal(await changeCount(project.partition, "Ticket"), tickets);
  assert.equal(
    await totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: runTotalsFixture(7),
    }),
    "Stored",
  );
  assert.equal(
    await changeCount(project.partition, "Execution"),
    executions + 3,
  );
  assert.equal(await changeCount(project.partition, "Ticket"), tickets + 1);
});

test("a run may narrow its own ending to the label its failure names", async () => {
  const { attempt } = await placedAttempt("run-ended");
  assert.equal(
    await endings.end({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      evidence: "RunTurnsExhausted",
    }),
    true,
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT state,evidence FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
    ),
    [{ state: "Lost", evidence: "RunTurnsExhausted" }],
  );
  assert.equal(
    await endings.end({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      evidence: "RunFailed",
    }),
    false,
  );
});

/** What the execution and its attempt look like after one run ended. */
async function endedRun(label: string, evidence: RunEndedEvidence) {
  const { attempt } = await placedAttempt(label);
  assert.equal(
    await endings.end({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      evidence,
    }),
    true,
  );
  const [state] = await rig.harness.query(
    `SELECT a.state,a.evidence,e.retries_spent::text AS retries_spent,
            (e.placement_backoff_from IS NOT NULL) AS backed_off
       FROM execution_attempt a
       JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                       AND e.execution=a.execution
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
  );
  return state;
}

/**
 * kasofsk/chuggy#386's ask, at the grain the charge is made: the pair is what
 * makes either half falsifiable, because a boundary that never charged would
 * pass the withdrawn case alone.
 */
test("a rate-limited run is withdrawn and charges no retry; a failed one is lost and charges one", async () => {
  assert.deepEqual(await endedRun("run-withdrawn", "RunRateLimited"), {
    state: "Withdrawn",
    evidence: "RunRateLimited",
    retries_spent: "0",
    backed_off: true,
  });
  assert.deepEqual(await endedRun("run-lost", "RunFailed"), {
    state: "Lost",
    evidence: "RunFailed",
    retries_spent: "1",
    backed_off: true,
  });
});

/**
 * The worker mirror of `sessionMailbox.test.ts`'s stale-generation case. A
 * boundary that takes a fence argument and does not read it is a control the
 * caller believes in and the server does not.
 */
test("an ending under a generation the durable side has moved past ends nothing, on either arm", async () => {
  for (const evidence of ["RunRateLimited", "RunFailed"] as const) {
    const { attempt } = await placedAttempt(`run-fenced-${evidence}`);
    assert.equal(
      await endings.end({
        secret: attempt.capability.secret,
        generation: attempt.generation + 1,
        evidence,
      }),
      false,
      evidence,
    );
    assert.deepEqual(
      await rig.harness.query(
        `SELECT a.state,a.evidence,e.retries_spent::text AS retries_spent,
                (e.placement_backoff_from IS NULL) AS unpaced
           FROM execution_attempt a
           JOIN execution e ON e.tenant=a.tenant AND e.project=a.project
                           AND e.execution=a.execution
          WHERE a.attempt=$1`,
        [attempt.attempt],
      ),
      [
        {
          state: "Running",
          evidence: null,
          retries_spent: "0",
          unpaced: true,
        },
      ],
      evidence,
    );
  }
});

test("a withdrawn attempt is ended once, so a redelivered ending moves nothing", async () => {
  const { attempt } = await placedAttempt("run-withdrawn-twice");
  const ending = {
    secret: attempt.capability.secret,
    generation: attempt.generation,
    evidence: "RunRateLimited",
  } as const;
  assert.equal(await endings.end(ending), true);
  assert.equal(await endings.end(ending), false);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT e.retries_spent::text AS retries_spent
         FROM execution e
         JOIN execution_attempt a ON a.tenant=e.tenant AND a.project=e.project
                                 AND a.execution=e.execution
        WHERE a.attempt=$1`,
      [attempt.attempt],
    ),
    [{ retries_spent: "0" }],
  );
});

test("a ticket's run totals sum every execution past the page bound", async () => {
  const spread = nativeHttpPageItemsMax + 1;
  const project = await schedulerProject(rig, "run-ticket-rollup", {
    tasks: spread,
    slotsMax: spread * 2,
    maximum: spread * 2,
  });
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("run-ticket-rollup"),
    ),
    200,
  );
  for (let run = 0; run < spread; run += 1) {
    const { attempt } = await placedAttempt("run-ticket-rollup", project);
    assert.equal(
      await totals.record({
        secret: attempt.capability.secret,
        generation: attempt.generation,
        totals: runTotalsFixture(1),
      }),
      "Stored",
    );
  }
  const rolled = await postgresTicketRunTotals(
    apiPool,
    project.partition,
    asTicketId(project.ticket),
  );
  assert.equal(rolled?.costUsdMicros, spread);
  assert.equal(rolled?.turns, spread * 3);
  assert.deepEqual(rolled?.models, [
    {
      model: "claude-fixture",
      tokensInput: spread * 10,
      tokensOutput: spread * 20,
      tokensCacheCreation: spread * 30,
      tokensCacheRead: spread * 40,
      costUsdMicros: spread,
    },
  ]);
});

/** How many pages a walk over a bounded series may draw before it is a loop. */
const runWalkPagesMax = 10;

/** Every ordinal a paged walk drew, in the order the pages drew them. */
async function runWalk(
  page: (after: number | undefined) => Promise<{
    readonly drawn: readonly number[];
    readonly nextAfter?: number;
  }>,
): Promise<readonly number[]> {
  const walked: number[] = [];
  let after: number | undefined;
  for (let pages = 0; pages < runWalkPagesMax; pages += 1) {
    const drawn = await page(after);
    walked.push(...drawn.drawn);
    if (drawn.nextAfter === undefined) return walked;
    after = drawn.nextAfter;
  }
  throw new Error(
    "run walk: the page cursor did not reach the end of a bounded series",
  );
}

/** A series is walked whole when it ascends strictly and skips nothing. */
function runWalkIsWhole(walked: readonly number[], through: number): void {
  assert.deepEqual(
    [...walked],
    Array.from({ length: through }, (_unused, index) => index + 1),
  );
  assert.equal(new Set(walked).size, walked.length, "the walk repeated a row");
}

test("a turn series past one page walks in ascending order and repeats nothing", async () => {
  const { attempt } = await placedAttempt("run-turn-paging");
  const series = 12;
  assert.deepEqual(
    await turns.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      turns: Array.from({ length: series }, (_unused, index) => ({
        ordinal: index + 1,
        model: `model-${String(index + 1)}`,
        tokensInput: index + 1,
        tokensOutput: 0,
        tokensCacheCreation: 0,
        tokensCacheRead: 0,
      })),
    }),
    { recorded: "Recorded", turnsRecorded: series },
  );
  const reads = postgresRunEvidenceReads(apiPool);
  const walked = await runWalk(async (after) => {
    const page = await reads.turns(
      attempt.partition,
      attempt.execution,
      attempt.attempt,
      { ...(after === undefined ? {} : { after }), limit: 5 },
    );
    if (page === undefined) throw new Error("run walk: the attempt is absent");
    for (const turn of page.turns)
      assert.equal(turn.model, `model-${String(turn.ordinal)}`);
    return {
      drawn: page.turns.map((turn) => turn.ordinal),
      ...(page.nextAfter === undefined ? {} : { nextAfter: page.nextAfter }),
    };
  });
  runWalkIsWhole(walked, series);
});

test("a transcript past one page walks in ascending order and repeats nothing", async () => {
  const { attempt } = await placedAttempt("run-batch-paging");
  const series = 11;
  for (let batch = 1; batch <= series; batch += 1)
    assert.equal(
      await transcripts.record({
        secret: attempt.capability.secret,
        generation: attempt.generation,
        batch,
        digest: digestOf(String(batch % 10)),
        bytes: batch,
        events: 1,
      }),
      "Stored",
    );
  const reads = postgresRunEvidenceReads(apiPool);
  const walked = await runWalk(async (after) => {
    const stored = await reads.transcript(
      attempt.partition,
      attempt.execution,
      attempt.attempt,
      after ?? 0,
    );
    if (stored === undefined)
      throw new Error("run walk: the attempt is absent");
    for (const object of stored.objects)
      assert.equal(object.bytes, object.batch);
    return {
      drawn: stored.objects.map((object) => object.batch),
      ...(stored.nextAfter === undefined
        ? {}
        : { nextAfter: stored.nextAfter }),
    };
  });
  runWalkIsWhole(walked, series);
});
