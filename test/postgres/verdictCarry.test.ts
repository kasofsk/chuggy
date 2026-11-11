/**
 * An `OnChange` evaluator's passing verdict carried to a later work cycle of
 * its ticket, against a real server: what the launch read decides, and what
 * settling on it leaves behind.
 *
 * THE WORK CYCLES ARE ROWS A CASE PLACES. A second work cycle over the same
 * diff is what a Serialized re-check spawns, and the scheduler reads only the
 * spawn requests it leaves, so each cycle here is a work request and an
 * evaluation request written beside the harness ticket's own, the evaluation's
 * bundle pinning the change identity its spawn observed. What runs for real is
 * the scheduler: registration, admission, the launch read under its lock, the
 * settlement and the door it submits through. A stack's landings are the rows
 * the finalizer leaves, written with the checks that tie them to other rows
 * switched off for that one transaction, because the tickets beneath are not
 * tickets of this project.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { resultManifestSchemaVersion } from "../../src/contract/workerDocuments.ts";
import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import {
  executionSchedulerDefaults,
  type AttemptOpening,
  type AttemptReport,
  type ExecutionId,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import { acceptResultManifest } from "../../src/interpreter/resultManifest.ts";
import { approvalMixedRelease } from "./approvalCatalog.ts";
import { postgresHarnessRepository } from "./harness.ts";
import {
  schedulerArtifact,
  schedulerClaimFor,
  schedulerDeclaredSource,
  schedulerDigest,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerRuntime,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

const worker = {
  mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
  setup: [],
  files: [],
};

/** A catalog whose one stage is a review and the tests, the review carried as `reevaluate` says. */
function catalogOf(
  review: {
    readonly prompt?: string;
    readonly reevaluate?: "OnChange" | "Always";
  } = {},
) {
  return canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: { runner: "Agent", prompt: { text: "Build it." }, worker },
      review: {
        runner: "Agent",
        prompt: { text: review.prompt ?? "Review the change." },
        worker,
        reevaluate: review.reevaluate ?? "OnChange",
      },
      tests: { runner: "Commands", commands: ["npm test"] },
    },
    plans: { checks: [{ name: "checks", evaluators: ["review", "tests"] }] },
    defaults: { work: "build", evaluation: "checks" },
  });
}

/** A case's project and the task numbers and effect positions it has spent. */
interface Carrying {
  readonly project: SchedulerProject;
  readonly label: string;
  task: number;
  position: number;
}

/** The ticket's evaluations of one work cycle, by evaluator. */
interface Evaluated {
  readonly review: ExecutionId;
  readonly tests: ExecutionId;
  readonly request: string;
}

async function carrying(
  label: string,
  reevaluate: "OnChange" | "Always" = "OnChange",
): Promise<Carrying> {
  const project = await schedulerProject(
    rig,
    `carry-${label}`,
    { tasks: 1 },
    catalogOf({ reevaluate }),
    undefined,
    undefined,
    approvalMixedRelease,
  );
  return { project, label, task: project.tasks, position: 0 };
}

function key(at: Carrying): readonly [string, string] {
  return [at.project.partition.tenant, at.project.partition.project];
}

/** A bundle of its own for a spawn request, the harness request's references copied and `changeIdentity` pinned where given. */
async function bundleOf(
  at: Carrying,
  changeIdentity: string | undefined,
): Promise<{ bundle: string; digest: string }> {
  const bundle = `bundle-${at.label}-${randomUUID()}`;
  const digest = createHash("sha256").update(bundle).digest("hex");
  await rig.harness.query(
    `INSERT INTO input_bundle (tenant,project,bundle,digest) VALUES ($1,$2,$3,$4)`,
    [...key(at), bundle, digest],
  );
  await rig.harness.query(
    `INSERT INTO input_bundle_reference
       (tenant,project,bundle,ordinal,reference_kind,reference_id,reference_digest)
     SELECT b.tenant,b.project,$4,b.ordinal,b.reference_kind,b.reference_id,b.reference_digest
       FROM input_bundle_reference b
       JOIN execution_request q
         ON q.tenant=b.tenant AND q.project=b.project AND q.input_bundle=b.bundle
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [...key(at), at.project.request, bundle],
  );
  if (changeIdentity !== undefined)
    await rig.harness.query(
      `INSERT INTO input_bundle_reference
         (tenant,project,bundle,ordinal,reference_kind,reference_id)
       SELECT $1,$2,$3,coalesce(max(ordinal),0)+1,'ChangeIdentity',$4
         FROM input_bundle_reference WHERE tenant=$1 AND project=$2 AND bundle=$3`,
      [...key(at), bundle, changeIdentity],
    );
  return { bundle, digest };
}

/** A configuration revision of the project holding `canonical`, which a later request may pin. */
async function revisionOf(
  at: Carrying,
  canonical: string,
): Promise<{ revision: string; digest: string }> {
  const revision = `revision-${at.label}-${randomUUID()}`;
  const digest = createHash("sha256").update(canonical).digest("hex");
  await rig.harness.query(
    `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ($1,$2,$3,$4,$5,'Test','verdict-carry')`,
    [...key(at), revision, canonical, digest],
  );
  return { revision, digest };
}

/** A spawn request on the ticket beside the harness one, declaring `tasks`. */
async function spawned(
  at: Carrying,
  kind: "SpawnWork" | "SpawnEvaluation",
  tasks: readonly {
    readonly task: number;
    readonly cycle: number;
    readonly evaluator?: number;
  }[],
  pins: {
    readonly changeIdentity?: string;
    readonly revision?: { revision: string; digest: string };
  } = {},
): Promise<string> {
  const request = `request-${at.label}-${randomUUID()}`;
  const { bundle, digest } = await bundleOf(at, pins.changeIdentity);
  at.position += 1;
  await rig.harness.query(
    `INSERT INTO execution_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        kind,capacity_account,configuration_revision,configuration_digest,
        input_bundle,input_bundle_digest)
     SELECT q.tenant,q.project,$4,q.authorizing_seq,q.effect_position+$5,q.ticket,
            q.ticket_version,$6,q.capacity_account,
            coalesce($9,q.configuration_revision),coalesce($10,q.configuration_digest),$7,$8
       FROM execution_request q
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [
      ...key(at),
      at.project.request,
      request,
      at.position,
      kind,
      bundle,
      digest,
      pins.revision?.revision ?? null,
      pins.revision?.digest ?? null,
    ],
  );
  for (const each of tasks) {
    const evaluation = each.evaluator !== undefined;
    await rig.harness.query(
      `INSERT INTO execution_request_task
         (tenant,project,request,task,kind,cycle,stage,generation,evaluator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
      [
        ...key(at),
        request,
        each.task,
        evaluation ? "Evaluation" : "Work",
        each.cycle,
        evaluation ? 1 : null,
        each.evaluator ?? null,
      ],
    );
  }
  return request;
}

async function registered(at: Carrying, request: string): Promise<void> {
  const outcome = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      at.project.partition,
      request,
      schedulerOwner(at.label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(outcome.registered, "Registered");
}

/** Admits every execution the cluster has queued, `count` of them. */
async function admitted(at: Carrying, count: number): Promise<void> {
  for (let each = 0; each < count; each += 1) {
    const admission = await rig.store.admit(at.project.cluster);
    assert.equal(admission.admitted, "Admitted");
  }
}

function openingOf(at: Carrying, execution: ExecutionId): AttemptOpening {
  return {
    partition: at.project.partition,
    execution,
    epoch: at.project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  };
}

/** A worker's report on `attempt`, sealed by the acceptance a real ingress applies. */
function reportOf(
  attempt: PhysicalAttempt,
  verdict: "Pass" | "Fail",
  report: string,
  work: boolean,
  handoffs: readonly ReturnType<typeof schedulerArtifact>[] = [],
): AttemptReport {
  const accepted = acceptResultManifest(
    {
      partition: attempt.partition,
      execution: attempt.execution,
      attempt: attempt.attempt,
    },
    attempt.capability.manifest,
    JSON.stringify({
      version: resultManifestSchemaVersion,
      verdict,
      report,
      handoffs,
      diagnostics: [],
      source: work ? schedulerDeclaredSource(attempt) : null,
    }),
    schedulerDigest,
  );
  if (accepted.accepted === "Rejected")
    throw new Error(`verdict carry: the fixture manifest was ${accepted.code}`);
  return { ...attempt, manifest: accepted.manifest };
}

/** Opens an attempt on `execution` and settles it as a worker would report it. */
async function settled(
  at: Carrying,
  execution: ExecutionId,
  verdict: "Pass" | "Fail",
  report: string,
  options: { work?: boolean; handoffs?: number } = {},
): Promise<void> {
  const opened = await rig.store.openAttempt(openingOf(at, execution));
  assert.ok(opened.opened === "Opened", `the attempt was ${opened.opened}`);
  const handoffs = Array.from({ length: options.handoffs ?? 0 }, (_, at) =>
    schedulerArtifact(`handoff/${String(at)}.md`),
  );
  const outcome = await rig.store.terminalize(
    reportOf(opened.attempt, verdict, report, options.work ?? false, handoffs),
  );
  assert.equal(outcome.terminalized, "Terminalized");
}

/** The execution registered for one task of a request. */
async function executionOf(
  at: Carrying,
  request: string,
  task: number,
): Promise<ExecutionId> {
  const [row] = await rig.harness.query(
    `SELECT execution FROM execution
      WHERE tenant=$1 AND project=$2 AND source_request=$3 AND task=$4`,
    [...key(at), request, task],
  );
  assert.ok(row !== undefined, `task ${String(task)} was not registered`);
  return String(row["execution"]) as ExecutionId;
}

/**
 * Passes one work cycle and registers and admits its evaluations, which pin
 * `changeIdentity` where one is given. Cycle 1's work is the harness ticket's
 * own request.
 */
async function cycle(
  at: Carrying,
  number: number,
  changeIdentity: string | undefined,
  revision?: { revision: string; digest: string },
): Promise<Evaluated> {
  let work = at.project.request;
  let workTask = 1;
  if (number > 1) {
    at.task += 1;
    workTask = at.task;
    work = await spawned(at, "SpawnWork", [{ task: workTask, cycle: number }]);
  }
  await registered(at, work);
  await admitted(at, 1);
  await settled(
    at,
    await executionOf(at, work, workTask),
    "Pass",
    `Built cycle ${String(number)}.`,
    { work: true },
  );
  const review = at.task + 1;
  const tests = at.task + 2;
  at.task = tests;
  const request = await spawned(
    at,
    "SpawnEvaluation",
    [
      { task: review, cycle: number, evaluator: 1 },
      { task: tests, cycle: number, evaluator: 2 },
    ],
    {
      ...(changeIdentity === undefined ? {} : { changeIdentity }),
      ...(revision === undefined ? {} : { revision }),
    },
  );
  await registered(at, request);
  await admitted(at, 2);
  return {
    review: await executionOf(at, request, review),
    tests: await executionOf(at, request, tests),
    request,
  };
}

/** Settles both of a cycle's evaluations, the review as `review` says. */
async function evaluated(
  at: Carrying,
  evaluations: Evaluated,
  review: {
    verdict?: "Pass" | "Fail";
    report?: string;
    handoffs?: number;
  } = {},
): Promise<void> {
  await settled(
    at,
    evaluations.review,
    review.verdict ?? "Pass",
    review.report ?? "APPROVE: the change does what the brief asks.",
    { handoffs: review.handoffs ?? 0 },
  );
  await settled(at, evaluations.tests, "Pass", "npm test passed.");
}

/** The workload digests two executions were registered under, which a case asserts recorded before reading a launch. */
async function digestsOf(
  at: Carrying,
  executions: readonly ExecutionId[],
): Promise<readonly unknown[]> {
  const rows = await rig.harness.query(
    `SELECT execution, workload_digest FROM execution
      WHERE tenant=$1 AND project=$2 AND execution = ANY($3::text[])`,
    [...key(at), executions],
  );
  return executions.map(
    (execution) =>
      rows.find((row) => row["execution"] === execution)?.["workload_digest"],
  );
}

/** Asserts both reviews recorded a digest and that they differ, so the launch reran on the workload alone. */
async function workloadChanged(
  at: Carrying,
  first: ExecutionId,
  later: ExecutionId,
): Promise<void> {
  const [earlier, current] = await digestsOf(at, [first, later]);
  assert.match(String(earlier), /^[0-9a-f]{64}$/u);
  assert.match(String(current), /^[0-9a-f]{64}$/u);
  assert.notEqual(earlier, current);
}

const change = "1".repeat(40);
const otherChange = "2".repeat(40);

/** A cycle-1 review settled as `review` says, and the cycle-2 review's launch answer. */
async function launchedAfter(
  label: string,
  review: Parameters<typeof evaluated>[2] = {},
  second: string | undefined = change,
): Promise<{
  at: Carrying;
  first: Evaluated;
  later: Evaluated;
  opened: Awaited<ReturnType<SchedulerRig["store"]["openAttempt"]>>;
}> {
  const at = await carrying(label);
  const first = await cycle(at, 1, change);
  await evaluated(at, first, review);
  const later = await cycle(at, 2, second);
  return {
    at,
    first,
    later,
    opened: await rig.store.openAttempt(openingOf(at, later.review)),
  };
}

test("a re-check over the same diff carries the review and runs the commands again", async () => {
  const report =
    "APPROVE: every criterion holds, and the importer test covers it.";
  const { at, first, later, opened } = await launchedAfter("same", { report });
  assert.deepEqual(opened, { opened: "Carried", source: first.review });
  const carried = await rig.store.carryVerdict(
    openingOf(at, later.review),
    first.review,
  );
  assert.equal(carried.terminalized, "Terminalized");
  assert.ok(carried.terminalized === "Terminalized");
  assert.equal(carried.outcome, "Passed");

  const tests = await rig.store.openAttempt(openingOf(at, later.tests));
  assert.equal(tests.opened, "Opened", "the commands run again");

  const [row] = await rig.harness.query(
    `SELECT e.status, e.outcome, e.completion_operation, p.report, r.verdict,
            c.source_execution, a.state AS attempt_state, a.pool, a.lease_owner,
            a.capability_secret_digest, a.ended_at IS NOT NULL AS ended,
            (SELECT count(*)::int FROM execution_result_artifact x
              WHERE x.tenant=e.tenant AND x.project=e.project
                AND x.manifest=e.result_manifest) AS artifacts
       FROM execution e
       JOIN execution_result r
         ON r.tenant=e.tenant AND r.project=e.project AND r.manifest=e.result_manifest
       JOIN execution_attempt a
         ON a.tenant=r.tenant AND a.project=r.project AND a.attempt=r.attempt
       LEFT JOIN execution_result_report p
         ON p.tenant=e.tenant AND p.project=e.project AND p.manifest=e.result_manifest
       JOIN execution_verdict_carry c
         ON c.tenant=e.tenant AND c.project=e.project AND c.execution=e.execution
      WHERE e.tenant=$1 AND e.project=$2 AND e.execution=$3`,
    [...key(at), later.review],
  );
  assert.deepEqual(row, {
    status: "Terminal",
    outcome: "Passed",
    completion_operation: carried.operation,
    report,
    verdict: "Pass",
    source_execution: first.review,
    attempt_state: "Carried",
    pool: null,
    lease_owner: null,
    capability_secret_digest: null,
    ended: true,
    artifacts: 0,
  });
});

test("a carried evaluation releases its slot, fulfils its request and leaves no attempt for any sweep", async () => {
  const { at, first, later, opened } = await launchedAfter("released");
  assert.equal(opened.opened, "Carried");
  await rig.store.carryVerdict(openingOf(at, later.review), first.review);
  assert.deepEqual(
    await rig.store.carryVerdict(openingOf(at, later.review), first.review),
    {
      terminalized: "AlreadyTerminal",
      outcome: "Passed",
      operation: (await rig.store.execution(at.project.partition, later.review))
        ?.completionOperation,
    },
    "a second carry finds it settled",
  );
  await settled(at, later.tests, "Pass", "npm test passed.");

  const [request] = await rig.harness.query(
    `SELECT state FROM execution_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [...key(at), later.request],
  );
  assert.equal(request?.["state"], "Fulfilled");
  const [slots] = await rig.harness.query(
    `SELECT count(*)::int AS held FROM execution
      WHERE tenant=$1 AND project=$2 AND status IN ('Admitted','Launching','Running')`,
    key(at),
  );
  assert.equal(slots?.["held"], 0, "no execution of the ticket holds a slot");

  const [carriedAttempt] = await rig.harness.query(
    `SELECT attempt FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...key(at), later.review],
  );
  const attempt = String(carriedAttempt?.["attempt"]);
  const epoch = at.project.epoch;
  const sweepsMax = 4096;
  const named = (
    rows: readonly {
      readonly attempt?: unknown;
      readonly execution?: unknown;
    }[],
  ) =>
    rows.some(
      (each) => each.attempt === attempt || each.execution === later.review,
    );
  assert.equal(named(await rig.store.unlaunched(epoch, sweepsMax)), false);
  assert.equal(named(await rig.store.waitingAttempts(epoch, sweepsMax)), false);
  assert.equal(named(await rig.store.refusedAttempts(epoch, sweepsMax)), false);
  assert.equal(
    named(await rig.store.attemptsAwaitingObservation(epoch, sweepsMax)),
    false,
  );
  assert.equal(
    named(await rig.store.attemptsAwaitingCleanup(sweepsMax)),
    false,
  );
});

test("a changed diff runs the review and the commands again", async () => {
  const { at, later, opened } = await launchedAfter("diff", {}, otherChange);
  assert.equal(opened.opened, "Opened");
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.tests))).opened,
    "Opened",
  );
});

test("a bundle that pins no change identity launches as it always did", async () => {
  const at = await carrying("unidentified");
  const first = await cycle(at, 1, undefined);
  await evaluated(at, first);
  const later = await cycle(at, 2, undefined);
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});

test("a changed prompt runs the review again", async () => {
  const at = await carrying("prompt");
  const first = await cycle(at, 1, change);
  await evaluated(at, first);
  const later = await cycle(
    at,
    2,
    change,
    await revisionOf(
      at,
      catalogOf({ prompt: "Review the change for safety." }),
    ),
  );
  await workloadChanged(at, first.review, later.review);
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});

test("a changed override runs the review again", async () => {
  const at = await carrying("override");
  const first = await cycle(at, 1, change);
  await evaluated(at, first);
  await rig.harness.query(
    `UPDATE ticket_definition SET overrides=$4::jsonb
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [
      ...key(at),
      at.project.ticket,
      JSON.stringify({
        workloads: { review: { prompt: { text: "Review it twice." } } },
      }),
    ],
  );
  const later = await cycle(at, 2, change);
  await workloadChanged(at, first.review, later.review);
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});

test("an Always workload is never carried", async () => {
  const at = await carrying("always", "Always");
  const first = await cycle(at, 1, change);
  await evaluated(at, first);
  const later = await cycle(at, 2, change);
  const [earlier, current] = await digestsOf(at, [first.review, later.review]);
  assert.match(String(earlier), /^[0-9a-f]{64}$/u);
  assert.equal(current, earlier, "the workload is the same, and is Always");
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});

test("a failed review is not carried", async () => {
  const { opened } = await launchedAfter("failed", { verdict: "Fail" });
  assert.equal(opened.opened, "Opened");
});

test("a review that passed with handoffs is not carried", async () => {
  const { opened } = await launchedAfter("handoffs", { handoffs: 1 });
  assert.equal(opened.opened, "Opened");
});

const landingTarget = "refs/heads/main";

/** Records the stack cycle 1 was evaluated over, one ticket beneath it accepted at `beneath`. */
async function stackedFirst(
  at: Carrying,
  tip: string,
  beneath: { ticket: number; commit: string },
): Promise<void> {
  const repository = postgresHarnessRepository(at.project.partition);
  await rig.harness.query(
    `INSERT INTO evaluation_stack
       (tenant,project,ticket,work_cycle,repository,target_ref,tip,stack_commit,stack_tree)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$7)`,
    [
      ...key(at),
      at.project.ticket,
      repository,
      landingTarget,
      tip,
      "9".repeat(40),
    ],
  );
  await rig.harness.query(
    `INSERT INTO evaluation_stack_beneath
       (tenant,project,ticket,work_cycle,depth,beneath_ticket,beneath_commit)
     VALUES ($1,$2,$3,1,1,$4,$5)`,
    [...key(at), at.project.ticket, beneath.ticket, beneath.commit],
  );
}

/** The rows a promoted landing of `ticket` onto `onto` leaves, accepted at `accepted`. */
async function landed(
  at: Carrying,
  landing: {
    ticket: number;
    onto: string;
    accepted: string;
    candidate: string;
  },
): Promise<void> {
  const attempt = `attempt-landing-${randomUUID()}`;
  const bundle = `bundle-landing-${randomUUID()}`;
  const manifest = `manifest-landing-${randomUUID()}`;
  const permit = `permit-landing-${randomUUID()}`;
  const repository = postgresHarnessRepository(at.project.partition);
  const transaction = await rig.harness.begin();
  try {
    await transaction.query(`SET LOCAL session_replication_role = replica`);
    await transaction.query(
      `INSERT INTO finalization_attempt
         (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
          target_ref,target_commit,strategy,configuration_revision,configuration_digest,
          approval_required,outcome,candidate_commit,attempt_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,repeat('2',64),$8,$9,'Merge','revision','digest',
               false,'Prepared',$10,repeat('3',64))`,
      [
        ...key(at),
        attempt,
        `request-landing-${randomUUID()}`,
        landing.ticket,
        repository,
        bundle,
        landingTarget,
        landing.onto,
        landing.candidate,
      ],
    );
    await transaction.query(
      `INSERT INTO input_bundle_reference
         (tenant,project,bundle,ordinal,reference_kind,reference_id)
       VALUES ($1,$2,$3,1,'ResultManifest',$4)`,
      [...key(at), bundle, manifest],
    );
    await transaction.query(
      `INSERT INTO execution_result_source
         (tenant,project,manifest,repository,ref,commit,base,expected_base)
       VALUES ($1,$2,$3,$4,'refs/heads/work',$5,$6,$6)`,
      [...key(at), manifest, repository, landing.accepted, landing.onto],
    );
    await transaction.query(
      `INSERT INTO commit_permit
         (tenant,project,permit,attempt,recovery_epoch,lifecycle_generation,state,concluded_at)
       VALUES ($1,$2,$3,$4,$5,1,'Concluded',now())`,
      [...key(at), permit, attempt, at.project.epoch],
    );
    await transaction.query(
      `INSERT INTO finalization_reconciliation
         (tenant,project,permit,candidate_commit,target_ref,verdict,observed_commit)
       VALUES ($1,$2,$3,$4,$5,'Promoted',$4)`,
      [...key(at), permit, landing.candidate, landingTarget],
    );
    await transaction.commit();
  } catch (failure) {
    await transaction.rollback();
    throw failure;
  }
}

test("a review earned over a stack whose ticket beneath was ejected is not carried", async () => {
  const at = await carrying("ejected");
  const first = await cycle(at, 1, change);
  await stackedFirst(at, "a".repeat(40), {
    ticket: at.project.ticket + 100,
    commit: "b".repeat(40),
  });
  await evaluated(at, first);
  const later = await cycle(at, 2, change);
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});

test("a review earned over a stack whose tickets beneath all landed is carried", async () => {
  const at = await carrying("landed");
  const first = await cycle(at, 1, change);
  const tip = "a".repeat(40);
  const beneath = { ticket: at.project.ticket + 100, commit: "b".repeat(40) };
  await stackedFirst(at, tip, beneath);
  await landed(at, {
    ticket: beneath.ticket,
    onto: tip,
    accepted: beneath.commit,
    candidate: "c".repeat(40),
  });
  await evaluated(at, first);
  const later = await cycle(at, 2, change);
  assert.deepEqual(await rig.store.openAttempt(openingOf(at, later.review)), {
    opened: "Carried",
    source: first.review,
  });
});

test("a review earned over a stack whose ticket beneath landed at another commit is not carried", async () => {
  const at = await carrying("moved");
  const first = await cycle(at, 1, change);
  const tip = "a".repeat(40);
  const beneath = { ticket: at.project.ticket + 100, commit: "b".repeat(40) };
  await stackedFirst(at, tip, beneath);
  await landed(at, {
    ticket: beneath.ticket,
    onto: tip,
    accepted: "d".repeat(40),
    candidate: "c".repeat(40),
  });
  await evaluated(at, first);
  const later = await cycle(at, 2, change);
  assert.equal(
    (await rig.store.openAttempt(openingOf(at, later.review))).opened,
    "Opened",
  );
});
