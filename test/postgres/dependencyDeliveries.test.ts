/**
 * What a ticket's dependencies delivered, pinned by a real dispatch and read
 * back by the scheduler's own role for every briefing of the dependent.
 *
 * EACH DEPENDENCY IS DONE BY REAL DECISIONS. Its work and evaluation pass, its
 * landing concludes through the finalizer's door, and its passing work result
 * is written beside the reference the journal accepted, as the scheduler
 * would have written it. The dependent is released and dispatched through the
 * writer, which reads its dependencies' rows as the ticket service; the one
 * remote question a dispatch asks is answered by the case.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresDependencyPins,
  postgresDependencyResults,
} from "../../src/adapters/postgres/dependencyDeliveries.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  accountIdentityFunction,
  schedulerRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import { postgresTicketLandings } from "../../src/adapters/postgres/ticketLandings.ts";
import type { BriefFinalizationMode } from "../../src/contract/rosters.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { ledgerAt } from "../../src/domain/ledger.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { artifactOf } from "../../src/domain/ticket.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type {
  CommitAncestry,
  CommitAncestryQuestion,
} from "../../src/interpreter/commitAncestry.ts";
import {
  dependencyDeliveriesRead,
  dependencyPinning,
  type DependencyDelivery,
} from "../../src/interpreter/dependencyDelivery.ts";
import {
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import type { Submission } from "../../src/interpreter/operationInbox.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
  type ProjectTicketWriter,
} from "../../src/interpreter/projectWriter.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { digestFoldPrefix } from "../../src/interpreter/resultManifest.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  finalizerAccept,
  finalizerBriefBranch,
  finalizerBriefFinalizationTarget,
  finalizerClaim,
  finalizerCommit,
  finalizerDeclareSource,
  finalizerDigest,
  finalizerDrain,
  finalizerIdentity,
  finalizerPassedWork,
  finalizerProject,
  finalizerPromote,
  finalizerRigOpen,
  finalizerSpawnTasks,
  finalizerTaskDone,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  postgresHarnessBrief,
  postgresHarnessObservedCommit,
  postgresHarnessReleaseSubmission,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  postgresHarnessWriter,
} from "./harness.ts";

let rig: FinalizerRig;
let schedulerPool: pg.Pool;
before(async () => {
  rig = await finalizerRigOpen();
  schedulerPool = postgresHarnessRolePool(schedulerRole);
});
after(async () => {
  await schedulerPool.end();
  await rig.close();
});

/** The writer every decision here is made by: the harness's, with the dispatch's one remote question answered by `answer` and recorded. */
function dependencyWriter(
  asked: CommitAncestryQuestion[],
  answer: (question: CommitAncestryQuestion) => CommitAncestry,
): ProjectTicketWriter {
  const pool = rig.harness.writerPool;
  return {
    ...postgresHarnessWriter(rig.harness),
    dependencyPinning: dependencyPinning({
      results: postgresDependencyResults(pool),
      landings: postgresTicketLandings(pool),
      bindings: postgresProjectRepositoryBinding(pool),
      ancestry: {
        ancestry: (question) => {
          asked.push(question);
          return Promise.resolve(answer(question));
        },
      },
    }),
  };
}

/** Accepts one submission and decides everything it enqueues through `writer`, refusing a decision that did not commit. */
async function decided(
  writer: ProjectTicketWriter,
  partition: Partition,
  memory: ProjectMemory,
  label: string,
  command: Submission["command"],
): Promise<ProjectMemory> {
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(partition, label),
    command,
  });
  assert.equal(accepted.accepted, "Accepted");
  let carried = memory;
  for (;;) {
    const input = await rig.harness.discovery.next(partition, 300);
    if (input === undefined) return carried;
    const step = await projectWriterDecide(writer, carried, input);
    assert.equal(
      step.decided.decided,
      "Committed",
      JSON.stringify(step.decided),
    );
    carried = step.memory;
  }
}

/** Releases a ticket drawing on `deps` and dispatches it through `writer`, answering the ticket and the memory after. */
async function dispatched(
  writer: ProjectTicketWriter,
  project: FinalizerProject,
  memory: ProjectMemory,
  label: string,
  deps: readonly number[],
): Promise<{ ticket: number; memory: ProjectMemory }> {
  const release = await postgresHarnessReleaseSubmission(
    rig.harness,
    project.partition,
    label,
    { ...plainAuthoring, deps: new Set(deps) },
  );
  if (release.command.command !== "ReleaseDraft")
    assert.fail("that submission releases no draft");
  const ticket = release.command.ticket;
  const released = await decided(
    writer,
    project.partition,
    memory,
    `${label}-release`,
    release.command,
  );
  const version = released.ticketVersions.get(ticket);
  assert.ok(version !== undefined);
  return {
    ticket,
    memory: await decided(
      writer,
      project.partition,
      released,
      `${label}-dispatch`,
      {
        version: 1,
        command: "ManualDispatch",
        ticket: asTicketId(ticket),
        expectedTicketVersion: version,
      },
    ),
  };
}

/** Accepts one task's completion and decides it, answering the memory after. */
async function completed(
  project: FinalizerProject,
  memory: ProjectMemory,
  label: string,
  task: Parameters<typeof finalizerTaskDone>[1],
): Promise<ProjectMemory> {
  assert.equal(
    await finalizerAccept(
      rig.harness,
      project.partition,
      label,
      finalizerTaskDone(memory.graph, task),
    ),
    "Accepted",
  );
  const drained = await finalizerDrain(rig.harness, project.partition, memory);
  assert.ok(drained.decided.every((each) => each === "Committed"));
  return drained.memory;
}

const pullRequest = "https://forge.example/acme/atlas/pull/9";
const headRef = "refs/heads/chuggy/ticket";

/** What a forge said of a proposal, as its evidence is stored. */
function forgeSaid(status: string): string {
  return JSON.stringify({
    title: "ticket: land it",
    body: "land it",
    status,
    url: pullRequest,
  });
}

/** How one dependency's landing went: merged at a commit, or a pull request left open. */
type Landed =
  | { readonly landed: "Merged"; readonly merge: string }
  | { readonly landed: "Proposed" };

/**
 * Opens the pull request a promoted attempt's landing proposes, merged at
 * `how`'s commit where it says so, as the finalizer records it. It answers the
 * head the pull request is from.
 */
async function proposed(
  at: FinalizerProject,
  attempt: string,
  how: Landed,
): Promise<string> {
  const [row] = await rig.harness.query(
    `SELECT p.permit, a.candidate_commit FROM finalization_attempt a
       JOIN commit_permit p
         ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [at.partition.tenant, at.partition.project, attempt],
  );
  const head = String(row?.["candidate_commit"]);
  const key = [at.partition.tenant, at.partition.project, at.request];
  await rig.as(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'refs/heads/main',$8,'ticket: land it','land it',1)`,
    [
      ...key,
      String(row?.["permit"]),
      finalizerDigest(),
      headRef,
      head,
      finalizerCommit(),
    ],
  );
  await rig.as(
    `UPDATE finalization_change_proposal
        SET creation='Created', creation_evidence=$4::jsonb
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [...key, forgeSaid("Open")],
  );
  if (how.landed === "Merged")
    await rig.as(
      `UPDATE finalization_change_proposal
          SET merge_attempts=1, merge='Merged', merge_commit=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [...key, how.merge],
    );
  return head;
}

/**
 * Writes the passing work result a done ticket's journal accepted, at `head`
 * and with the report `report` names, as the scheduler would have written it.
 */
async function acceptedWork(
  at: FinalizerProject,
  memory: ProjectMemory,
  label: string,
  head: string,
  report?: string,
): Promise<void> {
  const ticket = ticketAt(memory.graph, asTicketId(at.ticket));
  assert.equal(ticket.state, "Done");
  const mark = artifactOf(ticket, ledgerAt(memory.ledgers, at.ticket));
  assert.ok(mark !== "NoArtifact");
  const work = await finalizerPassedWork(
    rig,
    at,
    label,
    [],
    `${digestFoldPrefix(mark.value)}${finalizerDigest().slice(13)}`,
  );
  await finalizerDeclareSource(rig, at, work, "refs/heads/chuggy/work", head);
  if (report !== undefined)
    await rig.harness.query(
      `INSERT INTO execution_result_report (tenant,project,manifest,report)
       VALUES ($1,$2,$3,$4)`,
      [at.partition.tenant, at.partition.project, work.manifest, report],
    );
}

/**
 * Lands the finalizing ticket `at` names as `how` says, through the
 * finalizer's door and the decision that answers it, and writes the passing
 * work result its journal accepted. It answers the memory after and the head
 * the landing's pull request was from.
 */
async function landed(
  at: FinalizerProject,
  memory: ProjectMemory,
  label: string,
  how: Landed,
  report?: string,
): Promise<{ memory: ProjectMemory; head: string }> {
  const mode: BriefFinalizationMode =
    how.landed === "Merged" ? "PullRequestMerge" : "PullRequest";
  await finalizerBriefFinalizationTarget(
    rig,
    at.partition,
    at.ticket,
    "refs/heads/main",
    mode,
  );
  await finalizerBriefBranch(rig, at.partition, at.ticket, headRef);
  const attempt = await finalizerPromote(rig, at, label);
  const head = await proposed(at, attempt, how);
  const submitted = await postgresFinalizer(rig.pool).submitResult({
    claim: await finalizerClaim(rig, at, finalizerIdentity("owner")),
    attempt: asFinalizationAttemptId(attempt),
    conclusion: { outcome: "FinalizationSucceeded" },
  });
  assert.equal(submitted.submitted, "Submitted");
  const drained = await finalizerDrain(rig.harness, at.partition, memory);
  assert.deepEqual(drained.decided, ["Committed"]);
  await acceptedWork(at, drained.memory, label, head, report);
  return { memory: drained.memory, head };
}

/** An execution of the ticket's latest request of `kind`, registered by hand as the scheduler would, answering its identity. */
async function registered(
  project: FinalizerProject,
  ticket: number,
  kind: "SpawnWork" | "SpawnEvaluation",
): Promise<string> {
  const execution = finalizerIdentity(`execution-${kind}`);
  const { tenant, project: named } = project.partition;
  const inserted = await rig.harness.query(
    `INSERT INTO execution
       (tenant, project, execution, ticket, task, source_request, account, cluster,
        configuration_revision, configuration_digest)
     SELECT $1,$2,$3,$4,t.task,q.request,a.account,a.cluster,$6,$7
       FROM execution_request q
       JOIN execution_request_task t
         ON t.tenant=q.tenant AND t.project=q.project AND t.request=q.request
       JOIN capacity_account a ON a.account = ${accountIdentityFunction}($1,$2)
      WHERE q.tenant=$1 AND q.project=$2 AND q.ticket=$4 AND q.kind=$5
      ORDER BY q.authorizing_seq DESC, t.task
      LIMIT 1
     RETURNING execution`,
    [
      tenant,
      named,
      execution,
      ticket,
      kind,
      project.configurationRevision,
      project.configurationDigest,
    ],
  );
  assert.equal(inserted.length, 1);
  return execution;
}

/** What the scheduler's own role reads of what an execution's dependencies delivered. */
function deliveriesOf(project: FinalizerProject, execution: string) {
  return dependencyDeliveriesRead({
    pinned: postgresDependencyPins(schedulerPool),
    landings: postgresTicketLandings(schedulerPool),
    briefs: postgresTicketBrief(schedulerPool),
  }).deliveries(project.partition, asExecutionId(execution));
}
/**
 * A project whose ticket landed as `how` says, reporting `report` where it
 * names one, and whose second ticket waits on it and was dispatched, the
 * dispatch's one remote question answered `answer` and recorded in `asked`.
 */
async function dependentOf(
  label: string,
  how: Landed,
  answer: CommitAncestry,
  report?: string,
): Promise<{
  project: FinalizerProject;
  dependent: { ticket: number; memory: ProjectMemory };
  head: string;
  asked: readonly CommitAncestryQuestion[];
}> {
  const project = await finalizerProject(rig, label);
  const asked: CommitAncestryQuestion[] = [];
  const dependency = await landed(project, project.memory, label, how, report);
  await finalizerSpawnTasks(rig, project, [2]);
  await finalizerPassedWork(rig, project, `${label}-unaccepted`, []);
  const dependent = await dispatched(
    dependencyWriter(asked, () => answer),
    project,
    dependency.memory,
    `${label}-dependent`,
    [project.ticket],
  );
  return { project, dependent, head: dependency.head, asked };
}

/** The one question a dispatch asked, as the repository, the change's commit and the dispatched commit. */
function questionsOf(
  asked: readonly CommitAncestryQuestion[],
): readonly (readonly string[])[] {
  return asked.map((question) => [
    question.repository.repository,
    question.candidate,
    question.tip,
  ]);
}

const report = "The importer counts the rows it read.";
const proposal = {
  url: pullRequest,
  headRef,
  baseRef: "refs/heads/main",
};

test("a dependency merged into the commit its dependent began at is told where it landed and that it is there, and an evaluation later reads the same", async () => {
  const merge = finalizerCommit();
  const { project, dependent, head, asked } = await dependentOf(
    "dependency-merged",
    { landed: "Merged", merge },
    "Ancestor",
    report,
  );
  assert.deepEqual(questionsOf(asked), [
    [project.repository, merge, postgresHarnessObservedCommit],
  ]);
  const title = postgresHarnessBrief.title;
  assert.ok(title !== undefined);
  const merged = asGitObjectId(merge);
  const expected: readonly DependencyDelivery[] = [
    {
      dependency: asTicketId(project.ticket),
      title,
      repository: { repository: asRepositoryId(project.repository), own: true },
      change: {
        change: "Landed",
        commit: merged,
        ref: asGitRefName("refs/heads/main"),
        proposal: {
          ...proposal,
          headCommit: asGitObjectId(head),
          status: "Merged",
        },
      },
      history: {
        commit: merged,
        began: postgresHarnessObservedCommit,
        startsAtBegan: true,
        ancestry: "Ancestor",
      },
      report,
    },
  ];
  const work = await registered(project, dependent.ticket, "SpawnWork");
  assert.deepEqual(await deliveriesOf(project, work), {
    read: "Deliveries",
    deliveries: expected,
  });

  await completed(
    project,
    dependent.memory,
    "dependency-merged-work",
    workTaskIdentity(dependent.ticket, 1),
  );
  const evaluation = await registered(
    project,
    dependent.ticket,
    "SpawnEvaluation",
  );
  assert.deepEqual(await deliveriesOf(project, evaluation), {
    read: "Deliveries",
    deliveries: expected,
  });
  assert.equal(asked.length, 1);
});

test("a dependency whose pull request is open is told as that pull request, not in the commit its dependent began at, and with no report where it made none", async () => {
  const { project, dependent, head, asked } = await dependentOf(
    "dependency-proposed",
    { landed: "Proposed" },
    "NotAncestor",
  );
  assert.deepEqual(questionsOf(asked), [
    [project.repository, head, postgresHarnessObservedCommit],
  ]);
  const proposedHead = asGitObjectId(head);
  const work = await registered(project, dependent.ticket, "SpawnWork");
  const read = await deliveriesOf(project, work);
  assert.equal(read.read, "Deliveries");
  if (read.read !== "Deliveries") return;
  const [delivery] = read.deliveries;
  assert.equal(read.deliveries.length, 1);
  assert.deepEqual(delivery?.change, {
    change: "Proposed",
    proposal: { ...proposal, headCommit: proposedHead, status: "Open" },
  });
  assert.deepEqual(delivery.history, {
    commit: proposedHead,
    began: postgresHarnessObservedCommit,
    startsAtBegan: true,
    ancestry: "NotAncestor",
  });
  assert.equal("report" in delivery, false);
});

test("a dependency whose ancestry was not found out is pinned as neither, and told so", async () => {
  const { project, dependent } = await dependentOf(
    "dependency-unknown",
    { landed: "Merged", merge: finalizerCommit() },
    "Unknown",
  );
  const read = await deliveriesOf(
    project,
    await registered(project, dependent.ticket, "SpawnWork"),
  );
  assert.equal(
    read.read === "Deliveries"
      ? read.deliveries[0]?.history?.ancestry
      : read.read,
    "Unknown",
  );
});

test("a ticket with no dependency is told none, and an execution the project does not hold is told none either", async () => {
  const project = await finalizerProject(rig, "dependency-none");
  const work = await registered(project, project.ticket, "SpawnWork");
  for (const execution of [work, "no-such-execution"])
    assert.deepEqual(await deliveriesOf(project, execution), {
      read: "Deliveries",
      deliveries: [],
    });
});

test("the ticket service finds a dependency's passing work result only by the reference its journal accepted", async () => {
  const project = await finalizerProject(rig, "dependency-results");
  const accepted = finalizerDigest();
  const work = await finalizerPassedWork(
    rig,
    project,
    "dependency-results",
    [],
    accepted,
  );
  const results = postgresDependencyResults(rig.harness.writerPool);
  const fold = Number.parseInt(accepted.slice(0, 13), 16) + 1;
  assert.deepEqual(
    await results.accepted(project.partition, asTicketId(project.ticket), fold),
    { manifest: work.manifest },
  );
  assert.equal(
    await results.accepted(
      project.partition,
      asTicketId(project.ticket),
      fold === 1 ? 2 : fold - 1,
    ),
    undefined,
  );
  assert.equal(
    await results.accepted(
      project.partition,
      asTicketId(project.ticket + 1),
      fold,
    ),
    undefined,
  );
});
