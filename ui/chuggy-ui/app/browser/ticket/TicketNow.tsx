/**
 * The run the ticket is on now: what the agent last said, the call it is
 * waiting on and the notes before it, opening into the run's whole
 * conversation. A stage that records no transcript, such as a command, is its
 * stage and how long it has been running.
 *
 * The execution is read under the key its ledger row reads it by, so a live
 * `Execution` frame lands in both and the card follows the same high-water
 * mark the row's transcript does. The run's prompt is read only once the
 * conversation is opened.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiExecution } from "../../core/apiRoutes.ts";
import { conversationArgumentLine } from "../../core/conversation.ts";
import { sinceFigure } from "../../core/figures.ts";
import {
  runNowAttempt,
  runNowAttemptLive,
  runNowCountsLine,
  runNowElapsedFigure,
  runNowOf,
  runNowStartedAt,
} from "../../core/runNow.ts";
import type { RunNow, RunNowAttempt, RunNowCall } from "../../core/runNow.ts";
import type { RunningNow } from "../../core/ticketSituation.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { RunConversation, useRunTranscript } from "../RunTranscript.tsx";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { MarkdownLine } from "../ui/MarkdownReport.tsx";

import "./ticket.css";

function TicketNowHead(props: {
  readonly running: RunningNow;
  readonly counts?: string | undefined;
  readonly observedAt?: string;
  readonly nowMs: number;
  readonly toggle?: ReactNode;
}): ReactNode {
  const said = [props.running.stage, props.running.run, props.counts];
  return (
    <div className="ticket-now-head">
      <span className="eyebrow text-tone-live">Now</span>
      <span className="text-ink-3 grow">
        {said.filter((part) => part !== undefined).join(" · ")}
      </span>
      {props.observedAt === undefined ? null : (
        <span className="text-ink-3">
          <Figure figure={sinceFigure(props.observedAt, props.nowMs)} />
        </span>
      )}
      {props.toggle}
    </div>
  );
}

function TicketNowRunning(props: {
  readonly since: string;
  readonly nowMs: number;
}): ReactNode {
  return (
    <div className="ticket-now-running">
      <p className="ticket-now-line">Running</p>
      <span className="text-ink-3">
        <Figure figure={runNowElapsedFigure(props.since, props.nowMs)} />
      </span>
    </div>
  );
}

function TicketNowCall(props: {
  readonly call: RunNowCall;
  readonly nowMs: number;
}): ReactNode {
  const call = props.call;
  return (
    <div className="ticket-now-call">
      <i
        aria-hidden="true"
        className="size-2 shrink-0 rounded-circle block bg-tone-live"
      />
      <code className="ticket-now-call-name">{call.name}</code>
      <code className="ticket-now-call-argument">
        {conversationArgumentLine(call.argument)}
      </code>
      <span className="text-ink-3">
        <Figure figure={runNowElapsedFigure(call.at, props.nowMs)} />
      </span>
    </div>
  );
}

/** The collapsed card: the newest note large, the call in flight, and the
 * notes before it, newest first and fading. */
function TicketNowSaid(props: {
  readonly now: RunNow;
  readonly since: string;
  readonly nowMs: number;
}): ReactNode {
  const { note, call, earlier } = props.now;
  return (
    <>
      {note === undefined ? (
        <TicketNowRunning since={props.since} nowMs={props.nowMs} />
      ) : (
        <p className="ticket-now-line">
          <MarkdownLine text={note.text} />
        </p>
      )}
      {call === undefined ? null : (
        <TicketNowCall call={call} nowMs={props.nowMs} />
      )}
      {earlier.length === 0 ? null : (
        <ol className="ticket-now-notes" aria-label="Earlier notes">
          {earlier.map((earlierNote, at) => (
            <li key={at}>
              <span className="ticket-now-note-at">
                <Figure
                  figure={sinceFigure(earlierNote.at ?? "", props.nowMs)}
                />
              </span>
              <span className="ticket-now-note-text">
                <MarkdownLine text={earlierNote.text} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function TicketNowToggle(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Button size="sm" expanded={props.open} onClick={props.onToggle}>
      {props.open ? "Hide conversation" : "Show conversation"}
    </Button>
  );
}

/** A run that records a transcript. It follows one attempt, so it is keyed by
 * it and a new attempt starts from nothing held. */
function TicketNowRun(props: {
  readonly partition: PartitionIdentity;
  readonly running: RunningNow;
  readonly attempt: RunNowAttempt;
  readonly observedAt: string;
  readonly highWaterBatch: number;
  readonly nowMs: number;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const execution = props.running.execution.execution;
  const walk = useRunTranscript({
    partition: props.partition,
    execution,
    attempt: props.attempt.attempt,
    highWaterBatch: props.highWaterBatch,
  });
  const live = runNowAttemptLive(props.attempt);
  const now = useMemo(() => runNowOf(walk.reading, live), [walk.reading, live]);
  const counts = runNowCountsLine(props.attempt.run?.turnsRecorded, now.notes);
  const onToggle = (): void => {
    setOpen(!open);
  };
  const toggle = <TicketNowToggle open={open} onToggle={onToggle} />;
  return (
    <section
      className={open ? "ticket-card ticket-now-open" : "ticket-card"}
      aria-label="Now"
    >
      <TicketNowHead
        running={props.running}
        counts={open ? counts : undefined}
        observedAt={props.observedAt}
        nowMs={props.nowMs}
        toggle={open ? toggle : null}
      />
      {open ? (
        <div className="ticket-now-conversation">
          <RunConversation
            partition={props.partition}
            execution={execution}
            attempt={props.attempt}
            walk={walk}
          />
        </div>
      ) : (
        <>
          {walk.held.failure === undefined ? null : (
            <PanelUnready
              state={{ state: "Failed", reason: walk.held.failure }}
            />
          )}
          <TicketNowSaid
            now={now}
            since={runNowStartedAt(props.running.execution, props.attempt)}
            nowMs={props.nowMs}
          />
          <div className="ticket-now-foot">
            {toggle}
            {counts === undefined ? null : (
              <span className="text-ink-3">{counts}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function TicketNow(props: {
  readonly partition: PartitionIdentity;
  readonly running: RunningNow;
  readonly nowMs: number;
}): ReactNode {
  const { partition, running } = props;
  const execution = running.execution;
  const state = usePanelResource(
    partition,
    "Execution",
    execution.execution,
    (ports) => apiExecution(ports, partition, execution.execution),
  );
  const attempt =
    state.state === "Ready" ? runNowAttempt(state.value) : undefined;
  const transcript = attempt?.run?.transcript;
  if (attempt !== undefined && transcript !== undefined)
    return (
      <TicketNowRun
        key={attempt.attempt}
        partition={partition}
        running={running}
        attempt={attempt}
        observedAt={transcript.observedAt}
        highWaterBatch={transcript.highWaterBatch}
        nowMs={props.nowMs}
      />
    );
  return (
    <section className="ticket-card" aria-label="Now">
      <TicketNowHead running={running} nowMs={props.nowMs} />
      <TicketNowRunning
        since={runNowStartedAt(execution, attempt)}
        nowMs={props.nowMs}
      />
      {state.state === "Absent" || state.state === "Failed" ? (
        <PanelUnready state={state} />
      ) : null}
    </section>
  );
}
