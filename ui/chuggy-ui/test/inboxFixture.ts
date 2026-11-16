/**
 * The inbox's one read as a suite answers it: an entry is a ticket's row and
 * whatever of an open action and a refusal the case names on it, and a page is those entries with the count the server says it holds.
 */

import type {
  AgenticRefusalResponse,
  InboxEntryResponse,
  InboxResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import { answer } from "./screenHarness.tsx";

/** What a case puts on one ticket besides its row. */
export interface InboxEntryNamed {
  readonly actions?: readonly ProjectNativeActionResponse[];
  readonly refusals?: readonly AgenticRefusalResponse[];
}

export function inboxEntry(
  ticket: ProjectTicket,
  named: InboxEntryNamed = {},
): InboxEntryResponse {
  return {
    ticket,
    actions: [...(named.actions ?? [])],
    refusals: [...(named.refusals ?? [])],
  };
}

/** One standing refusal of ticket 42, as an entry carries it. */
export function inboxRefusal(): AgenticRefusalResponse {
  return {
    ticket: 42,
    ticketVersion: 2,
    reason: "the brief names no reference",
    decision: "selector-decision-1",
    recordedAt: "2026-09-01T09:01:00Z",
    superseded: false,
  };
}

/** One page holding `entries`, counting them unless the case says the server holds more. */
export function inboxBody(
  entries: readonly InboxEntryResponse[],
  more?: { readonly count: number; readonly nextCursor: string },
): InboxResponse {
  return {
    entries: [...entries],
    count: more?.count ?? entries.length,
    more: more !== undefined,
    ...(more === undefined ? {} : { nextCursor: more.nextCursor }),
  };
}

/** Whether a request is the inbox's read. */
export function inboxAsked(url: string): boolean {
  return /\/inbox(\?|$)/u.test(url);
}

/** The inbox's read answered with `entries`, and `undefined` for any other address. */
export function inboxAnswered(
  url: string,
  entries: readonly InboxEntryResponse[],
): Response | undefined {
  return inboxAsked(url) ? answer(inboxBody(entries)) : undefined;
}
