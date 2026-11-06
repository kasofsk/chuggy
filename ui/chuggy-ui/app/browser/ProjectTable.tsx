/**
 * The ticket list: the first screen inside a project, one row a ticket, which a
 * reader searches, sorts and filters to what needs them, what is moving and
 * what is next.
 *
 * Each row carries its ticket's latest execution, so a `Ticket` frame moves a
 * row and an `Execution` frame changes what one row says it is running, both
 * folded into the one entry the rows are read under. The filter, the search
 * and the order a sort reads in are asked of the wire, and the rows on screen
 * stand until the read under a new choice answers; the search, the sort and
 * the filter are the page's address, so a link holds the view. Each state's
 * count above the rows chooses the filter as the picker does. A project
 * holding no ticket at all offers the first instead.
 *
 * A ROW OFFERS ONE ACTION, DISPATCH, AS ITS READY CHIP. A ready row reads the
 * dispatch view for the version a dispatch names, and its chip is the button;
 * every other action is the ticket page's, which holds the reads that decide
 * what a resume or a revoke does.
 *
 * A read gathers as many pages as the reader had asked for, because the entry
 * it writes is under the partition prefix that the degraded stream's fallback
 * and a `Project` frame both invalidate; rebuilding it from the first page
 * would take a reader's pages away on a timer. "Show more" appends to the entry
 * the next page that adds a row, and restarts a read it finds running.
 */

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";
import { apiProject } from "../core/apiRoutes.ts";
import { phaseLabel } from "../core/codeLabels.ts";
import { creatorLabel } from "../core/labels.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import {
  ticketFilterAll,
  ticketFilterIsStanding,
  ticketFilterOf,
  ticketFilterPage,
  ticketFilterProjectEmpty,
  ticketFilterReadsCount,
  ticketFilterStandings,
} from "../core/projectTableFilters.ts";
import type {
  TicketFilter,
  TicketListAsk,
} from "../core/projectTableFilters.ts";
import { projectTableRow } from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import {
  projectTicketRowsHaveMore,
  projectTicketRowsMore,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import { ticketRowsQuery } from "../core/ticketQueries.ts";
import {
  ticketListCountTapped,
  ticketListFiltered,
  ticketListQueryWith,
  ticketListSearchOf,
  ticketListSearchWaitMs,
  ticketListShown,
  ticketListSortOf,
  ticketListSortOrder,
  ticketListSorts,
  ticketListSortTitles,
  ticketListStandingOf,
  type TicketListStanding,
} from "../core/ticketListView.ts";
import type {
  TicketListQuery,
  TicketListSort,
} from "../core/ticketListView.ts";
import { panelReadRestarted, useApiPorts, usePanelState } from "./api.ts";
import { EpicChips } from "./EpicChips.tsx";
import { useCreatorEmails } from "./creatorEmails.ts";
import { PanelUnready, ReadFailed } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { persistentStore } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { TicketRowDispatchScope } from "./TicketActions.tsx";
import type { TicketRowDispatch } from "./TicketActions.tsx";
import {
  TicketActivity,
  TicketTitleNumber,
  TicketTitleWords,
} from "./TicketCells.tsx";
import { RepositoryImportRefusedNotice } from "./repositories/RepositoryImportRefused.tsx";
import { Button, ButtonLink, buttonLookClassName } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Input } from "./ui/Input.tsx";
import { Picker } from "./ui/Picker.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import {
  TicketDependencyChip,
  dependencyStandingOf,
  TicketStateChip,
  TicketStateCount,
} from "./ticket/TicketStateChip.tsx";
import { useHeadroom } from "./useHeadroom.ts";
import "./ProjectTable.css";

interface TicketRowsHeld {
  readonly state: PanelState<ProjectTicketRows>;
  /** The rows drawn are an earlier ask's, standing until this one answers. */
  readonly kept: boolean;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/** The rows for one filter, order and search, the refresh that keeps them
 * live, and the read that appends the next page to them. */
function useTicketRows(
  partition: PartitionIdentity,
  ask: TicketListAsk,
): TicketRowsHeld {
  const query = ticketRowsQuery(partition, ask);
  const key = query.queryKey;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const { state, kept } = usePanelState(
    { ...query, placeholderData: keepPreviousData },
    (state, answer) => ({ state, kept: answer.isPlaceholderData }),
  );
  const rows = state.state === "Ready" && !kept ? state.value : undefined;
  const more =
    rows === undefined || !projectTicketRowsHaveMore(rows) ? undefined : rows;
  const readMore = (from: ProjectTicketRows) => {
    setReading(true);
    void (async () => {
      await projectTicketRowsMore(
        from,
        (update) =>
          client.setQueryData(key, (previous) =>
            previous === undefined ? previous : update(previous),
          ),
        (cursor, read) =>
          apiProject(ports, partition, ticketFilterPage(ask, { read, cursor })),
        ticketFilterReadsCount(ask),
      );
      panelReadRestarted(client, key);
      setReading(false);
    })();
  };
  return {
    state,
    kept,
    readMore:
      more === undefined || reading
        ? undefined
        : () => {
            readMore(more);
          },
    reading,
  };
}

/** Where this browser keeps the reader's filter. */
const ticketListFilterStoreKey = "chug.ticket-list.filter";

function ticketListFilterOf(word: unknown): TicketFilter {
  return ticketFilterOf(word) ?? ticketFilterAll;
}

/** The row's state: a chip as wide on every row, so the column lines up, with
 * what holds it there on hover. */
function TicketListState(props: {
  readonly row: ProjectTableRow;
  readonly dispatch?: TicketRowDispatch | undefined;
}): ReactNode {
  const row = props.row;
  const standing = ticketListStandingOf(row);
  const unfinished =
    row.openDependencies.length + row.revokedDependencies.length;
  return (
    <TicketStateChip
      ticket={row.ticket}
      standing={standing}
      hint={
        standing === "Blocked"
          ? `Blocked · ${String(unfinished)} unfinished ${unfinished === 1 ? "dependency" : "dependencies"}`
          : row.badge
      }
      dispatch={props.dispatch}
    />
  );
}

/** The repository the ticket works in, by owner and name, with its whole address on hover. */
function TicketListRepository(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const repository = props.row.repository;
  if (repository === undefined) return null;
  return (
    <Tooltip text={repository}>
      <span className="ticket-list-repository">
        {repositoryLabel(repository)}
      </span>
    </Tooltip>
  );
}

function TicketListDependencies(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
}): ReactNode {
  const waits = [
    ...props.row.openDependencies.map(
      (dependency) => [dependency.ticket, dependency.phase] as const,
    ),
    ...props.row.revokedDependencies.map(
      (ticket) => [ticket, "Revoked"] as const,
    ),
  ];
  if (waits.length === 0) return null;
  return (
    <span className="ticket-list-dependencies" aria-label="Waits on">
      <Tooltip text="Waits on">
        <span className="ticket-list-waits">{ticketListDependencyGlyph}</span>
      </Tooltip>
      {waits.map(([ticket, phase]) => (
        <TicketDependencyChip
          key={ticket}
          ticket={ticket}
          standing={dependencyStandingOf(phase, props.standings.get(ticket))}
        />
      ))}
    </span>
  );
}

/** Who filed the row, drawn in the meta where the list is wide and in the
 * foot where it is narrow; the sheet shows one of the two. */
function TicketListCreator(props: {
  readonly row: ProjectTableRow;
  readonly creatorEmails: ReadonlyMap<string, string>;
  readonly className: string;
}): ReactNode {
  if (props.row.creator === undefined) return null;
  return (
    <span className={props.className}>
      <Identity label={creatorLabel(props.row.creator, props.creatorEmails)} />
    </span>
  );
}

/** What the row waits on, and the epics it belongs to. */
function TicketListWaits(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <>
      <TicketListDependencies row={props.row} standings={props.standings} />
      <EpicChips partition={props.partition} epics={props.row.epics} />
    </>
  );
}

function TicketListRow(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly creatorEmails: ReadonlyMap<string, string>;
}): ReactNode {
  const row = props.row;
  return (
    <li className="ticket-list-item" data-ticket={row.ticket}>
      <article className="ticket-list-row">
        <div className="ticket-list-head">
          <h3 className="ticket-list-title">
            <TicketTitleWords
              partition={props.partition}
              ticket={row.ticket}
              title={row.title}
            />
          </h3>
          <div className="ticket-list-info">
            <span className="ticket-list-number">
              <TicketTitleNumber
                partition={props.partition}
                ticket={row.ticket}
              />
            </span>
            <span className="ticket-list-meta">
              <span className="ticket-list-activity">
                <TicketActivity
                  activityAt={row.activityAt}
                  nowMs={props.nowMs}
                />
              </span>
              <TicketListRepository row={row} />
              <TicketListCreator
                row={row}
                creatorEmails={props.creatorEmails}
                className="ticket-list-creator"
              />
            </span>
            <TicketListWaits {...props} />
          </div>
        </div>
        <div className="ticket-list-foot">
          <TicketListCreator
            row={row}
            creatorEmails={props.creatorEmails}
            className="ticket-list-foot-creator"
          />
          {ticketListStandingOf(row) === "Ready" ? (
            <TicketRowDispatchScope
              partition={props.partition}
              ticket={row.ticket}
              sequence={row.sequence}
            >
              {(dispatch, notes) => (
                <>
                  <div className="ticket-list-notes">{notes}</div>
                  <TicketListState row={row} dispatch={dispatch} />
                </>
              )}
            </TicketRowDispatchScope>
          ) : (
            <TicketListState row={row} />
          )}
        </div>
      </article>
    </li>
  );
}

/** The search, the sort and the filter, and the way to a new ticket. */
function TicketListGlyph(props: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </svg>
  );
}

const ticketListSortGlyph = (
  <TicketListGlyph>
    <path d="M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5" />
  </TicketListGlyph>
);

const ticketListFilterGlyph = (
  <TicketListGlyph>
    <path d="M2.5 3h11L9.5 8v4.5l-3 1.5V8z" />
  </TicketListGlyph>
);

const ticketListDependencyGlyph = (
  <TicketListGlyph>
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="11.5" cy="12" r="1.75" />
    <path d="M4.5 5.25v9.25M4.5 5.25c0 3.5 2.75 6.75 5.25 6.75" />
  </TicketListGlyph>
);

/** The standings that are not yet an end, in the order the State sort draws the rows, reversed. */
const ticketListCounted = [
  "Blocked",
  "Ready",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
] as const satisfies readonly TicketListStanding[];

/** How many of the rows drawn stand in each state that is not an end, each
 * the button that filters the list to its state or, as the filter, back to
 * every ticket. The filter's own state is drawn when no row stands in it, so it
 * can always be tapped away. */
function TicketListCounts(props: {
  readonly rows: readonly ProjectTableRow[];
  readonly filter: TicketFilter;
  readonly onFilter: (filter: TicketFilter) => void;
}): ReactNode {
  const counts = new Map<TicketListStanding, number>();
  for (const row of props.rows) {
    const standing = ticketListStandingOf(row);
    counts.set(standing, (counts.get(standing) ?? 0) + 1);
  }
  return (
    <ul className="ticket-list-counts" aria-label="Tickets by state">
      {ticketListCounted
        .flatMap((standing) => {
          const count =
            counts.get(standing) ?? (standing === props.filter ? 0 : undefined);
          return count === undefined ? [] : [{ standing, count }];
        })
        .map(({ standing, count }) => (
          <li key={standing}>
            <TicketStateCount
              standing={standing}
              count={count}
              pressed={standing === props.filter}
              onPress={() => {
                props.onFilter(ticketListCountTapped(props.filter, standing));
              }}
            />
          </li>
        ))}
    </ul>
  );
}

/** What the Filter picker offers past All: every phase, Pending followed by
 * the standings it narrows to. */
const ticketListFilterChoices: readonly Exclude<
  TicketFilter,
  typeof ticketFilterAll
>[] = phaseRoster.flatMap((phase) =>
  phase === "Pending" ? [phase, ...ticketFilterStandings] : [phase],
);

function ticketListFilterText(
  filter: Exclude<TicketFilter, typeof ticketFilterAll>,
): string {
  return ticketFilterIsStanding(filter) ? filter : phaseLabel(filter);
}

/** How long the box takes to close, which the room it holds in the row outlasts. */
const ticketListSearchCloseMs = 260;

/** The search, which is a button until it is asked for and then the button
 * opened out to the box; closed over a search it holds, the button is marked. */
function TicketListSearch(props: {
  readonly search: string;
  readonly onSearch: (search: string) => void;
}): ReactNode {
  const [asked, setAsked] = useState(false);
  const field = useRef<HTMLSpanElement>(null);
  const [laidOut, setLaidOut] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = asked;
  useEffect(() => {
    if (asked) field.current?.querySelector("input")?.focus();
  }, [asked]);
  useEffect(
    () => () => {
      clearTimeout(closing.current);
    },
    [],
  );
  const show = (): void => {
    clearTimeout(closing.current);
    setAsked(true);
    setLaidOut(true);
  };
  const close = (): void => {
    setAsked(false);
    clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      setLaidOut(false);
    }, ticketListSearchCloseMs);
  };
  return (
    <span
      className="ticket-list-search"
      data-open={open || laidOut || undefined}
      data-expanded={open || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        type="button"
        className={`${buttonLookClassName({ size: "sm" })} ticket-list-search-toggle`}
        aria-label="Search tickets"
        aria-expanded={open}
        title="Search tickets"
        data-active={props.search === "" ? undefined : ""}
        onClick={() => {
          if (open) close();
          else show();
        }}
      >
        {ticketListSearchGlyph}
      </button>
      <span className="ticket-list-search-field" ref={field} inert={!open}>
        <Input
          label="Search tickets"
          placeholder="Search titles or #number…"
          value={props.search}
          onChange={props.onSearch}
        />
      </span>
    </span>
  );
}

const ticketListSearchGlyph = (
  <TicketListGlyph>
    <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.8 10.8l3 3" />
  </TicketListGlyph>
);

function TicketListControls(props: {
  readonly rows: readonly ProjectTableRow[];
  readonly search: string;
  readonly onSearch: (search: string) => void;
  readonly sort: TicketListSort;
  readonly onSort: (sort: TicketListSort) => void;
  readonly filter: TicketFilter;
  readonly onFilter: (filter: TicketFilter) => void;
}): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  const hidden = useHeadroom(bar);
  return (
    <div
      className="ticket-list-controls"
      ref={bar}
      data-hidden={hidden || undefined}
      inert={hidden}
    >
      <TicketListCounts
        rows={props.rows}
        filter={props.filter}
        onFilter={props.onFilter}
      />
      <div className="ticket-list-selects">
        <TicketListSearch search={props.search} onSearch={props.onSearch} />
        <Picker
          label="Sort"
          iconOnly
          glyph={ticketListSortGlyph}
          value={props.sort}
          options={ticketListSorts.map((sort) => ({
            value: sort,
            text: ticketListSortTitles[sort],
          }))}
          onChoose={(chosen) => {
            props.onSort(ticketListSortOf(chosen));
          }}
          align="end"
        />
        <Picker
          label="Filter"
          iconOnly
          glyph={ticketListFilterGlyph}
          value={props.filter}
          options={[
            { value: ticketFilterAll, text: "All states" },
            ...ticketListFilterChoices.map((filter) => ({
              value: filter,
              text: ticketListFilterText(filter),
            })),
          ]}
          onChoose={(chosen) => {
            props.onFilter(ticketListFilterOf(chosen));
          }}
          align="end"
        />
      </div>
    </div>
  );
}

/** How many tickets a search matched, and, where that is a count of the rows
 * read while pages remain, that it is of those read so far. */
function ticketListStatusMatched(matched: number, soFar: boolean): string {
  return `${String(matched)} matching ${matched === 1 ? "ticket" : "tickets"}${soFar ? " so far" : ""}`;
}

/** One line under the controls where the list needs one: how many tickets a
 * search matched, across the project or, under a standing the server cannot
 * count, among the rows drawn; or that the list draws none, of the tickets
 * there are or, while pages remain, of those read so far. */
function ticketListStatus(
  rows: ProjectTicketRows,
  filter: TicketFilter,
  searching: boolean,
  shown: number,
): string | undefined {
  if (searching && ticketFilterIsStanding(filter))
    return ticketListStatusMatched(shown, projectTicketRowsHaveMore(rows));
  if (searching)
    return rows.matched === undefined
      ? undefined
      : ticketListStatusMatched(rows.matched, false);
  if (shown > 0) return undefined;
  return rows.tickets.length > 0 && projectTicketRowsHaveMore(rows)
    ? "None of the tickets read so far is in this state."
    : "No active or recently finished tickets.";
}

/** The rows the list's read holds that its filter draws, in the order the sort
 * asks for, or the one line a read that is not ready is drawn as. A dependency
 * reads its standing from every row held, drawn or not. */
function TicketListRows(props: {
  readonly state: PanelState<ProjectTicketRows>;
  readonly filter: TicketFilter;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly sort: TicketListSort;
  readonly searching: boolean;
  readonly readMore: (() => void) | undefined;
}): ReactNode {
  const creatorEmails = useCreatorEmails(props.partition);
  const state = props.state;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const rows = state.value.tickets.map(projectTableRow);
  const shown = ticketListShown(
    ticketListFiltered(rows, props.filter),
    props.sort,
  );
  const standings = new Map(
    rows.map((row) => [row.ticket, ticketListStandingOf(row)] as const),
  );
  const status = ticketListStatus(
    state.value,
    props.filter,
    props.searching,
    shown.length,
  );
  return (
    <>
      {status === undefined ? null : (
        <p className="ticket-list-status" role="status">
          {status}
        </p>
      )}
      {shown.length === 0 ? null : (
        <ul className="ticket-list" aria-label="Tickets">
          {shown.map((row) => (
            <TicketListRow
              key={row.ticket}
              row={row}
              standings={standings}
              partition={props.partition}
              nowMs={props.nowMs}
              creatorEmails={creatorEmails}
            />
          ))}
        </ul>
      )}
      {props.readMore === undefined ? null : (
        <div className="ticket-list-more">
          <Button onClick={props.readMore}>Show more</Button>
        </div>
      )}
    </>
  );
}

function ProjectTableTitle(): ReactNode {
  return <ScreenTitle>Tickets</ScreenTitle>;
}

function ProjectTableNewTicket(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <ButtonLink to="/$tenant/$project/tickets/new" params={props.partition}>
      New ticket
    </ButtonLink>
  );
}

/** What a project holding no ticket at all draws in place of the sections:
 * the one way to make the first, for a reader who may. */
function ProjectTableEmpty(props: {
  readonly partition: PartitionIdentity;
  readonly authoring: boolean;
}): ReactNode {
  return (
    <>
      <ProjectTableTitle />
      <RepositoryImportRefusedNotice partition={props.partition} />
      <EmptyState
        variant="page"
        label="No tickets"
        action={
          props.authoring ? (
            <ProjectTableNewTicket partition={props.partition} />
          ) : undefined
        }
      />
    </>
  );
}

/** The reader's filter: the address's, else the one this browser kept as the
 * list mounted, so a choice in another tab does not move this one. A choice is
 * written to both. */
function useTicketListFilter(
  query: TicketListQuery,
  onQuery: (query: TicketListQuery) => void,
) {
  const [kept] = useState(() =>
    ticketListFilterOf(persistentStore.read(ticketListFilterStoreKey)),
  );
  return {
    filter: query.filter ?? kept,
    filtered: (next: TicketFilter): void => {
      persistentStore.write(ticketListFilterStoreKey, next);
      onQuery(ticketListQueryWith(query, { filter: next }));
    },
  };
}

/**
 * What the reader is typing, and the address it is written into once it has
 * stood `ticketListSearchWaitMs`. A search the address moves to by any other
 * way, a link or going back, replaces what is typed.
 */
function useTicketListTyped(
  query: TicketListQuery,
  onQuery: (query: TicketListQuery) => void,
): readonly [string, (typed: string) => void] {
  const [typed, setTyped] = useState(query.q ?? "");
  const [addressed, setAddressed] = useState(query.q);
  if (addressed !== query.q) {
    setAddressed(query.q);
    if (ticketListSearchOf(typed) !== query.q) setTyped(query.q ?? "");
  }
  useEffect(() => {
    const q = ticketListSearchOf(typed);
    if (q === query.q) return undefined;
    const waiting = setTimeout(() => {
      onQuery(ticketListQueryWith(query, { q }));
    }, ticketListSearchWaitMs);
    return () => {
      clearTimeout(waiting);
    };
  }, [typed, query, onQuery]);
  return [typed, setTyped];
}

export function ProjectTable(props: {
  readonly query: TicketListQuery;
  readonly onQuery: (query: TicketListQuery) => void;
}): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const choices = useTicketListFilter(props.query, props.onQuery);
  const [typed, setTyped] = useTicketListTyped(props.query, props.onQuery);
  const sort = ticketListSortOf(props.query.sort);
  const ask: TicketListAsk = {
    filter: choices.filter,
    order: ticketListSortOrder(sort),
    search: props.query.q,
  };
  const tickets = useTicketRows(partition, ask);
  const nowMs = useNowMs();
  const authoring = !projectAbilityRefused(
    useProjectAbilities(partition),
    "mutate",
  );
  if (
    tickets.state.state === "Ready" &&
    !tickets.kept &&
    ticketFilterProjectEmpty(ask, tickets.state.value)
  )
    return <ProjectTableEmpty partition={partition} authoring={authoring} />;
  const partialFailure =
    tickets.state.state === "Ready" ? tickets.state.value.failure : undefined;
  return (
    <section className="ticket-list-page" aria-label="Tickets" data-fills-width>
      <ProjectTableTitle />
      <RepositoryImportRefusedNotice partition={partition} />
      <TicketListControls
        rows={
          tickets.state.state === "Ready"
            ? ticketListFiltered(
                tickets.state.value.tickets.map(projectTableRow),
                choices.filter,
              )
            : []
        }
        search={typed}
        onSearch={setTyped}
        sort={sort}
        onSort={(next) => {
          props.onQuery(ticketListQueryWith(props.query, { sort: next }));
        }}
        filter={choices.filter}
        onFilter={choices.filtered}
      />
      {partialFailure === undefined ? null : (
        <ReadFailed subject="More" failure={partialFailure} />
      )}
      <TicketListRows
        state={tickets.state}
        filter={choices.filter}
        partition={partition}
        nowMs={nowMs}
        sort={sort}
        searching={props.query.q !== undefined}
        readMore={tickets.readMore}
      />
      {tickets.reading ? <p className="panel-note">Loading…</p> : null}
    </section>
  );
}
