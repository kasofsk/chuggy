/**
 * The console's store and the two cells it holds: a store per call, the box a
 * reader typed at kept through the slice exactly as `core/leadInquiries.ts`
 * keeps it, and an inbox's answer line heard only while an inbox of its
 * project is drawn.
 */

import { expect, test } from "vitest";

import { consoleStore } from "../app/browser/store.ts";
import {
  inquiryBoxAnsweredAt,
  inquiryBoxAt,
  inquiryBoxSentAt,
  inquiryBoxTypedAt,
} from "../app/browser/lead/inquiryBoxes.ts";
import {
  inboxProposalDrawnAt,
  inboxProposalHeardAt,
  inboxProposalLastAt,
  inboxProposalLeftAt,
} from "../app/browser/inboxProposalHeard.ts";
import { inquiryBoxEmpty, inquiryDraw } from "../app/core/leadInquiries.ts";
import type { InboxProposalAnswer } from "../app/core/inboxProposals.ts";

const atlas = { tenant: "acme", project: "atlas" };
const borealis = { tenant: "acme", project: "borealis" };

const approved: InboxProposalAnswer = {
  proposal: { decision: "dec-one", tickets: [7] },
  step: { step: "Answered", outcome: "Approved" },
};

test("each store holds its own boxes, so nothing crosses from one to the next", () => {
  const first = consoleStore();
  first.dispatch(inquiryBoxTypedAt({ partition: atlas, typed: "why" }));
  expect(inquiryBoxAt(first.getState(), atlas).typed).toBe("why");
  expect(inquiryBoxAt(consoleStore().getState(), atlas)).toBe(inquiryBoxEmpty);
});

test("a box keeps its pair through a refusal and spends it on an accepted send", () => {
  const store = consoleStore();
  store.dispatch(inquiryBoxTypedAt({ partition: atlas, typed: "why" }));
  const draw = inquiryDraw(undefined, "why", atlas, () => "pair-1");
  store.dispatch(inquiryBoxSentAt(draw));
  store.dispatch(
    inquiryBoxAnsweredAt({
      draw,
      answer: { ask: "Refused", word: "Busy" },
    }),
  );
  const refused = inquiryBoxAt(store.getState(), atlas);
  expect(refused.held).toStrictEqual(draw);
  expect(refused.ask).toStrictEqual({ ask: "Refused", word: "Busy" });
  store.dispatch(
    inquiryBoxAnsweredAt({ draw, answer: { ask: "Asked", session: "inq-1" } }),
  );
  const asked = inquiryBoxAt(store.getState(), atlas);
  expect(asked.held).toBeUndefined();
  expect(asked.typed).toBe("");
  expect(asked.ask).toStrictEqual({ ask: "Asked", session: "inq-1" });
  expect(inquiryBoxAt(store.getState(), borealis)).toBe(inquiryBoxEmpty);
});

test("an inbox answer is heard only while an inbox of its project is drawn", () => {
  const store = consoleStore();
  store.dispatch(inboxProposalHeardAt({ partition: atlas, answer: approved }));
  store.dispatch(inboxProposalDrawnAt(atlas));
  expect(
    inboxProposalLastAt(store.getState(), atlas),
    "an answer given while no inbox was drawn was said by the next one",
  ).toBeUndefined();
  store.dispatch(inboxProposalHeardAt({ partition: atlas, answer: approved }));
  expect(inboxProposalLastAt(store.getState(), atlas)).toStrictEqual(approved);
  expect(inboxProposalLastAt(store.getState(), borealis)).toBeUndefined();
});

/** A strict double-invoke draws, leaves and draws again, and the line it
 * heard dies only with the last inbox of its project. */
test("an inbox answer dies with the last inbox of its project", () => {
  const store = consoleStore();
  store.dispatch(inboxProposalDrawnAt(atlas));
  store.dispatch(inboxProposalDrawnAt(atlas));
  store.dispatch(inboxProposalHeardAt({ partition: atlas, answer: approved }));
  store.dispatch(inboxProposalLeftAt(atlas));
  expect(inboxProposalLastAt(store.getState(), atlas)).toStrictEqual(approved);
  store.dispatch(inboxProposalLeftAt(atlas));
  expect(inboxProposalLastAt(store.getState(), atlas)).toBeUndefined();
  expect(store.getState().inboxProposalHeard).toStrictEqual({});
});
