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
import type { RunTotals } from "../../src/interpreter/runEvidence.ts";
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

test("a fenced bearer, a stale generation and a superseded epoch write nothing", async () => {
  const { attempt } = await placedAttempt("run-fenced");
  const stale = {
    secret: attempt.capability.secret,
    generation: attempt.generation + 1,
  };
  assert.equal(
    await configurations.record({ ...stale, digest: digestOf("a"), bytes: 4 }),
    "Fenced",
  );
  assert.equal(
    await transcripts.record({
      ...stale,
      batch: 1,
      digest: digestOf("a"),
      bytes: 4,
      events: 1,
    }),
    "Fenced",
  );
  assert.deepEqual(await turns.record({ ...stale, turns: [] }), {
    recorded: "Fenced",
  });
  assert.equal(
    await totals.record({ ...stale, totals: runTotalsFixture(1) }),
    "Fenced",
  );
  const live = {
    secret: attempt.capability.secret,
    generation: attempt.generation,
  };
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal(
    await configurations.record({ ...live, digest: digestOf("a"), bytes: 4 }),
    "Fenced",
  );
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  assert.equal(
    await configurations.record({ ...live, digest: digestOf("a"), bytes: 4 }),
    "Fenced",
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT count(*)::text AS opened FROM execution_run
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [attempt.partition.tenant, attempt.partition.project, attempt.execution],
    ),
    [{ opened: "0" }],
  );
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
