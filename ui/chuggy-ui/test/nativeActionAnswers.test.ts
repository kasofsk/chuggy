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
} from "../../../src/contract/rosters.ts";
import type {
  NativeActionKind,
  NativeActionResolution,
} from "../../../src/contract/rosters.ts";
import type { NativeActionResponse } from "../../../src/contract/responses.ts";
import {
  approvalAnswerSendable,
  approvalAnswerWith,
  nativeActionAnswerKey,
  nativeActionAnswerName,
  nativeActionAnswers,
  nativeActionsAnswers,
} from "../app/core/nativeActionAnswers.ts";
import type { TicketActionName } from "../app/core/ticketActions.ts";

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
    answerable: true,
  };
}

type Pairing = {
  readonly [Kind in NativeActionKind]: Readonly<
    Record<(typeof nativeActionKindResolutions)[Kind][number], TicketActionName>
  >;
};

const namedByKind: Pairing = {
  TicketEscalation: { Resume: "Resume", Revoke: "Revoke" },
  FinalizationApproval: { Approve: "Approve", Decline: "Decline" },
  EvaluationApproval: { Approve: "ApproveEvaluation", Reject: "Reject" },
};

function namedBy(
  kind: NativeActionKind,
  resolution: NativeActionResolution,
): TicketActionName | undefined {
  return (namedByKind[kind] as Partial<Record<string, TicketActionName>>)[
    resolution
  ];
}

test("every answer a kind admits has a word of its own, an approval's by what it passes", () => {
  const named = nativeActionKinds.flatMap((kind) =>
    nativeActionKindResolutions[kind].map((resolution) =>
      nativeActionAnswerName(kind, resolution),
    ),
  );
  expect(named).toStrictEqual(
    nativeActionKinds.flatMap((kind) =>
      nativeActionKindResolutions[kind].map((resolution) =>
        namedBy(kind, resolution),
      ),
    ),
  );
  expect(new Set(named).size).toBe(named.length);
});

test("a kind offers its own answers and no other kind's", () => {
  for (const kind of nativeActionKinds) {
    const offered = nativeActionAnswers(openAction(kind)).map(
      (answer) => answer.action,
    );
    expect(offered).toStrictEqual(
      nativeActionKindResolutions[kind].map((resolution) =>
        namedBy(kind, resolution),
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
        .map((resolution) => namedBy(other, resolution));
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
          (resolution) => namedBy(kind, resolution) === answer.action,
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
      ).toStrictEqual([namedBy(kind, admitted)]);
});

test("the answers over a list are every action's, in the order it listed them", () => {
  const listed = nativeActionsAnswers([
    openAction("FinalizationApproval", ["Decline"]),
    { ...openAction("TicketEscalation"), action: "action-two" },
  ]);
  expect(listed.map((answer) => answer.action)).toStrictEqual([
    "Decline",
    "Resume",
    "Revoke",
  ]);
  expect(nativeActionsAnswers([])).toStrictEqual([]);
});

test("an evaluation approval is offered approve before reject where its caller may answer it, and nothing where they may not", () => {
  expect(
    nativeActionAnswers(openAction("EvaluationApproval")).map(
      (answer) => answer.action,
    ),
  ).toStrictEqual(["ApproveEvaluation", "Reject"]);
  expect(
    nativeActionAnswers({
      ...openAction("EvaluationApproval"),
      answerable: false,
    }),
  ).toStrictEqual([]);
});

test("the flag withholds no other kind's answers, which the abilities gate instead", () => {
  for (const kind of ["TicketEscalation", "FinalizationApproval"] as const)
    expect(
      nativeActionAnswers({ ...openAction(kind), answerable: false }).length,
    ).toBe(nativeActionKindResolutions[kind].length);
});

test("a rejection is sendable only with feedback the wire admits, and an approval with or without it", () => {
  expect(approvalAnswerSendable("Reject", "")).toBe(false);
  expect(approvalAnswerSendable("Reject", "   ")).toBe(false);
  expect(approvalAnswerSendable("Reject", "tests missing")).toBe(true);
  expect(approvalAnswerSendable("Reject", "a\u0007bell")).toBe(false);
  expect(approvalAnswerSendable("ApproveEvaluation", "")).toBe(true);
  expect(approvalAnswerSendable("ApproveEvaluation", "fine by me")).toBe(true);
});

test("an answer carries its feedback trimmed, and a blank note as none", () => {
  const [approve, reject] = nativeActionAnswers(
    openAction("EvaluationApproval"),
  );
  if (approve === undefined || reject === undefined)
    throw new Error("no answers");
  expect(approvalAnswerWith(approve, "  ").mutation).toStrictEqual(
    approve.mutation,
  );
  expect(approvalAnswerWith(reject, " redo the docs ").mutation).toStrictEqual({
    ...reject.mutation,
    feedback: "redo the docs",
  });
});

test("two actions' answers in the same word are told apart by the action each resolves", () => {
  const keys = nativeActionsAnswers([
    openAction("EvaluationApproval"),
    { ...openAction("EvaluationApproval"), action: "action-two" },
  ]).map(nativeActionAnswerKey);
  expect(new Set(keys).size).toBe(4);
});
