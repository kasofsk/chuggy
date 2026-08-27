/**
 * Everything that has run for this ticket: what each stage spent, then each
 * execution, what it ran on, the runs it took, the verdict it recorded and the
 * artifacts it left.
 *
 * The stage rows are a grouping of the summaries this screen already holds, so
 * the breakdown is live for the same reason the list is and costs no further
 * read; the ticket's own total is the server's figure and is drawn beside the
 * ticket, because a sum over a page that may be short would be quietly wrong.
 * The list is a page of summaries and an expanded execution is its own read, so
 * a live `Execution` frame lands in both without either being refetched.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiExecution,
  apiExecutions,
  apiOutputContent,
} from "../core/apiRoutes.ts";
import { artifactPreviewOffer } from "../core/artifactPreview.ts";
import { executionRequirementLabel } from "../core/labels.ts";
import {
  projectListKey,
  projectResourceKey,
} from "../core/projectQueryKeys.ts";
import { runStageCoverageSentence, runStageLabel } from "../core/runTotals.ts";
import type { RunStageRow } from "../core/runTotals.ts";
import {
  ticketExecutionStages,
  ticketExecutionsFolded,
} from "../core/ticketExecutions.ts";
import type { ProjectExecutionChange } from "../core/ticketExecutions.ts";
import { usePanelQuery } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { RunEvidence, RunTotalsLine } from "./RunEvidence.tsx";
import { useProjectListFold } from "./stream.tsx";

type ResultArtifact = NonNullable<
  ExecutionResponse["result"]
>["artifacts"][number];

/** The artifact's own path under its execution is the resource this key names. */
function ArtifactPreview(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly ordinal: number;
}): ReactNode {
  const state = usePanelQuery(
    projectResourceKey(
      props.partition,
      "Execution",
      `${props.execution}/artifacts/${String(props.ordinal)}`,
    ),
    (ports) =>
      apiOutputContent(ports, props.partition, props.execution, props.ordinal),
  );
  return (
    <Panel title={`artifact ${props.ordinal}`} state={state}>
      {(preview) => (
        <pre className="preview" data-renderer={preview.renderer}>
          {preview.content}
        </pre>
      )}
    </Panel>
  );
}

function Artifact(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly artifact: ResultArtifact;
}): ReactNode {
  const [shown, setShown] = useState(false);
  const offer = artifactPreviewOffer(props.artifact);
  return (
    <li className="artifact">
      <span className="artifact-role">{props.artifact.role}</span>
      <code>{props.artifact.path}</code>
      <span className="artifact-bytes">{props.artifact.bytes} bytes</span>
      {offer.offer === "Unpreviewable" ? (
        <span className="panel-absent">{offer.reason}</span>
      ) : (
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? "hide" : `preview as ${offer.renderer}`}
        </button>
      )}
      {shown ? (
        <ArtifactPreview
          partition={props.partition}
          execution={props.execution}
          ordinal={props.artifact.ordinal}
        />
      ) : null}
    </li>
  );
}

function ExecutionAttempts(props: {
  readonly execution: ExecutionResponse;
}): ReactNode {
  return (
    <table className="attempts">
      <thead>
        <tr>
          <th>attempt</th>
          <th>generation</th>
          <th>state</th>
          <th>evidence</th>
          <th>opened</th>
          <th>ended</th>
        </tr>
      </thead>
      <tbody>
        {props.execution.attempts.map((attempt) => (
          <tr key={attempt.attempt}>
            <td>{attempt.number}</td>
            <td>{attempt.generation}</td>
            <td>{attempt.state}</td>
            <td>{attempt.evidence ?? "—"}</td>
            <td>{attempt.openedAt}</td>
            <td>{attempt.endedAt ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExecutionResult(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionResponse;
}): ReactNode {
  const result = props.execution.result;
  if (result === undefined)
    return <p className="panel-note">no result has been recorded</p>;
  return (
    <div className="result">
      <p>
        <strong className={`verdict verdict-${result.verdict.toLowerCase()}`}>
          {result.verdict}
        </strong>{" "}
        recorded {result.recordedAt} under manifest{" "}
        <code>{result.manifest}</code>
      </p>
      <ul className="artifacts">
        {result.artifacts.map((artifact) => (
          <Artifact
            key={artifact.ordinal}
            partition={props.partition}
            execution={props.execution.execution}
            artifact={artifact}
          />
        ))}
      </ul>
    </div>
  );
}

function ExecutionDetail(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
}): ReactNode {
  const state = usePanelQuery(
    projectResourceKey(props.partition, "Execution", props.execution),
    (ports) => apiExecution(ports, props.partition, props.execution),
  );
  return (
    <Panel title={`execution ${props.execution}`} state={state}>
      {(execution) => (
        <div className="execution-detail">
          <ExecutionAttempts execution={execution} />
          <ExecutionResult partition={props.partition} execution={execution} />
          <RunEvidence partition={props.partition} execution={execution} />
        </div>
      )}
    </Panel>
  );
}

function ExecutionRow(props: {
  readonly partition: PartitionIdentity;
  readonly summary: ExecutionSummary;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const summary = props.summary;
  const requirement = executionRequirementLabel(summary);
  return (
    <li className="execution">
      <button
        type="button"
        className="execution-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="execution-kind">
          {summary.taskKind}
          {summary.stage === undefined ? "" : ` stage ${String(summary.stage)}`}
        </span>
        <span className="execution-status">{summary.status}</span>
        <span className="execution-outcome">{summary.outcome ?? "—"}</span>
        <span className="execution-ran-on" title={requirement.title}>
          {requirement.text}
        </span>
      </button>
      <p className="execution-source">
        {summary.requirementSource}, platform default{" "}
        {summary.platformDefaultVersion}, cluster {summary.cluster},{" "}
        {summary.retriesSpent} retries spent
      </p>
      {summary.runTotals === undefined ? (
        <p className="panel-note">no run evidence was recorded</p>
      ) : (
        <RunTotalsLine totals={summary.runTotals} />
      )}
      {open ? (
        <ExecutionDetail
          partition={props.partition}
          execution={summary.execution}
        />
      ) : null}
    </li>
  );
}

function StageRow(props: { readonly row: RunStageRow }): ReactNode {
  const row = props.row;
  return (
    <li className="stage">
      <span className="stage-label">{runStageLabel(row)}</span>
      <span className="execution-source">{runStageCoverageSentence(row)}</span>
      {row.totals === undefined ? (
        <span className="panel-note">no run evidence was recorded</span>
      ) : (
        <RunTotalsLine totals={row.totals} />
      )}
    </li>
  );
}

/** The breakdown above the rows it is a breakdown of, which is the order a cost
 * is read in. */
function TicketStages(props: { readonly page: ExecutionsResponse }): ReactNode {
  const rows = ticketExecutionStages(props.page);
  return (
    <ul className="stages">
      {rows.map((row) => (
        <StageRow key={runStageLabel(row)} row={row} />
      ))}
    </ul>
  );
}

export function TicketExecutions(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const { partition, ticket } = props;
  const key = projectListKey(
    partition,
    "Execution",
    `ticket:${String(ticket)}`,
  );
  const state = usePanelQuery(key, (ports) =>
    apiExecutions(ports, partition, { ticket }),
  );
  const fold = useCallback(
    (previous: unknown, change: ProjectExecutionChange) =>
      ticketExecutionsFolded(
        ticket,
        previous as ExecutionsResponse | undefined,
        change,
      ),
    [ticket],
  );
  useProjectListFold("Execution", key, fold);
  return (
    <Panel title="executions" state={state}>
      {(page) =>
        page.executions.length === 0 ? (
          <p className="panel-note">nothing has run for this ticket</p>
        ) : (
          <>
            <TicketStages page={page} />
            <ul className="executions">
              {page.executions.map((summary) => (
                <ExecutionRow
                  key={summary.execution}
                  partition={partition}
                  summary={summary}
                />
              ))}
            </ul>
          </>
        )
      }
    </Panel>
  );
}
