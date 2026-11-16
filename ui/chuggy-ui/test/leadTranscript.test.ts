/**
 * The lead page's own derivations: the one line a decision or a refusal is
 * read as, and the words its rosters are drawn as.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import {
  agenticRefusalStanding,
  agenticRefusalStandingLabel,
  agenticRefusalStandings,
  leadDecisionsNewestFirst,
  leadDecisionSummary,
  leadDispatchLanded,
  leadSessionStateLabel,
  leadTurnFailureLabel,
  leadTurnInputKindLabel,
  leadTurnStateLabel,
  selectorAttentionLabel,
} from "../app/core/leadTranscript.ts";
import {
  selectorAttentions,
  sessionStates,
  sessionTurnFailures,
  sessionTurnInputKinds,
  sessionTurnStates,
} from "../../../src/contract/rosters.ts";
import type { AgenticRefusalResponse } from "../../../src/contract/responses.ts";
import {
  leadDecisionDispatching,
  leadDecisionIdle,
  leadDecisionLanding,
  leadDecisionRefusedEvery,
  leadDecisionRefusing,
  leadHistory,
  leadRefusals,
} from "./leadFixture.ts";

function refusalAt(superseded: boolean): AgenticRefusalResponse {
  const held = leadRefusals(superseded).refusals[0];
  if (held === undefined) throw new Error("the fixture has no refusal");
  return held;
}

test("a decision says what it did, and says so when it did nothing", () => {
  expect(leadDecisionSummary(leadDecisionRefusing, copyTextEn)).toBe(
    "Attention · 1 refused",
  );
  expect(leadDecisionSummary(leadDecisionDispatching, copyTextEn)).toBe(
    "Monitoring · 0 of 1 dispatched · 1 lifted",
  );
  expect(leadDecisionSummary(leadDecisionIdle, copyTextEn)).toBe("None");
});

/**
 * THE SUMMARY COUNTS THE LANDINGS AND THE CHOICES SEPARATELY, and both from the
 * answer. A decision that named three dispatches and landed one did not
 * dispatch three; a line built from the length of the list alone says it did,
 * which is the reading the log had while the record could not tell.
 */
test("a decision's summary says how many of its dispatches landed", () => {
  expect(leadDecisionSummary(leadDecisionLanding, copyTextEn)).toBe(
    "Monitoring · 1 of 3 dispatched · 1 refused",
  );
  expect(leadDecisionSummary(leadDecisionRefusedEvery, copyTextEn)).toBe(
    "Attention · 0 of 2 dispatched · 1 refused",
  );
});

/**
 * The figure is derived and not written down: a decision the record says landed
 * every dispatch of reads as all of them, and the same decision with one
 * outcome changed reads as one fewer, from the same code.
 */
test("the landing figure follows the record it is read from", () => {
  const dispatches = leadDecisionLanding.dispatches.map((dispatch) => ({
    ...dispatch,
    state: "Terminal" as const,
    outcome: "Succeeded",
  }));
  expect(
    leadDecisionSummary({ ...leadDecisionLanding, dispatches }, copyTextEn),
  ).toContain("3 of 3 dispatched");
  expect(
    leadDecisionSummary(
      {
        ...leadDecisionLanding,
        dispatches: dispatches.slice(1),
      },
      copyTextEn,
    ),
  ).toContain("2 of 2 dispatched");
});

/** What the pills say and what the summary counts are one predicate, so a group
 * whose rows say `Dispatched` and whose line says none landed cannot be drawn. */
test("a dispatch has landed exactly where the record says the writer took it", () => {
  expect(
    leadDecisionLanding.dispatches.map((dispatch) =>
      leadDispatchLanded(dispatch),
    ),
  ).toStrictEqual([false, true, false]);
  expect(
    leadDispatchLanded({ ticket: 1, state: "Submitted", outcome: "Succeeded" }),
    "a delivery still in flight was counted as one that landed",
  ).toBe(false);
  expect(leadDispatchLanded({ ticket: 1, state: "Terminal" })).toBe(false);
});

/**
 * THE ACCEPTANCE IS A CLOSED SET AND THE WIRE'S `outcome` IS NOT A ROSTER. It
 * is a free string the writer fills from a command's refusal code, from its
 * operation state or from the word the door accepted it as, so a predicate
 * reading "settled and not a refusal code" as a landing counts a cancellation,
 * an answer and a command the door would not read as dispatches that went.
 */
test.each([
  "Cancelled",
  "Answered",
  "Refused",
  "IdempotencyConflict",
  "InvalidCommand",
  "SelectionChanged",
])("a dispatch settled on %s did not land", (outcome) => {
  expect(leadDispatchLanded({ ticket: 1, state: "Terminal", outcome })).toBe(
    false,
  );
});

test("a refusal stands until the ticket is authored again", () => {
  expect(agenticRefusalStanding(refusalAt(false))).toBe("Standing");
  expect(agenticRefusalStanding(refusalAt(true))).toBe("Superseded");
});

/** A route that answered the log's other end would put a months-old decision at
 * the top of the panel, so which one is newest is read off the ordinals. */
test("the decisions are ordered by ordinal whichever way the page arrived", () => {
  const ascending = [leadDecisionRefusing, leadDecisionDispatching];
  expect(
    leadDecisionsNewestFirst(ascending).map((decision) => decision.ordinal),
  ).toStrictEqual([1_202, 1_201]);
  expect(
    leadDecisionsNewestFirst(leadHistory.decisions).map(
      (decision) => decision.ordinal,
    ),
  ).toStrictEqual([1_202, 1_201]);
});

/**
 * EVERY SESSION STATE, ATTENTION, REFUSAL STANDING, TURN INPUT KIND, TURN
 * STATE AND TURN FAILURE DRAWS A LABEL. The lead page and the questions panel
 * draw these rosters as the wire names them, and a member gained to one must
 * not reach a reader as an unworded code.
 */
test("every session state, attention, standing, turn input kind, turn state and turn failure has a label", () => {
  const drawn = [
    ...sessionStates.map((each) => copyTextEn(leadSessionStateLabel(each))),
    ...selectorAttentions.map((each) =>
      copyTextEn(selectorAttentionLabel(each)),
    ),
    ...agenticRefusalStandings.map((each) =>
      copyTextEn(agenticRefusalStandingLabel(each)),
    ),
    ...sessionTurnInputKinds.map((each) =>
      copyTextEn(leadTurnInputKindLabel(each)),
    ),
    ...sessionTurnStates.map((each) => copyTextEn(leadTurnStateLabel(each))),
    ...sessionTurnFailures.map((each) =>
      copyTextEn(leadTurnFailureLabel(each)),
    ),
  ];
  for (const label of drawn) expect(label.length).toBeGreaterThan(0);
});

test("a turn's input kind the mailbox calls UserMessage reads as a message", () => {
  expect(copyTextEn(leadTurnInputKindLabel("UserMessage"))).toBe("Message");
});
