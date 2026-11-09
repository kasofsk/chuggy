/**
 * `stackInvalidations` over the scenarios of `model/stacking.qnt`'s `sweep` that
 * concern a ticket in an evaluation: a stack that stands is left alone, one
 * whose beneath ticket landed out of order, left the queue or was reworked is
 * invalidated, and the answer depends on nothing but the data it is given.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import type { EvaluatingStack } from "../../src/interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type {
  StackEntry,
  StackMember,
  StackPhase,
} from "../../src/interpreter/stackChoice.ts";
import { stackInvalidations } from "../../src/interpreter/stackInvalidation.ts";

function commit(number: number) {
  return asGitObjectId(number.toString(16).padStart(40, "0"));
}

function member(ticket: number, at = 1): StackMember {
  return { ticket: asTicketId(ticket), commit: commit(ticket * 100 + at) };
}

function entry(ticket: number, phase: StackPhase, at = 1): StackEntry {
  return {
    ticket: asTicketId(ticket),
    policy: "Stacked",
    phase,
    rank: ticket,
    commit: member(ticket, at).commit,
    stack: undefined,
  };
}

function evaluating(
  ticket: number,
  beneath: readonly StackMember[],
  landings: readonly StackMember[] = [],
): EvaluatingStack {
  return {
    partition: {
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
    },
    ticket: asTicketId(ticket),
    cycle: 1,
    repository: "repository",
    target: undefined,
    standing: { beneath, landings },
  };
}

test("a stack whose beneath tickets are still evaluated or pending at its commits stands", () => {
  const over = evaluating(3, [member(1), member(2)]);
  assert.deepEqual(
    stackInvalidations([over], [entry(1, "Evaluation"), entry(2, "Pending")]),
    [],
  );
});

test("a stack whose beneath ticket landed in order stands, and out of order does not", () => {
  const over = evaluating(3, [member(1), member(2)], [member(1)]);
  assert.deepEqual(stackInvalidations([over], [entry(2, "Pending")]), []);
  const crossed = evaluating(3, [member(1), member(2)], [member(2)]);
  assert.deepEqual(stackInvalidations([crossed], [entry(1, "Pending")]), [
    crossed,
  ]);
});

test("a beneath ticket gone from the queue, reworked to another commit or sent back to work invalidates the stack", () => {
  const over = evaluating(2, [member(1)]);
  assert.deepEqual(stackInvalidations([over], []), [over], "gone");
  assert.deepEqual(
    stackInvalidations([over], [entry(1, "Evaluation", 2)]),
    [over],
    "another commit",
  );
  assert.deepEqual(
    stackInvalidations([over], [entry(1, "Work")]),
    [over],
    "back at work",
  );
});

test("only the stacks that do not stand are named, in the order they were given, and the answer is deterministic", () => {
  const stands = evaluating(2, [member(1)]);
  const falls = evaluating(4, [member(3)]);
  const alsoFalls = evaluating(5, [member(1), member(3)]);
  const queue = [entry(1, "Evaluation")];
  const first = stackInvalidations([stands, falls, alsoFalls], queue);
  assert.deepEqual(first, [falls, alsoFalls]);
  assert.deepEqual(
    stackInvalidations([stands, falls, alsoFalls], [...queue].reverse()),
    first,
  );
  assert.deepEqual(
    stackInvalidations([stands, falls, alsoFalls], queue),
    first,
  );
});
