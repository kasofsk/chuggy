/**
 * What each parked reason says, against the wire's own rosters rather than
 * against a list written here.
 *
 * The expectations are a total record over the roster, so a member the contract
 * gains fails to compile rather than going untested.
 */

import { expect, test } from "vitest";

import { escalationKinds } from "../../../src/contract/rosters.ts";
import type { EscalationKind } from "../../../src/contract/rosters.ts";
import {
  escalationBadgeLabel,
  ticketBadgeLabel,
} from "../app/core/ticketSections.ts";

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
