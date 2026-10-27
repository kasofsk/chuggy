/**
 * One thread's own page: its conversation as a column to read, under a bar
 * that names it and offers on it what the chat pane offers.
 *
 * The frame draws no chat pane here, so a thread of the reader's own is never
 * drawn twice with two composers. Whose thread it is, is the read's own
 * `mine`, so another member's is drawn with no composer.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
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
  const state = useThread(props.partition, props.session);
  const viewOnly = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "mutate",
  );
  if (state.state !== "Ready")
    return (
      <>
        <ScreenTitle>Thread</ScreenTitle>
        <PanelUnready state={state} />
      </>
    );
  return (
    <>
      <TopBarSlot>
        <div className="flex min-w-0 flex-1 flex-wrap items-center">
          <ChatPaneThreadActions
            partition={props.partition}
            thread={state.value}
            viewOnly={viewOnly}
            at="Page"
          />
        </div>
      </TopBarSlot>
      <div className="chat-reading flex min-h-0 min-w-0 flex-1 flex-col">
        <ThreadConversation partition={props.partition} thread={state.value} />
      </div>
    </>
  );
}
