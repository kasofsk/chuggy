/**
 * Where each phase lands and what each parked reason says, against the wire's
 * own rosters rather than against a list written here.
 *
 * The expectations are a total record over the roster, so a member the contract
 * gains fails to compile rather than going untested.
 */

import { expect, test } from "vitest";

import { escalationKinds, phaseRoster } from "../../../src/contract/rosters.ts";
import type {
  EscalationKind,
  TicketPhase,
} from "../../../src/contract/rosters.ts";
import {
  escalationBadgeLabel,
  ticketBadgeLabel,
  ticketSectionOf,
  ticketSectionPhases,
  ticketSectionRoster,
} from "../app/core/ticketSections.ts";
import type { TicketSection } from "../app/core/ticketSections.ts";

const sectionOfPhase: Readonly<Record<TicketPhase, TicketSection>> = {
  Pending: "UpNext",
  Work: "InProgress",
  Evaluation: "InProgress",
  Finalization: "InProgress",
  Done: "Done",
  Escalated: "NeedsYou",
  Revoked: "Stopped",
};

test.each(phaseRoster)(
  "a %s ticket lands in the section named for it",
  (phase) => {
    expect(ticketSectionOf(phase)).toBe(sectionOfPhase[phase]);
  },
);

test("the sections partition the roster, leaving no phase in two and none in none", () => {
  const gathered = ticketSectionRoster.flatMap((section) =>
    ticketSectionPhases(section),
  );
  expect([...gathered].sort()).toStrictEqual([...phaseRoster].sort());
});

const badgeOfKind: Readonly<Record<EscalationKind, string>> = {
  WorkFailureEscalated: "work failed",
  EvaluationFailureEscalated: "rework budget spent",
  WorkExecutionUnavailableEscalated: "execution unavailable",
  EvaluationBlockedEscalated: "evaluation blocked",
  FinalizationUnavailableEscalated: "finalization unavailable",
};

test.each(escalationKinds)("the badge for %s says what it says", (kind) => {
  expect(escalationBadgeLabel(kind)).toBe(badgeOfKind[kind]);
});

test("no two kinds are drawn with the same badge", () => {
  const drawn = escalationKinds.map((kind) => escalationBadgeLabel(kind));
  expect(new Set(drawn).size).toBe(drawn.length);
});

test("an escalated row's badge is its kind", () => {
  expect(ticketBadgeLabel("Escalated", "EvaluationFailureEscalated")).toBe(
    "rework budget spent",
  );
});

test("a row with nothing to answer for carries no badge", () => {
  expect(ticketBadgeLabel("Work", undefined)).toBeUndefined();
});

test("an escalated row whose kind did not arrive still says it is escalated", () => {
  expect(ticketBadgeLabel("Escalated", undefined)).toBe("escalated");
});
