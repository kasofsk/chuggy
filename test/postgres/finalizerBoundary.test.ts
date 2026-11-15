/**
 * The door the finalizer submits a conclusion to ticket-service-owned rows
 * through, driven as the role that will actually call it.
 *
 * A REFUSAL IS ASSERTED BY WHAT IT DID NOT WRITE. A call that returned a
 * refusal tag and left a journal entry, an operation or a decision input behind
 * has forged a conclusion just as surely as one that returned success, so every
 * refusal here reads the mailbox afterwards rather than trusting the tag.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { finalizationFunction } from "../../src/adapters/postgres/schema.ts";
import {
  finalizerBriefLandsNothing,
  finalizerClaim,
  finalizerCommit,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPromote,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** What one project's mailbox currently holds, which a refusal must leave alone. */
async function mailbox(
  project: FinalizerProject,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT
       (SELECT count(*) FROM journal_entry j WHERE j.tenant=$1 AND j.project=$2)::text AS entries,
       (SELECT count(*) FROM operation o WHERE o.tenant=$1 AND o.project=$2)::text AS operations,
       (SELECT count(*) FROM decision_input d WHERE d.tenant=$1 AND d.project=$2)::text AS inputs`,
    [project.partition.tenant, project.partition.project],
  );
  const held = rows[0];
  if (held === undefined) throw new Error("finalizer boundary: no mailbox");
  return held;
}

/** Calls the submission door as the finalizer and answers the tag it returned. */
async function submit(
  project: FinalizerProject,
  attempt: string | null,
  outcome: string,
  failureKind: string | null,
  generation = project.requestGeneration,
  epoch = project.epoch,
  request = project.request,
): Promise<string> {
  const rows = (await rig.as(
    `SELECT result FROM ${finalizationFunction}($1,$2,$3,$4,$5,$6,$7,$8,$9,'finalizer-subject')`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      attempt,
      outcome,
      failureKind,
      generation,
      epoch,
      finalizerIdentity("operation"),
    ],
  )) as readonly { result: string }[];
  return rows[0]?.result ?? "no row";
}

/** A project whose claimed request has one promoted, concluded attempt behind it. */
async function promoted(
  label: string,
): Promise<{ project: FinalizerProject; attempt: string }> {
  const project = await finalizerProject(rig, label);
  await finalizerClaim(rig, project, finalizerIdentity(`owner-${label}`));
  return { project, attempt: await finalizerPromote(rig, project, label) };
}

test("a succeeded result the durable rows support is submitted exactly once", async () => {
  const { project, attempt } = await promoted("submit-clean");
  const before = await mailbox(project);
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "Submitted",
  );
  const after = await mailbox(project);
  assert.equal(
    Number(after["operations"]) - Number(before["operations"]),
    1,
    "operations",
  );
  assert.equal(Number(after["inputs"]) - Number(before["inputs"]), 1, "inputs");
  assert.equal(after["entries"], before["entries"], "entries");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT o.authority_kind, o.admission, o.key_version, o.command_tag,
              d.base_priority
         FROM operation o JOIN decision_input d
           ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
        WHERE o.tenant=$1 AND o.project=$2 AND o.authority_kind='Finalizer'`,
      [project.partition.tenant, project.partition.project],
    ),
    [
      {
        authority_kind: "Finalizer",
        admission: "CorrectnessReducing",
        key_version: "finalizer-v1",
        command_tag: "ReportFinalizationResult",
        base_priority: "Completion",
      },
    ],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "AlreadySubmitted",
  );
  assert.deepEqual(await mailbox(project), after);
});

/**
 * A landing that lands nothing prepares nothing, so the evidence every other
 * success is read off — a prepared attempt, a spent permit, a promoted ref —
 * does not exist for one. The door admits the conclusion on the brief's own
 * mode and on nothing else: not before the brief says so, not for the failure
 * a landing reaches, and not with an attempt named.
 */
test("a request whose brief lands nothing concludes on no attempt at all", async () => {
  const project = await finalizerProject(rig, "submit-landless");
  await finalizerClaim(rig, project, finalizerIdentity("owner-landless"));
  const before = await mailbox(project);
  assert.equal(
    await submit(project, null, "FinalizationSucceeded", null),
    "BindingMismatch",
    "a brief that lands somewhere concludes on the attempt it landed",
  );
  assert.deepEqual(await mailbox(project), before);
  await finalizerBriefLandsNothing(rig, project.partition, project.ticket);
  assert.equal(
    await submit(project, null, "FinalizationNeedsWork", "MergeConflict"),
    "BindingMismatch",
    "a landing that lands nothing has no failure to report",
  );
  assert.deepEqual(await mailbox(project), before);
  assert.equal(
    await submit(project, null, "FinalizationSucceeded", null),
    "Submitted",
  );
});

test("a failed result is submitted only against the attempt and kind that failed", async () => {
  const project = await finalizerProject(rig, "submit-failed");
  await finalizerClaim(rig, project, finalizerIdentity("owner-submit-failed"));
  const attempt = await finalizerPrepare(rig, project, "submit-failed", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  const before = await mailbox(project);
  assert.equal(
    await submit(
      project,
      attempt,
      "FinalizationNeedsWork",
      "PreparationFailed",
    ),
    "BindingMismatch",
  );
  assert.deepEqual(await mailbox(project), before);
  assert.equal(
    await submit(project, attempt, "FinalizationNeedsWork", "MergeConflict"),
    "Submitted",
  );
});

test("every stale, mismatched or absent binding is refused and writes nothing", async () => {
  const { project, attempt } = await promoted("submit-refuse");
  const other = await promoted("submit-refuse-other");
  const before = await mailbox(project);
  const refusals: readonly (readonly [string, Promise<string>])[] = [
    [
      "UnknownRequest",
      submit(
        project,
        attempt,
        "FinalizationSucceeded",
        null,
        project.requestGeneration,
        project.epoch,
        "no-such-request",
      ),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationSucceeded", null, 99),
    ],
    [
      "BindingMismatch",
      submit(
        project,
        attempt,
        "FinalizationSucceeded",
        null,
        project.requestGeneration,
        "no-such-epoch",
      ),
    ],
    [
      "BindingMismatch",
      submit(project, other.attempt, "FinalizationSucceeded", null),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationNeedsWork", "MergeConflict"),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationSucceeded", "MergeConflict"),
    ],
  ];
  for (const [expected, running] of refusals) {
    assert.equal(await running, expected);
  }
  assert.deepEqual(await mailbox(project), before);
});

test("a succeeded result is refused until the permit is spent and the ref proved it", async () => {
  const project = await finalizerProject(rig, "submit-unproved");
  await finalizerClaim(rig, project, finalizerIdentity("owner-unproved"));
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "submit-unproved", {
    candidate,
  });
  const before = await mailbox(project);
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "no permit",
  );
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "submit-unproved",
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "permit still granted",
  );
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main','NotPromoted',$5)`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      candidate,
      finalizerCommit(),
    ],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "the ref did not prove it",
  );
  assert.deepEqual(await mailbox(project), before);
});

test("a settled or retained request is refused and writes nothing", async () => {
  const { project, attempt } = await promoted("submit-settled");
  const before = await mailbox(project);
  for (const state of ["Fulfilled", "Invalidated"]) {
    await rig.as(
      `UPDATE finalization_request SET state=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        state,
      ],
    );
    assert.equal(
      await submit(project, attempt, "FinalizationSucceeded", null),
      "BindingMismatch",
      state,
    );
  }
  await rig.as(
    `UPDATE finalization_request SET state='Registered'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  await rig.harness.query(
    `UPDATE project SET lifecycle='Retention' WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "NotAdmitted",
  );
  assert.deepEqual(await mailbox(project), before);
});

test("an outcome the model does not price is refused before anything is read", async () => {
  const { project, attempt } = await promoted("submit-outcome");
  const before = await mailbox(project);
  assert.match(
    await rig.refusal(
      `SELECT result FROM ${finalizationFunction}($1,$2,$3,$4,'Whatever',NULL,$5,$6,$7,'s')`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        attempt,
        project.requestGeneration,
        project.epoch,
        finalizerIdentity("operation"),
      ],
    ),
    /is not one this boundary submits/u,
  );
  assert.deepEqual(await mailbox(project), before);
});
