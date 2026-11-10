/**
 * An epic's members as its Tickets tab draws them: grouped by where each
 * stands, each group in the order the work will happen, each member with what
 * unfinished it comes after and how many members wait on it.
 *
 * Where a member stands is the ticket list's own word for its row; a member
 * with no row is read off the graph, and one the graph gives no phase is a
 * draft. What it comes after is its row's unfinished dependencies where it has
 * a row, and the graph's otherwise, so the line and the word beside it agree.
 */

import type { EpicWriteRequest } from "../../../../src/contract/epics.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicViewResponse,
} from "../../../../src/contract/responses.ts";
import { consoleWriteKey } from "./consoleWrite.ts";
import {
  epicFormFrom,
  epicGraphStandingOf,
  epicWrite,
  epicWriteFrom,
} from "./epics.ts";
import { ticketListAskDefault } from "./projectTableFilters.ts";
import type { ProjectTableRow } from "./projectTableRows.ts";
import { rosterSearchMatches } from "./rosterSearch.ts";
import type { TicketStateStanding } from "./ticketHeader.ts";
import { ticketListStandingOf } from "./ticketListView.ts";
import { ticketRowsQuery } from "./ticketQueries.ts";

/** The ticket list's rows under the epic's filter, which every member that
 * was released has one of. */
export function epicMembersQuery(partition: PartitionIdentity, epic: number) {
  return ticketRowsQuery(partition, { ...ticketListAskDefault, epic });
}

/** The write that adds tickets to an epic or takes one out: an epic's write
 * under a key of its own, which leaves the members' rows stale as well as the
 * epic's reads. */
export function epicTicketsWrite(
  partition: PartitionIdentity,
): ReturnType<typeof epicWrite> {
  const write = epicWrite(partition);
  return {
    ...write,
    mutationKey: consoleWriteKey(
      "epic-tickets",
      partition.tenant,
      partition.project,
    ),
    landed: async (client, value, variables) => {
      await write.landed?.(client, value, variables);
      await client.invalidateQueries({
        queryKey: epicMembersQuery(partition, value.epic).queryKey,
        exact: true,
      });
    },
  };
}

/** The groups, in the order the tab draws them. */
export const epicTicketsGroups = [
  "Escalated",
  "Running",
  "Ready",
  "Blocked",
  "Draft",
  "Done",
  "Revoked",
] as const;

export type EpicTicketsGroup = (typeof epicTicketsGroups)[number];

/** The group a state is drawn in: Running is every phase that moves on its own. */
export function epicTicketsGroupOf(
  standing: TicketStateStanding,
): EpicTicketsGroup {
  switch (standing) {
    case "Work":
    case "Evaluation":
    case "Finalization":
      return "Running";
    case "Escalated":
    case "Ready":
    case "Blocked":
    case "Draft":
    case "Done":
    case "Revoked":
      return standing;
  }
}

type EpicGraphEdge = EpicGraphResponse["edges"][number];

/** Each member's depth in the epic's graph: none where it waits on no member,
 * and otherwise one more than the deepest member it waits on. Relaxed once per
 * member at most, which settles any graph without a cycle and stops on one. */
export function epicWorkDepths(
  members: readonly number[],
  edges: readonly EpicGraphEdge[],
): ReadonlyMap<number, number> {
  const depths = new Map(members.map((member) => [member, 0]));
  const inner = edges.filter(
    (edge) => depths.has(edge.from) && depths.has(edge.to),
  );
  for (let pass = 0; pass < members.length; pass += 1) {
    let moved = false;
    for (const edge of inner) {
      const deeper = (depths.get(edge.from) ?? 0) + 1;
      if (deeper > (depths.get(edge.to) ?? 0)) {
        depths.set(edge.to, deeper);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return depths;
}

/** The members in the order the work will happen: each after everything it
 * waits on, by its depth, then by number. */
export function epicWorkOrdered(
  members: readonly number[],
  edges: readonly EpicGraphEdge[],
): readonly number[] {
  const depths = epicWorkDepths(members, edges);
  return [...new Set(members)].sort(
    (left, right) =>
      (depths.get(left) ?? 0) - (depths.get(right) ?? 0) || left - right,
  );
}

/** A member as its row is drawn. */
export interface EpicTicketsMember {
  readonly ticket: number;
  readonly title: string | undefined;
  readonly standing: TicketStateStanding;
  /** The row the ticket list holds of it, none for a draft or one not read. */
  readonly row: ProjectTableRow | undefined;
  /** Its unfinished dependencies, in the epic or out of it, ascending. */
  readonly after: readonly number[];
  /** How many members wait on it, none said for one that is Done. */
  readonly blocks: number | undefined;
}

function epicTicketsAfter(
  ticket: number,
  row: ProjectTableRow | undefined,
  graph: EpicGraphResponse | undefined,
): readonly number[] {
  if (row !== undefined)
    return [
      ...row.openDependencies.map((dependency) => dependency.ticket),
      ...row.revokedDependencies,
    ].sort((left, right) => left - right);
  if (graph === undefined) return [];
  const done = new Set(
    graph.nodes
      .filter((node) => node.phase === "Done")
      .map((node) => node.ticket),
  );
  return graph.edges
    .filter((edge) => edge.to === ticket && !done.has(edge.from))
    .map((edge) => edge.from)
    .sort((left, right) => left - right);
}

function epicTicketsStanding(
  ticket: number,
  row: ProjectTableRow | undefined,
  graph: EpicGraphResponse | undefined,
): TicketStateStanding {
  if (row !== undefined) return ticketListStandingOf(row);
  const node = graph?.nodes.find((held) => held.ticket === ticket);
  if (graph === undefined || node === undefined) return "Draft";
  return epicGraphStandingOf(node, graph) ?? "Draft";
}

/** Each member of the epic, as its row is drawn, in the order the work will
 * happen. */
export function epicTicketsMembersOf(
  members: readonly number[],
  rows: ReadonlyMap<number, ProjectTableRow>,
  graph: EpicGraphResponse | undefined,
): readonly EpicTicketsMember[] {
  const edges = graph?.edges ?? [];
  const memberSet = new Set(members);
  return epicWorkOrdered(members, edges).map((ticket) => {
    const row = rows.get(ticket);
    const standing = epicTicketsStanding(ticket, row, graph);
    const waiting = new Set(
      edges
        .filter((edge) => edge.from === ticket && memberSet.has(edge.to))
        .map((edge) => edge.to),
    );
    return {
      ticket,
      title:
        row?.title ??
        graph?.nodes.find((node) => node.ticket === ticket)?.title,
      standing,
      row,
      after: epicTicketsAfter(ticket, row, graph),
      blocks: standing === "Done" ? undefined : waiting.size,
    };
  });
}

/** Whether a member answers what the reader typed, by its number or its title. */
export function epicTicketsMatches(
  member: EpicTicketsMember,
  typed: string,
): boolean {
  return rosterSearchMatches(
    typed,
    `#${String(member.ticket)} ${member.title ?? ""}`,
  );
}

export interface EpicTicketsGrouped {
  readonly group: EpicTicketsGroup;
  readonly members: readonly EpicTicketsMember[];
}

/** The groups holding a member that answers what was typed, in the tab's
 * order, each member in the order it was handed. */
export function epicTicketsGrouped(
  members: readonly EpicTicketsMember[],
  typed: string,
): readonly EpicTicketsGrouped[] {
  const kept = members.filter((member) => epicTicketsMatches(member, typed));
  return epicTicketsGroups.flatMap((group) => {
    const held = kept.filter(
      (member) => epicTicketsGroupOf(member.standing) === group,
    );
    return held.length === 0 ? [] : [{ group, members: held }];
  });
}

/** The revision that adds tickets to the epic, at the revision read. */
export function epicTicketsAdded(
  view: EpicViewResponse,
  tickets: readonly number[],
): EpicWriteRequest | undefined {
  return epicTicketsRevised(view, [...view.tickets, ...tickets]);
}

/** The revision that takes a ticket out of the epic, at the revision read. */
export function epicTicketsRemoved(
  view: EpicViewResponse,
  ticket: number,
): EpicWriteRequest | undefined {
  return epicTicketsRevised(
    view,
    view.tickets.filter((member) => member !== ticket),
  );
}

function epicTicketsRevised(
  view: EpicViewResponse,
  tickets: readonly number[],
): EpicWriteRequest | undefined {
  return epicWriteFrom(
    { ...epicFormFrom(view), tickets: tickets.join(", ") },
    { epic: view.number, revision: view.revision },
  );
}
