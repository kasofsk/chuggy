/**
 * One thread's own page: its conversation as a column to read, under a bar
 * that names it and offers on it what the chat pane offers.
 *
 * The frame draws no chat pane here, so a thread of the reader's own is never
 * drawn twice with two composers. Whose thread it is, is the read's own
 * `mine`, so another member's is drawn with no composer. Its bar's Context
 * opens what the thread's model holds beside the conversation.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import { threadHomeOf } from "../core/threadHome.ts";
import {
  ContextToggle,
  ThreadContextPanel,
} from "./context/SessionContext.tsx";
import { PanelUnready } from "./DataPanel.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ChatPaneThreadActions } from "./shell/ChatPaneHistory.tsx";
import { ScreenTitle, TopBarSlot } from "./shell/slots.tsx";
import { ThreadConversation } from "./thread/ThreadConversation.tsx";
import { useThread } from "./thread/threadRead.ts";

import "./shell/shell.css";

export function ThreadPage(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
}): ReactNode {
  const text = useCopyText();
  const state = useThread(props.partition, props.session);
  const [context, setContext] = useState(false);
  const viewOnly = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "mutate",
  );
  if (state.state !== "Ready")
    return (
      <>
        <ScreenTitle>{text({ id: "chat-heading" })}</ScreenTitle>
        <PanelUnready state={state} />
      </>
    );
  return (
    <>
      <TopBarSlot>
        <div className="flex min-w-0 flex-1 flex-wrap items-center">
          <ChatPaneThreadActions
            home={threadHomeOf(props.partition)}
            thread={state.value}
            viewOnly={viewOnly}
            at="Page"
          />
        </div>
        <ContextToggle open={context} onToggle={setContext} />
      </TopBarSlot>
      <div
        className="chat-reading context-beside flex min-h-0 min-w-0 flex-1"
        data-open={context}
      >
        <ThreadConversation
          partition={props.partition}
          thread={state.value}
          beside={
            context
              ? (held) => (
                  <ThreadContextPanel
                    home={threadHomeOf(props.partition)}
                    thread={state.value}
                    held={held}
                    onClose={() => {
                      setContext(false);
                    }}
                  />
                )
              : undefined
          }
        />
      </div>
    </>
  );
}
