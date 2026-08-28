/**
 * Preparation end to end: the real durable authority against a real PostgreSQL,
 * the real git adapter against a real bare repository, and the real project-owned
 * artifact store on a real filesystem.
 *
 * NOTHING IS SUBSTITUTED HERE AT ALL. Every other finalizer suite fakes the
 * remote, because a refused update and an ambiguous one are answers a real
 * remote will not produce on demand — but a clean automatic merge, a genuine
 * conflict and a target that moved are exactly what a real repository does
 * produce, and a fake asserting them would be asserting itself.
 *
 * THE RACE IS STAGED AND NOT HOPED FOR. A preparation observes the target,
 * builds over it and re-reads before integrating, so a case that wants the
 * conflict pushes to the remote in the window between those two reads rather
 * than trusting timing to find it.
 *
 * EVERY CASE QUIESCES THE DATABASE IT SHARES. The suites in this directory run
 * against one database and a pass draws work installation-wide, so a case that
 * left a live request would be advanced by the next case's pass.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { after, before, test } from "node:test";

import {
  artifactOwnedFile,
  artifactProjectDirectory,
} from "../../src/adapters/artifacts/artifactKey.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  type ChangeProposalForges,
  type ChangeProposalPort,
  type ChangeProposalRequest,
} from "../../src/interpreter/changeProposal.ts";
import {
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  asInputBundleId,
  asRepositoryId,
  type FinalizationClaim,
} from "../../src/interpreter/finalizer.ts";
import {
  handoffAccepted,
  handoffSuperseded,
  type AttemptRecord,
} from "../../src/interpreter/finalizerPreparation.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerBriefBranch,
  finalizerBriefFinalizationTarget,
  finalizerClaim,
  finalizerCommit,
  finalizerDeclareSource,
  finalizerDigest,
  finalizerExpireClaim,
  finalizerGitVerb,
  finalizerIdentity,
  finalizerMovingPort,
  finalizerPassOnce,
  finalizerPassedWork,
  finalizerProject,
  finalizerPromote,
  finalizerRacingPort,
  finalizerSpawnTasks,
  finalizerRemoteAttempt,
  finalizerRemoteCommit,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerStoreArtifact,
  finalizerSubject,
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

/** One attempt row as a case reads it back. */
interface AttemptState {
  readonly attempt: string;
  readonly target_ref: string;
  readonly target_commit: string;
  readonly candidate_commit: string | null;
  readonly outcome: string;
  readonly failure_kind: string | null;
  readonly conflict_manifest: string | null;
  readonly conflict_manifest_digest: string | null;
  readonly approval_required: boolean;
  readonly attempt_digest: string;
}

/** Every attempt this project's request has, oldest first. */
async function attemptsOf(
  project: FinalizerProject,
): Promise<readonly AttemptState[]> {
  return (await rig.as(
    `SELECT attempt, target_ref, target_commit, candidate_commit, outcome, failure_kind,
            conflict_manifest, conflict_manifest_digest, approval_required,
            attempt_digest
       FROM finalization_attempt WHERE tenant=$1 AND project=$2
      ORDER BY prepared_at, attempt`,
    [project.partition.tenant, project.partition.project],
  )) as readonly unknown[] as readonly AttemptState[];
}

/** One attempt offered straight to the durable authority, under a claim a case holds. */
function attemptRecordOf(
  claim: FinalizationClaim,
  project: FinalizerProject,
  label: string,
): AttemptRecord {
  const bundle = asInputBundleId(finalizerIdentity(`bundle-${label}`));
  return {
    claim,
    repository: asRepositoryId(project.repository),
    attempt: asFinalizationAttemptId(finalizerIdentity(`attempt-${label}`)),
    bundle: {
      bundle,
      digest: finalizerDigest(),
      references: [{ kind: "Repository", reference: project.repository }],
    },
    target: {
      ref: asGitRefName("refs/heads/main"),
      commit: asGitObjectId(finalizerCommit()),
    },
    strategy: "Merge",
    configuration: {
      revision: project.configurationRevision,
      digest: project.configurationDigest,
    },
    approvalRequired: false,
    outcome: "Prepared",
    candidate: asGitObjectId(finalizerCommit()),
    attemptDigest: finalizerDigest(),
  };
}

/** The references the bundle one attempt pinned carries, in the order it named them. */
async function bundleOf(
  project: FinalizerProject,
): Promise<readonly { reference_kind: string; reference_id: string }[]> {
  return (await rig.as(
    `SELECT r.reference_kind, r.reference_id
       FROM input_bundle_reference r
       JOIN finalization_attempt a
         ON a.tenant=r.tenant AND a.project=r.project AND a.input_bundle=r.bundle
      WHERE r.tenant=$1 AND r.project=$2 ORDER BY r.ordinal`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { reference_kind: string; reference_id: string }[];
}

test("a clean preparation writes the candidate over the observed target and records it", async () => {
  const { project, remote } = await finalizerSubject(rig, "clean", [
    { path: "one.txt", content: "one\n" },
    { path: "lib/two.txt", content: "two\n" },
  ]);
  const port = finalizerRemotePort(rig);
  const report = await finalizerPassOnce(rig, project, port, "clean");
  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const attempts = await attemptsOf(project);
  const written = attempts[0];
  assert.equal(attempts.length, 1);
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.failure_kind, null);
  assert.equal(written?.approval_required, false);
  assert.equal(written?.attempt_digest.length, 64);
  assert.equal(
    written?.target_commit,
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
  );
  assert.deepEqual(
    (await bundleOf(project)).map((each) => each.reference_kind),
    ["Repository", "ConfigurationRevision", "ResultManifest"],
  );
});

/** The branch the brief-bearing case names, which is no remote's default. */
const briefBranch = "refs/heads/chuggy/footer-2026";

test("a ticket whose brief names a branch is prepared and promoted there and never on the default", async () => {
  const { project, remote } = await finalizerSubject(rig, "briefbranch", [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerGitVerb(remote.origin, "branch", "chuggy/footer-2026", "main");
  finalizerRemoteCommit(remote, "moved.txt", "moved\n", "moved");
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    briefBranch,
  );
  const port = finalizerRemotePort(rig);
  const untouched = finalizerGitVerb(
    remote.origin,
    "rev-parse",
    "refs/heads/main",
  );

  const report = await finalizerPassOnce(rig, project, port, "briefbranch");

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.target_ref, briefBranch);
  assert.equal(
    written?.target_commit,
    finalizerGitVerb(remote.origin, "rev-parse", briefBranch),
  );
  assert.notEqual(written?.target_commit, untouched);

  await finalizerExpireClaim(rig, project);
  const promoted = await finalizerPassOnce(
    rig,
    project,
    port,
    "briefbranch-on",
  );

  assert.equal(promoted.promotions, 1);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", briefBranch),
    written?.candidate_commit,
  );
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    untouched,
  );
});

/** The branch the landing case promotes onto, which is neither the work's nor the default. */
const landingBranch = "refs/heads/chuggy/footer-landing";

test("a ticket landing elsewhere carries what accumulated on the branch it worked on", async () => {
  const { project, remote } = await finalizerSubject(rig, "landing", [
    { path: "one.txt", content: "one\n" },
  ]);
  const worked = finalizerRemoteAttempt(
    remote,
    "accumulated.txt",
    "accumulated\n",
    briefBranch,
  );
  finalizerGitVerb(remote.origin, "branch", "chuggy/footer-landing", "main");
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    briefBranch,
  );
  await finalizerBriefFinalizationTarget(
    rig,
    project.partition,
    project.ticket,
    landingBranch,
  );
  const port = finalizerRemotePort(rig);

  const report = await finalizerPassOnce(rig, project, port, "landing");

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.target_ref, landingBranch);

  await finalizerExpireClaim(rig, project);
  const promoted = await finalizerPassOnce(rig, project, port, "landing-on");

  assert.equal(promoted.promotions, 1);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", landingBranch),
    written?.candidate_commit,
  );
  assert.deepEqual(
    finalizerGitVerb(
      remote.origin,
      "ls-tree",
      "-r",
      "--name-only",
      landingBranch,
    ).split("\n"),
    ["accumulated.txt", "base.txt", "one.txt"],
    "the branch's own work and the handoff both reach the target",
  );
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", briefBranch),
    worked,
    "the branch the work happened on is not where the work landed",
  );
});

/** One stored change proposal as a case reads it back. */
interface ProposalState {
  readonly head_ref: string;
  readonly head_commit: string;
  readonly base_ref: string;
  readonly base_commit: string;
  readonly title: string;
  readonly body: string;
  readonly creation: string | null;
  readonly creation_url: string | null;
  readonly reconciliations: string;
}

/** The change proposal this project's request left, and nothing where it left none. */
async function proposalOf(
  project: FinalizerProject,
): Promise<ProposalState | undefined> {
  const rows = (await rig.as(
    `SELECT head_ref, head_commit, base_ref, base_commit, title, body,
            creation, creation_url, reconciliations::text AS reconciliations
       FROM finalization_change_proposal WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly unknown[] as readonly ProposalState[];
  return rows[0];
}

/**
 * The forge this case's repository is bound to. Which binding a repository
 * selects is decided by its host and proved where that selection is composed,
 * so a fixture whose remote is a filesystem path binds one outright.
 */
function proposalForges(port: ChangeProposalPort): ChangeProposalForges {
  const binding = {
    forge: asForgeBindingId("forge-rig"),
    credential: asForgeCredentialReference("forge-rig-proposals"),
  };
  return { selector: { select: () => port }, bindingOf: () => binding };
}

/** A forge that opens the proposal it is asked for, answering with the request's own fields. */
function proposalPort(): ChangeProposalPort & {
  readonly creates: ChangeProposalRequest[];
} {
  const own = {
    creates: [] as ChangeProposalRequest[],
    create: (request: ChangeProposalRequest) => {
      own.creates.push(request);
      return Promise.resolve({
        created: "Created" as const,
        evidence: {
          identity: {
            forge: request.binding.forge,
            remote: asProposalRemoteIdentity("proposal-rig"),
          },
          repository: request.repository,
          marker: request.marker,
          head: request.head,
          base: request.base,
          title: request.title,
          body: request.body,
          status: "Open" as const,
          url: asProposalDisplayUrl("https://forge.invalid/proposals/1"),
        },
      });
    },
    readByMarker: () => Promise.resolve({ read: "Absent" as const }),
  };
  return own;
}

test("a ticket that finishes by proposing lands on its branch and opens one into its target", async () => {
  const { project, remote } = await finalizerSubject(rig, "proposing", [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerGitVerb(remote.origin, "branch", "chuggy/footer-2026", "main");
  finalizerGitVerb(remote.origin, "branch", "chuggy/footer-landing", "main");
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    briefBranch,
  );
  await finalizerBriefFinalizationTarget(
    rig,
    project.partition,
    project.ticket,
    landingBranch,
    "PullRequest",
  );
  const port = finalizerRemotePort(rig);
  const forge = proposalPort();
  const forges = proposalForges(forge);
  const landing = finalizerGitVerb(remote.origin, "rev-parse", landingBranch);

  const prepared = await finalizerPassOnce(rig, project, port, "proposing");
  assert.equal(prepared.preparations, 1);
  const attempt = (await attemptsOf(project))[0];
  assert.equal(
    attempt?.target_ref,
    briefBranch,
    "a proposing ticket is promoted onto the branch its work happened on",
  );

  await finalizerExpireClaim(rig, project);
  const promoted = await finalizerPassOnce(
    rig,
    project,
    port,
    "proposing-on",
    forges,
  );
  assert.equal(promoted.promotions, 1);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", briefBranch),
    attempt?.candidate_commit,
  );
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", landingBranch),
    landing,
    "the branch a proposal is opened into is not written to",
  );

  await finalizerExpireClaim(rig, project);
  const opening = await finalizerPassOnce(
    rig,
    project,
    port,
    "proposing-open",
    forges,
  );
  assert.equal(opening.proposals, 1);
  assert.equal(opening.conclusions, 0);
  const stored = await proposalOf(project);
  assert.equal(stored?.head_ref, briefBranch);
  assert.equal(stored?.head_commit, attempt?.candidate_commit);
  assert.equal(stored?.base_ref, landingBranch);
  assert.equal(stored?.base_commit, landing);
  assert.equal(stored?.creation, "Created");
  assert.equal(stored?.creation_url, "https://forge.invalid/proposals/1");
  assert.equal(stored?.reconciliations, "0");
  assert.equal(forge.creates[0]?.head.ref, briefBranch);
  assert.equal(stored?.body.includes(forge.creates[0]?.marker ?? ""), true);

  await finalizerExpireClaim(rig, project);
  const concluded = await finalizerPassOnce(
    rig,
    project,
    port,
    "proposing-done",
    forges,
  );
  assert.equal(concluded.conclusions, 1);
  assert.equal(concluded.proposals, 0, "a proved proposal spends no forge act");
  assert.equal(forge.creates.length, 1, "no second create was authorized");
});

test("a change proposal is created once, opened once, and never erased", async () => {
  const { project } = await finalizerSubject(rig, "proposalrow", [
    { path: "one.txt", content: "one\n" },
  ]);
  await finalizerPromote(rig, project, "proposalrow");
  const permit = (
    (await rig.as(
      `SELECT permit FROM commit_permit WHERE tenant=$1 AND project=$2`,
      [project.partition.tenant, project.partition.project],
    )) as readonly { permit: string }[]
  )[0]?.permit;
  const request = finalizerDigest();
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      permit,
      request,
      briefBranch,
      finalizerCommit(),
      landingBranch,
      finalizerCommit(),
      "ticket 1: propose it",
      "propose it\n\nchuggy-handoff:x",
    ],
  );
  await rig.as(
    `UPDATE finalization_change_proposal SET creation='Created'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.match(
    await rig.refusal(
      `UPDATE finalization_change_proposal SET creation='Ambiguous'
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    /created once and read back after/u,
  );
  assert.match(
    await rig.refusal(
      `UPDATE finalization_change_proposal SET head_commit=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        finalizerCommit(),
      ],
    ),
    /permission denied/u,
    "the finalizer holds no grant on what the forge was asked for",
  );
  assert.match(
    await rig.ownerRefusal(
      `UPDATE finalization_change_proposal SET head_commit=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        finalizerCommit(),
      ],
    ),
    /asked for is written once/u,
    "and nobody else may rewrite it either",
  );
  assert.match(
    await rig.refusal(
      `DELETE FROM finalization_change_proposal
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    /permission denied/u,
    "the finalizer holds no grant that could erase one",
  );
  assert.match(
    await rig.ownerRefusal(
      `DELETE FROM finalization_change_proposal
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    /could be erased is not evidence/u,
    "and nobody else may erase one either",
  );
  await rig.as(
    `UPDATE finalization_change_proposal
        SET reconciliation='Absent', reconciliations=reconciliations+1
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.match(
    await rig.refusal(
      `UPDATE finalization_change_proposal SET reconciliation='Rebased'
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    /finalization_change_proposal_results_are_whole/u,
  );
});

/** The branch the uncreated-branch cases name, which no fixture remote holds. */
const unheldBranch = "refs/heads/chuggy/unheld";

test("a brief branch the remote does not hold is prepared over the default and created by the promotion", async () => {
  const { project, remote } = await finalizerSubject(rig, "unheld", [
    { path: "one.txt", content: "one\n" },
  ]);
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    unheldBranch,
  );
  const port = finalizerRemotePort(rig);
  const untouched = finalizerGitVerb(
    remote.origin,
    "rev-parse",
    "refs/heads/main",
  );

  const report = await finalizerPassOnce(rig, project, port, "unheld");

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.target_ref, unheldBranch);
  assert.equal(written?.target_commit, untouched);

  await finalizerExpireClaim(rig, project);
  const promoted = await finalizerPassOnce(rig, project, port, "unheld-on");

  assert.equal(promoted.promotions, 1);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", unheldBranch),
    written?.candidate_commit,
  );
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    untouched,
  );
});

/**
 * The one path where the base is fetched rather than already held: a worker
 * that pushed a branch declares a source, so the preparation fetches that
 * attempt's ref and nothing else — and a default branch that moved after the
 * worker started is a commit the integration must go and get. Under a brief
 * branch nobody holds, the ref that commit is asked for by is the only thing
 * standing between the ticket and a hold it repeats every pass.
 */
test("a source handoff for an unheld brief branch fetches the base the default moved to", async () => {
  const { project, remote, work } = await finalizerSubject(
    rig,
    "unheldsource",
    [],
  );
  const base = finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main");
  const attemptRef = `refs/heads/chuggy/tickets/${String(project.ticket)}/attempts/one`;
  const worked = finalizerRemoteAttempt(
    remote,
    "worker.txt",
    "worker\n",
    attemptRef,
  );
  await finalizerDeclareSource(rig, project, work, attemptRef, worked, base);
  const moved = finalizerRemoteCommit(remote, "moved.txt", "moved\n", "moved");
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    unheldBranch,
  );

  const report = await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "unheldsource",
  );

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.target_ref, unheldBranch);
  assert.equal(
    written?.target_commit,
    moved,
    "the base is the commit the default moved to, which no fetched ref held",
  );
  assert.notEqual(written?.candidate_commit, worked);
});

test("a branch created before the update lands refuses it, and the next pass prepares against it", async () => {
  const { project, remote } = await finalizerSubject(rig, "raced", [
    { path: "one.txt", content: "one\n" },
  ]);
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    unheldBranch,
  );
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, "raced");
  const prepared = (await attemptsOf(project))[0];
  assert.equal(prepared?.outcome, "Prepared");

  let theirs = "";
  const racing = finalizerRacingPort(port, () => {
    theirs = finalizerRemoteCommit(remote, "theirs.txt", "theirs\n", "theirs");
    finalizerGitVerb(remote.origin, "update-ref", unheldBranch, theirs);
  });
  await finalizerExpireClaim(rig, project);
  const refused = await finalizerPassOnce(rig, project, racing, "raced-on");

  assert.equal(refused.promotions, 1);
  assert.notEqual(theirs, "");
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", unheldBranch),
    theirs,
    "the branch somebody else created holds what they put on it",
  );

  await finalizerExpireClaim(rig, project);
  const again = await finalizerPassOnce(rig, project, port, "raced-again");

  assert.equal(again.preparations, 1);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1]?.target_ref, unheldBranch);
  assert.equal(attempts[1]?.target_commit, theirs);
});

test("a genuine conflict prices one failure and stores its evidence outside every row", async () => {
  const { project, remote } = await finalizerSubject(rig, "conflict", [
    { path: "base.txt", content: "candidate\n" },
  ]);
  const port = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  const report = await finalizerPassOnce(rig, project, port, "conflict");
  assert.equal(report.preparations, 1);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Failed");
  assert.equal(written?.failure_kind, "MergeConflict");
  assert.equal(written?.candidate_commit, null);
  assert.equal(written?.conflict_manifest?.startsWith("conflict-"), true);
  assert.equal(written?.conflict_manifest_digest?.length, 64);
  assert.equal(
    written?.target_commit,
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
  );
});

test("a target that moved without conflicting is merged and the attempt pins what it merged into", async () => {
  const { project, remote } = await finalizerSubject(rig, "merged", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "other.txt", "other\n", "other");
  });
  await finalizerPassOnce(rig, project, port, "merged");
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(
    written?.target_commit,
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
  );
  assert.notEqual(written?.candidate_commit, written?.target_commit);
});

test("a target that moves after an attempt restarts preparation rather than chasing it", async () => {
  const { project, remote } = await finalizerSubject(rig, "restart", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, "restart");
  const first = (await attemptsOf(project))[0];
  finalizerRemoteCommit(remote, "other.txt", "other\n", "other");
  await finalizerExpireClaim(rig, project);
  const again = await finalizerPassOnce(rig, project, port, "restart-again");
  assert.equal(again.preparations, 1);
  assert.equal(again.promotions, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[1]?.attempt, first?.attempt);
  assert.equal(
    attempts[1]?.target_commit,
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
  );
});

test("the restart ceiling becomes a hold and never a priced failure", async () => {
  const { project, remote } = await finalizerSubject(rig, "ceiling", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = finalizerRemotePort(rig);
  for (let spent = 0; spent < 4; spent++) {
    await finalizerPassOnce(rig, project, port, `ceiling-${String(spent)}`);
    finalizerRemoteCommit(
      remote,
      `move-${String(spent)}.txt`,
      "moved\n",
      "moved",
    );
    await finalizerExpireClaim(rig, project);
  }
  const exhausted = await finalizerPassOnce(rig, project, port, "ceiling-last");
  assert.equal(exhausted.preparations, 0);
  assert.equal(exhausted.holds, 1);
  assert.equal(exhausted.conclusions, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 4);
  assert.equal(
    attempts.every((each) => each.outcome === "Prepared"),
    true,
  );
});

test("an artifact whose bytes are not what the manifest declared cannot become a commit", async () => {
  const { project, work } = await finalizerSubject(rig, "unverified", [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerStoreArtifact(rig, project, work, {
    path: "one.txt",
    content: "tampered\n",
  });
  const report = await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    "unverified",
  );
  assert.equal(report.preparations, 1);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Failed");
  assert.equal(written?.failure_kind, "PreparationFailed");
  assert.equal(written?.conflict_manifest, null);
});

test("a pinned revision that asks for approval opens the ask through the one door that may", async () => {
  const { project } = await finalizerSubject(rig, "approval", [
    { path: "one.txt", content: "one\n" },
  ]);
  await rig.harness.query(
    `UPDATE configuration_revision
        SET canonical = $3, digest = digest
      WHERE tenant=$1 AND project=$2`,
    [
      project.partition.tenant,
      project.partition.project,
      '{"finalizationApprovalRequired":true,"image":"i","version":1}',
    ],
  );
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, "approval");
  assert.equal((await attemptsOf(project))[0]?.approval_required, true);
  await finalizerExpireClaim(rig, project);
  const asked = await finalizerPassOnce(rig, project, port, "approval-again");
  assert.equal(asked.approvals, 1);
  const actions = await rig.as(
    `SELECT kind, required_capability, state, attempt FROM native_action
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.["kind"], "FinalizationApproval");
  assert.equal(actions[0]?.["required_capability"], "ApproveFinalization");
  assert.equal(actions[0]?.["state"], "Open");
  await finalizerExpireClaim(rig, project);
  const standing = await finalizerPassOnce(
    rig,
    project,
    port,
    "approval-third",
  );
  assert.equal(standing.approvals, 0);
  assert.equal(standing.holds, 1);
});

test("an attempt a retired holder offers is refused, and its bundle is refused with it", async () => {
  const { project } = await finalizerSubject(rig, "fenced", [
    { path: "one.txt", content: "one\n" },
  ]);
  const claim = await finalizerClaim(rig, project, "owner-fenced");
  const store = postgresFinalizer(rig.pool);
  const first = attemptRecordOf(claim, project, "fenced-one");
  assert.deepEqual(await store.recordAttempt(first), { recorded: "Attempt" });
  await rig.as(
    `UPDATE finalization_request SET claim_generation = claim_generation + 1
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  const second = attemptRecordOf(claim, project, "fenced-two");
  assert.deepEqual(await store.recordAttempt(second), { recorded: "Fenced" });
  assert.deepEqual(
    (await attemptsOf(project)).map((each) => each.attempt),
    [first.attempt],
  );
  const bundles = await rig.as(
    `SELECT bundle FROM input_bundle
      WHERE tenant=$1 AND project=$2 AND bundle IN ($3,$4)`,
    [
      project.partition.tenant,
      project.partition.project,
      first.bundle.bundle,
      second.bundle.bundle,
    ],
  );
  assert.deepEqual(bundles, [{ bundle: first.bundle.bundle }]);
});

test("a takeover leaves an old-epoch executor unable to write an attempt", async () => {
  const { project } = await finalizerSubject(rig, "superseded", [
    { path: "one.txt", content: "one\n" },
  ]);
  const claim = await finalizerClaim(rig, project, "owner-superseded");
  const store = postgresFinalizer(rig.pool);
  const first = attemptRecordOf(claim, project, "superseded-one");
  assert.deepEqual(await store.recordAttempt(first), { recorded: "Attempt" });
  await rig.harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`epoch-superseded-${project.partition.project}`),
  );
  const second = attemptRecordOf(claim, project, "superseded-two");
  assert.deepEqual(await store.recordAttempt(second), { recorded: "Fenced" });
  assert.deepEqual(
    (await attemptsOf(project)).map((each) => each.attempt),
    [first.attempt],
  );
});

test("an attempt is written once, and the trigger says so rather than a read", async () => {
  const { project } = await finalizerSubject(rig, "immutable", [
    { path: "one.txt", content: "one\n" },
  ]);
  await finalizerPassOnce(rig, project, finalizerRemotePort(rig), "immutable");
  const written = (await attemptsOf(project))[0];
  assert.match(
    await rig.refusal(
      `UPDATE finalization_attempt SET outcome='Failed'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, written?.attempt],
    ),
    /permission denied/u,
  );
  assert.match(
    await rig.ownerRefusal(
      `UPDATE finalization_attempt SET outcome='Failed'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, written?.attempt],
    ),
    /written once/u,
  );
});

test("the conflict manifest the attempt names is stored, read-only, and hashes to the digest beside it", async () => {
  const { project, remote } = await finalizerSubject(rig, "evidence", [
    { path: "base.txt", content: "candidate\n" },
  ]);
  const port = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  await finalizerPassOnce(rig, project, port, "evidence");
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.failure_kind, "MergeConflict");
  const stored = artifactOwnedFile(
    artifactProjectDirectory(
      rig.artifactRoot,
      project.partition.tenant,
      project.partition.project,
    ),
    written?.conflict_manifest ?? "",
  );
  const bytes = readFileSync(stored);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    written?.conflict_manifest_digest,
  );
  assert.equal((statSync(stored).mode & 0o222) === 0, true);
  const evidence = JSON.parse(bytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(evidence["request"], project.request);
  assert.equal(evidence["attempt"], written?.attempt);
  assert.equal(evidence["strategy"], "Merge");
  assert.deepEqual(evidence["conflictingPaths"], ["base.txt"]);
  assert.equal(
    evidence["mergeBase"],
    finalizerGitVerb(remote.seed, "rev-parse", "HEAD~1"),
  );
});

test("a reworked ticket's gather hands back the source its latest passed work declared", async () => {
  const project = await finalizerProject(rig, "supersede", undefined, 1);
  const superseded = await finalizerPassedWork(rig, project, "a", []);
  const latest = await finalizerPassedWork(rig, project, "b", []);
  const retired = finalizerCommit();
  const authoritative = finalizerCommit();
  await finalizerDeclareSource(
    rig,
    project,
    superseded,
    "refs/heads/chuggy/tickets/1/attempts/one",
    retired,
  );
  await finalizerDeclareSource(
    rig,
    project,
    latest,
    "refs/heads/chuggy/tickets/1/attempts/two",
    authoritative,
  );

  const claim = await finalizerClaim(rig, project, "owner-supersede");
  const gathering = await postgresFinalizer(rig.pool).handoffGathering(claim);

  assert.deepEqual(
    gathering.work.map((each) => each.execution),
    [latest.execution, superseded.execution],
  );
  assert.deepEqual(
    gathering.sources.map((each) => each.commit),
    [authoritative, retired],
  );
  const accepted = handoffAccepted(handoffSuperseded(gathering));
  if (accepted.accepted !== "Handoff") assert.fail(JSON.stringify(accepted));
  if (accepted.handoff.kind !== "Source") assert.fail("a source handoff");
  assert.equal(accepted.handoff.source.commit, authoritative);
  assert.deepEqual(accepted.handoff.manifests, [latest.manifest]);
});

test("the work draw orders a ticket's spawns by the task number and not by its text", async () => {
  const project = await finalizerProject(rig, "ordered", undefined, 1);
  await finalizerSpawnTasks(rig, project, [5, 7, 10]);
  for (const label of ["one", "three", "five", "seven", "ten"]) {
    await finalizerPassedWork(rig, project, label, []);
  }

  const claim = await finalizerClaim(rig, project, "owner-ordered");
  const gathering = await postgresFinalizer(rig.pool).handoffGathering(claim);

  assert.deepEqual(
    gathering.work.map((each) => each.task),
    [10, 7, 5, 3, 1],
  );
  const arriving = { ...gathering, work: [...gathering.work].reverse() };
  assert.deepEqual(
    handoffSuperseded(arriving).work.map((each) => each.task),
    [3, 5, 7, 10],
  );
});
