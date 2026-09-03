/**
 * One thread's conversation: what was put in each turn, and what came back.
 *
 * A TURN STILL IN THE MAILBOX DRAWS NO ANSWER BLOCK. An empty block below a
 * question reads as an answer of nothing, which is the one thing a page must
 * not say about a turn nobody has claimed yet; the state pill is what says
 * where it is instead.
 *
 * THE READ IS THE NEWEST PAGE AND THE READER WALKS BACK FROM IT. The mailbox
 * is answered newest-last with a `nextBefore` cursor, so what is live is the
 * page a `Session` frame re-reads and what a reader gathers behind it is held
 * beside it.
 *
 * A TAIL THAT SLID PAST THE SEAM DROPS WHAT WAS GATHERED BEHIND IT. Only the
 * newest page moves, and it moves by a turn arriving — which slides its cursor
 * forward and leaves the turn that was the boundary in neither range. Drawing
 * the union then omits a turn from the middle of a member's own conversation
 * and offers no way back to it, so the gathered set goes and the walk re-asks
 * from the boundary the new read names. What a reader keeps meanwhile is the
 * whole newest page, which is a contiguous conversation and not nothing.
 *
 * A WAKE IS DRAWN AS ITS POINTER. The input of a wake turn is the document the
 * runtime composed — a reason, a resource and the standing rule the agent is
 * bound by — and none of that is copy for a reader: the rule is an instruction
 * to the thread, and the JSON is not something a member typed. So a wake draws
 * its reason and its resource on one line, and a document those cannot be read
 * out of draws as the bare kind rather than as its own text.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ThreadResponse,
  ThreadTurnResponse,
} from "../../../../../src/contract/responses.ts";
import { apiThread } from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  costFigure,
  durationFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import {
  threadOlderAsked,
  threadOlderEmpty,
  threadOlderGathered,
  threadOlderHeld,
  threadTurnAnswer,
  threadTurnKindWord,
  threadTurnsDrawn,
  threadWakeDrawn,
} from "../../core/threads.ts";
import type { ThreadOlder } from "../../core/threads.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
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
        <span className="eyebrow">{threadTurnKindWord(turn.inputKind)}</span>
        <Pill tone={sessionTurnStateTone(turn.state)}>{turn.state}</Pill>
        <ThreadTurnMeasures turn={turn} />
      </header>
      <ThreadTurnInput turn={turn} />
      <ThreadTurnAnswer turn={turn} />
    </article>
  );
}

/** The control that walks one page further back, and nothing where the mailbox
 * has no older page or this one already holds what it will hold. */
function ThreadOlderControl(props: {
  readonly before: number | undefined;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onOlder: () => void;
}): ReactNode {
  if (props.before === undefined) return null;
  return (
    <div className="thread-older">
      <Button
        size="sm"
        busy={props.busy}
        disabled={props.busy}
        onClick={props.onOlder}
      >
        Older
      </Button>
      {props.failure === undefined ? null : (
        <Notice tone="danger" inline detail={`Failed · ${props.failure}`} />
      )}
    </div>
  );
}

/** The whole conversation the page holds: the live newest page, and whatever a
 * reader has walked back to behind it. */
export function ThreadTurns(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly thread: ThreadResponse;
}): ReactNode {
  const ports = useApiPorts();
  const [gathered, setGathered] = useState<ThreadOlder>(threadOlderEmpty);
  const [walking, setWalking] = useState(false);
  const older = threadOlderHeld(gathered, props.thread);
  const before = threadOlderAsked(older, props.thread);
  const turns = threadTurnsDrawn(older, props.thread);
  const walk = async (asked: number): Promise<void> => {
    setWalking(true);
    const answered = await apiThread(ports, props.partition, props.session, {
      before: asked,
    });
    setWalking(false);
    setGathered(
      answered.outcome === "Ok"
        ? threadOlderGathered(older, answered.value, props.thread)
        : { ...older, failure: panelReason(answered) },
    );
  };
  if (turns.length === 0) return <EmptyState label="No turns" />;
  return (
    <div className="thread-turns">
      <ThreadOlderControl
        before={before}
        busy={walking}
        failure={older.failure}
        onOlder={() => {
          if (before !== undefined) void walk(before);
        }}
      />
      {turns.map((turn) => (
        <ThreadTurn key={turn.turn} turn={turn} />
      ))}
    </div>
  );
}
