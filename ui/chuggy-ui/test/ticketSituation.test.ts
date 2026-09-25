/**
 * What the ticket page's status bar and the slot under it are decided from:
 * which one card the slot holds, the resume line, the bar's tone and its dim
 * line, and which actions the card rather than the bar draws.
 */

import { expect, test } from "vitest";

import type {
  NativeActionResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import type { TicketAction } from "../app/core/ticketActions.ts";
import { offersAnswered } from "../app/core/ticketOffers.ts";
import {
  resumedFrom,
  ticketSlot,
  ticketStatusFigure,
  ticketStatusTone,
} from "../app/core/ticketSituation.ts";
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
    ledger: facts,
    stageCount: 1,
    open: [],
    executions: [],
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
    stageCount: ticket21Program.length,
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

test("a parked ticket needs you, with its wall and the stage it failed", () => {
  const slot = ticketSlot(
    over21(ticket21Parked, {
      phase: "Escalated",
      escalation: {
        kind: "EvaluationFailureEscalated",
        resumeAt: "ResumeRework",
      },
    }),
  );
  expect(slot).toEqual({
    slot: "NeedsYou",
    detail: "Rework budget exhausted",
    more: "Stage 1 of 2 failed",
  });
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
    more: undefined,
  });
});

test("a running ticket's slot is the current cycle's live run, numbered among the page's", () => {
  const slot = ticketSlot(over21(ticket21Resumed, { phase: "Evaluation" }));
  expect(slot.slot).toBe("Now");
  if (slot.slot !== "Now") throw new Error("not the Now card");
  expect(slot.running.execution.execution).toBe("execution-c40de507-8");
  expect(slot.running.stage).toBe("Stage 1 of 2");
  expect(slot.running.run).toBe("run 8");
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

/**
 * A two-stage page where each stage blocked at generation 1 and was re-asked;
 * the second stage's second generation ends however the case says.
 */
function twoResumedStages(
  lastRow: { readonly outcome: "Failed" } | { readonly status: "Running" },
): ReturnType<typeof ticketLedger> {
  return ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Blocked",
      },
      {
        execution: "execution-cc-3",
        task: 3,
        identity: evalIdentity(1, 1, 2),
        outcome: "Passed",
      },
      {
        execution: "execution-dd-4",
        task: 4,
        identity: evalIdentity(1, 2, 1),
        outcome: "Blocked",
      },
      {
        execution: "execution-ee-5",
        task: 5,
        identity: evalIdentity(1, 2, 2),
        ...lastRow,
      },
    ]),
    [
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }] },
    ],
  );
}

test("resumedFrom names the highest-numbered stage whose resume is still running", () => {
  expect(resumedFrom(twoResumedStages({ status: "Running" }))).toBe(
    "Resumed at stage 2 · cycle 1",
  );
});

test("with nothing running, resumedFrom names the highest-numbered stage a resume re-asked", () => {
  expect(resumedFrom(twoResumedStages({ outcome: "Failed" }))).toBe(
    "Resumed at stage 2 · cycle 1",
  );
});

test("a ticket never resumed has no resume line", () => {
  expect(
    resumedFrom(ticketLedger(ledgerPage(ticket21Parked), ticket21Program)),
  ).toBeUndefined();
});

test("the bar is tinted by the phase, and a blocked ticket is parked whatever its phase", () => {
  expect(ticketStatusTone(ticket())).toBe("queued");
  expect(ticketStatusTone(ticket({ phase: "Work" }))).toBe("live");
  expect(ticketStatusTone(ticket({ revokedDependencies: [3] }))).toBe("parked");
});

test("a running ticket is dated from its release, anything else from when it last moved", () => {
  const nowMs = Date.parse("2026-08-26T00:10:34Z");
  const running = ticketStatusFigure(
    ticket({ phase: "Work", changedAt: "2026-08-26T00:05:00Z" }),
    ledgerPage(ticket21Parked).executions,
    nowMs,
  );
  expect(running).toMatchObject({ kind: "Ago", text: "started 10m 34s ago" });
  const pending = ticketStatusFigure(
    ticket({ changedAt: "2026-08-25T23:54:00Z" }),
    [],
    nowMs,
  );
  expect(pending).toMatchObject({ kind: "Span", parts: ["16m 34s ago"] });
});

test("a settled ticket says how long it ran, from its release to its last run", () => {
  const page = ledgerPage([
    {
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
      terminalAt: "2026-08-26T00:37:00Z",
    },
  ]);
  const parked = ticketStatusFigure(
    ticket({ phase: "Escalated", changedAt: "2026-08-26T00:37:00Z" }),
    page.executions,
    Date.parse("2026-08-26T01:00:00Z"),
  );
  expect(parked).toMatchObject({ kind: "Span", parts: ["23m ago", "ran 37m"] });
});

const resume: TicketAction = {
  action: "Resume",
  mutation: { mutation: "ResumeTicket", ticket: 21 },
};
const revoke: TicketAction = {
  action: "Revoke",
  mutation: { mutation: "RevokeTicket", ticket: 21 },
};

test("a card that asks takes the actions that answer it, and the bar keeps the rest", () => {
  const offers = {
    offers: "Actions",
    actions: [resume, revoke],
    editable: false,
  } as const;
  expect(offersAnswered(offers, true)).toEqual([resume]);
  expect(offersAnswered(offers, false)).toEqual([]);
  expect(offersAnswered({ offers: "Unread" }, true)).toEqual([]);
});
