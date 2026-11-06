/**
 * Which one card the ticket's Overview holds, and what it says: the run going
 * now as its step and cycle, or what a parked ticket waits on, where it
 * stopped and the run it stopped at.
 */

import { expect, test } from "vitest";

import type {
  NativeActionResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { ticketLandingOf } from "../app/core/ticketLandings.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { ticketSlot } from "../app/core/ticketSituation.ts";
import type { SituationReads } from "../app/core/ticketSituation.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  evalIdentity,
  ledgerPage,
  ticket21Program,
  ticket21Parked,
  ticket21Resumed,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { landingEscalated, landingHeld } from "./ticketLandingsFixture.ts";

const facts = ticketLedger(ledgerPage([]), []);

function ticket(over: Partial<TicketResponse> = {}): TicketResponse {
  return {
    ticket: 11,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    ...over,
  };
}

function reads(over: Partial<SituationReads> = {}): SituationReads {
  return {
    ticket: ticket(),
    landings: [],
    ledger: facts,
    names: undefined,
    open: [],
    executions: [],
    setupOverridable: false,
    nowMs: 0,
    ...over,
  };
}

/** Ticket 21's runs and the reads a page over them would hold. */
function over21(
  shapes: readonly ExecutionShape[],
  over: Partial<TicketResponse>,
): SituationReads {
  const page = ledgerPage(shapes);
  return reads({
    ticket: ticket({ ticket: 21, ...over }),
    ledger: ticketLedger(page, ticket21Program),
    names: ["checks", "review"],
    executions: page.executions,
  });
}

const approval: NativeActionResponse = {
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

test("a Pending ticket blocked by one revoked dependency needs you, and names it singular", () => {
  expect(
    ticketSlot(reads({ ticket: ticket({ revokedDependencies: [3] }) })),
  ).toEqual({
    slot: "NeedsYou",
    detail: "Blocked by revoked dependency 3",
    where: undefined,
    run: undefined,
    more: undefined,
  });
});

test("a Pending ticket blocked by more than one names them, plural and ascending", () => {
  const slot = ticketSlot(
    reads({ ticket: ticket({ revokedDependencies: [1, 2] }) }),
  );
  expect(slot).toMatchObject({
    detail: "Blocked by revoked dependencies 1, 2",
  });
});

test("a Pending ticket waiting on nothing, a Done one and a Revoked one leave the slot empty", () => {
  for (const phase of ["Pending", "Done", "Revoked"] as const)
    expect(ticketSlot(reads({ ticket: ticket({ phase }) }))).toEqual({
      slot: "Nothing",
    });
});

const reworkExhausted = {
  phase: "Escalated",
  escalation: { kind: "EvaluationFailureEscalated", resumeAt: "ResumeRework" },
} as const;

test("a parked ticket needs you: its wall, the step and cycle it stopped at by the plan's name, and the run that stopped it", () => {
  expect(ticketSlot(over21(ticket21Parked, reworkExhausted))).toStrictEqual({
    slot: "NeedsYou",
    detail: "Rework budget exhausted",
    where: "Failed at checks in cycle 3",
    run: { task: 7, execution: "execution-b8bdfdd4-7", step: "checks" },
    step: undefined,
    more: undefined,
    reason: undefined,
  });
});

test("a parked ticket's stop is read from as much of its cycle as the page holds, and is none where it holds none", () => {
  const slot = ticketSlot(
    reads({
      ticket: ticket(reworkExhausted),
      ledger: ticketLedger(
        ledgerPage([
          {
            execution: "execution-1",
            task: 1,
            identity: evalIdentity(1, 2, 1),
            outcome: "Failed",
          },
        ]),
        ticket21Program,
      ),
      names: ["checks", "review"],
    }),
  );
  expect(slot).toMatchObject({
    where: "Failed at review in cycle 1",
    run: { task: 1, step: "review" },
  });
  expect(
    ticketSlot(reads({ ticket: ticket(reworkExhausted), ledger: undefined })),
  ).toMatchObject({ where: undefined, run: undefined });
});

/** The first ticket of a project with no runner parks here, before any run. */
test("a ticket parked with nowhere to run says so, and leads to Runners", () => {
  expect(
    ticketSlot(
      reads({
        ticket: ticket({
          phase: "Escalated",
          escalation: {
            kind: "WorkExecutionUnavailableEscalated",
            evidence: "RequiredCapabilityUnavailable",
            resumeAt: "ResumeWork",
          },
        }),
      }),
    ),
  ).toStrictEqual({
    slot: "NeedsYou",
    detail: "Nowhere to run this work",
    where: undefined,
    run: undefined,
    step: "Runners",
    more: "Work cancelled",
    reason: undefined,
  });
});

/** A job a usage limit stopped is resumed by the scheduler once the pauses
 * holding it end, and the card says when in the reader's own zone. */
test("a ticket the scheduler resumes once its usage pauses end says so under its wall, with when where a pause still holds it", () => {
  const nowMs = new Date(2026, 9, 3, 9, 0).getTime();
  const until = new Date(2026, 9, 3, 14, 5).toISOString();
  const parked = (usageResume: { readonly until?: string }) =>
    ticketSlot(
      reads({
        nowMs,
        ticket: ticket({
          phase: "Escalated",
          escalation: {
            kind: "WorkFailureEscalated",
            resumeAt: "ResumeWork",
            usageResume,
          },
        }),
      }),
    );
  expect(parked({ until })).toStrictEqual({
    slot: "NeedsYou",
    detail: "Work failed",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Resumes automatically · 14:05",
    reason: undefined,
  });
  expect(parked({})).toMatchObject({ more: "Resumes automatically" });
});

/**
 * The newcomer's evaluation clone died on her own runner: the card names the
 * runner rather than a failed evaluation, says how often the scheduler resumed
 * it, and reads the worker's own line off the attempt that kept one.
 */
test("a job lost on its runner says where, how often, and the attempt its worker spoke for", () => {
  const silent = {
    runner: { kind: "Pool" as const, pool: "runner-a" },
    execution: "execution-1",
    attempt: "attempt-3",
    evidence: "RunFailed" as const,
    losses: 3,
    resumed: 2,
  };
  const kept = { ...silent, error: { bytes: 61 } };
  const parked = (lost: typeof silent) =>
    ticketSlot(
      reads({
        ticket: ticket({
          phase: "Escalated",
          escalation: {
            kind: "EvaluationBlockedEscalated",
            resumeAt: "ResumeEvaluation",
            lost,
          },
        }),
      }),
    );
  expect(parked(kept)).toStrictEqual({
    slot: "NeedsYou",
    detail: "Lost on runner-a",
    where: undefined,
    run: undefined,
    step: "Runners",
    more: "3 losses · 2 resumed automatically",
    reason: { execution: "execution-1", attempt: "attempt-3" },
  });
  expect(parked(silent)).toMatchObject({
    detail: "Lost on runner-a",
    reason: undefined,
  });
});

/** The slot of a ticket whose work escalated at a failed step, to a reader offered the ticket's setup lines or not. */
const parkedAtStep = (
  failed: {
    readonly evidence: "RunSetupFailed" | "RunPushFailed" | "RunDiskLow";
    readonly execution: string;
    readonly attempt: string;
    readonly error?: { readonly bytes: number };
  },
  setupOverridable = true,
) =>
  ticketSlot(
    reads({
      ticket: ticket({
        phase: "Escalated",
        escalation: {
          kind: "WorkFailureEscalated",
          resumeAt: "ResumeWork",
          failed,
        },
      }),
      setupOverridable,
    }),
  );

/**
 * A run stopped at its setup names the step, says where a wrong line is fixed
 * to a reader offered the ticket's setup lines, and reads the worker's own line
 * off the attempt that kept one; any other step, and a reader not offered
 * them, keeps the wall's own line.
 */
test("a run stopped at a failed step names the step, and the attempt its worker spoke for", () => {
  const setup = {
    evidence: "RunSetupFailed",
    execution: "execution-1",
    attempt: "attempt-3",
    error: { bytes: 61 },
  } as const;
  expect(parkedAtStep(setup)).toStrictEqual({
    slot: "NeedsYou",
    detail: "Setup failed",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Fix it under Overrides · Setup, then Resume",
    reason: { execution: "execution-1", attempt: "attempt-3" },
  });
  expect(parkedAtStep(setup, false)).toStrictEqual({
    slot: "NeedsYou",
    detail: "Setup failed",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Failed work is not reworked",
    reason: { execution: "execution-1", attempt: "attempt-3" },
  });
  expect(
    parkedAtStep({
      evidence: "RunPushFailed",
      execution: "execution-1",
      attempt: "attempt-3",
    }),
  ).toStrictEqual({
    slot: "NeedsYou",
    detail: "Push failed",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Failed work is not reworked",
    reason: undefined,
  });
});

test("a run its runner stopped for low disk says that runner needs room, to any reader", () => {
  expect(
    parkedAtStep(
      {
        evidence: "RunDiskLow",
        execution: "execution-1",
        attempt: "attempt-3",
        error: { bytes: 140 },
      },
      false,
    ),
  ).toStrictEqual({
    slot: "NeedsYou",
    detail: "Disk low",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Free space on its runner, then Resume",
    reason: { execution: "execution-1", attempt: "attempt-3" },
  });
});

/**
 * A landing whose push the repository declined, or whose pushed branch would
 * not read, parks at the finalization wall once its hold has waited, and the
 * card says what has to change before Resume gets it past; a workflow refusal
 * leads to where Workflow files is set.
 */
test("a landing whose push was declined or would not read says what to change, and a workflow refusal leads to Repositories", () => {
  const parked = (
    evidence:
      | "PromotionDeclined"
      | "PromotionWorkflowsRefused"
      | "ReconciliationUnreadable",
  ) =>
    ticketSlot(
      reads({
        ticket: ticket({
          phase: "Escalated",
          escalation: {
            kind: "FinalizationUnavailableEscalated",
            evidence,
            resumeAt: "ResumeFinalization",
          },
        }),
      }),
    );
  expect(parked("PromotionWorkflowsRefused")).toStrictEqual({
    slot: "NeedsYou",
    detail: "Workflow files refused",
    where: undefined,
    run: undefined,
    step: "Repositories",
    more: "Turn on Workflow files and the App's Workflows, then Resume",
    reason: undefined,
  });
  expect(parked("PromotionDeclined")).toStrictEqual({
    slot: "NeedsYou",
    detail: "Push declined",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Check the branch's rules and hooks, then Resume",
    reason: undefined,
  });
  expect(parked("ReconciliationUnreadable")).toStrictEqual({
    slot: "NeedsYou",
    detail: "Reconciliation unreadable",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Restore the branch or the App's access, then Resume",
    reason: undefined,
  });
});

test("a ticket that needs you for anything else leads to no page", () => {
  const parked = ticketSlot(
    reads({
      ticket: ticket({
        phase: "Escalated",
        escalation: {
          kind: "WorkExecutionUnavailableEscalated",
          evidence: "ExecutionProfileUnavailable",
          resumeAt: "ResumeWork",
        },
      }),
    }),
  );
  const blocked = ticketSlot(
    reads({ ticket: ticket({ revokedDependencies: [3] }) }),
  );
  const asked = ticketSlot(reads({ open: [approval] }));
  for (const slot of [parked, blocked, asked])
    expect(slot).toMatchObject({ slot: "NeedsYou", step: undefined });
  expect(Object.keys(asked)).toContain("step");
});

test("an open approval needs you even while the ticket is running", () => {
  const running = over21(
    [
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        status: "Running",
      },
    ],
    { phase: "Finalization" },
  );
  expect(ticketSlot({ ...running, open: [approval] })).toEqual({
    slot: "NeedsYou",
    detail: "Awaiting approval",
    where: undefined,
    run: undefined,
    more: undefined,
  });
});

test("a running ticket's slot is the current cycle's live run, numbered among the page's", () => {
  const slot = ticketSlot(over21(ticket21Resumed, { phase: "Evaluation" }));
  expect(slot.slot).toBe("Now");
  if (slot.slot !== "Now") throw new Error("not the Now card");
  expect(slot.running.execution.execution).toBe("execution-c40de507-8");
  expect(slot.running.step).toBe("checks");
  expect(slot.running.cycle).toBe(3);
});

test("a running ticket with nothing live in its current cycle leaves the slot empty", () => {
  expect(ticketSlot(over21(ticket21Parked, { phase: "Evaluation" }))).toEqual({
    slot: "Nothing",
  });
});

test("a live run a phase no longer running left behind is not drawn as now", () => {
  expect(ticketSlot(over21(ticket21Resumed, { phase: "Done" }))).toEqual({
    slot: "Nothing",
  });
});

const escalatedSince = "2026-11-02T22:21:18Z";

/** The slot of a ticket parked at the finalization wall at `evidence`, over `landings`. */
function parkedOver(
  evidence:
    | "ProposalDequeued"
    | "ProposalQueueTimedOut"
    | "ProposalMergesExhausted"
    | "ProposalQueueChecksFailed",
  landings: SituationReads["landings"],
) {
  return ticketSlot(
    reads({
      ticket: ticket({
        phase: "Escalated",
        escalation: {
          kind: "FinalizationUnavailableEscalated",
          evidence,
          resumeAt: "ResumeFinalization",
        },
      }),
      landings,
    }),
  );
}

/** The landings of a ticket whose newest escalated from `kind`, naming `removal` where given. */
function escalatedFrom(
  kind: Parameters<typeof landingEscalated>[2],
  removal?: { readonly reason: string; readonly actor?: string },
): SituationReads["landings"] {
  return [ticketLandingOf(landingEscalated(5, escalatedSince, kind, removal))];
}

test("an escalation over a merge queue removal names the forge's reason and who removed the pull request", () => {
  expect(
    parkedOver(
      "ProposalDequeued",
      escalatedFrom("ProposalDequeued", { reason: "manual", actor: "gdoteof" }),
    ),
  ).toStrictEqual({
    slot: "NeedsYou",
    detail: "Removed from merge queue",
    where: undefined,
    run: undefined,
    step: undefined,
    more: "Queue removal: manual by gdoteof",
    reason: undefined,
  });
  expect(
    parkedOver(
      "ProposalQueueTimedOut",
      escalatedFrom("ProposalQueueTimedOut", { reason: "checks_timed_out" }),
    ),
  ).toMatchObject({ more: "Queue removal: checks_timed_out" });
  for (const evidence of [
    "ProposalMergesExhausted",
    "ProposalQueueChecksFailed",
  ] as const)
    expect(
      parkedOver(
        evidence,
        escalatedFrom(evidence, {
          reason: "failed_checks",
          actor: "github-merge-queue",
        }),
      ),
    ).toMatchObject({
      more: "Queue removal: failed_checks by github-merge-queue",
    });
});

test("an escalation over a hold that names no removal, or whose newest landing is not the escalated one, reads as the escalation alone", () => {
  for (const landings of [
    [],
    escalatedFrom("ProposalMergesExhausted"),
    escalatedFrom("ProposalDequeued", { reason: "manual", actor: "gdoteof" }),
    [ticketLandingOf(landingHeld(5, escalatedSince))],
  ])
    expect(parkedOver("ProposalMergesExhausted", landings)).toStrictEqual({
      slot: "NeedsYou",
      detail: "Proposal merges exhausted",
      where: undefined,
      run: undefined,
      step: undefined,
      more: undefined,
      reason: undefined,
    });
});
