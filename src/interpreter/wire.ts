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
import {
  finalizationOutcomeTags,
  type DecisionEvent,
  type Entry,
} from "../domain/generated/modelTypes.ts";
import {
  allNativeActionResolutions,
  type FinalizationSubmission,
  type StoredTicketCommand,
  type TicketCommand,
} from "./ticketCommand.ts";
import {
  checkedSelectorDecisionReference,
  dispatchViewSchemaVersion,
} from "./dispatchView.ts";
import { asTicketId } from "../domain/ids.ts";

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

function parsedDispatchCommand(
  record: Record<string, unknown>,
): TicketCommand | undefined {
  const ticket = record["ticket"];
  const expectedTicketVersion = record["expectedTicketVersion"];
  if (
    typeof ticket !== "number" ||
    !Number.isSafeInteger(ticket) ||
    ticket < 1 ||
    typeof expectedTicketVersion !== "number" ||
    !Number.isSafeInteger(expectedTicketVersion) ||
    expectedTicketVersion < 1
  )
    return undefined;
  if (record["command"] === "ManualDispatch")
    return {
      version: 1,
      command: "ManualDispatch",
      ticket: asTicketId(ticket),
      expectedTicketVersion,
    };
  if (record["command"] !== "ProposeDispatch") return undefined;
  const token = record["observedViewToken"];
  const reference = record["selectorDecisionReference"];
  if (
    typeof token !== "object" ||
    token === null ||
    typeof reference !== "string"
  )
    throw new TypeError(
      "proposal token or selector decision reference is invalid",
    );
  const view = token as Record<string, unknown>;
  if (
    typeof view["tenant"] !== "string" ||
    view["tenant"].length === 0 ||
    typeof view["project"] !== "string" ||
    view["project"].length === 0 ||
    typeof view["recoveryEpoch"] !== "string" ||
    view["recoveryEpoch"].length === 0 ||
    view["schemaVersion"] !== dispatchViewSchemaVersion ||
    typeof view["watermark"] !== "number" ||
    !Number.isSafeInteger(view["watermark"]) ||
    view["watermark"] < 0 ||
    typeof view["digest"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(view["digest"])
  )
    throw new TypeError("proposal view token is invalid");
  checkedSelectorDecisionReference(reference);
  return record as TicketCommand;
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
      if (
        event.type === "WorkReduce" ||
        event.type === "EvalReduce" ||
        event.type === "ReleaseTicket" ||
        event.type === "FinalizationResult"
      ) {
        throw new TypeError("event is not a public decision command");
      }
      return {
        parsed: "Ok",
        value: { version: 1, command: "Decide", event },
      };
    }
    const dispatch = parsedDispatchCommand(record);
    if (dispatch !== undefined) return { parsed: "Ok", value: dispatch };
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
      allNativeActionResolutions.some(
        (resolution) => resolution === record["resolution"],
      )
    ) {
      return { parsed: "Ok", value: record as TicketCommand };
    }
    throw new TypeError("command tag or fields are invalid");
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/** Reads the fields of the finalizer's envelope, refusing one whose fences are not whole. */
function checkedFinalizationSubmission(
  record: Record<string, unknown>,
): FinalizationSubmission {
  const generation = record["requestGeneration"];
  const outcome = record["outcome"];
  if (
    record["version"] !== 1 ||
    typeof record["request"] !== "string" ||
    record["request"].length === 0 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    typeof record["recoveryEpoch"] !== "string" ||
    record["recoveryEpoch"].length === 0 ||
    !finalizationOutcomeTags.some((tag) => tag === outcome)
  ) {
    throw new TypeError("finalization submission fields are invalid");
  }
  return record as unknown as FinalizationSubmission;
}

/**
 * Reads one stored command, which is either a public envelope or the finalizer
 * boundary's own. Only a writer reading its inbox calls this; ingress parses the
 * public set alone.
 */
export function parseStoredTicketCommand(
  text: string,
): Parsed<StoredTicketCommand> {
  let record: Record<string, unknown> | undefined;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === "object" && raw !== null) {
      record = raw as Record<string, unknown>;
    }
    if (record?.["command"] !== "SubmitFinalizationResult") {
      return parseTicketCommand(text);
    }
    return { parsed: "Ok", value: checkedFinalizationSubmission(record) };
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
