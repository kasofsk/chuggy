/**
 * A run's Context tab: the run adapter of the Context view. Its series, its
 * readings and its snapshot are read under keys the execution's own frames
 * move, and its transcript under the walk the Transcript tab keeps, so a live
 * run's tab moves as the run does and reads nothing on a timer.
 */

import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  RunConfigurationResponse,
  RunContextResponse,
  RunTurnsResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { runContextQuery, runTurnsQuery } from "../../core/contextQueries.ts";
import {
  contextInputsOf,
  contextSettingsWindowOf,
} from "../../core/contextInputs.ts";
import {
  contextHeaviestOf,
  contextLinesOf,
  contextResultsOf,
} from "../../core/contextResults.ts";
import {
  contextCallsOf,
  contextReadingLatest,
  contextRunGrowth,
  contextRunTiles,
  contextRunWindow,
} from "../../core/contextRun.ts";
import { contextPeakOf } from "../../core/contextView.ts";
import { runConfigurationQuery } from "../../core/executionQueries.ts";
import { runConfigurationRead } from "../../core/runConfiguration.ts";
import type { RunTranscriptHeld } from "../../core/runTranscript.ts";
import { runTranscriptHeldEmpty } from "../../core/runTranscript.ts";
import type { PanelState } from "../../core/freshness.ts";
import { usePanelState } from "../api.ts";
import type { ContextCallLink } from "./ContextHeaviest.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useRunTranscript } from "../RunTranscript.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ContextRunView } from "./ContextView.tsx";
import type { ContextRunDrawn } from "./ContextView.tsx";

type RunAttempt = ExecutionResponse["attempts"][number];

/** The attempt a run's Context tab draws: its newest that started a run. */
export function contextRunAttempt(
  read: ExecutionResponse,
): RunAttempt | undefined {
  return read.attempts
    .filter((attempt) => attempt.run !== undefined)
    .sort((left, right) => left.number - right.number)
    .at(-1);
}

/** Whether a run offers a Context tab: an agent carried it out, and so there
 * was a model whose context is the tab's subject. */
export function contextRunOffered(read: ExecutionResponse): boolean {
  return read.carrier === "Agent";
}

/** Every derivation of the tab from what its reads have answered. */
function contextRunDrawn(
  turns: RunTurnsResponse,
  readings: RunContextResponse,
  configuration: RunConfigurationResponse | undefined,
  transcript: RunTranscriptHeld,
): ContextRunDrawn {
  const calls = contextCallsOf(turns.turns);
  const reading =
    configuration === undefined
      ? undefined
      : runConfigurationRead(configuration.content);
  const snapshot =
    reading?.reading === "Snapshot" ? reading.snapshot : undefined;
  const latest = contextReadingLatest(readings.readings)?.window;
  const window = contextRunWindow(
    calls,
    readings.readings,
    snapshot === undefined ? undefined : contextSettingsWindowOf(snapshot.argv),
  );
  const growth = contextRunGrowth(calls, readings.readings, window);
  const results = contextResultsOf(contextLinesOf(transcript), calls);
  return {
    window,
    growth,
    tiles: contextRunTiles(calls, growth),
    inputs:
      snapshot === undefined ? undefined : contextInputsOf(snapshot, latest),
    heaviest: contextHeaviestOf(
      results,
      latest,
      contextPeakOf(growth.points)?.tokens,
    ),
  };
}

function ContextRunHeld(props: {
  readonly turns: PanelState<RunTurnsResponse>;
  readonly readings: PanelState<RunContextResponse>;
  readonly configuration: PanelState<RunConfigurationResponse>;
  readonly transcript: RunTranscriptHeld;
  readonly callLink: ContextCallLink;
}): ReactNode {
  const { turns, readings, configuration } = props;
  if (turns.state !== "Ready") return <PanelUnready state={turns} />;
  if (readings.state !== "Ready") return <PanelUnready state={readings} />;
  if (configuration.state === "Pending")
    return <PanelUnready state={configuration} />;
  return (
    <ContextRunView
      drawn={contextRunDrawn(
        turns.value,
        readings.value,
        configuration.state === "Ready" ? configuration.value : undefined,
        props.transcript,
      )}
      callLink={props.callLink}
    />
  );
}

interface ContextRunAt {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: RunAttempt & {
    readonly run: NonNullable<RunAttempt["run"]>;
  };
  readonly callLink: ContextCallLink;
}

function ContextRunReads(
  props: ContextRunAt & { readonly transcript: RunTranscriptHeld },
): ReactNode {
  const { partition, execution, attempt } = props;
  const turns = usePanelState({
    ...runTurnsQuery(
      partition,
      execution,
      attempt.attempt,
      attempt.run.turnsRecorded,
    ),
    placeholderData: keepPreviousData,
  });
  const readings = usePanelState({
    ...runContextQuery(
      partition,
      execution,
      attempt.attempt,
      attempt.run.readingsRecorded ?? 0,
    ),
    placeholderData: keepPreviousData,
  });
  const configuration = usePanelState({
    ...runConfigurationQuery(partition, execution, attempt.attempt),
    enabled: attempt.run.configuration !== undefined,
  });
  return (
    <ContextRunHeld
      turns={turns}
      readings={readings}
      configuration={
        attempt.run.configuration === undefined
          ? { state: "Absent" }
          : configuration
      }
      transcript={props.transcript}
      callLink={props.callLink}
    />
  );
}

function ContextRunTranscribed(
  props: ContextRunAt & { readonly highWaterBatch: number },
): ReactNode {
  const walk = useRunTranscript({
    partition: props.partition,
    execution: props.execution,
    attempt: props.attempt.attempt,
    highWaterBatch: props.highWaterBatch,
  });
  return <ContextRunReads {...props} transcript={walk.held} />;
}

/** A run's Context tab, or that its run has not started where none has. */
export function RunContext(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly callLink: ContextCallLink;
}): ReactNode {
  const text = useCopyText();
  const attempt = contextRunAttempt(props.read);
  if (attempt?.run === undefined)
    return <EmptyState label={text({ id: "context-growth-none" })} />;
  const at: ContextRunAt = {
    partition: props.partition,
    execution: props.read.execution,
    attempt: { ...attempt, run: attempt.run },
    callLink: props.callLink,
  };
  const transcript = attempt.run.transcript;
  return transcript === undefined ? (
    <ContextRunReads
      key={attempt.attempt}
      {...at}
      transcript={runTranscriptHeldEmpty}
    />
  ) : (
    <ContextRunTranscribed
      key={attempt.attempt}
      {...at}
      highWaterBatch={transcript.highWaterBatch}
    />
  );
}
