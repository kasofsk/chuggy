/**
 * The inbox: every ticket a person is needed for, one entry each, read whole.
 *
 * Four things put a ticket here — a phase of `inboxPhases`, an open native
 * action, a standing refusal of the lead's and a decision held for approval —
 * and the store answers the union of them in the tickets list's
 * `RecentActivity` order. The refusals and the held decisions are read first,
 * each to the bound its own route answers, and the store is handed the tickets
 * they name; the phases and the open actions it reads itself.
 *
 * A REFUSAL ITS TICKET HAS MOVED PAST NEEDS NOBODY: the ticket was revoked,
 * dispatched, or changed and is the lead's to weigh again. The read that
 * answers refusals here leaves those out.
 *
 * A READER WHO MAY NOT DISPATCH IS SHOWN NO HELD DECISION, as the proposals
 * route answers them, so a ticket only a decision names is neither in that
 * reader's entries nor in their count.
 */

import {
  agenticRefusalsAnsweredMax,
  inboxPhases,
  selectorProposalDispatchesAnsweredMax,
} from "../contract/http.ts";
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
  type TicketActivityPosition,
  type TicketResource,
} from "./nativeWeb.ts";
import type { OperationalReadStore } from "./operationsView.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type {
  SelectorProposalHeld,
  SelectorProposalReviews,
} from "./selectorReview.ts";

/** What the store is asked for: the phases and the tickets beside them that make the union, and the page. */
export interface InboxReadQuery {
  readonly phases: readonly Phase[];
  /** The tickets a refusal or a held decision names, which the store has no read of. */
  readonly named: readonly TicketId[];
  readonly after?: TicketActivityPosition;
  readonly limit: number;
}

/** One page of the union as the store reads it, its tickets in order and their open actions beside them. */
export interface InboxReadPage {
  /** Every ticket of the union, before any cursor. */
  readonly count: number;
  readonly tickets: readonly TicketResource[];
  readonly actions: readonly ProjectNativeAction[];
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
  readonly proposals: readonly SelectorProposalHeld[];
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
  ): Promise<AuthorizedResult<ProjectInboxPage>>;
}

export interface ProjectInboxPorts {
  readonly store: InboxReadStore;
  readonly operationalReads: Pick<
    OperationalReadStore,
    "ticketLatestExecutions"
  >;
  readonly refusals: AgenticRefusalBindingRead;
  readonly proposals: SelectorProposalReviews;
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

/** The held decisions this reader is shown, which are none where they may not dispatch. */
async function projectInboxProposals(
  proposals: SelectorProposalReviews,
  principal: Principal,
  partition: Partition,
): Promise<readonly SelectorProposalHeld[]> {
  const held = await proposals.pending(
    principal,
    partition,
    selectorProposalDispatchesAnsweredMax,
  );
  return held.result === "Found" ? held.proposals : [];
}

/** The tickets the refusals and the decisions name, each once. */
function projectInboxNamed(
  refusals: readonly AgenticRefusalStanding[],
  proposals: readonly SelectorProposalHeld[],
): readonly TicketId[] {
  return [
    ...new Set([
      ...refusals.map((refusal) => refusal.ticket),
      ...proposals.flatMap((proposal) => proposal.tickets),
    ]),
  ];
}

/** The page's tickets in its order, each with what the other reads say of it. */
function projectInboxEntries(
  tickets: readonly TicketResource[],
  page: InboxReadPage,
  refusals: readonly AgenticRefusalStanding[],
  proposals: readonly SelectorProposalHeld[],
): readonly ProjectInboxEntry[] {
  return tickets.map((ticket) => ({
    ticket,
    actions: page.actions.filter((action) => action.ticket === ticket.ticket),
    refusals: refusals.filter((refusal) => refusal.ticket === ticket.ticket),
    proposals: proposals.filter((proposal) =>
      proposal.tickets.includes(ticket.ticket),
    ),
  }));
}

/** Read access is the tickets list's; the held decisions ask for dispatch on top of it. */
export function projectInbox(
  access: ProjectAccess,
  ports: ProjectInboxPorts,
): ProjectInbox {
  return {
    read: async (principal, partition, query) => {
      const asked = checkedProjectInboxQuery(query);
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const refusals = await ports.refusals.binding(
        partition,
        agenticRefusalsAnsweredMax,
      );
      const proposals = await projectInboxProposals(
        ports.proposals,
        principal,
        partition,
      );
      const page = await ports.store.inbox(partition, {
        phases: inboxPhases,
        named: projectInboxNamed(refusals, proposals),
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
      return {
        result: "Authorized",
        value: {
          entries: projectInboxEntries(tickets, page, refusals, proposals),
          count: page.count,
          ...(page.nextAfter === undefined
            ? {}
            : { nextAfter: page.nextAfter }),
        },
      };
    },
  };
}
