/**
 * What an open native action offers, kind by kind over the whole roster.
 *
 * The rosters are walked rather than listed, so a kind or a resolution the wire
 * gains arrives here as a case with no expectation rather than as one nobody
 * looked at. The mapping is the pairing `src/contract/rosters.ts` publishes, so
 * an offer belonging to another kind is what these cases exist to catch.
 */

import { expect, test } from "vitest";

import {
  nativeActionKindResolutions,
  nativeActionKinds,
  nativeActionResolutions,
} from "../../../src/contract/rosters.ts";
import type {
  NativeActionKind,
  NativeActionResolution,
} from "../../../src/contract/rosters.ts";
import type { NativeActionResponse } from "../../../src/contract/responses.ts";
import {
  nativeActionAnswerName,
  nativeActionAnswers,
  nativeActionsAnswers,
} from "../app/core/nativeActionAnswers.ts";

const fence = 42;

function openAction(
  kind: NativeActionKind,
  admits: readonly NativeActionResolution[] = nativeActionKindResolutions[kind],
): NativeActionResponse {
  return {
    action: "action-one",
    kind,
    authorizingSequence: fence,
    admits: [...admits],
  };
}

const namedBy: Readonly<Record<NativeActionResolution, string>> = {
  Resume: "Resume",
  Revoke: "Revoke",
  RetryHandoff: "Retry",
  AbandonHandoff: "Abandon",
  Approve: "Approve",
  Decline: "Decline",
};

test("every resolution on the roster has a word of its own", () => {
  const named = nativeActionResolutions.map((resolution) =>
    nativeActionAnswerName(resolution),
  );
  expect(named).toStrictEqual(
    nativeActionResolutions.map((resolution) => namedBy[resolution]),
  );
  expect(new Set(named).size).toBe(nativeActionResolutions.length);
});

test("a kind offers its own answers and no other kind's", () => {
  for (const kind of nativeActionKinds) {
    const offered = nativeActionAnswers(openAction(kind)).map(
      (answer) => answer.action,
    );
    expect(offered).toStrictEqual(
      nativeActionKindResolutions[kind].map(
        (resolution) => namedBy[resolution],
      ),
    );
    for (const other of nativeActionKinds) {
      if (other === kind) continue;
      const foreign = nativeActionKindResolutions[other]
        .filter(
          (resolution) =>
            !nativeActionKindResolutions[kind].some(
              (own) => own === resolution,
            ),
        )
        .map((resolution) => namedBy[resolution]);
      for (const word of foreign) expect(offered).not.toContain(word);
    }
  }
});

test("a finalization approval offers approve before decline", () => {
  expect(
    nativeActionAnswers(openAction("FinalizationApproval")).map(
      (answer) => answer.action,
    ),
  ).toStrictEqual(["Approve", "Decline"]);
});

test("every answer resolves the action it was built from, at its own fence", () => {
  for (const kind of nativeActionKinds)
    for (const answer of nativeActionAnswers(openAction(kind)))
      expect(answer.mutation).toStrictEqual({
        mutation: "ResolveNativeAction",
        action: "action-one",
        authorizingSequence: fence,
        resolution: nativeActionKindResolutions[kind].find(
          (resolution) => namedBy[resolution] === answer.action,
        ),
      });
});

/** An escalation the machine has no resumption for admits only the revoke, and
 * the offers are what this action admits rather than what its kind may ask. */
test("an action admitting one answer offers exactly that one", () => {
  for (const kind of nativeActionKinds)
    for (const admitted of nativeActionKindResolutions[kind])
      expect(
        nativeActionAnswers(openAction(kind, [admitted])).map(
          (answer) => answer.action,
        ),
      ).toStrictEqual([namedBy[admitted]]);
});

test("the answers over a list are every action's, in the order it listed them", () => {
  const listed = nativeActionsAnswers([
    openAction("FinalizationApproval", ["Decline"]),
    { ...openAction("HandoffBlock"), action: "action-two" },
  ]);
  expect(listed.map((answer) => answer.action)).toStrictEqual([
    "Decline",
    "Retry",
    "Abandon",
  ]);
  expect(nativeActionsAnswers([])).toStrictEqual([]);
});
