/**
 * What the finalizer prepares for a Stacked ticket's accepted work, over fakes
 * of what it reads and mints: a stack is chosen and minted, anything that keeps
 * one from being minted is a decision to evaluate unstacked with its reason,
 * and what cannot be asked about is left for the next pass.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  stackRefOf,
  type EvaluationStackStore,
} from "../../src/interpreter/evaluationStack.ts";
import {
  stackPrepared,
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
    queue: () => {
      reads.push("queue");
      return over.queueFails === true
        ? Promise.reject(new RangeError("the queue is too large"))
        : Promise.resolve(over.queue ?? [holderEntry]);
    },
    stackFailures: () => Promise.resolve(over.failures ?? 0),
  } satisfies Pick<EvaluationStackStore, "queue" | "stackFailures">;
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
  stackPrepared(c.ports, asRecoveryEpoch("epoch"), {
    partition,
    ticket,
    cycle,
    repository,
    commit: own,
  });

const unstacked = (reason: "Unchosen" | "Conflicted" | "Unpublished") => ({
  prepared: "Unstacked",
  ticket,
  cycle: 1,
  reason,
});

test("a Stacked ticket's accepted work chooses the stack, mints it and hands back the record", async () => {
  const c = caseOf();
  assert.deepEqual(await ask(c), {
    prepared: "Stack",
    stack: {
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

test("only a Stacked ticket stacks, and the queue is not read for any other", async () => {
  for (const policy of ["Serialized", "Direct"] as const) {
    const c = caseOf({ policy });
    assert.equal(await ask(c), undefined, policy);
    assert.deepEqual(c.mints, []);
    assert.deepEqual(c.reads, []);
  }
});

test("nothing ahead, or a ticket at its failure cap, is evaluated unstacked", async () => {
  for (const c of [caseOf({ queue: [] }), caseOf({ failures: 2 })]) {
    assert.deepEqual(await ask(c), unstacked("Unchosen"));
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
  assert.deepEqual(await ask(c), unstacked("Unchosen"));
  assert.deepEqual(c.mints, []);
});

test("a merge that conflicts or a push the remote refuses is evaluated unstacked", async () => {
  const cases = [
    [{ minted: "Conflicted" }, "Conflicted"],
    [{ minted: "Failed", evidence: "RemoteDeclined" }, "Unpublished"],
  ] as const;
  for (const [minted, reason] of cases) {
    const c = caseOf({ minted });
    assert.deepEqual(await ask(c), unstacked(reason));
    assert.equal(c.mints.length, 1);
  }
});

test("a target nobody can read, or a queue too large to read, is left for the next pass", async () => {
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
