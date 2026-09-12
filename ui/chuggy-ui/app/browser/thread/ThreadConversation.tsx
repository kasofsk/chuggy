/**
 * One thread's conversation, wherever it is drawn: the transcript with the
 * mailbox over it, and the composer where the thread is the reader's own.
 *
 * The store holds everything that was said and the mailbox holds what the
 * transcript cannot — a turn nobody has claimed, the word a failure ended on,
 * the measures — and the two meet by the input text the worker handed the
 * runtime verbatim. The thread page draws this in the middle of the shell and
 * the chat pane draws it in its own column, so it takes a thread already read
 * and reaches for nothing about where it sits.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import { conversationExchanges } from "../../core/conversation.ts";
import {
  leadStreamBatches,
  leadStreamListed,
} from "../../core/leadTranscript.ts";
import {
  sessionConversationItems,
  sessionConversationTurns,
} from "../../core/sessionConversation.ts";
import { threadTakesMessages } from "../../core/threads.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { useLeadTranscript } from "../lead/LeadTranscript.tsx";
import { useConversationMentions } from "./threadMentions.ts";
import { useThreadSend } from "./threadSend.tsx";

export function ThreadConversation(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse;
  /** Whether the reader named this thread rather than arriving at it, which is
   * what puts the caret in the composer as it mounts. */
  readonly named?: boolean;
}): ReactNode {
  const thread = props.thread;
  const walked = useLeadTranscript({
    partition: props.partition,
    session: thread.session,
    stream: thread.agentReference,
    highWaterBatch: leadStreamBatches(thread),
  });
  const composer = useThreadSend({
    partition: props.partition,
    session: thread.session,
    takes: threadTakesMessages(thread),
  });
  const mentions = useConversationMentions(props.partition);
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="min-h-0 min-w-0 flex-1"
    >
      <Conversation
        exchanges={conversationExchanges(
          sessionConversationItems({
            held: walked.held,
            stream: thread.agentReference,
            listed: leadStreamListed(thread),
            turned: thread.turns.length > 0,
          }),
          sessionConversationTurns(thread.turns),
        )}
        {...(thread.mine
          ? {
              composer: {
                ...composer,
                focusOnMount: props.named === true,
                mentions,
              },
            }
          : {})}
        reading={walked.reading}
        pane
      />
    </div>
  );
}
