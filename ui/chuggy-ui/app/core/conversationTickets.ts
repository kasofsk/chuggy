/**
 * Which tickets one exchange's work touched, and what was done to each.
 *
 * A ticket-writing tool call whose result is an error touched no ticket. The
 * recorded name carries the runtime's own MCP server prefix, which this tree
 * nowhere states, so a call is recognised by the name's last segment rather
 * than the whole of it. Where the number itself is read differs by tool:
 * `create_draft` and `file_dependent` answer it in the result body,
 * `revise_draft`, `delete_draft` and `release_draft` carry it in the call's
 * own input.
 */

import { chuggyTicketWritingTools } from "../../../../src/contract/rosters.ts";
import type { ChuggyTicketWritingTool } from "../../../../src/contract/rosters.ts";
import type { ConversationExchange, ConversationStep } from "./conversation.ts";

function isChuggyTicketWritingTool(
  value: string,
): value is ChuggyTicketWritingTool {
  return (chuggyTicketWritingTools as readonly string[]).includes(value);
}

function conversationTicketWritingTool(
  name: string | undefined,
): ChuggyTicketWritingTool | undefined {
  const segment = name?.split("__").at(-1);
  return segment !== undefined && isChuggyTicketWritingTool(segment)
    ? segment
    : undefined;
}

function conversationTicketVerb(tool: ChuggyTicketWritingTool): string {
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

function conversationRecordOf(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function conversationTicketNumber(value: unknown): number | undefined {
  const ticket = conversationRecordOf(value)?.["ticket"];
  return typeof ticket === "number" ? ticket : undefined;
}

/** The result's ticket, wherever its body begins: the one place this tree
 * would otherwise have to know that the runtime relays an HTTP status ahead
 * of the answer's JSON, so this reads no further than the first brace. */
function conversationTicketFromResultText(text: string): number | undefined {
  const at = text.indexOf("{");
  if (at < 0) return undefined;
  try {
    return conversationTicketNumber(JSON.parse(text.slice(at)));
  } catch {
    return undefined;
  }
}

function conversationCallTicketNumber(
  tool: ChuggyTicketWritingTool,
  call: Extract<ConversationStep, { step: "ToolCall" }>,
): number | undefined {
  switch (tool) {
    case "create_draft":
    case "file_dependent":
      return call.result === undefined
        ? undefined
        : conversationTicketFromResultText(call.result.text);
    case "revise_draft":
    case "delete_draft":
    case "release_draft":
      return conversationTicketNumber(call.input);
  }
}

/** One ticket a call touched, and what was done to it. */
export interface ConversationExchangeTicket {
  readonly ticket: number;
  readonly verb: string;
}

function conversationCallTicket(
  call: Extract<ConversationStep, { step: "ToolCall" }>,
): ConversationExchangeTicket | undefined {
  if (call.result === undefined || call.result.isError) return undefined;
  const tool = conversationTicketWritingTool(call.name);
  if (tool === undefined) return undefined;
  const ticket = conversationCallTicketNumber(tool, call);
  return ticket === undefined
    ? undefined
    : { ticket, verb: conversationTicketVerb(tool) };
}

/** Which tickets one exchange's work touched and what was done to each, in
 * the order the calls happened. */
export function conversationExchangeTickets(
  exchange: ConversationExchange,
): readonly ConversationExchangeTicket[] {
  const found: ConversationExchangeTicket[] = [];
  for (const step of exchange.work) {
    if (step.step !== "ToolCall") continue;
    const ticket = conversationCallTicket(step);
    if (ticket !== undefined) found.push(ticket);
  }
  return found;
}
