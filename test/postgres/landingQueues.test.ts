/**
 * A project's landing queues, as the API reads them from a real server.
 *
 * THE FIRST TICKET OF A PROJECT IS BROUGHT TO FINALIZATION BY REAL DECISIONS,
 * and the tickets beside it are written by hand, as the finalizer's own
 * Serialized suite writes them: what is under test is the read of those rows,
 * not a decision.
 *
 * THE READS ARE MADE AS THE API, through the store the route is composed over,
 * and whoever migrated is asked only for each ticket's rank, so the order the
 * read answers can be held to `serializedQueues` over the same ranks.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresLandingQueues } from "../../src/adapters/postgres/landingQueues.ts";
import {
  apiRole,
  projectLandingQueueCandidatesFunction,
  ticketFinalizationRankFunction,
} from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  landingQueueReads,
  type LandingQueues,
} from "../../src/interpreter/landingQueues.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  serializedQueues,
  type SerializedCandidate,
} from "../../src/interpreter/serializedHolder.ts";
import {
  finalizerBriefLanding,
  finalizerCommit,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  finalizerSibling,
  type FinalizerProject,
  type FinalizerRig,
  type FinalizerSibling,
} from "./finalizerHarness.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";
import { seedJournalEntry } from "./nativeActionFixture.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

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

const reader = asPrincipal("issuer reader");

/** What `reader` is answered of `project`'s queues, where it may read the project as `readable` says. */
function queuesOf(
  project: Pick<FinalizerProject, "partition">,
  readable = true,
): Promise<LandingQueues | undefined> {
  return landingQueueReads({
    access: {
      authorize: (who) =>
        Promise.resolve(readable ? memberAuthority(who) : undefined),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    store: postgresLandingQueues(apiPool),
  }).read(reader, project.partition);
}

/** `read` without what each queue says of its holder's tenure, which the cases on it hold apart. */
function unheld(read: LandingQueues | undefined) {
  return (
    read && {
      ...read,
      queues: read.queues.map((queue) => ({
        partition: queue.partition,
        repository: queue.repository,
        target: queue.target,
        holder: queue.holder,
        waiting: queue.waiting,
      })),
    }
  );
}

/** A project whose first ticket is Serialized and in Finalization, on the repository's default. */
async function serialized(label: string): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Serialized",
    project.repository,
  );
  return project;
}

/** Writes each of `siblings` after `project`'s ticket, numbered in turn. */
async function beside(
  project: FinalizerProject,
  label: string,
  siblings: readonly FinalizerSibling[],
): Promise<void> {
  let last = project;
  for (const [index, how] of siblings.entries())
    last = await finalizerSibling(rig, last, `${label}-${String(index)}`, how);
}

/** The rank whoever migrated reads for one ticket of `project`. */
async function rankOf(
  project: FinalizerProject,
  ticket: number,
): Promise<number | undefined> {
  const [row] = await rig.harness.query(
    `SELECT ${ticketFinalizationRankFunction}($1,$2,$3)::text AS rank`,
    [project.partition.tenant, project.partition.project, ticket],
  );
  const rank = row?.["rank"];
  return typeof rank === "string" ? Number(rank) : undefined;
}

/** `ticket` of `project` as the finalizer's queue reads it, its rank read apart from the API. */
async function candidateOf(
  project: FinalizerProject,
  ticket: number,
  phase: SerializedCandidate["phase"],
): Promise<SerializedCandidate> {
  return {
    partition: project.partition,
    ticket: asTicketId(ticket),
    phase,
    finalization: { kind: "GitMerge", mode: "Push", policy: "Serialized" },
    repository: project.repository,
    target: undefined,
    rank: await rankOf(project, ticket),
  };
}

test("a holder and its waiters across work, evaluation and finalization are answered as `serializedQueues` orders their ranks", async () => {
  const project = await serialized("queue-order");
  await beside(project, "queue-order", [
    { landing: "Serialized", phase: "Work", pending: false, after: -2 },
    { landing: "Stacked", phase: "Evaluation", pending: false, after: 0 },
    { landing: "Serialized", phase: "Finalization", pending: true, after: -1 },
  ]);
  const ticket = project.ticket;
  const expected = serializedQueues([
    await candidateOf(project, ticket, "Finalization"),
    await candidateOf(project, ticket + 1, "Work"),
    await candidateOf(project, ticket + 2, "Evaluation"),
    await candidateOf(project, ticket + 3, "Finalization"),
  ]);
  assert.deepEqual(expected, [
    {
      partition: project.partition,
      repository: project.repository,
      target: undefined,
      holder: asTicketId(ticket + 1),
      waiting: [ticket + 3, ticket, ticket + 2].map(asTicketId),
    },
  ]);
  assert.deepEqual(unheld(await queuesOf(project)), {
    queues: expected,
    truncated: false,
  });
});

test("two references of one project are answered as two queues", async () => {
  const project = await serialized("queue-references");
  await beside(project, "queue-references", [
    {
      landing: "Serialized",
      phase: "Finalization",
      pending: true,
      target: "refs/heads/release",
      after: -1,
    },
    {
      landing: "Serialized",
      phase: "Work",
      pending: false,
      target: "refs/heads/release",
      after: 0,
    },
  ]);
  const ticket = project.ticket;
  assert.deepEqual(
    (await queuesOf(project))?.queues.map((queue) => [
      queue.target,
      queue.holder,
      queue.waiting,
    ]),
    [
      [undefined, asTicketId(ticket), []],
      ["refs/heads/release", asTicketId(ticket + 1), [asTicketId(ticket + 2)]],
    ],
  );
});

test("a Direct merge, a pull request, a landing of nothing and a ticket naming no repository are left out", async () => {
  const project = await serialized("queue-left-out");
  await beside(project, "queue-left-out", [
    { landing: "Direct", phase: "Finalization", pending: true, after: 0 },
    {
      landing: "Serialized",
      phase: "Finalization",
      pending: true,
      after: -1,
      mode: "PullRequest",
    },
    {
      landing: "Serialized",
      phase: "Finalization",
      pending: true,
      after: -2,
      mode: "None",
    },
    {
      landing: "Serialized",
      phase: "Finalization",
      pending: true,
      after: -3,
      repository: null,
    },
  ]);
  assert.deepEqual(unheld(await queuesOf(project)), {
    queues: [
      {
        partition: project.partition,
        repository: project.repository,
        target: undefined,
        holder: asTicketId(project.ticket),
        waiting: [],
      },
    ],
    truncated: false,
  });
});

test("another project's tickets are never answered, though they rank earlier", async () => {
  const mine = await serialized("queue-mine");
  const theirs = await serialized("queue-theirs");
  await beside(theirs, "queue-theirs", [
    { landing: "Serialized", phase: "Work", pending: false, after: -1 },
  ]);
  const answered = await queuesOf(mine);
  assert.deepEqual(
    answered?.queues.map((queue) => [queue.partition, queue.holder]),
    [[mine.partition, asTicketId(mine.ticket)]],
  );
  const [row] = (
    await apiPool.query<{ tickets: string }>(
      `SELECT count(*)::text AS tickets
         FROM ${projectLandingQueueCandidatesFunction}($1,$2)`,
      [mine.partition.tenant, mine.partition.project],
    )
  ).rows;
  assert.equal(row?.tickets, "1");
});

test("a project with no Serialized or Stacked ticket on the path answers no queues", async () => {
  const project = await finalizerProject(rig, "queue-direct");
  await beside(project, "queue-direct", [
    { landing: "Direct", phase: "Finalization", pending: true, after: -1 },
  ]);
  assert.deepEqual(await queuesOf(project), { queues: [], truncated: false });
});

test("a caller who may not read the project is answered nothing", async () => {
  const project = await serialized("queue-refused");
  assert.equal(await queuesOf(project, false), undefined);
});

test("the store answers the earliest-ranked tickets and says where it cut", async () => {
  const project = await serialized("queue-cut");
  await beside(project, "queue-cut", [
    { landing: "Serialized", phase: "Work", pending: false, after: -1 },
    { landing: "Serialized", phase: "Work", pending: false, after: 0 },
  ]);
  const store = postgresLandingQueues(apiPool);
  const cut = await store.rankedCandidates(project.partition, 2);
  assert.deepEqual(
    cut.candidates.map((candidate) => candidate.ticket),
    [project.ticket + 1, project.ticket].map(asTicketId),
  );
  assert.equal(cut.truncated, true);
  assert.equal(
    (await store.rankedCandidates(project.partition, 3)).truncated,
    false,
  );
});

test("the API reads candidates through its door alone, and not the rank's door behind it", async () => {
  const door = `SELECT * FROM ${projectLandingQueueCandidatesFunction}('t','p')`;
  assert.equal(await rig.harness.attemptAs(apiRole, door), undefined);
  assert.match(
    (await rig.harness.attemptAs(
      apiRole,
      `SELECT ${ticketFinalizationRankFunction}('t','p',1)`,
    )) ?? "",
    postgresHarnessDenial(ticketFinalizationRankFunction),
  );
});

/**
 * THE JOURNAL IS DATED BY POSITION in the cases below, each entry a second
 * after the one before it, so an instant names the entry it was read from and
 * a case can say which entry a queue's holder holds from.
 */
function entryAt(seq: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seq))
    .toISOString()
    .replace(/Z$/u, "000Z");
}

/** Dates every entry of `project`'s journal as `entryAt` names it. */
async function datedBySeq(project: FinalizerProject): Promise<void> {
  await rig.harness.query(
    `UPDATE journal_entry
        SET committed_at = timestamptz '2026-01-01 00:00:00+00'
                           + seq * interval '1 second'
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
}

/** Journals `event` after every entry of `project`'s, and answers its position. */
async function journaled(
  project: FinalizerProject,
  label: string,
  event: unknown,
): Promise<number> {
  const [last] = await rig.harness.query(
    `SELECT max(seq)::int AS seq FROM journal_entry WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  const seq = Number(last?.["seq"]) + 1;
  await seedJournalEntry(rig.harness, project.partition, label, seq, event);
  return seq;
}

/** An entry about a ticket of no queue, which is only a position for a rank to be taken at. */
function elsewhere(project: FinalizerProject, label: string): Promise<number> {
  return journaled(project, label, { type: "TicketRevoked", value: 999 });
}

/** Moves `ticket` of `project` to `phase`, as the entry beside it would have. */
async function phased(
  project: FinalizerProject,
  ticket: number,
  phase: string,
): Promise<void> {
  await rig.harness.query(
    `UPDATE ticket_projection SET phase=$4 WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, ticket, phase],
  );
}

/** The finalization fact for the attempt `project`'s request names. */
async function factOf(
  project: FinalizerProject,
): Promise<Record<string, number>> {
  const [row] = await rig.harness.query(
    `SELECT work_cycle::int AS cycle, finalization_generation::int AS generation
       FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  return {
    ticket: project.ticket,
    workCycle: Number(row?.["cycle"]),
    generation: Number(row?.["generation"]),
    evidence: 1,
  };
}

/** `project`'s ticket landing, journaled last, and its position. */
async function landed(project: FinalizerProject, label: string) {
  const seq = await journaled(project, `landed-${label}`, {
    type: "TicketFinalizationSucceeded",
    value: await factOf(project),
  });
  await phased(project, project.ticket, "Done");
  return seq;
}

/** `project`'s attempt failing as `failureKind` and its ticket sent back to Work, journaled last, and its position. */
async function sentBack(
  project: FinalizerProject,
  label: string,
  failureKind: string,
) {
  const keeps = failureKind === "RecheckRequired" || failureKind === "Restack";
  await finalizerPrepare(rig, project, `sent-back-${label}`, {
    outcome: "Failed",
    failureKind,
    ...(keeps ? { recheckCommit: finalizerCommit() } : {}),
  });
  const seq = await journaled(project, `sent-back-${label}`, {
    type: "TicketFinalizationNeedsWork",
    value: await factOf(project),
  });
  await phased(project, project.ticket, "Work");
  return seq;
}

/** Each queue of `project` as its holder, the instant it holds from and its phase. */
async function tenureOf(project: FinalizerProject) {
  await datedBySeq(project);
  return (await queuesOf(project))?.queues.map((queue) => [
    queue.holder,
    queue.holderSince,
    queue.holderPhase,
  ]);
}

/** A project whose Serialized ticket ranks first, and a second ranked at an entry after it. */
async function behind(label: string) {
  const first = await serialized(label);
  const ranked = await elsewhere(first, `${label}-ranked`);
  const second = await finalizerSibling(rig, first, `${label}-second`, {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    after: ranked - first.authorizingSeq,
  });
  return { first, second, ranked };
}

test("a ticket alone in its queue holds it from the entry its rank was taken at", async () => {
  const project = await serialized("tenure-alone");
  assert.deepEqual(await tenureOf(project), [
    [
      asTicketId(project.ticket),
      entryAt(project.authorizingSeq),
      "Finalization",
    ],
  ]);
});

test("a holder ranked after the ticket before it stopped holding holds from its own rank", async () => {
  const first = await serialized("tenure-after");
  await landed(first, "tenure-after");
  const ranked = await elsewhere(first, "tenure-after-ranked");
  const second = await finalizerSibling(rig, first, "tenure-after-second", {
    landing: "Serialized",
    phase: "Evaluation",
    pending: false,
    after: ranked - first.authorizingSeq,
  });
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(second.ticket), entryAt(ranked), "Evaluation"],
  ]);
});

test("a holder ranked before the ticket ahead of it landed holds from the landing", async () => {
  const { first, second } = await behind("tenure-landed");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(first.ticket), entryAt(first.authorizingSeq), "Finalization"],
  ]);
  const landing = await landed(first, "tenure-landed");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(second.ticket), entryAt(landing), "Finalization"],
  ]);
});

test("a holder ranked before the ticket ahead of it was sent back to rework holds from the send-back", async () => {
  const { first, second } = await behind("tenure-reworked");
  const reworked = await sentBack(first, "tenure-reworked", "MergeConflict");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(second.ticket), entryAt(reworked), "Finalization"],
  ]);
});

test("a ticket ahead sent back to re-check still holds, and a holder's own re-check leaves the instant it holds from", async () => {
  const { first, second } = await behind("tenure-rechecked");
  await sentBack(first, "tenure-rechecked-first", "RecheckRequired");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(first.ticket), entryAt(first.authorizingSeq), "Work"],
  ]);
  await phased(first, first.ticket, "Finalization");
  const landing = await landed(first, "tenure-rechecked");
  await sentBack(second, "tenure-rechecked-second", "RecheckRequired");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(second.ticket), entryAt(landing), "Work"],
  ]);
});

test("a ticket of another reference stopping leaves the instant a holder holds from", async () => {
  const first = await serialized("tenure-elsewhere");
  const ranked = await elsewhere(first, "tenure-elsewhere-ranked");
  const second = await finalizerSibling(rig, first, "tenure-elsewhere-second", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    target: "refs/heads/release",
    after: ranked - first.authorizingSeq,
  });
  await landed(first, "tenure-elsewhere");
  assert.deepEqual(await tenureOf(first), [
    [asTicketId(second.ticket), entryAt(ranked), "Finalization"],
  ]);
});
