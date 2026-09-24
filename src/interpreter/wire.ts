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
 *
 * NOTHING IS LIFTED HERE. Every stored row this seam can reach was written by
 * this image — the store's reader refuses a row declaring any other decision
 * semantics, and the deployment that collapsed the desk walls wiped its
 * journal rather than carry a lift for rows nobody wanted — so bytes that do
 * not decode are corrupt rather than old, and they are refused.
 */

import { isDeepStrictEqual } from "node:util";

import {
  decodeEntry,
  decodeTicketCommand,
  decodeTicketRefusal,
  encodeEntry as encodeEntryValue,
  encodeTicketCommand,
  encodeTicketRefusal,
} from "../generated/model-api.ts";
import {
  finalizationResultTags,
  ticketRefusalTags,
  type Entry,
} from "../domain/generated/modelTypes.ts";
import {
  allNativeActionResolutions,
  asOperationTicketCommand,
  completionCommandTypes,
  isCompletionTicketCommand,
  type FinalizationSubmission,
  type ProjectCommand,
  type SchedulerCompletion,
  type StoredProjectCommand,
} from "./projectCommand.ts";
import {
  allBoundaryRefusalCodes,
  boundaryRefusal,
  isTicketRefusal,
  type Refusal,
} from "./refusal.ts";
import { checkedSelectorDecisionReference } from "./dispatchView.ts";
import { finalizationUnavailableKinds } from "../contract/rosters.ts";
import { dispatchViewSchemaVersion } from "../contract/http.ts";
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

/**
 * Reads one wire row into an `Entry`, refusing anything the model does not
 * describe. A row a store holds is read the same way: every one this image can
 * reach was written by it, so there is nothing to lift on the way in.
 */
export function parseEntry(raw: unknown): Parsed<Entry> {
  try {
    return { parsed: "Ok", value: decodeEntry(raw) };
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/**
 * The refusal a refused input keeps beside its code, in the codec's spelling:
 * the machine's own refusal, and nothing for a code the boundary decided,
 * which carries no more than its name. A store keeps it as text and the
 * operation resource as the value.
 */
export function encodeRefusalValue(refusal: Refusal): unknown {
  return isTicketRefusal(refusal) ? encodeTicketRefusal(refusal) : undefined;
}

export function encodeRefusalText(refusal: Refusal): string | null {
  return isTicketRefusal(refusal)
    ? JSON.stringify(encodeTicketRefusal(refusal))
    : null;
}

/**
 * Reads a code and the refusal beside it back, refusing a pair that
 * disagrees: a boundary code with a refusal beside it, or a machine refusal
 * whose tag is not its code.
 */
export function parseRefusalValue(
  code: string,
  value: unknown,
): Parsed<Refusal> {
  const boundary = allBoundaryRefusalCodes.find((known) => known === code);
  if (boundary !== undefined)
    return value === undefined
      ? { parsed: "Ok", value: boundaryRefusal(boundary) }
      : { parsed: "Refused", why: `${code} carries no refusal` };
  if (!ticketRefusalTags.some((known) => known === code))
    return { parsed: "Refused", why: `${code} is not a refusal code` };
  if (value === undefined)
    return { parsed: "Refused", why: `${code} has no refusal beside it` };
  try {
    const refusal = decodeTicketRefusal(value);
    return refusal.type === code
      ? { parsed: "Ok", value: refusal }
      : { parsed: "Refused", why: `a ${refusal.type} is named ${code}` };
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

export function parseStoredRefusal(
  code: string,
  text: string | null,
): Parsed<Refusal> {
  if (text === null) return parseRefusalValue(code, undefined);
  try {
    return parseRefusalValue(code, JSON.parse(text));
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

export function encodeProjectCommand(command: ProjectCommand): string {
  if (command.command === "Decide") {
    return JSON.stringify({
      version: 1,
      command: "Decide",
      ticketCommand: encodeTicketCommand(command.ticketCommand),
    });
  }
  return JSON.stringify(command);
}

function parsedDispatchCommand(
  record: Record<string, unknown>,
): ProjectCommand | undefined {
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
  return record as ProjectCommand;
}

export function parseProjectCommand(text: string): Parsed<ProjectCommand> {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) {
      throw new TypeError("command is not an object");
    }
    const record = raw as Record<string, unknown>;
    if (record["version"] !== 1)
      throw new TypeError("command version is not 1");
    if (record["command"] === "Decide") {
      return {
        parsed: "Ok",
        value: {
          version: 1,
          command: "Decide",
          ticketCommand: asOperationTicketCommand(
            decodeTicketCommand(record["ticketCommand"]),
          ),
        },
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
      return { parsed: "Ok", value: record as ProjectCommand };
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
      return { parsed: "Ok", value: record as ProjectCommand };
    }
    throw new TypeError("command tag or fields are invalid");
  } catch (error: unknown) {
    return { parsed: "Refused", why: parseRefusal(error) };
  }
}

/**
 * Reads the fields of the finalizer's envelope, refusing one whose fences are
 * not whole. The hold kind is held to the outcome it explains, as the mailbox
 * holds it: the escalation this submission parks a ticket at records the kind
 * as its evidence, and an envelope naming one for any other outcome names it
 * for an escalation that will not happen.
 */
function checkedFinalizationSubmission(
  record: Record<string, unknown>,
): FinalizationSubmission {
  const generation = record["requestGeneration"];
  const outcome = record["outcome"];
  const kind = record["kind"];
  if (
    record["version"] !== 1 ||
    typeof record["request"] !== "string" ||
    record["request"].length === 0 ||
    (record["attempt"] !== undefined &&
      (typeof record["attempt"] !== "string" ||
        record["attempt"].length === 0)) ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    typeof record["recoveryEpoch"] !== "string" ||
    record["recoveryEpoch"].length === 0 ||
    !finalizationResultTags.some((tag) => tag === outcome) ||
    (kind !== undefined) !== (outcome === "FinalizationResultUnavailable") ||
    (kind !== undefined &&
      !finalizationUnavailableKinds.some((known) => known === kind))
  ) {
    throw new TypeError("finalization submission fields are invalid");
  }
  return { ...record, outcome } as unknown as FinalizationSubmission;
}

/**
 * Whether a stored envelope claims to be the scheduler's completion, read off
 * the undecoded command so an ordinary one is not decoded twice on the way to
 * the parser that owns it.
 */
function claimsCompletion(
  record: Record<string, unknown> | undefined,
): boolean {
  const command = record?.["ticketCommand"];
  if (record?.["command"] !== "Decide" || typeof command !== "object")
    return false;
  const type = (command as Record<string, unknown> | null)?.["type"];
  return completionCommandTypes.some((known) => known === type);
}

/** The fields `submit_task_completion` writes into its envelope, and the only ones. */
const storedCompletionFields = ["version", "command", "ticketCommand"] as const;

/** Whether a record carries a field its writer does not write. */
function carriesUnwrittenField(
  record: Record<string, unknown>,
  written: readonly string[],
): boolean {
  return Object.keys(record).some(
    (field) => !written.some((known) => known === field),
  );
}

/**
 * The scheduler boundary's stored envelope, refused by the ingress parser by
 * design and read here. The report goes through the model's own decoder, so
 * what a completion may say about a task and its report is the generated
 * codec's answer and not a second one, and a field the boundary does not
 * write is refused rather than ignored: the decoder drops one, so a command
 * that does not encode back to the bytes it was read from carried one.
 */
function storedSchedulerCompletion(
  record: Record<string, unknown>,
): SchedulerCompletion {
  if (record["version"] !== 1)
    throw new TypeError("stored completion version is not 1");
  const inner = record["ticketCommand"];
  if (
    typeof inner !== "object" ||
    inner === null ||
    carriesUnwrittenField(record, storedCompletionFields)
  )
    throw new TypeError(
      "stored completion carries a field its boundary does not write",
    );
  const ticketCommand = decodeTicketCommand(inner);
  if (!isDeepStrictEqual(encodeTicketCommand(ticketCommand), inner))
    throw new TypeError(
      "stored completion carries a field its boundary does not write",
    );
  if (!isCompletionTicketCommand(ticketCommand))
    throw new TypeError("stored completion carries no task report");
  return { version: 1, command: "Decide", ticketCommand };
}

/**
 * Reads one stored command, which is either a public envelope or one a boundary
 * wrote. Only a writer reading its inbox calls this; ingress parses the public
 * set alone, which is why the two boundary envelopes are readable here and
 * unspellable there.
 */
export function parseStoredProjectCommand(
  text: string,
): Parsed<StoredProjectCommand> {
  let record: Record<string, unknown> | undefined;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === "object" && raw !== null) {
      record = raw as Record<string, unknown>;
    }
    if (record?.["command"] === "SubmitFinalizationResult") {
      return { parsed: "Ok", value: checkedFinalizationSubmission(record) };
    }
    if (record !== undefined && claimsCompletion(record)) {
      return { parsed: "Ok", value: storedSchedulerCompletion(record) };
    }
    return parseProjectCommand(text);
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
