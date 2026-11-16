/**
 * `stackChoice.ts` against the scenarios of `model/tests/stacking_test.qnt`,
 * each replayed as the queue it reaches and the choice made over it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  stackDepthMax,
  stackFailuresMax,
  stackFor,
  stackStands,
  type StackCandidate,
  type StackEntry,
  type StackMember,
} from "../../src/interpreter/stackChoice.ts";
import { entry, member } from "./stackQueueFixture.ts";

function candidate(
  ticket: number,
  over: Partial<StackCandidate> = {},
): StackCandidate {
  return {
    ticket: asTicketId(ticket),
    policy: "Stacked",
    stackFailures: 0,
    rank: undefined,
    ...over,
  };
}

/** A Stacked ticket that passed over `beneath` with nothing landed since. */
function stacked(ticket: number, beneath: readonly number[]): StackEntry {
  return entry(ticket, "Stacked", "Pending", {
    stack: { beneath: beneath.map((at) => member(at)), landings: [] },
  });
}

const tickets = (stack: readonly StackMember[] | undefined) =>
  stack?.map((one) => Number(one.ticket));

test("a Stacked ticket stacks on the holder alone while the holder is in evaluation or pending", () => {
  for (const phase of ["Evaluation", "Pending"] as const) {
    assert.deepEqual(
      tickets(stackFor(candidate(2), [entry(1, "Stacked", phase)])),
      [1],
    );
  }
});

test("twoStackedLandInOrder: the second stacks on the first, which stacks on nothing", () => {
  const queue = [entry(1, "Stacked", "Pending")];
  assert.deepEqual(tickets(stackFor(candidate(2), queue)), [1]);
  assert.equal(stackFor(candidate(1), []), undefined);
});

test("a Direct-like empty queue and a non-Stacked ticket evaluate unstacked", () => {
  assert.equal(stackFor(candidate(2), []), undefined);
  assert.equal(
    stackFor(candidate(2, { policy: "Serialized" }), [
      entry(1, "Stacked", "Pending"),
    ]),
    undefined,
  );
});

test("a holder in Work or Ready is no member, so the ticket behind it evaluates unstacked", () => {
  for (const phase of ["Work", "Ready"] as const) {
    assert.equal(
      stackFor(candidate(2), [entry(1, "Serialized", phase)]),
      undefined,
    );
  }
});

test("stackedOnlyOnAHolderInEvaluation: a non-holder still in evaluation is no member", () => {
  const queue = [
    entry(1, "Serialized", "Pending"),
    entry(2, "Stacked", "Evaluation"),
  ];
  assert.equal(stackFor(candidate(3), queue), undefined);
});

test("serializedWaiterIsABarrier: a Serialized entry past the holder stops the stack", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Serialized", "Pending"),
  ];
  assert.equal(stackFor(candidate(3), queue), undefined);
});

test("a Stacked entry pending over exactly the entries before it is a member", () => {
  const queue = [entry(1, "Stacked", "Pending"), stacked(2, [1])];
  assert.deepEqual(tickets(stackFor(candidate(3), queue)), [1, 2]);
});

test("a Stacked entry pending over a different line, or over none, is no member", () => {
  const unstackedSecond = entry(2, "Stacked", "Pending");
  assert.equal(
    stackFor(candidate(3), [entry(1, "Stacked", "Pending"), unstackedSecond]),
    undefined,
  );
  assert.equal(
    stackFor(candidate(4), [
      entry(1, "Stacked", "Pending"),
      entry(2, "Serialized", "Pending"),
      stacked(3, [1, 2]),
    ]),
    undefined,
  );
  assert.equal(
    stackFor(candidate(3), [entry(1, "Stacked", "Pending"), stacked(2, [9])]),
    undefined,
  );
});

test("a member's stack names the commits the entries before it hold now", () => {
  const moved = entry(1, "Stacked", "Pending", { commit: member(1, 2).commit });
  assert.equal(stackFor(candidate(3), [moved, stacked(2, [1])]), undefined);
});

test("stackDepthIsBounded: the line holds at most the depth, and one more is unstacked", () => {
  const line = (count: number): StackEntry[] =>
    Array.from({ length: count }, (_, at) =>
      at === 0
        ? entry(1, "Serialized", "Pending")
        : stacked(
            at + 1,
            Array.from({ length: at }, (_, below) => below + 1),
          ),
    );
  assert.equal(stackDepthMax, 3);
  assert.deepEqual(tickets(stackFor(candidate(9), line(3))), [1, 2, 3]);
  assert.equal(stackFor(candidate(9), line(4)), undefined);
});

test("failureCapUnstacksTheNextEvaluation: at the cap the ticket evaluates unstacked", () => {
  const queue = [entry(1, "Serialized", "Pending")];
  assert.equal(stackFailuresMax, 2);
  assert.deepEqual(
    tickets(stackFor(candidate(2, { stackFailures: 1 }), queue)),
    [1],
  );
  assert.equal(
    stackFor(candidate(2, { stackFailures: stackFailuresMax }), queue),
    undefined,
  );
});

test("a ticket keeping its rank through a re-evaluation stacks on those ranked before it only", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Stacked", "Evaluation"),
    entry(3, "Serialized", "Pending"),
  ];
  assert.deepEqual(tickets(stackFor(candidate(2, { rank: 2 }), queue)), [1]);
  assert.equal(stackFor(candidate(3, { rank: 3 }), queue), undefined);
});

test("ejectingTheMiddleRestacks: with the middle gone the one behind stacks on the first alone", () => {
  const before = [
    entry(1, "Stacked", "Pending"),
    stacked(2, [1]),
    stacked(3, [1, 2]),
  ];
  assert.equal(
    stackStands({ beneath: [member(1), member(2)], landings: [] }, [
      before[0] as StackEntry,
    ]),
    false,
  );
  assert.deepEqual(
    tickets(stackFor(candidate(3, { rank: 3 }), [before[0] as StackEntry])),
    [1],
  );
});

test("stands: landings that are a prefix of beneath at the same commits stand while the rest is pending", () => {
  const beneath = [member(1), member(2), member(3)];
  const queue = [
    entry(2, "Stacked", "Pending"),
    entry(3, "Stacked", "Evaluation"),
  ];
  assert.equal(stackStands({ beneath, landings: [] }, queue), false);
  assert.equal(stackStands({ beneath, landings: [member(1)] }, queue), true);
  assert.equal(
    stackStands({ beneath, landings: [member(1), member(2)] }, queue),
    true,
  );
});

test("stands: a landing out of order, at another commit, or past beneath breaks it", () => {
  const beneath = [member(1), member(2)];
  const queue = [entry(2, "Stacked", "Pending")];
  assert.equal(
    stackStands({ beneath, landings: [member(7)] }, queue),
    false,
    "another ticket landed first",
  );
  assert.equal(
    stackStands({ beneath, landings: [member(1, 2)] }, queue),
    false,
    "the right ticket landed at another commit",
  );
  assert.equal(
    stackStands({ beneath, landings: [member(1), member(2), member(3)] }, []),
    false,
    "something landed after the whole stack",
  );
  assert.equal(
    stackStands({ beneath, landings: [member(1), member(2)] }, []),
    true,
    "all of it landed",
  );
});

test("stands: a remaining member that left the queue, was reworked or moved its commit breaks it", () => {
  const beneath = [member(1), member(2)];
  const stands = (queue: StackEntry[]) =>
    stackStands({ beneath, landings: [member(1)] }, queue);
  assert.equal(stands([entry(2, "Stacked", "Pending")]), true);
  assert.equal(stands([]), false, "ejected or failed");
  assert.equal(stands([entry(2, "Stacked", "Work")]), false, "sent back");
  assert.equal(stands([entry(2, "Stacked", "Ready")]), false, "not started");
  assert.equal(
    stands([entry(2, "Stacked", "Pending", { commit: member(2, 2).commit })]),
    false,
    "reported again",
  );
});

test("directLandingInvalidatesAStack: a landing no stack names breaks every stack built on the old tip", () => {
  const queue = [entry(2, "Serialized", "Pending")];
  const standing = { beneath: [member(2)], landings: [member(1)] };
  assert.equal(stackStands(standing, queue), false);
  assert.equal(
    stackFor(candidate(3), [
      entry(2, "Serialized", "Pending"),
      entry(4, "Stacked", "Pending", { rank: 4, stack: standing }),
    ]),
    undefined,
    "the entry past the ticket is no member either",
  );
});

test("an entry behind the candidate is not in its line", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(5, "Stacked", "Pending"),
  ];
  assert.deepEqual(tickets(stackFor(candidate(3, { rank: 3 }), queue)), [1]);
});

test("ranks tie-break by ticket so two orders cannot disagree", () => {
  const queue = [
    entry(2, "Serialized", "Pending", { rank: 5 }),
    entry(1, "Serialized", "Pending", { rank: 5 }),
  ];
  assert.equal(stackFor(candidate(3), queue), undefined);
});
