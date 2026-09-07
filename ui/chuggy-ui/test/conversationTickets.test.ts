/**
 * Which tickets one exchange's work touched, and what was done to each: the
 * five wire tools read off `chuggyTicketWriteTools`, matched past the
 * runtime's own MCP prefix, and read from wherever each names its ticket.
 */

import { expect, test } from "vitest";

import type { ConversationExchange, ConversationStep } from "../app/core/conversation.ts";
import { conversationExchangeTickets } from "../app/core/conversationTickets.ts";

function exchangeOf(work: readonly ConversationStep[]): ConversationExchange {
  return {
    id: "x1",
    work,
    standing: { standing: "Answered" },
    before: [],
  };
}

function callOf(
  step: Partial<Extract<ConversationStep, { step: "ToolCall" }>>,
): ConversationStep {
  return { step: "ToolCall", id: "call-1", input: undefined, ...step };
}

test("create_draft reads the ticket the result body answers", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__create_draft",
        input: { authoring: {} },
        result: { text: 'HTTP 201\n{"ticket":42,"version":1}', isError: false },
      }),
    ]),
  );
  expect(touches).toStrictEqual([{ ticket: 42, action: "Filed" }]);
});

test("file_dependent is read the same way, and a name carrying no prefix still matches", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "file_dependent",
        result: { text: 'HTTP 201\n{"ticket":43,"version":1}', isError: false },
      }),
    ]),
  );
  expect(touches).toStrictEqual([{ ticket: 43, action: "Filed" }]);
});

test("revise_draft, delete_draft and release_draft read the ticket off their own input", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__revise_draft",
        input: { ticket: 7, expectedVersion: 2 },
        result: { text: "HTTP 200\n{}", isError: false },
      }),
      callOf({
        id: "call-2",
        name: "mcp__chuggy__delete_draft",
        input: { ticket: 9, expectedVersion: 1 },
        result: { text: "HTTP 200\n{}", isError: false },
      }),
      callOf({
        id: "call-3",
        name: "mcp__chuggy__release_draft",
        input: { ticket: 11, authoringVersion: 3 },
        result: {
          text: 'HTTP 202\n{"operation":"o-1","state":"Accepted"}',
          isError: false,
        },
      }),
    ]),
  );
  expect(touches).toStrictEqual([
    { ticket: 7, action: "Revised" },
    { ticket: 9, action: "Deleted" },
    { ticket: 11, action: "Released" },
  ]);
});

test("a call whose result is an error touched no ticket", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__create_draft",
        result: { text: 'HTTP 409\n{"error":"StaleProjectSequence"}', isError: true },
      }),
      callOf({
        id: "call-2",
        name: "mcp__chuggy__release_draft",
        input: { ticket: 11 },
        result: { text: "HTTP 422\n{}", isError: true },
      }),
    ]),
  );
  expect(touches).toStrictEqual([]);
});

test("a call still running, with no result yet, touched no ticket", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__release_draft",
        input: { ticket: 11 },
      }),
    ]),
  );
  expect(touches).toStrictEqual([]);
});

test("a tool outside the roster is not read as a ticket write", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__read_ticket",
        input: { ticket: 41 },
        result: { text: "HTTP 200\n{}", isError: false },
      }),
      callOf({ id: "call-2", name: "Read", input: { path: "a.md" } }),
    ]),
  );
  expect(touches).toStrictEqual([]);
});

test("a result body carrying no ticket, or none this reader can parse, is skipped", () => {
  const touches = conversationExchangeTickets(
    exchangeOf([
      callOf({
        name: "mcp__chuggy__create_draft",
        result: { text: 'HTTP 201\n{"version":1}', isError: false },
      }),
      callOf({
        id: "call-2",
        name: "mcp__chuggy__file_dependent",
        result: { text: "HTTP 201\nnot json", isError: false },
      }),
    ]),
  );
  expect(touches).toStrictEqual([]);
});
