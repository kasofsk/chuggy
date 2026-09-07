/**
 * One member's thread: whose it is, where it stands, what has been said in it,
 * and what its session has recorded.
 *
 * THIS PAGE RE-READS ON A `Session` FRAME AND FOLDS NOTHING. The frame is a
 * pointer: migrations 059 and 075 write a JSON object naming the session and
 * the turn, the batch or the state that moved, and the change log answers no
 * representation for the kind. So there is no body to fold — a page that tried
 * would keep the turn it opened with while the thread went on answering — and
 * what the frame supplies is only which session to ask about again.
 *
 * A FRAME NAMING ANOTHER SESSION LEAVES THIS PAGE ALONE. A project holds a
 * session per member beside its lead, so a page that re-read on every `Session`
 * frame would re-read every thread's page on every other thread's turn.
 *
 * THE COMPOSER IS THE READ'S OWN `mine` AND NOTHING THIS BROWSER DECIDED.
 * Nothing under `ui/chuggy-ui/` names a principal or decodes a token, so whose
 * thread this is can only be the server's answer — and the message door refuses
 * another member's thread whatever this page draws.
 *
 * THE CLOSE IS OFFERED FROM THE READ'S OWN STANDING AND TO ANY READER, because
 * the door is the project's `Mutate` and not the thread's owner. A frame from
 * the close is what takes the control away again.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../src/contract/responses.ts";
import { apiThread } from "../core/apiRoutes.ts";
import { conversationExchanges } from "../core/conversation.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  leadSessionNamed,
  leadStreamBatches,
  leadStreamListed,
} from "../core/leadTranscript.ts";
import { projectListRereadNamed } from "../core/projectQueryKeys.ts";
import {
  sessionConversationItems,
  sessionConversationTurns,
} from "../core/sessionConversation.ts";
import { threadClosable, threadTakesMessages } from "../core/threads.ts";
import { threadStandingTone } from "../core/tones.ts";
import { usePanelList } from "./api.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { PanelUnready } from "./DataPanel.tsx";
import { useLeadTranscript } from "./lead/LeadTranscript.tsx";
import { DetailsSlot, TopBarSlot } from "./shell/slots.tsx";
import { ThreadClose } from "./thread/ThreadClose.tsx";
import { useThreadSend } from "./thread/threadSend.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, Fields } from "./ui/Fields.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Pill } from "./ui/Pill.tsx";

/** The list entry one thread page keeps, named by the session it draws so two
 * threads open in two tabs are two entries and not one. */
export function threadListName(session: string): string {
  return `thread-${session}`;
}

/** The thread read, re-read on the `Session` frames that name this session and
 * left alone by the rest. The session is the address bar's, so unlike the lead's
 * panel there is nothing to learn from the read and nothing to keep. */
export function useThread(
  partition: PartitionIdentity,
  session: string,
): PanelState<ThreadResponse> {
  return usePanelList(
    projectListRereadNamed<ThreadResponse>(
      partition,
      "Session",
      threadListName(session),
      (change) => leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiThread(ports, partition, session),
  );
}

/** The bar's own title, the thread's standing, whether it is the reader's own,
 * and whose it is otherwise. */
function ThreadTopBar(props: { readonly thread: ThreadResponse }): ReactNode {
  const thread = props.thread;
  return (
    <TopBarSlot>
      <h1 className="text-md font-strong text-ink-1 truncate">Thread</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Pill tone={threadStandingTone(thread.state)} emphasis>
          {thread.state}
        </Pill>
        {thread.mine ? <Pill tone="live">Yours</Pill> : null}
        {thread.owner === undefined ? null : (
          <Identity label={{ text: thread.owner, title: thread.owner }} />
        )}
      </div>
    </TopBarSlot>
  );
}

/** What the thread is beside the conversation: its standing, whose it is, the
 * store it writes to, and the close any reader may press. Hidden by default —
 * a member reading their own thread came for the conversation. */
function ThreadDetails(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse;
}): ReactNode {
  const thread = props.thread;
  return (
    <DetailsSlot>
      <Fields>
        <Field name="State">
          <Pill tone={threadStandingTone(thread.state)} emphasis>
            {thread.state}
          </Pill>
        </Field>
        <Field name="Owner" absent={thread.owner === undefined}>
          {thread.owner ?? "None"}
        </Field>
        <Field name="Reference" absent={thread.agentReference === undefined}>
          {thread.agentReference ?? "None"}
        </Field>
      </Fields>
      {threadClosable(thread) ? (
        <ThreadClose
          partition={props.partition}
          session={thread.session}
          variant="danger"
        />
      ) : null}
    </DetailsSlot>
  );
}

/**
 * THE CONVERSATION IS THE TRANSCRIPT WITH THE MAILBOX OVER IT. The store holds
 * everything that was said and the mailbox holds what the transcript cannot —
 * a turn nobody has claimed, the word a failure ended on, the measures — and
 * the two meet by the input text the worker handed the runtime verbatim.
 */
function ThreadBody(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly state: PanelState<ThreadResponse>;
}): ReactNode {
  const thread = props.state.state === "Ready" ? props.state.value : undefined;
  const held = useLeadTranscript({
    partition: props.partition,
    session: props.session,
    stream: thread?.agentReference,
    highWaterBatch: thread === undefined ? 0 : leadStreamBatches(thread),
  });
  const composer = useThreadSend({
    partition: props.partition,
    session: props.session,
    takes: thread !== undefined && threadTakesMessages(thread),
  });
  if (thread === undefined) return <PanelUnready state={props.state} />;
  return (
    <>
      <ThreadTopBar thread={thread} />
      <ThreadDetails partition={props.partition} thread={thread} />
      <div
        role="region"
        aria-label="Conversation"
        className="flex-1 min-h-0 min-w-0"
      >
        <Conversation
          exchanges={conversationExchanges(
            sessionConversationItems({
              held,
              stream: thread.agentReference,
              listed: leadStreamListed(thread),
            }),
            sessionConversationTurns(thread.turns),
          )}
          {...(thread.mine ? { composer } : {})}
          partition={props.partition}
          empty="Nothing said"
        />
      </div>
    </>
  );
}

export function ThreadPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/threads/$session" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const session = params.session;
  const state = useThread(partition, session);
  if (state.state === "Absent")
    return <EmptyState label="No thread" variant="page" />;
  return (
    <ThreadBody
      key={session}
      partition={partition}
      session={session}
      state={state}
    />
  );
}
