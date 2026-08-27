/**
 * One run's transcript, drawn as the ordered steps the agent runtime recorded.
 *
 * The pane fetches the batches above the highest it holds, and it does so when
 * the high-water mark on the `Execution` frame the browser already receives
 * rises — there is no poll and no follow control, because neither would learn
 * anything the frame does not already carry. Every step is drawn as characters
 * and nothing in a transcript is interpreted.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { panelReason } from "../core/freshness.ts";
import { apiRunTranscript } from "../core/apiRoutes.ts";
import {
  runTranscriptCoverageSentence,
  runTranscriptElisionSentence,
  runTranscriptFailed,
  runTranscriptFreshnessSentence,
  runTranscriptHeldEmpty,
  runTranscriptMerged,
  runTranscriptNextAfter,
  runTranscriptRead,
  runTranscriptReadsMax,
} from "../core/runTranscript.ts";
import type {
  RunTranscriptHeld,
  RunTranscriptStep,
} from "../core/runTranscript.ts";
import { useApiPorts } from "./api.ts";
import { useNowMs } from "./Panel.tsx";

function Elisions(props: { readonly elided: readonly number[] }): ReactNode {
  return props.elided.length === 0 ? null : (
    <span className="step-elided">
      {props.elided
        .map((bytes) => runTranscriptElisionSentence(bytes))
        .join(" ")}
    </span>
  );
}

function Step(props: { readonly step: RunTranscriptStep }): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Assistant":
      return (
        <li className="step" data-step={step.type}>
          <span className="step-type">{step.type}</span>
          {step.tools.length === 0 ? null : (
            <span className="step-tools">{step.tools.join(", ")}</span>
          )}
          <pre className="step-text">{step.text}</pre>
          <Elisions elided={step.elided} />
        </li>
      );
    case "User":
      return (
        <li className="step" data-step={step.type}>
          <span className="step-type">{step.type}</span>
          <span className="step-tools">
            {step.toolResults === 0
              ? "no tool result"
              : `${String(step.toolResults)} tool results`}
          </span>
          <Elisions elided={step.elided} />
        </li>
      );
    case "Capped":
      return (
        <li className="step" data-step={step.type}>
          <span className="step-type">{step.type}</span>
          <span className="step-capped">{step.sentence}</span>
        </li>
      );
    case "Event":
      return (
        <li className="step" data-step={step.type}>
          <span className="step-type">{step.type}</span>
          <Elisions elided={step.elided} />
        </li>
      );
    case "Unavailable":
      return (
        <li className="step" data-step="unavailable">
          <span className="step-type">batch</span>
          <span className="step-capped">{step.sentence}</span>
        </li>
      );
    case "Unreadable":
      return (
        <li className="step" data-step="unreadable">
          <span className="step-type">unreadable</span>
          <pre className="step-text">{step.line}</pre>
        </li>
      );
  }
}

/** The read walk: batches above what is held, a bounded number of pages at a
 * time, abandoned when the pane goes away. */
function useRunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
  readonly highWaterBatch: number;
}): RunTranscriptHeld {
  const ports = useApiPorts();
  const [held, setHeld] = useState<RunTranscriptHeld>(runTranscriptHeldEmpty);
  const holding = useRef<RunTranscriptHeld>(runTranscriptHeldEmpty);
  const { execution, attempt, highWaterBatch } = props;
  const { tenant, project } = props.partition;
  useEffect(() => {
    let abandoned = false;
    const walk = async (): Promise<void> => {
      for (let read = 0; read < runTranscriptReadsMax; read += 1) {
        const after = runTranscriptNextAfter(holding.current, highWaterBatch);
        if (after === undefined || abandoned) return;
        const answered = await apiRunTranscript(
          ports,
          { tenant, project },
          execution,
          attempt,
          after,
        );
        if (abandoned) return;
        const next =
          answered.outcome === "Ok"
            ? runTranscriptMerged(holding.current, answered.value)
            : runTranscriptFailed(holding.current, panelReason(answered));
        holding.current = next;
        setHeld(next);
        if (answered.outcome !== "Ok") return;
      }
    };
    void walk();
    return () => {
      abandoned = true;
    };
  }, [ports, tenant, project, execution, attempt, highWaterBatch]);
  return held;
}

export function RunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
  readonly highWaterBatch: number;
}): ReactNode {
  const held = useRunTranscript(props);
  const now = useNowMs();
  const reading = runTranscriptRead(held);
  const coverage = runTranscriptCoverageSentence(held, reading);
  return (
    <section className="panel transcript">
      <header className="panel-head">
        <h2>transcript</h2>
        <span className="freshness">
          {runTranscriptFreshnessSentence(held, now)}
        </span>
      </header>
      {held.failure === undefined ? null : (
        <p className="panel-failed">could not be read — {held.failure}</p>
      )}
      {coverage === undefined ? null : <p className="panel-note">{coverage}</p>}
      {reading.steps.length === 0 && held.failure === undefined ? (
        <p className="panel-note">no transcript has been recorded yet</p>
      ) : (
        <ol className="steps">
          {reading.steps.map((step) => (
            <Step key={step.ordinal} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}
