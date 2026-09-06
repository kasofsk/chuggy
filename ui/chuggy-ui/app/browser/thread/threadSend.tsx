/**
 * What one press of Send does on a member's own thread, which is the only part
 * of the conversation surface that knows the API.
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
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { threadMessageCharsMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { threadMessageSent } from "../../core/threadSendRun.ts";
import {
  threadTurnIdBytesCount,
  threadTurnMinted,
  threadTurnRetained,
} from "../../core/threads.ts";
import type { ThreadSend } from "../../core/threads.ts";
import { useApiPorts } from "../api.ts";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../conversation/Conversation.tsx";
import { drawBytes } from "../ports.ts";
import { Notice } from "../ui/Notice.tsx";

/** What the last press left behind, so the next one can tell a retry of the
 * same message from a message of its own. */
interface ThreadHeld {
  readonly text: string;
  readonly turn: string;
}

/** The one line a press is reported as, and nothing while it has not been
 * pressed: a composer that narrated its own idleness would be prose. */
function ThreadSendNote(props: { readonly send: ThreadSend }): ReactNode {
  const send = props.send;
  switch (send.send) {
    case "Idle":
    case "Sending":
    case "Sent":
      return null;
    case "Waiting":
    case "Ended":
    case "Unsettled":
      return <Notice tone="parked" inline detail={send.why} />;
    case "Refused":
      return (
        <Notice tone="danger" inline detail={`Refused · ${send.reason}`} />
      );
  }
}

/**
 * The composer one thread hands the surface: what the door still takes, what a
 * message may carry, and what a press ended as. A door that answered `Ended`
 * takes nothing more whatever the read said, because the read that drew this
 * page is older than the refusal.
 */
export function useThreadSend(input: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly takes: boolean;
}): ConversationComposerProps {
  const ports = useApiPorts();
  const { partition, session } = input;
  const [held, setHeld] = useState<ThreadHeld | undefined>(undefined);
  const [send, setSend] = useState<ThreadSend>({ send: "Idle" });
  return {
    takes: input.takes && send.send !== "Ended",
    charsMax: threadMessageCharsMax,
    onSend: async (text: string): Promise<ConversationSent> => {
      const turn =
        threadTurnRetained(held, text) ??
        threadTurnMinted(drawBytes(threadTurnIdBytesCount));
      setSend({ send: "Sending" });
      const answered = await threadMessageSent(ports, partition, session, {
        turn,
        message: text,
      });
      setSend(answered);
      if (answered.send === "Sent") {
        setHeld(undefined);
        return "Sent";
      }
      setHeld({ text, turn });
      return "Kept";
    },
    note: <ThreadSendNote send={send} />,
  };
}
