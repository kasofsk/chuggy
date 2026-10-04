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
 */

import { useEffect, useRef, useState } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  conversationLiveHeard,
  conversationLiveNothing,
} from "../../core/conversationLive.ts";
import type { ConversationLiveHeld } from "../../core/conversationLive.ts";
import { openThreadLiveStream } from "../../core/threadLiveStream.ts";
import { useSessionGeneration } from "../session.tsx";
import { useStreamPorts } from "../stream.tsx";

export function useThreadLive(read: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  /** Whether the thread's newest turn is still out. */
  readonly open: boolean;
}): ConversationLiveHeld {
  const ports = useStreamPorts();
  const generation = useSessionGeneration();
  const heard = useRef(conversationLiveNothing);
  const frame = useRef<number | undefined>(undefined);
  const [held, setHeld] = useState(conversationLiveNothing);
  const { tenant, project } = read.partition;
  const { session, open } = read;
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
        heard.current = conversationLiveHeard(heard.current, event);
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
  return held;
}
