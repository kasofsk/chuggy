/**
 * A task whose bundle pinned the tree it was to be evaluated at settles only on
 * a report naming that tree, through either door a report arrives at. Any other
 * report is the runner not having run the work: the execution is blocked with
 * the reason that says so, and the manifest it sent is retained nowhere. A task
 * whose bundle pinned no tree is settled as it always was.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";

import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerReportStore } from "../../src/adapters/postgres/workerPlane.ts";
import type { AttemptReport } from "../../src/interpreter/executionScheduler.ts";
import {
  acceptResultManifest,
  type CanonicalManifest,
} from "../../src/interpreter/resultManifest.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerDeclaredSource,
  schedulerInCluster,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const workerPool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await workerPool.end();
  await rig.close();
});

const expected = "e".repeat(40);

/** A task placed on its attempt, its bundle pinning `tree` as the tree to evaluate where one is named. */
async function placed(label: string, tree: string | undefined) {
  const project = await schedulerProject(rig, label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
  if (tree !== undefined)
    await rig.harness.query(
      `INSERT INTO input_bundle_reference
         (tenant,project,bundle,ordinal,reference_kind,reference_id)
       SELECT q.tenant,q.project,q.input_bundle,
              (SELECT coalesce(max(b.ordinal),0)+1 FROM input_bundle_reference b
                WHERE b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle),
              'ExpectedTree',$4
         FROM execution_request q
        WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        tree,
      ],
    );
  return (await schedulerPlacedAttempt(rig, project, label)).attempt;
}

/** A report sealed by the acceptance a real ingress applies, naming `evaluatedTree` where one is given. */
function reporting(
  attempt: Awaited<ReturnType<typeof placed>>,
  evaluatedTree: string | undefined,
): AttemptReport {
  const accepted = acceptResultManifest(
    {
      partition: attempt.partition,
      execution: attempt.execution,
      attempt: attempt.attempt,
    },
    attempt.capability.manifest,
    JSON.stringify({
      version: 3,
      verdict: "Pass",
      report: "the review the evaluator wrote",
      handoffs: [],
      diagnostics: [],
      source: schedulerDeclaredSource(attempt),
      ...(evaluatedTree === undefined ? {} : { evaluatedTree }),
    }),
    (canonical: CanonicalManifest) =>
      createHash("sha256").update(canonical).digest("hex"),
  );
  if (accepted.accepted === "Rejected")
    throw new Error(`expected tree: the fixture manifest was ${accepted.code}`);
  return { ...attempt, manifest: accepted.manifest };
}

/** The doors a report arrives at, each given the report to settle. */
const doors = [
  [
    "the scheduler's own store",
    (attempt: Awaited<ReturnType<typeof placed>>, report: AttemptReport) =>
      rig.store.terminalize(report).then((settled) => ({ settled, attempt })),
  ],
  [
    "the worker plane's door",
    (attempt: Awaited<ReturnType<typeof placed>>, report: AttemptReport) =>
      postgresWorkerReportStore(workerPool, attempt.capability.secret)
        .terminalize(report)
        .then((settled) => ({ settled, attempt })),
  ],
] as const;

/** What the execution and its retained manifests say after a report. */
async function settledAs(attempt: Awaited<ReturnType<typeof placed>>) {
  const [execution] = await rig.harness.query(
    `SELECT status,outcome,blocked_reason FROM execution
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.execution],
  );
  const kept = await rig.harness.query(
    `SELECT 1 FROM execution_result
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.execution],
  );
  return {
    status: execution?.["status"],
    outcome: execution?.["outcome"],
    blocked_reason: execution?.["blocked_reason"],
    retained: kept.length,
  };
}

for (const [door, settle] of doors) {
  test(`${door} settles a verdict for the tree it was to evaluate`, async () => {
    const attempt = await placed("tree-match", expected);
    const { settled } = await settle(attempt, reporting(attempt, expected));
    assert.equal(settled.terminalized, "Terminalized");
    assert.deepEqual(await settledAs(attempt), {
      status: "Terminal",
      outcome: "Passed",
      blocked_reason: null,
      retained: 1,
    });
  });

  test(`${door} blocks a report naming another tree, and retains no manifest`, async () => {
    const attempt = await placed("tree-other", expected);
    const { settled } = await settle(
      attempt,
      reporting(attempt, "f".repeat(40)),
    );
    assert.equal(settled.terminalized, "Terminalized");
    assert.equal(
      settled.terminalized === "Terminalized" && settled.outcome,
      "Blocked",
    );
    assert.deepEqual(await settledAs(attempt), {
      status: "Terminal",
      outcome: "Blocked",
      blocked_reason: "EvaluatedTreeNotExpected",
      retained: 0,
    });
  });

  test(`${door} blocks a report naming no tree`, async () => {
    const attempt = await placed("tree-missing", expected);
    const { settled } = await settle(attempt, reporting(attempt, undefined));
    assert.equal(
      settled.terminalized === "Terminalized" && settled.outcome,
      "Blocked",
    );
    assert.deepEqual(await settledAs(attempt), {
      status: "Terminal",
      outcome: "Blocked",
      blocked_reason: "EvaluatedTreeNotExpected",
      retained: 0,
    });
  });

  test(`${door} holds a task whose bundle pinned no tree to none`, async () => {
    for (const named of [undefined, "f".repeat(40)]) {
      const attempt = await placed("tree-unpinned", undefined);
      const { settled } = await settle(attempt, reporting(attempt, named));
      assert.equal(
        settled.terminalized === "Terminalized" && settled.outcome,
        "Passed",
      );
      assert.equal((await settledAs(attempt)).blocked_reason, null);
    }
  });
}

test("a report a fenced attempt sends is not a block, whatever tree it names", async () => {
  const attempt = await placed("tree-fenced", expected);
  const first = await postgresWorkerReportStore(
    workerPool,
    attempt.capability.secret,
  ).terminalize(reporting(attempt, expected));
  assert.equal(first.terminalized, "Terminalized");
  const again = await postgresWorkerReportStore(
    workerPool,
    attempt.capability.secret,
  ).terminalize(reporting(attempt, "f".repeat(40)));
  assert.notEqual(
    again.terminalized === "Terminalized" && again.outcome,
    "Blocked",
  );
  assert.equal((await settledAs(attempt)).outcome, "Passed");
});
