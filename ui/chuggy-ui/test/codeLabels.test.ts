/**
 * The short labels the ledger page draws the wire's codes in.
 *
 * Every roster is walked, and each answer is held to the copy standard the
 * page is written to: a label is a noun phrase, a status is one or two words,
 * and nothing but a brief runs past the budget. A fallback is checked as a
 * fallback, because a code the console does not know must read as unknown
 * rather than as an explanation.
 */

import { expect, test } from "vitest";

import {
  blockedReasons,
  briefFinalizationModes,
  escalationKinds,
  finalizationUnavailableKinds,
  gitEvidences,
  operationRefusalCodes,
  operationStates,
  phaseRoster,
  resumePoints,
  type EscalationKind,
  type GitEvidenceLabel,
} from "../../../src/contract/rosters.ts";
import {
  approvalLabel,
  blockedReasonLabel,
  briefLandingLine,
  escalationDetail,
  escalationEvidenceLabel,
  escalationKindLabel,
  finalizationUnavailableKindLabel,
  gitEvidenceLabel,
  landingEffect,
  landingLabel,
  resumeActionEffect,
  wallExitLine,
  escalationDetailLine,
  mutationDeferralLabel,
  mutationRefusalLabel,
  operationFailureLabel,
  operationRefusalLabel,
  operationStateLabel,
  operationStepLabel,
  phaseLabel,
  ticketActionEffect,
} from "../app/core/codeLabels.ts";
import { mutationRefusalCodes } from "../app/core/codeSentences.ts";
import type { TicketActionName } from "../app/core/ticketActions.ts";

const ticketActionNames: readonly TicketActionName[] = [
  "Dispatch",
  "Resume",
  "Revoke",
  "Approve",
  "Decline",
];

/** §1.1 rule 7: no string the console draws runs past this, except the brief. */
const copyBudgetChars = 60;

test("every wall, phase, state and refusal has a label inside the copy budget", () => {
  const drawn = [
    ...escalationKinds.map(escalationKindLabel),
    ...blockedReasons.map(blockedReasonLabel),
    ...gitEvidences.map(gitEvidenceLabel),
    ...finalizationUnavailableKinds.map(finalizationUnavailableKindLabel),
    ...phaseRoster.map(phaseLabel),
    ...operationStates.map(operationStateLabel),
    ...operationRefusalCodes.map(operationRefusalLabel),
    ...mutationRefusalCodes.map(mutationRefusalLabel),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

test("the wall a reader met on ticket 21 reads as a noun and a fragment", () => {
  expect(escalationKindLabel("EvaluationFailureEscalated")).toBe(
    "Rework budget exhausted",
  );
  expect(
    escalationDetailLine("EvaluationFailureEscalated", {
      lastSet: { taskKind: "Evaluation", stage: 0, verdict: "Failed" },
      stageCount: 2,
    }),
  ).toBe("Stage 1 of 2 failed");
});

test("a detail line names only the facts the page holds", () => {
  const bare = { lastSet: undefined, stageCount: 2 };
  expect(escalationDetailLine("EvaluationFailureEscalated", bare)).toBe(
    undefined,
  );
  expect(escalationDetailLine("WorkFailureEscalated", bare)).toBe(
    "Failed work is not reworked",
  );
  expect(escalationDetailLine("FinalizationUnavailableEscalated", bare)).toBe(
    undefined,
  );
});

/**
 * A blocked execution's cancelled-set line names the phase the kind itself
 * interrupted — Work for the wall the ticket's own work hit, Evaluation for
 * the one `EvaluationBlockedEscalated` names — with no fact from the page.
 */
test("a blocked execution's line names the phase its own kind interrupted", () => {
  const bare = { lastSet: undefined, stageCount: 2 };
  expect(escalationDetailLine("WorkExecutionUnavailableEscalated", bare)).toBe(
    "Work cancelled",
  );
  expect(escalationDetailLine("EvaluationBlockedEscalated", bare)).toBe(
    "Evaluation cancelled",
  );
});

/**
 * The wall's own label where the read carries evidence, the kind's generic
 * word where it does not — the continuation path with no execution row to
 * read a wall off.
 */
test("the escalation's one line names the wall where the read carries evidence", () => {
  expect(
    escalationDetail({
      kind: "WorkExecutionUnavailableEscalated",
      evidence: "ExecutionProfileUnavailable",
      resumeAt: "ResumeWork",
    }),
  ).toBe("No matching execution profile");
  expect(
    escalationDetail({
      kind: "WorkExecutionUnavailableEscalated",
      resumeAt: "ResumeWork",
    }),
  ).toBe("Execution unavailable");
});

/** The continuation path's evidence is drawn from the git roster, the third
 * and disjoint one the same one line reads from. */
test("the escalation's one line reads the continuation path's own evidence", () => {
  expect(
    escalationDetail({
      kind: "WorkExecutionUnavailableEscalated",
      evidence: "RefUnreadable",
      resumeAt: "ResumeWork",
    }),
  ).toBe("Ref unreadable");
  expect(escalationEvidenceLabel("PromotionTimedOut")).toBe(
    "Promotion timed out",
  );
});

/**
 * Same rule for the finalizer's own wall: the hold's label where the
 * evidence carries one, the kind's generic word where the ticket parked with
 * no hold recorded to read it off.
 */
test("the escalation's one line names the finalization wall where the read carries evidence", () => {
  expect(
    escalationDetail({
      kind: "FinalizationUnavailableEscalated",
      evidence: "ProposalDenied",
      resumeAt: "ResumeFinalization",
    }),
  ).toBe("Proposal denied");
  expect(
    escalationDetail({
      kind: "FinalizationUnavailableEscalated",
      resumeAt: "ResumeFinalization",
    }),
  ).toBe("Finalization unavailable");
});

test("a resume states what it re-runs", () => {
  const effect = ticketActionEffect("Resume", {
    kind: "Offered",
    point: "ResumeEvaluation",
  });
  expect(effect.effect).toBe("Re-runs evaluation from stage 1");
});

test("a rework-wall resume says it reworks", () => {
  const effect = ticketActionEffect("Resume", {
    kind: "Offered",
    point: "ResumeRework",
  });
  expect(effect.effect).toBe("Reworks · new artifact");
});

test("a ticket that is not parked offers no resume and says which exit is left", () => {
  const effect = ticketActionEffect("Resume", { kind: "NoPoint" }, [
    "Resume",
    "Revoke",
  ]);
  expect(effect.effect).toBe("Nothing to resume");
  expect(effect.more).toBe("only Revoke exits this wall");
  expect(effect.offered).toBe(false);
});

/**
 * The exit named is always what the page's own read admits, never assumed
 * from the wall — nothing at all where the page draws no other answer.
 */
test("a wall names the exits the page draws, and none where it draws none", () => {
  expect(wallExitLine(["Resume", "Revoke"])).toBe(
    "only Revoke exits this wall",
  );
  expect(wallExitLine(["Resume", "Approve", "Decline"])).toBe(
    "only Approve or Decline exit this wall",
  );
  expect(wallExitLine(["Resume"])).toBe(undefined);
  expect(wallExitLine([])).toBe(undefined);
  expect(
    ticketActionEffect("Resume", { kind: "NoPoint" }, ["Resume"]).more,
  ).toBe(undefined);
  expect(
    ticketActionEffect("Resume", { kind: "NoPoint" }, ["Resume", "Revoke"])
      .more,
  ).toBe("only Revoke exits this wall");
});

/**
 * Every point the machine can stamp draws the effect its own decider gives it
 * (`model/domain.qnt`): both work resumes respawn the work set.
 */
test("every resume point draws the effect the machine gives it", () => {
  const drawn = resumePoints.map((point) => {
    const effect = resumeActionEffect({ kind: "Offered", point }, []);
    return [point, effect.effect];
  });
  expect(drawn).toEqual([
    ["ResumeWork", "Re-runs the work · new artifact"],
    ["ResumeRework", "Reworks · new artifact"],
    ["ResumeEvaluation", "Re-runs evaluation from stage 1"],
    ["ResumeFinalization", "Re-runs finalization"],
  ]);
});

/** A resume is offered only where the read carries a point to resume at. */
test("every action the phase enables is offered, except a resume with no point", () => {
  const resume = { kind: "Offered", point: "ResumeEvaluation" } as const;
  for (const action of ticketActionNames)
    expect(ticketActionEffect(action, resume).offered).toBe(true);
  for (const action of ticketActionNames)
    expect(ticketActionEffect(action, { kind: "NoPoint" }).offered).toBe(
      action !== "Resume",
    );
});

test("a deferral and a failure this console does not know name themselves", () => {
  expect(mutationDeferralLabel("DispatchBacklog")).toBe("Dispatch backlog");
  expect(mutationDeferralLabel("Whatever")).toBe("Deferred (Whatever)");
  expect(
    operationFailureLabel({ outcome: "Unreachable", reason: "network" }),
  ).toBe("API unreachable · network");
  expect(
    operationFailureLabel({
      outcome: "Rejected",
      code: "NotEnabled",
      status: 409,
      body: undefined,
    }),
  ).toBe("Not allowed in this phase");
  expect(
    operationFailureLabel({
      outcome: "Rejected",
      code: "Nope",
      status: 409,
      body: undefined,
    }),
  ).toBe("Refused (Nope)");
});

test("every step of a follow draws one line, and only a settled one stops", () => {
  expect(
    operationStepLabel({ step: "Submitting", attempts: 1 }, "Resume"),
  ).toEqual({ text: "Submitting…", settled: false, wrong: false });
  expect(
    operationStepLabel(
      { step: "Confirming", operation: "o", minimumSequence: 169, attempts: 1 },
      "Resume",
    ).text,
  ).toBe("Syncing to seq 169…");
  const accepted = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Succeeded",
      refusalCode: undefined,
    },
    "Resume",
  );
  expect(accepted).toEqual({
    text: "Resume accepted",
    settled: true,
    wrong: false,
  });
  const refused = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Refused",
      refusalCode: "TicketChanged",
    },
    "Resume",
  );
  expect(refused.text).toBe("Resume refused · Ticket changed");
  expect(refused.wrong).toBe(true);
});

test("every landing and approval label is inside the budget", () => {
  const drawn = [
    ...briefFinalizationModes.map(landingLabel),
    ...briefFinalizationModes.map(landingEffect),
    approvalLabel(true),
    approvalLabel(false),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

/**
 * The choice is made by the label and understood by the line under it, so both
 * are pinned: a mode renamed on the wire must not silently rename the choice a
 * person already made.
 */
test("a landing is named as a noun and explained as what it does", () => {
  expect(briefFinalizationModes.map(landingLabel)).toStrictEqual([
    "Push",
    "Pull request",
    "Pull request, then merge",
    "None",
  ]);
  expect(briefFinalizationModes.map(landingEffect)).toStrictEqual([
    "Commits straight onto the target branch",
    "Opens a pull request into the target branch",
    "Opens a pull request into the target branch and merges it",
    "Lands nothing",
  ]);
});

test("an approval reads as one noun", () => {
  expect(approvalLabel(true)).toBe("Required");
  expect(approvalLabel(false)).toBe("Not required");
});

/** A push with no target lands on the branch the work was done on, which is a
 * mode and no reference rather than a reference the page invents. A proposal
 * with none opens into the branch the repository defaults to, which is where
 * the reader would otherwise have to know it goes. */
test("a landing read back names its reference, and a proposal names the default", () => {
  expect(briefLandingLine({ mode: "Push", target: "refs/heads/main" })).toBe(
    "Push · lands on refs/heads/main",
  );
  expect(
    briefLandingLine({ mode: "PullRequest", target: "refs/heads/main" }),
  ).toBe("Pull request · into refs/heads/main");
  expect(briefLandingLine({ mode: "Push", target: undefined })).toBe("Push");
  expect(briefLandingLine({ mode: "PullRequest", target: undefined })).toBe(
    "Pull request · into the default branch",
  );
  expect(
    briefLandingLine({ mode: "PullRequestMerge", target: "refs/heads/main" }),
  ).toBe("Pull request, then merge · into refs/heads/main");
  expect(
    briefLandingLine({ mode: "PullRequestMerge", target: undefined }),
  ).toBe("Pull request, then merge · into the default branch");
});

const labelOfKind: Readonly<Record<EscalationKind, string>> = {
  WorkFailureEscalated: "Work failed",
  EvaluationFailureEscalated: "Rework budget exhausted",
  WorkExecutionUnavailableEscalated: "Execution unavailable",
  EvaluationBlockedEscalated: "Evaluation blocked",
  FinalizationUnavailableEscalated: "Finalization unavailable",
};

test.each(escalationKinds)("the label for %s says what it says", (kind) => {
  expect(escalationKindLabel(kind)).toBe(labelOfKind[kind]);
});

test("no two kinds are drawn with the same label", () => {
  const drawn = escalationKinds.map((kind) => escalationKindLabel(kind));
  expect(new Set(drawn).size).toBe(drawn.length);
});

const labelOfGitEvidence: Readonly<Record<GitEvidenceLabel, string>> = {
  RemoteUnreachable: "Remote unreachable",
  RemoteDenied: "Remote denied",
  RefUnreadable: "Ref unreadable",
  ObjectMissing: "Object missing",
  IntegrationFailed: "Integration failed",
  PromotionTimedOut: "Promotion timed out",
};

test.each(gitEvidences)(
  "the label for git evidence %s says what it says",
  (evidence) => {
    expect(gitEvidenceLabel(evidence)).toBe(labelOfGitEvidence[evidence]);
  },
);

test("no two git evidences are drawn with the same label", () => {
  const drawn = gitEvidences.map((evidence) => gitEvidenceLabel(evidence));
  expect(new Set(drawn).size).toBe(drawn.length);
});
