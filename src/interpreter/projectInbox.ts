/**
 * The inbox: every ticket a person is needed for, one entry each, read whole.
 *
 * Three things put a ticket here — a phase of `inboxPhases`, an open native
 * action and a standing refusal of the lead's — and the store answers the
 * union of them in the tickets list's `RecentActivity` order. The refusals are
 * read first, to the bound their own route answers, and the store is handed
 * the tickets they name; the phases and the open actions it reads itself.
 *
 * A REFUSAL ITS TICKET HAS MOVED PAST NEEDS NOBODY: the ticket was revoked,
 * dispatched, or changed and is the lead's to weigh again. The read that
 * answers refusals here leaves those out.
 */

import { agenticRefusalsAnsweredMax, inboxPhases } from "../contract/http.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Phase } from "../domain/phase.ts";
import type {
  AgenticRefusalBindingRead,
  AgenticRefusalStanding,
} from "./agenticRefusal.ts";
import type { AuthorizedResult } from "./authorizedProject.ts";
import {
  projectPageLimitMax,
  ticketsWithLatestExecutions,
  type ProjectNativeAction,
  type ProjectNativeActionAsked,
  type TicketActivityPosition,
  type TicketResource,
} from "./nativeWeb.ts";
import type { OperationalReadStore } from "./operationsView.ts";
import type { SessionId } from "./agentSession.ts";
import {
  nativeActionCallerOf,
  nativeActionsAnswerable,
} from "./nativeActionAnswer.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** What the store is asked for: the phases and the tickets beside them that make the union, and the page. */
export interface InboxReadQuery {
  readonly phases: readonly Phase[];
  /** The tickets a refusal names, which the store has no read of. */
  readonly named: readonly TicketId[];
  readonly after?: TicketActivityPosition;
  readonly limit: number;
}

/** One page of the union as the store reads it, its tickets in order and their open actions beside them. */
export interface InboxReadPage {
  /** Every ticket of the union, before any cursor. */
  readonly count: number;
  readonly tickets: readonly TicketResource[];
  readonly actions: readonly ProjectNativeActionAsked[];
  readonly nextAfter?: TicketActivityPosition;
}

export interface InboxReadStore {
  inbox(partition: Partition, query: InboxReadQuery): Promise<InboxReadPage>;
}

export interface ProjectInboxQuery {
  readonly after?: TicketActivityPosition;
  readonly limit: number;
}

export interface ProjectInboxEntry {
  readonly ticket: TicketResource;
  readonly actions: readonly ProjectNativeAction[];
  readonly refusals: readonly AgenticRefusalStanding[];
}

export interface ProjectInboxPage {
  readonly entries: readonly ProjectInboxEntry[];
  readonly count: number;
  readonly nextAfter?: TicketActivityPosition;
}

export interface ProjectInbox {
  read(
    principal: Principal,
    partition: Partition,
    query: ProjectInboxQuery,
    viaSession?: SessionId,
  ): Promise<AuthorizedResult<ProjectInboxPage>>;
}

export interface ProjectInboxPorts {
  readonly store: InboxReadStore;
  readonly operationalReads: Pick<
    OperationalReadStore,
    "ticketLatestExecutions"
  >;
  readonly refusals: AgenticRefusalBindingRead;
}

function checkedProjectInboxQuery(query: ProjectInboxQuery): ProjectInboxQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > projectPageLimitMax
  )
    throw new RangeError(
      `inbox page limit must be between 1 and ${String(projectPageLimitMax)}`,
    );
  if (
    query.after !== undefined &&
    (!Number.isSafeInteger(query.after.sequence) || query.after.sequence < 0)
  )
    throw new RangeError("inbox cursor sequence is invalid");
  return query;
}

/** The tickets the refusals name, each once. */
function projectInboxNamed(
  refusals: readonly AgenticRefusalStanding[],
): readonly TicketId[] {
  return [...new Set(refusals.map((refusal) => refusal.ticket))];
}

/** The page's tickets in its order, each with what the other reads say of it. */
function projectInboxEntries(
  tickets: readonly TicketResource[],
  page: { readonly actions: readonly ProjectNativeAction[] },
  refusals: readonly AgenticRefusalStanding[],
): readonly ProjectInboxEntry[] {
  return tickets.map((ticket) => ({
    ticket,
    actions: page.actions.filter((action) => action.ticket === ticket.ticket),
    refusals: refusals.filter((refusal) => refusal.ticket === ticket.ticket),
  }));
}

/** Read access is the tickets list's. */
export function projectInbox(
  access: ProjectAccess,
  ports: ProjectInboxPorts,
): ProjectInbox {
  return {
    read: async (principal, partition, query, viaSession) => {
      const asked = checkedProjectInboxQuery(query);
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const refusals = await ports.refusals.binding(
        partition,
        agenticRefusalsAnsweredMax,
      );
      const page = await ports.store.inbox(partition, {
        phases: inboxPhases,
        named: projectInboxNamed(refusals),
        ...(asked.after === undefined ? {} : { after: asked.after }),
        limit: asked.limit,
      });
      if (
        page.tickets.length > asked.limit ||
        new Set(page.tickets.map((ticket) => ticket.ticket)).size !==
          page.tickets.length
      )
        throw new Error("inbox: a page holds a ticket twice or past its limit");
      const tickets = await ticketsWithLatestExecutions(
        ports.operationalReads,
        partition,
        page.tickets,
        principal,
      );
      const actions = await nativeActionsAnswerable(
        access,
        nativeActionCallerOf(principal, viaSession),
        partition,
        page.actions,
      );
      return {
        result: "Authorized",
        value: {
          entries: projectInboxEntries(tickets, { actions }, refusals),
          count: page.count,
          ...(page.nextAfter === undefined
            ? {}
            : { nextAfter: page.nextAfter }),
        },
      };
    },
  };
}
