/**
 * `stackRestack.ts` against the re-stack scenarios of
 * `model/tests/stacking_test.qnt`, each replayed as the queue it reaches and
 * whether the pending ticket is sent back over it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  stackDepthMax,
  stackFailuresMax,
  type StackEntry,
  type StackMember,
} from "../../src/interpreter/stackChoice.ts";
import { entry, member } from "./stackQueueFixture.ts";
import {
  restackLine,
  type RestackCandidate,
} from "../../src/interpreter/stackRestack.ts";

/** A Stacked ticket that passed over `beneath` with nothing landed since. */
function stacked(ticket: number, beneath: readonly number[]): StackEntry {
  return entry(ticket, "Stacked", "Pending", {
    stack: { beneath: beneath.map((at) => member(at)), landings: [] },
  });
}

function candidate(
  ticket: number,
  over: Partial<RestackCandidate> = {},
): RestackCandidate {
  return {
    ticket: asTicketId(ticket),
    stackFailures: 0,
    restackedOver: undefined,
    ...over,
  };
}

const tickets = (line: readonly StackMember[] | undefined) =>
  line?.map((one) => Number(one.ticket));

test("unstackedBehindAPendingHolderRestacksAndLandsNext: a pending unstacked ticket behind a pending holder is sent back over it", () => {
  for (const holder of ["Serialized", "Stacked"] as const) {
    const queue = [entry(1, holder, "Pending"), entry(2, "Stacked", "Pending")];
    assert.deepEqual(tickets(restackLine(candidate(2), queue)), [1]);
  }
});

test("a holder still evaluating is a member, so the ticket behind it is sent back over it", () => {
  const queue = [
    entry(1, "Stacked", "Evaluation"),
    entry(2, "Stacked", "Pending"),
  ];
  assert.deepEqual(tickets(restackLine(candidate(2), queue)), [1]);
});

test("the holder, a ticket already stacked and a ticket not pending are never sent back", () => {
  assert.equal(
    restackLine(candidate(1), [entry(1, "Stacked", "Pending")]),
    undefined,
  );
  assert.equal(
    restackLine(candidate(2), [
      entry(1, "Stacked", "Pending"),
      stacked(2, [1]),
    ]),
    undefined,
  );
  for (const phase of ["Work", "Ready", "Evaluation"] as const) {
    assert.equal(
      restackLine(candidate(2), [
        entry(1, "Stacked", "Pending"),
        entry(2, "Stacked", phase),
      ]),
      undefined,
    );
  }
  assert.equal(
    restackLine(candidate(2), [entry(1, "Stacked", "Pending")]),
    undefined,
  );
});

test("a Serialized ticket is never sent back", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Serialized", "Pending"),
  ];
  assert.equal(restackLine(candidate(2), queue), undefined);
});

test("noRestackBehindAHolderInWork: a holder in Work or Ready is no member", () => {
  for (const phase of ["Work", "Ready"] as const) {
    const queue = [entry(1, "Stacked", phase), entry(2, "Stacked", "Pending")];
    assert.equal(restackLine(candidate(2), queue), undefined);
  }
});

test("restacksGoOneAtATimeFromTheHolder: a non-holder ahead that is evaluating or unstacked holds the one behind it", () => {
  for (const second of [
    entry(2, "Stacked", "Evaluation"),
    entry(2, "Stacked", "Pending"),
    entry(2, "Stacked", "Work"),
  ]) {
    const queue = [
      entry(1, "Stacked", "Pending"),
      second,
      entry(3, "Stacked", "Pending"),
    ];
    assert.equal(restackLine(candidate(3), queue), undefined);
  }
  const restacked = [
    entry(1, "Stacked", "Pending"),
    stacked(2, [1]),
    entry(3, "Stacked", "Pending"),
  ];
  assert.deepEqual(tickets(restackLine(candidate(3), restacked)), [1, 2]);
});

test("noRestackPastASerializedBarrier: a Serialized entry past the holder holds the one behind it", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Serialized", "Pending"),
    entry(3, "Stacked", "Pending"),
  ];
  assert.equal(restackLine(candidate(3), queue), undefined);
});

test("noRestackDeeperThanTheDepth: more than the depth ahead is not sent back", () => {
  const ahead = [entry(1, "Stacked", "Pending")];
  for (let ticket = 2; ticket <= stackDepthMax + 1; ticket += 1)
    ahead.push(
      stacked(
        ticket,
        ahead.map((each) => Number(each.ticket)),
      ),
    );
  const behind = stackDepthMax + 2;
  assert.equal(
    restackLine(candidate(behind), [
      ...ahead,
      entry(behind, "Stacked", "Pending"),
    ]),
    undefined,
  );
  const atDepth = ahead.slice(0, stackDepthMax);
  assert.equal(
    restackLine(candidate(stackDepthMax + 1), [
      ...atDepth,
      entry(stackDepthMax + 1, "Stacked", "Pending"),
    ])?.length,
    stackDepthMax,
  );
});

test("noRestackAtTheFailureCap: a ticket at its stacked-failure cap is not sent back", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Stacked", "Pending"),
  ];
  assert.equal(
    restackLine(candidate(2, { stackFailures: stackFailuresMax }), queue),
    undefined,
  );
  assert.deepEqual(
    tickets(
      restackLine(candidate(2, { stackFailures: stackFailuresMax - 1 }), queue),
    ),
    [1],
  );
});

test("restackEndingUnstackedWaitsForTheLineToChange: the line last sent back over is not sent back over again", () => {
  const queue = [
    entry(1, "Stacked", "Pending"),
    stacked(2, [1]),
    entry(3, "Stacked", "Pending"),
  ];
  assert.equal(
    restackLine(candidate(3, { restackedOver: [member(1), member(2)] }), queue),
    undefined,
  );
  for (const changed of [
    [member(1, 2), member(2)],
    [member(1)],
    [member(2), member(1)],
  ])
    assert.deepEqual(
      tickets(restackLine(candidate(3, { restackedOver: changed }), queue)),
      [1, 2],
    );
});
