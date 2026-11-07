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
  changeProposalMerges,
  escalationKinds,
  finalizationFailureKinds,
  finalizationUnavailableKinds,
  gitEvidences,
  leadAbsencesUntimed,
  leadAdmissionRefusals,
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
  ticketLandingStateLabel,
  usageResumeLine,
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
    ...finalizationFailureKinds.map(finalizationFailureKindLabel),
    ...changeProposalCreations.map(changeProposalCreationLabel),
    ...changeProposalMerges.map(changeProposalMergeLabel),
    ...changeProposalMergeReasons.map(changeProposalMergeReasonLabel),
    ...changeProposalMergeabilities.map(changeProposalMergeabilityLabel),
    ...changeProposalStatuses.map(changeProposalStatusLabel),
    ...[...leadAbsencesUntimed, ...leadAdmissionRefusals].map(leadAbsenceLabel),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

test("every landing state is one word", () => {
  for (const state of ticketLandingStates)
    expect(ticketLandingStateLabel(state)).toMatch(/^[A-Z][a-z]+$/u);
});

test("a detail line names only the facts the page holds, a stage by its plan's name", () => {
  const lastSet = {
    taskKind: "Evaluation",
    stage: 1,
    verdict: "Failed",
  } as const;
  expect(
    escalationDetailLine("EvaluationFailureEscalated", {
      lastSet,
      names: ["checks", "review"],
    }),
  ).toBe("checks failed");
  expect(
    escalationDetailLine("EvaluationFailureEscalated", {
      lastSet,
      names: undefined,
    }),
  ).toBe("Stage 1 failed");
  const bare = { lastSet: undefined, names: undefined };
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
 * A cancelled work execution's line names the phase the kind itself
 * interrupted, with no fact from the page.
 */
test("a cancelled work execution's line names the phase its own kind interrupted", () => {
  const bare = { lastSet: undefined, names: undefined };
  expect(escalationDetailLine("WorkExecutionUnavailableEscalated", bare)).toBe(
    "Work cancelled",
  );
});

/**
 * An evaluation block retires one execution and says nothing about its
 * siblings, and a resume keeps every pass it already holds — so the line
 * names what a resume does, never a cancellation that did not happen.
 */
test("an evaluation block's line names what a resume does, not a cancellation", () => {
  const bare = { lastSet: undefined, names: undefined };
  expect(escalationDetailLine("EvaluationBlockedEscalated", bare)).toBe(
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

/**
 * The wall covers a project with no runner, a runner that refused the work and
 * a hosted route with nothing admitted for it, so its line says what is true
 * of all three and names no runner.
 */
test("the wall that is nothing to run the work says so in a reader's words", () => {
  expect(blockedReasonLabel("RequiredCapabilityUnavailable")).toBe(
    "Nowhere to run this work",
  );
  for (const kind of [
    "WorkExecutionUnavailableEscalated",
    "EvaluationBlockedEscalated",
  ] as const)
    expect(
      escalationDetail({
        kind,
        evidence: "RequiredCapabilityUnavailable",
        resumeAt: "ResumeWork",
      }),
    ).toBe("Nowhere to run this work");
});

test("the wall that is work too large for every runner says so in a reader's words", () => {
  expect(blockedReasonLabel("RequiredMemoryUnavailable")).toBe(
    "Too large for every runner",
  );
  expect(
    escalationDetail({
      kind: "WorkExecutionUnavailableEscalated",
      evidence: "RequiredMemoryUnavailable",
      resumeAt: "ResumeWork",
    }),
  ).toBe("Too large for every runner");
});

test("the wall that is an evaluation of another tree says so in a reader's words", () => {
  expect(blockedReasonLabel("EvaluatedTreeNotExpected")).toBe(
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
    expect(escalationDetail(escalation)).toBe("Lost on runner-a");
    expect(escalationStep(escalation)).toBe("Runners");
  }
  expect(runnerLossLine(lostOnPool)).toBe("3 losses · 2 resumed automatically");
  expect(runnerLossLine({ ...lostOnPool, losses: 1, resumed: 0 })).toBe(
    "1 loss · none resumed automatically",
  );
  const personal = {
    ...lostOnPool,
    runner: {
      kind: "Personal" as const,
      owner: "23:https://issuer.example/alice",
    },
  };
  expect(runnerLossDetail(personal)).toBe("Lost on alice's runner");
  expect(
    escalationStep({
      kind: "WorkFailureEscalated",
      resumeAt: "ResumeWork",
      lost: personal,
    }),
  ).toBeUndefined();
  for (const said of [
    runnerLossDetail(lostOnPool),
    runnerLossDetail(personal),
    runnerLossLine(lostOnPool),
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
      expect(escalationDetail(escalation)).toBe(runStepLabel(evidence));
      expect(escalationStep(escalation)).toBeUndefined();
    }
    labels.add(runStepLabel(evidence));
    expect(runStepLine(failed, true)).toBe(
      evidence === "RunSetupFailed"
        ? "Fix it under Overrides · Setup, then Resume"
        : evidence === "RunDiskLow"
          ? "Free space on its runner, then Resume"
          : undefined,
    );
    expect(runStepLine(failed, false)).toBe(
      evidence === "RunDiskLow"
        ? "Free space on its runner, then Resume"
        : undefined,
    );
    for (const said of [
      runStepLabel(evidence),
      runStepLine(failed, true) ?? "",
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

/**
 * A push the repository declined clears only once something there changes, so
 * its hold says what, and a workflow refusal names the settings the
 * Repositories page holds; every other hold is said by its label alone.
 */
test("a declined push and an unread one say what to change before a resume, and no other hold does", () => {
  expect(finalizationUnavailableKindLabel("PromotionDeclined")).toBe(
    "Push declined",
  );
  expect(finalizationUnavailableKindLabel("PromotionWorkflowsRefused")).toBe(
    "Workflow files refused",
  );
  const said = [
    ...blockedReasons,
    ...gitEvidences,
    ...finalizationUnavailableKinds,
  ].flatMap((evidence) => {
    const line = escalationEvidenceLine(evidence);
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
      code: "OperationNotPending",
      status: 409,
      body: undefined,
    }),
  ).toBe("Already decided");
  expect(
    operationFailureLabel({
      outcome: "Rejected",
      code: "TicketChanged",
      status: 409,
      body: undefined,
    }),
  ).toBe("Refused (TicketChanged)");
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
      refusal: undefined,
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
      refusal: { type: "TicketChanged" },
    },
    "Resume",
  );
  expect(refused.text).toBe("Resume refused · Ticket changed");
  expect(refused.wrong).toBe(true);
});

test("every finalization and approval label is inside the budget", () => {
  const drawn = [
    ...briefFinalizationKinds.map(finalizationKindLabel),
    ...briefFinalizationKinds.map(finalizationKindEffect),
    ...briefGitMergeModes.map(gitMergeModeLabel),
    ...briefGitMergeModes.map(gitMergeModeEffect),
    ...briefGitMergePolicies.map(gitMergePolicyLabel),
    ...briefGitMergePolicies.map(gitMergePolicyEffect),
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
 * are pinned: a kind, mode or policy renamed on the wire must not silently
 * rename the choice a person already made.
 */
test("a finalization's kind, a git merge's mode and its policy are each named as a noun and explained as what it does", () => {
  expect(briefFinalizationKinds.map(finalizationKindLabel)).toStrictEqual([
    "Git merge",
    "Pull request",
    "None",
  ]);
  expect(briefFinalizationKinds.map(finalizationKindEffect)).toStrictEqual([
    "Merges the work into the target branch",
    "Opens a pull request a person merges",
    "Lands nothing",
  ]);
  expect(briefGitMergeModes.map(gitMergeModeLabel)).toStrictEqual([
    "Push",
    "Pull request, then merge",
  ]);
  expect(briefGitMergeModes.map(gitMergeModeEffect)).toStrictEqual([
    "Commits straight onto the target branch",
    "Opens a pull request into the target branch and merges it",
  ]);
  expect(briefGitMergePolicies.map(gitMergePolicyLabel)).toStrictEqual([
    "Direct",
    "Serialized",
  ]);
  expect(briefGitMergePolicies.map(gitMergePolicyEffect)).toStrictEqual([
    "Lands as soon as it is accepted",
    "Lands alone on its reference, evaluated on what it lands",
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
test("a finalization read back names its reference, and a proposal names the default", () => {
  const target = "refs/heads/main";
  const push = { kind: "GitMerge", mode: "Push", policy: "Direct" } as const;
  const merge = {
    kind: "GitMerge",
    mode: "PullRequestMerge",
    policy: "Serialized",
  } as const;
  expect(finalizationLine({ ...push, target })).toBe(
    "Push · lands on refs/heads/main",
  );
  expect(finalizationLine(push)).toBe("Push");
  expect(finalizationLine({ kind: "PullRequest", target })).toBe(
    "Pull request · into refs/heads/main",
  );
  expect(finalizationLine({ kind: "PullRequest" })).toBe(
    "Pull request · into the default branch",
  );
  expect(finalizationLine({ ...merge, target })).toBe(
    "Pull request, then merge · into refs/heads/main",
  );
  expect(finalizationLine(merge)).toBe(
    "Pull request, then merge · into the default branch",
  );
  expect(finalizationLine({ kind: "None" })).toBe("None");
  expect(
    [push, merge, { kind: "PullRequest" } as const].map(
      finalizationMethodLabel,
    ),
  ).toStrictEqual(["Push", "Pull request, then merge", "Pull request"]);
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
  RemoteDeclined: "Remote declined",
  WorkflowsRefused: "Workflows refused",
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

/** The clock face is the reader's own, so the instants are built in it. */
test("an escalation the scheduler resumes once its usage pauses end says so, and when where a pause still holds it", () => {
  const nowMs = new Date(2026, 9, 3, 9, 0).getTime();
  const until = new Date(2026, 9, 3, 14, 5).toISOString();
  const lines = [
    usageResumeLine({ until }, nowMs),
    usageResumeLine({}, nowMs),
    usageResumeLine({ until: "not an instant" }, nowMs),
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
