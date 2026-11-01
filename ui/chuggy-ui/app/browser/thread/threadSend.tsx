/**
 * The composer of a member's own thread, made from the thread's record in the
 * store: what its door would answer, what a message may carry, and what the
 * last press ended as. What a press and a stop do is `threadSends.ts`'s, so
 * the pane, a thread's own page and the member page draw one record.
 *
 * WHAT IS KEPT IS TAKEN BY THE NEXT BOX DRAWN. A message the door handed back
 * while no box that pressed was drawn goes in the thread's box when one is,
 * said as its own last press, unless the thread takes nothing more.
 *
 * A REFUSAL IS SAID IN ONE LINE: what was not done, with no code of the API's.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import {
  imageMediaTypes,
  threadMessageCharsMax,
  threadMessageImagesMax,
} from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { memberChatDoor } from "../../core/memberChat.ts";
import { hostedRunsQuery } from "../../core/projectQueries.ts";
import { chatHostQuery } from "../../core/tenantQueries.ts";
import {
  threadHomeFromNamed,
  threadHomeNamed,
  threadHomeOf,
} from "../../core/threadHome.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import {
  threadKeptClosed,
  threadRefusalLine,
  threadSendingWithout,
  threadSendRecordName,
  threadSendShown,
  threadSendStanding,
} from "../../core/threads.ts";
import type {
  ThreadDoor,
  ThreadKept,
  ThreadSend,
  ThreadSending,
} from "../../core/threads.ts";
import type { SessionRunnerShort } from "../../core/sessionRunners.ts";
import { usePanelAnswers, usePanelState } from "../api.ts";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../conversation/Conversation.tsx";
import {
  ChatHostNotice,
  SessionRunnerNotice,
  useSessionPlacement,
  useSessionPlacementReads,
} from "../sessionPlacement.tsx";
import { useChatHost } from "../settings/MyChatHost.tsx";
import { useConsoleDispatch, useConsoleSelector } from "../store.ts";
import { Notice } from "../ui/Notice.tsx";
import {
  threadSendAt,
  threadSendFirstDrawn,
  threadSendIdledAt,
  threadSendKeptAttached,
  threadSendKeptClosed,
  threadSendKeptTaken,
  threadSendListedAt,
  threadSendPressed,
  threadStopPressed,
} from "./threadSends.ts";

/** What the reader's own thread door asks of them, from the reads that say. */
export function useThreadDoor(partition: PartitionIdentity): ThreadDoor {
  const hosted = usePanelState(hostedRunsQuery(partition));
  const placement = useSessionPlacement(partition);
  const reads = useSessionPlacementReads(partition);
  const read = placement.state === "Ready" ? placement.value : undefined;
  return {
    route: read?.thread.route,
    granted: hosted.state === "Ready" ? hosted.value.granted : undefined,
    runner: read?.runners.mine,
    reads,
  };
}

/** The door of the reader's own chat at their tenant: their chat host as its
 * read stands. No grant is asked of it: the server answers a member's own turn
 * as admitted or as wanting a runner, never as unhosted. */
export function useMemberThreadDoor(tenant: string): ThreadDoor {
  const host = useChatHost(tenant);
  const reads = usePanelAnswers(chatHostQuery(tenant).queryKey);
  return memberChatDoor(host, reads);
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

/** Why no runner can take a thread's turn now: a project's thread waits on
 * the reader's runners there, and their own chat on their chat host. */
export function ThreadRunnerNotice(props: {
  readonly home: ThreadHome;
  readonly short: SessionRunnerShort;
}): ReactNode {
  const { home } = props;
  return home.scope === "Project" ? (
    <SessionRunnerNotice
      partition={home.partition}
      session="Thread"
      short={props.short}
    />
  ) : (
    <ChatHostNotice tenant={home.tenant} short={props.short} />
  );
}

/** The one line a press is reported as, and nothing while it has not been
 * pressed: a composer that narrated its own idleness would be prose. */
function ThreadSendNote(props: {
  readonly home: ThreadHome;
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
      return <ThreadRunnerNotice home={props.home} short={send.send} />;
    case "Waiting":
    case "Ended":
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

/** What a thread's message carries as images: the message door's own bound,
 * and the types the upload admits. */
const threadSendAttaches = {
  countMax: threadMessageImagesMax,
  mediaTypes: imageMediaTypes,
};

/** What one thread's composer is made from, wherever the thread is kept. */
interface ThreadSendMade {
  /** Absent where the reader has no thread, which the first press opens. */
  readonly session: string | undefined;
  readonly takes: boolean;
  /** The turns the mailbox read lists, which a message sent is drawn until. */
  readonly listed?: readonly string[];
  /** The turns that read lists as ended, which a stop's refusal is said
   * until. */
  readonly ended?: readonly string[];
  /** The thread a first press opened, once its message is taken, told only
   * while the box that pressed is drawn. */
  readonly onStarted?: (session: string) => void;
}

/** What one project thread's composer is made from. */
export interface ThreadSendInput extends ThreadSendMade {
  readonly partition: PartitionIdentity;
}

/** What one thread of the reader's own chat hands its composer. */
export interface MemberThreadSendInput extends ThreadSendMade {
  readonly tenant: string;
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
  return useThreadSendAt(
    input,
    threadHomeOf(input.partition),
    useThreadDoor(input.partition),
  );
}

/** The composer of one thread of the reader's own chat, whose door is their
 * chat host and whose messages carry no images. */
export function useMemberThreadSend(
  input: MemberThreadSendInput,
): ThreadSendHeld {
  return useThreadSendAt(
    input,
    { scope: "Member", tenant: input.tenant },
    useMemberThreadDoor(input.tenant),
  );
}

const threadSendNothingListed: readonly string[] = [];

const threadSendNothingEnded: readonly string[] = [];

/** Whether the box this composer is drawn in is still drawn, which a press
 * that ends after the box went asks. */
function useThreadSendDrawn(): () => boolean {
  const drawn = useRef(false);
  useEffect(() => {
    drawn.current = true;
    return () => {
      drawn.current = false;
    };
  }, []);
  return useCallback(() => drawn.current, []);
}

/**
 * What the record lets go of for what is drawn: the messages the read lists,
 * what is kept for a thread that takes nothing more, and a first box's record
 * once no first box of its home is drawn.
 */
function useThreadSendLetGo(
  name: string,
  home: ThreadHome,
  made: {
    readonly first: boolean;
    readonly unlisted: boolean;
    readonly listed: readonly string[];
    readonly closed: boolean;
  },
): void {
  const dispatch = useConsoleDispatch();
  const { first, unlisted, listed, closed } = made;
  const named = threadHomeNamed(home);
  useEffect(() => {
    if (unlisted) dispatch(threadSendListedAt({ name, listed }));
  }, [unlisted, listed, name, dispatch]);
  useEffect(() => {
    if (closed) dispatch(threadSendKeptClosed(name));
  }, [closed, name, dispatch]);
  useEffect(() => {
    if (first)
      return dispatch(threadSendFirstDrawn(threadHomeFromNamed(named)));
    return undefined;
  }, [first, named, dispatch]);
}

/** What is kept for the thread, handed to its box. */
function threadSendBack(
  name: string,
  kept: ThreadKept | undefined,
  dispatch: ReturnType<typeof useConsoleDispatch>,
): ConversationComposerProps["back"] {
  if (kept === undefined) return undefined;
  return {
    text: kept.text,
    /** Read as the box puts the message back, since the images are the
     * store's `extra`'s and only a thunk reaches them. */
    get attached() {
      return dispatch(threadSendKeptAttached(kept.turns));
    },
    taken: () => {
      dispatch(threadSendKeptTaken(name));
    },
  };
}

function useThreadSendAt(
  input: ThreadSendMade,
  home: ThreadHome,
  door: ThreadDoor,
): ThreadSendHeld {
  const dispatch = useConsoleDispatch();
  const name = threadSendRecordName(home, input.session);
  const record = useConsoleSelector((state) => threadSendAt(state, name));
  const drawn = useThreadSendDrawn();
  const listed = input.listed ?? threadSendNothingListed;
  const sending = threadSendingWithout(record.sending, listed);
  const closed = threadKeptClosed(record, input.takes);
  useThreadSendLetGo(name, home, {
    first: input.session === undefined,
    unlisted: sending !== record.sending,
    listed,
    closed,
  });
  const stopping = useMemo(() => new Set(record.stopping), [record.stopping]);
  const send = threadSendShown(
    record.send,
    input.ended ?? threadSendNothingEnded,
  );
  const standing = threadSendStanding(send, input.takes, door);
  const idled = (): void => {
    dispatch(threadSendIdledAt({ name }));
  };
  const back = closed ? undefined : threadSendBack(name, record.kept, dispatch);
  const { onStarted } = input;
  const composer: ConversationComposerProps = {
    takes:
      input.takes && standing.send !== "Ended" && standing.send !== "Unhosted",
    charsMax: threadMessageCharsMax,
    ...(home.scope === "Project" ? { attaches: threadSendAttaches } : {}),
    onSend: async (text, attached): Promise<ConversationSent> => {
      const ended = await dispatch(
        threadSendPressed({
          home,
          session: input.session,
          text,
          attached,
          drawn,
        }),
      );
      if (ended.started !== undefined && drawn()) onStarted?.(ended.started);
      return ended.back ? "Kept" : "Sent";
    },
    onStop: (turn) => {
      if (send.send === "Refused") idled();
      return dispatch(
        threadStopPressed({ home, session: input.session, turn }),
      );
    },
    onEdit: () => {
      if (
        send.send === "Waiting" ||
        send.send === "Refused" ||
        send.send === "NoRunner"
      )
        idled();
    },
    note: <ThreadSendNote home={home} send={standing} />,
    holds: standing.send === "Unhosted",
    ...(back === undefined ? {} : { back }),
  };
  return { composer, sending, stopping, takenBack: record.takenBack };
}
