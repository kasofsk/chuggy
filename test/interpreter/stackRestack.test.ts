/**
 * `stackRestack.ts` against the re-stack scenarios of
 * `model/tests/stacking_test.qnt`, each replayed as the queue it reaches and
 * whether the pending ticket is sent back over it, and its memo of the folds
 * that conflicted.
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
  restackForget,
  restackLine,
  restackRefuse,
  restackRefused,
  restackRefusals,
  restackRefusalsMax,
  type RestackCandidate,
  type RestackFold,
} from "../../src/interpreter/stackRestack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

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

/** A Stacked ticket pending over `beneath`, its stack broken by ticket 7 landing since its tip, though 7 was not first beneath it. */
function deadStacked(ticket: number, beneath: readonly number[]): StackEntry {
  return entry(ticket, "Stacked", "Pending", {
    stack: { beneath: beneath.map((at) => member(at)), landings: [member(7)] },
  });
}

test("a pending Stacked ticket whose stack stopped standing is sent back over the line it could now stack on", () => {
  const queue = [entry(1, "Stacked", "Evaluation"), deadStacked(2, [6])];
  assert.deepEqual(tickets(restackLine(candidate(2), queue)), [1]);
  const holderPending = [
    entry(1, "Serialized", "Pending"),
    deadStacked(2, [6]),
  ];
  assert.deepEqual(tickets(restackLine(candidate(2), holderPending)), [1]);
});

test("a pending ticket whose stack stands, the holder, and a line equal to its latest re-stack's are not sent back", () => {
  const standing = [
    entry(1, "Stacked", "Pending"),
    entry(2, "Stacked", "Pending", {
      stack: { beneath: [member(1)], landings: [] },
    }),
  ];
  assert.equal(restackLine(candidate(2), standing), undefined);
  assert.equal(
    restackLine(candidate(1), [
      deadStacked(1, [6]),
      entry(2, "Stacked", "Pending"),
    ]),
    undefined,
  );
  assert.equal(
    restackLine(candidate(2, { restackedOver: [member(1)] }), [
      entry(1, "Stacked", "Pending"),
      deadStacked(2, [6]),
    ]),
    undefined,
  );
});

test("a holder pending over a stack that stopped standing is no member, so nothing behind it is sent back over it", () => {
  for (const behind of [entry(2, "Stacked", "Pending"), deadStacked(2, [6])])
    assert.equal(
      restackLine(candidate(2), [deadStacked(1, [6]), behind]),
      undefined,
    );
});

test("a ticket behind one whose stack stopped standing waits until that one is pending over a stack that stands", () => {
  const holder = entry(1, "Stacked", "Evaluation");
  assert.equal(
    restackLine(candidate(3), [
      holder,
      deadStacked(2, [6]),
      deadStacked(3, [6]),
    ]),
    undefined,
  );
  assert.deepEqual(
    tickets(
      restackLine(candidate(3), [holder, stacked(2, [1]), deadStacked(3, [6])]),
    ),
    [1, 2],
  );
});

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

function fold(
  tip: string,
  line: readonly number[],
  accepted: string,
): RestackFold {
  return {
    tip: asGitObjectId(tip.repeat(40)),
    line: line.map((at) => member(at)),
    accepted: asGitObjectId(accepted.repeat(40)),
  };
}

test("a refused fold is refused over exactly its inputs, and over no tip, line or accepted commit that differs", () => {
  const refusals = restackRefusals();
  const refused = fold("a", [1], "c");
  restackRefuse(refusals, partition, asTicketId(2), refused);

  assert.equal(
    restackRefused(refusals, partition, asTicketId(2), refused),
    true,
  );
  for (const other of [
    fold("b", [1], "c"),
    fold("a", [3], "c"),
    fold("a", [1, 3], "c"),
    fold("a", [1], "d"),
  ])
    assert.equal(
      restackRefused(refusals, partition, asTicketId(2), other),
      false,
    );
  assert.equal(
    restackRefused(refusals, partition, asTicketId(3), refused),
    false,
  );

  restackForget(refusals, partition, asTicketId(2));
  assert.equal(
    restackRefused(refusals, partition, asTicketId(2), refused),
    false,
  );
});

test("the memo holds no more than its bound, forgetting the oldest refusal first", () => {
  const refusals = restackRefusals();
  for (let ticket = 1; ticket <= restackRefusalsMax + 1; ticket++)
    restackRefuse(refusals, partition, asTicketId(ticket), fold("a", [], "c"));

  assert.equal(refusals.folds.size, restackRefusalsMax);
  assert.equal(
    restackRefused(refusals, partition, asTicketId(1), fold("a", [], "c")),
    false,
  );
  assert.equal(
    restackRefused(
      refusals,
      partition,
      asTicketId(restackRefusalsMax + 1),
      fold("a", [], "c"),
    ),
    true,
  );
});
