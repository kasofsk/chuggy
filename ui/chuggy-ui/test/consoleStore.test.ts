/**
 * The console's store: a store per call, and the box a reader typed at kept
 * through the slice exactly as `core/leadInquiries.ts` keeps it.
 */

import { expect, test } from "vitest";

import {
  inquiryBoxAnsweredAt,
  inquiryBoxAt,
  inquiryBoxSentAt,
  inquiryBoxTypedAt,
} from "../app/browser/lead/inquiryBoxes.ts";
import { inquiryBoxEmpty, inquiryDraw } from "../app/core/leadInquiries.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";

const atlas = { tenant: "acme", project: "atlas" };
const borealis = { tenant: "acme", project: "borealis" };

test("each store holds its own boxes, so nothing crosses from one to the next", () => {
  const first = consoleStoreBare();
  first.dispatch(inquiryBoxTypedAt({ partition: atlas, typed: "why" }));
  expect(inquiryBoxAt(first.getState(), atlas).typed).toBe("why");
  expect(inquiryBoxAt(consoleStoreBare().getState(), atlas)).toBe(
    inquiryBoxEmpty,
  );
});

test("a box keeps its pair through a refusal and spends it on an accepted send", () => {
  const store = consoleStoreBare();
  store.dispatch(inquiryBoxTypedAt({ partition: atlas, typed: "why" }));
  const draw = inquiryDraw(undefined, "why", atlas, () => "pair-1");
  store.dispatch(inquiryBoxSentAt(draw));
  const refusedWord = { id: "lead-inquiry-refusal-unknown" } as const;
  store.dispatch(
    inquiryBoxAnsweredAt({
      draw,
      answer: { ask: "Refused", word: refusedWord },
    }),
  );
  const refused = inquiryBoxAt(store.getState(), atlas);
  expect(refused.held).toStrictEqual(draw);
  expect(refused.ask).toStrictEqual({ ask: "Refused", word: refusedWord });
  store.dispatch(
    inquiryBoxAnsweredAt({ draw, answer: { ask: "Asked", session: "inq-1" } }),
  );
  const asked = inquiryBoxAt(store.getState(), atlas);
  expect(asked.held).toBeUndefined();
  expect(asked.typed).toBe("");
  expect(asked.ask).toStrictEqual({ ask: "Asked", session: "inq-1" });
  expect(inquiryBoxAt(store.getState(), borealis)).toBe(inquiryBoxEmpty);
});
