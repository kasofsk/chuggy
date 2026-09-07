/**
 * Which tickets one exchange's work touched: read from the result body for
 * the two tools that answer it there, from the call's own input for the
 * three that carry it as an argument, never from a call that errored or from
 * a tool this roster does not name.
 */

import { expect, test } from "vitest";

import { conversationExchangeTickets } from "../app/core/conversationTickets.ts";
import type {
  ConversationExchange,
  ConversationStep,
} from "../app/core/conversation.ts";

function exchangeOf(work: readonly ConversationStep[]): ConversationExchange {
  return { id: "x1", work, standing: { standing: "Answered" }, before: [] };
}

function callOf(
  step: Partial<ConversationStep & { readonly step: "ToolCall" }>,
): ConversationStep {
  return {
    step: "ToolCall",
    id: "call-1",
    input: undefined,
    ...step,
  };
}

test("create_draft reads the ticket out of the result body", () => {
  const exchange = exchangeOf([
    callOf({
      name: "mcp__chuggy__create_draft",
      input: { configurationRevision: "rev-1" },
      result: {
        text: 'HTTP 201\n{"partition":{"tenant":"acme","project":"atlas"},"ticket":42,"authoringVersion":1}',
        isError: false,
      },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([
    { ticket: 42, verb: "Filed" },
  ]);
});

test("file_dependent reads the ticket out of the result body", () => {
  const exchange = exchangeOf([
    callOf({
      name: "mcp__chuggy__file_dependent",
      input: { parent: 7 },
      result: {
        text: 'HTTP 201\n{"ticket":43}',
        isError: false,
      },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([
    { ticket: 43, verb: "Filed" },
  ]);
});

test("revise_draft, delete_draft and release_draft read the ticket out of the call's own input", () => {
  const exchange = exchangeOf([
    callOf({
      name: "mcp__chuggy__revise_draft",
      input: { ticket: 11, expectedVersion: 2 },
      result: { text: "HTTP 200\n{}", isError: false },
    }),
    callOf({
      id: "call-2",
      name: "mcp__chuggy__delete_draft",
      input: { ticket: 12, expectedVersion: 1 },
      result: { text: "HTTP 200\n{}", isError: false },
    }),
    callOf({
      id: "call-3",
      name: "mcp__chuggy__release_draft",
      input: { ticket: 13, authoringVersion: 1 },
      result: { text: 'HTTP 202\n{"operation":"op-1"}', isError: false },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([
    { ticket: 11, verb: "Revised" },
    { ticket: 12, verb: "Deleted" },
    { ticket: 13, verb: "Released" },
  ]);
});

test("a call whose result is an error touched no ticket", () => {
  const exchange = exchangeOf([
    callOf({
      name: "mcp__chuggy__create_draft",
      input: {},
      result: { text: "HTTP 409\nconflict", isError: true },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([]);
});

test("a tool the roster does not name is not read for a ticket, whatever it carries", () => {
  const exchange = exchangeOf([
    callOf({
      name: "mcp__chuggy__read_ticket",
      input: { ticket: 5 },
      result: { text: 'HTTP 200\n{"ticket":5}', isError: false },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([]);
});

test("a call with no result touched no ticket", () => {
  const exchange = exchangeOf([
    callOf({ name: "mcp__chuggy__create_draft", input: {} }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([]);
});

test("the recorded name is matched by its last segment, prefix or none", () => {
  const exchange = exchangeOf([
    callOf({
      name: "create_draft",
      input: {},
      result: { text: '{"ticket":9}', isError: false },
    }),
  ]);
  expect(conversationExchangeTickets(exchange)).toEqual([
    { ticket: 9, verb: "Filed" },
  ]);
});
