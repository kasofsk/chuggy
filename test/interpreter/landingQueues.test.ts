import assert from "node:assert/strict";
import { test } from "node:test";

import { landingQueueTicketsAnsweredMax } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  landingQueueReads,
  type LandingQueueCandidates,
} from "../../src/interpreter/landingQueues.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  serializedQueues,
  type SerializedCandidate,
} from "../../src/interpreter/serializedHolder.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const other = { tenant: asTenantId("acme"), project: asProjectId("other") };
const reader = asPrincipal("issuer reader");

/** A Serialized git merge of ticket `ticket` onto `main` of `repo`, ranked at `rank`. */
function candidate(
  ticket: number,
  rank: number,
  over: Partial<Omit<SerializedCandidate, "ticket" | "rank">> = {},
): SerializedCandidate {
  return {
    partition,
    ticket: asTicketId(ticket),
    phase: "Finalization",
    finalization: { kind: "GitMerge", mode: "Push", policy: "Serialized" },
    repository: "repo",
    target: "main",
    rank,
    ...over,
  };
}

/** The reads `access` lets the reader make over a store answering `answered`, and what the store was asked. */
function readsOver(
  answered: LandingQueueCandidates,
  access: readonly ProjectAccessKind[] = ["Read"],
) {
  const asked: number[] = [];
  const project = memoryProjectAccess();
  project.grant({ partition, principal: reader, access: new Set(access) });
  const reads = landingQueueReads({
    access: project,
    store: {
      rankedCandidates: (_partition, ticketsMax) => {
        asked.push(ticketsMax);
        return Promise.resolve(answered);
      },
    },
  });
  return { read: () => reads.read(reader, partition), asked };
}

test("a holder and its waiters across work, evaluation and finalization are answered in the order the finalizer's queue holds them", async () => {
  const candidates = [
    candidate(4, 40, { phase: "Work" }),
    candidate(2, 10, { phase: "Evaluation" }),
    candidate(1, 20, { phase: "Finalization" }),
    candidate(3, 30, { phase: "Work" }),
  ];
  const { read, asked } = readsOver({ candidates, truncated: false });
  const answered = await read();
  assert.deepEqual(answered, {
    queues: [
      {
        partition,
        repository: "repo",
        target: "main",
        holder: asTicketId(2),
        waiting: [asTicketId(1), asTicketId(3), asTicketId(4)],
      },
    ],
    truncated: false,
  });
  assert.deepEqual(answered.queues, serializedQueues(candidates));
  assert.deepEqual(asked, [landingQueueTicketsAnsweredMax]);
});

test("each reference is its own queue, by repository and then target, a target named by none first", async () => {
  const { read } = readsOver({
    candidates: [
      candidate(1, 10, { repository: "zeta" }),
      candidate(2, 20, { target: "release" }),
      candidate(3, 30, { target: undefined }),
      candidate(4, 40, { target: "release" }),
    ],
    truncated: false,
  });
  assert.deepEqual(
    (await read())?.queues.map((queue) => [
      queue.repository,
      queue.target,
      queue.holder,
      queue.waiting,
    ]),
    [
      ["repo", undefined, asTicketId(3), []],
      ["repo", "release", asTicketId(2), [asTicketId(4)]],
      ["zeta", "main", asTicketId(1), []],
    ],
  );
});

test("a Direct merge, a pull request, a landing of nothing and a ticket naming no repository are in no queue", async () => {
  const { read } = readsOver({
    candidates: [
      candidate(1, 10, {
        finalization: { kind: "GitMerge", mode: "Push", policy: "Direct" },
      }),
      candidate(2, 20, { finalization: { kind: "PullRequest" } }),
      candidate(3, 30, { finalization: { kind: "None" } }),
      candidate(4, 40, { repository: undefined }),
      candidate(5, 50),
    ],
    truncated: false,
  });
  assert.deepEqual(
    (await read())?.queues.map((queue) => [queue.holder, queue.waiting]),
    [[asTicketId(5), []]],
  );
});

test("a project with no ranked ticket answers no queues", async () => {
  const { read } = readsOver({ candidates: [], truncated: false });
  assert.deepEqual(await read(), { queues: [], truncated: false });
});

test("a cut the store made is answered as cut", async () => {
  const { read } = readsOver({
    candidates: [candidate(1, 10)],
    truncated: true,
  });
  assert.equal((await read())?.truncated, true);
});

test("a reader who may not read the project is answered nothing, and nothing is read", async () => {
  for (const held of [
    [],
    ["Mutate", "Execute"],
    ["Administer"],
  ] as readonly ProjectAccessKind[][]) {
    const { read, asked } = readsOver(
      { candidates: [candidate(1, 10)], truncated: false },
      held,
    );
    assert.equal(await read(), undefined, held.join());
    assert.deepEqual(asked, [], held.join());
  }
});

test("a candidate of another project fails the read rather than being answered", async () => {
  const { read } = readsOver({
    candidates: [candidate(1, 10), candidate(2, 20, { partition: other })],
    truncated: false,
  });
  await assert.rejects(read(), /another project's/u);
});

test("a store answering past the bound fails the read", async () => {
  const { read } = readsOver({
    candidates: Array.from(
      { length: landingQueueTicketsAnsweredMax + 1 },
      (_, index) => candidate(index + 1, index + 1),
    ),
    truncated: true,
  });
  await assert.rejects(read(), /past its bound/u);
});
