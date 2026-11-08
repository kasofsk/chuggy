/**
 * One run's own page under the ticket's Runs tab: the rail of the ticket's
 * runs with this one marked, its heading and figures, and its Summary,
 * Transcript, Details, for a command run that wrote some, Output, and for an
 * agent's run, Context, each at an address of its own.
 *
 * A run is found by its task's number in the page the ticket already holds,
 * and its execution is read under the key every row reads it by, so nothing
 * here asks the server for anything a ticket page did not already ask.
 */

import { Link, useParams, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ExecutionResponse } from "../../../../../src/contract/responses.ts";
import type { ContextResult } from "../../core/contextResults.ts";
import { contextAtLabel } from "../../core/contextView.ts";
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
import { cycleLabel, setVerdictLabel } from "../../core/ticketLedger.ts";
import {
  ticketRunDetailsOf,
  ticketRunLive,
  ticketRunMarkOf,
  ticketRunsFind,
  ticketRunTaskOf,
  ticketRunViewShown,
  ticketRunViews,
} from "../../core/ticketRuns.ts";
import type {
  TicketRunDetails as TicketRunDetailsFacts,
  TicketRunStep,
  TicketRunQuery,
  TicketRunView,
} from "../../core/ticketRuns.ts";
import { verdictTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { RunContext, contextRunOffered } from "../context/RunContext.tsx";
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
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";

import "./ticket.css";

/** The way back to the Runs tab, above every run and the landing. */
export function TicketRunsBack(props: {
  readonly held: TicketPageHeld;
}): ReactNode {
  const text = useCopyText();
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket/runs"
      params={{ ...props.held.partition, ticket: String(props.held.ticket) }}
      className="ticket-run-back"
    >
      <Chevron className="ticket-run-back-chevron" />
      {text({ id: "ticket-all-runs" })}
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
  const text = useCopyText();
  return (
    <p className="ticket-run-meta">
      {taken === undefined ? null : (
        <Figure
          figure={sinceFigure(taken, nowMs, { id: "figures-happened-started" })}
        />
      )}
      {line.line === "Waiting" ? (
        <span>
          {text({ id: "ticket-waiting" })} <Figure figure={line.waited} />
        </span>
      ) : (
        <>
          <span>
            {text({ id: "ticket-ran-lower" })} <Figure figure={line.ran} />
          </span>
          {line.waited === undefined ? null : (
            <span>
              {text({ id: "ticket-waited-lower" })}{" "}
              <Figure figure={line.waited} />
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
  const text = useCopyText();
  return (
    <div className="ticket-run-head">
      <div className="ticket-run-heading">
        <TicketRunMarkDrawn mark={ticketRunMarkOf(step.verdict)} tone={tone} />
        <h2>{step.name}</h2>
        <span className="ticket-run-cycle">{text(cycleLabel(step.cycle))}</span>
        <Pill tone={tone}>{text(setVerdictLabel(step.verdict))}</Pill>
      </div>
      <TicketRunMeta step={step} nowMs={props.nowMs} />
    </div>
  );
}

/** The sub-tabs a run offers: Output only where a command run wrote some, and
 * Context only where an agent carried the run out. */
function ticketRunViewsOffered(
  opened: RunResultOpened | undefined,
  read: ExecutionResponse,
): readonly TicketRunView[] {
  return ticketRunViews.filter((view) => {
    if (view === "Output") return opened?.opened === "Commands";
    return view !== "Context" || contextRunOffered(read);
  });
}

/** A run's sub-tab, in the word its own link says. */
function ticketRunViewLabel(view: TicketRunView): Copy {
  switch (view) {
    case "Summary":
      return { id: "ticket-run-view-summary" };
    case "Transcript":
      return { id: "ticket-run-view-transcript" };
    case "Details":
      return { id: "ticket-run-view-details" };
    case "Output":
      return { id: "ticket-run-view-output" };
    case "Context":
      return { id: "ticket-run-view-context" };
  }
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
  const text = useCopyText();
  return (
    <nav
      aria-label={text({ id: "ticket-run-nav-label" })}
      className="ticket-tabs ticket-run-views"
    >
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
              {text(ticketRunViewLabel(view))}
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
  const text = useCopyText();
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
  return (
    <EmptyState
      label={text({
        id: props.live ? "ticket-verdict-running" : "ticket-run-no-summary",
      })}
    />
  );
}

function TicketRunTranscript(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly call: string | undefined;
}): ReactNode {
  const attempt = runTranscriptAttempt(props.read);
  const text = useCopyText();
  if (attempt === undefined)
    return <EmptyState label={text({ id: "ticket-run-no-transcript" })} />;
  return (
    <RunTranscriptOfRun
      key={attempt.attempt}
      partition={props.partition}
      execution={props.read.execution}
      attempt={attempt}
      highWaterBatch={attempt.run.transcript.highWaterBatch}
      turns={attempt.run.totals?.turns ?? attempt.run.turnsRecorded}
      call={props.call}
    />
  );
}

function TicketRunDetailsFields(props: {
  readonly details: TicketRunDetailsFacts;
}): ReactNode {
  const { details } = props;
  const text = useCopyText();
  const none = text({ id: "ticket-value-none" });
  return (
    <Fields>
      <Field name={text({ id: "ticket-run-runner" })}>{details.runner}</Field>
      {details.image === undefined ? null : (
        <Field name={text({ id: "ticket-run-image" })}>
          <Identity label={details.image} />
        </Field>
      )}
      <Field
        name={text({ id: "ticket-run-worker" })}
        absent={details.worker === undefined}
      >
        {details.worker ?? text({ id: "ticket-value-unknown" })}
      </Field>
      <Field
        name={text({ id: "ticket-run-cpus" })}
        absent={details.cpus === undefined}
      >
        {details.cpus ?? text({ id: "ticket-value-default" })}
      </Field>
      <Field name={text({ id: "ticket-field-waited" })}>
        <Figure figure={details.waited} />
      </Field>
      <Field name={text({ id: "ticket-field-attempts" })}>
        {details.attempts}
      </Field>
      <Field
        name={text({ id: "ticket-field-model" })}
        absent={details.model === undefined}
      >
        {details.model ?? none}
      </Field>
      <Field
        name={text({ id: "ticket-field-turns" })}
        absent={details.turns === undefined}
      >
        {details.turns ?? none}
      </Field>
      <Field
        name={text({ id: "ticket-field-api-time" })}
        absent={details.apiTime === undefined}
      >
        {details.apiTime === undefined ? (
          none
        ) : (
          <Figure figure={details.apiTime} />
        )}
      </Field>
      <Field
        name={text({ id: "ticket-field-tokens" })}
        absent={details.tokens === undefined}
      >
        {details.tokens ?? none}
      </Field>
      <Field name={text({ id: "ticket-run-id-field" })}>
        <Identity label={details.execution} />
      </Field>
    </Fields>
  );
}

function TicketRunDetails(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const details = ticketRunDetailsOf(props.read, props.nowMs, text);
  return (
    <div className="grid gap-4">
      <TicketRunDetailsFields details={details} />
      <ExecutionArtifacts partition={props.partition} execution={props.read} />
    </div>
  );
}

/** A result's call, as a link to the run's transcript opened at that call. */
function TicketRunCallLink(props: {
  readonly held: TicketPageHeld;
  readonly task: number;
  readonly result: ContextResult & { readonly call: number };
}): ReactNode {
  const text = useCopyText();
  return (
    <Link
      to="/$tenant/$project/tickets/$ticket/runs/$task"
      params={{
        ...props.held.partition,
        ticket: String(props.held.ticket),
        task: String(props.task),
      }}
      search={{ view: "Transcript", step: props.result.id }}
      className="context-largest-call"
    >
      {text(contextAtLabel("Call", props.result.call))}
    </Link>
  );
}

function TicketRunViewBody(props: {
  readonly held: TicketPageHeld;
  readonly task: number;
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
  readonly opened: RunResultOpened | undefined;
  readonly shown: TicketRunView;
  /** The tool call its transcript is opened at, where the address names one. */
  readonly step: string | undefined;
  readonly live: boolean;
  readonly nowMs: number;
}): ReactNode {
  switch (props.shown) {
    case "Summary":
      return <TicketRunSummary {...props} />;
    case "Transcript":
      return (
        <TicketRunTranscript
          partition={props.partition}
          read={props.read}
          call={props.step}
        />
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
    case "Context":
      return (
        <RunContext
          partition={props.partition}
          read={props.read}
          callLink={(result) => (
            <TicketRunCallLink
              held={props.held}
              task={props.task}
              result={result}
            />
          )}
        />
      );
  }
}

function TicketRunRead(props: {
  readonly held: TicketPageHeld;
  readonly step: TicketRunStep;
  readonly read: ExecutionResponse;
  readonly asked: TicketRunQuery;
}): ReactNode {
  const { held, step, read } = props;
  const opened = useRunResultOpened(held.partition, read.execution, read);
  const offered = ticketRunViewsOffered(opened, read);
  const live = ticketRunLive(step.verdict);
  const shown = ticketRunViewShown(props.asked.view, offered, live);
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
          held={held}
          task={step.task}
          partition={held.partition}
          read={read}
          opened={opened}
          shown={shown}
          step={props.asked.step}
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
  readonly asked: TicketRunQuery;
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
  readonly asked: TicketRunQuery;
}): ReactNode {
  const runs = useTicketRuns(props.held);
  const text = useCopyText();
  const step =
    runs === undefined || props.task === undefined
      ? undefined
      : ticketRunsFind(runs.cycles, props.task);
  return step === undefined ? (
    <EmptyState label={text({ id: "ticket-run-not-found" })} />
  ) : (
    <TicketRunFound held={props.held} step={step} asked={props.asked} />
  );
}

/** The run a task's number names, on the sub-tab asked for where it offers
 * it, beside the rail of every run the ticket holds. */
export function TicketRunAt(props: {
  readonly task: number | undefined;
  readonly asked: TicketRunQuery;
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
  return <TicketRunAt task={ticketRunTaskOf(params.task)} asked={query} />;
}
