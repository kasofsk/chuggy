/**
 * The box a member types into their own thread, and nowhere else.
 *
 * IT DRAWS ONLY ON THE READER'S OWN THREAD. Another member's thread gets no
 * composer at all rather than a disabled one: reading someone else's thread is
 * the common case, and a greyed box on every page is a control a reader learns
 * to look past. Whose thread it is comes from the read's own `mine`, so this
 * component is never mounted on the strength of anything the browser worked out
 * about who is signed in.
 *
 * THE TURN IDENTITY BELONGS TO THE TEXT. A press that ended in a backlogged
 * mailbox keeps the text and the identity it minted, so pressing again reaches
 * the same row rather than queueing the message twice; editing the text
 * releases the identity, so a correction is a turn of its own instead of an
 * ordinal the mailbox already answered for what was corrected.
 *
 * WHAT THE LAST PRESS SAID IS ABOUT THE LAST PRESS. A wait or a refusal is
 * cleared when the text changes, because the line under the box would otherwise
 * report a backlog that a message nobody has sent yet has not met.
 *
 * A SENT MESSAGE ARRIVES ON THE PAGE THE WAY EVERY OTHER TURN DOES. Enqueuing
 * writes a `Session` change, the frame stales the thread read, and the read
 * answers with the turn — so this clears the box and refreshes nothing itself.
 * A second refresh path here would be a second account of what the mailbox
 * holds, and the one that mattered would be the one that went wrong quietly.
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
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
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

export function ThreadComposer(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  /** Whether the thread the read answered still takes messages, so a thread
   * already standing `Closed` or `Orphaned` is not a box a member types a
   * message into to learn that from the refusal. */
  readonly takes: boolean;
}): ReactNode {
  const ports = useApiPorts();
  const { partition, session } = props;
  const [text, setText] = useState("");
  const [held, setHeld] = useState<ThreadHeld | undefined>(undefined);
  const [send, setSend] = useState<ThreadSend>({ send: "Idle" });
  const ended = send.send === "Ended" || !props.takes;
  const sending = send.send === "Sending";
  const said = text.trim();
  const press = async (): Promise<void> => {
    const turn =
      threadTurnRetained(held, text) ??
      threadTurnMinted(drawBytes(threadTurnIdBytesCount));
    setSend({ send: "Sending" });
    const answered = await threadMessageSent(ports, partition, session, {
      turn,
      message: text,
    });
    setSend(answered);
    if (answered.send !== "Sent") {
      setHeld({ text, turn });
      return;
    }
    setHeld(undefined);
    setText("");
  };
  return (
    <div className="thread-composer">
      <label className="thread-composer-field">
        <span className="visually-hidden">Message</span>
        <textarea
          rows={4}
          value={text}
          maxLength={threadMessageCharsMax}
          disabled={ended}
          onChange={(event) => {
            setText(event.target.value);
            if (send.send === "Waiting" || send.send === "Refused")
              setSend({ send: "Idle" });
          }}
        />
      </label>
      <div className="thread-composer-foot">
        <span className="num thread-count">
          {text.length} / {threadMessageCharsMax}
        </span>
        <Button
          variant="primary"
          busy={sending}
          disabled={ended || sending || said.length === 0}
          onClick={() => {
            void press();
          }}
        >
          Send
        </Button>
        <ThreadSendNote send={send} />
      </div>
    </div>
  );
}
