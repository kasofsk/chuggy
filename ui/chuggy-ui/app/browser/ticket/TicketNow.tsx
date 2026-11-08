/**
 * The run the ticket is on now: its step, its cycle and how long it has gone,
 * the one thing it is doing — the call it waits on, or else the newest thing
 * its agent said — and a link that watches its transcript on its own page.
 *
 * The execution is read under the key its run's row and page read it by, so a
 * live `Execution` frame lands in each and the card follows the same
 * high-water mark the run page's transcript does.
 *
 * A run of the reader's own that their runner may take, and has not begun,
 * says where it waits: on their runner, or on it coming back online where no
 * other runner may take it, or on their own account's agent where a pause
 * holds it. Only such a run reads the reader's runner.
 */

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ExecutionSummary } from "../../../../../src/contract/responses.ts";
import { conversationArgumentLine } from "../../core/conversation.ts";
import { executionQuery } from "../../core/executionQueries.ts";
import {
  runnerWait,
  runnerWaitPause,
  runnerWaitWord,
} from "../../core/myRunner.ts";
import {
  runNowAttempt,
  runNowAttemptLive,
  runNowOf,
  runNowStatus,
} from "../../core/runNow.ts";
import type { RunNowAttempt } from "../../core/runNow.ts";
import type { RunTimed } from "../../core/runTotals.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import type { RunningNow } from "../../core/ticketSituation.ts";
import { usePanelState } from "../api.ts";
import { AgentPause } from "../AgentPause.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { usePersonalRunner } from "../personalRunner.ts";
import { useRunTranscript } from "../RunTranscript.tsx";
import { ButtonLink } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunTime } from "./TicketRunTime.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

import "./ticket.css";

function TicketNowHead(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly running: RunningNow;
  readonly status: string;
  readonly run: RunTimed;
  readonly nowMs: number;
}): ReactNode {
  const { running } = props;
  const text = useCopyText();
  return (
    <div className="ticket-card-head">
      <TicketRunMarkDrawn mark="Spin" tone="live" />
      <strong className="ticket-card-title">
        {text({
          id: "ticket-now-title",
          args: { status: props.status, step: running.step },
        })}
      </strong>
      <span className="ticket-card-where">
        {`${text(cycleLabel(running.cycle))} · `}
        <TicketRunTime runs={[props.run]} nowMs={props.nowMs} />
      </span>
      <span className="ticket-card-action">
        <ButtonLink
          to="/$tenant/$project/tickets/$ticket/runs/$task"
          params={{
            ...props.partition,
            ticket: String(props.ticket),
            task: String(running.execution.task),
          }}
          search={{ view: "Transcript" }}
          size="sm"
        >
          {text({ id: "ticket-now-watch" })}
        </ButtonLink>
      </span>
    </div>
  );
}

/** The one thing a run that records a transcript is doing now. It follows one
 * attempt, so it is keyed by it and a new attempt starts from nothing held. */
function TicketNowLine(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: RunNowAttempt;
  readonly highWaterBatch: number;
}): ReactNode {
  const walk = useRunTranscript({
    partition: props.partition,
    execution: props.execution,
    attempt: props.attempt.attempt,
    highWaterBatch: props.highWaterBatch,
  });
  const live = runNowAttemptLive(props.attempt);
  const now = useMemo(() => runNowOf(walk.reading, live), [walk.reading, live]);
  const text = useCopyText();
  if (walk.held.failure !== undefined)
    return (
      <PanelUnready state={{ state: "Failed", failure: walk.held.failure }} />
    );
  const doing =
    now.call === undefined
      ? now.note?.text
      : `${now.call.name} · ${conversationArgumentLine(now.call.argument)}`;
  return doing === undefined ? null : (
    <p className="ticket-card-line">
      {text({ id: "ticket-now-prefix", args: { doing } })}
    </p>
  );
}

/** A run of the reader's held for their own runners, with where they are
 * managed; or, where their own account has its agent paused, the pause and
 * where it is set. */
function TicketNowRunnerWait(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionSummary;
  readonly nowMs: number;
}): ReactNode {
  const runner = usePersonalRunner(props.partition.tenant);
  const text = useCopyText();
  const wait = runnerWait(
    props.execution,
    runner.state === "Ready" ? runner.value : undefined,
    props.partition.project,
  );
  if (wait === undefined) return null;
  const paused = runnerWaitPause(props.execution, wait);
  if (paused !== undefined)
    return (
      <AgentPause pause={paused} nowMs={props.nowMs}>
        {" · "}
        <Link to={settingsRoutes.project.usage} params={props.partition}>
          {text({ id: "ticket-tab-usage" })}
        </Link>
      </AgentPause>
    );
  return (
    <Notice tone="parked" inline detail={text(runnerWaitWord(wait))}>
      <span className="text-ink-3">
        {" · "}
        <Link to={settingsRoutes.project.myRunner} params={props.partition}>
          {text({ id: "ticket-now-personal-runners" })}
        </Link>
      </span>
    </Notice>
  );
}

export function TicketNow(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly running: RunningNow;
  readonly nowMs: number;
}): ReactNode {
  const { partition, running } = props;
  const execution = running.execution;
  const state = usePanelState(
    executionQuery(partition, execution.execution, "Streamed"),
  );
  const read = state.state === "Ready" ? state.value : undefined;
  const attempt = read === undefined ? undefined : runNowAttempt(read);
  const summary = read ?? execution;
  const transcript = attempt?.run?.transcript;
  const text = useCopyText();
  return (
    <section
      className="ticket-card"
      data-tone="live"
      aria-label={text({ id: "ticket-now-aria-label" })}
    >
      <TicketNowHead
        partition={partition}
        ticket={props.ticket}
        running={running}
        status={text(runNowStatus(summary))}
        run={summary}
        nowMs={props.nowMs}
      />
      {attempt === undefined || transcript === undefined ? null : (
        <TicketNowLine
          key={attempt.attempt}
          partition={partition}
          execution={execution.execution}
          attempt={attempt}
          highWaterBatch={transcript.highWaterBatch}
        />
      )}
      {summary.mine === true && summary.ownerFallback !== undefined ? (
        <TicketNowRunnerWait
          partition={partition}
          execution={summary}
          nowMs={props.nowMs}
        />
      ) : null}
      {state.state === "Absent" || state.state === "Failed" ? (
        <PanelUnready state={state} />
      ) : null}
    </section>
  );
}
