/**
 * A Stacked ticket's landing against a real PostgreSQL and a real repository:
 * the stack its evaluation ran over is read from the store, the accepted
 * commit is merged with the target as it stands, and the landing is prepared
 * only where that merge is the tree the stack was.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { recordStackBeneathNobody } from "./evaluationStackLandings.ts";
import {
  finalizerBriefLanding,
  finalizerDeclareSource,
  finalizerGitVerb,
  finalizerPassOnce,
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
    `SELECT outcome, failure_kind, candidate_commit, recheck_commit
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
});
