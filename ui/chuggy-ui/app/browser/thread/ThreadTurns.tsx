/**
 * One thread's conversation: what was put in each turn, and what came back.
 *
 * A TURN STILL IN THE MAILBOX DRAWS NO ANSWER BLOCK. An empty block below a
 * question reads as an answer of nothing, which is the one thing a page must
 * not say about a turn nobody has claimed yet; the state pill is what says
 * where it is instead.
 *
 * A WAKE IS DRAWN AS ITS POINTER. The input of a wake turn is the document the
 * runtime composed — a reason, a resource and the standing rule the agent is
 * bound by — and none of that is copy for a reader: the rule is an instruction
 * to the thread, and the JSON is not something a member typed. So a wake draws
 * its reason and its resource on one line, and a document those cannot be read
 * out of draws as the bare kind rather than as its own text.
 */

import type { ReactNode } from "react";

import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import type { ThreadTurnResponse } from "../../../../../src/contract/responses.ts";
import {
  costFigure,
  durationFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import { threadTurnAnswer, threadWakeDrawn } from "../../core/threads.ts";
import { sessionTurnStateTone } from "../../core/tones.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";

/** What the pod measured of one turn, each absent measure said as an absence. */
function ThreadTurnMeasures(props: {
  readonly turn: ThreadTurnResponse;
}): ReactNode {
  const turn = props.turn;
  return (
    <span className="thread-measures">
      <Figure
        figure={
          turn.tokens === undefined
            ? { kind: "Absent", why: "No tokens measured" }
            : tokenCountFigure(turn.tokens)
        }
      />
      <Figure
        figure={
          turn.costMicros === undefined
            ? { kind: "Absent", why: "No cost measured" }
            : costFigure(turn.costMicros, "List")
        }
      />
      <Figure
        figure={
          turn.durationMs === undefined
            ? { kind: "Absent", why: "No duration measured" }
            : durationFigure(turn.durationMs)
        }
      />
    </span>
  );
}

/** What went into the turn: a wake's pointer, or the characters a member typed. */
function ThreadTurnInput(props: {
  readonly turn: ThreadTurnResponse;
}): ReactNode {
  const turn = props.turn;
  if (turn.inputKind !== "Wake")
    return <pre className="thread-said">{turn.input}</pre>;
  const wake = threadWakeDrawn(turn.input);
  return wake === undefined ? null : (
    <p className="thread-wake">
      <span className="eyebrow">{wake.wake}</span>
      <span className="num">{wake.resource}</span>
    </p>
  );
}

function ThreadTurnAnswer(props: {
  readonly turn: ThreadTurnResponse;
}): ReactNode {
  const answer = threadTurnAnswer(props.turn);
  switch (answer.answer) {
    case "Awaiting":
    case "None":
      return null;
    case "Result":
      return <pre className="thread-answer">{answer.text}</pre>;
    case "Failure":
      return <Notice tone="danger" inline detail={answer.failure} />;
  }
}

function ThreadTurn(props: { readonly turn: ThreadTurnResponse }): ReactNode {
  const turn = props.turn;
  return (
    <article className="thread-turn">
      <header className="thread-turn-head">
        <span className="num">{turn.ordinal}</span>
        <span className="eyebrow">{turn.inputKind}</span>
        <Pill tone={sessionTurnStateTone(turn.state)}>{turn.state}</Pill>
        <ThreadTurnMeasures turn={turn} />
      </header>
      <ThreadTurnInput turn={turn} />
      <ThreadTurnAnswer turn={turn} />
    </article>
  );
}

/** The mailbox tail the read answered with, oldest first. */
export function ThreadTurns(props: {
  readonly thread: ThreadResponse;
}): ReactNode {
  if (props.thread.turns.length === 0) return <EmptyState label="No turns" />;
  return (
    <div className="thread-turns">
      {props.thread.turns.map((turn) => (
        <ThreadTurn key={turn.turn} turn={turn} />
      ))}
    </div>
  );
}
