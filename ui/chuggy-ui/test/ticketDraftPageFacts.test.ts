/**
 * Which draft the ticket page draws in a ticket's place, what it calls one,
 * and the plan it reads from one: a draft never released, while no ticket has
 * been read and until one is once it leaves Draft, named as a ticket's read
 * names its ticket, running its own program.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";

import { briefTitleCharsMax } from "../../../src/contract/brief.ts";
import { textCodePointsCount } from "../../../src/contract/http.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  ticketDraftPageFacts,
  ticketDraftTitleOf,
  ticketPageDrawn,
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
  expect(ticketPageDrawn(undefined, creationDraft, undefined)).toStrictEqual({
    drawn: "Draft",
    draft: creationDraft,
  });
});

test("a ticket read, and a released, deleted or unread draft the page never drew, draw the ticket", () => {
  expect([
    ticketPageDrawn(ticket, creationDraft, creationDraft),
    ticketPageDrawn(undefined, released, undefined),
    ticketPageDrawn(
      undefined,
      { ...creationDraft, state: "Deleted" },
      undefined,
    ),
    ticketPageDrawn(undefined, undefined, undefined),
  ]).toStrictEqual(Array.from({ length: 4 }, () => ({ drawn: "Ticket" })));
});

test("a drawn draft that leaves Draft while no ticket is read stays drawn, saying how it left", () => {
  expect([
    ticketPageDrawn(undefined, released, creationDraft),
    ticketPageDrawn(
      undefined,
      { ...creationDraft, state: "Deleted" },
      creationDraft,
    ),
    ticketPageDrawn(undefined, undefined, creationDraft),
  ]).toStrictEqual([
    { drawn: "Departed", draft: creationDraft, left: "Released" },
    { drawn: "Departed", draft: creationDraft, left: "Deleted" },
    { drawn: "Departed", draft: creationDraft, left: "Deleted" },
  ]);
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

test("a draft's title is cut in code points, as the server bounds one, and never splits a character", () => {
  const astral = `a${"😀".repeat(briefTitleCharsMax)}`;
  const title = ticketDraftTitleOf({
    ...creationDraft,
    brief: { intent: astral, links: [] },
  });
  expect(title).toBe(`a${"😀".repeat(briefTitleCharsMax - 1)}`);
  expect(textCodePointsCount(title ?? "")).toBe(briefTitleCharsMax);
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
    copyTextEn,
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
