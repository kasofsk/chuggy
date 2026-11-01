/**
 * A ticket's reads: the ticket and its draft, which their frames carry whole,
 * the parts under it no frame names, and the lists a ticket's frames stale or
 * fold into — its dispatch view, its landings, and the project's rows.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketLandingsResponse } from "../../../../src/contract/responses.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiDraft,
  apiInbox,
  apiProject,
  apiTicket,
  apiTicketActionReach,
  apiTicketDispatchView,
  apiTicketLandings,
  apiTicketNativeActions,
} from "./apiRoutes.ts";
import { inboxList, inboxPage, inboxRowsRead } from "./inboxList.ts";
import { inboxProposalsPolledMs } from "./inboxProposals.ts";
import { consoleListQuery, consoleProjectQuery } from "./consoleQuery.ts";
import type { ConsoleQueryKept } from "./consoleQuery.ts";
import { projectListRereadNamed } from "./projectQueryKeys.ts";
import {
  ticketFilterList,
  ticketFilterPage,
  ticketFilterReadsCount,
} from "./projectTableFilters.ts";
import type { TicketListAsk } from "./projectTableFilters.ts";
import { projectTicketRowsRead } from "./projectTicketPages.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";
import { ticketDispatchList } from "./ticketActions.ts";
import {
  ticketDeliveryPolledMs,
  ticketDeliveryResource,
} from "./ticketDelivery.ts";
import {
  ticketLandingsListName,
  ticketLandingsPolledMs,
} from "./ticketLandings.ts";

export function ticketQuery(
  partition: PartitionIdentity,
  ticket: number,
  kept: ConsoleQueryKept = "Read",
) {
  return consoleProjectQuery(
    partition,
    "Ticket",
    String(ticket),
    (ports) => apiTicket(ports, partition, ticket),
    undefined,
    kept,
  );
}

export function draftQuery(
  partition: PartitionIdentity,
  ticket: number,
  kept: ConsoleQueryKept = "Read",
) {
  return consoleProjectQuery(
    partition,
    "Draft",
    String(ticket),
    (ports) => apiDraft(ports, partition, ticket),
    undefined,
    kept,
  );
}

/** Which native actions are open on the ticket, which the actions panel's own
 * submissions invalidate. */
export function ticketNativeActionsQuery(
  partition: PartitionIdentity,
  ticket: number,
) {
  return consoleProjectQuery(
    partition,
    "NativeAction",
    String(ticket),
    (ports) => apiTicketNativeActions(ports, partition, ticket),
  );
}

/** Where the ticket's work is delivered, polled since no frame names it. */
export function ticketDeliveryQuery(
  partition: PartitionIdentity,
  ticket: number,
) {
  return consoleProjectQuery(
    partition,
    "Ticket",
    ticketDeliveryResource(ticket),
    (ports) => apiTicketActionReach(ports, partition, ticket),
    ticketDeliveryPolledMs,
  );
}

export function ticketDispatchQuery(
  partition: PartitionIdentity,
  ticket: number,
) {
  return consoleListQuery(ticketDispatchList(partition, ticket), (ports) =>
    apiTicketDispatchView(ports, partition, ticket),
  );
}

/** The ticket's landings, staled by a frame naming the ticket and polled for
 * what the forge moves where no frame says so. */
export function ticketLandingsQuery(
  partition: PartitionIdentity,
  ticket: number,
) {
  return consoleListQuery(
    projectListRereadNamed<TicketLandingsResponse>(
      partition,
      "Ticket",
      ticketLandingsListName(ticket),
      (change) => change.resource === String(ticket),
    ),
    (ports) => apiTicketLandings(ports, partition, ticket),
    ticketLandingsPolledMs,
  );
}

/** The read the ticket rows run, which takes how many pages to gather from
 * the entry it is about to replace: the whole of what makes a refetch keep a
 * reader's pages. */
function ticketRowsRead(
  held: ProjectTicketRows | undefined,
  ports: ApiPorts,
  partition: PartitionIdentity,
  ask: TicketListAsk,
): Promise<ApiResult<ProjectTicketRows>> {
  return projectTicketRowsRead(
    held,
    (cursor, read) =>
      apiProject(ports, partition, ticketFilterPage(ask, { read, cursor })),
    ticketFilterReadsCount(ask),
  );
}

/** The project's rows for one filter, order and search. */
export function ticketRowsQuery(
  partition: PartitionIdentity,
  ask: TicketListAsk,
) {
  return consoleListQuery(
    ticketFilterList(partition, ask),
    (ports, _signal, held) => ticketRowsRead(held, ports, partition, ask),
  );
}

/** The inbox, read under its one key and polled for the held decisions no
 * frame names, gathering as many pages as the entry it replaces had. */
export function inboxQuery(partition: PartitionIdentity) {
  return consoleListQuery(
    inboxList(partition),
    (ports, _signal, held) =>
      inboxRowsRead(held, (cursor) =>
        apiInbox(ports, partition, inboxPage(cursor)),
      ),
    inboxProposalsPolledMs,
  );
}
