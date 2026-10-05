/**
 * The project table: the first screen inside a project, and the only one that
 * answers "what needs me, what is moving, what is next".
 *
 * The tickets and what they ran are two reads under two keys, so a `Ticket`
 * frame moves a row between sections and an `Execution` frame changes one row's
 * status column without either disturbing the other. Each section is its own
 * panel over the same read, so every caption states the one instant the rows
 * were observed at. The unfiltered view draws only the sections holding a
 * ticket, and a project holding none at all offers the first instead.
 *
 * A read gathers as many pages as the reader had asked for, because the entry
 * it writes is under the partition prefix that the degraded stream's fallback
 * and a `Project` frame both invalidate; rebuilding it from the first page
 * would take a reader's pages away on a timer. "More" appends one page to the
 * entry instead of reading them all again.
 *
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { apiProject } from "../core/apiRoutes.ts";
import { phaseLabel } from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectExecutionIndexUnread } from "../core/projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "../core/projectExecutionIndex.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterMoreCursor,
  ticketFilterPage,
  ticketFilterProjectEmpty,
  ticketFilterSections,
} from "../core/projectTableFilters.ts";
import type { TicketFilter } from "../core/projectTableFilters.ts";
import {
  projectTableRows,
  projectTableRowsIn,
} from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import {
  projectTicketRowsAfterPage,
  projectTicketRowsRead,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import {
  ticketSectionRoster,
  ticketSectionTitles,
} from "../core/ticketSections.ts";
import type { TicketSection } from "../core/ticketSections.ts";
import { phaseTone } from "../core/tones.ts";
import { useApiPorts, usePanelList } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useProjectExecutionIndex } from "./executionIndex.ts";
import { Freshness, useNowMs } from "./Freshness.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import {
  ticketRowExecutionCell,
  TicketActivity,
  TicketRowExecutionCell,
  TicketTitleNumber,
  TicketTitleWords,
} from "./TicketCells.tsx";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Pill } from "./ui/Pill.tsx";
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
  filter: TicketFilter,
): Promise<ApiResult<ProjectTicketRows>> {
  const key = ticketFilterList(partition, filter).key;
  return projectTicketRowsRead(
    client.getQueryData<ProjectTicketRows>(key),
    (cursor) => apiProject(ports, partition, ticketFilterPage(filter, cursor)),
  );
}

/** The rows for one filter, the fold that keeps them live, and the read that
 * appends the next page to them. */
function useTicketRows(
  partition: PartitionIdentity,
  filter: TicketFilter,
): TicketRowsHeld {
  const list = ticketFilterList(partition, filter);
  const key = list.key;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const state = usePanelList(list, (at) =>
    ticketRowsRead(client, at, partition, filter),
  );
  const rows = state.state === "Ready" ? state.value : undefined;
  const cursor = rows === undefined ? undefined : ticketFilterMoreCursor(rows);
  const readMore = () => {
    setReading(true);
    void (async () => {
      const answered = await apiProject(
        ports,
        partition,
        ticketFilterPage(filter, cursor),
      );
      client.setQueryData<ProjectTicketRows>(key, (previous) =>
        previous === undefined
          ? previous
          : projectTicketRowsAfterPage(previous, answered),
      );
      setReading(false);
    })();
  };
  return {
    state,
    readMore: cursor === undefined || reading ? undefined : readMore,
    reading,
  };
}

function TicketCard(props: {
  readonly row: ProjectTableRow;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const row = props.row;
  return (
    <li className="overview-card flex flex-col gap-2 rounded-3 border border-edge bg-surface-1 p-3">
      <div className="overview-card-title text-lg text-ink-1 wrap-anywhere">
        <TicketTitleWords
          partition={props.partition}
          ticket={row.ticket}
          title={row.title}
        />
        <TicketTitleNumber partition={props.partition} ticket={row.ticket} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Tooltip text={row.badge}>
          <span>
            <Pill tone={phaseTone(row.phase)}>{phaseLabel(row.phase)}</Pill>
          </span>
        </Tooltip>
        <TicketRowExecutionCell row={row} />
        {row.runsOn === undefined ? (
          <span className="text-ink-3">
            {ticketRowExecutionCell(row, undefined)}
          </span>
        ) : (
          <Pill tone="neutral">
            <Tooltip text={row.runsOn.title}>
              <span className="max-w-aside inline-block truncate align-bottom">
                {row.runsOn.text}
              </span>
            </Tooltip>
          </Pill>
        )}
        <span className="text-ink-3">
          <TicketActivity activityAt={row.activityAt} nowMs={props.nowMs} />
        </span>
      </div>
    </li>
  );
}

function TicketCards(props: {
  readonly rows: readonly ProjectTableRow[];
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  return (
    <ul className="flex flex-col gap-2">
      {props.rows.map((row) => (
        <TicketCard
          key={row.ticket}
          row={row}
          partition={props.partition}
          nowMs={props.nowMs}
        />
      ))}
    </ul>
  );
}

/** One section of the rows. An empty one, which only a filtered view draws,
 * says None and carries no caption, there being no row it dates. */
function TicketSectionPanel(props: {
  readonly section: TicketSection;
  readonly rows: readonly ProjectTableRow[];
  readonly observedAtMs: number | undefined;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const drawn = projectTableRowsIn(props.rows, props.section);
  return (
    <Panel
      title={ticketSectionTitles[props.section]}
      meta={
        drawn.length === 0 ? undefined : (
          <Freshness observedAtMs={props.observedAtMs} />
        )
      }
    >
      {drawn.length === 0 ? (
        <EmptyState label="None" />
      ) : (
        <TicketCards
          rows={drawn}
          partition={props.partition}
          nowMs={props.nowMs}
        />
      )}
    </Panel>
  );
}

/** The sections the filter draws over one read, or the one line a read that
 * is not ready is drawn as. */
function TicketSectionPanels(props: {
  readonly filter: TicketFilter;
  readonly state: PanelState<ProjectTicketRows>;
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const state = props.state;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const rows = projectTableRows(state.value.tickets, props.index);
  const sections = ticketFilterSections(props.filter, rows);
  if (sections.length === 0) return <EmptyState label="None" />;
  return sections.map((section) => (
    <TicketSectionPanel
      key={section}
      section={section}
      rows={rows}
      observedAtMs={state.observedAtMs}
      partition={props.partition}
      nowMs={props.nowMs}
    />
  ));
}

function TicketFilters(props: {
  readonly filter: TicketFilter;
  readonly onChange: (filter: TicketFilter) => void;
}): ReactNode {
  const filters: readonly TicketFilter[] = [
    ticketFilterAll,
    ...ticketSectionRoster,
  ];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="phase">
      {filters.map((filter) => (
        <Button
          key={filter}
          size="sm"
          pressed={filter === props.filter}
          onClick={() => {
            props.onChange(filter);
          }}
        >
          {filter === ticketFilterAll ? "All" : ticketSectionTitles[filter]}
        </Button>
      ))}
    </div>
  );
}

function ProjectTableTitle(): ReactNode {
  return (
    <TopBarSlot>
      <h1 className="text-md font-strong text-ink-1 truncate">Overview</h1>
    </TopBarSlot>
  );
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
 * the one way to make the first. */
function ProjectTableEmpty(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <>
      <ProjectTableTitle />
      <EmptyState
        variant="page"
        label="No tickets"
        action={<ProjectTableNewTicket partition={props.partition} />}
      />
    </>
  );
}

export function ProjectTable(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [filter, setFilter] = useState<TicketFilter>(ticketFilterAll);
  const tickets = useTicketRows(partition, filter);
  const executions = useProjectExecutionIndex(partition);
  const nowMs = useNowMs();
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexUnread;
  if (
    tickets.state.state === "Ready" &&
    ticketFilterProjectEmpty(filter, tickets.state.value)
  )
    return <ProjectTableEmpty partition={partition} />;
  const partialFailure =
    tickets.state.state === "Ready" ? tickets.state.value.failure : undefined;
  return (
    <>
      <ProjectTableTitle />
      <div className="flex items-center gap-4">
        <TicketFilters filter={filter} onChange={setFilter} />
        <ProjectTableNewTicket partition={partition} />
      </div>
      {executions.state === "Failed" ? (
        <p className="panel-failed">
          what each ticket ran could not be read — {executions.reason}
        </p>
      ) : null}
      {executions.state === "Ready" && index.truncated ? (
        <p className="panel-absent">
          the index of what each ticket ran was truncated at its page budget, so
          the rows it did not reach say “not read” rather than nothing
        </p>
      ) : null}
      {partialFailure === undefined ? null : (
        <p className="panel-failed">
          a further page could not be read — {partialFailure}
        </p>
      )}
      <TicketSectionPanels
        filter={filter}
        state={tickets.state}
        index={index}
        partition={partition}
        nowMs={nowMs}
      />
      {tickets.readMore === undefined ? null : (
        <div>
          <Button size="sm" onClick={tickets.readMore}>
            more
          </Button>
        </div>
      )}
      {tickets.reading ? <p className="panel-note">reading…</p> : null}
    </>
  );
}
