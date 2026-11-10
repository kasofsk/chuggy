/**
 * A project's epics as the console reads and writes them: the reads, the words
 * a status is drawn in, the layout of an epic's graph, and the form an epic is
 * edited through.
 *
 * Progress and status are the API's, derived from the members' phases; nothing
 * here recomputes them. What is decided here is how they are said and drawn.
 */

import type { QueryClient } from "@tanstack/query-core";

import {
  ticketSearchCharsMax,
  type PartitionIdentity,
} from "../../../../src/contract/http.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";
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
import type { Copy } from "./copy.ts";
import { epicStatusTone, type Tone } from "./tones.ts";

export type EpicStatusWord = EpicSummaryResponse["status"];

/** How many epics a page of the list asks for. */
export const epicsPageSize = 20;

/** How many epics a page of the creation form's picker reads. */
export const epicPickerMax = 50;

/** An epic the creation form's picker was chosen from. */
export interface EpicPicked {
  readonly number: number;
  readonly title: string;
}

/** The picker's epics: the page shown, and the one chosen where the page does
 * not hold it, so the trigger still names it once another page is shown. */
export function epicPickerOptions(
  epics: readonly EpicPicked[],
  chosen: EpicPicked | undefined,
): readonly { readonly value: string; readonly text: string }[] {
  const shown =
    chosen === undefined || epics.some((epic) => epic.number === chosen.number)
      ? epics
      : [chosen, ...epics];
  return shown.map((epic) => ({
    value: String(epic.number),
    text: epic.title,
  }));
}

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

const epicStatusWords: Readonly<Record<EpicStatusWord, Copy>> = {
  empty: { id: "epics-status-empty" },
  not_started: { id: "epics-status-not-started" },
  in_progress: { id: "epics-status-in-progress" },
  attention: { id: "epics-status-attention" },
  done: { id: "epics-status-done" },
};

/** The word and the hue a status is drawn in. */
export function epicStatusLook(status: EpicStatusWord): {
  readonly word: Copy;
  readonly tone: Tone;
} {
  return { word: epicStatusWords[status], tone: epicStatusTone(status) };
}

/** What an epic's progress says, as `done of total`, or that it holds nothing. */
export function epicProgressLine(
  progress: EpicSummaryResponse["progress"],
): Copy {
  return progress.total === 0
    ? { id: "epics-progress-none" }
    : {
        id: "epics-progress",
        args: { done: String(progress.done), total: String(progress.total) },
      };
}

type EpicProgress = EpicSummaryResponse["progress"];

/** The phases a member is moving in, which a bar draws as alive. */
const epicProgressMoving: readonly TicketPhase[] = [
  "Work",
  "Evaluation",
  "Finalization",
];

/** How a progress bar is drawn: its filled share, in whole percent of the
 * total, and how it says that something is moving. A bar with nothing done
 * has no fill to shimmer, so its empty track sweeps instead. */
export interface EpicProgressBar {
  readonly sharePercent: number;
  readonly moving: "Still" | "Shimmer" | "Sweep";
}

export function epicProgressBar(progress: EpicProgress): EpicProgressBar {
  const sharePercent =
    progress.total === 0
      ? 0
      : Math.round(
          (100 * Math.min(progress.done, progress.total)) / progress.total,
        );
  if (!epicProgressMovingAny(progress))
    return { sharePercent, moving: "Still" };
  return { sharePercent, moving: progress.done === 0 ? "Sweep" : "Shimmer" };
}

/** Whether any member is in a phase that moves on its own. */
export function epicProgressMovingAny(progress: EpicProgress): boolean {
  return epicProgressMoving.some((phase) => progress.byPhase[phase] > 0);
}

/** Each phase at least one member is in, with how many, in the phases' order. */
export function epicProgressCounts(
  progress: EpicProgress,
): readonly { readonly phase: TicketPhase; readonly count: number }[] {
  return phaseRoster
    .map((phase) => ({ phase, count: progress.byPhase[phase] }))
    .filter((counted) => counted.count > 0);
}

export const epicVisibilityChoices = [
  { value: "Active", text: { id: "epics-visibility-active" } },
  { value: "Archived", text: { id: "epics-visibility-archived" } },
  { value: "All", text: { id: "epics-visibility-all" } },
] as const satisfies readonly { readonly value: string; readonly text: Copy }[];

export const epicSortChoices = [
  { value: "newest", text: { id: "epics-sort-newest" } },
  { value: "oldest", text: { id: "epics-sort-oldest" } },
  { value: "title", text: { id: "epics-sort-title" } },
] as const satisfies readonly { readonly value: string; readonly text: Copy }[];

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
export function epicFormFaults(form: EpicForm): readonly Copy[] {
  const faults: Copy[] = [];
  if (form.title.trim() === "") faults.push({ id: "epics-fault-title-empty" });
  if ([...form.title].length > epicTitleCharsMax)
    faults.push({ id: "epics-fault-title-long" });
  if ([...form.summary].length > epicSummaryCharsMax)
    faults.push({ id: "epics-fault-summary-long" });
  const tickets = epicTicketsParsed(form.tickets);
  if (tickets.parsed === "Refused")
    faults.push({
      id: "epics-fault-not-tickets",
      args: { words: tickets.words.join(", ") },
    });
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

const epicRefusalWords: Readonly<Record<string, Copy>> = {
  StaleRevision: { id: "epics-refusal-stale" },
  ArchivedEpic: { id: "epics-refusal-archived" },
  EmptyTitle: { id: "epics-fault-title-empty" },
  LongTitle: { id: "epics-fault-title-long" },
  LongSummary: { id: "epics-fault-summary-long" },
  ManyTickets: { id: "epics-refusal-many-tickets" },
  LargeContent: { id: "epics-refusal-large" },
};

/** The sentence a refused epic write is drawn as. */
export function epicWriteRefusal(failure: ApiFailure): Copy {
  if (failure.outcome === "Absent") return { id: "epics-refusal-absent" };
  if (failure.outcome === "Conflict") {
    if (failure.code === "UnknownTickets") {
      const tickets = unknownTicketsOf(failure.body);
      return tickets.length === 0
        ? { id: "epics-refusal-unknown-tickets" }
        : {
            id: "epics-refusal-unknown-tickets-named",
            args: {
              tickets: tickets.map((ticket) => `#${String(ticket)}`).join(", "),
            },
          };
    }
    return epicRefusalWords[failure.code] ?? { id: "epics-refusal-refused" };
  }
  return { id: "epics-refusal-unsaved" };
}

function unknownTicketsOf(body: unknown): readonly number[] {
  if (typeof body !== "object" || body === null) return [];
  const tickets = (body as { readonly tickets?: unknown }).tickets;
  return Array.isArray(tickets)
    ? tickets.filter((ticket): ticket is number => typeof ticket === "number")
    : [];
}

/** The refusal a draft creation into an epic is drawn as, none where it is not that. */
export function epicDraftRefusal(failure: ApiFailure): Copy | undefined {
  if (failure.outcome !== "Conflict") return undefined;
  if (failure.code === "MissingEpic") return { id: "epics-draft-missing" };
  if (failure.code === "ArchivedEpic") return { id: "epics-draft-archived" };
  if (failure.code === "ManyTickets" || failure.code === "LargeContent")
    return { id: "epics-draft-full" };
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

/** The write that archives an epic or makes it active again: an epic's
 * write under a key of its own, so the form revising the same epic and the
 * press that archives it each draw only their own answer. */
export function epicVisibilityWrite(
  partition: PartitionIdentity,
): ReturnType<typeof epicWrite> {
  return {
    ...epicWrite(partition),
    mutationKey: consoleWriteKey(
      "epic-visibility",
      partition.tenant,
      partition.project,
    ),
  };
}
