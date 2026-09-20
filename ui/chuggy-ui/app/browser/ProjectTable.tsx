/**
 * The project table: the first screen inside a project, and the only one that
 * answers "what needs me, what is moving, what is next".
 *
 * ONE READ, FIVE PANELS, NO PAGING. `GET /ticket-machine/tickets` answers the
 * whole project in one body with no cursor, so there is one cache entry, the
 * five sections state one instant — the one the rows were observed at — and a
 * filter is a view of what is already held rather than another read. There is
 * no "more" because there is no next page to ask for; a project large enough
 * to want one wants a paged route first, and building a pager over rows
 * already in memory would hide rows to no end.
 *
 * THE ENTRY CARRIES ITS OWN REFRESH. It is a `Ticket` list registered as a
 * reread, so the frames a live stream will deliver stale it and the server is
 * asked again. That is inert while nothing pushes frames and is the whole of
 * what wiring the stream to this screen takes.
 *
 * EXECUTIONS ARE NOT DRAWN HERE. Every column is the adopted ticket read's
 * own; what a ticket ran is a different read of a different shape, and a
 * half-filled run column is a dash a reader cannot tell from "never ran".
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { AdoptedTickets } from "../../../../src/contract/adoptedTickets.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { adoptedTickets } from "../core/adoptedTickets.ts";
import type { PanelState } from "../core/freshness.ts";
import { countFigure } from "../core/figures.ts";
import { projectListReread } from "../core/projectQueryKeys.ts";
import {
  ticketFilterAll,
  ticketFilterRoster,
  ticketFilterSections,
  ticketFilterTitle,
} from "../core/projectTableFilters.ts";
import type { TicketFilter } from "../core/projectTableFilters.ts";
import {
  projectTableRows,
  projectTableRowsIn,
  projectTableRowUnblocked,
} from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { ticketSectionTitles } from "../core/ticketSections.ts";
import type { TicketSection } from "../core/ticketSections.ts";
import { usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import {
  TicketNumberCell,
  TicketStateCell,
  TicketWaitingCell,
} from "./TicketCells.tsx";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Table } from "./ui/Table.tsx";

/** The one entry the whole table is drawn from, named apart from any other
 * list of tickets a screen may come to hold. */
const ticketTableListName = "table";

function useTicketTable(
  partition: PartitionIdentity,
): PanelState<AdoptedTickets> {
  return usePanelList(
    projectListReread<AdoptedTickets>(partition, "Ticket", ticketTableListName),
    (ports) => adoptedTickets(ports, partition),
  );
}

function TicketRow(props: {
  readonly row: ProjectTableRow;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const row = props.row;
  return (
    <tr>
      <TicketNumberCell partition={props.partition} ticket={row.ticket} />
      <TicketStateCell state={row.state} />
      <TicketWaitingCell
        partition={props.partition}
        waitingOn={row.waitingOn}
        startable={row.section === "UpNext"}
      />
      <td className="num">
        <Figure figure={countFigure(row.workCyclesStarted, "cycles")} />
      </td>
      <td className="num text-ink-3">
        <Figure figure={countFigure(row.revision, "rev")} />
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
          <th scope="col">state</th>
          <th scope="col">waiting on</th>
          <th scope="col">work cycles</th>
          <th scope="col">revision</th>
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

/** What "up next" says about itself: how many of the tickets under it could
 * start now, which is the question the heading is asked. */
function ticketSectionAbout(
  section: TicketSection,
  rows: readonly ProjectTableRow[],
): string | undefined {
  if (section !== "UpNext") return undefined;
  const ready = rows.filter((row) => projectTableRowUnblocked(row)).length;
  return `${String(ready)} of ${String(rows.length)} waiting on nothing`;
}

function TicketSectionPanel(props: {
  readonly section: TicketSection;
  readonly state: PanelState<AdoptedTickets>;
  readonly partition: PartitionIdentity;
}): ReactNode {
  const title = ticketSectionTitles[props.section];
  return (
    <DataPanel title={title} state={props.state}>
      {(held) => {
        const rows = projectTableRowsIn(
          projectTableRows(held.tickets),
          props.section,
        );
        if (rows.length === 0) return <EmptyState label="no ticket is here" />;
        const about = ticketSectionAbout(props.section, rows);
        return (
          <>
            <TicketTable
              caption={title}
              rows={rows}
              partition={props.partition}
            />
            {about === undefined ? null : <p className="panel-note">{about}</p>}
          </>
        );
      }}
    </DataPanel>
  );
}

function TicketFilters(props: {
  readonly filter: TicketFilter;
  readonly onChange: (filter: TicketFilter) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="section">
      {ticketFilterRoster.map((filter) => (
        <Button
          key={filter}
          size="sm"
          pressed={filter === props.filter}
          onClick={() => {
            props.onChange(filter);
          }}
        >
          {ticketFilterTitle(filter)}
        </Button>
      ))}
    </div>
  );
}

export function ProjectTable(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  const [filter, setFilter] = useState<TicketFilter>(ticketFilterAll);
  const state = useTicketTable(partition);
  return (
    <main className="grid min-w-0 gap-4 p-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Overview</h1>
      </TopBarSlot>
      <div className="flex flex-wrap items-center gap-4">
        <TicketFilters filter={filter} onChange={setFilter} />
        <ButtonLink to="/$tenant/$project/tickets/new" params={partition}>
          New ticket
        </ButtonLink>
      </div>
      {ticketFilterSections(filter).map((section) => (
        <TicketSectionPanel
          key={section}
          section={section}
          state={state}
          partition={partition}
        />
      ))}
    </main>
  );
}
