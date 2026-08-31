/**
 * One execution opened out: what it ran on, the attempts it took, the verdict
 * it recorded and the artifacts it left.
 *
 * An expanded execution is its own read, so a live `Execution` frame lands in
 * it and in the page of summaries the ledger holds without either being
 * refetched. What the ticket ran, in the structure the machine ran it in, is
 * `ticket/TicketLedger.tsx`; this is what a row opens.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ExecutionResponse } from "../../../../src/contract/responses.ts";
import { apiExecution, apiOutputContent } from "../core/apiRoutes.ts";
import { artifactPreviewOffer } from "../core/artifactPreview.ts";
import { usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { RunEvidence } from "./RunEvidence.tsx";

type ResultArtifact = NonNullable<
  ExecutionResponse["result"]
>["artifacts"][number];

/** The artifact's own path under its execution is the resource this names. */
function ArtifactPreview(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly ordinal: number;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Execution",
    `${props.execution}/artifacts/${String(props.ordinal)}`,
    (ports) =>
      apiOutputContent(ports, props.partition, props.execution, props.ordinal),
  );
  return (
    <DataPanel title={`artifact ${props.ordinal}`} state={state}>
      {(preview) => (
        <pre className="preview" data-renderer={preview.renderer}>
          {preview.content}
        </pre>
      )}
    </DataPanel>
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
        <div className="artifact-preview">
          <ArtifactPreview
            partition={props.partition}
            execution={props.execution}
            ordinal={props.artifact.ordinal}
          />
        </div>
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

export function ExecutionDetail(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Execution",
    props.execution,
    (ports) => apiExecution(ports, props.partition, props.execution),
  );
  return (
    <DataPanel title={`execution ${props.execution}`} state={state}>
      {(execution) => (
        <div className="execution-detail">
          <ExecutionAttempts execution={execution} />
          <ExecutionResult partition={props.partition} execution={execution} />
          <RunEvidence partition={props.partition} execution={execution} />
        </div>
      )}
    </DataPanel>
  );
}
