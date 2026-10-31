/**
 * The ticket list: the first screen inside a project, one row a ticket, which a
 * reader searches, sorts and filters to what needs them, what is moving and
 * what is next.
 *
 * The tickets and what they ran are two reads under two keys, so a `Ticket`
 * frame moves a row and an `Execution` frame changes what one row says it is
 * running, without either disturbing the other. The filter, the search and the
 * order a sort reads in are asked of the wire, and the rows on screen stand
 * until the read under a new choice answers; the search and the sort are the
 * page's address, so a link holds the view. A project holding no ticket at all
 * offers the first instead.
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
 * the next page that adds a row.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { apiProject } from "../core/apiRoutes.ts";
import { phaseLabel } from "../core/codeLabels.ts";
import { creatorLabel } from "../core/labels.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import { projectExecutionIndexEmpty } from "../core/projectExecutionIndex.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import type { ProjectExecutionIndex } from "../core/projectExecutionIndex.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterPage,
  ticketFilterProjectEmpty,
  ticketFilterReadsCount,
} from "../core/projectTableFilters.ts";
import type {
  TicketFilter,
  TicketListAsk,
} from "../core/projectTableFilters.ts";
import { projectTableRows } from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import {
  projectTicketRowsHaveMore,
  projectTicketRowsMore,
  projectTicketRowsRead,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import {
  ticketListQueryWith,
  ticketListSearchOf,
  ticketListSearchWaitMs,
  ticketListShown,
  ticketListSortOf,
  ticketListSortOrder,
  ticketListSorts,
  ticketListSortTitles,
  ticketListStandingOf,
} from "../core/ticketListView.ts";
import type {
  TicketListQuery,
  TicketListSort,
  TicketListStanding,
} from "../core/ticketListView.ts";
import { phaseTone } from "../core/tones.ts";
import type { Tone } from "../core/tones.ts";
import { useApiPorts, usePanelListKept } from "./api.ts";
import { useCreatorEmails } from "./creatorEmails.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useProjectExecutionIndex } from "./executionIndex.ts";
import { useNowMs } from "./Freshness.tsx";
import { persistentStore } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { TicketRowDispatchScope } from "./TicketActions.tsx";
import type { TicketRowDispatch } from "./TicketActions.tsx";
import {
  TicketActivity,
  TicketRowExecutionCell,
  TicketTitleNumber,
  TicketTitleWords,
} from "./TicketCells.tsx";
import { RepositoryImportRefusedNotice } from "./repositories/RepositoryImportRefused.tsx";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Input } from "./ui/Input.tsx";
import { Picker } from "./ui/Picker.tsx";
import { TicketReference } from "./ui/TicketReference.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./ProjectTable.css";

interface TicketRowsHeld {
  readonly state: PanelState<ProjectTicketRows>;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * The read the ticket query runs, which takes how many pages to gather from the
 * entry it is about to replace. Exported because that is the whole of what
 * makes a refetch keep a reader's pages, and a suite can hand it a cache.
 */
export function ticketRowsRead(
  client: QueryClient,
  ports: ApiPorts,
  partition: PartitionIdentity,
  ask: TicketListAsk,
): Promise<ApiResult<ProjectTicketRows>> {
  const key = ticketFilterList(partition, ask).key;
  return projectTicketRowsRead(
    client.getQueryData<ProjectTicketRows>(key),
    (cursor, read) =>
      apiProject(ports, partition, ticketFilterPage(ask, { read, cursor })),
    ticketFilterReadsCount(ask),
  );
}

/** The rows for one filter, order and search, the refresh that keeps them
 * live, and the read that appends the next page to them. */
function useTicketRows(
  partition: PartitionIdentity,
  ask: TicketListAsk,
): TicketRowsHeld {
  const list = ticketFilterList(partition, ask);
  const key = list.key;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const { state, kept } = usePanelListKept(list, (at) =>
    ticketRowsRead(client, at, partition, ask),
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
          client.setQueryData<ProjectTicketRows>(key, (previous) =>
            previous === undefined ? previous : update(previous),
          ),
        (cursor, read) =>
          apiProject(ports, partition, ticketFilterPage(ask, { read, cursor })),
        ticketFilterReadsCount(ask),
      );
      setReading(false);
    })();
  };
  return {
    state,
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

function ticketListFilterOf(stored: string | null): TicketFilter {
  return phaseRoster.find((phase) => phase === stored) ?? ticketFilterAll;
}

/** What a row's chip says and the tone it is drawn in. */
function ticketListStandingTone(standing: TicketListStanding): Tone {
  if (standing === "Ready") return "pass";
  return standing === "Blocked" ? "queued" : phaseTone(standing);
}

function ticketListStandingWord(standing: TicketListStanding): string {
  return standing === "Ready" || standing === "Blocked"
    ? standing
    : phaseLabel(standing);
}

/** The row's state: a chip as wide on every row, so the column lines up, with
 * what holds it there on hover. */
function TicketListState(props: {
  readonly row: ProjectTableRow;
  readonly dispatch?: TicketRowDispatch | undefined;
}): ReactNode {
  const row = props.row;
  const standing = ticketListStandingOf(row);
  const dispatch = props.dispatch;
  if (dispatch !== undefined)
    return (
      <Tooltip text={dispatch.effect}>
        <button
          type="button"
          className="ticket-list-state"
          data-tone={ticketListStandingTone(standing)}
          data-standing={standing}
          aria-label={`Dispatch ticket #${String(row.ticket)}`}
          aria-busy={dispatch.busy || undefined}
          disabled={dispatch.busy}
          onClick={dispatch.press}
        >
          {ticketListStandingWord(standing)}
        </button>
      </Tooltip>
    );
  const unfinished =
    row.openDependencies.length + row.revokedDependencies.length;
  const hint =
    standing === "Blocked"
      ? `Blocked · ${String(unfinished)} unfinished ${unfinished === 1 ? "dependency" : "dependencies"}`
      : row.badge;
  return (
    <Tooltip text={hint}>
      <span
        className="ticket-list-state"
        data-tone={ticketListStandingTone(standing)}
        data-standing={standing}
      >
        {ticketListStandingWord(standing)}
      </span>
    </Tooltip>
  );
}

/** What the row is running and where, where the index joined anything to it. */
function TicketListExecution(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const row = props.row;
  if (row.executionVerdict === undefined) return null;
  return (
    <span className="ticket-list-execution">
      <TicketRowExecutionCell row={row} />
      {row.runsOn === undefined ? null : (
        <Tooltip text={row.runsOn.title}>
          <span className="ticket-list-runs-on">{row.runsOn.text}</span>
        </Tooltip>
      )}
    </span>
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
}): ReactNode {
  const waits = [
    ...props.row.openDependencies.map((dependency) => dependency.ticket),
    ...props.row.revokedDependencies,
  ];
  if (waits.length === 0) return null;
  return (
    <span className="ticket-list-dependencies" aria-label="Waits on">
      <Tooltip text="Waits on">
        <span className="ticket-list-waits">{ticketListDependencyGlyph}</span>
      </Tooltip>
      {waits.map((ticket) => (
        <TicketReference key={ticket} ticket={ticket} />
      ))}
    </span>
  );
}

function TicketListRow(props: {
  readonly row: ProjectTableRow;
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
              <TicketListExecution row={row} />
              <TicketListRepository row={row} />
              {row.creator === undefined ? null : (
                <span className="ticket-list-creator">
                  <Identity
                    label={creatorLabel(row.creator, props.creatorEmails)}
                  />
                </span>
              )}
            </span>
            <TicketListDependencies row={row} />
          </div>
        </div>
        <div className="ticket-list-foot">
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

function TicketListControls(props: {
  readonly search: string;
  readonly onSearch: (search: string) => void;
  readonly sort: TicketListSort;
  readonly onSort: (sort: TicketListSort) => void;
  readonly filter: TicketFilter;
  readonly onFilter: (filter: TicketFilter) => void;
}): ReactNode {
  return (
    <div className="ticket-list-controls">
      <span className="ticket-list-search">
        <Input
          label="Search tickets"
          placeholder="Search titles or #number…"
          value={props.search}
          onChange={props.onSearch}
        />
      </span>
      <div className="ticket-list-selects">
        <Picker
          label="Sort"
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
          glyph={ticketListFilterGlyph}
          value={props.filter}
          options={[
            { value: ticketFilterAll, text: "All states" },
            ...phaseRoster.map((phase) => ({
              value: phase,
              text: phaseLabel(phase),
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

/** One line under the controls where the list needs one: how many tickets a
 * search matched across the project, or that the list holds none. */
function ticketListStatus(
  rows: ProjectTicketRows,
  searching: boolean,
): string | undefined {
  if (searching)
    return rows.matched === undefined
      ? undefined
      : `${String(rows.matched)} matching ${rows.matched === 1 ? "ticket" : "tickets"}`;
  return rows.tickets.length === 0
    ? "No active or recently finished tickets."
    : undefined;
}

/** The rows the list's read holds, drawn in the order the sort asks for, or
 * the one line a read that is not ready is drawn as. */
function TicketListRows(props: {
  readonly state: PanelState<ProjectTicketRows>;
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly sort: TicketListSort;
  readonly searching: boolean;
  readonly readMore: (() => void) | undefined;
}): ReactNode {
  const creatorEmails = useCreatorEmails(props.partition);
  const state = props.state;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const shown = ticketListShown(
    projectTableRows(state.value.tickets, props.index),
    props.sort,
  );
  const status = ticketListStatus(state.value, props.searching);
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

/** The reader's filter, as this browser last kept it. */
function useTicketListFilter() {
  const [filter, setFilter] = useState(() =>
    ticketListFilterOf(persistentStore.read(ticketListFilterStoreKey)),
  );
  return {
    filter,
    filtered: (next: TicketFilter): void => {
      setFilter(next);
      persistentStore.write(ticketListFilterStoreKey, next);
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
  const choices = useTicketListFilter();
  const [typed, setTyped] = useTicketListTyped(props.query, props.onQuery);
  const sort = ticketListSortOf(props.query.sort);
  const ask: TicketListAsk = {
    filter: choices.filter,
    order: ticketListSortOrder(sort),
    search: props.query.q,
  };
  const tickets = useTicketRows(partition, ask);
  const executions = useProjectExecutionIndex(partition);
  const nowMs = useNowMs();
  const authoring = !projectAbilityRefused(
    useProjectAbilities(partition),
    "mutate",
  );
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexEmpty;
  if (
    tickets.state.state === "Ready" &&
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
        search={typed}
        onSearch={setTyped}
        sort={sort}
        onSort={(next) => {
          props.onQuery(ticketListQueryWith(props.query, { sort: next }));
        }}
        filter={choices.filter}
        onFilter={choices.filtered}
      />
      {executions.state === "Failed" ? (
        <p className="panel-failed">
          what each ticket ran could not be read — {executions.reason}
        </p>
      ) : null}
      {partialFailure === undefined ? null : (
        <p className="panel-failed">
          a further page could not be read — {partialFailure}
        </p>
      )}
      <TicketListRows
        state={tickets.state}
        index={index}
        partition={partition}
        nowMs={nowMs}
        sort={sort}
        searching={props.query.q !== undefined}
        readMore={tickets.readMore}
      />
      {tickets.reading ? <p className="panel-note">reading…</p> : null}
    </section>
  );
}
