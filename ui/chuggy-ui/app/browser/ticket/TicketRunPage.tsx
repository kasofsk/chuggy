/**
 * One run's own page under the ticket's Runs tab: the rail of the ticket's
 * runs with this one marked, its heading and figures, and its Summary,
 * Transcript, Details and, for a command run that wrote some, Output, each at
 * an address of its own.
 *
 * A run is found by its task's number in the page the ticket already holds,
 * and its execution is read under the key every row reads it by, so nothing
 * here asks the server for anything a ticket page did not already ask.
 */

import { Link, useParams, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ExecutionResponse } from "../../../../../src/contract/responses.ts";
import { executionQuery } from "../../core/executionQueries.ts";
import {
  runTimeLineOf,
  sinceFigure,
  spendFigures,
} from "../../core/figures.ts";
import { runReasonAttempt, runRefusalOf } from "../../core/runReason.ts";
import type { RunResultOpened } from "../../core/runResult.ts";
import { runTimeOf } from "../../core/runTotals.ts";
import { runTranscriptAttempt } from "../../core/runTranscript.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import {
  ticketRunDetailsOf,
  ticketRunLive,
  ticketRunMarkOf,
  ticketRunsFind,
  ticketRunTaskOf,
  ticketRunViewShown,
  ticketRunViews,
} from "../../core/ticketRuns.ts";
import type { TicketRunStep, TicketRunView } from "../../core/ticketRuns.ts";
import { verdictTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ExecutionArtifacts } from "../ExecutionArtifacts.tsx";
import { RunReasonText } from "../RunEvidence.tsx";
import { RunTranscriptOfRun } from "../RunTranscript.tsx";
import { Chevron } from "../ui/Chevron.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Pill } from "../ui/Pill.tsx";
import {
  readValue,
  useTicketPageHeld,
  useTicketRunsWithin,
} from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { RunResultOpenedBody, useRunResultOpened } from "./TicketResult.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunsRail, useTicketRuns } from "./TicketRuns.tsx";
import type { TicketRunsRailCurrent } from "./TicketRuns.tsx";

import "./ticket.css";

/** The way back to the Runs tab, above every run and the landing. */
export function TicketRunsBack(props: {
  readonly held: TicketPageHeld;
}): ReactNode {
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket/runs"
      params={{ ...props.held.partition, ticket: String(props.held.ticket) }}
      className="ticket-run-back"
    >
      <Chevron className="ticket-run-back-chevron" />
      All runs
    </Link>
  );
}

/** The rail beside a page of the Runs tab, and the page itself. */
export function TicketRunsFrame(props: {
  readonly held: TicketPageHeld;
  readonly current: TicketRunsRailCurrent;
  readonly children: ReactNode;
}): ReactNode {
  useTicketRunsWithin();
  const runs = useTicketRuns(props.held);
  if (runs === undefined)
    return <PanelUnready state={props.held.reads.pageState} />;
  return (
    <div className="ticket-run-frame">
      <TicketRunsRail held={props.held} runs={runs} current={props.current} />
      <div className="ticket-run-main">
        <TicketRunsBack held={props.held} />
        {props.children}
      </div>
    </div>
  );
}

function TicketRunMeta(props: {
  readonly step: TicketRunStep;
  readonly nowMs: number;
}): ReactNode {
  const { step, nowMs } = props;
  const totals = step.execution.runTotals;
  const spend = spendFigures(totals, totals?.costBasis);
  const taken = step.execution.takenAt;
  const line = runTimeLineOf(runTimeOf([step.execution], nowMs));
  return (
    <p className="ticket-run-meta">
      {taken === undefined ? null : (
        <Figure figure={sinceFigure(taken, nowMs, "Started")} />
      )}
      {line.line === "Waiting" ? (
        <span>
          Waiting <Figure figure={line.waited} />
        </span>
      ) : (
        <>
          <span>
            ran <Figure figure={line.ran} />
          </span>
          {line.waited === undefined ? null : (
            <span>
              waited <Figure figure={line.waited} />
            </span>
          )}
        </>
      )}
      <Figure figure={spend.cost} />
      <Figure figure={spend.tokens} />
    </p>
  );
}

function TicketRunHead(props: {
  readonly step: TicketRunStep;
  readonly nowMs: number;
}): ReactNode {
  const step = props.step;
  const tone = verdictTone(step.verdict);
  return (
    <div className="ticket-run-head">
      <div className="ticket-run-heading">
        <TicketRunMarkDrawn mark={ticketRunMarkOf(step.verdict)} tone={tone} />
        <h2>{step.name}</h2>
        <span className="ticket-run-cycle">{cycleLabel(step.cycle)}</span>
        <Pill tone={tone}>{step.verdict}</Pill>
      </div>
      <TicketRunMeta step={step} nowMs={props.nowMs} />
    </div>
  );
}

/** The sub-tabs a run offers: Output only where a command run wrote some. */
function ticketRunViewsOffered(
  opened: RunResultOpened | undefined,
): readonly TicketRunView[] {
  return ticketRunViews.filter(
    (view) => view !== "Output" || opened?.opened === "Commands",
  );
}

function TicketRunViewTabs(props: {
  readonly held: TicketPageHeld;
  readonly task: number;
  readonly offered: readonly TicketRunView[];
  readonly shown: TicketRunView;
}): ReactNode {
  const params = {
    ...props.held.partition,
    ticket: String(props.held.ticket),
    task: String(props.task),
  };
  return (
    <nav aria-label="Run" className="ticket-tabs ticket-run-views">
      <ul>
        {props.offered.map((view) => (
          <li key={view}>
            <Link
              to="/$tenant/$project/tickets/$ticket/runs/$task"
              params={params}
              search={{ view }}
              activeOptions={{ exact: true, includeSearch: true }}
              aria-current={view === props.shown ? "page" : undefined}
              className="ticket-tab"
              replace
            >
              {view}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** What the run said of itself: its report, or why it ended without one. */
function TicketRunSummary(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly opened: RunResultOpened | undefined;
  readonly live: boolean;
}): ReactNode {
  const { read, opened } = props;
  if (opened?.opened === "Report")
    return (
      <RunResultOpenedBody
        partition={props.partition}
        execution={read.execution}
        opened={opened}
      />
    );
  const report = read.result?.report;
  if (report !== undefined) return <MarkdownReport text={report} bare />;
  const reasoned = runReasonAttempt(read);
  if (reasoned !== undefined)
    return (
      <RunReasonText
        partition={props.partition}
        execution={read.execution}
        attempt={reasoned}
      />
    );
  const refusal = runRefusalOf(read);
  if (refusal !== undefined)
    return <p className="ticket-run-refusal">{refusal.full}</p>;
  return <EmptyState label={props.live ? "Running" : "No summary"} />;
}

function TicketRunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
}): ReactNode {
  const attempt = runTranscriptAttempt(props.read);
  if (attempt === undefined) return <EmptyState label="No transcript" />;
  return (
    <RunTranscriptOfRun
      key={attempt.attempt}
      partition={props.partition}
      execution={props.read.execution}
      attempt={attempt}
      highWaterBatch={attempt.run.transcript.highWaterBatch}
      turns={attempt.run.totals?.turns ?? attempt.run.turnsRecorded}
    />
  );
}

function TicketRunDetails(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly nowMs: number;
}): ReactNode {
  const details = ticketRunDetailsOf(props.read, props.nowMs);
  return (
    <div className="grid gap-4">
      <Fields>
        <Field name="Runner">{details.runner}</Field>
        {details.image === undefined ? null : (
          <Field name="Image">
            <Identity label={details.image} />
          </Field>
        )}
        <Field name="Worker" absent={details.worker === undefined}>
          {details.worker ?? "Unknown"}
        </Field>
        <Field name="CPUs" absent={details.cpus === undefined}>
          {details.cpus ?? "Default"}
        </Field>
        <Field name="Waited">
          <Figure figure={details.waited} />
        </Field>
        <Field name="Attempts">{details.attempts}</Field>
        <Field name="Model" absent={details.model === undefined}>
          {details.model ?? "None"}
        </Field>
        <Field name="Turns" absent={details.turns === undefined}>
          {details.turns ?? "None"}
        </Field>
        <Field name="API time" absent={details.apiTime === undefined}>
          {details.apiTime === undefined ? (
            "None"
          ) : (
            <Figure figure={details.apiTime} />
          )}
        </Field>
        <Field name="Tokens" absent={details.tokens === undefined}>
          {details.tokens ?? "None"}
        </Field>
        <Field name="Execution">
          <Identity label={details.execution} />
        </Field>
      </Fields>
      <ExecutionArtifacts partition={props.partition} execution={props.read} />
    </div>
  );
}

function TicketRunViewBody(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly opened: RunResultOpened | undefined;
  readonly shown: TicketRunView;
  readonly live: boolean;
  readonly nowMs: number;
}): ReactNode {
  switch (props.shown) {
    case "Summary":
      return <TicketRunSummary {...props} />;
    case "Transcript":
      return (
        <TicketRunTranscript partition={props.partition} read={props.read} />
      );
    case "Details":
      return (
        <TicketRunDetails
          partition={props.partition}
          read={props.read}
          nowMs={props.nowMs}
        />
      );
    case "Output":
      return props.opened === undefined ? null : (
        <RunResultOpenedBody
          partition={props.partition}
          execution={props.read.execution}
          opened={props.opened}
        />
      );
  }
}

function TicketRunRead(props: {
  readonly held: TicketPageHeld;
  readonly step: TicketRunStep;
  readonly read: ExecutionResponse;
  readonly asked: TicketRunView | undefined;
}): ReactNode {
  const { held, step, read } = props;
  const opened = useRunResultOpened(held.partition, read.execution, read);
  const offered = ticketRunViewsOffered(opened);
  const live = ticketRunLive(step.verdict);
  const shown = ticketRunViewShown(props.asked, offered, live);
  return (
    <>
      <TicketRunViewTabs
        held={held}
        task={step.task}
        offered={offered}
        shown={shown}
      />
      <div className="ticket-run-body" data-view={shown.toLowerCase()}>
        <TicketRunViewBody
          partition={held.partition}
          read={read}
          opened={opened}
          shown={shown}
          live={live}
          nowMs={held.nowMs}
        />
      </div>
    </>
  );
}

function TicketRunFound(props: {
  readonly held: TicketPageHeld;
  readonly step: TicketRunStep;
  readonly asked: TicketRunView | undefined;
}): ReactNode {
  const { held, step } = props;
  const state = usePanelState(
    executionQuery(held.partition, step.execution.execution, "Streamed"),
  );
  const read = readValue(state);
  return (
    <>
      <TicketRunHead step={step} nowMs={held.nowMs} />
      {read === undefined ? (
        <PanelUnready state={state} />
      ) : (
        <TicketRunRead
          held={held}
          step={step}
          read={read}
          asked={props.asked}
        />
      )}
    </>
  );
}

function TicketRunOf(props: {
  readonly held: TicketPageHeld;
  readonly task: number | undefined;
  readonly asked: TicketRunView | undefined;
}): ReactNode {
  const runs = useTicketRuns(props.held);
  const step =
    runs === undefined || props.task === undefined
      ? undefined
      : ticketRunsFind(runs.cycles, props.task);
  return step === undefined ? (
    <EmptyState label="No such run" />
  ) : (
    <TicketRunFound held={props.held} step={step} asked={props.asked} />
  );
}

/** The run a task's number names, on the sub-tab asked for where it offers
 * it, beside the rail of every run the ticket holds. */
export function TicketRunAt(props: {
  readonly task: number | undefined;
  readonly asked: TicketRunView | undefined;
}): ReactNode {
  const held = useTicketPageHeld();
  return (
    <TicketRunsFrame
      held={held}
      current={{ at: "Run", task: props.task ?? Number.NaN }}
    >
      <TicketRunOf held={held} task={props.task} asked={props.asked} />
    </TicketRunsFrame>
  );
}

/** The run its address names, at the sub-tab its query names. */
export function TicketRunTab(): ReactNode {
  const params = useParams({
    from: "/$tenant/$project/tickets/$ticket/runs/$task",
  });
  const query = useSearch({
    from: "/$tenant/$project/tickets/$ticket/runs/$task",
  });
  return <TicketRunAt task={ticketRunTaskOf(params.task)} asked={query.view} />;
}
