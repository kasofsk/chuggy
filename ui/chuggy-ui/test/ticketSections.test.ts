/**
 * What a parked row's badge says, against the wire's own rosters rather than
 * against a list written here.
 *
 * A badge is the label the ledger page draws its escalation in, so each kind
 * has one message wherever it is drawn.
 */

import { expect, test } from "vitest";

import { escalationKinds } from "../../../src/contract/rosters.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { escalationKindLabel, phaseLabel } from "../app/core/codeLabels.ts";
import { ticketBadgeLabel } from "../app/core/ticketSections.ts";

/** What a badge reads as, or nothing where the row carries none. */
function badgeText(
  ...badged: Parameters<typeof ticketBadgeLabel>
): string | undefined {
  const label = ticketBadgeLabel(...badged);
  return label === undefined ? undefined : copyTextEn(label);
}

test.each(escalationKinds)(
  "the badge for %s is the escalation kind's own message",
  (kind) => {
    expect(
      ticketBadgeLabel("Escalated", { kind, resumeAt: "ResumeWork" }),
    ).toStrictEqual(escalationKindLabel(kind));
  },
);

test("each escalation kind is one message of its own", () => {
  const ids = escalationKinds.map((kind) => escalationKindLabel(kind).id);
  expect(new Set(ids).size).toBe(escalationKinds.length);
});

test("an escalated row's badge reads as its kind's label", () => {
  expect(
    badgeText("Escalated", {
      kind: "EvaluationFailureEscalated",
      resumeAt: "ResumeRework",
    }),
  ).toBe("Rework budget exhausted");
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
    expect(badgeText("Escalated", { kind, resumeAt: "ResumeWork", lost })).toBe(
      "Lost on runner",
    );
});

test("a row whose run stopped at a failed step names the step", () => {
  for (const [evidence, badge] of [
    ["RunPushFailed", "Push failed"],
    ["RunTimedOut", "Timed out"],
    ["RunDiskLow", "Disk low"],
  ] as const) {
    expect(
      badgeText("Escalated", {
        kind: "WorkFailureEscalated",
        resumeAt: "ResumeWork",
        failed: { evidence, execution: "execution-1", attempt: "attempt-1" },
      }),
    ).toBe(badge);
  }
});

test("an escalated row whose kind did not arrive still says it is escalated", () => {
  expect(ticketBadgeLabel("Escalated", undefined)).toStrictEqual(
    phaseLabel("Escalated"),
  );
});

test("a row with nothing to answer for carries no badge", () => {
  expect(ticketBadgeLabel("Work", undefined)).toBeUndefined();
});
