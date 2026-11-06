/**
 * The new-ticket address's own reader: the ticket a duplicate starts from or
 * the draft a submit releases, as the router parsed it, and nothing where the
 * address names neither or names something that is not a ticket.
 */

import { expect, test } from "vitest";

import { ticketCreationQueryOf } from "../app/core/ticketCreationQuery.ts";

test("an address naming no ticket is a plain new ticket", () => {
  expect(ticketCreationQueryOf({})).toStrictEqual({});
});

test("a ticket number the router parsed as a number is the ticket", () => {
  expect(ticketCreationQueryOf({ from: 12 })).toStrictEqual({ from: 12 });
});

test("a ticket number the router kept as text is the same ticket", () => {
  expect(ticketCreationQueryOf({ from: "12" })).toStrictEqual({ from: 12 });
});

test.each([
  ["zero", 0],
  ["a negative number", -3],
  ["a fraction", 1.5],
  ["text that is not a number", "twelve"],
  ["signed text", "+12"],
  ["empty text", ""],
  ["a number past what is exact", 2 ** 53],
  ["a list", [12]],
  ["nothing", null],
])("%s names no ticket", (_, from) => {
  expect(ticketCreationQueryOf({ from })).toStrictEqual({});
  expect(ticketCreationQueryOf({ draft: from })).toStrictEqual({});
});

test("what else the address carries is not read", () => {
  expect(ticketCreationQueryOf({ from: 4, other: 9 })).toStrictEqual({
    from: 4,
  });
});

test("a draft is read as a number or as text, as the ticket it duplicates is", () => {
  expect(ticketCreationQueryOf({ draft: 12 })).toStrictEqual({ draft: 12 });
  expect(ticketCreationQueryOf({ draft: "12" })).toStrictEqual({ draft: 12 });
  expect(ticketCreationQueryOf({ draft: "041" })).toStrictEqual({ draft: 41 });
  expect(ticketCreationQueryOf({ from: "041" })).toStrictEqual({ from: 41 });
});

test("a draft named beside a ticket to duplicate is the draft", () => {
  expect(ticketCreationQueryOf({ draft: 12, from: 4 })).toStrictEqual({
    draft: 12,
  });
});

test("a draft that is no ticket leaves the duplicate it was named beside", () => {
  expect(ticketCreationQueryOf({ draft: "twelve", from: 4 })).toStrictEqual({
    from: 4,
  });
});
