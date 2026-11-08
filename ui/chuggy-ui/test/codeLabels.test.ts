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
  briefFinalizationKinds,
  briefGitMergeModes,
  briefGitMergePolicies,
  changeProposalCreations,
  changeProposalMergeabilities,
  changeProposalStatuses,
  changeProposalMergeReasons,
  changeProposalMergeWaits,
  changeProposalMerges,
  escalationKinds,
  finalizationFailureKinds,
  finalizationUnavailableKinds,
  gitEvidences,
  leadAbsencesUntimed,
  leadAdmissionRefusals,
  nativeActionKinds,
  operationRefusalCodes,
  operationStates,
  phaseRoster,
  resumePoints,
  runStepEvidences,
  ticketLandingStates,
  type EscalationKind,
  type GitEvidenceLabel,
} from "../../../src/contract/rosters.ts";
import {
  approvalLabel,
  blockedReasonLabel,
  changeProposalCreationLabel,
  changeProposalMergeabilityLabel,
  changeProposalStatusLabel,
  changeProposalMergeLabel,
  changeProposalMergeReasonLabel,
  changeProposalMergeWaitLabel,
  escalationDetail,
  escalationEvidenceLabel,
  escalationEvidenceLine,
  escalationKindLabel,
  escalationStep,
  finalizationFailureKindLabel,
  finalizationUnavailableKindLabel,
  gitEvidenceLabel,
  finalizationKindEffect,
  finalizationKindLabel,
  finalizationLine,
  finalizationMethodLabel,
  gitMergeModeEffect,
  gitMergeModeLabel,
  gitMergePolicyEffect,
  gitMergePolicyLabel,
  leadAbsenceLabel,
  resumeActionEffect,
  wallExitLine,
  escalationDetailLine,
  mutationDeferralLabel,
  mutationRefusalLabel,
  nativeActionKindLabel,
  operationFailureLabel,
  operationRefusalLabel,
  operationStateLabel,
  operationStepLabel,
  phaseLabel,
  runnerLossDetail,
  runnerLossLine,
  runStepLabel,
  runStepLine,
  ticketActionEffect,
  ticketActionLabel,
  ticketLandingStateLabel,
  usageResumeLine,
} from "../app/core/codeLabels.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";
import { mutationRefusalCodes } from "../app/core/codeSentences.ts";
import type { TicketActionName } from "../app/core/ticketActions.ts";

const ticketActionNames: readonly TicketActionName[] = [
  "Dispatch",
  "Resume",
  "Revoke",
  "Approve",
  "Decline",
  "Release",
];

/** §1.1 rule 7: no string the console draws runs past this, except the brief. */
const copyBudgetChars = 60;

/** A line's words, or nothing where there is no line. */
function textOf(copy: Copy | undefined): string | undefined {
  return copy === undefined ? undefined : copyTextEn(copy);
}

test("every wall, phase, state and refusal has a label inside the copy budget", () => {
  const drawn = [
    ...escalationKinds.map((each) => copyTextEn(escalationKindLabel(each))),
    ...blockedReasons.map((each) => copyTextEn(blockedReasonLabel(each))),
    ...gitEvidences.map((each) => copyTextEn(gitEvidenceLabel(each))),
    ...finalizationUnavailableKinds.map((each) =>
      copyTextEn(finalizationUnavailableKindLabel(each)),
    ),
    ...phaseRoster.map((phase) => copyTextEn(phaseLabel(phase))),
    ...operationStates.map((each) => copyTextEn(operationStateLabel(each))),
    ...operationRefusalCodes.map((each) =>
      copyTextEn(operationRefusalLabel(each)),
    ),
    ...mutationRefusalCodes.map((each) =>
      copyTextEn(mutationRefusalLabel(each)),
    ),
    ...finalizationFailureKinds.map((each) =>
      copyTextEn(finalizationFailureKindLabel(each)),
    ),
    ...changeProposalCreations.map((each) =>
      copyTextEn(changeProposalCreationLabel(each)),
    ),
    ...changeProposalMerges.map((each) =>
      copyTextEn(changeProposalMergeLabel(each)),
    ),
    ...changeProposalMergeReasons.map((each) =>
      copyTextEn(changeProposalMergeReasonLabel(each)),
    ),
    ...changeProposalMergeabilities.map((each) =>
      copyTextEn(changeProposalMergeabilityLabel(each)),
    ),
    ...changeProposalStatuses.map((each) =>
      copyTextEn(changeProposalStatusLabel(each)),
    ),
    ...[...leadAbsencesUntimed, ...leadAdmissionRefusals].map((each) =>
      copyTextEn(leadAbsenceLabel(each)),
    ),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

test("every landing state is one word", () => {
  for (const state of ticketLandingStates)
    expect(copyTextEn(ticketLandingStateLabel(state))).toMatch(
      /^[A-Z][a-z]+$/u,
    );
});

test("a detail line names only the facts the page holds, a stage by its plan's name", () => {
  const lastSet = {
    taskKind: "Evaluation",
    stage: 1,
    verdict: "Failed",
  } as const;
  expect(
    textOf(
      escalationDetailLine("EvaluationFailureEscalated", {
        lastSet,
        names: ["checks", "review"],
      }),
    ),
  ).toBe("checks failed");
  expect(
    textOf(
      escalationDetailLine("EvaluationFailureEscalated", {
        lastSet,
        names: undefined,
      }),
    ),
  ).toBe("Stage 1 failed");
  const bare = { lastSet: undefined, names: undefined };
  expect(textOf(escalationDetailLine("EvaluationFailureEscalated", bare))).toBe(
    undefined,
  );
  expect(textOf(escalationDetailLine("WorkFailureEscalated", bare))).toBe(
    "Failed work is not reworked",
  );
  expect(
    textOf(escalationDetailLine("FinalizationUnavailableEscalated", bare)),
  ).toBe(undefined);
});

/**
 * A cancelled work execution's line names the phase the kind itself
 * interrupted, with no fact from the page.
 */
test("a cancelled work execution's line names the phase its own kind interrupted", () => {
  const bare = { lastSet: undefined, names: undefined };
  expect(
    textOf(escalationDetailLine("WorkExecutionUnavailableEscalated", bare)),
  ).toBe("Work cancelled");
});

/**
 * An evaluation block retires one execution and says nothing about its
 * siblings, and a resume keeps every pass it already holds — so the line
 * names what a resume does, never a cancellation that did not happen.
 */
test("an evaluation block's line names what a resume does, not a cancellation", () => {
  const bare = { lastSet: undefined, names: undefined };
  expect(textOf(escalationDetailLine("EvaluationBlockedEscalated", bare))).toBe(
    "Resume asks it again",
  );
});

/**
 * The wall's own label where the read carries evidence, the kind's generic
 * word where it does not — the continuation path with no execution row to
 * read a wall off.
 */
test("the escalation's one line names the wall where the read carries evidence", () => {
  expect(
    copyTextEn(
      escalationDetail({
        kind: "WorkExecutionUnavailableEscalated",
        evidence: "ExecutionProfileUnavailable",
        resumeAt: "ResumeWork",
      }),
    ),
  ).toBe("No matching run profile");
  expect(
    copyTextEn(
      escalationDetail({
        kind: "WorkExecutionUnavailableEscalated",
        resumeAt: "ResumeWork",
      }),
    ),
  ).toBe("Run unavailable");
});

/**
 * The wall covers a project with no runner, a runner that refused the work and
 * a hosted route with nothing admitted for it, so its line says what is true
 * of all three and names no runner.
 */
test("the wall that is nothing to run the work says so in a reader's words", () => {
  expect(copyTextEn(blockedReasonLabel("RequiredCapabilityUnavailable"))).toBe(
    "Nowhere to run this work",
  );
  for (const kind of [
    "WorkExecutionUnavailableEscalated",
    "EvaluationBlockedEscalated",
  ] as const)
    expect(
      copyTextEn(
        escalationDetail({
          kind,
          evidence: "RequiredCapabilityUnavailable",
          resumeAt: "ResumeWork",
        }),
      ),
    ).toBe("Nowhere to run this work");
});

test("the wall that is work too large for every runner says so in a reader's words", () => {
  expect(copyTextEn(blockedReasonLabel("RequiredMemoryUnavailable"))).toBe(
    "Too large for every runner",
  );
  expect(
    copyTextEn(
      escalationDetail({
        kind: "WorkExecutionUnavailableEscalated",
        evidence: "RequiredMemoryUnavailable",
        resumeAt: "ResumeWork",
      }),
    ),
  ).toBe("Too large for every runner");
});

test("the wall that is an evaluation of another tree says so in a reader's words", () => {
  expect(copyTextEn(blockedReasonLabel("EvaluatedTreeNotExpected"))).toBe(
    "Evaluated a different tree than the work produced",
  );
});

/** Every evidence of every roster is walked, so a wall added to one leads
 * nowhere until this says where. */
test("only nothing to run the work, or nothing large enough, leads to Runners, and only refused workflow files to Repositories", () => {
  const evidences = [
    ...blockedReasons,
    ...gitEvidences,
    ...finalizationUnavailableKinds,
  ];
  const leading = evidences.filter(
    (evidence) =>
      escalationStep({
        kind: "WorkExecutionUnavailableEscalated",
        evidence,
        resumeAt: "ResumeWork",
      }) !== undefined,
  );
  expect(
    leading.map((evidence) => [
      evidence,
      escalationStep({
        kind: "FinalizationUnavailableEscalated",
        evidence,
        resumeAt: "ResumeFinalization",
      }),
    ]),
  ).toStrictEqual([
    ["RequiredCapabilityUnavailable", "Runners"],
    ["RequiredMemoryUnavailable", "Runners"],
    ["PromotionWorkflowsRefused", "Repositories"],
  ]);
  for (const kind of escalationKinds) {
    expect(escalationStep({ kind, resumeAt: "ResumeWork" })).toBeUndefined();
    expect(
      escalationStep({
        kind,
        evidence: "RequiredCapabilityUnavailable",
        resumeAt: "ResumeWork",
      }),
    ).toBe("Runners");
  }
});

const lostOnPool = {
  runner: { kind: "Pool" as const, pool: "runner-a" },
  execution: "execution-1",
  attempt: "attempt-1",
  evidence: "RunFailed" as const,
  losses: 3,
  resumed: 2,
};

/**
 * A job lost on its runner is said as that, never as the work or the
 * evaluation failing, whichever wall the machine parked it at.
 */
test("a job lost on its runner names the runner and how often it was resumed", () => {
  for (const kind of [
    "WorkFailureEscalated",
    "EvaluationBlockedEscalated",
  ] as const) {
    const escalation = {
      kind,
      resumeAt: "ResumeWork" as const,
      lost: lostOnPool,
    };
    expect(copyTextEn(escalationDetail(escalation))).toBe("Lost on runner-a");
    expect(escalationStep(escalation)).toBe("Runners");
  }
  expect(copyTextEn(runnerLossLine(lostOnPool))).toBe(
    "3 losses · 2 resumed automatically",
  );
  expect(
    copyTextEn(runnerLossLine({ ...lostOnPool, losses: 1, resumed: 0 })),
  ).toBe("1 loss · none resumed automatically");
  const personal = {
    ...lostOnPool,
    runner: {
      kind: "Personal" as const,
      owner: "23:https://issuer.example/alice",
    },
  };
  expect(copyTextEn(runnerLossDetail(personal))).toBe("Lost on alice's runner");
  expect(
    escalationStep({
      kind: "WorkFailureEscalated",
      resumeAt: "ResumeWork",
      lost: personal,
    }),
  ).toBeUndefined();
  for (const said of [
    copyTextEn(runnerLossDetail(lostOnPool)),
    copyTextEn(runnerLossDetail(personal)),
    copyTextEn(runnerLossLine(lostOnPool)),
  ]) {
    expect(said.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(said).not.toMatch(/[.:;]/u);
  }
});

/**
 * A run stopped at a failed step is said as that step, whichever wall the
 * machine parked it at, and leads to no page; setup alone is fixed through the
 * ticket's own overrides, so its line says so to a reader offered them and to
 * no other, and a runner whose disk ran low needs room on that runner, which
 * its line says to every reader.
 */
test("a run stopped at a failed step names the step, and setup says where its fix goes to a reader who can make it", () => {
  const labels = new Set<string>();
  for (const evidence of runStepEvidences) {
    const failed = { evidence, execution: "execution-1", attempt: "attempt-1" };
    for (const kind of [
      "WorkFailureEscalated",
      "EvaluationBlockedEscalated",
    ] as const) {
      const escalation = { kind, resumeAt: "ResumeWork" as const, failed };
      expect(copyTextEn(escalationDetail(escalation))).toBe(
        copyTextEn(runStepLabel(evidence)),
      );
      expect(escalationStep(escalation)).toBeUndefined();
    }
    labels.add(copyTextEn(runStepLabel(evidence)));
    expect(textOf(runStepLine(failed, true))).toBe(
      evidence === "RunSetupFailed"
        ? "Fix it under Overrides · Setup, then Resume"
        : evidence === "RunDiskLow"
          ? "Free space on its runner, then Resume"
          : undefined,
    );
    expect(textOf(runStepLine(failed, false))).toBe(
      evidence === "RunDiskLow"
        ? "Free space on its runner, then Resume"
        : undefined,
    );
    for (const said of [
      copyTextEn(runStepLabel(evidence)),
      textOf(runStepLine(failed, true)) ?? "",
    ]) {
      expect(said.length).toBeLessThanOrEqual(copyBudgetChars);
      expect(said).not.toMatch(/[.:;]/u);
    }
  }
  expect([...labels]).toEqual([
    "Clone failed",
    "Setup failed",
    "Commit failed",
    "Push failed",
    "Timed out",
    "Disk low",
  ]);
});

/** The continuation path's evidence is drawn from the git roster, the third
 * and disjoint one the same one line reads from. */
test("the escalation's one line reads the continuation path's own evidence", () => {
  expect(
    copyTextEn(
      escalationDetail({
        kind: "WorkExecutionUnavailableEscalated",
        evidence: "RefUnreadable",
        resumeAt: "ResumeWork",
      }),
    ),
  ).toBe("Ref unreadable");
  expect(copyTextEn(escalationEvidenceLabel("PromotionTimedOut"))).toBe(
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
    copyTextEn(
      escalationDetail({
        kind: "FinalizationUnavailableEscalated",
        evidence: "ProposalDenied",
        resumeAt: "ResumeFinalization",
      }),
    ),
  ).toBe("Pull request denied");
  expect(
    copyTextEn(
      escalationDetail({
        kind: "FinalizationUnavailableEscalated",
        resumeAt: "ResumeFinalization",
      }),
    ),
  ).toBe("Landing unavailable");
});

/**
 * A push the repository declined clears only once something there changes, so
 * its hold says what, and a workflow refusal names the settings the
 * Repositories page holds; every other hold is said by its label alone.
 */
test("a declined push and an unread one say what to change before a resume, and no other hold does", () => {
  expect(
    copyTextEn(finalizationUnavailableKindLabel("PromotionDeclined")),
  ).toBe("Push declined");
  expect(
    copyTextEn(finalizationUnavailableKindLabel("PromotionWorkflowsRefused")),
  ).toBe("Workflow files refused");
  const said = [
    ...blockedReasons,
    ...gitEvidences,
    ...finalizationUnavailableKinds,
  ].flatMap((evidence) => {
    const line = textOf(escalationEvidenceLine(evidence));
    return line === undefined ? [] : [[evidence, line] as const];
  });
  expect(said).toStrictEqual([
    [
      "ReconciliationUnreadable",
      "Restore the branch or the App's access, then Resume",
    ],
    ["PromotionDeclined", "Check the branch's rules and hooks, then Resume"],
    [
      "PromotionWorkflowsRefused",
      "Turn on Workflow files and the App's Workflows, then Resume",
    ],
  ]);
  for (const [, line] of said) {
    expect(line.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(line).not.toMatch(/[.:;]/u);
  }
});

test("a resume states what it re-runs", () => {
  const effect = ticketActionEffect("Resume", {
    kind: "Offered",
    point: "ResumeEvaluation",
  });
  expect(copyTextEn(effect.effect)).toBe("Re-runs evaluation from stage 1");
});

test("a rework-wall resume says it reworks", () => {
  const effect = ticketActionEffect("Resume", {
    kind: "Offered",
    point: "ResumeRework",
  });
  expect(copyTextEn(effect.effect)).toBe("Reworks · new artifact");
});

test("a ticket that is not parked offers no resume and says which exit is left", () => {
  const effect = ticketActionEffect("Resume", { kind: "NoPoint" }, [
    "Resume",
    "Revoke",
  ]);
  expect(copyTextEn(effect.effect)).toBe("Nothing to resume");
  expect(textOf(effect.more)).toBe("only Revoke exits this wall");
  expect(effect.offered).toBe(false);
});

/**
 * The exit named is always what the page's own read admits, never assumed
 * from the wall — nothing at all where the page draws no other answer.
 */
test("a wall names the exits the page draws, and none where it draws none", () => {
  expect(textOf(wallExitLine(["Resume", "Revoke"]))).toBe(
    "only Revoke exits this wall",
  );
  expect(textOf(wallExitLine(["Resume", "Approve", "Decline"]))).toBe(
    "only Approve or Decline exit this wall",
  );
  expect(textOf(wallExitLine(["Resume"]))).toBe(undefined);
  expect(textOf(wallExitLine([]))).toBe(undefined);
  expect(
    ticketActionEffect("Resume", { kind: "NoPoint" }, ["Resume"]).more,
  ).toBe(undefined);
  expect(
    textOf(
      ticketActionEffect("Resume", { kind: "NoPoint" }, ["Resume", "Revoke"])
        .more,
    ),
  ).toBe("only Revoke exits this wall");
});

/**
 * Every point the machine can stamp draws the effect its own decider gives it
 * (`model/domain.qnt`): both work resumes respawn the work set.
 */
test("every resume point draws the effect the machine gives it", () => {
  const drawn = resumePoints.map((point) => {
    const effect = resumeActionEffect({ kind: "Offered", point }, []);
    return [point, copyTextEn(effect.effect)];
  });
  expect(drawn).toEqual([
    ["ResumeWork", "Re-runs the work · new artifact"],
    ["ResumeRework", "Reworks · new artifact"],
    ["ResumeEvaluation", "Re-runs evaluation from stage 1"],
    ["ResumeFinalization", "Re-runs landing"],
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
  expect(copyTextEn(mutationDeferralLabel("DispatchBacklog"))).toBe(
    "Dispatch backlog",
  );
  expect(copyTextEn(mutationDeferralLabel("Whatever"))).toBe(
    "Deferred (Whatever)",
  );
  expect(
    copyTextEn(
      operationFailureLabel({ outcome: "Unreachable", reason: "network" }),
    ),
  ).toBe("API unreachable · network");
  expect(
    copyTextEn(
      operationFailureLabel({
        outcome: "Rejected",
        code: "OperationNotPending",
        status: 409,
        body: undefined,
      }),
    ),
  ).toBe("Already decided");
  expect(
    copyTextEn(
      operationFailureLabel({
        outcome: "Rejected",
        code: "TicketChanged",
        status: 409,
        body: undefined,
      }),
    ),
  ).toBe("Refused (TicketChanged)");
  expect(
    copyTextEn(
      operationFailureLabel({
        outcome: "Rejected",
        code: "Nope",
        status: 409,
        body: undefined,
      }),
    ),
  ).toBe("Refused (Nope)");
});

test("every step of a follow draws one line, and only a settled one stops", () => {
  expect(
    operationStepLabel({ step: "Submitting", attempts: 1 }, "Resume"),
  ).toEqual({
    text: { id: "codes-step-submitting" },
    settled: false,
    wrong: false,
  });
  expect(
    copyTextEn(
      operationStepLabel(
        {
          step: "Confirming",
          operation: "o",
          minimumSequence: 169,
          attempts: 1,
        },
        "Resume",
      ).text,
    ),
  ).toBe("Updating…");
  const accepted = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Succeeded",
      refusal: undefined,
    },
    "Resume",
  );
  expect(copyTextEn(accepted.text)).toBe("Resume accepted");
  expect(accepted.settled).toBe(true);
  expect(accepted.wrong).toBe(false);
  const refused = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Refused",
      refusal: { type: "TicketChanged" },
    },
    "Resume",
  );
  expect(copyTextEn(refused.text)).toBe("Resume refused · Ticket changed");
  expect(refused.wrong).toBe(true);
});

test("every finalization and approval label is inside the budget", () => {
  const drawn = [
    ...briefFinalizationKinds.map((each) =>
      copyTextEn(finalizationKindLabel(each)),
    ),
    ...briefFinalizationKinds.map((each) =>
      copyTextEn(finalizationKindEffect(each)),
    ),
    ...briefGitMergeModes.map((each) => copyTextEn(gitMergeModeLabel(each))),
    ...briefGitMergeModes.map((each) => copyTextEn(gitMergeModeEffect(each))),
    ...briefGitMergePolicies.map((each) =>
      copyTextEn(gitMergePolicyLabel(each)),
    ),
    ...briefGitMergePolicies.map((each) =>
      copyTextEn(gitMergePolicyEffect(each)),
    ),
    copyTextEn(approvalLabel(true)),
    copyTextEn(approvalLabel(false)),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

/**
 * The choice is made by the label and understood by the line under it, so both
 * are pinned: a kind, mode or policy renamed on the wire must not silently
 * rename the choice a person already made.
 */
test("a finalization's kind, a git merge's mode and its policy are each named as a noun and explained as what it does", () => {
  expect(
    briefFinalizationKinds.map((each) =>
      copyTextEn(finalizationKindLabel(each)),
    ),
  ).toStrictEqual(["Git merge", "Pull request", "None"]);
  expect(
    briefFinalizationKinds.map((each) =>
      copyTextEn(finalizationKindEffect(each)),
    ),
  ).toStrictEqual([
    "Merges the work into the target branch",
    "Opens a pull request a person merges",
    "Lands nothing",
  ]);
  expect(
    briefGitMergeModes.map((each) => copyTextEn(gitMergeModeLabel(each))),
  ).toStrictEqual(["Push", "Pull request, then merge"]);
  expect(
    briefGitMergeModes.map((each) => copyTextEn(gitMergeModeEffect(each))),
  ).toStrictEqual([
    "Commits straight onto the target branch",
    "Opens a pull request into the target branch and merges it",
  ]);
  expect(
    briefGitMergePolicies.map((each) => copyTextEn(gitMergePolicyLabel(each))),
  ).toStrictEqual(["Direct", "Serialized"]);
  expect(
    briefGitMergePolicies.map((each) => copyTextEn(gitMergePolicyEffect(each))),
  ).toStrictEqual([
    "Lands as soon as it is accepted",
    "Lands alone on its reference, evaluated on what it lands",
  ]);
});

test("an approval reads as one noun", () => {
  expect(copyTextEn(approvalLabel(true))).toBe("Required");
  expect(copyTextEn(approvalLabel(false))).toBe("Not required");
});

/** A push with no target lands on the branch the work was done on, which is a
 * mode and no reference rather than a reference the page invents. A proposal
 * with none opens into the branch the repository defaults to, which is where
 * the reader would otherwise have to know it goes. */
test("a finalization read back names its reference, and a proposal names the default", () => {
  const target = "refs/heads/main";
  const push = { kind: "GitMerge", mode: "Push", policy: "Direct" } as const;
  const merge = {
    kind: "GitMerge",
    mode: "PullRequestMerge",
    policy: "Serialized",
  } as const;
  expect(copyTextEn(finalizationLine({ ...push, target }))).toBe(
    "Push · lands on refs/heads/main",
  );
  expect(copyTextEn(finalizationLine(push))).toBe("Push");
  expect(copyTextEn(finalizationLine({ kind: "PullRequest", target }))).toBe(
    "Pull request · into refs/heads/main",
  );
  expect(copyTextEn(finalizationLine({ kind: "PullRequest" }))).toBe(
    "Pull request · into the default branch",
  );
  expect(copyTextEn(finalizationLine({ ...merge, target }))).toBe(
    "Pull request, then merge · into refs/heads/main",
  );
  expect(copyTextEn(finalizationLine(merge))).toBe(
    "Pull request, then merge · into the default branch",
  );
  expect(copyTextEn(finalizationLine({ kind: "None" }))).toBe("None");
  expect(
    [push, merge, { kind: "PullRequest" } as const].map((each) =>
      copyTextEn(finalizationMethodLabel(each)),
    ),
  ).toStrictEqual(["Push", "Pull request, then merge", "Pull request"]);
});

const labelOfKind: Readonly<Record<EscalationKind, string>> = {
  WorkFailureEscalated: "Work failed",
  EvaluationFailureEscalated: "Rework budget exhausted",
  WorkExecutionUnavailableEscalated: "Run unavailable",
  EvaluationBlockedEscalated: "Evaluation blocked",
  FinalizationUnavailableEscalated: "Landing unavailable",
};

test.each(escalationKinds)("the label for %s says what it says", (kind) => {
  expect(copyTextEn(escalationKindLabel(kind))).toBe(labelOfKind[kind]);
});

test("no two kinds are drawn with the same label", () => {
  const drawn = escalationKinds.map((kind) =>
    copyTextEn(escalationKindLabel(kind)),
  );
  expect(new Set(drawn).size).toBe(drawn.length);
});

const labelOfGitEvidence: Readonly<Record<GitEvidenceLabel, string>> = {
  RemoteUnreachable: "Remote unreachable",
  RemoteDenied: "Remote denied",
  RefUnreadable: "Ref unreadable",
  ObjectMissing: "Object missing",
  IntegrationFailed: "Integration failed",
  PromotionTimedOut: "Promotion timed out",
  RemoteDeclined: "Remote declined",
  WorkflowsRefused: "Workflows refused",
};

test.each(gitEvidences)(
  "the label for git evidence %s says what it says",
  (evidence) => {
    expect(copyTextEn(gitEvidenceLabel(evidence))).toBe(
      labelOfGitEvidence[evidence],
    );
  },
);

test("no two git evidences are drawn with the same label", () => {
  const drawn = gitEvidences.map((evidence) =>
    copyTextEn(gitEvidenceLabel(evidence)),
  );
  expect(new Set(drawn).size).toBe(drawn.length);
});

/** The clock face is the reader's own, so the instants are built in it. */
test("an escalation the scheduler resumes once its usage pauses end says so, and when where a pause still holds it", () => {
  const nowMs = new Date(2026, 9, 3, 9, 0).getTime();
  const until = new Date(2026, 9, 3, 14, 5).toISOString();
  const lines = [
    copyTextEn(usageResumeLine({ until }, nowMs)),
    copyTextEn(usageResumeLine({}, nowMs)),
    copyTextEn(usageResumeLine({ until: "not an instant" }, nowMs)),
  ];
  expect(lines).toStrictEqual([
    "Resumes automatically · 14:05",
    "Resumes automatically",
    "Resumes automatically",
  ]);
  for (const said of lines) {
    expect(said.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(said).not.toMatch(/[.;]/u);
  }
});

/** Each switch over a roster, walked whole, and whether each member has a
 * message of its own: a landing's two waits are one word to a reader, and
 * nothing else is. */
const codeSwitches: readonly (readonly [string, readonly Copy[], boolean])[] = [
  ["escalation kinds", escalationKinds.map(escalationKindLabel), true],
  ["blocked reasons", blockedReasons.map(blockedReasonLabel), true],
  ["git evidences", gitEvidences.map(gitEvidenceLabel), true],
  [
    "landing holds",
    finalizationUnavailableKinds.map(finalizationUnavailableKindLabel),
    true,
  ],
  [
    "lead absences",
    [...leadAbsencesUntimed, ...leadAdmissionRefusals].map(leadAbsenceLabel),
    true,
  ],
  ["landing states", ticketLandingStates.map(ticketLandingStateLabel), false],
  [
    "landing failures",
    finalizationFailureKinds.map(finalizationFailureKindLabel),
    true,
  ],
  [
    "pull request creations",
    changeProposalCreations.map(changeProposalCreationLabel),
    true,
  ],
  [
    "pull request merges",
    changeProposalMerges.map(changeProposalMergeLabel),
    true,
  ],
  [
    "pull request merge reasons",
    changeProposalMergeReasons.map(changeProposalMergeReasonLabel),
    true,
  ],
  [
    "pull request statuses",
    changeProposalStatuses.map(changeProposalStatusLabel),
    true,
  ],
  [
    "pull request merge waits",
    changeProposalMergeWaits.map(changeProposalMergeWaitLabel),
    true,
  ],
  [
    "pull request mergeabilities",
    changeProposalMergeabilities.map(changeProposalMergeabilityLabel),
    true,
  ],
  ["run steps", runStepEvidences.map(runStepLabel), true],
  ["native actions", nativeActionKinds.map(nativeActionKindLabel), true],
  ["landing kinds", briefFinalizationKinds.map(finalizationKindLabel), true],
  [
    "landing kind effects",
    briefFinalizationKinds.map(finalizationKindEffect),
    true,
  ],
  ["merge modes", briefGitMergeModes.map(gitMergeModeLabel), true],
  ["merge mode effects", briefGitMergeModes.map(gitMergeModeEffect), true],
  ["merge policies", briefGitMergePolicies.map(gitMergePolicyLabel), true],
  [
    "merge policy effects",
    briefGitMergePolicies.map(gitMergePolicyEffect),
    true,
  ],
  ["approvals", [true, false].map(approvalLabel), true],
  ["ticket actions", ticketActionNames.map(ticketActionLabel), true],
  [
    "resume points",
    resumePoints.map(
      (point) => resumeActionEffect({ kind: "Offered", point }, []).effect,
    ),
    true,
  ],
  ["operation states", operationStates.map(operationStateLabel), true],
  [
    "operation refusals",
    operationRefusalCodes.map(operationRefusalLabel),
    true,
  ],
  ["boundary refusals", mutationRefusalCodes.map(mutationRefusalLabel), true],
];

test.each(codeSwitches)(
  "each of the %s is a descriptor the catalog formats",
  (_, labels, distinct) => {
    for (const label of labels) expect(copyTextEn(label)).not.toBe("");
    if (distinct)
      expect(new Set(labels.map((label) => label.id)).size).toBe(labels.length);
  },
);

/** The two waits a landing stands at are one word to a reader, so one
 * message. */
test("a landing's two waits share their one message", () => {
  expect(ticketLandingStateLabel("AwaitingApproval")).toStrictEqual(
    ticketLandingStateLabel("AwaitingMerge"),
  );
});

/** The lines a reader is shown name no part of the machine they cannot see. */
test("a follow under way names no actor, mailbox or sequence", () => {
  const steps = [
    operationStepLabel(
      { step: "Following", operation: "o", attempts: 1 },
      "Resume",
    ),
    operationStepLabel(
      { step: "Confirming", operation: "o", minimumSequence: 9, attempts: 1 },
      "Resume",
    ),
    operationStepLabel(
      {
        step: "Backlogged",
        code: "MailboxBackpressure",
        retryAfterSeconds: 2,
        attempts: 1,
      },
      "Resume",
    ),
  ].map((step) => copyTextEn(step.text));
  expect(steps).toStrictEqual([
    "Submitting…",
    "Updating…",
    "Server busy · retry in 2s",
  ]);
  expect(copyTextEn(mutationDeferralLabel("MailboxUnavailable"))).toBe(
    "Server unreachable",
  );
  for (const said of steps) expect(said).not.toMatch(/actor|mailbox|seq\b/iu);
});
