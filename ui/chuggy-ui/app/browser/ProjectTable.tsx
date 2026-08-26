/**
 * The project table: the first screen inside a project, and the only one that
 * answers "what needs me, what is moving, what is next".
 *
 * The tickets and what they are running are two reads under two keys, so a
 * `Ticket` frame moves a row between sections and an `Execution` frame changes
 * one row's status column without either disturbing the other. Each section is
 * its own panel over the same read, which is what gives every heading its own
 * freshness caption; paging writes the next page into the same entry rather
 * than reading the earlier ones again, so the rows a reader has do not
 * disappear while the next page is in flight.
 *
 * There is no dispatch control here, deliberately: dispatch is the selector's.
 */

import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiExecutions, apiProject } from "../core/apiRoutes.ts";
import type { ProjectPage } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  projectExecutionIndexEmpty,
  projectExecutionIndexFold,
  projectExecutionIndexOf,
} from "../core/projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "../core/projectExecutionIndex.ts";
import { projectListKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import {
  projectTableRows,
  projectTableRowsIn,
} from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import {
  projectTicketRowsAfterPage,
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
  projectTicketRowsFold,
  projectTicketRowsHaveMore,
} from "../core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../core/projectTicketPages.ts";
import {
  ticketSectionPhases,
  ticketSectionRoster,
  ticketSectionTitles,
} from "../core/ticketSections.ts";
import type { TicketSection } from "../core/ticketSections.ts";
import { useApiPorts, usePanelQuery } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { useProjectListFold } from "./stream.tsx";

export type TicketFilter = TicketSection | "All";

const ticketFilterAll = "All";

const emDash = "—";

function ticketFilterKey(
  partition: PartitionIdentity,
  filter: TicketFilter,
): ProjectQueryKey {
  return projectListKey(partition, "Ticket", `table:${filter}`);
}

function ticketFilterPage(
  filter: TicketFilter,
  cursor: string | undefined,
): ProjectPage {
  return {
    order: "RecentActivity",
    ...(cursor === undefined ? {} : { cursor }),
    ...(filter === ticketFilterAll
      ? {}
      : { phase: ticketSectionPhases(filter) }),
  };
}

interface TicketRowsHeld {
  readonly state: PanelState<ProjectTicketRows>;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/** The rows for one filter, the fold that keeps them live, and the read that
 * appends the next page to them. */
function useTicketRows(
  partition: PartitionIdentity,
  filter: TicketFilter,
): TicketRowsHeld {
  const key = ticketFilterKey(partition, filter);
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const state = usePanelQuery<ProjectTicketRows>(key, async (at) => {
    const answered = await apiProject(
      at,
      partition,
      ticketFilterPage(filter, undefined),
    );
    if (answered.outcome !== "Ok") return answered;
    return {
      outcome: "Ok",
      value: projectTicketRowsAppend(projectTicketRowsEmpty, answered.value),
    };
  });
  useProjectListFold("Ticket", key, (previous, change) =>
    projectTicketRowsFold(
      previous as ProjectTicketRows | undefined,
      change.resource,
      change.representation,
      filter === ticketFilterAll ? undefined : ticketSectionPhases(filter),
    ),
  );
  const rows = state.state === "Ready" ? state.value : undefined;
  const cursor =
    rows !== undefined && projectTicketRowsHaveMore(rows)
      ? rows.nextCursor
      : undefined;
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

/** What every ticket is running now, folded by execution frames as they land. */
function useExecutionIndex(
  partition: PartitionIdentity,
): PanelState<ProjectExecutionIndex> {
  const key = projectListKey(partition, "Execution", "running");
  const state = usePanelQuery<ProjectExecutionIndex>(key, async (at) => {
    const answered = await apiExecutions(at, partition, {
      state: "NonTerminal",
    });
    if (answered.outcome !== "Ok") return answered;
    return {
      outcome: "Ok",
      value: projectExecutionIndexOf(answered.value.executions),
    };
  });
  useProjectListFold("Execution", key, (previous, change) =>
    projectExecutionIndexFold(
      previous as ProjectExecutionIndex | undefined,
      change.representation,
    ),
  );
  return state;
}

function TicketRow(props: {
  readonly row: ProjectTableRow;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const row = props.row;
  const execution =
    row.executionStatus === undefined
      ? emDash
      : `${row.executionStatus}${row.executionOutcome === undefined ? "" : ` · ${row.executionOutcome}`}`;
  return (
    <tr>
      <th scope="row">
        <Link
          to="/$tenant/$project/tickets/$ticket"
          params={{ ...props.partition, ticket: String(row.ticket) }}
        >
          {row.ticket}
        </Link>
      </th>
      <td className="cell-dim">{row.configurationRevision ?? emDash}</td>
      <td>{row.phase}</td>
      <td>
        {row.badge === undefined ? (
          <span className="cell-dim">{emDash}</span>
        ) : (
          <span className="badge">{row.badge}</span>
        )}
      </td>
      <td>{execution}</td>
      <td className="cell-dim">{row.runsOn ?? emDash}</td>
      <td className="cell-dim">
        {row.sequence}
        {row.activityAt === undefined ? "" : ` · ${row.activityAt}`}
      </td>
    </tr>
  );
}

function TicketTable(props: {
  readonly rows: readonly ProjectTableRow[];
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <table className="ticket-table">
      <thead>
        <tr>
          <th scope="col">ticket</th>
          <th scope="col">configuration</th>
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
    </table>
  );
}

function TicketSectionPanel(props: {
  readonly section: TicketSection;
  readonly state: PanelState<ProjectTicketRows>;
  readonly index: ProjectExecutionIndex;
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <Panel title={ticketSectionTitles[props.section]} state={props.state}>
      {(rows) => {
        const drawn = projectTableRowsIn(
          projectTableRows(rows.tickets, props.index),
          props.section,
        );
        return drawn.length === 0 ? (
          <p className="panel-note">no ticket is here</p>
        ) : (
          <TicketTable rows={drawn} partition={props.partition} />
        );
      }}
    </Panel>
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
    <div className="filters" role="group" aria-label="phase">
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          className={filter === props.filter ? "here" : ""}
          aria-pressed={filter === props.filter}
          onClick={() => {
            props.onChange(filter);
          }}
        >
          {filter === ticketFilterAll ? "all" : ticketSectionTitles[filter]}
        </button>
      ))}
    </div>
  );
}

export function ProjectTable(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [filter, setFilter] = useState<TicketFilter>(ticketFilterAll);
  const tickets = useTicketRows(partition, filter);
  const executions = useExecutionIndex(partition);
  const index =
    executions.state === "Ready"
      ? executions.value
      : projectExecutionIndexEmpty;
  const sections: readonly TicketSection[] =
    filter === ticketFilterAll ? ticketSectionRoster : [filter];
  const partialFailure =
    tickets.state.state === "Ready" ? tickets.state.value.failure : undefined;
  return (
    <>
      <div className="table-head">
        <TicketFilters filter={filter} onChange={setFilter} />
        <Link
          className="action"
          to="/$tenant/$project/tickets/new"
          params={partition}
        >
          new ticket
        </Link>
      </div>
      {executions.state === "Failed" ? (
        <p className="panel-failed">
          what each ticket is running could not be read — {executions.reason}
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
        <button type="button" className="more" onClick={tickets.readMore}>
          more
        </button>
      )}
      {tickets.reading ? <p className="panel-note">reading…</p> : null}
    </>
  );
}
