/**
 * The choice made when a Stacked ticket's first evaluation of a work cycle
 * spawns, over fakes of what it reads and mints: a stack is chosen and minted
 * once, a cycle that has begun reads what it began with, and anything that
 * keeps a stack from being minted leaves the evaluation unstacked and records
 * nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "../../src/interpreter/evaluationStack.ts";
import {
  evaluationStacking,
  stackRefOf,
  type EvaluationStackingPorts,
} from "../../src/interpreter/evaluationStacking.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitPromotionPort,
  type StackMinted,
  type StackMinting,
  type TargetObserved,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import type { StackEntry } from "../../src/interpreter/stackChoice.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const repository = asRepositoryId("repository");
const ticket = asTicketId(2);
const own = asGitObjectId("2".repeat(40));
const holder = asGitObjectId("1".repeat(40));
const tip = asGitObjectId("a".repeat(40));
const stackCommit = asGitObjectId("5".repeat(40));
const stackTree = asGitObjectId("6".repeat(40));

const holderEntry: StackEntry = {
  ticket: asTicketId(1),
  policy: "Serialized",
  phase: "Pending",
  rank: 1,
  commit: holder,
  stack: undefined,
};

interface Case {
  readonly ports: EvaluationStackingPorts;
  readonly mints: StackMinting[];
  readonly reads: string[];
}

interface Over {
  queue?: readonly StackEntry[];
  policy?: "Direct" | "Serialized" | "Stacked";
  recorded?: EvaluationStack;
  evaluated?: boolean;
  failures?: number;
  observed?: TargetObserved;
  minted?: StackMinted;
  queueFails?: boolean;
}

/** The store a case reads, noting each read in `reads`. */
function storeOf(
  over: Over,
  reads: string[],
): EvaluationStackingPorts["store"] {
  return {
    read: () => {
      reads.push("read");
      return Promise.resolve(over.recorded);
    },
    evaluated: () => {
      reads.push("evaluated");
      return Promise.resolve(over.evaluated ?? false);
    },
    queue: () => {
      reads.push("queue");
      return over.queueFails === true
        ? Promise.reject(new RangeError("the queue is too large"))
        : Promise.resolve(over.queue ?? [holderEntry]);
    },
    stackFailures: () => Promise.resolve(over.failures ?? 0),
  } satisfies Pick<
    EvaluationStackStore,
    "read" | "evaluated" | "queue" | "stackFailures"
  >;
}

/** The ports over a queue, a brief policy and a mint, each recording that it was asked. */
function caseOf(over: Over = {}): Case {
  const mints: StackMinting[] = [];
  const reads: string[] = [];
  const store = storeOf(over, reads);
  const git: Pick<GitPromotionPort, "observeTarget" | "mintStack"> = {
    observeTarget: () =>
      Promise.resolve(
        over.observed ?? {
          observed: "Target",
          target: { ref: asGitRefName("refs/heads/main"), commit: tip },
        },
      ),
    mintStack: (minting) => {
      mints.push(minting);
      return Promise.resolve(
        over.minted ?? {
          minted: "Stack",
          commit: stackCommit,
          tree: stackTree,
        },
      );
    },
  };
  return {
    mints,
    reads,
    ports: {
      store,
      git,
      bindings: {
        binding: () =>
          Promise.resolve({
            partition,
            repository,
            recoveryEpoch: asRecoveryEpoch("epoch"),
          }),
      },
      briefs: {
        brief: () =>
          Promise.resolve(
            asDraftBrief({
              intent: "intent",
              links: [],
              repository,
              finalization: { mode: "Push" },
              landing: over.policy ?? "Stacked",
            }),
          ),
      },
    },
  };
}

const ask = (c: Case, cycle = 1) =>
  evaluationStacking(c.ports).stackOf({
    partition,
    ticket,
    cycle,
    repository,
    commit: own,
  });

test("the first evaluation of a cycle chooses the stack, mints it and hands back the record to write", async () => {
  const c = caseOf();
  const stacked = await ask(c);
  assert.deepEqual(stacked, {
    fresh: true,
    record: {
      ticket,
      cycle: 1,
      repository,
      target: "refs/heads/main",
      tip,
      beneath: [{ ticket: asTicketId(1), commit: holder }],
      stackCommit,
      stackTree,
    },
  });
  assert.equal(c.mints.length, 1);
  assert.deepEqual(c.mints[0]?.beneath, [holder]);
  assert.equal(c.mints[0]?.candidate, own);
  assert.equal(c.mints[0]?.tip.commit, tip);
  assert.equal(c.mints[0]?.ref, "refs/heads/chuggy/stack/2/1");
});

test("a cycle that has a record reads it and mints nothing", async () => {
  const record: EvaluationStack = {
    ticket,
    cycle: 1,
    repository,
    target: "refs/heads/main",
    tip,
    beneath: [{ ticket: asTicketId(1), commit: holder }],
    stackCommit,
    stackTree,
  };
  const c = caseOf({ recorded: record });
  assert.deepEqual(await ask(c), { record, fresh: false });
  assert.deepEqual(c.mints, []);
  assert.deepEqual(c.reads, ["read"]);
});

test("a cycle that began evaluating unstacked stays unstacked and mints nothing", async () => {
  const c = caseOf({ evaluated: true });
  assert.equal(await ask(c), undefined);
  assert.deepEqual(c.mints, []);
  assert.deepEqual(c.reads, ["read", "evaluated"]);
});

test("only a Stacked ticket stacks, and the queue is not read for any other", async () => {
  for (const policy of ["Serialized", "Direct"] as const) {
    const c = caseOf({ policy });
    assert.equal(await ask(c), undefined, policy);
    assert.deepEqual(c.mints, []);
    assert.ok(!c.reads.includes("queue"));
  }
});

test("nothing ahead, or a ticket at its failure cap, is evaluated unstacked", async () => {
  for (const c of [caseOf({ queue: [] }), caseOf({ failures: 2 })]) {
    assert.equal(await ask(c), undefined);
    assert.deepEqual(c.mints, []);
  }
});

test("a barrier ahead is evaluated unstacked", async () => {
  const barrier: StackEntry = {
    ...holderEntry,
    ticket: asTicketId(3),
    phase: "Work",
    rank: 2,
  };
  const c = caseOf({ queue: [holderEntry, barrier] });
  assert.equal(await ask(c), undefined);
  assert.deepEqual(c.mints, []);
});

test("a merge that conflicts or a push the remote refuses is evaluated unstacked", async () => {
  for (const minted of [
    { minted: "Conflicted" },
    { minted: "Failed", evidence: "RemoteDeclined" },
  ] as const) {
    const c = caseOf({ minted });
    assert.equal(await ask(c), undefined);
    assert.equal(c.mints.length, 1);
  }
});

test("a target nobody can read, or a queue too large to read, is evaluated unstacked", async () => {
  const unread = caseOf({
    observed: { observed: "Unreadable", evidence: "RemoteUnreachable" },
  });
  assert.equal(await ask(unread), undefined);
  assert.deepEqual(unread.mints, []);
  const large = caseOf({ queueFails: true });
  assert.equal(await ask(large), undefined);
  assert.deepEqual(large.mints, []);
});

test("a stack's ref sits under the heads a plain clone fetches, one per ticket and cycle", () => {
  assert.equal(stackRefOf(7, 3), "refs/heads/chuggy/stack/7/3");
});
