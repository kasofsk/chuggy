/**
 * What a parked ticket's card offers of its overrides and what a save sends,
 * and the overrides a duplicate of a ticket past Pending starts from: the
 * ticket's own, which a parked change may have moved past its draft's.
 */

import { expect, test } from "vitest";

import { parkedOverrideFields } from "../../../src/contract/configurationOverrides.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { TicketAction } from "../app/core/ticketActions.ts";
import { ticketDuplicateSeed } from "../app/core/ticketDuplicate.ts";
import {
  parkedOverrideFieldsDrawn,
  parkedOverridesFence,
  parkedOverridesMutation,
  parkedOverridesSeed,
  parkedOverridesUnsaved,
} from "../app/core/ticketParkedOverrides.ts";
import { creationDraft } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const opus = {
  type: "SingleAgent" as const,
  agent: "Claude" as const,
  arguments: ["--model=opus"],
};

const instructions = ["Do it the overridden way."];

const parked: TicketResponse = {
  ticket: 11,
  phase: "Escalated",
  sequence: 52,
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  dependable: false,
  ...ticketInstants,
  overrides: { work: { instructions }, worker: { setup: ["make"] } },
} as TicketResponse;

const resume: TicketAction = {
  action: "Resume",
  mutation: {
    mutation: "ResolveNativeAction",
    action: "action-escalated",
    authorizingSequence: 52,
    resolution: "Resume",
  },
};

test("the card draws exactly the fields the contract lets a parked ticket change", () => {
  expect([...parkedOverrideFieldsDrawn].sort()).toStrictEqual(
    [...parkedOverrideFields].sort(),
  );
  expect(parkedOverrideFieldsDrawn).not.toContain("work.instructions");
});

test("a change is fenced to the escalation the card's Resume answers", () => {
  expect(parkedOverridesFence(parked, [resume])).toStrictEqual({
    action: "action-escalated",
    authorizingSequence: 52,
  });
  expect(
    parkedOverridesFence(parked, [
      {
        action: "Resume",
        mutation: { mutation: "ResumeTicket", ticket: 11 },
      },
    ]),
  ).toBeUndefined();
  expect(
    parkedOverridesFence({ ...parked, phase: "Work" }, [resume]),
  ).toBeUndefined();
});

test("a ticket parked where its resume starts no worker is offered no change", () => {
  expect(
    parkedOverridesFence(
      {
        ...parked,
        escalation: {
          kind: "FinalizationUnavailableEscalated",
          resumeAt: "ResumeFinalization",
        },
      },
      [resume],
    ),
  ).toBeUndefined();
});

test("the card seeds from the ticket, and holds nothing unsaved until it differs", () => {
  const seed = parkedOverridesSeed(parked);
  expect(seed).toStrictEqual({ "worker.setup": ["make"] });
  expect(parkedOverridesUnsaved(parked, seed)).toBe(false);
  expect(parkedOverridesUnsaved(parked, { ...seed, "worker.mode": opus })).toBe(
    true,
  );
});

test("a save sends the whole of what the ticket is to hold, keeping what the card does not draw", () => {
  const fence = parkedOverridesFence(parked, [resume]);
  if (fence === undefined) throw new Error("no fence");
  expect(
    parkedOverridesMutation(parked, fence, { "worker.mode": opus }),
  ).toStrictEqual({
    mutation: "ChangeTicketOverrides",
    ticket: 11,
    action: "action-escalated",
    authorizingSequence: 52,
    overrides: { worker: { mode: opus }, work: { instructions } },
  });
});

const draft: DraftResponse = {
  ...creationDraft,
  overrides: { worker: { setup: ["as released"] } },
};

function duplicated(ticket: TicketResponse | undefined) {
  return ticketDuplicateSeed({
    draft,
    ...(ticket === undefined ? {} : { ticket }),
    offers: [],
    bound: [],
    revoked: [],
    preferred: undefined,
    partial: false,
  }).form.overrides;
}

test("a duplicate of a ticket past Pending starts from the overrides the ticket holds, not its draft's", () => {
  expect(duplicated(parked)).toStrictEqual({
    "worker.setup": ["make"],
    "work.instructions": instructions,
  });
  expect(duplicated({ ...parked, phase: "Pending" })).toStrictEqual({
    "worker.setup": ["as released"],
  });
  expect(duplicated(undefined)).toStrictEqual({
    "worker.setup": ["as released"],
  });
});
