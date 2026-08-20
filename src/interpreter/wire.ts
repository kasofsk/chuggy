/**
 * The wire: how one journal entry is written to a store and read back.
 *
 * THE SCHEMA IS NOT WRITTEN HERE. The model's own types compile to a schema
 * and a codec pair, and this module uses them — so a constructor added to the
 * model reaches the wire without anyone editing this file, and cannot reach
 * the wire in a shape the model does not have. A hand-written schema beside a
 * generated one is two statements of the same thing, and the hand-written one
 * is the one that goes stale.
 *
 * WHAT THIS MODULE STILL OWNS is the JSON seam either side of that codec: the
 * text a store keeps, and the refusal a bad row earns. A refusal is returned
 * rather than thrown, because a caller that must handle it is a caller the
 * compiler can insist on.
 */

import {
  decodeDecisionEvent,
  decodeEntry,
  encodeDecisionEvent,
  encodeEntry as encodeEntryValue,
} from "../generated/model-api.ts";
import type { DecisionEvent, Entry } from "../domain/generated/modelTypes.ts";
import type { TicketCommand } from "./ticketCommand.ts";

/** Writes one `Entry` as the text a store keeps. */
export function encodeEntry(entry: Entry): string {
  return JSON.stringify(encodeEntryValue(entry));
}

/** What a parse answers: the value, or the reason it was refused. */
export type Parsed<Value> =
  | { readonly parsed: "Ok"; readonly value: Value }
  | { readonly parsed: "Refused"; readonly why: string };

/** Renders the codec's complaint as one line, so the library's own error type stops at this module. */
function parseRefusal(error: unknown): string {
  if (error instanceof Error) return error.message.replaceAll("\n", " ");
  return String(error);
}

/** Reads one wire row into an `Entry`, refusing anything the model does not describe. */
export function parseEntry(raw: unknown): Parsed<Entry> {
  try {
    return { parsed: "Ok", value: decodeEntry(raw) };
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/** Writes one decision event as the text a command carries. */
export function encodeDecisionEventText(event: DecisionEvent): string {
  return JSON.stringify(encodeDecisionEvent(event));
}

/**
 * Reads the text of one decision event, refusing anything the model does not
 * describe. The JSON layer is inside the refusal because a command is a
 * client's bytes, and unreadable bytes are an answer rather than a crash.
 */
export function parseDecisionEventText(text: string): Parsed<DecisionEvent> {
  try {
    return { parsed: "Ok", value: decodeDecisionEvent(JSON.parse(text)) };
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

export function encodeTicketCommand(command: TicketCommand): string {
  if (command.command === "Decide") {
    return JSON.stringify({
      version: 1,
      command: "Decide",
      event: encodeDecisionEvent(command.event),
    });
  }
  return JSON.stringify(command);
}

export function parseTicketCommand(text: string): Parsed<TicketCommand> {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) {
      throw new TypeError("command is not an object");
    }
    const record = raw as Record<string, unknown>;
    if (record["version"] !== 1)
      throw new TypeError("command version is not 1");
    if (record["command"] === "Decide") {
      const event = decodeDecisionEvent(record["event"]);
      if (event.type === "WorkReduce" || event.type === "EvalReduce") {
        throw new TypeError("reducers are internal continuation commands");
      }
      return {
        parsed: "Ok",
        value: { version: 1, command: "Decide", event },
      };
    }
    if (
      record["command"] === "ReleaseDraft" &&
      typeof record["ticket"] === "number" &&
      Number.isSafeInteger(record["ticket"]) &&
      record["ticket"] >= 1 &&
      typeof record["authoringVersion"] === "number" &&
      Number.isSafeInteger(record["authoringVersion"]) &&
      record["authoringVersion"] >= 1 &&
      typeof record["configurationRevision"] === "string" &&
      record["configurationRevision"].length > 0
    ) {
      return { parsed: "Ok", value: record as TicketCommand };
    }
    if (
      record["command"] === "ResolveNativeAction" &&
      typeof record["action"] === "string" &&
      record["action"].length > 0 &&
      typeof record["authorizingSeq"] === "number" &&
      Number.isSafeInteger(record["authorizingSeq"]) &&
      record["authorizingSeq"] >= 1 &&
      (record["resolution"] === "Resume" || record["resolution"] === "Revoke")
    ) {
      return { parsed: "Ok", value: record as TicketCommand };
    }
    throw new TypeError("command tag or fields are invalid");
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/** Reads a whole stored journal, refusing the lot when any row is not one this machine writes. */
export function parseJournal(raw: unknown): Parsed<readonly Entry[]> {
  if (!Array.isArray(raw)) {
    return { parsed: "Refused", why: "$: a journal is an array of entries" };
  }
  const entries: Entry[] = [];
  for (const [index, row] of raw.entries()) {
    const parsed = parseEntry(row);
    if (parsed.parsed === "Refused") {
      return { parsed: "Refused", why: `${String(index)}: ${parsed.why}` };
    }
    entries.push(parsed.value);
  }
  return { parsed: "Ok", value: entries };
}
