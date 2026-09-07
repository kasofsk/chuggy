/**
 * The project table: the first screen inside a project, and the only one that
 * answers "what needs me, what is moving, what is next".
 *
 * The tickets and what they ran are two reads under two keys, so a `Ticket`
 * frame moves a row between sections and an `Execution` frame changes one row's
 * status column without either disturbing the other. Each section is its own
 * panel over the same read, so the five captions state one instant — the one
 * the rows were observed at — rather than five.
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
import type { PanelState } from "../core/freshness.ts";
import { projectExecutionIndexUnread } from "../core/projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "../core/projectExecutionIndex.ts";
import {
  ticketFilterAll,
  ticketFilterList,
  ticketFilterMoreCursor,
  ticketFilterPage,
} from "../core/projectTableFilters.ts";
import type { TicketFilter } from "../core/projectTableFilters.ts";
import {
  projectTableExecutionPhrase,
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
import { useApiPorts, usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { useProjectExecutionIndex } from "./executionIndex.ts";
import { TopBarSlot } from "./shell/slots.tsx";
import {
  cellAbsent,
  ticketRowExecutionCell,
  TicketNumberCell,
  TicketTitleCell,
} from "./TicketCells.tsx";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

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

function TicketRow(props: {
  readonly row: ProjectTableRow;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const row = props.row;
  const status = projectTableExecutionPhrase(row);
  return (
    <tr>
      <TicketNumberCell partition={props.partition} ticket={row.ticket} />
      <TicketTitleCell
        partition={props.partition}
        ticket={row.ticket}
        title={row.title}
      />
      <td>{row.phase}</td>
      <td>
        {row.badge === undefined ? (
          <span className="text-ink-3">{cellAbsent}</span>
        ) : (
          <Pill tone="parked">{row.badge}</Pill>
        )}
      </td>
      <td>{ticketRowExecutionCell(row, status)}</td>
      <td className="text-ink-3">
        <Tooltip text={row.runsOn?.title}>
          <span className="max-w-aside inline-block truncate align-bottom">
            {ticketRowExecutionCell(row, row.runsOn?.text)}
          </span>
        </Tooltip>
      </td>
      <td className="text-ink-3">
        {row.sequence}
        {row.activityAt === undefined ? "" : ` · ${row.activityAt}`}
      </td>
    </tr>
  );
}

function TicketTable(props: {
  readonly caption: string;
  readonly rows: readonly ProjectTableRow[];
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <Table caption={props.caption}>
      <thead>
        <tr>
          <th scope="col">ticket</th>
          <th scope="col">title</th>
          <th scope="col">phase</th>
          <th scope="col">why</th>
          <th scope="col">execution</th>
          <th scope="col">runs on</th>
          <th scope="col">last activity</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <TicketRow key={row.ticket} row={row} partition={props.partition} />
        ))}
      </tbody>
    </Table>
  );
}

function TicketSectionPanel(props: {
  readonly section: TicketSection;
  readonly state: PanelState<ProjectTicketRows>;
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const title = ticketSectionTitles[props.section];
  return (
    <DataPanel title={title} state={props.state}>
      {(rows) => {
        const drawn = projectTableRowsIn(
          projectTableRows(rows.tickets, props.index),
          props.section,
        );
        return drawn.length === 0 ? (
          <p className="panel-note">no ticket is here</p>
        ) : (
          <TicketTable
            caption={title}
            rows={drawn}
            partition={props.partition}
          />
        );
      }}
    </DataPanel>
  );
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
          {filter === ticketFilterAll ? "all" : ticketSectionTitles[filter]}
        </Button>
      ))}
    </div>
  );
}

export function ProjectTable(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [filter, setFilter] = useState<TicketFilter>(ticketFilterAll);
  const tickets = useTicketRows(partition, filter);
  const executions = useProjectExecutionIndex(partition);
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexUnread;
  const sections: readonly TicketSection[] =
    filter === ticketFilterAll ? ticketSectionRoster : [filter];
  const partialFailure =
    tickets.state.state === "Ready" ? tickets.state.value.failure : undefined;
  return (
    <>
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Overview</h1>
      </TopBarSlot>
      <div className="flex items-center gap-4">
        <TicketFilters filter={filter} onChange={setFilter} />
        <ButtonLink to="/$tenant/$project/tickets/new" params={partition}>
          New ticket
        </ButtonLink>
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
      {sections.map((section) => (
        <TicketSectionPanel
          key={section}
          section={section}
          state={tickets.state}
          index={index}
          partition={partition}
        />
      ))}
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
