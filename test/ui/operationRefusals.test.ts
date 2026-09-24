/**
 * Every refusal a settled operation can carry, built by the boundary's own
 * operation response and followed by the console to the sentence and label a
 * reader is shown.
 *
 * The refusals are the interpreter's own, one per machine code and every
 * boundary code, so a code the server gains reaches this suite through its
 * roster rather than through a list written here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { operationResponse } from "../../src/adapters/http/outcomes.ts";
import { operationResponseSchema } from "../../src/contract/responses.ts";
import { operationRefusalCodes } from "../../src/contract/rosters.ts";
import {
  allBoundaryRefusalCodes,
  boundaryRefusal,
  type Refusal,
} from "../../src/interpreter/refusal.ts";
import {
  refusedOperation,
  ticketRefusals,
} from "../contract/representations.ts";
import { operationStepLabel } from "../../ui/chuggy-ui/app/core/codeLabels.ts";
import { operationRefusalSentence } from "../../ui/chuggy-ui/app/core/codeSentences.ts";
import {
  operationAdvanced,
  operationFollowing,
} from "../../ui/chuggy-ui/app/core/operationFollow.ts";

const refusals: readonly Refusal[] = [
  ...Object.values(ticketRefusals),
  ...allBoundaryRefusalCodes.map(boundaryRefusal),
];

/** What the console settles on after polling the operation this refusal settled. */
function settledOn(refusal: Refusal) {
  const body = operationResponseSchema.parse(
    operationResponse(refusedOperation(refusal)).body,
  );
  const step = operationAdvanced(operationFollowing("operation-one"), {
    event: "Polled",
    operation: body,
  });
  assert.ok(step.step === "Settled", `${refusal.type} did not settle`);
  return step;
}

test("every refusal the boundary can answer an operation with reaches a reader", () => {
  const seen = new Set<string>();
  for (const refusal of refusals) {
    const step = settledOn(refusal);
    assert.ok(step.refusal !== undefined);
    const sentence = operationRefusalSentence(step.refusal);
    const label = operationStepLabel(step, "Dispatch").text;
    for (const code of operationRefusalCodes) {
      assert.ok(!sentence.includes(code), `${refusal.type}: ${sentence}`);
      assert.ok(!label.includes(code), `${refusal.type}: ${label}`);
    }
    if ("value" in refusal)
      assert.ok(sentence.includes("#3"), `${refusal.type}: ${sentence}`);
    seen.add(step.refusal.type);
  }
  assert.deepEqual([...seen].sort(), [...operationRefusalCodes].sort());
});

test("a refusal over dependencies reaches the reader with each one named", () => {
  const step = settledOn(ticketRefusals.DependenciesNotFound);
  assert.ok(step.refusal !== undefined);
  const sentence = operationRefusalSentence(step.refusal);
  for (const ticket of ["#3", "#5", "#7"])
    assert.ok(sentence.includes(ticket), sentence);
});
