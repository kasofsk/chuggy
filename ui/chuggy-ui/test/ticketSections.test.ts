/**
 * Where each phase lands and what each parked reason says, against the wire's
 * own rosters rather than against a list written here.
 *
 * The expectations are a total record over the roster, so a member the contract
 * gains fails to compile rather than going untested.
 */

import { expect, test } from "vitest";

import { inboxPhases } from "../../../src/contract/http.ts";
import { escalationKinds, phaseRoster } from "../../../src/contract/rosters.ts";
import type {
  EscalationKind,
  TicketPhase,
} from "../../../src/contract/rosters.ts";
import {
  escalationBadgeLabel,
  ticketBadgeLabel,
  ticketSectionOf,
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

/** The server decides the inbox by the contract's phases, so the section that draws it is held to the same list. */
test("the Needs you section holds exactly the phases the inbox is read by", () => {
  expect(
    phaseRoster.filter((phase) => ticketSectionOf(phase) === "NeedsYou"),
  ).toStrictEqual(inboxPhases);
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
  expect(
    ticketBadgeLabel("Escalated", {
      kind: "EvaluationFailureEscalated",
      resumeAt: "ResumeRework",
    }),
  ).toBe("rework budget spent");
});

test("a row whose job was lost on its runner says so rather than what failed", () => {
  const lost = {
    runner: { kind: "Pool" as const, pool: "runner-a" },
    execution: "execution-1",
    attempt: "attempt-1",
    evidence: "RunFailed" as const,
    losses: 1,
    resumed: 0,
  };
  for (const kind of [
    "WorkFailureEscalated",
    "EvaluationBlockedEscalated",
  ] as const)
    expect(
      ticketBadgeLabel("Escalated", { kind, resumeAt: "ResumeWork", lost }),
    ).toBe("lost on runner");
});

test("a row whose run stopped at a failed step names the step", () => {
  for (const [evidence, badge] of [
    ["RunPushFailed", "push failed"],
    ["RunTimedOut", "timed out"],
    ["RunDiskLow", "disk low"],
  ] as const)
    expect(
      ticketBadgeLabel("Escalated", {
        kind: "WorkFailureEscalated",
        resumeAt: "ResumeWork",
        failed: { evidence, execution: "execution-1", attempt: "attempt-1" },
      }),
    ).toBe(badge);
});

test("a row with nothing to answer for carries no badge", () => {
  expect(ticketBadgeLabel("Work", undefined)).toBeUndefined();
});

test("an escalated row whose kind did not arrive still says it is escalated", () => {
  expect(ticketBadgeLabel("Escalated", undefined)).toBe("escalated");
});
