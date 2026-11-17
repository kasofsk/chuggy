/**
 * The ticket list: the first screen inside a project, one row a ticket, which a
 * reader searches, sorts and filters to what needs them, what is moving and
 * what is next.
 *
 * Each row carries its ticket's latest execution, so a `Ticket` frame moves a
 * row and an `Execution` frame changes what one row says it is running, both
 * folded into the one entry the rows are read under. The filter, the creator,
 * the owner, the search and the order a sort reads in are asked of the wire,
 * and the rows on screen stand until the read under a new choice answers; the
 * search, the sort, the filter, the creator and the owner are the page's
 * address, so a link holds the view. The filter, the creator and the owner
 * are chosen in the one Filter control, and each that is set is a mark under
 * the bar that takes it away. A project holding no ticket at all says so in
 * one line instead, and a list its reader narrowed to nothing offers the way
 * back to every ticket.
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
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { LandingQueuesResponse } from "../../../../src/contract/responses.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";
import { apiProject } from "../core/apiRoutes.ts";
import { phaseLabel } from "../core/codeLabels.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import type { ApiFailure } from "../core/apiRequest.ts";
import type { Copy, CopyText } from "../core/copy.ts";
import { creatorLabel } from "../core/labels.ts";
import type { PanelState } from "../core/freshness.ts";
import { landingQueuePlaceOf } from "../core/landingQueues.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import {
  ticketFilterAll,
  ticketFilterIsStanding,
  ticketFilterOf,
  ticketFilterPage,
  ticketFilterProjectEmpty,
  ticketFilterReadsCount,
  ticketFilterStandings,
  ticketListAskNarrowed,
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
  ticketListCreatorsOffered,
  ticketListFiltered,
  ticketListFiltersActive,
  ticketListQueryCleared,
  ticketListQueryFiltersCleared,
  ticketListQueryWith,
  ticketListQueryWithout,
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
  TicketListFilterActive,
  TicketListQuery,
  TicketListSort,
} from "../core/ticketListView.ts";
import { panelReadRestarted, useApiPorts, usePanelState } from "./api.ts";
import { EpicChips } from "./EpicChips.tsx";
import { useCreatorEmails } from "./creatorEmails.ts";
import {
  ListControls,
  ListGlyph,
  ListSearch,
  listSortGlyph,
} from "./ui/ListControls.tsx";
import { ListFilter, ListFilterMarks } from "./ui/ListFilter.tsx";
import type { ListFilterMark } from "./ui/ListFilter.tsx";
import { PanelUnready, ReadFailed } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { persistentStore } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { useProjectPeople } from "./settings/projectPermissionsResource.ts";
import { ScreenTitle } from "./shell/slots.tsx";
import { useElementAtLeastEm, viewportNarrowEm } from "./shell/viewport.ts";
import { TicketRowDispatchScope } from "./TicketActions.tsx";
import type { TicketRowDispatch } from "./TicketActions.tsx";
import { TicketActivity, cellAbsent } from "./TicketCells.tsx";
import { RepositoryImportRefusedNotice } from "./repositories/RepositoryImportRefused.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Picker } from "./ui/Picker.tsx";
import { RecordList, RecordRow, RecordRowSkeleton } from "./ui/RecordList.tsx";
import { Select } from "./ui/Select.tsx";
import type { RecordListMore } from "./ui/RecordList.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import {
  TicketDependencyChip,
  dependencyStandingOf,
  TicketStateChip,
} from "./ticket/TicketStateChip.tsx";
import type { TicketStateChipLook } from "./ticket/TicketStateChip.tsx";
import {
  LandingQueueChip,
  useLandingQueues,
} from "./ticket/LandingQueueChip.tsx";
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

/** The row's state: a chip as wide on every row, so the column lines up. What
 * holds it there is on the row's own lines: what it waits on at the end of
 * its first, and an escalation's cause in its meta. */
export function TicketListState(props: {
  readonly row: ProjectTableRow;
  readonly dispatch?: TicketRowDispatch | undefined;
  readonly look?: TicketStateChipLook | undefined;
}): ReactNode {
  const row = props.row;
  return (
    <TicketStateChip
      ticket={row.ticket}
      standing={ticketListStandingOf(row)}
      dispatch={props.dispatch}
      look={props.look}
    />
  );
}

/** Why an escalated row is held, in its meta, where its badge says more than
 * the phase its state chip already shows. */
export function TicketListEscalation(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const text = useCopyText();
  const badge = props.row.badge;
  if (badge === undefined || badge.id === phaseLabel(props.row.phase).id)
    return null;
  return <span className="ticket-list-escalation">{text(badge)}</span>;
}

/** The repository the ticket works in, by owner and name, with its whole address on hover. */
function TicketListRepository(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const repository = props.row.repository;
  if (repository === undefined) return null;
  return (
    <Tooltip trigger="abbreviation" text={repository}>
      <span className="ticket-list-repository">
        {repositoryLabel(repository)}
      </span>
    </Tooltip>
  );
}

export function TicketListDependencies(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
}): ReactNode {
  const text = useCopyText();
  const waits = [
    ...props.row.openDependencies.map(
      (dependency) => [dependency.ticket, dependency.phase] as const,
    ),
    ...props.row.revokedDependencies.map(
      (ticket) => [ticket, "Revoked"] as const,
    ),
  ];
  if (waits.length === 0) return null;
  const waitsOn = text({ id: "project-table-waits-on" });
  return (
    <span className="ticket-list-dependencies" aria-label={waitsOn}>
      <Tooltip trigger="abbreviation" text={waitsOn}>
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

/** The row's owner where it is not its creator, after an arrow from them. */
function TicketListOwner(props: {
  readonly owner: string | undefined;
  readonly creatorEmails: ReadonlyMap<string, string>;
}): ReactNode {
  const text = useCopyText();
  if (props.owner === undefined) return null;
  return (
    <>
      <span aria-hidden="true">{" → "}</span>
      <span className="visually-hidden">
        {` ${text({ id: "project-table-owner-label" })} `}
      </span>
      <Identity label={creatorLabel(props.owner, props.creatorEmails)} />
    </>
  );
}

/** Who filed the row and who owns it where that is someone else, drawn in the
 * meta where the list is wide and in the foot where it is narrow; the sheet
 * shows one of the two. */
function TicketListCreator(props: {
  readonly row: ProjectTableRow;
  readonly creatorEmails: ReadonlyMap<string, string>;
  readonly className: string;
}): ReactNode {
  const { creator, owner } = props.row;
  if (creator === undefined && owner === undefined) return null;
  return (
    <span className={props.className}>
      {creator === undefined ? null : (
        <Identity label={creatorLabel(creator, props.creatorEmails)} />
      )}
      <TicketListOwner owner={owner} creatorEmails={props.creatorEmails} />
    </span>
  );
}

/** What the row waits on, and the epics it belongs to, where it has either. */
function ticketListWaits(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const row = props.row;
  if (
    row.openDependencies.length === 0 &&
    row.revokedDependencies.length === 0 &&
    (row.epics ?? []).length === 0
  )
    return undefined;
  return (
    <span className="ticket-list-trail">
      <TicketListDependencies row={row} standings={props.standings} />
      <EpicChips partition={props.partition} epics={row.epics} />
    </span>
  );
}

/** The row's foot: who filed it where the list is narrow, then its place in a
 * landing queue just before its state, which a ready row's dispatch is. */
function TicketListFoot(props: {
  readonly row: ProjectTableRow;
  readonly partition: PartitionIdentity;
  readonly creatorEmails: ReadonlyMap<string, string>;
  readonly queues: LandingQueuesResponse | undefined;
}): ReactNode {
  const row = props.row;
  const queued = (
    <LandingQueueChip place={landingQueuePlaceOf(props.queues, row.ticket)} />
  );
  return (
    <>
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
              <span className="ticket-list-foot-standing">
                {queued}
                <TicketListState row={row} dispatch={dispatch} look="Badge" />
              </span>
            </>
          )}
        </TicketRowDispatchScope>
      ) : (
        <span className="ticket-list-foot-standing">
          {queued}
          <TicketListState row={row} look="Badge" />
        </span>
      )}
    </>
  );
}

export function TicketListRow(props: {
  readonly row: ProjectTableRow;
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly creatorEmails: ReadonlyMap<string, string>;
  /** The project's landing queues, where the page holds them. */
  readonly queues: LandingQueuesResponse | undefined;
}): ReactNode {
  const row = props.row;
  return (
    <RecordRow
      title={row.title ?? cellAbsent}
      link={{
        to: "/$tenant/$project/tickets/$ticket",
        params: { ...props.partition, ticket: String(row.ticket) },
      }}
      level={3}
      meta={
        <>
          <span className="ticket-list-number">{`#${String(row.ticket)}`}</span>
          <span className="ticket-list-activity">
            <TicketActivity activityAt={row.activityAt} nowMs={props.nowMs} />
          </span>
          <TicketListEscalation row={row} />
          <TicketListRepository row={row} />
          <TicketListCreator
            row={row}
            creatorEmails={props.creatorEmails}
            className="ticket-list-creator"
          />
        </>
      }
      trailing={ticketListWaits(props)}
      foot={
        <TicketListFoot
          row={row}
          partition={props.partition}
          creatorEmails={props.creatorEmails}
          queues={props.queues}
        />
      }
    />
  );
}

const ticketListDependencyGlyph = (
  <ListGlyph>
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="11.5" cy="12" r="1.75" />
    <path d="M4.5 5.25v9.25M4.5 5.25c0 3.5 2.75 6.75 5.25 6.75" />
  </ListGlyph>
);

/** What the State field offers past All: every phase, Pending followed by
 * the standings it narrows to. */
const ticketListFilterChoices: readonly Exclude<
  TicketFilter,
  typeof ticketFilterAll
>[] = phaseRoster.flatMap((phase) =>
  phase === "Pending" ? [phase, ...ticketFilterStandings] : [phase],
);

function ticketListFilterText(
  filter: Exclude<TicketFilter, typeof ticketFilterAll>,
  text: CopyText,
): string {
  return ticketFilterIsStanding(filter) ? filter : text(phaseLabel(filter));
}

/** Anyone, as the Creator and Owner fields hold it, which no principal is. */
const ticketListMemberAnyone = "";

/** What each of the Filter control's narrowings is labelled, in its field and its mark. */
const ticketListFilterLabels = {
  filter: { id: "project-table-state-label" },
  creator: { id: "project-table-creator-label" },
  owner: { id: "project-table-owner-label" },
} as const satisfies Record<TicketListFilterActive["kind"], Copy>;

/** How a member is named in the Creator and Owner fields and their marks: the
 * reader as Me, anyone else as their row's creator is. */
function useTicketListMemberText(
  partition: PartitionIdentity,
): (principal: string) => string {
  const text = useCopyText();
  const reader = useProjectAbilities(partition)?.principal;
  const creatorEmails = useCreatorEmails(partition);
  return (principal) =>
    principal === reader
      ? text({ id: "project-table-creator-me" })
      : creatorLabel(principal, creatorEmails).text;
}

/** Who filed, or who owns, the tickets the list holds: anyone, the reader,
 * or one of the project's people. */
function TicketListMemberField(props: {
  readonly member: "creator" | "owner";
  readonly partition: PartitionIdentity;
  readonly query: TicketListQuery;
  readonly onQuery: (query: TicketListQuery) => void;
}): ReactNode {
  const text = useCopyText();
  const chosen = props.query[props.member];
  const reader = useProjectAbilities(props.partition)?.principal;
  const people = useProjectPeople(props.partition);
  const memberText = useTicketListMemberText(props.partition);
  const offered = ticketListCreatorsOffered(
    reader,
    people.state === "Ready"
      ? people.value.people.map((person) => person.subject)
      : [],
    chosen,
  );
  return (
    <Select
      label={text(ticketListFilterLabels[props.member])}
      labelShown
      value={chosen ?? ticketListMemberAnyone}
      options={[
        {
          value: ticketListMemberAnyone,
          text: text({ id: "project-table-creator-anyone" }),
        },
        ...(reader === undefined ? [] : [reader]).map((principal) => ({
          value: principal,
          text: memberText(principal),
        })),
        ...offered.map((principal) => ({
          value: principal,
          text: memberText(principal),
        })),
      ]}
      onChange={(picked) => {
        const member = picked === ticketListMemberAnyone ? undefined : picked;
        props.onQuery(
          ticketListQueryWith(
            props.query,
            props.member === "creator"
              ? { creator: member }
              : { owner: member },
          ),
        );
      }}
    />
  );
}

function TicketListSortPicker(props: {
  readonly sort: TicketListSort;
  readonly onSort: (sort: TicketListSort) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Picker
      label={text({ id: "project-table-sort-label" })}
      iconOnly
      glyph={listSortGlyph}
      value={props.sort}
      options={ticketListSorts.map((sort) => ({
        value: sort,
        text: text(ticketListSortTitles[sort]),
      }))}
      onChoose={(chosen) => {
        props.onSort(ticketListSortOf(chosen));
      }}
      align="end"
    />
  );
}

/** The state the list holds: every ticket, one phase, or one of Pending's
 * standings. */
function TicketListStateField(props: {
  readonly filter: TicketFilter;
  readonly onFilter: (filter: TicketFilter) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Select
      label={text(ticketListFilterLabels.filter)}
      labelShown
      value={props.filter}
      options={[
        {
          value: ticketFilterAll,
          text: text({ id: "project-table-filter-all" }),
        },
        ...ticketListFilterChoices.map((filter) => ({
          value: filter,
          text: ticketListFilterText(filter, text),
        })),
      ]}
      onChange={(chosen) => {
        props.onFilter(ticketListFilterOf(chosen));
      }}
    />
  );
}

/** Everything the Filter control and the marks under the bar are drawn from. */
interface TicketListFilters {
  readonly filter: TicketFilter;
  readonly onFilter: (filter: TicketFilter) => void;
  /** Takes away every narrowing the Filter control holds. */
  readonly onFiltersCleared: () => void;
  readonly partition: PartitionIdentity;
  readonly query: TicketListQuery;
  readonly onQuery: (query: TicketListQuery) => void;
}

/** A mark for each narrowing the Filter control holds, each taking it away. */
function useTicketListMarks(
  filters: TicketListFilters,
): readonly ListFilterMark[] {
  const text = useCopyText();
  const memberText = useTicketListMemberText(filters.partition);
  return ticketListFiltersActive({
    filter: filters.filter,
    creator: filters.query.creator,
    owner: filters.query.owner,
  }).map((active) => ({
    key: active.kind,
    field: text(ticketListFilterLabels[active.kind]),
    value:
      active.kind === "filter"
        ? ticketListFilterText(active.filter, text)
        : memberText(active.principal),
    onRemove: () => {
      if (active.kind === "filter") filters.onFilter(ticketFilterAll);
      else filters.onQuery(ticketListQueryWithout(filters.query, active.kind));
    },
  }));
}

/** The bar over the list: the search, the one Filter control holding the
 * state, the creator and the owner, and the sort; and under it a mark for
 * each of those that is set. */
function TicketListControls(
  props: TicketListFilters & {
    readonly search: string;
    readonly onSearch: (search: string) => void;
    readonly sort: TicketListSort;
    readonly onSort: (sort: TicketListSort) => void;
    /** Whether the page is wide, where the panel is a popover. */
    readonly wide: boolean;
  },
): ReactNode {
  const text = useCopyText();
  const marks = useTicketListMarks(props);
  return (
    <>
      <ListControls>
        <ListSearch
          label={text({ id: "project-table-search" })}
          placeholder={text({ id: "project-table-search-placeholder" })}
          search={props.search}
          onSearch={props.onSearch}
        />
        <ListFilter
          label={text({ id: "project-table-filter-label" })}
          wide={props.wide}
          marks={marks}
          onClear={props.onFiltersCleared}
        >
          <TicketListStateField
            filter={props.filter}
            onFilter={props.onFilter}
          />
          <TicketListMemberField
            member="creator"
            partition={props.partition}
            query={props.query}
            onQuery={props.onQuery}
          />
          <TicketListMemberField
            member="owner"
            partition={props.partition}
            query={props.query}
            onQuery={props.onQuery}
          />
        </ListFilter>
        <TicketListSortPicker sort={props.sort} onSort={props.onSort} />
      </ListControls>
      <ListFilterMarks
        label={text({ id: "project-table-filters-set" })}
        marks={marks}
      />
    </>
  );
}

/** How many tickets a search matched, and, where that is a count of the rows
 * read while pages remain, that it is of those read so far. */
function ticketListStatusMatched(
  matched: number,
  soFar: boolean,
  text: CopyText,
): string {
  return text({
    id: soFar
      ? "project-table-status-matched-so-far"
      : "project-table-status-matched",
    args: { matched },
  });
}

/** One line under the controls where the list needs one: how many tickets a
 * search, a creator or an owner matched, across the project or, under a standing the server cannot
 * count, among the rows drawn; or that the list draws none, of the tickets
 * there are or, while pages remain, of those read so far. */
function ticketListStatus(
  rows: ProjectTicketRows,
  filter: TicketFilter,
  narrowed: boolean,
  shown: number,
  text: CopyText,
): string | undefined {
  if (narrowed && ticketFilterIsStanding(filter))
    return ticketListStatusMatched(
      shown,
      projectTicketRowsHaveMore(rows),
      text,
    );
  if (narrowed)
    return rows.matched === undefined
      ? undefined
      : ticketListStatusMatched(rows.matched, false, text);
  if (shown > 0) return undefined;
  return rows.tickets.length > 0 && projectTicketRowsHaveMore(rows)
    ? text({ id: "project-table-status-none-in-state" })
    : text({ id: "project-table-status-none-active" });
}

/** How many skeleton rows stand where a read's rows will be. */
const ticketListSkeletonRowsCount = 3;

/** Rows standing where a read's rows will be, until it is read. */
function TicketListSkeleton(): ReactNode {
  return Array.from({ length: ticketListSkeletonRowsCount }, (_, index) => (
    <RecordRowSkeleton key={index} />
  ));
}

/** The one line under the controls, and, where the list draws no row, the
 * way to the next page while there is one, and the way back to every ticket
 * where the reader narrowed it to none. */
function TicketListStatus(props: {
  readonly status: string | undefined;
  readonly more: RecordListMore | undefined;
  readonly onClear: (() => void) | undefined;
}): ReactNode {
  const text = useCopyText();
  const { more, onClear } = props;
  if (props.status === undefined && more === undefined) return null;
  return (
    <div className="ticket-list-status">
      {props.status === undefined ? null : <p role="status">{props.status}</p>}
      {more === undefined ? null : (
        <Button onClick={more.onMore}>{more.label}</Button>
      )}
      {onClear === undefined ? null : (
        <Button variant="quiet" size="sm" onClick={onClear}>
          {text({ id: "project-table-clear-filters" })}
        </Button>
      )}
    </div>
  );
}

/** The rows drawn, as one list, and skeleton rows after them while a further
 * page is read. */
function TicketListRecords(props: {
  readonly shown: readonly ProjectTableRow[];
  readonly standings: ReadonlyMap<number, TicketListStanding>;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly more: RecordListMore | undefined;
  readonly reading: boolean;
}): ReactNode {
  const text = useCopyText();
  const creatorEmails = useCreatorEmails(props.partition);
  const queues = useLandingQueues(props.partition);
  return (
    <RecordList
      label={text({ id: "project-table-aria-tickets" })}
      more={props.more}
    >
      {props.shown.map((row) => (
        <TicketListRow
          key={row.ticket}
          row={row}
          standings={props.standings}
          partition={props.partition}
          nowMs={props.nowMs}
          creatorEmails={creatorEmails}
          queues={queues}
        />
      ))}
      {props.reading ? <TicketListSkeleton /> : null}
    </RecordList>
  );
}

/** The rows the list's read holds that its filter draws, in the order the sort
 * asks for: skeleton rows while the first read, or a further page, is read,
 * and the one line a read that failed is drawn as. A dependency reads its
 * standing from every row held, drawn or not. */
function TicketListRows(props: {
  readonly state: PanelState<ProjectTicketRows>;
  readonly filter: TicketFilter;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly sort: TicketListSort;
  /** The server narrowed the read, by a search, a creator or an owner. */
  readonly narrowed: boolean;
  readonly readMore: (() => void) | undefined;
  /** A further page is being read. */
  readonly reading: boolean;
  /** Clears the filter, the search, the creator and the owner. */
  readonly onClear: () => void;
}): ReactNode {
  const text = useCopyText();
  const state = props.state;
  if (state.state === "Pending")
    return (
      <RecordList label={text({ id: "panel-loading" })}>
        <TicketListSkeleton />
      </RecordList>
    );
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
    props.narrowed,
    shown.length,
    text,
  );
  const more =
    props.readMore === undefined
      ? undefined
      : {
          label: text({ id: "project-table-show-more" }),
          onMore: props.readMore,
        };
  const drawsRows = shown.length > 0 || props.reading;
  return (
    <>
      <TicketListStatus
        status={status}
        more={drawsRows ? undefined : more}
        onClear={
          !drawsRows && (props.narrowed || props.filter !== ticketFilterAll)
            ? props.onClear
            : undefined
        }
      />
      {!drawsRows ? null : (
        <TicketListRecords
          shown={shown}
          standings={standings}
          partition={props.partition}
          nowMs={props.nowMs}
          more={more}
          reading={props.reading}
        />
      )}
    </>
  );
}

function ProjectTableTitle(): ReactNode {
  const text = useCopyText();
  return <ScreenTitle>{text({ id: "project-table-title" })}</ScreenTitle>;
}

/** The page's section, holding the list or the line that stands for it,
 * drawn knowing whether the section is wide, which is the width the bar is
 * laid out against. */
function ProjectTableSection(props: {
  readonly partition: PartitionIdentity;
  readonly children: (wide: boolean) => ReactNode;
}): ReactNode {
  const text = useCopyText();
  const [held, wide] = useElementAtLeastEm(viewportNarrowEm);
  return (
    <section
      ref={held}
      className="ticket-list-page"
      aria-label={text({ id: "project-table-aria-tickets" })}
      data-fills-width
    >
      <ProjectTableTitle />
      <RepositoryImportRefusedNotice partition={props.partition} />
      {props.children(wide === true)}
    </section>
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
    cleared: (): void => {
      persistentStore.write(ticketListFilterStoreKey, ticketFilterAll);
      onQuery(ticketListQueryCleared(query));
    },
    filtersCleared: (): void => {
      persistentStore.write(ticketListFilterStoreKey, ticketFilterAll);
      onQuery(ticketListQueryFiltersCleared(query));
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

/** Everything the page needs before it draws: the partition, the filter,
 * sort and search the address and this browser's own keeping agree on, and
 * the rows under them. */
function useProjectTableState(props: {
  readonly query: TicketListQuery;
  readonly onQuery: (query: TicketListQuery) => void;
}): {
  readonly partition: PartitionIdentity;
  readonly choices: ReturnType<typeof useTicketListFilter>;
  readonly typed: string;
  readonly setTyped: (typed: string) => void;
  readonly sort: TicketListSort;
  readonly ask: TicketListAsk;
  readonly tickets: TicketRowsHeld;
  readonly nowMs: number;
} {
  const partition = useParams({ from: "/$tenant/$project" });
  const choices = useTicketListFilter(props.query, props.onQuery);
  const [typed, setTyped] = useTicketListTyped(props.query, props.onQuery);
  const sort = ticketListSortOf(props.query.sort);
  const ask: TicketListAsk = {
    filter: choices.filter,
    order: ticketListSortOrder(sort),
    search: props.query.q,
    creator: props.query.creator,
    owner: props.query.owner,
  };
  const tickets = useTicketRows(partition, ask);
  return {
    partition,
    choices,
    typed,
    setTyped,
    sort,
    ask,
    tickets,
    nowMs: useNowMs(),
  };
}

/** A further page that could not be read, beside the rows that were. */
function ProjectTableMoreFailed(props: {
  readonly failure: ApiFailure | undefined;
}): ReactNode {
  const text = useCopyText();
  return props.failure === undefined ? null : (
    <ReadFailed
      subject={text({ id: "project-table-more-failed" })}
      failure={props.failure}
    />
  );
}

export function ProjectTable(props: {
  readonly query: TicketListQuery;
  readonly onQuery: (query: TicketListQuery) => void;
}): ReactNode {
  const text = useCopyText();
  const { partition, choices, typed, setTyped, sort, ask, tickets, nowMs } =
    useProjectTableState(props);
  if (
    tickets.state.state === "Ready" &&
    !tickets.kept &&
    ticketFilterProjectEmpty(ask, tickets.state.value)
  )
    return (
      <ProjectTableSection partition={partition}>
        {() => <EmptyState label={text({ id: "project-table-empty" })} />}
      </ProjectTableSection>
    );
  const partialFailure =
    tickets.state.state === "Ready" ? tickets.state.value.failure : undefined;
  return (
    <ProjectTableSection partition={partition}>
      {(wide) => (
        <>
          <TicketListControls
            wide={wide}
            search={typed}
            onSearch={setTyped}
            sort={sort}
            onSort={(next) => {
              props.onQuery(ticketListQueryWith(props.query, { sort: next }));
            }}
            filter={choices.filter}
            onFilter={choices.filtered}
            onFiltersCleared={choices.filtersCleared}
            partition={partition}
            query={props.query}
            onQuery={props.onQuery}
          />
          <ProjectTableMoreFailed failure={partialFailure} />
          <TicketListRows
            state={tickets.state}
            filter={choices.filter}
            partition={partition}
            nowMs={nowMs}
            sort={sort}
            narrowed={ticketListAskNarrowed(ask)}
            readMore={tickets.readMore}
            reading={tickets.reading}
            onClear={choices.cleared}
          />
        </>
      )}
    </ProjectTableSection>
  );
}
