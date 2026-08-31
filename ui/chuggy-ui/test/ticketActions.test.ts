/**
 * What `actionsFor` offers, phase by phase over the whole roster.
 *
 * The roster is walked rather than listed, so a phase the wire gains arrives
 * here as a case with no expectation rather than as a phase nobody looked at.
 * `test/ui/ticketActions.test.ts` is where the same offers are held against the
 * model's own predicates.
 */

import { expect, test } from "vitest";

import {
  escalationReasons,
  phaseRoster,
} from "../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import { actionsFor, manualDispatchAction } from "../app/core/ticketActions.ts";
import { ticketInstants } from "./ticketInstants.ts";

const offeredBy: Readonly<Record<TicketPhase, readonly string[]>> = {
  Pending: ["Revoke"],
  Working: ["Revoke"],
  Evaluating: ["Revoke"],
  Finalizing: [],
  PublishingHandoff: [],
  HandoffBlocked: ["Resume"],
  Done: [],
  Abandoned: [],
  Escalated: ["Resume", "Revoke"],
  Revoked: [],
};

function offers(phase: TicketPhase): readonly string[] {
  return actionsFor({ ticket: 7, phase, sequence: 3, ...ticketInstants }).map(
    (offer) => offer.action,
  );
}

test("every phase on the roster offers exactly what it enables", () => {
  for (const phase of phaseRoster)
    expect(offers(phase)).toEqual(offeredBy[phase]);
  expect(Object.keys(offeredBy).sort()).toEqual([...phaseRoster].sort());
});

test("resume is offered before revoke, so the destructive answer is second", () => {
  expect(offers("Escalated")).toEqual(["Resume", "Revoke"]);
});

test("every mutation names the ticket it was built for", () => {
  for (const phase of phaseRoster)
    for (const offer of actionsFor({
      ticket: 41,
      phase,
      sequence: 1,
      ...ticketInstants,
    }))
      expect(offer.mutation).toEqual({
        mutation: offer.action === "Resume" ? "ResumeTicket" : "RevokeTicket",
        ticket: 41,
      });
});

test("an escalation offers the same two answers whatever wall it hit", () => {
  for (const reason of escalationReasons)
    expect(
      actionsFor({
        ticket: 7,
        phase: "Escalated",
        sequence: 3,
        reason,
        ...ticketInstants,
      }).map((offer) => offer.action),
    ).toEqual(["Resume", "Revoke"]);
});

test("manual dispatch echoes only the candidate version the view supplied", () => {
  const action = manualDispatchAction(7, {
    result: "Page",
    token: {
      tenant: "acme",
      project: "atlas",
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 9,
      digest: "a".repeat(64),
    },
    candidates: [
      {
        ticket: 7,
        ticketVersion: 12,
        dependencies: [],
        workFanout: 1,
        program: [],
        reworkPolicy: { type: "BudgetedRework", value: 1 },
        finalizationPricing: "DeadlineOnly",
        resumePricing: "RetryFree",
        finalizer: "NoFinalizer",
        configurationRevision: "r1",
        configurationDigest: "b".repeat(64),
        configurationCanonical: "{}",
      },
    ],
    notificationCursor: 3,
  });
  expect(action).toEqual({
    action: "Dispatch",
    mutation: {
      mutation: "ManualDispatch",
      ticket: 7,
      expectedTicketVersion: 12,
    },
  });
});

test("manual dispatch is absent when the strict view does not offer the ticket", () => {
  expect(manualDispatchAction(7, { result: "Reset" })).toBeUndefined();
});
