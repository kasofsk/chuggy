/**
 * The pull request a ticket's newest successful landing opened, as the API
 * reads it from a real server to merge it.
 *
 * EACH LANDING IS BUILT AS THE FINALIZER RECORDS IT, as the landings suite
 * builds one: a permit promoted, a proposal row written as the finalizer
 * writes it, and the request concluded through the finalizer's own door.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresTicketProposedLandings } from "../../src/adapters/postgres/ticketProposedLanding.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  schedulerRole,
  ticketProposedLandingReadFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asFinalizationAttemptId,
  type FinalizationConclusion,
} from "../../src/interpreter/finalizer.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import type { TicketProposedLanding } from "../../src/interpreter/ticketProposalMerge.ts";
import {
  finalizerBriefBranch,
  finalizerBriefFinalizationTarget,
  finalizerClaim,
  finalizerCommit,
  finalizerDigest,
  finalizerDrain,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerPromote,
  finalizerReworked,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";

let rig: FinalizerRig;
let apiPool: pg.Pool;
before(async () => {
  rig = await finalizerRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await apiPool.end();
  await rig.close();
});

const headRef = "refs/heads/chuggy/ticket";
const pullRequest = "https://github.com/acme/atlas/pull/9";
const succeeded: FinalizationConclusion = { outcome: "FinalizationSucceeded" };
const needsWork: FinalizationConclusion = {
  outcome: "FinalizationNeedsWork",
  kind: "MergeConflict",
};

function proposedOf(
  project: Pick<FinalizerProject, "partition" | "ticket">,
): Promise<TicketProposedLanding | undefined> {
  return postgresTicketProposedLandings(apiPool).proposed(
    project.partition,
    asTicketId(project.ticket),
  );
}

/** One project at finalization landing by pull request, in a partition of its own. */
async function finalizing(label: string): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
  await finalizerBriefFinalizationTarget(
    rig,
    project.partition,
    project.ticket,
    "refs/heads/main",
    "PullRequest",
  );
  await finalizerBriefBranch(rig, project.partition, project.ticket, headRef);
  return project;
}

/** A permit promoted for the project's request: the attempt that spent it, and what that attempt built. */
async function promotion(
  project: FinalizerProject,
  label: string,
): Promise<{ attempt: string; permit: string; candidate: string }> {
  const attempt = await finalizerPromote(rig, project, label);
  const [row] = await rig.harness.query(
    `SELECT p.permit, a.candidate_commit FROM finalization_attempt a
       JOIN commit_permit p
         ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  );
  return {
    attempt,
    permit: String(row?.["permit"]),
    candidate: String(row?.["candidate_commit"]),
  };
}

/** The evidence a forge's answer is stored as, its identity numbered unless `number` is null. */
function evidence(candidate: string, number: number | null = 9): string {
  return JSON.stringify({
    identity: {
      forge: "github",
      remote: "PR_x",
      ...(number === null ? {} : { number }),
    },
    repository: "repository",
    marker: "chuggy-handoff:x",
    head: { ref: headRef, commit: candidate },
    base: { ref: "refs/heads/main", commit: finalizerCommit() },
    title: "ticket: land it",
    body: "land it",
    status: "Open",
    url: pullRequest,
  });
}

/** The proposal row a promoted permit leaves, then `assignments` with `$4` its one value. */
async function proposalOver(
  project: FinalizerProject,
  promoted: { permit: string; candidate: string },
  assignments?: string,
  value?: string,
): Promise<string> {
  const key = [
    project.partition.tenant,
    project.partition.project,
    project.request,
  ];
  const request = finalizerDigest();
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'refs/heads/main',$8,'ticket: land it','land it',1)`,
    [
      ...key,
      promoted.permit,
      request,
      headRef,
      promoted.candidate,
      finalizerCommit(),
    ],
  );
  if (assignments !== undefined)
    await rig.as(
      `UPDATE finalization_change_proposal SET ${assignments}
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [...key, value],
    );
  return request;
}

const created = "creation='Created', creation_evidence=$4::jsonb";

/** Concludes the project's request through the finalizer's door and decides it. */
async function concluded(
  project: FinalizerProject,
  conclusion: FinalizationConclusion,
  attempt: string,
): Promise<ProjectMemory> {
  const claim = await finalizerClaim(rig, project, finalizerIdentity("owner"));
  const submitted = await postgresFinalizer(rig.pool).submitResult({
    claim,
    attempt: asFinalizationAttemptId(attempt),
    conclusion,
  });
  assert.equal(submitted.submitted, "Submitted");
  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  return drained.memory;
}

test("a success that opened a numbered pull request answers it, at the head it evaluated and the base it was opened into", async () => {
  const project = await finalizing("proposed-landing");
  const promoted = await promotion(project, "proposed-landing");
  const request = await proposalOver(
    project,
    promoted,
    created,
    evidence(promoted.candidate),
  );
  await concluded(project, succeeded, promoted.attempt);
  const [row] = await rig.harness.query(
    `SELECT repository FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, promoted.attempt],
  );
  assert.deepEqual(await proposedOf(project), {
    repository: row?.["repository"],
    request,
    head: { ref: headRef, commit: promoted.candidate },
    baseRef: "refs/heads/main",
    proposal: { forge: "github", remote: "PR_x", number: 9 },
    url: pullRequest,
  });
});

test("a pull request a reading accepted is answered as one a create proved", async () => {
  const project = await finalizing("proposed-read-back");
  const promoted = await promotion(project, "proposed-read-back");
  await proposalOver(
    project,
    promoted,
    "reconciliation='Accepted', reconciliation_evidence=$4::jsonb, reconciliations=1",
    evidence(promoted.candidate),
  );
  await concluded(project, succeeded, promoted.attempt);
  assert.equal((await proposedOf(project))?.proposal.number, 9);
});

test("a success whose proposal holds no number, a ticket with no landing and one the project does not have answer nothing", async () => {
  const unnumbered = await finalizing("proposed-unnumbered");
  const promoted = await promotion(unnumbered, "proposed-unnumbered");
  await proposalOver(
    unnumbered,
    promoted,
    created,
    evidence(promoted.candidate, null),
  );
  await concluded(unnumbered, succeeded, promoted.attempt);
  assert.equal(await proposedOf(unnumbered), undefined);
  const open = await finalizing("proposed-open");
  assert.equal(await proposedOf(open), undefined);
  assert.equal(
    await proposedOf({ ...open, ticket: open.ticket + 100 }),
    undefined,
  );
});

test("a request that concluded needing work is no success, and the newest success's pull request is the one answered", async () => {
  const first = await finalizing("proposed-twice");
  const firstPromoted = await promotion(first, "proposed-twice-first");
  await proposalOver(
    first,
    firstPromoted,
    created,
    evidence(firstPromoted.candidate, 8),
  );
  const failed = await finalizerPrepare(rig, first, "proposed-twice-failed", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  const memory = await concluded(first, needsWork, failed);
  assert.equal(await proposedOf(first), undefined);
  const second = await finalizerReworked(rig, first, memory, "proposed-twice");
  const secondPromoted = await promotion(second, "proposed-twice-second");
  await proposalOver(
    second,
    secondPromoted,
    created,
    evidence(secondPromoted.candidate, 9),
  );
  await concluded(second, succeeded, secondPromoted.attempt);
  const answered = await proposedOf(second);
  assert.equal(answered?.proposal.number, 9);
  assert.equal(answered?.head.commit, secondPromoted.candidate);
});

const bystanders = [
  ticketServiceRole,
  schedulerRole,
  configurationImporterRole,
  workerPlaneRole,
  finalizerRole,
];

test("the pull request is read through a door only the API may call, which runs as the boundary owner under a path of its own", async () => {
  const call = `SELECT * FROM ${ticketProposedLandingReadFunction}('tenant','project',1)`;
  assert.equal(await rig.harness.attemptAs(apiRole, call), undefined);
  for (const role of bystanders)
    assert.match(
      (await rig.harness.attemptAs(role, call)) ?? "",
      postgresHarnessDenial(ticketProposedLandingReadFunction),
      role,
    );
  const [door] = await rig.harness.query(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            p.provolatile AS volatility, p.proconfig::text AS settings,
            has_function_privilege('public', p.oid, 'EXECUTE') AS anyone
       FROM pg_proc p WHERE p.proname=$1`,
    [ticketProposedLandingReadFunction],
  );
  assert.deepEqual(door, {
    owner: boundaryOwnerRole,
    definer: true,
    volatility: "s",
    settings: '{"search_path=pg_catalog, public, pg_temp"}',
    anyone: false,
  });
});
