/**
 * A ticket's landings, as the API reads them from a real server.
 *
 * EACH LANDING IS BUILT AS THE FINALIZER RECORDS IT. A project is brought to
 * finalization by real decisions; attempts, permits, holds and proposals are
 * written as the finalizer under the relations' own constraints; and a landing
 * concludes through the finalizer's own door and the decision that answers it,
 * so its journal event is the one the writer journals.
 *
 * THE READS ARE MADE AS THE API, through the store the route is composed over
 * and the artifact store the finalizer writes manifests to, and whoever
 * migrated is asked only what the API may not read.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresTicketLandings } from "../../src/adapters/postgres/ticketLandings.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  schedulerRole,
  ticketLandedCommitReadFunction,
  ticketLandingsReadFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  jsonTextBytes,
  ticketLandingConflictBytesMax,
  ticketLandingsAnsweredMax,
} from "../../src/contract/http.ts";
import type { BriefFinalizationMode } from "../../src/contract/rosters.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import {
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  type FinalizationClaim,
  type FinalizationConclusion,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  conflictManifestText,
  type ProjectArtifactPort,
} from "../../src/interpreter/finalizerPreparation.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  ticketLandingReads,
  type TicketLandings,
} from "../../src/interpreter/ticketLandings.ts";
import {
  finalizerAccept,
  finalizerBriefFinalizationTarget,
  finalizerBriefLandsNothing,
  finalizerClaim,
  finalizerCommit,
  finalizerDigest,
  finalizerDrain,
  finalizerEntering,
  finalizerEvaluation,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerPromote,
  finalizerRequestApproval,
  finalizerRigOpen,
  finalizerTaskDone,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  postgresHarnessDenial,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
} from "./harness.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

let rig: FinalizerRig;
let apiPool: pg.Pool;
let artifacts: ReturnType<typeof artifactStore>;
before(async () => {
  rig = await finalizerRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  artifacts = artifactStore({ root: rig.artifactRoot });
});
after(async () => {
  await apiPool.end();
  await rig.close();
});

const reader = asPrincipal("issuer reader");

/** What one reader is answered of a ticket, the manifests read through `store`. */
function landingsOf(
  project: Pick<FinalizerProject, "partition" | "ticket">,
  store: Pick<ProjectArtifactPort, "readArtifact"> = artifacts,
): Promise<TicketLandings | undefined> {
  return ticketLandingReads({
    access: {
      authorize: (who) => Promise.resolve(memberAuthority(who)),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    store: postgresTicketLandings(apiPool),
    artifacts: store,
  }).read(reader, project.partition, asTicketId(project.ticket));
}

/** One project at finalization landing as `mode` names, in a partition of its own. */
async function finalizing(
  label: string,
  mode: BriefFinalizationMode,
): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
  if (mode === "None")
    await finalizerBriefLandsNothing(rig, project.partition, project.ticket);
  else
    await finalizerBriefFinalizationTarget(
      rig,
      project.partition,
      project.ticket,
      "refs/heads/main",
      mode,
    );
  return project;
}

/** Concludes the project's request through the finalizer's door and decides it, answering the memory the decision left. */
async function concluded(
  project: FinalizerProject,
  conclusion: FinalizationConclusion,
  attempt?: string,
  held?: FinalizationClaim,
): Promise<ProjectMemory> {
  const claim =
    held ?? (await finalizerClaim(rig, project, finalizerIdentity("owner")));
  const submitted = await postgresFinalizer(rig.pool).submitResult({
    claim,
    ...(attempt === undefined
      ? {}
      : { attempt: asFinalizationAttemptId(attempt) }),
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

/** A permit promoted for the project's request, and what the attempt it spent built. */
interface Promotion {
  readonly attempt: string;
  readonly permit: string;
  readonly candidate: string;
}

async function promotion(
  project: FinalizerProject,
  label: string,
): Promise<Promotion> {
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

/** What a forge said of a proposal, as its evidence is stored. */
function forgeSaid(
  status: string,
  more: Readonly<Record<string, string>> = {},
): string {
  return JSON.stringify({
    title: "ticket: land it",
    body: "land it",
    status,
    ...more,
  });
}

const headRef = "refs/heads/chuggy/ticket";

/**
 * The row a pull request leaves over a promoted permit, written as the
 * finalizer writes it before it asks the forge anything, and then each answer
 * in `answers` recorded as a statement of its own, `$4` its one value.
 */
async function proposalOver(
  project: FinalizerProject,
  promoted: Promotion,
  ...answers: readonly (readonly [string, string])[]
): Promise<void> {
  const key = [
    project.partition.tenant,
    project.partition.project,
    project.request,
  ];
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'refs/heads/main',$8,'ticket: land it','land it',1)`,
    [
      ...key,
      promoted.permit,
      finalizerDigest(),
      headRef,
      promoted.candidate,
      finalizerCommit(),
    ],
  );
  for (const [assignments, value] of answers)
    await rig.as(
      `UPDATE finalization_change_proposal SET ${assignments}
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [...key, value],
    );
}

const createdAs = (said: string) =>
  ["creation='Created', creation_evidence=$4::jsonb", said] as const;

/** What a merge reading found, with the mergeability its evidence carries. */
const mergeReadAs = (reading: string, said: string) =>
  [
    `merge_attempts=1, merge_reading='${reading}', merge_reading_evidence=$4::jsonb, merge_readings=1`,
    said,
  ] as const;

const pullRequest = "https://forge.example/acme/atlas/pull/9";

/** When one attempt was prepared, as the read is expected to spell it. */
async function preparedAt(
  project: FinalizerProject,
  attempt: string,
): Promise<string> {
  const [row] = await rig.harness.query(
    `SELECT to_char(prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
       FROM finalization_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  );
  return String(row?.["at"]);
}

/**
 * A failed attempt naming a conflict manifest, its bytes stored where the
 * finalizer stores them where `paths` names some, and stored nowhere where it
 * names none.
 */
async function conflicted(
  project: FinalizerProject,
  label: string,
  target: string,
  paths?: readonly string[],
): Promise<string> {
  const artifact = asProjectArtifactId(finalizerIdentity(`conflict-${label}`));
  let digest = finalizerDigest();
  if (paths !== undefined) {
    const written = await artifacts.writeArtifact({
      partition: project.partition,
      artifact,
      content: new TextEncoder().encode(
        conflictManifestText({
          request: project.request,
          attempt: asFinalizationAttemptId("attempt"),
          strategy: "Merge",
          candidate: asGitObjectId(finalizerCommit()),
          target: {
            ref: asGitRefName("refs/heads/main"),
            commit: asGitObjectId(target),
          },
          conflict: { paths, truncated: false },
        }),
      ),
    });
    assert.equal(written.written, "Artifact");
    if (written.written === "Artifact") digest = written.digest;
  }
  return finalizerPrepare(rig, project, label, {
    outcome: "Failed",
    failureKind: "MergeConflict",
    target,
    conflictManifest: { artifact, digest },
  });
}

const needsWork: FinalizationConclusion = {
  outcome: "FinalizationNeedsWork",
  kind: "MergeConflict",
};
const succeeded: FinalizationConclusion = { outcome: "FinalizationSucceeded" };

/** Where 038's door says the ticket landed, as the API reads it. */
async function ticketLandedAt(
  project: FinalizerProject,
): Promise<string | undefined> {
  const found = await apiPool.query<{ repository_commit: string }>(
    `SELECT repository_commit FROM ${ticketLandedCommitReadFunction}($1,$2,$3)`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  return found.rows[0]?.repository_commit;
}

test("a ticket that never reached finalization has had no landing, and one the project does not have is answered nothing", async () => {
  const entering = await finalizerEntering(rig, "unreached");
  assert.deepEqual(
    await landingsOf({ partition: entering.partition, ticket: 1 }),
    {
      landings: [],
      truncated: false,
    },
  );
  assert.equal(
    await landingsOf({ partition: entering.partition, ticket: 1000 }),
    undefined,
  );
});

test("a ticket in the mode that lands nothing has had no landing, though its request concluded", async () => {
  const project = await finalizing("lands-nothing", "None");
  await concluded(project, succeeded);
  const [request] = await rig.harness.query(
    `SELECT state FROM finalization_request WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(request?.["state"], "Fulfilled");
  assert.deepEqual(await landingsOf(project), {
    landings: [],
    truncated: false,
  });
});

test("a landing that failed on a conflict its preparation found answers Failed, the attempt, its target and the manifest's paths", async () => {
  const project = await finalizing("prepared-conflict", "Push");
  const target = finalizerCommit();
  const attempt = await conflicted(project, "prepared-conflict", target, [
    "one.ts",
    "two.ts",
  ]);
  await concluded(project, needsWork, attempt);
  assert.deepEqual(await landingsOf(project), {
    landings: [
      {
        state: "Failed",
        cycle: 1,
        generation: 1,
        attempts: 1,
        attempt: {
          outcome: "Failed",
          failureKind: "MergeConflict",
          targetRef: "refs/heads/main",
          targetCommit: target,
          preparedAt: await preparedAt(project, attempt),
        },
        conflict: { paths: ["one.ts", "two.ts"], truncated: false },
      },
    ],
    truncated: false,
  });
});

test("a landing whose pull request the forge would not merge for a conflict answers Failed, the conflict recorded after it, and the mergeability its reading found", async () => {
  const project = await finalizing("merge-conflict", "PullRequestMerge");
  const promoted = await promotion(project, "merge-conflict");
  await proposalOver(
    project,
    promoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
    mergeReadAs("Unmerged", forgeSaid("Open", { mergeability: "Conflicting" })),
  );
  const failed = await finalizerPrepare(rig, project, "merge-conflict", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  await concluded(project, needsWork, failed);
  const read = await landingsOf(project);
  assert.equal(read?.landings.length, 1);
  const [landing] = read?.landings ?? [];
  assert.equal(landing?.state, "Failed");
  assert.equal(landing.attempts, 2);
  assert.deepEqual(
    [landing.attempt?.outcome, landing.attempt?.failureKind],
    ["Failed", "MergeConflict"],
  );
  assert.equal(landing.conflict, undefined);
  assert.deepEqual(landing.proposal, {
    url: pullRequest,
    headRef,
    baseRef: "refs/heads/main",
    creation: "Created",
    mergeability: "Conflicting",
  });
});

test("a landing merged through its pull request answers Landed, the link and the commit 038 finds, wherever the row keeps that commit", async () => {
  const merge = finalizerCommit();
  const read = await finalizing("merge-read", "PullRequestMerge");
  const readPromoted = await promotion(read, "merge-read");
  await proposalOver(
    read,
    readPromoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
    mergeReadAs("Accepted", forgeSaid("Merged", { mergeCommit: merge })),
  );
  await concluded(read, succeeded, readPromoted.attempt);
  const [readLanding] = (await landingsOf(read))?.landings ?? [];
  assert.equal(readLanding?.state, "Landed");
  assert.equal(
    readLanding.state === "Landed" ? readLanding.landedCommit : undefined,
    merge,
  );
  assert.equal(await ticketLandedAt(read), merge);
  assert.deepEqual(readLanding.proposal, {
    url: pullRequest,
    headRef,
    baseRef: "refs/heads/main",
    creation: "Created",
  });

  const made = finalizerCommit();
  const merged = await finalizing("merge-made", "PullRequestMerge");
  const mergedPromoted = await promotion(merged, "merge-made");
  await proposalOver(
    merged,
    mergedPromoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
    ["merge_attempts=1, merge='Merged', merge_commit=$4", made],
  );
  await concluded(merged, succeeded, mergedPromoted.attempt);
  const [mergedLanding] = (await landingsOf(merged))?.landings ?? [];
  assert.equal(
    mergedLanding?.state === "Landed" ? mergedLanding.landedCommit : undefined,
    made,
  );
  assert.equal(await ticketLandedAt(merged), made);
  assert.deepEqual(
    [mergedLanding?.proposal?.merge, mergedLanding?.proposal?.mergeCommit],
    ["Merged", made],
  );
});

test("a landing in the mode that stops at an open pull request answers Proposed and no commit", async () => {
  const project = await finalizing("proposed", "PullRequest");
  const promoted = await promotion(project, "proposed");
  await proposalOver(
    project,
    promoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
  );
  await concluded(project, succeeded, promoted.attempt);
  const [landing] = (await landingsOf(project))?.landings ?? [];
  assert.equal(landing?.state, "Proposed");
  assert.equal("landedCommit" in landing, false);
  assert.equal(landing.proposal?.url, pullRequest);
});

/**
 * Drives the project's ticket back to finalization after a landing sent it
 * to work: the rework's work passes and its evaluation passes, and the request
 * that decision opens is the project's next landing.
 */
async function finalizingAgain(
  project: FinalizerProject,
  memory: ProjectMemory,
  label: string,
): Promise<FinalizerProject> {
  let carried = memory;
  for (const task of [
    workTaskIdentity(project.ticket, 2),
    finalizerEvaluation(2),
  ]) {
    assert.equal(
      await finalizerAccept(
        rig.harness,
        project.partition,
        `${label}-${task.type}`,
        finalizerTaskDone(carried.graph, task),
      ),
      "Accepted",
    );
    const drained = await finalizerDrain(
      rig.harness,
      project.partition,
      carried,
    );
    assert.deepEqual(drained.decided, ["Committed"]);
    carried = drained.memory;
  }
  const [row] = await rig.harness.query(
    `SELECT request, authorizing_seq::text AS seq, request_generation::text AS generation
       FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND state='Open'`,
    [project.partition.tenant, project.partition.project],
  );
  assert.ok(row !== undefined, "the second evaluation opened a landing");
  return {
    ...project,
    request: String(row["request"]),
    authorizingSeq: Number(row["seq"]),
    requestGeneration: Number(row["generation"]),
    memory: carried,
  };
}

test("a ticket that failed a landing and landed the next answers both in order, each with its own cycle and its own commit", async () => {
  const first = await finalizing("twice", "PullRequestMerge");
  const firstPromoted = await promotion(first, "twice-first");
  await proposalOver(
    first,
    firstPromoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
    mergeReadAs("Unmerged", forgeSaid("Open", { mergeability: "Conflicting" })),
  );
  const failed = await finalizerPrepare(rig, first, "twice-failed", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  const second = await finalizingAgain(
    first,
    await concluded(first, needsWork, failed),
    "twice",
  );
  const secondPromoted = await promotion(second, "twice-second");
  const made = finalizerCommit();
  await proposalOver(
    second,
    secondPromoted,
    createdAs(forgeSaid("Open", { url: pullRequest })),
    ["merge_attempts=1, merge='Merged', merge_commit=$4", made],
  );
  await concluded(second, succeeded, secondPromoted.attempt);
  const read = await landingsOf(second);
  assert.deepEqual(
    read?.landings.map((landing) => [
      landing.state,
      landing.cycle,
      landing.state === "Landed" ? landing.landedCommit : undefined,
      landing.proposal?.mergeability ?? landing.proposal?.merge,
    ]),
    [
      ["Failed", 1, undefined, "Conflicting"],
      ["Landed", 2, made, "Merged"],
    ],
  );
  assert.equal(read?.truncated, false);
});

test("a live landing whose hold is recorded answers Held with the kind, the passes and since when", async () => {
  const project = await finalizing("held", "Push");
  const claim = await finalizerClaim(rig, project, finalizerIdentity("owner"));
  const store = postgresFinalizer(rig.pool);
  for (let pass = 0; pass < 2; pass += 1)
    await store.recordHold({ claim, kind: "TargetUnreadable" });
  const [row] = await rig.harness.query(
    `SELECT to_char(held_since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS since
       FROM finalization_request WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.deepEqual(await landingsOf(project), {
    landings: [
      {
        state: "Held",
        hold: {
          kind: "TargetUnreadable",
          passes: 2,
          since: String(row?.["since"]),
        },
        cycle: 1,
        generation: 1,
        attempts: 0,
      },
    ],
    truncated: false,
  });
});

test("a concluded landing whose hold columns are still set answers how it concluded and no hold, and one that escalated answers Unavailable", async () => {
  const landed = await finalizing("held-then-landed", "Push");
  const landedClaim = await finalizerClaim(
    rig,
    landed,
    finalizerIdentity("owner"),
  );
  await postgresFinalizer(rig.pool).recordHold({
    claim: landedClaim,
    kind: "TargetUnreadable",
  });
  const promoted = await promotion(landed, "held-then-landed");
  await concluded(landed, succeeded, promoted.attempt, landedClaim);
  const [landing] = (await landingsOf(landed))?.landings ?? [];
  assert.equal(landing?.state, "Landed");
  assert.equal("hold" in landing, false);
  assert.equal(
    landing.state === "Landed" ? landing.landedCommit : undefined,
    promoted.candidate,
  );

  const escalated = await finalizing("escalated", "Push");
  const claim = await finalizerClaim(
    rig,
    escalated,
    finalizerIdentity("owner"),
  );
  await postgresFinalizer(rig.pool).recordHold({
    claim,
    kind: "RepositoryUnbound",
  });
  await concluded(
    escalated,
    { outcome: "FinalizationResultUnavailable", kind: "RepositoryUnbound" },
    undefined,
    claim,
  );
  assert.deepEqual(await landingsOf(escalated), {
    landings: [{ state: "Unavailable", cycle: 1, generation: 1, attempts: 0 }],
    truncated: false,
  });
});

test("a landing waiting on an approval answers AwaitingApproval, and one whose approval was declined or whose permit was granted does not", async () => {
  for (const label of ["awaiting", "declined", "permitted"]) {
    const project = await finalizing(label, "Push");
    await finalizerClaim(rig, project, finalizerIdentity("owner"));
    const attempt = await finalizerPrepare(rig, project, label, {
      approvalRequired: true,
    });
    const action = finalizerIdentity(`action-${label}`);
    assert.equal(
      (await finalizerRequestApproval(rig, project, attempt, action))["result"],
      "Requested",
    );
    if (label === "declined") {
      const answered = await rig.harness.inbox.accept({
        ...postgresHarnessSubmission(project.partition, label),
        command: {
          version: 1,
          command: "ResolveNativeAction",
          action,
          authorizingSeq: project.authorizingSeq,
          resolution: "Decline",
        },
      });
      assert.equal(answered.accepted, "Accepted");
      await finalizerDrain(rig.harness, project.partition, project.memory);
    }
    if (label === "permitted")
      await rig.as(
        `INSERT INTO commit_permit
           (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
         VALUES ($1,$2,$3,$4,$5,1)`,
        [
          project.partition.tenant,
          project.partition.project,
          finalizerIdentity("permit"),
          attempt,
          project.epoch,
        ],
      );
    const [landing] = (await landingsOf(project))?.landings ?? [];
    assert.equal(
      landing?.state,
      label === "awaiting" ? "AwaitingApproval" : "Running",
      label,
    );
    assert.equal(landing.attempt?.outcome, "Prepared", label);
  }
});

test("a pull request found by reading it back answers the link its reading recorded, and a link that is not an https one that parses is left out", async () => {
  const found = await finalizing("read-back", "PullRequest");
  await proposalOver(found, await promotion(found, "read-back"), [
    "reconciliation='Accepted', reconciliation_evidence=$4::jsonb, reconciliations=1",
    forgeSaid("Open", { url: pullRequest }),
  ]);
  assert.deepEqual((await landingsOf(found))?.landings[0]?.proposal, {
    url: pullRequest,
    headRef,
    baseRef: "refs/heads/main",
  });
  for (const url of [
    "http://forge.example/acme/atlas/pull/9",
    "https://",
    "https://user:secret@forge.example/acme/atlas/pull/9",
  ]) {
    const named = await finalizing("unlinked", "PullRequest");
    await proposalOver(
      named,
      await promotion(named, "unlinked"),
      createdAs(forgeSaid("Open", { url })),
    );
    const [landing] = (await landingsOf(named))?.landings ?? [];
    assert.deepEqual(
      landing?.proposal,
      { headRef, baseRef: "refs/heads/main", creation: "Created" },
      url,
    );
  }
});

test("a manifest not found, and a store that cannot be reached, each leave the conflict out and answer the rest", async () => {
  const absent = await finalizing("manifest-absent", "Push");
  await concluded(
    absent,
    needsWork,
    await conflicted(absent, "manifest-absent", finalizerCommit()),
  );
  const [unwritten] = (await landingsOf(absent))?.landings ?? [];
  assert.equal(unwritten?.state, "Failed");
  assert.equal("conflict" in unwritten, false);
  assert.equal(unwritten.attempt?.failureKind, "MergeConflict");

  const stored = await finalizing("store-unavailable", "Push");
  await concluded(
    stored,
    needsWork,
    await conflicted(stored, "store-unavailable", finalizerCommit(), [
      "one.ts",
    ]),
  );
  const [unreached] =
    (
      await landingsOf(stored, {
        readArtifact: () =>
          Promise.resolve({ read: "Unavailable", retryAfterSeconds: 1 }),
      })
    )?.landings ?? [];
  assert.equal(unreached?.state, "Failed");
  assert.equal("conflict" in unreached, false);
  assert.deepEqual((await landingsOf(stored))?.landings[0]?.conflict, {
    paths: ["one.ts"],
    truncated: false,
  });
});

test("a manifest naming more paths than one landing answers answers the bound's worth and says the list was cut", async () => {
  const project = await finalizing("manifest-wide", "Push");
  const paths = Array.from(
    { length: ticketLandingConflictBytesMax },
    (_, at) => `path-${String(at)}.ts`,
  );
  await concluded(
    project,
    needsWork,
    await conflicted(project, "manifest-wide", finalizerCommit(), paths),
  );
  const conflict = (await landingsOf(project))?.landings[0]?.conflict;
  assert.equal(conflict?.truncated, true);
  const answered = conflict.paths;
  assert.deepEqual(answered, paths.slice(0, answered.length));
  const weighed = (some: readonly string[]) =>
    some.reduce((sum, path) => sum + jsonTextBytes(path), 0);
  assert.ok(weighed(answered) <= ticketLandingConflictBytesMax);
  assert.ok(
    weighed(paths.slice(0, answered.length + 1)) >
      ticketLandingConflictBytesMax,
  );
});

/**
 * The landings past the first are written by hand, since a ticket's rework
 * budget ends long before a read's bound does. Each is one more effect of the
 * decision that opened the first, which is where a request's sequence must
 * point, so they are told apart by their identities, each of which sorts after
 * the first's.
 */
test("a ticket with more landings than one read answers answers the newest, oldest first, and says there were more", async () => {
  const project = await finalizing("many", "Push");
  for (let at = 1; at <= ticketLandingsAnsweredMax; at += 1)
    await rig.harness.query(
      `INSERT INTO finalization_request
         (tenant,project,request,authorizing_seq,effect_position,ticket,
          ticket_version,request_generation,state,kind,work_cycle,
          finalization_generation)
       VALUES ($1,$2,$3,$4,$5,$6,$4,1,'Invalidated','RunFinalizer',1,$7)`,
      [
        project.partition.tenant,
        project.partition.project,
        `${project.request}-later-${String(at).padStart(3, "0")}`,
        project.authorizingSeq,
        100 + at,
        project.ticket,
        1 + at,
      ],
    );
  const read = await landingsOf(project);
  assert.equal(read?.truncated, true);
  assert.deepEqual(
    read?.landings.map((landing) => [landing.state, landing.generation]),
    Array.from({ length: ticketLandingsAnsweredMax }, (_, at) => [
      "Invalidated",
      2 + at,
    ]),
  );
});

const bystanders = [
  configurationImporterRole,
  ticketServiceRole,
  schedulerRole,
  workerPlaneRole,
  finalizerRole,
];

test("the landings are read through a door only the API may call, which runs as the boundary owner under a path of its own", async () => {
  const call = `SELECT * FROM ${ticketLandingsReadFunction}('tenant','project',1,1)`;
  assert.equal(await rig.harness.attemptAs(apiRole, call), undefined);
  for (const role of bystanders)
    assert.match(
      (await rig.harness.attemptAs(role, call)) ?? "",
      postgresHarnessDenial(ticketLandingsReadFunction),
      role,
    );
  const [door] = await rig.harness.query(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            p.provolatile AS volatility, p.proconfig::text AS settings,
            has_function_privilege('public', p.oid, 'EXECUTE') AS anyone
       FROM pg_proc p WHERE p.proname=$1`,
    [ticketLandingsReadFunction],
  );
  assert.deepEqual(door, {
    owner: boundaryOwnerRole,
    definer: true,
    volatility: "s",
    settings: '{"search_path=pg_catalog, public, pg_temp"}',
    anyone: false,
  });
});

test("the API is still denied the finalizer's rows, and the door's owner reads of a proposal what the door answers and not its text", async () => {
  for (const relation of [
    "finalization_change_proposal",
    "finalization_attempt",
    "commit_permit",
  ])
    assert.match(
      (await rig.harness.attemptAs(apiRole, `SELECT 1 FROM ${relation}`)) ?? "",
      postgresHarnessDenial(relation),
      relation,
    );
  assert.match(
    (await rig.harness.attemptAs(
      apiRole,
      "SELECT state FROM finalization_request",
    )) ?? "",
    postgresHarnessDenial("finalization_request"),
  );
  const [owner] = await rig.harness.query(
    `SELECT has_column_privilege($1,'finalization_change_proposal','head_ref','SELECT') AS head,
            has_column_privilege($1,'finalization_change_proposal','base_ref','SELECT') AS base,
            has_column_privilege($1,'finalization_change_proposal','merge_reason','SELECT') AS reason,
            has_column_privilege($1,'finalization_change_proposal','body','SELECT') AS body,
            has_table_privilege($1,'finalization_change_proposal','INSERT,UPDATE,DELETE') AS written`,
    [boundaryOwnerRole],
  );
  assert.deepEqual(owner, {
    head: true,
    base: true,
    reason: true,
    body: false,
    written: false,
  });
});
