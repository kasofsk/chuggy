import assert from "node:assert/strict";
import { test } from "node:test";

import type { TicketPhase } from "../../src/contract/rosters.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  serializedQueues,
  serializedWaiting,
  type SerializedCandidate,
} from "../../src/interpreter/serializedHolder.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** A git merge onto one reference, ordered under `policy`. */
function gitMerge(
  policy: "Direct" | "Serialized",
  mode: "Push" | "PullRequestMerge" = "Push",
): SerializedCandidate["finalization"] {
  return { kind: "GitMerge", mode, policy };
}

/** A Serialized ticket finalizing on `main` of one repository, entered at `entry`. */
function candidate(
  ticket: number,
  entry: number | undefined,
  over: Partial<Omit<SerializedCandidate, "ticket" | "entry">> = {},
): SerializedCandidate {
  return {
    partition,
    ticket: asTicketId(ticket),
    phase: "Finalization",
    finalization: gitMerge("Serialized"),
    repository: "repo",
    target: "main",
    entry,
    rechecking: false,
    ...over,
  };
}

function holderOf(candidates: readonly SerializedCandidate[]) {
  return serializedQueues(candidates).map((queue) => ({
    holder: queue.holder,
    waiting: queue.waiting,
  }));
}

test("the first pending finalization by entry holds and the others wait on it", () => {
  assert.deepEqual(
    holderOf([candidate(3, 30), candidate(1, 10), candidate(2, 20)]),
    [{ holder: asTicketId(1), waiting: [asTicketId(2), asTicketId(3)] }],
  );
});

test("a tie on entry is broken by ticket", () => {
  assert.deepEqual(holderOf([candidate(5, 10), candidate(4, 10)]), [
    { holder: asTicketId(4), waiting: [asTicketId(5)] },
  ]);
});

test("a re-check in flight holds ahead of an earlier entry", () => {
  assert.deepEqual(
    holderOf([
      candidate(1, 10),
      candidate(2, undefined, { phase: "Work", rechecking: true }),
    ]),
    [{ holder: asTicketId(2), waiting: [asTicketId(1)] }],
  );
});

test("a re-check holds through evaluation and, once it has its request, finalization", () => {
  for (const phase of ["Work", "Evaluation"] as const)
    assert.deepEqual(
      holderOf([
        candidate(1, 10),
        candidate(2, undefined, { phase, rechecking: true }),
      ])[0]?.holder,
      asTicketId(2),
      phase,
    );
  assert.deepEqual(
    holderOf([candidate(1, 10), candidate(2, 50, { rechecking: true })]),
    [{ holder: asTicketId(2), waiting: [asTicketId(1)] }],
  );
});

test("a ticket stops holding when it leaves the path", () => {
  const away: readonly TicketPhase[] = [
    "Done",
    "Escalated",
    "Revoked",
    "Pending",
  ];
  for (const phase of away) {
    assert.deepEqual(
      holderOf([candidate(1, 10, { phase }), candidate(2, 20)]),
      [{ holder: asTicketId(2), waiting: [] }],
      `pending in ${phase}`,
    );
    assert.deepEqual(
      holderOf([
        candidate(1, undefined, { phase, rechecking: true }),
        candidate(2, 20),
      ]),
      [{ holder: asTicketId(2), waiting: [] }],
      `re-checking in ${phase}`,
    );
  }
});

test("a ticket with neither a pending request nor a re-check holds nothing", () => {
  assert.deepEqual(
    holderOf([candidate(1, undefined, { phase: "Work" }), candidate(2, 20)]),
    [{ holder: asTicketId(2), waiting: [] }],
  );
  assert.deepEqual(holderOf([candidate(1, undefined, { phase: "Work" })]), []);
});

test("two references are independent, whether by target, repository or project", () => {
  const queues = serializedQueues([
    candidate(1, 10),
    candidate(2, 20),
    candidate(3, 30, { target: "release" }),
    candidate(4, 40, { repository: "other" }),
    candidate(5, 50, {
      partition: { ...partition, project: asProjectId("elsewhere") },
    }),
    candidate(6, 60, { target: undefined }),
  ]);
  assert.equal(queues.length, 5);
  assert.deepEqual(
    queues.map((queue) => queue.holder),
    [1, 3, 4, 5, 6].map(asTicketId),
  );
  assert.deepEqual(serializedWaiting(queues), [
    { partition, ticket: asTicketId(2) },
  ]);
});

test("Direct tickets and tickets naming no repository are in no queue", () => {
  assert.deepEqual(
    holderOf([
      candidate(1, 10, { finalization: gitMerge("Direct") }),
      candidate(2, 20),
      candidate(3, 30, { repository: undefined }),
    ]),
    [{ holder: asTicketId(2), waiting: [] }],
  );
  assert.deepEqual(
    serializedQueues([candidate(1, 10, { finalization: gitMerge("Direct") })]),
    [],
  );
});

test("a pull request, a landing of nothing and a ticket carrying no brief are in no queue", () => {
  for (const finalization of [
    { kind: "PullRequest" },
    { kind: "PullRequest", target: "main" },
    { kind: "None" },
    undefined,
  ] as const)
    assert.deepEqual(
      holderOf([
        candidate(1, 10, { finalization }),
        candidate(2, 20),
        candidate(3, undefined, { finalization, rechecking: true }),
      ]),
      [{ holder: asTicketId(2), waiting: [] }],
      JSON.stringify(finalization),
    );
});

test("a push and a merged proposal onto one reference queue together", () => {
  assert.deepEqual(
    holderOf([
      candidate(1, 10, {
        finalization: gitMerge("Serialized", "PullRequestMerge"),
      }),
      candidate(2, 20),
    ]),
    [{ holder: asTicketId(1), waiting: [asTicketId(2)] }],
  );
});
