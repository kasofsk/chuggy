/**
 * Which tickets one exchange's work touched, and what was done to each.
 *
 * The tools that write a ticket are `chuggyTicketWriteTools`; the recorded
 * call carries the runtime's own MCP server prefix, which this tree nowhere
 * states, so a call is matched by its name's last segment rather than the
 * whole of it. A call whose result is an error, or has none yet, touched no
 * ticket.
 */

import {
  chuggyTicketWriteTools,
  type ChuggyTicketWriteTool,
} from "../../../../src/contract/rosters.ts";
import type { ConversationExchange, ConversationStep } from "./conversation.ts";

export const conversationTicketActions = [
  "Filed",
  "Revised",
  "Deleted",
  "Released",
] as const;
export type ConversationTicketAction = (typeof conversationTicketActions)[number];

export interface ConversationTicketTouch {
  readonly ticket: number;
  readonly action: ConversationTicketAction;
}

function conversationRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function conversationToolOf(
  name: string | undefined,
): ChuggyTicketWriteTool | undefined {
  if (name === undefined) return undefined;
  const last = name.split("__").at(-1);
  return chuggyTicketWriteTools.find((tool) => tool === last);
}

function conversationToolAction(
  tool: ChuggyTicketWriteTool,
): ConversationTicketAction {
  switch (tool) {
    case "create_draft":
    case "file_dependent":
      return "Filed";
    case "revise_draft":
      return "Revised";
    case "delete_draft":
      return "Deleted";
    case "release_draft":
      return "Released";
  }
}

/** The ticket number `revise_draft`, `delete_draft` and `release_draft` name
 * in the call's own input, rather than in what came back. */
function conversationInputTicket(input: unknown): number | undefined {
  const ticket = conversationRecord(input)?.["ticket"];
  return typeof ticket === "number" ? ticket : undefined;
}

/** The ticket number `create_draft` and `file_dependent` answer in the result
 * body, relayed as one status line and the body verbatim on the line after. */
function conversationResultTicket(text: string): number | undefined {
  const at = text.indexOf("\n");
  if (at < 0) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text.slice(at + 1));
  } catch {
    return undefined;
  }
  const ticket = conversationRecord(body)?.["ticket"];
  return typeof ticket === "number" ? ticket : undefined;
}

function conversationStepTicket(
  tool: ChuggyTicketWriteTool,
  step: Extract<ConversationStep, { step: "ToolCall" }>,
): number | undefined {
  const result = step.result;
  if (result === undefined || result.isError) return undefined;
  switch (tool) {
    case "create_draft":
    case "file_dependent":
      return conversationResultTicket(result.text);
    case "revise_draft":
    case "delete_draft":
    case "release_draft":
      return conversationInputTicket(step.input);
  }
}

export function conversationExchangeTickets(
  exchange: ConversationExchange,
): readonly ConversationTicketTouch[] {
  const touches: ConversationTicketTouch[] = [];
  for (const step of exchange.work) {
    if (step.step !== "ToolCall") continue;
    const tool = conversationToolOf(step.name);
    if (tool === undefined) continue;
    const ticket = conversationStepTicket(tool, step);
    if (ticket === undefined) continue;
    touches.push({ ticket, action: conversationToolAction(tool) });
  }
  return touches;
}
