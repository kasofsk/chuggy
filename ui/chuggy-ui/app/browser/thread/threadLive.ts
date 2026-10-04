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
 * render and a tab nobody is looking at renders none.
 *
 * NOTHING IS SAID WHEN IT FAILS. The stream reports no status and this draws
 * none: a thread that hears nothing is drawn from its transcript alone.
 *
 * WHAT THE MAILBOX SAYS IS OVER IS LET GO OF HERE, in what is drawn and in
 * what the next event is folded onto, and every event is asked whether its
 * turn is one the mailbox has settled before it is folded at all, so nothing
 * forgotten is heard again.
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
  /** What a message first heard now is marked with. */
  readonly known: ConversationLiveKnown;
}): ConversationLiveHeld {
  const ports = useStreamPorts();
  const generation = useSessionGeneration();
  const heard = useRef(conversationLiveNothing);
  const known = useRef(read.known);
  const settled = useRef<ReadonlySet<string>>(new Set());
  const frame = useRef<number | undefined>(undefined);
  const [held, setHeld] = useState(conversationLiveNothing);
  const { tenant, project } = read.partition;
  const { session, open, turns, reached } = read;
  const kept = conversationLiveKept(held, turns, reached);
  if (kept !== held) setHeld(kept);
  const over = useMemo(() => conversationTurnsSettled(turns), [turns]);
  useEffect(() => {
    known.current = read.known;
    settled.current = over;
    heard.current = conversationLiveKept(heard.current, turns, reached);
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
        heard.current = conversationLiveHeard(
          heard.current,
          event,
          known.current,
          settled.current,
        );
        frame.current ??= requestAnimationFrame(() => {
          frame.current = undefined;
          setHeld(heard.current);
        });
      },
    );
    return () => {
      opened.stop();
    };
  }, [ports, generation, tenant, project, session, open]);
  return kept;
}
