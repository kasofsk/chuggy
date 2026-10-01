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
 *
 * A READER WITH NO THREAD STILL HAS A COMPOSER. Their first press opens one and
 * sends to it, and a press after a failed send reaches the thread that press
 * opened rather than opening another.
 *
 * THE GRANT IS ASKED ONLY WHERE THE THREAD RUNS IN CLUSTER. On runners the door
 * asks for a runner of the reader's own instead, so the box takes a message
 * whatever the grant and says when no runner of theirs could take the turn.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { threadMessageCharsMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiHostedRuns, apiOpenThread } from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { threadMessageSent } from "../../core/threadSendRun.ts";
import {
  threadSendStanding,
  threadUnhosted,
  threadTurnIdBytesCount,
  threadTurnMinted,
  threadTurnRetained,
} from "../../core/threads.ts";
import type { ThreadDoor, ThreadSend } from "../../core/threads.ts";
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
  useSessionPlacementStale,
} from "../sessionPlacement.tsx";
import { Notice } from "../ui/Notice.tsx";

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
 * the next poll.
 */
export function useThreadDoor(partition: PartitionIdentity): {
  readonly door: ThreadDoor;
  readonly learnt: (granted: boolean) => void;
  readonly refused: () => void;
} {
  const hosted = useHostedRuns(partition);
  const placement = useSessionPlacement(partition);
  const refused = useSessionPlacementStale(partition);
  const read = placement.state === "Ready" ? placement.value : undefined;
  return {
    door: {
      route: read?.thread.route,
      granted: hosted.granted,
      runner: read?.runners.mine,
    },
    learnt: hosted.learnt,
    refused,
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
      return (
        <Notice tone="danger" inline detail={`Refused · ${send.reason}`} />
      );
  }
}

/**
 * The composer one thread hands the surface: what the door still takes, what a
 * message may carry, and what a press ended as. A door that answered `Ended`
 * takes nothing more whatever the read said, because the read that drew this
 * page is older than the refusal; one the hosted grant refused, at a press or
 * in its read before anything is typed, takes nothing more either, and holds
 * any text it handed back, read-only.
 */
export function useThreadSend(input: {
  readonly partition: PartitionIdentity;
  /** Absent where the reader has no thread, which the first press opens. */
  readonly session: string | undefined;
  readonly takes: boolean;
  /** The thread a first press opened, once its message is sent. */
  readonly onStarted?: (session: string) => void;
}): ConversationComposerProps {
  const ports = useApiPorts();
  const { partition } = input;
  const [held, setHeld] = useState<ThreadHeld | undefined>(undefined);
  const [send, setSend] = useState<ThreadSend>({ send: "Idle" });
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const standing = threadSendStanding(
    send,
    input.takes,
    useThreadDoor(partition).door,
  );
  return {
    takes:
      input.takes && standing.send !== "Ended" && standing.send !== "Unhosted",
    charsMax: threadMessageCharsMax,
    onSend: async (text: string): Promise<ConversationSent> => {
      const turn =
        threadTurnRetained(held, text) ??
        threadTurnMinted(drawBytes(threadTurnIdBytesCount));
      setSend({ send: "Sending" });
      let session = input.session ?? opened;
      if (session === undefined) {
        const open = await apiOpenThread(ports, partition);
        if (threadUnhosted(open)) {
          setSend({ send: "Unhosted" });
          return "Kept";
        }
        if (sessionRefusedNoRunner(open)) {
          setSend({ send: "NoRunner" });
          return "Kept";
        }
        if (open.outcome !== "Ok") {
          setSend({ send: "Refused", reason: panelReason(open) });
          return "Kept";
        }
        session = open.value.session;
        setOpened(session);
      }
      const answered = await threadMessageSent(ports, partition, session, {
        turn,
        message: text,
      });
      setSend(answered);
      if (answered.send === "Sent") {
        setHeld(undefined);
        if (input.session === undefined) input.onStarted?.(session);
        return "Sent";
      }
      setHeld({ text, turn });
      return "Kept";
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
  };
}
