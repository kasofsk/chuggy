/**
 * The artifacts one run left beside its own result, each previewed one press
 * further in where its renderer can draw it, as a run's Details lists them.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  OutputContentResponse,
} from "../../../../src/contract/responses.ts";
import { outputContentQuery } from "../core/executionQueries.ts";
import {
  artifactPreviewJson,
  artifactPreviewOffer,
} from "../core/artifactPreview.ts";
import { runArtifactsListed } from "../core/runSummary.ts";
import { runCountLabel } from "../core/runTotals.ts";
import { usePanelState } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { MarkdownReport } from "./ui/MarkdownReport.tsx";
import { useCopyText } from "../copy/CopyProvider.tsx";

type ResultArtifact = NonNullable<
  ExecutionResponse["result"]
>["artifacts"][number];

/** The preview content drawn the one way its own renderer draws it, each as
 * `core/artifactPreview.ts` argues: markdown through `MarkdownReport`, JSON
 * indented, an image from the base64 the read answered, the rest as text. */
function ArtifactPreviewContent(props: {
  readonly name: string;
  readonly preview: OutputContentResponse;
}): ReactNode {
  const preview = props.preview;
  switch (preview.renderer) {
    case "Image":
      return (
        <img
          className="preview"
          data-renderer={preview.renderer}
          alt={props.name}
          src={`data:${preview.mediaType};base64,${preview.content}`}
        />
      );
    case "Markdown":
      return (
        <div data-renderer={preview.renderer}>
          <MarkdownReport text={preview.content} />
        </div>
      );
    case "Json":
      return (
        <pre className="preview" data-renderer={preview.renderer}>
          {artifactPreviewJson(preview.content)}
        </pre>
      );
    case "UnifiedDiff":
    case "Text":
      return (
        <pre className="preview" data-renderer={preview.renderer}>
          {preview.content}
        </pre>
      );
  }
}

/** The artifact's own path under its execution is the resource this names. */
function ArtifactPreview(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly ordinal: number;
  readonly name: string;
}): ReactNode {
  const text = useCopyText();
  const state = usePanelState(
    outputContentQuery(props.partition, props.execution, props.ordinal),
  );
  return (
    <DataPanel title={text({ id: "ticket-artifact-preview" })} state={state}>
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
  const text = useCopyText();
  const offer = artifactPreviewOffer(props.artifact);
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="text-ink-3">{props.artifact.role}</span>
      <code>{props.artifact.path}</code>
      <span className="text-ink-3 text-xs">
        {text({
          id: "ticket-artifact-bytes",
          args: { bytes: runCountLabel(props.artifact.bytes) },
        })}
      </span>
      {offer.offer === "Unpreviewable" ? (
        <span className="text-ink-3 text-xs">{text(offer.note)}</span>
      ) : (
        <Disclosure
          open={shown}
          onOpenChange={setShown}
          label={text(
            shown
              ? { id: "ticket-artifact-hide" }
              : { id: "ticket-artifact-preview" },
          )}
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

/** The artifacts a run's result lists beside its own summary, each previewed
 * where its renderer can draw it. */
export function ExecutionArtifacts(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionResponse;
}): ReactNode {
  const artifacts = runArtifactsListed(props.execution.result?.artifacts ?? []);
  if (artifacts.length === 0) return null;
  return (
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
  );
}
