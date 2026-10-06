/**
 * Where a ticket landed and what was reported of its repository's actions, as
 * the API reads them from a real server.
 *
 * EACH WAY A TICKET LANDS OR DOES NOT IS A FIXTURE OF ITS OWN. A project is
 * brought to finalization by real decisions, its permit is promoted as the
 * finalizer, and the row a change proposal leaves is written as the finalizer
 * under the relation's own constraints, so an arm is read from rows the
 * relation admits and never from ones a case made up beside it.
 *
 * THE READS ARE MADE AS THE API, through the store the route is composed over,
 * and whoever migrated is asked only what the API may not read: a permit, a
 * proposal, and what the catalog says of the door and the indexes.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresActionObservations } from "../../src/adapters/postgres/actionObservation.ts";
import { postgresTicketActionReach } from "../../src/adapters/postgres/actionReach.ts";
import { postgresProjectRepositoryRetirement } from "../../src/adapters/postgres/repositoryBinding.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  poolPlaneRole,
  repositoryActionImportFunction,
  schedulerRole,
  selectorControlRole,
  selectorReviewRole,
  selectorServiceRole,
  ticketLandedCommitReadFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  briefFinalizationModes,
  briefFinalizationProposes,
  type BriefFinalizationMode,
} from "../../src/contract/rosters.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  actionReachEarlierReadMax,
  type ActionReachObservation,
} from "../../src/interpreter/actionReach.ts";
import type {
  ActionReport,
  ActionReporterName,
} from "../../src/interpreter/actionReport.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { RepositoryActionId } from "../../src/interpreter/repositoryAction.ts";
import {
  asTicketLandedStamp,
  type ActionReachDeclared,
  type TicketActionReachStore,
  type TicketLanded,
} from "../../src/interpreter/ticketActionReach.ts";
import {
  finalizerBriefFinalizationTarget,
  finalizerBriefLandsNothing,
  finalizerCommit,
  finalizerDigest,
  finalizerGrantPermit,
  finalizerPrepare,
  finalizerProject,
  finalizerPromote,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  postgresHarnessDenial,
  postgresHarnessProject,
  postgresHarnessRolePool,
} from "./harness.ts";
import { fixtureBoundRepository } from "./repositoryBindingFixture.ts";

let rig: FinalizerRig;
let apiPool: pg.Pool;
let importerPool: pg.Pool;
let store: TicketActionReachStore;
before(async () => {
  rig = await finalizerRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  importerPool = postgresHarnessRolePool(configurationImporterRole);
  store = postgresTicketActionReach(apiPool);
});
after(async () => {
  await importerPool.end();
  await apiPool.end();
  await rig.close();
});

/** One project at finalization under a landing mode, a mode left out being a brief that names no landing at all, in a partition of its own where none is named. */
async function finalizing(
  label: string,
  mode?: BriefFinalizationMode,
  named?: Partition,
): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label, undefined, 0, named);
  if (mode === "None")
    await finalizerBriefLandsNothing(rig, project.partition, project.ticket);
  else if (mode !== undefined)
    await finalizerBriefFinalizationTarget(
      rig,
      project.partition,
      project.ticket,
      "refs/heads/main",
      mode,
    );
  return project;
}

/** A project with a permit promoted, the candidate it promoted and when it was granted, as whoever migrated reads them. */
interface Promoted {
  readonly project: FinalizerProject;
  readonly permit: string;
  readonly candidate: string;
  readonly grantedAt: string;
}

/** Promotes one more permit for a project's request. */
async function promotedAgain(
  project: FinalizerProject,
  label: string,
): Promise<Promoted> {
  const attempt = await finalizerPromote(rig, project, label);
  const [row] = await rig.harness.query(
    `SELECT p.permit, a.candidate_commit AS candidate, p.granted_at::text AS granted_at
       FROM finalization_attempt a
       JOIN commit_permit p
         ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  );
  assert.ok(row !== undefined, "the promotion left a permit");
  return {
    project,
    permit: String(row["permit"]),
    candidate: String(row["candidate"]),
    grantedAt: String(row["granted_at"]),
  };
}

async function promoted(
  label: string,
  mode?: BriefFinalizationMode,
  named?: Partition,
): Promise<Promoted> {
  return promotedAgain(await finalizing(label, mode, named), label);
}

function proposalKey(project: FinalizerProject): readonly string[] {
  return [project.partition.tenant, project.partition.project, project.request];
}

/**
 * Writes the row a change proposal leaves over a promoted permit, as the
 * finalizer writes it before it asks the forge for anything, and then each of
 * `results` as a statement of its own, as each answer is recorded. Answers when
 * the row was opened.
 */
async function proposed(
  from: Promoted,
  ...results: readonly (readonly [string, ...unknown[]])[]
): Promise<string> {
  const { project } = from;
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts)
     VALUES ($1,$2,$3,$4,$5,'refs/heads/chuggy/ticket',$6,'refs/heads/main',$7,
             'ticket: propose it','propose it',1)`,
    [
      ...proposalKey(project),
      from.permit,
      finalizerDigest(),
      from.candidate,
      finalizerCommit(),
    ],
  );
  for (const [assignments, ...values] of results)
    await rig.as(
      `UPDATE finalization_change_proposal SET ${assignments}
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [...proposalKey(project), ...values],
    );
  const [row] = await rig.harness.query(
    `SELECT opened_at::text AS opened_at FROM finalization_change_proposal
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    proposalKey(project),
  );
  assert.ok(row !== undefined);
  return String(row["opened_at"]);
}

/** What a forge said of a proposal, as its evidence is stored: its standing and, for one it merged, the commit the merge left. */
function evidence(status: string, mergeCommit?: string): string {
  return JSON.stringify({
    title: "ticket: propose it",
    body: "propose it",
    status,
    ...(mergeCommit === undefined ? {} : { mergeCommit }),
  });
}

/** The create answered, with what the forge said of the proposal it made or found. */
const created = (kind: string, said: string) =>
  ["creation=$4, creation_evidence=$5::jsonb", kind, said] as const;

/** A reading taken of a create nobody heard back from. */
const reconciled = (kind: string, said: string, contradiction?: string) =>
  [
    "reconciliation=$4, reconciliation_evidence=$5::jsonb, reconciliation_contradiction=$6, reconciliations=reconciliations+1",
    kind,
    said,
    contradiction ?? null,
  ] as const;

function landed(project: FinalizerProject): Promise<TicketLanded | undefined> {
  return store.landed(project.partition, asTicketId(project.ticket));
}

/** Holds that a ticket landed at one commit of its project's repository, since one instant the server names. */
async function landedAt(
  project: FinalizerProject,
  commit: string,
  since: string,
): Promise<void> {
  const found = await landed(project);
  assert.ok(found !== undefined && found.landed === "At", "the ticket landed");
  assert.deepEqual(
    {
      repository: found.repository,
      retired: found.retired,
      commit: found.commit,
    },
    {
      repository: {
        partition: project.partition,
        repository: project.repository,
        recoveryEpoch: project.epoch,
      },
      retired: false,
      commit,
    },
  );
  const [same] = await rig.harness.query(
    `SELECT $1::timestamptz = $2::timestamptz AS same`,
    [found.since, since],
  );
  assert.equal(same?.["same"], true, `${found.since} is ${since}`);
}

test("a ticket the project does not have is answered nothing, and one nothing was promoted for landed nowhere", async () => {
  const project = await finalizing("unpromoted", "Push");
  assert.equal(
    await store.landed(project.partition, asTicketId(project.ticket + 1000)),
    undefined,
  );
  assert.deepEqual(await landed(project), { landed: "Nowhere" });

  const attempt = await finalizerPrepare(rig, project, "unpromoted");
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "unpromoted",
  );
  assert.deepEqual(await landed(project), { landed: "Nowhere" });
  const candidate = finalizerCommit();
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
  assert.deepEqual(await landed(project), { landed: "Nowhere" });
});

test("a promoted permit with no proposal over it landed at its candidate unless the ticket's landing proposes, since the permit was granted", async () => {
  for (const mode of [undefined, ...briefFinalizationModes]) {
    const from = await promoted(
      `bare-${mode ?? "unnamed"}`.toLowerCase(),
      mode,
    );
    if (briefFinalizationProposes(mode))
      assert.deepEqual(
        await landed(from.project),
        { landed: "Nowhere" },
        mode ?? "unnamed",
      );
    else await landedAt(from.project, from.candidate, from.grantedAt);
  }
});

test("a proposal this server merged landed at the commit the merge left, since the proposal was opened", async () => {
  const from = await promoted("merged", "PullRequestMerge");
  const merge = finalizerCommit();
  const opened = await proposed(from, created("Created", evidence("Open")), [
    "merge_attempts=1, merge='Merged', merge_commit=$4",
    merge,
  ]);
  assert.notEqual(merge, from.candidate);
  await landedAt(from.project, merge, opened);
  assert.notEqual(opened, from.grantedAt);
});

test("a merge nobody heard back from, read afterwards as made, landed at the commit that reading holds", async () => {
  const from = await promoted("mergeread", "PullRequestMerge");
  const merge = finalizerCommit();
  const opened = await proposed(from, created("Created", evidence("Open")), [
    "merge_attempts=1, merge_reading='Accepted', merge_reading_evidence=$4::jsonb, merge_readings=1",
    evidence("Merged", merge),
  ]);
  await landedAt(from.project, merge, opened);
});

test("a proposal found already merged when it was created landed at that merge where the landing merges, and nowhere where it only proposes", async () => {
  for (const kind of ["AlreadyExists", "Created"]) {
    const merging = await promoted(
      `found-${kind}`.toLowerCase(),
      "PullRequestMerge",
    );
    const merge = finalizerCommit();
    const opened = await proposed(
      merging,
      created(kind, evidence("Merged", merge)),
    );
    await landedAt(merging.project, merge, opened);

    const proposing = await promoted(
      `left-${kind}`.toLowerCase(),
      "PullRequest",
    );
    await proposed(
      proposing,
      created(kind, evidence("Merged", finalizerCommit())),
    );
    assert.deepEqual(await landed(proposing.project), { landed: "Nowhere" });
  }
});

test("a create nobody heard back from, read afterwards as a proposal already merged and accepted, landed at that merge", async () => {
  const from = await promoted("reconciled", "PullRequestMerge");
  const merge = finalizerCommit();
  const opened = await proposed(
    from,
    reconciled("Accepted", evidence("Merged", merge)),
  );
  await landedAt(from.project, merge, opened);
});

test("a proposal merged by somebody else, which this server reads as a contradiction, landed nowhere whichever way the ticket lands", async () => {
  for (const mode of ["PullRequest", "PullRequestMerge"] as const) {
    const read = await promoted(`contradicted-${mode}`.toLowerCase(), mode);
    await proposed(
      read,
      reconciled(
        "Contradictory",
        evidence("Merged", finalizerCommit()),
        "Merged",
      ),
    );
    assert.deepEqual(await landed(read.project), { landed: "Nowhere" }, mode);

    const answered = await promoted(`refuted-${mode}`.toLowerCase(), mode);
    await proposed(answered, [
      "creation='Contradictory', creation_contradiction='Merged', creation_evidence=$4::jsonb",
      evidence("Merged", finalizerCommit()),
    ]);
    assert.deepEqual(
      await landed(answered.project),
      { landed: "Nowhere" },
      mode,
    );
  }
});

test("a proposal still open, or one nothing was heard of yet, landed nowhere whichever way the ticket lands, whatever commit its forge already names for a merge", async () => {
  for (const mode of ["PullRequest", "PullRequestMerge"] as const) {
    const open = await promoted(`open-${mode}`.toLowerCase(), mode);
    await proposed(
      open,
      created("Created", evidence("Open", finalizerCommit())),
    );
    assert.deepEqual(await landed(open.project), { landed: "Nowhere" }, mode);

    const accepted = await promoted(`accepted-${mode}`.toLowerCase(), mode);
    await proposed(
      accepted,
      reconciled("Accepted", evidence("Open", finalizerCommit())),
    );
    assert.deepEqual(await landed(accepted.project), { landed: "Nowhere" });

    const unheard = await promoted(`unheard-${mode}`.toLowerCase(), mode);
    await proposed(unheard);
    assert.deepEqual(await landed(unheard.project), { landed: "Nowhere" });
  }
});

test("a merge that was refused, or read as not made or as not this ticket's, landed nowhere", async () => {
  const refused = await promoted("notmergeable", "PullRequestMerge");
  await proposed(refused, created("Created", evidence("Open")), [
    "merge_attempts=1, merge='NotMergeable', merge_reason='Conflict'",
  ]);
  assert.deepEqual(await landed(refused.project), { landed: "Nowhere" });

  const unmerged = await promoted("unmerged", "PullRequestMerge");
  await proposed(unmerged, created("Created", evidence("Open")), [
    "merge_attempts=1, merge_reading='Unmerged', merge_reading_evidence=$4::jsonb, merge_readings=1",
    evidence("Open", finalizerCommit()),
  ]);
  assert.deepEqual(await landed(unmerged.project), { landed: "Nowhere" });

  const mismatched = await promoted("mismatched", "PullRequestMerge");
  await proposed(mismatched, created("Created", evidence("Open")), [
    "merge_attempts=1, merge_reading='Contradictory', merge_reading_contradiction='HeadMismatch', merge_reading_evidence=$4::jsonb, merge_readings=1",
    evidence("Merged", finalizerCommit()),
  ]);
  assert.deepEqual(await landed(mismatched.project), { landed: "Nowhere" });
});

test("evidence of a merge that names no commit git addresses landed nowhere rather than at something read out of it", async () => {
  for (const [label, said] of [
    ["none", evidence("Merged")],
    ["short", evidence("Merged", "abc123")],
    ["words", evidence("Merged", "refs/heads/main")],
    ["wide", evidence("Merged", "a".repeat(41))],
  ] as const) {
    const from = await promoted(`unaddressed-${label}`, "PullRequestMerge");
    await proposed(from, created("Created", evidence("Open")), [
      "merge_attempts=1, merge_reading='Accepted', merge_reading_evidence=$4::jsonb, merge_readings=1",
      said,
    ]);
    assert.deepEqual(await landed(from.project), { landed: "Nowhere" }, label);
  }
});

test("a merge commit of either width git addresses is where the ticket landed", async () => {
  const from = await promoted("widemerge", "PullRequestMerge");
  const merge = "d".repeat(64);
  const opened = await proposed(from, created("Created", evidence("Open")), [
    "merge_attempts=1, merge='Merged', merge_commit=$4",
    merge,
  ]);
  await landedAt(from.project, merge, opened);
});

test("each ticket landed where its own rows say, whatever another ticket's or another project's say", async () => {
  const pushed = await promoted("apart-pushed", "Push");
  const merging = await promoted("apart-merged", "PullRequestMerge");
  const merge = finalizerCommit();
  const opened = await proposed(merging, created("Created", evidence("Open")), [
    "merge_attempts=1, merge='Merged', merge_commit=$4",
    merge,
  ]);
  const waiting = await finalizing("apart-waiting", "Push");
  await landedAt(pushed.project, pushed.candidate, pushed.grantedAt);
  await landedAt(merging.project, merge, opened);
  assert.deepEqual(await landed(waiting), { landed: "Nowhere" });

  const { partition, ticket } = pushed.project;
  await rig.harness.query(
    `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
     VALUES($1,$2,$3,'Pending',1)`,
    [partition.tenant, partition.project, ticket + 1],
  );
  assert.deepEqual(await store.landed(partition, asTicketId(ticket + 1)), {
    landed: "Nowhere",
  });
  assert.equal(
    await store.landed(partition, asTicketId(ticket + 1000)),
    undefined,
  );
});

test("a ticket landed where its own project's rows say, whatever a project of its tenant or of its name landed since", async () => {
  const own = await promoted("partitioned", "Push");
  const { tenant, project } = own.project.partition;
  const besides = [
    await promoted("partitioned-tenant", "Push", {
      tenant,
      project: asProjectId(`project-partitioned-${randomUUID()}`),
    }),
    await promoted("partitioned-project", "Push", {
      tenant: asTenantId(`tenant-partitioned-${randomUUID()}`),
      project,
    }),
  ];
  for (const beside of besides) {
    assert.equal(beside.project.ticket, own.project.ticket);
    assert.equal(beside.project.authorizingSeq, own.project.authorizingSeq);
    await landedAt(beside.project, beside.candidate, beside.grantedAt);
  }
  await landedAt(own.project, own.candidate, own.grantedAt);
});

test("a ticket's landing is read from its own definition, whatever the ticket beside it names", async () => {
  const held = await promoted("defined", "PullRequestMerge");
  const { partition, ticket } = held.project;
  await rig.harness.query(
    `INSERT INTO ticket_definition(tenant,project,ticket,definition,digest,brief)
     SELECT tenant,project,ticket+1,
            jsonb_set(definition,'{finalization}',$4::jsonb),digest,brief
       FROM ticket_definition WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [
      partition.tenant,
      partition.project,
      ticket,
      { mode: "Push", target: "refs/heads/main" },
    ],
  );
  assert.deepEqual(await landed(held.project), { landed: "Nowhere" });
});

test("a ticket landed in a repository since retired says so, still names its commit, and is answered once whatever else its project binds", async () => {
  const from = await promoted("retired", "Push");
  const { partition, ticket, repository, epoch } = from.project;
  const retired = await postgresProjectRepositoryRetirement(apiPool).retire({
    partition,
    repository: asRepositoryId(repository),
  });
  assert.equal(retired.outcome, "Retired");
  await rig.harness.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch,landing_mode)
     VALUES($1,$2,$3,$4,'Push')`,
    [partition.tenant, partition.project, `repository-${randomUUID()}`, epoch],
  );
  const found = await landed(from.project);
  assert.ok(found !== undefined && found.landed === "At");
  assert.equal(found.retired, true);
  assert.equal(found.commit, from.candidate);
  const answered = await apiPool.query(
    `SELECT repository, retired FROM ${ticketLandedCommitReadFunction}($1,$2,$3)`,
    [partition.tenant, partition.project, ticket],
  );
  assert.deepEqual(answered.rows, [{ repository, retired: true }]);
});

/**
 * An earlier request for a project's ticket, as a ticket sent back to work and
 * finalized again has behind it. It is copied from the one that stands by
 * whoever migrated, concluded and a step earlier in the journal's order,
 * because bringing a ticket round again by decisions is another suite's work.
 */
async function requestedEarlier(
  project: FinalizerProject,
): Promise<FinalizerProject> {
  const authorizingSeq = project.authorizingSeq - 1;
  const request = `${String(authorizingSeq)}:0:FinalizeTicket`;
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,state,kind,work_cycle,
        finalization_generation)
     SELECT tenant,project,$4,$5,effect_position,ticket,$5,request_generation,
            'Fulfilled',kind,work_cycle,finalization_generation
       FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [...proposalKey(project), request, authorizingSeq],
  );
  return { ...project, request, authorizingSeq };
}

test("a ticket finalized again landed where its newest request's permit says, whatever an earlier one came to and whenever that one's permit was granted", async () => {
  const merged = ["merge_attempts=1, merge='Merged', merge_commit=$4"] as const;
  const newest = await promoted("again", "PullRequestMerge");
  const merge = finalizerCommit();
  const opened = await proposed(newest, created("Created", evidence("Open")), [
    ...merged,
    merge,
  ]);
  const earlier = await promotedAgain(
    await requestedEarlier(newest.project),
    "again-earlier",
  );
  await proposed(
    earlier,
    reconciled("Contradictory", evidence("Closed"), "Closed"),
  );
  await landedAt(newest.project, merge, opened);

  const open = await promoted("again-open", "PullRequestMerge");
  await proposed(open, created("Created", evidence("Open")));
  const before = await promotedAgain(
    await requestedEarlier(open.project),
    "again-before",
  );
  await proposed(before, created("Created", evidence("Open")), [
    ...merged,
    finalizerCommit(),
  ]);
  assert.deepEqual(
    await landed(open.project),
    { landed: "Nowhere" },
    "the merge an earlier request left is not where its newest landed",
  );
});

test("of two permits promoted for one request, the one granted later is where the ticket landed", async () => {
  const first = await promoted("twice", "Push");
  const second = await promotedAgain(first.project, "twice-second");
  assert.notEqual(second.candidate, first.candidate);
  await landedAt(first.project, second.candidate, second.grantedAt);
});

const reporter = "rig-build" as ActionReporterName;
const commitA = asGitObjectId("a".repeat(40));
const commitB = asGitObjectId("b".repeat(40));
const commitWide = asGitObjectId("c".repeat(64));

/** Declares actions for one bound repository as the importer, each under the name beside it. */
async function declares(
  partition: Partition,
  repository: string,
  actions: Readonly<Record<string, string>>,
): Promise<void> {
  const [bound] = await rig.harness.query(
    `SELECT recovery_epoch FROM project_repository
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    [partition.tenant, partition.project, repository],
  );
  const imported = await importerPool.query<{ imported: string }>(
    `SELECT ${repositoryActionImportFunction}($1,$2,$3,$4,$5,$6::text[],$7::text[]) AS imported`,
    [
      partition.tenant,
      partition.project,
      repository,
      bound?.["recovery_epoch"],
      commitA,
      Object.keys(actions),
      Object.values(actions),
    ],
  );
  assert.equal(imported.rows[0]?.imported, "Imported");
}

/** One project with one repository, bound through the API's door, declaring the actions given; a partition named is created as it is named. */
async function declaring(
  label: string,
  actions: Readonly<Record<string, string>>,
  named?: Partition,
): Promise<{ partition: Partition; repository: string }> {
  const partition =
    named ?? (await postgresHarnessProject(rig.harness.store, label));
  if (named !== undefined) await rig.harness.store.createProject(named);
  const repository = await fixtureBoundRepository(
    rig.harness,
    apiPool,
    partition,
    label,
  );
  await declares(partition, repository, actions);
  return { partition, repository };
}

/** Three more projects declaring `build`: one sharing nothing with `partition`, one in its tenant, and one of its project's name in another tenant. */
async function declaringBeside(
  { tenant, project }: Partition,
  label: string,
): Promise<readonly { partition: Partition; repository: string }[]> {
  const build = { build: "Build other" };
  return [
    await declaring(`${label}-other`, build),
    await declaring(`${label}-tenant`, build, {
      tenant,
      project: asProjectId(`project-${label}-${randomUUID()}`),
    }),
    await declaring(`${label}-project`, build, {
      tenant: asTenantId(`tenant-${label}-${randomUUID()}`),
      project,
    }),
  ];
}

/** Records one report through the API's own store, which is the only way a row is written. */
async function reports(
  partition: Partition,
  action: string,
  report: ActionReport,
): Promise<void> {
  assert.equal(
    await postgresActionObservations(apiPool).record({
      partition,
      action: action as RepositoryActionId,
      reporter,
      report,
    }),
    "Recorded",
  );
}

const succeeded = (commit = commitA): ActionReport => ({
  commit,
  outcome: "Succeeded",
});
const failed = (commit = commitA): ActionReport => ({
  commit,
  outcome: "Failed",
});

function declaredOf(where: {
  partition: Partition;
  repository: string;
}): Promise<readonly ActionReachDeclared[]> {
  return store.declared(where.partition, asRepositoryId(where.repository));
}

/** What a read answered of each action, by identity: the ordinal and commit of its newest success and of its newest report. */
function newestOf(
  declared: readonly ActionReachDeclared[],
): Readonly<Record<string, unknown>> {
  const said = (observation: ActionReachObservation | undefined) =>
    observation === undefined
      ? undefined
      : `${String(observation.ordinal)} ${observation.outcome} ${observation.commit}`;
  return Object.fromEntries(
    declared.map((each) => [
      each.action,
      { success: said(each.newest.success), report: said(each.newest.report) },
    ]),
  );
}

const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

test("what a repository declares is answered in the order of its identities, each with its name and the newest of what was reported", async () => {
  const where = await declaring("declared", {
    publish: "Publish it",
    build: "Build it",
    idle: "Idle",
    deploy: "Deploy it",
  });
  await reports(where.partition, "build", succeeded());
  await reports(where.partition, "build", succeeded(commitB));
  await reports(where.partition, "build", failed(commitWide));
  await reports(where.partition, "build", failed(commitA));
  await reports(where.partition, "deploy", failed());
  await reports(where.partition, "deploy", failed(commitB));
  await reports(where.partition, "publish", failed());
  await reports(where.partition, "publish", succeeded(commitB));

  const declared = await declaredOf(where);
  assert.deepEqual(
    declared.map((each) => [each.action, each.name]),
    [
      ["build", "Build it"],
      ["deploy", "Deploy it"],
      ["idle", "Idle"],
      ["publish", "Publish it"],
    ],
  );
  assert.deepEqual(newestOf(declared), {
    build: {
      success: `2 Succeeded ${commitB}`,
      report: `4 Failed ${commitA}`,
    },
    deploy: { success: undefined, report: `2 Failed ${commitB}` },
    idle: { success: undefined, report: undefined },
    publish: {
      success: `2 Succeeded ${commitB}`,
      report: `2 Succeeded ${commitB}`,
    },
  });
});

test("a report is answered as it was taken, with what its reporter gave and nothing of who reported", async () => {
  const where = await declaring("taken", { build: "Build it" });
  await reports(where.partition, "build", {
    commit: commitWide,
    outcome: "Succeeded",
    observedAtMs: Date.parse("2026-10-05T22:45:50.250Z"),
    detail: "run chuggy-release-x7k2p",
    link: "https://grafana.example.test/d/release?var-run=x7k2p",
  });
  await reports(where.partition, "build", failed());
  const [build] = await declaredOf(where);
  const { success, report } = build?.newest ?? {};
  assert.ok(success !== undefined && report !== undefined);
  assert.match(success.receivedAt, instant);
  assert.match(report.receivedAt, instant);
  const [received] = await rig.harness.query(
    `SELECT received_at = $4::timestamptz AS same FROM action_observation
      WHERE tenant=$1 AND project=$2 AND action=$3 AND ordinal=1`,
    [
      where.partition.tenant,
      where.partition.project,
      "build",
      success.receivedAt,
    ],
  );
  assert.equal(received?.["same"], true, "the instant answered is the row's");
  assert.deepEqual(success, {
    ordinal: 1,
    outcome: "Succeeded",
    commit: commitWide,
    observedAt: "2026-10-05T22:45:50.250000Z",
    receivedAt: success.receivedAt,
    detail: "run chuggy-release-x7k2p",
    link: "https://grafana.example.test/d/release?var-run=x7k2p",
  });
  assert.deepEqual(report, {
    ordinal: 2,
    outcome: "Failed",
    commit: commitA,
    receivedAt: report.receivedAt,
  });
});

test("only the actions of the repository asked about are answered, and only what was reported of them in its own project of its own tenant", async () => {
  const one = await declaring("own-one", { build: "Build one" });
  const others = await declaringBeside(one.partition, "own");
  const beside = await fixtureBoundRepository(
    rig.harness,
    apiPool,
    one.partition,
    "own-beside",
  );
  await declares(one.partition, beside, { lint: "Lint" });
  await reports(one.partition, "build", succeeded());
  await reports(one.partition, "lint", succeeded(commitB));
  for (const other of others) {
    await reports(other.partition, "build", failed(commitB));
    await reports(other.partition, "build", failed(commitWide));
  }

  assert.deepEqual(newestOf(await declaredOf(one)), {
    build: {
      success: `1 Succeeded ${commitA}`,
      report: `1 Succeeded ${commitA}`,
    },
  });
  assert.deepEqual(newestOf(await declaredOf({ ...one, repository: beside })), {
    lint: {
      success: `1 Succeeded ${commitB}`,
      report: `1 Succeeded ${commitB}`,
    },
  });
  for (const other of others) {
    assert.deepEqual(newestOf(await declaredOf(other)), {
      build: { success: undefined, report: `2 Failed ${commitWide}` },
    });
    assert.deepEqual(
      await declaredOf({ ...other, repository: one.repository }),
      [],
    );
    assert.deepEqual(
      await declaredOf({ ...one, repository: other.repository }),
      [],
    );
  }
});

test("the newest report is the one weighed last and not the one whose stamp is latest", async () => {
  const where = await declaring("weighed", { build: "Build it" });
  const early = await apiPool.connect();
  try {
    await early.query("BEGIN");
    await early.query("SELECT now()");
    await reports(where.partition, "build", succeeded());
    await early.query(
      `SELECT record_action_observation($1,$2,'build',$3,'Failed',NULL,$4,NULL,NULL)`,
      [where.partition.tenant, where.partition.project, commitB, reporter],
    );
    await early.query("COMMIT");
  } finally {
    early.release();
  }
  const [build] = await declaredOf(where);
  const { success, report } = build?.newest ?? {};
  assert.ok(success !== undefined && report !== undefined);
  assert.deepEqual(
    [success.ordinal, report.ordinal, report.commit],
    [1, 2, commitB],
  );
  assert.ok(
    report.receivedAt < success.receivedAt,
    "the report weighed last began before the one weighed first",
  );
});

/** The server's own reading of now, as the text a ticket's landing is stamped with. */
async function stampedNow(): Promise<string> {
  const [row] = await rig.harness.query(
    "SELECT clock_timestamp()::text AS now",
    [],
  );
  return String(row?.["now"]);
}

/** The successes one read answered, each as its ordinal and whether it was reported since the stamp. */
async function earlierOf(
  partition: Partition,
  action: string,
  beneath: number,
  since: string,
  count = actionReachEarlierReadMax,
): Promise<readonly (readonly [number, boolean])[]> {
  const found = await store.earlier({
    partition,
    action: action as RepositoryActionId,
    beneath,
    count,
    since: asTicketLandedStamp(since),
  });
  for (const each of found) assert.equal(each.observation.outcome, "Succeeded");
  return found.map((each) => [each.observation.ordinal, each.sinceLanded]);
}

test("the successes beneath an ordinal are answered newest first, as many as asked for, each told from the stamp whether it came since", async () => {
  const where = await declaring("beneath", {
    build: "Build it",
    deploy: "Deploy it",
  });
  const others = await declaringBeside(where.partition, "beneath");
  const before = await stampedNow();
  await reports(where.partition, "build", succeeded());
  await reports(where.partition, "build", failed(commitB));
  await reports(where.partition, "build", succeeded(commitB));
  const between = await stampedNow();
  await reports(where.partition, "build", succeeded(commitWide));
  await reports(where.partition, "build", failed(commitA));
  await reports(where.partition, "build", succeeded(commitA));
  await reports(where.partition, "deploy", succeeded());
  for (const other of others) {
    await reports(other.partition, "build", succeeded());
    await reports(other.partition, "build", succeeded(commitB));
  }
  const after = await stampedNow();
  const { partition } = where;

  assert.deepEqual(await earlierOf(partition, "build", 6, before), [
    [4, true],
    [3, true],
    [1, true],
  ]);
  assert.deepEqual(await earlierOf(partition, "build", 6, between), [
    [4, true],
    [3, false],
    [1, false],
  ]);
  assert.deepEqual(await earlierOf(partition, "build", 6, after), [
    [4, false],
    [3, false],
    [1, false],
  ]);
  assert.deepEqual(await earlierOf(partition, "build", 6, before, 2), [
    [4, true],
    [3, true],
  ]);
  assert.deepEqual(await earlierOf(partition, "build", 4, before), [
    [3, true],
    [1, true],
  ]);
  assert.deepEqual(await earlierOf(partition, "build", 1, before), []);
  assert.deepEqual(await earlierOf(partition, "deploy", 1, before), []);
  for (const other of others)
    assert.deepEqual(await earlierOf(other.partition, "build", 2, before), [
      [1, true],
    ]);
});

test("a success whose stamp is the ticket's own did not come since it", async () => {
  const where = await declaring("exact", { build: "Build it" });
  await reports(where.partition, "build", succeeded());
  await reports(where.partition, "build", succeeded(commitB));
  const [row] = await rig.harness.query(
    `SELECT received_at::text AS at FROM action_observation
      WHERE tenant=$1 AND project=$2 AND action='build' AND ordinal=1`,
    [where.partition.tenant, where.partition.project],
  );
  assert.deepEqual(
    await earlierOf(where.partition, "build", 2, String(row?.["at"])),
    [[1, false]],
  );
});

test("when a ticket landed goes back to the server as it came out, and tells the reports before it from those since", async () => {
  const project = await finalizing("stamped", "Push");
  await declares(project.partition, project.repository, { build: "Build it" });
  await reports(project.partition, "build", succeeded());
  const from = await promotedAgain(project, "stamped");
  await reports(project.partition, "build", succeeded(commitB));
  await reports(project.partition, "build", succeeded(commitWide));
  const found = await landed(project);
  assert.ok(found !== undefined && found.landed === "At");
  assert.equal(found.commit, from.candidate);
  assert.deepEqual(
    await earlierOf(project.partition, "build", 3, found.since),
    [
      [2, true],
      [1, false],
    ],
  );
});

const bystanders = [
  configurationImporterRole,
  ticketServiceRole,
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
  schedulerRole,
  workerPlaneRole,
  poolPlaneRole,
];

test("where a ticket landed is read through a door only the API may call, which runs as the boundary owner under a path of its own", async () => {
  const call = `SELECT * FROM ${ticketLandedCommitReadFunction}('tenant','project',1)`;
  assert.equal(await rig.harness.attemptAs(apiRole, call), undefined);
  for (const role of [...bystanders, finalizerRole])
    assert.match(
      (await rig.harness.attemptAs(role, call)) ?? "",
      postgresHarnessDenial(ticketLandedCommitReadFunction),
      role,
    );
  const [door] = await rig.harness.query(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            p.provolatile AS volatility, p.proconfig::text AS settings,
            has_function_privilege('public', p.oid, 'EXECUTE') AS anyone
       FROM pg_proc p WHERE p.proname=$1`,
    [ticketLandedCommitReadFunction],
  );
  assert.deepEqual(door, {
    owner: boundaryOwnerRole,
    definer: true,
    volatility: "s",
    settings: '{"search_path=pg_catalog, public, pg_temp"}',
    anyone: false,
  });
});

test("the API reads none of the finalizer's rows itself, and the door's owner reads of a proposal only what the door does", async () => {
  for (const relation of [
    "finalization_change_proposal",
    "finalization_attempt",
    "commit_permit",
    "finalization_reconciliation",
  ])
    assert.match(
      (await rig.harness.attemptAs(apiRole, `SELECT 1 FROM ${relation}`)) ?? "",
      postgresHarnessDenial(relation),
      relation,
    );
  const [owner] = await rig.harness.query(
    `SELECT has_column_privilege($1,'finalization_change_proposal','merge_commit','SELECT') AS read,
            has_column_privilege($1,'finalization_change_proposal','body','SELECT') AS body,
            has_table_privilege($1,'finalization_change_proposal','INSERT,UPDATE,DELETE') AS written`,
    [boundaryOwnerRole],
  );
  assert.deepEqual(owner, { read: true, body: false, written: false });
});

test("a ticket's attempts and an action's successes each have an index of their own", async () => {
  const found = await rig.harness.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname = ANY($1::text[]) ORDER BY indexname`,
    [["action_observation_newest_success", "finalization_attempt_by_ticket"]],
  );
  assert.deepEqual(found, [
    {
      indexname: "action_observation_newest_success",
      indexdef:
        "CREATE INDEX action_observation_newest_success ON public.action_observation USING btree (tenant, project, action, ordinal DESC) WHERE (outcome = 'Succeeded'::text)",
    },
    {
      indexname: "finalization_attempt_by_ticket",
      indexdef:
        "CREATE INDEX finalization_attempt_by_ticket ON public.finalization_attempt USING btree (tenant, project, ticket)",
    },
  ]);
});
