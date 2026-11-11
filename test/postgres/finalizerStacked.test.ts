/**
 * A Stacked ticket's landing against a real PostgreSQL and a real repository:
 * the stack its evaluation ran over is read from the store, the accepted
 * commit is merged with the target as it stands, and the landing is prepared
 * only where that merge is the tree the stack was.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { recordStackBeneathNobody } from "./evaluationStackLandings.ts";
import { postgresHarnessResume } from "./harness.ts";
import {
  finalizerBriefLanding,
  finalizerClaim,
  finalizerDeclareSource,
  finalizerDrain,
  finalizerGitVerb,
  finalizerPassOnce,
  finalizerPhase,
  finalizerRemoteAttempt,
  finalizerRemoteCommit,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerSubject,
  type FinalizerProject,
  type FinalizerRemote,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;

before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** A Stacked ticket whose worker published one commit, with the reference moved once by the ticket beneath it. */
async function stackedAfterBeneath(label: string): Promise<{
  project: FinalizerProject;
  remote: FinalizerRemote;
  worked: string;
}> {
  const { project, remote, work } = await finalizerSubject(rig, label, []);
  const base = finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main");
  const ref = `refs/heads/chuggy/tickets/${String(project.ticket)}/attempts/one`;
  const worked = finalizerRemoteAttempt(remote, "top.txt", "top\n", ref);
  await finalizerDeclareSource(rig, project, work, ref, worked, base);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Stacked",
    project.repository,
  );
  finalizerRemoteCommit(remote, "below.txt", "below\n", "below");
  return { project, remote, worked };
}

/** The tree a clean merge of the reference as it stands with the worker's commit has. */
function mergedTree(remote: FinalizerRemote, worked: string): string {
  return finalizerGitVerb(
    remote.origin,
    "merge-tree",
    "--write-tree",
    "refs/heads/main",
    worked,
  );
}

async function stackRecorded(
  project: FinalizerProject,
  stackTree: string,
): Promise<void> {
  await recordStackBeneathNobody(rig.pool, project, stackTree);
}

async function attemptsOf(project: FinalizerProject) {
  return rig.as(
    `SELECT outcome, failure_kind, candidate_commit, recheck_commit,
            recheck_reason, recheck_base_ref
       FROM finalization_attempt WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
}

test("landsWhenTreeEqual: a stack whose tree is the merge result is prepared as that merge", async () => {
  const { project, remote, worked } =
    await stackedAfterBeneath("stacked-equal");
  await stackRecorded(project, mergedTree(remote, worked));

  await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "stacked-equal",
  );

  const [attempt] = await attemptsOf(project);
  assert.equal(attempt?.["outcome"], "Prepared");
  assert.equal(attempt?.["failure_kind"], null);
  assert.notEqual(attempt?.["candidate_commit"], worked);
  assert.equal(typeof attempt?.["candidate_commit"], "string");
});

test("directLandingInvalidatesAStack: a landing after the stack was minted gives another tree, so the ticket is sent back to re-check its accepted commit", async () => {
  const { project, remote, worked } =
    await stackedAfterBeneath("stacked-moved");
  await stackRecorded(project, mergedTree(remote, worked));
  finalizerRemoteCommit(remote, "direct.txt", "direct\n", "direct");

  await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "stacked-moved",
  );

  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.["outcome"], "Failed");
  assert.equal(attempts[0]?.["failure_kind"], "RecheckRequired");
  assert.equal(attempts[0]?.["recheck_commit"], worked);
  assert.equal(attempts[0]?.["recheck_reason"], "StackTreeDiffers");
  assert.equal(attempts[0]?.["recheck_base_ref"], null);
  assert.equal(attempts[0]?.["candidate_commit"], null);
});

test("a stacked ticket evaluated over no stack lands as a serialized one does, sent back where the reference moved past its commit", async () => {
  const { project, worked } = await stackedAfterBeneath("stacked-unstacked");

  await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "stacked-unstacked",
  );

  const [attempt] = await attemptsOf(project);
  assert.equal(attempt?.["failure_kind"], "RecheckRequired");
  assert.equal(attempt?.["recheck_commit"], worked);
  assert.equal(attempt?.["recheck_reason"], "TargetMoved");
  assert.equal(attempt?.["recheck_base_ref"], null);
});

/**
 * Stands for the work cycle that re-reports after a send-back: the request
 * that was sent back is invalidated and a later one of the same ticket opens.
 */
async function requestSuperseded(
  project: FinalizerProject,
  pass: number,
): Promise<void> {
  const key = [project.partition.tenant, project.partition.project];
  await rig.harness.query(
    `UPDATE finalization_request SET state='Invalidated'
      WHERE tenant=$1 AND project=$2 AND state IN ('Open','Registered')`,
    key,
  );
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind, work_cycle,
        finalization_generation)
     SELECT tenant, project, request || ':' || $4::text, authorizing_seq,
            effect_position + $3::int, ticket, ticket_version,
            request_generation, kind, work_cycle,
            finalization_generation + $3::int
       FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND request=$5`,
    [...key, pass, String(pass), project.request],
  );
}

/** Passes the project's request `times` over, moving the reference before each so the commit evaluated is behind it. */
async function passesBehindTheTarget(
  project: FinalizerProject,
  remote: FinalizerRemote,
  times: number,
  label: string,
): Promise<readonly number[]> {
  const holds: number[] = [];
  for (let pass = 0; pass < times; pass++) {
    if (pass > 0) await requestSuperseded(project, pass);
    finalizerRemoteCommit(remote, `move-${String(pass)}.txt`, "m\n", "move");
    const report = await finalizerPassOnce(
      rig,
      project,
      finalizerRemotePort(rig),
      `${label}-${String(pass)}`,
    );
    holds.push(report.holds);
  }
  return holds;
}

test("a ticket sent back three times is never held, whether a stack stopped standing or the target moved", async () => {
  for (const label of ["recheck-stacked", "recheck-plain"]) {
    const sent = await stackedAfterBeneath(label);
    if (label === "recheck-stacked")
      await stackRecorded(sent.project, mergedTree(sent.remote, sent.worked));
    const holds = await passesBehindTheTarget(
      sent.project,
      sent.remote,
      3,
      label,
    );
    assert.deepEqual(holds, [0, 0, 0], label);
    const attempts = await attemptsOf(sent.project);
    assert.equal(attempts.length, 3, label);
    assert.ok(
      attempts.every((a) => a["failure_kind"] === "RecheckRequired"),
      label,
    );
  }
});

/**
 * A ticket escalated at `RecheckReworksExhausted`, which a pass once held at
 * and none holds at now, goes on to its re-check when resumed.
 */
test("a ticket escalated with its re-checks exhausted is sent back to re-check once resumed, and not held again", async () => {
  const { project, worked } = await stackedAfterBeneath("recheck-resumed");
  const store = postgresFinalizer(rig.pool);
  const claim = await finalizerClaim(rig, project, "owner-recheck-escalated");
  await store.recordHold({ claim, kind: "RecheckReworksExhausted" });
  const submitted = await store.submitResult({
    claim,
    conclusion: {
      outcome: "FinalizationResultUnavailable",
      kind: "RecheckReworksExhausted",
    },
  });
  assert.equal(submitted.submitted, "Submitted");
  let { memory } = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.equal(await finalizerPhase(rig, project.partition), "Escalated");
  assert.equal(
    await postgresHarnessResume(
      rig.harness,
      project.partition,
      project.ticket,
      "recheck-resumed",
    ),
    "Accepted",
  );
  ({ memory } = await finalizerDrain(rig.harness, project.partition, memory));
  assert.equal(await finalizerPhase(rig, project.partition), "Finalization");

  const report = await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "recheck-resumed",
  );

  assert.equal(report.holds, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.["failure_kind"], "RecheckRequired");
  assert.equal(attempts[0]?.["recheck_commit"], worked);
  await finalizerDrain(rig.harness, project.partition, memory);
});
