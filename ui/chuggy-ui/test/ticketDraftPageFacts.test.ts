/**
 * Which draft the ticket page draws in a ticket's place, what it calls one,
 * and the plan it reads from one: a draft never released, while no ticket has
 * been read, named as a ticket's read names its ticket, running its own
 * program.
 */

import { expect, test } from "vitest";

import { briefTitleCharsMax } from "../../../src/contract/brief.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  ticketDraftPageFacts,
  ticketDraftTitleOf,
  ticketPageUnreleased,
} from "../app/core/ticketPageFacts.ts";
import { creationDraft } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const released: DraftResponse = {
  ...creationDraft,
  state: "Released",
  releasedAuthoringVersion: creationDraft.authoringVersion,
};

const ticket: TicketResponse = {
  ticket: creationDraft.ticket,
  phase: "Pending",
  sequence: 4,
  ...ticketInstants,
};

test("a draft never released is drawn in the ticket's place while no ticket is read", () => {
  expect(ticketPageUnreleased(undefined, creationDraft)).toBe(creationDraft);
});

test("a ticket read, a released draft, a deleted one and an unread one are never drawn as a draft", () => {
  expect([
    ticketPageUnreleased(ticket, creationDraft),
    ticketPageUnreleased(undefined, released),
    ticketPageUnreleased(undefined, { ...creationDraft, state: "Deleted" }),
    ticketPageUnreleased(undefined, undefined),
  ]).toStrictEqual([undefined, undefined, undefined, undefined]);
});

test("a draft is called by its brief's title, else its intent's first line that says anything, cut to a title's bound", () => {
  const briefed = (brief: DraftResponse["brief"]): DraftResponse => ({
    ...creationDraft,
    brief,
  });
  const long = "x".repeat(briefTitleCharsMax + 1);
  expect([
    ticketDraftTitleOf(briefed({ title: "Ship it", intent: "a", links: [] })),
    ticketDraftTitleOf(briefed({ intent: "\n  \nShip it\nnow", links: [] })),
    ticketDraftTitleOf(briefed({ intent: long, links: [] })),
    ticketDraftTitleOf(briefed({ intent: " \n", links: [] })),
    ticketDraftTitleOf(creationDraft),
  ]).toStrictEqual([
    "Ship it",
    "Ship it",
    long.slice(0, briefTitleCharsMax),
    undefined,
    undefined,
  ]);
});

test("a draft's plan is its own program, and it has run nothing", () => {
  const facts = ticketDraftPageFacts(
    {
      ...creationDraft,
      authoring: {
        dependencies: [],
        program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
      },
    },
    undefined,
  );
  expect(
    facts.plan.stages.map((stage) => [stage.name, stage.evaluators.length]),
  ).toStrictEqual([["Stage 1", 2]]);
  expect([facts.ledger, facts.program, facts.truncated]).toStrictEqual([
    undefined,
    undefined,
    false,
  ]);
});
