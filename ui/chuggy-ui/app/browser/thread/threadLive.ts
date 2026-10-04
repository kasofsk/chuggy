/**
 * What one thread's session is writing, heard for as long as its newest turn
 * is out.
 *
 * THE CONNECTION IS HELD ONLY WHILE THERE IS SOMETHING TO HEAR. It opens when
 * the thread's newest turn is one the mailbox has not settled and is let go
 * when it settles, so a thread nobody is being answered in holds no request
 * open. What was heard outlives the connection, because the transcript may
 * still be catching up with it.
 *
 * WHAT IS HEARD IS DRAWN ONCE A FRAME. Every event is folded as it arrives and
 * the fold is handed to React at the next paint, so a burst of events is one
 * render and a tab nobody is looking at renders none. An event that changed
 * nothing held owes no frame: a post heard again, or one turned away.
 *
 * NOTHING IS SAID WHEN IT FAILS. The stream reports no status and this draws
 * none: a thread that hears nothing is drawn from its transcript alone, and a
 * stream its server cut is opened again and goes on from the snapshot.
 *
 * WHAT THE MAILBOX SAYS IS OVER IS LET GO OF HERE, in what is drawn and in
 * what the next event is folded onto, and every event is asked whether its
 * turn is one the mailbox has settled before it is folded at all, so nothing
 * forgotten is heard again.
 *
 * A TURN THE READER STOPPED IS TURNED AWAY FROM THE PRESS, as a settled one
 * is, so nothing written after the press is drawn. What it had heard stays,
 * and a press taken back opens the stream again, since what was turned away
 * meanwhile is in the snapshot.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ConversationTurn } from "../../core/conversation.ts";
import {
  conversationLiveHeard,
  conversationLiveKept,
  conversationLiveNothing,
  conversationTurnsSettled,
} from "../../core/conversationLive.ts";
import type {
  ConversationLiveHeld,
  ConversationLiveKnown,
} from "../../core/conversationLive.ts";
import { openThreadLiveStream } from "../../core/threadLiveStream.ts";
import { useSessionGeneration } from "../session.tsx";
import { useStreamPorts } from "../stream.tsx";

export function useThreadLive(read: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  /** Whether the thread's newest turn is still out. */
  readonly open: boolean;
  readonly turns: readonly ConversationTurn[];
  /** Whether the transcript walk has nothing left to read. */
  readonly reached: boolean;
  /** What a message held and not yet marked is marked with, which is nothing
   * until the walk has read everything. */
  readonly known: ConversationLiveKnown;
  /** The turns the reader stopped, less each press taken back. */
  readonly stopping: ReadonlySet<string>;
  /** How many presses were taken back, each of which opens the stream again. */
  readonly takenBack: number;
}): ConversationLiveHeld {
  const ports = useStreamPorts();
  const generation = useSessionGeneration();
  const heard = useRef(conversationLiveNothing);
  const settled = useRef<ReadonlySet<string>>(new Set());
  const frame = useRef<number | undefined>(undefined);
  const [held, setHeld] = useState(conversationLiveNothing);
  const { tenant, project } = read.partition;
  const { session, open, turns, reached, stopping, takenBack } = read;
  const kept = conversationLiveKept(held, turns, reached, read.known);
  if (kept !== held) setHeld(kept);
  const over = useMemo(
    () => new Set([...conversationTurnsSettled(turns), ...stopping]),
    [turns, stopping],
  );
  useEffect(() => {
    settled.current = over;
    heard.current = conversationLiveKept(
      heard.current,
      turns,
      reached,
      read.known,
    );
  });
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const opened = openThreadLiveStream(
      ports,
      { tenant, project },
      session,
      (event) => {
        const next = conversationLiveHeard(
          heard.current,
          event,
          settled.current,
        );
        if (next === heard.current) return;
        heard.current = next;
        frame.current ??= requestAnimationFrame(() => {
          frame.current = undefined;
          setHeld(heard.current);
        });
      },
    );
    return () => {
      opened.stop();
    };
  }, [ports, generation, tenant, project, session, open, takenBack]);
  return kept;
}
