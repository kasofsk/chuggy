/**
 * The decision log: what each selector decision did, read under the project's
 * own access.
 *
 * A RECORD IS SUMMARISED RATHER THAN SENT. A retained interaction carries the
 * instructions it ran under and the whole page of candidates it observed, and
 * either of those alone can outweigh a page of decisions. What the log draws is
 * what the decision did, and the observation it did it on is the lead's own
 * transcript.
 *
 * THE RESULT IS RETAINED JSON AND IS READ DEFENSIVELY, so a field this reader
 * cannot speak for is absent rather than fatal and a row nobody can parse still
 * leaves the decisions beside it readable.
 *
 * WHAT LANDED IS NOT WHAT WAS CHOSEN. The dispatches a decision made are its
 * delivery rows, one per ticket, carrying the state each reached and the
 * outcome each settled on; the chosen list is derivable from them, so the log
 * draws the rows and never a stored duplicate of what they already say.
 */

import { selectorHistoryLimitMax } from "../contract/http.ts";
import {
  selectorAttentions,
  selectorHistoryOrders,
  type SelectorAttention,
  type SelectorDeliveryState,
  type SelectorHistoryOrder,
} from "../contract/rosters.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { JsonValue, SelectorInteractionRecord } from "./selector.ts";

/** One dispatch of one decision, as the delivery record settled it. */
export interface SelectorDispatchOutcome {
  readonly ticket: number;
  readonly state: SelectorDeliveryState;
  /** The refusal code or acceptance the operation settled on, where it settled. */
  readonly outcome?: string;
}

/** What one decision did, which is what the log draws and not what it saw. */
export interface SelectorDecisionSummary {
  readonly ordinal: number;
  readonly decision: string;
  readonly instructionsVersion: string;
  readonly dispatches: readonly SelectorDispatchOutcome[];
  readonly refused: readonly number[];
  readonly lifted: readonly number[];
  readonly attention?: SelectorAttention;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly tokens?: number;
  readonly costMicros?: number;
  readonly durationMs?: number;
  readonly startedAt: string;
  readonly completedAt: string;
}

/**
 * One page of the log. `nextAfter` is present on a full page read forward, which
 * is where a further one may stand; a reader that follows it to an empty page
 * has reached the end, and the newest page carries none because it is one page.
 */
export type SelectorHistoryRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly decisions: readonly SelectorDecisionSummary[];
      readonly nextAfter?: number;
    };

/**
 * One page of the log: forward from a cursor, or the newest decisions. A cursor
 * with `newest` is refused rather than ignored, because the newest page is one
 * page and a cursor into it would name a position no further page continues from.
 */
export interface SelectorHistoryQuery {
  readonly after?: number;
  readonly limit: number;
  readonly order: SelectorHistoryOrder;
}

export interface SelectorHistory {
  read(
    principal: Principal,
    partition: Partition,
    query: SelectorHistoryQuery,
  ): Promise<SelectorHistoryRead>;
}

export function checkedSelectorHistoryQuery(
  query: SelectorHistoryQuery,
): SelectorHistoryQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > selectorHistoryLimitMax
  )
    throw new RangeError(
      `selector history limit must be between 1 and ${String(selectorHistoryLimitMax)}`,
    );
  if (!selectorHistoryOrders.includes(query.order))
    throw new RangeError("selector history order is not a known order");
  if (
    query.after !== undefined &&
    (!Number.isSafeInteger(query.after) || query.after < 0)
  )
    throw new RangeError("selector history cursor is invalid");
  if (query.after !== undefined && query.order === "newest")
    throw new RangeError(
      "the newest decisions are one page and take no cursor",
    );
  return query;
}

/**
 * The one read the log needs, which is why the API holds no more of the selector
 * role's store than this. It is its own port rather than a narrowing of that
 * store: the log is read from either end and the store's own reader only ever
 * walks forward.
 */
export interface SelectorHistoryStore {
  history(
    partition: Partition,
    query: SelectorHistoryQuery,
  ): Promise<readonly SelectorInteractionRecord[]>;
}

function fieldOf(
  value: JsonValue | undefined,
  name: string,
): JsonValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return (value as Record<string, JsonValue>)[name];
}

function countOf(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function ticketOf(value: JsonValue | undefined): number | undefined {
  const ticket = countOf(value);
  return ticket === undefined || ticket < 1 ? undefined : ticket;
}

/** The tickets one arm of a decision names, dropping any entry this reader cannot speak for. */
function ticketsOf(
  result: JsonValue | undefined,
  arm: string,
): readonly number[] {
  const found = fieldOf(result, arm);
  const named: readonly JsonValue[] = Array.isArray(found) ? found : [];
  return named.flatMap((entry) => {
    const ticket = ticketOf(fieldOf(entry, "ticket"));
    return ticket === undefined ? [] : [ticket];
  });
}

/**
 * The code a settled operation named, or the state it settled in. A delivery
 * that has not settled carries no outcome, and one whose retained outcome this
 * reader cannot speak for carries none either.
 */
function outcomeCode(outcome: JsonValue | undefined): string | undefined {
  const code = fieldOf(outcome, "code");
  if (typeof code === "string") return code;
  for (const name of ["state", "accepted"]) {
    const named = fieldOf(outcome, name);
    if (typeof named === "string") return named;
  }
  return undefined;
}

/** What each of a decision's dispatches did, in the order the relation keys them. */
function dispatchOutcomes(
  deliveries: SelectorInteractionRecord["deliveries"],
): readonly SelectorDispatchOutcome[] {
  return deliveries.map((delivery) => {
    const outcome = outcomeCode(delivery.outcome);
    return {
      ticket: Number(delivery.ticket),
      state: delivery.state,
      ...(outcome === undefined ? {} : { outcome }),
    };
  });
}

function attentionOf(
  result: JsonValue | undefined,
): SelectorAttention | undefined {
  const named = fieldOf(result, "attention");
  return selectorAttentions.find((attention) => attention === named);
}

/** One retained interaction as the log draws it. */
export function selectorDecisionSummary(
  record: SelectorInteractionRecord,
): SelectorDecisionSummary {
  const tokens = countOf(fieldOf(record.accounting, "tokens"));
  const costMicros = countOf(fieldOf(record.accounting, "costMicros"));
  const durationMs = countOf(fieldOf(record.accounting, "durationMs"));
  const attention = attentionOf(record.result);
  return {
    ordinal: record.ordinal,
    decision: record.decision,
    instructionsVersion: record.instructionsVersion,
    dispatches: dispatchOutcomes(record.deliveries),
    refused: ticketsOf(record.result, "refusals"),
    lifted: ticketsOf(record.result, "lifts"),
    ...(attention === undefined ? {} : { attention }),
    modelRevision: record.modelRevision,
    policyRevision: record.policyRevision,
    ...(tokens === undefined ? {} : { tokens }),
    ...(costMicros === undefined ? {} : { costMicros }),
    ...(durationMs === undefined ? {} : { durationMs }),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

/** Exposes semantic selector provenance only through current project read access. */
export function selectorHistory(
  access: ProjectAccess,
  store: SelectorHistoryStore,
): SelectorHistory {
  return {
    read: async (principal, partition, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const asked = checkedSelectorHistoryQuery(query);
      const decisions = (await store.history(partition, asked)).map(
        selectorDecisionSummary,
      );
      const last = decisions.at(-1);
      return {
        result: "Found",
        decisions,
        ...(asked.order === "newest" ||
        decisions.length < asked.limit ||
        last === undefined
          ? {}
          : { nextAfter: last.ordinal }),
      };
    },
  };
}
