/**
 * Standing and the queue, read from a real PostgreSQL as the finalizer: the
 * landings since a stack's tip are the promoted attempts that followed it, in
 * order, each at the commit its ticket was accepted at; and the entries are the
 * ranked tickets of the one reference asked.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { EvaluationStackStore } from "../../src/interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { stackFor, stackStands } from "../../src/interpreter/stackChoice.ts";
import {
  finalizerCommit,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  landingCommits,
  landingTarget,
  landingWrite,
  stackedSubject,
  recordStack,
} from "./evaluationStackLandings.ts";

let rig: FinalizerRig;
let store: EvaluationStackStore;

before(async () => {
  rig = await finalizerRigOpen();
  store = postgresEvaluationStack(rig.pool);
});
after(async () => {
  await rig.close();
});

/** The stack row of `project`'s ticket over `beneath`, built on `tip`. */
async function stackedOn(
  project: FinalizerProject,
  tip: string,
  beneath: readonly { ticket: number; commit: string }[],
  cycle = 1,
): Promise<void> {
  await recordStack(rig.pool, project.partition, {
    ticket: asTicketId(project.ticket),
    cycle,
    repository: project.repository,
    target: landingTarget,
    tip: asGitObjectId(tip),
    beneath: beneath.map((one) => ({
      ticket: asTicketId(one.ticket),
      commit: asGitObjectId(one.commit),
    })),
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(finalizerCommit()),
  });
}

test("the landings since the tip are the promoted attempts that followed it, in order, at their accepted commits", async () => {
  const own = finalizerCommit();
  const { project, work } = await stackedSubject(rig, "stack-standing", own);
  const c = landingCommits(
    "tip",
    "first",
    "second",
    "unpromoted",
    "forked",
    "a6",
    "a7",
    "a8",
    "a9",
  );
  const landings = [
    { ticket: 7, accepted: c.a7, onto: c.tip, candidate: c.first },
    { ticket: 8, accepted: c.a8, onto: c.first, candidate: c.second },
    {
      ticket: 9,
      accepted: c.a9,
      onto: c.second,
      candidate: c.unpromoted,
      verdict: "NotPromoted" as const,
    },
    { ticket: 6, accepted: c.a6, onto: finalizerCommit(), candidate: c.forked },
  ];
  for (const landing of landings) {
    await landingWrite(
      rig,
      project,
      work,
      `land-${String(landing.ticket)}`,
      landing,
    );
  }
  const beneath = [
    { ticket: 7, commit: c.a7 },
    { ticket: 8, commit: c.a8 },
    { ticket: 9, commit: c.a9 },
  ];
  await stackedOn(project, c.tip, beneath);
  const [mine, ...others] = await store.queue(
    project.partition,
    project.repository,
    undefined,
  );
  assert.equal(others.length, 0);
  assert.equal(mine?.phase, "Pending");
  assert.equal(mine?.policy, "Stacked");
  assert.equal(mine?.commit, own);
  assert.deepEqual(
    mine?.stack?.landings.map((one) => [one.ticket, one.commit]),
    [
      [7, c.a7],
      [8, c.a8],
    ],
    "the unpromoted and the forked landings are no landings since the tip",
  );
  assert.equal(mine?.stack?.beneath.length, 3);
});

test("landings that cannot be followed are a stack that does not stand, and the read still answers", async () => {
  for (const [label, second] of [
    ["fork", {}],
    ["unpinned", { pinned: false as const }],
  ] as const) {
    const { project, work } = await stackedSubject(rig, `stack-${label}`);
    const c = landingCommits("tip", "first", "other", "a7", "a8");
    await landingWrite(rig, project, work, `${label}-7`, {
      ticket: 7,
      accepted: c.a7,
      onto: c.tip,
      candidate: c.first,
      ...(label === "unpinned" ? second : {}),
    });
    if (label === "fork")
      await landingWrite(rig, project, work, `${label}-8`, {
        ticket: 8,
        accepted: c.a8,
        onto: c.tip,
        candidate: c.other,
      });
    await stackedOn(project, c.tip, [{ ticket: 7, commit: c.a7 }]);
    const [mine] = await store.queue(
      project.partition,
      project.repository,
      undefined,
    );
    assert.equal(mine?.stack?.unreadable, true, label);
    assert.equal(
      stackStands(mine?.stack ?? { beneath: [], landings: [] }, []),
      false,
    );
    const evaluating = (await store.evaluating(256)).filter(
      (each) => each.partition.project === project.partition.project,
    );
    assert.ok(evaluating.every((each) => each.standing.unreadable === true));
  }
});

test("a stack read from the database stands while the tickets still beneath are pending at their commits", async () => {
  const { project, work } = await stackedSubject(rig, "stack-stands");
  const c = landingCommits("tip", "first", "a7", "a8");
  await landingWrite(rig, project, work, "stands-7", {
    ticket: 7,
    accepted: c.a7,
    onto: c.tip,
    candidate: c.first,
  });
  await stackedOn(project, c.tip, [
    { ticket: 7, commit: c.a7 },
    { ticket: 8, commit: c.a8 },
  ]);
  const [mine] = await store.queue(
    project.partition,
    project.repository,
    undefined,
  );
  const standing = mine?.stack;
  assert.ok(standing !== undefined && mine !== undefined);
  const beneath = {
    ...mine,
    ticket: asTicketId(8),
    commit: asGitObjectId(c.a8),
    stack: undefined,
    rank: 99,
  };
  assert.equal(stackStands(standing, [beneath]), true);
  assert.equal(stackStands(standing, [{ ...beneath, phase: "Work" }]), false);
  assert.equal(stackStands(standing, []), false);
});

test("a stack whose tip nothing landed on has no landings and stands only over pending tickets", async () => {
  const { project } = await stackedSubject(rig, "stack-no-landings");
  await stackedOn(project, finalizerCommit(), [
    { ticket: 7, commit: finalizerCommit() },
  ]);
  const [mine] = await store.queue(
    project.partition,
    project.repository,
    undefined,
  );
  assert.deepEqual(mine?.stack?.landings, []);
  assert.equal(
    stackStands(mine?.stack ?? { beneath: [], landings: [] }, []),
    false,
  );
});

test("a ticket evaluated unstacked in its cycle has no stack, whatever an earlier cycle recorded", async () => {
  const { project } = await stackedSubject(rig, "stack-unstacked-cycle");
  await stackedOn(
    project,
    finalizerCommit(),
    [{ ticket: 7, commit: finalizerCommit() }],
    2,
  );
  const [mine] = await store.queue(
    project.partition,
    project.repository,
    undefined,
  );
  assert.equal(mine?.stack, undefined);
  const behind = {
    ticket: asTicketId(99),
    policy: "Stacked",
    stackFailures: 0,
    rank: undefined,
  } as const;
  assert.equal(
    stackFor(behind, mine === undefined ? [] : [mine])?.length,
    1,
    "a Pending holder is stacked on",
  );
});

test("a reference other than the one asked is not in the queue", async () => {
  const { project } = await stackedSubject(rig, "stack-reference");
  const asked = (repository: string, ref?: string) =>
    store.queue(project.partition, repository, ref);
  assert.equal((await asked(project.repository)).length, 1);
  assert.equal(
    (await asked(project.repository, "refs/heads/release")).length,
    0,
  );
  assert.equal((await asked("elsewhere")).length, 0);
});
