/**
 * Where each phase lands and what each parked reason says, against the wire's
 * own rosters rather than against a list written here.
 *
 * The expectations are a total record over the roster, so a member the contract
 * gains fails to compile rather than going untested.
 */

import { expect, test } from "vitest";

import {
  escalationReasons,
  phaseRoster,
} from "../../../src/contract/rosters.ts";
import type {
  EscalationReason,
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
  Working: "InProgress",
  Evaluating: "InProgress",
  Finalizing: "InProgress",
  PublishingHandoff: "InProgress",
  HandoffBlocked: "NeedsYou",
  Done: "Done",
  Abandoned: "Stopped",
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

const badgeOfReason: Readonly<Record<EscalationReason, string>> = {
  WorkFailed: "work failed",
  ReworkBudgetExhausted: "rework budget spent",
  FinalizationBudgetExhausted: "finalization budget spent",
  GasExhausted: "gas spent",
  DependencyRevoked: "a dependency was revoked",
  ExecutionPolicyDenied: "execution policy denied it",
  TicketConfigIncompatible: "the configuration does not fit",
  ExecutionProfileUnavailable: "no execution profile fits",
  RuntimeVersionUnsupported: "the runtime version is unsupported",
  RequiredCapabilityUnavailable: "a required capability is missing",
};

test.each(escalationReasons)("the badge for %s says what it says", (reason) => {
  expect(escalationBadgeLabel(reason)).toBe(badgeOfReason[reason]);
});

test("no two reasons are drawn with the same badge", () => {
  const drawn = escalationReasons.map((reason) => escalationBadgeLabel(reason));
  expect(new Set(drawn).size).toBe(drawn.length);
});

test("an escalated row's badge is its reason and a blocked handoff's is its phase", () => {
  expect(ticketBadgeLabel("Escalated", "GasExhausted")).toBe("gas spent");
  expect(ticketBadgeLabel("HandoffBlocked", undefined)).toBe("handoff blocked");
});

test("a row with nothing to answer for carries no badge", () => {
  expect(ticketBadgeLabel("Working", undefined)).toBeUndefined();
});
