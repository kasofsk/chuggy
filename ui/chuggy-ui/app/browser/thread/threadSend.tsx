/**
 * What one press of Send does on a member's own thread, which with
 * `threadStop.ts` is the only part of the conversation surface that knows the
 * API.
 *
 * THE TURN IDENTITY BELONGS TO THE TEXT. A press that ended in a backlogged
 * mailbox keeps the text and the identity it minted, so pressing again reaches
 * the same row rather than queueing the message twice; editing the text
 * releases the identity, so a correction is a turn of its own instead of an
 * ordinal the mailbox already answered for what was corrected.
 *
 * A SENT MESSAGE ARRIVES ON THE PAGE THE WAY EVERY OTHER TURN DOES. Enqueuing
 * writes a `Session` change, the frame stales the thread read, and the read
 * answers with the turn — so this refreshes nothing itself. A second refresh
 * path here would be a second account of what the mailbox holds, and the one
 * that mattered would be the one that went wrong quietly.
 *
 * UNTIL IT DOES, THE PAGE HOLDS IT. A press is drawn at once, under the turn
 * it was minted, so the read that lists that turn finds its message already
 * there; a press the door refused is held no longer, since its text is back
 * in the box.
 *
 * A READER WITH NO THREAD STILL HAS A COMPOSER. Their first press opens one and
 * sends to it, and a press after a failed send reaches the thread that press
 * opened rather than opening another.
 *
 * THE GRANT IS ASKED ONLY WHERE THE THREAD RUNS IN CLUSTER. On runners the door
 * asks for a runner of the reader's own instead, so the box takes a message
 * whatever the grant and says when no runner of theirs could take the turn.
 *
 * A MESSAGE CAN BE STOPPED FROM ITS PRESS. Each send on its way is handed to
 * the thread's stops for one to follow, so the button is Stop before the door
 * has answered, in a thread that press is opening as in one already open.
 *
 * A REFUSAL THAT ARRIVES AFTER THE THREAD LEFT THE SCREEN IS KEPT FOR IT. The
 * reader chose another thread while the door held the message, so the box
 * that would take the words back is gone: they are handed to whoever mounted
 * the thread, and the thread takes them as its own last press when it is next
 * drawn.
 *
 * A REFUSAL IS SAID IN ONE LINE AND FOR AS LONG AS IT IS ABOUT SOMETHING: what
 * was not done, with no code of the API's. It goes when the reader edits the
 * box or presses again, and a stop's goes when the mailbox lists its turn
 * ended, since nothing is left to stop.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { threadMessageCharsMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiHostedRuns, apiOpenThread } from "../../core/apiRoutes.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { threadMessageSent } from "../../core/threadSendRun.ts";
import {
  threadRefusalCause,
  threadRefusalLine,
  threadSendingWith,
  threadSendingWithout,
  threadSendRefused,
  threadSendStanding,
  threadUnhosted,
  threadTurnIdBytesCount,
  threadTurnMinted,
  threadTurnRetained,
} from "../../core/threads.ts";
import type {
  ThreadDoor,
  ThreadKept,
  ThreadSend,
  ThreadSending,
} from "../../core/threads.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../conversation/Conversation.tsx";
import { drawBytes } from "../ports.ts";
import {
  SessionRunnerNotice,
  useSessionPlacement,
  useSessionPlacementReads,
  useSessionPlacementStale,
} from "../sessionPlacement.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useThreadStop } from "./threadStop.ts";
import type { ThreadStopHeld } from "./threadStop.ts";

/** What the last press left behind, so the next one can tell a retry of the
 * same message from a message of its own. */
interface ThreadHeld {
  readonly text: string;
  readonly turn: string;
}

/** No frame names the grant, so the partition's own refetch reaches it, and a
 * thread door's answer is written over it as the newer word on the question. */
export const hostedRunsResource = "hosted-runs";

/** Whether the project's tenant grants the reader hosted runs, unknown until a
 * read has said, and where a door's own answer to the same question goes. */
export function useHostedRuns(partition: PartitionIdentity): {
  readonly granted: boolean | undefined;
  readonly learnt: (granted: boolean) => void;
} {
  const client = useQueryClient();
  const state = usePanelResource(
    partition,
    "Project",
    hostedRunsResource,
    (ports) => apiHostedRuns(ports, partition),
  );
  return {
    granted: state.state === "Ready" ? state.value.granted : undefined,
    learnt: (granted) => {
      client.setQueryData(
        projectResourceKey(partition, "Project", hostedRunsResource),
        { granted },
      );
    },
  };
}

/**
 * What the reader's own thread door asks of them, from the reads that say, and
 * where a door's refusal goes once it is newer than those reads: the grant as
 * `useHostedRuns` says, and the placement is read again rather than waiting on
 * the next poll, the refusal counting the reads before it.
 */
export function useThreadDoor(partition: PartitionIdentity): {
  readonly door: ThreadDoor;
  readonly learnt: (granted: boolean) => void;
  readonly refused: () => Promise<ThreadSend & { readonly send: "Unhosted" }>;
} {
  const hosted = useHostedRuns(partition);
  const placement = useSessionPlacement(partition);
  const reads = useSessionPlacementReads(partition);
  const stale = useSessionPlacementStale(partition);
  const read = placement.state === "Ready" ? placement.value : undefined;
  return {
    door: {
      route: read?.thread.route,
      granted: hosted.granted,
      runner: read?.runners.mine,
      reads,
    },
    learnt: hosted.learnt,
    refused: async () => ({ send: "Unhosted", readsAt: await stale() }),
  };
}

/** What a thread door refused for the tenant's hosted grant is drawn as,
 * whether the grant's read, the open or a send met it, and who gives it. */
export function ThreadUnhostedNotice(): ReactNode {
  return (
    <Notice tone="parked" inline detail="Needs hosted runs">
      <span className="text-ink-3"> · Granted by the operator</span>
    </Notice>
  );
}

/** The one line a press is reported as, and nothing while it has not been
 * pressed: a composer that narrated its own idleness would be prose. */
function ThreadSendNote(props: {
  readonly partition: PartitionIdentity;
  readonly send: ThreadSend;
}): ReactNode {
  const send = props.send;
  switch (send.send) {
    case "Idle":
    case "Sending":
    case "Sent":
      return null;
    case "Unhosted":
      return <ThreadUnhostedNotice />;
    case "NoRunner":
    case "RunnerOffline":
      return (
        <SessionRunnerNotice partition={props.partition} short={send.send} />
      );
    case "Waiting":
    case "Ended":
    case "Unsettled":
      return <Notice tone="parked" inline detail={send.why} />;
    case "Refused":
      return <Notice tone="danger" inline detail={threadRefusalLine(send)} />;
  }
}

/** What one thread hands the surface: its composer, the messages it sent that
 * the mailbox read does not list yet, and what it holds of its stops. */
export interface ThreadSendHeld {
  readonly composer: ConversationComposerProps;
  readonly sending: readonly ThreadSending[];
  /** The turns the reader stopped, less each press taken back. */
  readonly stopping: ReadonlySet<string>;
  /** How many presses of Stop the door's answer took back. */
  readonly takenBack: number;
}

/** The thread a first press opens, or what the door refused opening one as. */
async function threadSendOpened(
  ports: ReturnType<typeof useApiPorts>,
  partition: PartitionIdentity,
  door: ReturnType<typeof useThreadDoor>,
): Promise<{ readonly session: string } | ThreadSend> {
  const open = await apiOpenThread(ports, partition);
  if (threadUnhosted(open)) {
    door.learnt(false);
    return door.refused();
  }
  if (sessionRefusedNoRunner(open)) return { send: "NoRunner" };
  if (open.outcome !== "Ok") return threadSendRefused(threadRefusalCause(open));
  return { session: open.value.session };
}

/** One message sent to a thread, as the door answered it, a refusal over the
 * hosted grant being told to the door's own reads first. */
async function threadSendAnswered(
  ports: ReturnType<typeof useApiPorts>,
  partition: PartitionIdentity,
  door: ReturnType<typeof useThreadDoor>,
  sent: { readonly session: string } & ThreadSending,
): Promise<ThreadSend> {
  const answered = await threadMessageSent(ports, partition, sent.session, {
    turn: sent.turn,
    message: sent.text,
  });
  if (answered.send !== "Unhosted") return answered;
  door.learnt(false);
  return door.refused();
}

/** The messages sent that no turn the mailbox read lists names yet: each held
 * from its press, and no longer once a read lists its turn or the press ends
 * with its text kept. */
function useThreadSendSending(listed: readonly string[]): {
  readonly sending: readonly ThreadSending[];
  readonly pressed: (sent: ThreadSending) => void;
  readonly kept: (turn: string) => void;
} {
  const [sending, setSending] = useState<readonly ThreadSending[]>([]);
  const unlisted = threadSendingWithout(sending, listed);
  if (unlisted !== sending) setSending(unlisted);
  return {
    sending: unlisted,
    pressed: (sent) => {
      setSending((before) => threadSendingWith(before, sent));
    },
    kept: (turn) => {
      setSending((before) => threadSendingWithout(before, [turn]));
    },
  };
}

const threadSendNothingListed: readonly string[] = [];

/** Where a thread hands a message its door refused once the thread is no
 * longer drawn, and where it finds one handed there before. */
export interface ThreadKeptAway {
  readonly kept: ThreadKept | undefined;
  readonly keep: (kept: ThreadKept) => void;
  /** Said once the thread's box holds what was kept. */
  readonly taken: () => void;
}

/**
 * A thread's dealings with what is kept for it: `answered` hands a refusal on
 * where the thread is no longer drawn, and one found kept becomes the thread's
 * own last press and is handed to the box as `back`.
 */
function useThreadKeptAway(
  away: ThreadKeptAway | undefined,
  pressed: {
    readonly setSend: (send: ThreadSend) => void;
    readonly setHeld: (held: ThreadHeld | undefined) => void;
  },
): {
  readonly answered: (sent: ThreadSending, send: ThreadSend) => void;
  readonly back: ConversationComposerProps["back"];
} {
  const drawn = useRef(true);
  useEffect(() => {
    drawn.current = true;
    return () => {
      drawn.current = false;
    };
  }, []);
  const kept = away?.kept;
  const [last, setLast] = useState<ThreadKept | undefined>(undefined);
  if (kept !== undefined && kept !== last) {
    setLast(kept);
    pressed.setSend(kept.send);
    pressed.setHeld(
      kept.turn === undefined
        ? undefined
        : { text: kept.text, turn: kept.turn },
    );
  }
  return {
    answered: (sent, send) => {
      if (send.send !== "Sent" && !drawn.current) away?.keep({ ...sent, send });
    },
    back:
      away === undefined || kept === undefined
        ? undefined
        : { text: kept.text, taken: away.taken },
  };
}

/** What one thread's composer is made from. */
export interface ThreadSendInput {
  readonly partition: PartitionIdentity;
  /** Absent where the reader has no thread, which the first press opens. */
  readonly session: string | undefined;
  readonly takes: boolean;
  /** The turns the mailbox read lists, which a message sent is held until. */
  readonly listed?: readonly string[];
  /** The turns that read lists as ended, which a stop's refusal is said
   * until. */
  readonly ended?: readonly string[];
  /** The thread a first press opened, once its message is sent. */
  readonly onStarted?: (session: string) => void;
  /** What is kept for the thread while it is not drawn. */
  readonly away?: ThreadKeptAway | undefined;
}

/** The thread's stops, with one the door refused said in the composer's line
 * until the turn it was about has ended. */
function useThreadStopSaid(
  partition: PartitionIdentity,
  said: readonly [ThreadSend, (send: ThreadSend) => void],
  ended: readonly string[] | undefined,
): ThreadStopHeld {
  const [send, setSend] = said;
  const stops = useThreadStop({
    partition,
    onRefused: (turn, cause) => {
      setSend({
        send: "Refused",
        what: "Stop",
        turn,
        ...(cause === undefined ? {} : { cause }),
      });
    },
  });
  if (
    send.send === "Refused" &&
    send.what === "Stop" &&
    ended?.includes(send.turn) === true
  )
    setSend({ send: "Idle" });
  return stops;
}

/**
 * The composer one thread hands the surface: what the door still takes, what a
 * message may carry, and what a press ended as. A door that answered `Ended`
 * takes nothing more whatever the read said, because the read that drew this
 * page is older than the refusal; one the hosted grant refused, at a press or
 * in its read before anything is typed, takes nothing more until a read after
 * that says runners, and holds any text it handed back, read-only.
 */
export function useThreadSend(input: ThreadSendInput): ThreadSendHeld {
  const ports = useApiPorts();
  const { partition } = input;
  const [held, setHeld] = useState<ThreadHeld | undefined>(undefined);
  const [send, setSend] = useState<ThreadSend>({ send: "Idle" });
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const sends = useThreadSendSending(input.listed ?? threadSendNothingListed);
  const stops = useThreadStopSaid(partition, [send, setSend], input.ended);
  const door = useThreadDoor(partition);
  const away = useThreadKeptAway(input.away, { setSend, setHeld });
  const standing = threadSendStanding(send, input.takes, door.door);
  const pressed = async (sent: ThreadSending): Promise<string | undefined> => {
    let session = input.session ?? opened;
    if (session === undefined) {
      const open = await threadSendOpened(ports, partition, door);
      if ("send" in open) {
        setSend(open);
        return undefined;
      }
      session = open.session;
      setOpened(session);
    }
    const to = { session, ...sent };
    const answered = await threadSendAnswered(ports, partition, door, to);
    setSend(answered);
    setHeld(answered.send === "Sent" ? undefined : sent);
    away.answered(sent, answered);
    if (answered.send !== "Sent") return undefined;
    if (input.session === undefined) input.onStarted?.(session);
    return session;
  };
  const composer: ConversationComposerProps = {
    takes:
      input.takes && standing.send !== "Ended" && standing.send !== "Unhosted",
    charsMax: threadMessageCharsMax,
    onSend: async (text: string): Promise<ConversationSent> => {
      const turn =
        threadTurnRetained(held, text) ??
        threadTurnMinted(drawBytes(threadTurnIdBytesCount));
      setSend({ send: "Sending" });
      sends.pressed({ turn, text });
      const taken = await stops.flown(turn, pressed({ turn, text }));
      if (taken === undefined) sends.kept(turn);
      return taken === undefined ? "Kept" : "Sent";
    },
    onStop: (turn) => {
      if (send.send === "Refused") setSend({ send: "Idle" });
      return stops.stop(turn, input.session ?? opened);
    },
    onEdit: () => {
      if (
        send.send === "Waiting" ||
        send.send === "Refused" ||
        send.send === "NoRunner"
      )
        setSend({ send: "Idle" });
    },
    note: <ThreadSendNote partition={partition} send={standing} />,
    holds: standing.send === "Unhosted",
    ...(away.back === undefined ? {} : { back: away.back }),
  };
  return {
    composer,
    sending: sends.sending,
    stopping: stops.stopping,
    takenBack: stops.takenBack,
  };
}
