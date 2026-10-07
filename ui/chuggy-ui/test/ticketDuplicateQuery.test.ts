/**
 * The new-ticket address's own reader: the ticket a duplicate starts from, as
 * the router parsed it, and nothing where the address names none or names
 * something that is not a ticket.
 */

import { expect, test } from "vitest";

import { ticketDuplicateQueryOf } from "../app/core/ticketDuplicate.ts";

test("an address naming no ticket is a plain new ticket", () => {
  expect(ticketDuplicateQueryOf({})).toStrictEqual({});
});

test("a ticket number the router parsed as a number is the ticket", () => {
  expect(ticketDuplicateQueryOf({ from: 12 })).toStrictEqual({ from: 12 });
});

test("a ticket number the router kept as text is the same ticket", () => {
  expect(ticketDuplicateQueryOf({ from: "12" })).toStrictEqual({ from: 12 });
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
  expect(ticketDuplicateQueryOf({ from })).toStrictEqual({});
});

test("what else the address carries is not read", () => {
  expect(ticketDuplicateQueryOf({ from: 4, other: 9 })).toStrictEqual({
    from: 4,
  });
});
