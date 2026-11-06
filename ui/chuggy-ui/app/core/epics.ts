/**
 * A project's epics as the console reads and writes them: the reads, the words
 * a status is drawn in, the layout of an epic's graph, and the form an epic is
 * edited through.
 *
 * Progress and status are the API's, derived from the members' phases; nothing
 * here recomputes them. What is decided here is how they are said and where the
 * graph's nodes stand.
 */

import type { QueryClient } from "@tanstack/query-core";

import {
  ticketSearchCharsMax,
  type PartitionIdentity,
} from "../../../../src/contract/http.ts";
import type {
  EpicGraphResponse,
  EpicListResponse,
  EpicSummaryResponse,
  EpicViewResponse,
} from "../../../../src/contract/responses.ts";
import {
  epicSummaryCharsMax,
  epicTitleCharsMax,
  type EpicWriteRequest,
} from "../../../../src/contract/epics.ts";
import {
  apiEpic,
  apiEpicGraph,
  apiEpicHistory,
  apiEpics,
  apiWriteEpic,
} from "./apiRoutes.ts";
import type { EpicsPage } from "./apiRoutes.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { consolePartitionQuery } from "./consoleQuery.ts";
import type { ConsoleWrite } from "./consoleWrite.ts";
import { consoleWriteKey } from "./consoleWrite.ts";
import { phaseLabel } from "./codeLabels.ts";
import { epicStatusTone, type Tone } from "./tones.ts";

export type EpicStatusWord = EpicSummaryResponse["status"];

/** How many epics a page of the list asks for. */
export const epicsPageSize = 20;

/** How many epics the creation form's picker reads. */
export const epicPickerMax = 50;

const epicResourcePrefix = "epic";

/** The list under its filters and the cursor it resumes from. */
export function epicsQuery(partition: PartitionIdentity, page: EpicsPage) {
  const named = JSON.stringify([
    page.search ?? "",
    page.visibility ?? "",
    page.ticket ?? "",
    page.sort ?? "",
    page.after ?? "",
    page.limit ?? "",
  ]);
  return consolePartitionQuery<EpicListResponse>(
    partition,
    `${epicResourcePrefix}s-${named}`,
    (ports) => apiEpics(ports, partition, page),
  );
}

export function epicQuery(partition: PartitionIdentity, epic: number) {
  return consolePartitionQuery<EpicViewResponse>(
    partition,
    `${epicResourcePrefix}-${String(epic)}`,
    (ports) => apiEpic(ports, partition, epic),
  );
}

export function epicHistoryQuery(
  partition: PartitionIdentity,
  epic: number,
  after: number | undefined,
) {
  return consolePartitionQuery(
    partition,
    `${epicResourcePrefix}-${String(epic)}-history-${String(after ?? 0)}`,
    (ports) =>
      apiEpicHistory(ports, partition, epic, { after, limit: epicsPageSize }),
  );
}

export function epicGraphQuery(partition: PartitionIdentity, epic: number) {
  return consolePartitionQuery<EpicGraphResponse>(
    partition,
    `${epicResourcePrefix}-${String(epic)}-graph`,
    (ports) => apiEpicGraph(ports, partition, epic),
  );
}

/** Every epic read of a project read again, which any write to an epic leaves stale. */
export async function epicsInvalidated(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  await client.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        key[1] === partition.tenant &&
        key[2] === partition.project &&
        typeof key[4] === "string" &&
        key[4].startsWith(epicResourcePrefix)
      );
    },
  });
}

const epicStatusWords: Readonly<Record<EpicStatusWord, string>> = {
  empty: "Empty",
  not_started: "Not started",
  in_progress: "In progress",
  attention: "Needs attention",
  done: "Done",
};

/** The word and the hue a status is drawn in. */
export function epicStatusLook(status: EpicStatusWord): {
  readonly word: string;
  readonly tone: Tone;
} {
  return { word: epicStatusWords[status], tone: epicStatusTone(status) };
}

/** What an epic's progress says, as `done of total`, or that it holds nothing. */
export function epicProgressLine(
  progress: EpicSummaryResponse["progress"],
): string {
  return progress.total === 0
    ? "no tickets"
    : `${String(progress.done)} of ${String(progress.total)} done`;
}

export const epicVisibilityChoices = [
  { value: "Active", text: "Active" },
  { value: "Archived", text: "Archived" },
  { value: "All", text: "All" },
] as const;

export const epicSortChoices = [
  { value: "newest", text: "Newest" },
  { value: "oldest", text: "Oldest" },
  { value: "title", text: "Title" },
] as const;

export type EpicVisibilityChoice =
  (typeof epicVisibilityChoices)[number]["value"];
export type EpicSort = (typeof epicSortChoices)[number]["value"];

/** What of the list the page's address holds. */
export interface EpicsQuery {
  readonly q?: string;
  readonly visibility?: EpicVisibilityChoice;
  readonly sort?: EpicSort;
}

/** How long a search stands before it is asked of the API. */
export const epicsSearchWaitMs = 250;

/** The view an address names, its search cut to the server's bound; a value
 * it does not understand is none. */
export function epicsQueryOf(
  search: Readonly<Record<string, unknown>>,
): EpicsQuery {
  const typed = search["q"];
  const q =
    typeof typed === "string" || typeof typed === "number"
      ? [...String(typed).trim()].slice(0, ticketSearchCharsMax).join("").trim()
      : "";
  const visibility = epicVisibilityChoices.find(
    (choice) => choice.value === search["visibility"],
  )?.value;
  const sort = epicSortChoices.find(
    (choice) => choice.value === search["sort"],
  )?.value;
  return {
    ...(q === "" ? {} : { q }),
    ...(visibility === undefined || visibility === "Active"
      ? {}
      : { visibility }),
    ...(sort === undefined || sort === "newest" ? {} : { sort }),
  };
}

/** The address with one of its parts replaced, the defaults written as none. */
export function epicsQueryWith(
  query: EpicsQuery,
  change: Partial<Record<keyof EpicsQuery, string | undefined>>,
): EpicsQuery {
  return epicsQueryOf({ ...query, ...change });
}

/** What the list asks of the API under an address. */
export function epicsAskOf(query: EpicsQuery): EpicsPage {
  return {
    search: query.q,
    visibility: query.visibility ?? "Active",
    sort: query.sort ?? "newest",
    limit: epicsPageSize,
  };
}

/** One node of the graph as it is placed, its phase absent for a draft. */
export interface EpicGraphPlaced {
  readonly ticket: number;
  readonly title: string | undefined;
  readonly phase: EpicGraphResponse["nodes"][number]["phase"];
  readonly member: boolean;
  /** What the node says, cut to fit its box. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface EpicGraphLayout {
  readonly nodes: readonly EpicGraphPlaced[];
  readonly edges: readonly {
    readonly from: EpicGraphPlaced;
    readonly to: EpicGraphPlaced;
  }[];
  readonly width: number;
  readonly height: number;
}

export const epicGraphColumnWidth = 200;
export const epicGraphRowHeight = 48;
export const epicGraphNodeWidth = 160;
export const epicGraphNodeHeight = 32;

/** The most code points a node's label holds before it is cut, which its box fits. */
export const epicGraphLabelCharsMax = 22;

/** Where a node stands in words: its phase, or a draft where it has none. */
export function epicGraphStanding(node: {
  readonly phase?: EpicGraphPlaced["phase"];
}): string {
  return node.phase === undefined ? "Draft" : phaseLabel(node.phase);
}

/** What a node says: its number and its title, or where it stands where it
 * has none, cut with an ellipsis past what its box holds. */
export function epicGraphLabel(
  ticket: number,
  title: string | undefined,
  standing: string,
): string {
  const whole = [...`#${String(ticket)} ${title ?? standing}`];
  return whole.length <= epicGraphLabelCharsMax
    ? whole.join("")
    : `${whole.slice(0, epicGraphLabelCharsMax - 1).join("")}…`;
}

/**
 * The column of each node: one past the deepest of its dependencies, found by
 * taking each node once its dependencies are placed, so every pass is bounded
 * by the nodes and edges given. A node on a cycle is never freed that way and
 * stands in the first column.
 */
function epicGraphLayoutColumns(
  tickets: readonly number[],
  edges: readonly { readonly from: number; readonly to: number }[],
): ReadonlyMap<number, number> {
  const waiting = new Map(tickets.map((ticket) => [ticket, 0]));
  const outgoing = new Map<number, number[]>();
  for (const edge of edges) {
    waiting.set(edge.to, (waiting.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const column = new Map(tickets.map((ticket) => [ticket, 0]));
  const freed = tickets.filter((ticket) => waiting.get(ticket) === 0);
  for (let next = 0; next < freed.length; next += 1) {
    const ticket = freed[next];
    if (ticket === undefined) break;
    const at = column.get(ticket) ?? 0;
    for (const to of outgoing.get(ticket) ?? []) {
      column.set(to, Math.max(column.get(to) ?? 0, at + 1));
      const left = (waiting.get(to) ?? 0) - 1;
      waiting.set(to, left);
      if (left === 0) freed.push(to);
    }
  }
  for (const ticket of tickets)
    if ((waiting.get(ticket) ?? 0) > 0) column.set(ticket, 0);
  return column;
}

/**
 * Each node in the column of its longest chain of dependencies, so every edge
 * runs left to right, and in a row of its own within the column, by ticket
 * number. An edge into a node the graph does not hold, or one on a cycle, is
 * left undrawn rather than looped on.
 */
export function epicGraphLayout(graph: EpicGraphResponse): EpicGraphLayout {
  const tickets = [...new Set(graph.nodes.map((node) => node.ticket))].sort(
    (left, right) => left - right,
  );
  const held = new Set(tickets);
  const edges = graph.edges.filter(
    (edge) => held.has(edge.from) && held.has(edge.to) && edge.from !== edge.to,
  );
  const columns = epicGraphLayoutColumns(tickets, edges);
  const columnOf = (ticket: number) => columns.get(ticket) ?? 0;
  const ordered = [...graph.nodes].sort(
    (left, right) =>
      columnOf(left.ticket) - columnOf(right.ticket) ||
      left.ticket - right.ticket,
  );
  const rows = new Map<number, number>();
  const placed = ordered.map((node): EpicGraphPlaced => {
    const column = columnOf(node.ticket);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      ticket: node.ticket,
      title: node.title,
      phase: node.phase,
      member: node.member,
      label: epicGraphLabel(node.ticket, node.title, epicGraphStanding(node)),
      x: column * epicGraphColumnWidth,
      y: row * epicGraphRowHeight,
    };
  });
  const byTicket = new Map(placed.map((node) => [node.ticket, node]));
  const drawn = edges.flatMap((edge) => {
    const from = byTicket.get(edge.from);
    const to = byTicket.get(edge.to);
    return from === undefined || to === undefined || from.x >= to.x
      ? []
      : [{ from, to }];
  });
  return {
    nodes: placed,
    edges: drawn,
    width: Math.max(0, ...placed.map((node) => node.x)) + epicGraphNodeWidth,
    height:
      Math.max(0, ...rows.values()) * epicGraphRowHeight || epicGraphRowHeight,
  };
}

/** What the edit form holds: the content as the reader types it. */
export interface EpicForm {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly visibility: "Active" | "Archived";
  /** Ticket numbers, as typed, separated by commas or spaces. */
  readonly tickets: string;
}

export const epicFormEmpty: EpicForm = {
  title: "",
  summary: "",
  description: "",
  visibility: "Active",
  tickets: "",
};

export function epicFormFrom(view: EpicViewResponse): EpicForm {
  return {
    title: view.title,
    summary: view.summary ?? "",
    description: view.description,
    visibility: view.visibility,
    tickets: view.tickets.join(", "),
  };
}

/** The ticket numbers a text names, or the words that are not one. */
export function epicTicketsParsed(
  text: string,
):
  | { readonly parsed: "Tickets"; readonly tickets: readonly number[] }
  | { readonly parsed: "Refused"; readonly words: readonly string[] } {
  const words = text
    .split(/[\s,]+/u)
    .map((word) => word.replace(/^#/u, ""))
    .filter((word) => word !== "");
  const bad = words.filter((word) => !/^[1-9][0-9]{0,14}$/u.test(word));
  if (bad.length > 0) return { parsed: "Refused", words: bad };
  return { parsed: "Tickets", tickets: words.map(Number) };
}

/** The faults a form has before it is sent, none where it may be. */
export function epicFormFaults(form: EpicForm): readonly string[] {
  const faults: string[] = [];
  if (form.title.trim() === "") faults.push("The title is empty.");
  if ([...form.title].length > epicTitleCharsMax)
    faults.push("The title is too long.");
  if ([...form.summary].length > epicSummaryCharsMax)
    faults.push("The summary is too long.");
  const tickets = epicTicketsParsed(form.tickets);
  if (tickets.parsed === "Refused")
    faults.push(`Not ticket numbers: ${tickets.words.join(", ")}.`);
  return faults;
}

/** The request a form is sent as, a creation or a revision at the revision read. */
export function epicWriteFrom(
  form: EpicForm,
  held: { readonly epic: number; readonly revision: number } | undefined,
): EpicWriteRequest | undefined {
  const tickets = epicTicketsParsed(form.tickets);
  if (tickets.parsed === "Refused") return undefined;
  const content = {
    title: form.title,
    ...(form.summary.trim() === "" ? {} : { summary: form.summary }),
    description: form.description,
    visibility: form.visibility,
    tickets: [...new Set(tickets.tickets)].sort((a, b) => a - b),
  };
  return held === undefined
    ? { kind: "Create", content }
    : {
        kind: "Revise",
        epic: held.epic,
        expected: held.revision,
        content,
      };
}

const epicRefusalWords: Readonly<Record<string, string>> = {
  StaleRevision:
    "The epic was changed since you opened it. Reload it and make the change again.",
  ArchivedEpic: "An archived epic's tickets do not change.",
  EmptyTitle: "The title is empty.",
  LongTitle: "The title is too long.",
  LongSummary: "The summary is too long.",
  ManyTickets: "The epic holds too many tickets.",
  LargeContent: "The epic is too large.",
};

/** The sentence a refused epic write is drawn as. */
export function epicWriteRefusal(failure: ApiFailure): string {
  if (failure.outcome === "Absent") return "The epic no longer exists.";
  if (failure.outcome === "Conflict") {
    if (failure.code === "UnknownTickets") {
      const tickets = unknownTicketsOf(failure.body);
      return tickets.length === 0
        ? "The epic names tickets the project does not have."
        : `The project has no ticket ${tickets.map((ticket) => `#${String(ticket)}`).join(", ")}.`;
    }
    return epicRefusalWords[failure.code] ?? "The epic was refused.";
  }
  return "The epic could not be saved.";
}

function unknownTicketsOf(body: unknown): readonly number[] {
  if (typeof body !== "object" || body === null) return [];
  const tickets = (body as { readonly tickets?: unknown }).tickets;
  return Array.isArray(tickets)
    ? tickets.filter((ticket): ticket is number => typeof ticket === "number")
    : [];
}

/** The refusal a draft creation into an epic is drawn as, none where it is not that. */
export function epicDraftRefusal(failure: ApiFailure): string | undefined {
  if (failure.outcome !== "Conflict") return undefined;
  if (failure.code === "MissingEpic")
    return "The epic no longer exists, so the ticket was not made.";
  if (failure.code === "ArchivedEpic")
    return "The epic is archived, so it takes no new ticket.";
  if (failure.code === "ManyTickets" || failure.code === "LargeContent")
    return "The epic is full, so it takes no new ticket.";
  return undefined;
}

/** The write of an epic: the request, the sentence its refusal is drawn as, and the reads it leaves stale. */
export function epicWrite(
  partition: PartitionIdentity,
): ConsoleWrite<
  EpicWriteRequest,
  { readonly epic: number; readonly revision: number }
> {
  return {
    mutationKey: consoleWriteKey("epic", partition.tenant, partition.project),
    write: (ports, body) => apiWriteEpic(ports, partition, body),
    refusal: epicWriteRefusal,
    landed: (client) => epicsInvalidated(client, partition),
  };
}
