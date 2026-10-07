/**
 * One execution opened out: the runs it took, the verdict it recorded, the
 * artifacts it left beside the run's own result, and its identity one press
 * further in for whoever has to look it up.
 *
 * An expanded execution is its own read, so a live `Execution` frame lands in
 * it and in the page of summaries the ledger holds without either being
 * refetched. What the ticket ran, in the structure the machine ran it in, is
 * `ticket/TicketLedger.tsx`; this is what a row opens.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  OutputContentResponse,
} from "../../../../src/contract/responses.ts";
import type { ResultVerdict } from "../../../../src/contract/rosters.ts";
import { apiExecution, apiOutputContent } from "../core/apiRoutes.ts";
import { artifactPreviewOffer } from "../core/artifactPreview.ts";
import { ranFigure, sinceFigure } from "../core/figures.ts";
import { runArtifactsListed } from "../core/runSummary.ts";
import { runCountLabel } from "../core/runTotals.ts";
import type { SetVerdict } from "../core/ticketLedger.ts";
import { verdictTone } from "../core/tones.ts";
import { usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { RunEvidence } from "./RunEvidence.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";

/** A result's verdict in the word the ledger's own rows draw it in. */
const resultVerdictWord: Record<ResultVerdict, SetVerdict> = {
  Pass: "Passed",
  Fail: "Failed",
};

type ResultArtifact = NonNullable<
  ExecutionResponse["result"]
>["artifacts"][number];

/** The preview content drawn the one way its own renderer draws it. Every
 * renderer but `Image` is text, interpreted by none of them; `Image` draws
 * as an `<img>` of a `data:` URI built from the same base64 the API answers,
 * so nothing is fetched by the document beyond the authenticated read this
 * panel already made. */
function ArtifactPreviewContent(props: {
  readonly name: string;
  readonly preview: OutputContentResponse;
}): ReactNode {
  const preview = props.preview;
  if (preview.renderer === "Image")
    return (
      <img
        className="preview"
        data-renderer={preview.renderer}
        alt={props.name}
        src={`data:${preview.mediaType};base64,${preview.content}`}
      />
    );
  return (
    <pre className="preview" data-renderer={preview.renderer}>
      {preview.content}
    </pre>
  );
}

/** The artifact's own path under its execution is the resource this names. */
function ArtifactPreview(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly ordinal: number;
  readonly name: string;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Execution",
    `${props.execution}/artifacts/${String(props.ordinal)}`,
    (ports) =>
      apiOutputContent(ports, props.partition, props.execution, props.ordinal),
  );
  return (
    <DataPanel title="Preview" state={state}>
      {(preview) => (
        <ArtifactPreviewContent name={props.name} preview={preview} />
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
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="text-ink-3">{props.artifact.role}</span>
      <code>{props.artifact.path}</code>
      <span className="text-ink-3 text-xs">
        {runCountLabel(props.artifact.bytes)} bytes
      </span>
      {offer.offer === "Unpreviewable" ? (
        <span className="text-ink-3 text-xs">{offer.note}</span>
      ) : (
        <Disclosure
          open={shown}
          onOpenChange={setShown}
          label={shown ? "Hide" : "Preview"}
        >
          <div className="basis-full">
            <ArtifactPreview
              partition={props.partition}
              execution={props.execution}
              ordinal={props.artifact.ordinal}
              name={props.artifact.path}
            />
          </div>
        </Disclosure>
      )}
    </li>
  );
}

/** One row per run, which its number tells apart from the others. */
function ExecutionAttempts(props: {
  readonly execution: ExecutionResponse;
  readonly nowMs: number;
}): ReactNode {
  return (
    <Table caption="Runs">
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col">State</th>
          <th scope="col">Started</th>
          <th scope="col">Ran</th>
        </tr>
      </thead>
      <tbody>
        {props.execution.attempts.map((attempt) => (
          <tr key={attempt.attempt}>
            <th scope="row">{attempt.number}</th>
            <td>{attempt.state}</td>
            <td>
              <Figure figure={sinceFigure(attempt.openedAt, props.nowMs)} />
            </td>
            <td>
              <Figure figure={ranFigure(attempt.openedAt, attempt.endedAt)} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ExecutionResult(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionResponse;
  readonly nowMs: number;
}): ReactNode {
  const result = props.execution.result;
  if (result === undefined) return <p className="panel-note">No result</p>;
  const verdict = resultVerdictWord[result.verdict];
  const artifacts = runArtifactsListed(result.artifacts);
  return (
    <div className="grid gap-2 px-4 py-2">
      <p className="flex flex-wrap items-baseline gap-2">
        <Pill tone={verdictTone(verdict)}>{verdict}</Pill>
        <Figure figure={sinceFigure(result.recordedAt, props.nowMs)} />
      </p>
      {artifacts.length === 0 ? null : (
        <ul className="grid gap-2">
          {artifacts.map((artifact) => (
            <Artifact
              key={artifact.ordinal}
              partition={props.partition}
              execution={props.execution.execution}
              artifact={artifact}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The execution's identity, selectable whole, for a lookup the page has no
 * other use for. */
function ExecutionIdentity(props: { readonly execution: string }): ReactNode {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <Disclosure
        open={shown}
        onOpenChange={setShown}
        label={shown ? "Hide ID" : "Execution ID"}
        look={{ variant: "quiet", size: "sm" }}
      >
        <div className="basis-full">
          <Identity
            label={{ text: props.execution, title: props.execution }}
            block
          />
        </div>
      </Disclosure>
    </div>
  );
}

export function ExecutionDetail(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly nowMs: number;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Execution",
    props.execution,
    (ports) => apiExecution(ports, props.partition, props.execution),
  );
  return (
    <DataPanel title="Runs" state={state}>
      {(execution) => (
        <div className="grid gap-2 px-4 py-2">
          <ExecutionAttempts execution={execution} nowMs={props.nowMs} />
          <ExecutionResult
            partition={props.partition}
            execution={execution}
            nowMs={props.nowMs}
          />
          <RunEvidence
            partition={props.partition}
            execution={execution}
            nowMs={props.nowMs}
          />
          <ExecutionIdentity execution={execution.execution} />
        </div>
      )}
    </DataPanel>
  );
}
