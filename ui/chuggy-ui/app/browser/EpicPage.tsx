/**
 * One epic: what it says, how far its tickets have come, the tickets outside
 * it that they wait on, the graph between them, and the revisions it has been
 * through. The figures are the API's and nothing here derives them. A reader
 * who may write epics is offered the form to revise it, which is sent at the
 * revision this page read.
 */

import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { EpicViewResponse } from "../../../../src/contract/responses.ts";
import { instantFigure } from "../core/figures.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import {
  epicFormFrom,
  epicGraphQuery,
  epicHistoryQuery,
  epicQuery,
} from "../core/epics.ts";
import { usePanelState } from "./api.ts";
import { DataPanel, PanelUnready } from "./DataPanel.tsx";
import { EpicFormPanel } from "./EpicForm.tsx";
import { EpicGraph } from "./EpicGraph.tsx";
import { EpicProgress, EpicStatusPill } from "./EpicsPage.tsx";
import { useNowMs } from "./Freshness.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, Fields } from "./ui/Fields.tsx";
import { Figure } from "./ui/Figure.tsx";
import { MarkdownReport } from "./ui/MarkdownReport.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Pill } from "./ui/Pill.tsx";

import "./Epic.css";

function TicketLinks(props: {
  readonly partition: PartitionIdentity;
  readonly tickets: readonly number[];
}): ReactNode {
  if (props.tickets.length === 0) return <span>None</span>;
  return (
    <span className="epic-chips">
      {props.tickets.map((ticket) => (
        <Link
          key={ticket}
          to="/$tenant/$project/tickets/$ticket"
          params={{ ...props.partition, ticket: String(ticket) }}
        >
          {`#${String(ticket)}`}
        </Link>
      ))}
    </span>
  );
}

function EpicSummary(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicViewResponse;
}): ReactNode {
  const { epic } = props;
  return (
    <Panel title={epic.title}>
      <div className="grid gap-3">
        <div className="epic-row-head">
          <span className="text-ink-3 text-sm">{`#${String(epic.number)}`}</span>
          <EpicStatusPill status={epic.status} />
          {epic.visibility === "Archived" ? (
            <Pill tone="retired">Archived</Pill>
          ) : null}
        </div>
        {epic.summary === undefined ? null : <p>{epic.summary}</p>}
        <EpicProgress progress={epic.progress} />
        <Fields>
          <Field name="Tickets">
            <TicketLinks partition={props.partition} tickets={epic.tickets} />
          </Field>
          <Field
            name="Waiting on outside"
            absent={epic.waitingOnOutside.length === 0}
          >
            <TicketLinks
              partition={props.partition}
              tickets={epic.waitingOnOutside}
            />
          </Field>
          <Field name="Revision">{String(epic.revision)}</Field>
        </Fields>
        {epic.description === "" ? null : (
          <MarkdownReport text={epic.description} />
        )}
      </div>
    </Panel>
  );
}

function EpicGraphPanel(props: {
  readonly partition: PartitionIdentity;
  readonly epic: number;
}): ReactNode {
  const state = usePanelState(epicGraphQuery(props.partition, props.epic));
  return (
    <DataPanel title="Graph" state={state}>
      {(graph) => <EpicGraph partition={props.partition} graph={graph} />}
    </DataPanel>
  );
}

/** One page of the history, newest first, and the older one once it is asked for. */
function EpicHistoryPage(props: {
  readonly partition: PartitionIdentity;
  readonly epic: number;
  readonly after: number | undefined;
  readonly nowMs: number;
}): ReactNode {
  const [older, setOlder] = useState(false);
  const state = usePanelState(
    epicHistoryQuery(props.partition, props.epic, props.after),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const { revisions, nextAfter } = state.value;
  return (
    <>
      <ol className="grid gap-1 text-sm" aria-label="Revisions">
        {revisions.map((revision) => (
          <li key={revision.revision} className="flex flex-wrap gap-2">
            <span>{`Revision ${String(revision.revision)}`}</span>
            <span>{revision.title}</span>
            <span className="text-ink-3">{revision.actor.subject}</span>
            <Figure figure={instantFigure(revision.changedAt, props.nowMs)} />
          </li>
        ))}
      </ol>
      {nextAfter === undefined ? null : older ? (
        <EpicHistoryPage
          partition={props.partition}
          epic={props.epic}
          after={nextAfter}
          nowMs={props.nowMs}
        />
      ) : (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setOlder(true);
            }}
          >
            Show older
          </Button>
        </div>
      )}
    </>
  );
}

function EpicRevision(props: {
  readonly partition: PartitionIdentity;
  readonly epic: EpicViewResponse;
}): ReactNode {
  return (
    <Panel title="Edit" collapsible={{ open: false }}>
      <EpicFormPanel
        key={props.epic.number}
        partition={props.partition}
        held={{
          epic: props.epic.number,
          revision: props.epic.revision,
          form: epicFormFrom(props.epic),
        }}
        submit="Save changes"
        onSaved={() => undefined}
      />
    </Panel>
  );
}

export function EpicPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/epics/$epic" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const epic = Number(params.epic);
  const nowMs = useNowMs();
  const state = usePanelState(epicQuery(partition, epic));
  const writing = !projectAbilityRefused(
    useProjectAbilities(partition),
    "writeEpic",
  );
  if (!Number.isSafeInteger(epic) || epic <= 0)
    return <EmptyState label="No such epic" variant="page" />;
  return (
    <div className="grid min-w-0 gap-4" data-fills-width>
      <ScreenTitle>Epic</ScreenTitle>
      {state.state === "Ready" ? (
        <>
          <EpicSummary partition={partition} epic={state.value} />
          {writing ? (
            <EpicRevision partition={partition} epic={state.value} />
          ) : null}
        </>
      ) : (
        <PanelUnready state={state} />
      )}
      <EpicGraphPanel partition={partition} epic={epic} />
      <Panel title="History">
        <EpicHistoryPage
          partition={partition}
          epic={epic}
          after={undefined}
          nowMs={nowMs}
        />
      </Panel>
    </div>
  );
}
