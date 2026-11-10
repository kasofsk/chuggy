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
  policy: "Direct" | "Serialized" | "Stacked",
  mode: "Push" | "PullRequestMerge" = "Push",
): SerializedCandidate["finalization"] {
  return { kind: "GitMerge", mode, policy };
}

/** A Serialized ticket finalizing on `main` of one repository, ranked at `rank`. */
function candidate(
  ticket: number,
  rank: number | undefined,
  over: Partial<Omit<SerializedCandidate, "ticket" | "rank">> = {},
): SerializedCandidate {
  return {
    partition,
    ticket: asTicketId(ticket),
    phase: "Finalization",
    finalization: gitMerge("Serialized"),
    repository: "repo",
    target: "main",
    rank,
    ...over,
  };
}

function holderOf(candidates: readonly SerializedCandidate[]) {
  return serializedQueues(candidates).map((queue) => ({
    holder: queue.holder,
    waiting: queue.waiting,
  }));
}

test("the lowest rank holds and the others wait on it in rank order", () => {
  assert.deepEqual(
    holderOf([candidate(3, 30), candidate(1, 10), candidate(2, 20)]),
    [{ holder: asTicketId(1), waiting: [asTicketId(2), asTicketId(3)] }],
  );
});

test("a Stacked and a Serialized ticket on one reference share one queue and wait alike", () => {
  const stacked = (ticket: number, rank: number) =>
    candidate(ticket, rank, { finalization: gitMerge("Stacked") });
  assert.deepEqual(
    holderOf([candidate(1, 10), stacked(2, 20), candidate(3, 30)]),
    [{ holder: asTicketId(1), waiting: [asTicketId(2), asTicketId(3)] }],
  );
  const queues = serializedQueues([stacked(2, 20), candidate(1, 10)]);
  assert.deepEqual(serializedWaiting(queues), [
    { partition, ticket: asTicketId(2) },
  ]);
  assert.deepEqual(holderOf([stacked(2, 10), candidate(1, 20)]), [
    { holder: asTicketId(2), waiting: [asTicketId(1)] },
  ]);
});

test("a tie on rank is broken by ticket", () => {
  assert.deepEqual(holderOf([candidate(5, 10), candidate(4, 10)]), [
    { holder: asTicketId(4), waiting: [asTicketId(5)] },
  ]);
});

test("a ticket sent back to re-check keeps its rank and is not overtaken", () => {
  for (const phase of ["Work", "Evaluation", "Finalization"] as const)
    assert.deepEqual(
      holderOf([
        candidate(1, 10, { phase: "Finalization" }),
        candidate(2, 5, { phase }),
        candidate(3, 20),
      ]),
      [
        {
          holder: asTicketId(2),
          waiting: [asTicketId(1), asTicketId(3)],
        },
      ],
      phase,
    );
});

test("a fresh ticket cannot land ahead of a re-checking holder, and lands once the holder has", () => {
  const rechecking = candidate(2, 10, { phase: "Work" });
  const fresh = candidate(3, 30);
  assert.deepEqual(holderOf([rechecking, fresh]), [
    { holder: asTicketId(2), waiting: [asTicketId(3)] },
  ]);
  assert.deepEqual(serializedWaiting(serializedQueues([rechecking, fresh])), [
    { partition, ticket: asTicketId(3) },
  ]);
  assert.deepEqual(
    holderOf([{ ...rechecking, phase: "Done", rank: undefined }, fresh]),
    [{ holder: asTicketId(3), waiting: [] }],
  );
});

test("a ticket in evaluation behind the holder waits and is no barrier to the holder", () => {
  assert.deepEqual(
    holderOf([
      candidate(1, 10, { phase: "Work" }),
      candidate(2, 20, { phase: "Evaluation" }),
      candidate(3, 30),
    ]),
    [{ holder: asTicketId(1), waiting: [asTicketId(2), asTicketId(3)] }],
  );
});

test("a Direct landing moves no rank, so a re-check follows only the holder's own landing", () => {
  const queued = [candidate(1, 10, { phase: "Work" }), candidate(2, 20)];
  const direct = candidate(3, 5, { finalization: gitMerge("Direct") });
  assert.deepEqual(holderOf(queued), holderOf([...queued, direct]));
  assert.deepEqual(
    holderOf([...queued, { ...direct, phase: "Done", rank: undefined }]),
    holderOf(queued),
  );
});

test("a ticket stops holding when it leaves the path", () => {
  const away: readonly TicketPhase[] = [
    "Done",
    "Escalated",
    "Revoked",
    "Pending",
  ];
  for (const phase of away)
    assert.deepEqual(
      holderOf([candidate(1, 10, { phase }), candidate(2, 20)]),
      [{ holder: asTicketId(2), waiting: [] }],
      phase,
    );
});

test("a ticket without a rank holds nothing", () => {
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
        candidate(3, 5, { finalization, phase: "Work" }),
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
