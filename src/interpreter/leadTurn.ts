/**
 * The two documents one lead turn carries — what the runtime observes to the
 * lead, and what the lead answers with — and the parsers that refuse anything
 * else.
 *
 * THE MAILBOX IS TEXT IN BOTH DIRECTIONS AND BOUNDS BOTH OF THEM. A turn's
 * input and result are bounded columns, while the settings bound the input on
 * their own; a decision legal under the settings and too large for the mailbox
 * would be one the runtime builds and the database refuses, so `./selector.ts`
 * names the effective budget and both weigh sites take it.
 *
 * PARSING REFUSES AND NEVER REPAIRS. The pod truncates a long result before it
 * posts it, and a truncated JSON document is exactly the input a lenient parser
 * would half-accept: a document over its bound, of the wrong version, naming a
 * ticket the observation did not carry, fencing on a version it did not show,
 * lifting a refusal that is not standing, entering one ticket in the refusal
 * ledger twice, or dispatching a ticket it also refuses each raise, and
 * `policyFailureCode` already turns those into `InvalidResult`.
 *
 * SUPERSESSION IS COMPUTED HERE RATHER THAN JOINED IN SQL. The selector's
 * tables and the ticket service's are owned by different roles, and a refusal
 * cleared by a new version is a comparison between two things this document
 * already holds.
 */

import { agenticRefusalReasonCharsMax } from "../contract/http.ts";
import {
  agenticRefusalIsSuperseded,
  type AgenticRefusalRecord,
} from "./agenticRefusal.ts";
import {
  dispatchViewPageLimitMax,
  type DispatchCandidate,
  type DispatchViewToken,
} from "./dispatchView.ts";
import {
  notificationPageLimitMax,
  type ProjectNotification,
} from "./notifications.ts";
import type { Partition } from "./projectStore.ts";
import {
  leadDecisionBytesMax,
  leadDispatchesMax,
  leadObservationBytesMax,
  leadRefusalsObservedMax,
  leadRefusalsPerDecisionMax,
  type JsonValue,
  type SelectorObservation,
  type SelectorOperationalContext,
  type SelectorPolicyResult,
  type SelectorProjectState,
} from "./selector.ts";

/** The one document version this tree writes and the only one it accepts. */
export const leadTurnDocumentVersion = 1;

/** One standing refusal as the observation shows it, with what the reader must know about it. */
export interface LeadObservedRefusal {
  readonly ticket: DispatchCandidate["ticket"];
  readonly ticketVersion: number;
  readonly reason: string;
  readonly recordedAt: string;
  /** True where the candidate's current version is not the one refused. */
  readonly superseded: boolean;
}

/** One past decision as a successor needs it: what it did, never what it saw. */
export interface LeadSeedingDecision {
  readonly ordinal: number;
  readonly decision: string;
  readonly completedAt: string;
  readonly dispatched: readonly DispatchCandidate["ticket"][];
  readonly refused: readonly DispatchCandidate["ticket"][];
  readonly attention: SelectorProjectState["attention"];
}

/**
 * What a session with no bound agent reference is told before its first turn,
 * which is the whole of what makes a successor a sufficient tech lead.
 */
export interface LeadSeeding {
  readonly handoffNote: JsonValue;
  readonly decisions: readonly LeadSeedingDecision[];
  readonly refusals: readonly LeadObservedRefusal[];
  readonly notificationCursor: number;
}

export interface LeadObservationDocument {
  readonly version: typeof leadTurnDocumentVersion;
  readonly decision: string;
  readonly partition: Partition;
  /**
   * The composed objectives, the North Star inside the content rather than
   * beside it. Absent where the session carries them as a system prompt
   * instead, which a retained document predates.
   */
  readonly instructions?: {
    readonly revision: string;
    readonly content: string;
  };
  /** Present only on a turn to a session that has bound no agent reference. */
  readonly seeding?: LeadSeeding;
  readonly changes: readonly ProjectNotification[];
  readonly candidates: readonly DispatchCandidate[];
  readonly token: DispatchViewToken;
  readonly operationalContext: SelectorOperationalContext;
  readonly handoffNote: JsonValue;
  readonly refusals: readonly LeadObservedRefusal[];
}

function leadTurnRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function leadTurnBoundedText(
  text: string,
  what: string,
  bytesMax: number,
): string {
  if (new TextEncoder().encode(text).byteLength > bytesMax)
    throw new RangeError(`${what} is larger than its mailbox row holds`);
  return text;
}

function leadTurnDocument(
  text: string,
  what: string,
  bytesMax: number,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(leadTurnBoundedText(text, what, bytesMax));
  const found = leadTurnRecord(parsed, what);
  if (found["version"] !== leadTurnDocumentVersion)
    throw new TypeError(`${what} names a version this tree does not write`);
  return found;
}

function leadObservationArray(
  value: unknown,
  what: string,
  countMax: number,
): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${what} must be an array`);
  if (value.length > countMax)
    throw new RangeError(`${what} carries more than one turn is shown`);
  return value;
}

/**
 * The observation a turn's input text carries, checked to the depth a reader
 * acts on it: the version, the bound, and that every collection this tree
 * writes is present as one.
 */
export function parseLeadObservation(text: string): LeadObservationDocument {
  const found = leadTurnDocument(
    text,
    "lead observation",
    leadObservationBytesMax,
  );
  leadTurnRecord(found["partition"], "lead observation partition");
  if (found["instructions"] !== undefined)
    leadTurnRecord(found["instructions"], "lead observation instructions");
  leadTurnRecord(found["token"], "lead observation token");
  leadTurnRecord(found["operationalContext"], "lead observation context");
  leadObservationArray(
    found["candidates"],
    "lead observation candidates",
    dispatchViewPageLimitMax,
  );
  leadObservationArray(
    found["changes"],
    "lead observation changes",
    notificationPageLimitMax,
  );
  leadObservationArray(
    found["refusals"],
    "lead observation refusals",
    leadRefusalsObservedMax,
  );
  if (typeof found["decision"] !== "string")
    throw new TypeError("lead observation names no decision");
  if (!("handoffNote" in found))
    throw new TypeError("lead observation carries no handoff note");
  return found as unknown as LeadObservationDocument;
}

/** Writes the observation a turn carries, refusing one the mailbox could not hold. */
export function leadObservationText(document: LeadObservationDocument): string {
  return leadTurnBoundedText(
    JSON.stringify(document),
    "lead observation",
    leadObservationBytesMax,
  );
}

/**
 * Every standing refusal as one observation shows it, superseded against the
 * view. The refusals given are the standing among the tickets the page held, so
 * every candidate the observation excluded is one of these.
 */
export function leadObservedRefusals(
  refusals: readonly AgenticRefusalRecord[],
  candidates: readonly DispatchCandidate[],
): readonly LeadObservedRefusal[] {
  return refusals.slice(0, leadRefusalsObservedMax).map((refusal) => {
    const candidate = candidates.find(
      (member) => member.ticket === refusal.ticket,
    );
    return {
      ticket: refusal.ticket,
      ticketVersion: refusal.ticketVersion,
      reason: refusal.reason,
      recordedAt: refusal.recordedAt,
      superseded:
        candidate !== undefined &&
        agenticRefusalIsSuperseded(refusal, candidate.ticketVersion),
    };
  });
}

function leadDecisionTicket(
  value: unknown,
  what: string,
): DispatchCandidate["ticket"] {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new TypeError(`${what} is not a ticket`);
  return value as DispatchCandidate["ticket"];
}

function leadDecisionMembers(
  value: unknown,
  what: string,
  countMax: number,
): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${what} must be an array`);
  if (value.length > countMax)
    throw new RangeError(`${what} names more tickets than one decision may`);
  return value;
}

function leadDecisionCandidate(
  value: unknown,
  what: string,
  observation: SelectorObservation,
): DispatchCandidate {
  const found = leadTurnRecord(value, what);
  const ticket = leadDecisionTicket(found["ticket"], what);
  const candidate = observation.candidates.find(
    (member) => member.ticket === ticket,
  );
  if (candidate === undefined)
    throw new TypeError(`${what} names a ticket outside the observed view`);
  return candidate;
}

function leadDecisionDispatches(
  value: unknown,
  observation: SelectorObservation,
): SelectorPolicyResult["dispatches"] {
  return leadDecisionMembers(value, "lead dispatch", leadDispatchesMax).map(
    (member) => {
      const candidate = leadDecisionCandidate(
        member,
        "lead dispatch",
        observation,
      );
      const version = leadTurnRecord(member, "lead dispatch")[
        "expectedTicketVersion"
      ];
      if (version !== candidate.ticketVersion)
        throw new TypeError(
          "lead dispatch fences on a version the observation did not show",
        );
      return { ticket: candidate.ticket, expectedTicketVersion: version };
    },
  );
}

function leadDecisionRefusals(
  value: unknown,
  observation: SelectorObservation,
): SelectorPolicyResult["refusals"] {
  return leadDecisionMembers(
    value,
    "lead refusal",
    leadRefusalsPerDecisionMax,
  ).map((member) => {
    const candidate = leadDecisionCandidate(
      member,
      "lead refusal",
      observation,
    );
    const found = leadTurnRecord(member, "lead refusal");
    const reason = found["reason"];
    if (
      typeof reason !== "string" ||
      reason.length < 1 ||
      reason.length > agenticRefusalReasonCharsMax
    )
      throw new TypeError("lead refusal reason must be bounded text");
    if (found["ticketVersion"] !== candidate.ticketVersion)
      throw new TypeError(
        "lead refusal names a version the observation did not show",
      );
    return {
      ticket: candidate.ticket,
      ticketVersion: candidate.ticketVersion,
      reason,
    };
  });
}

/**
 * A lift names a refusal the observation showed, which is the standing among the
 * page's own tickets. Nothing excluded from the candidates is outside it.
 */
function leadDecisionLifts(
  value: unknown,
  refusals: readonly AgenticRefusalRecord[],
): SelectorPolicyResult["lifts"] {
  return leadDecisionMembers(
    value,
    "lead lift",
    leadRefusalsPerDecisionMax,
  ).map((member) => {
    const ticket = leadDecisionTicket(
      leadTurnRecord(member, "lead lift")["ticket"],
      "lead lift",
    );
    if (!refusals.some((refusal) => refusal.ticket === ticket))
      throw new TypeError("lead lift names a ticket with no standing refusal");
    return { ticket };
  });
}

/**
 * Refuses a decision that names one ticket twice. The ledger holds one row per
 * decision per ticket, so a repeated entry is a decision the database cannot
 * commit; a repeated dispatch is two `Dispatch` events at their own prefixes,
 * the second refused by enablement for a ticket the first left Working — a
 * refusal the lead did not earn.
 */
function leadDecisionNamesEachTicketOnce(
  result: SelectorPolicyResult,
): SelectorPolicyResult {
  const entered = [
    ...result.refusals.map((refusal) => refusal.ticket),
    ...result.lifts.map((lift) => lift.ticket),
  ];
  if (new Set(entered).size !== entered.length)
    throw new TypeError("lead decision enters one ticket in its ledger twice");
  const dispatched = result.dispatches.map((dispatch) => dispatch.ticket);
  if (new Set(dispatched).size !== dispatched.length)
    throw new TypeError("lead decision dispatches one ticket twice");
  for (const dispatch of result.dispatches)
    if (result.refusals.some((refusal) => refusal.ticket === dispatch.ticket))
      throw new TypeError("lead decision dispatches a ticket it also refuses");
  return result;
}

/**
 * The decision a turn's result text carries, checked against the view it was
 * taken on. Everything it names must be in that view, which is what stops a
 * decision built on a page the lead was never shown.
 */
export function parseLeadDecision(
  text: string,
  observation: SelectorObservation,
): SelectorPolicyResult {
  const found = leadTurnDocument(text, "lead decision", leadDecisionBytesMax);
  const attention = found["attention"];
  if (
    attention !== "Monitoring" &&
    attention !== "Attention" &&
    attention !== "Stopped"
  )
    throw new TypeError("lead decision names no attention this tree knows");
  if (!("handoffNote" in found))
    throw new TypeError("lead decision carries no handoff note");
  return leadDecisionNamesEachTicketOnce({
    dispatches: leadDecisionDispatches(found["dispatches"], observation),
    refusals: leadDecisionRefusals(found["refusals"], observation),
    lifts: leadDecisionLifts(found["lifts"], observation.refusals),
    attention,
    handoffNote: found["handoffNote"] as JsonValue,
    ...(found["planningIntent"] === undefined
      ? {}
      : { planningIntent: found["planningIntent"] as JsonValue }),
  });
}
