/**
 * The reader's own chat at their tenant, outside every project: a thread of
 * it as a column to read under a bar that names it, or the composer whose
 * first message opens one, and the history of their threads beside the bar.
 *
 * IT IS DRAWN ONLY WHERE THE WORKSPACE LETS THE READER CHAT OUTSIDE A PROJECT.
 * Every door of it answers as absent otherwise, so the page says who gives it
 * rather than drawing a chat that can only be refused.
 *
 * THE THREADS PROJECTS KEEP ARE A WAY THERE. The listing names each with its
 * project and nothing more, so the history offers each as a link to that
 * project's own thread page, where it is read.
 *
 * NO STREAM NAMES ANY OF IT. The listing and the thread drawn are polled, and
 * what the reader changes here is read again at once.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import {
  conversationExchangeSent,
  conversationExchangesStopped,
} from "../core/conversation.ts";
import {
  memberChatOpens,
  memberChatRoutes,
  memberChatThreadsParted,
  memberChatWithheld,
} from "../core/memberChat.ts";
import type { MemberChatProjectThread } from "../core/memberChat.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { PanelUnready } from "./DataPanel.tsx";
import { clipboardWritten, elapsedMs, syntaxWorkerOpened } from "./ports.ts";
import { SettingsListingWithheld } from "./settings/SettingsListing.tsx";
import { ChatPaneIcon } from "./shell/chatPaneIcons.tsx";
import {
  ChatPaneHistory,
  ChatPaneThreadActions,
} from "./shell/ChatPaneHistory.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { StreamPortsProvider } from "./stream.tsx";
import { MemberThreadConversation } from "./thread/ThreadConversation.tsx";
import {
  useChatAbilities,
  useMemberChatThreads,
  useMemberThread,
} from "./thread/threadRead.ts";
import { useMemberThreadSend } from "./thread/threadSend.tsx";
import { buttonLookClassName } from "./ui/Button.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { MarkdownProvider } from "./ui/markdownHeld.ts";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./shell/shell.css";

/** The bar's frame with no project in it, the page filling what is left. */
function MemberChatFrame(props: {
  readonly tenant: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <CopyProvider write={clipboardWritten}>
      <MarkdownProvider clock={elapsedMs} syntax={syntaxWorkerOpened}>
        <StreamPortsProvider>
          <div className="bg-surface-0 grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <TopBar partition={undefined} chat={props.tenant} />
            <main className="flex min-h-0 min-w-0 flex-col">
              {props.children}
            </main>
          </div>
        </StreamPortsProvider>
      </MarkdownProvider>
    </CopyProvider>
  );
}

/** The row over the page: what it holds, then the way to a new chat and the
 * history. */
function MemberChatBar(props: {
  readonly tenant: string;
  readonly session: string | undefined;
  readonly own: readonly ThreadEntryResponse[];
  readonly projects: readonly MemberChatProjectThread[];
  readonly children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const { tenant } = props;
  return (
    <header className="border-edge flex min-w-0 flex-wrap items-center gap-1 border-b px-4 py-2">
      {props.children}
      {props.session === undefined ? null : (
        <Tooltip text="New chat">
          <Link
            to={memberChatRoutes.chat}
            params={{ tenant }}
            className={buttonLookClassName({ size: "icon", variant: "quiet" })}
          >
            <ChatPaneIcon glyph="new" label="New chat" />
          </Link>
        </Tooltip>
      )}
      <ChatPaneHistory
        threads={props.own}
        session={props.session}
        elsewhere={props.projects}
        onChoose={(session) => {
          void navigate({
            to: memberChatRoutes.thread,
            params: { tenant, session },
          });
        }}
      />
    </header>
  );
}

/** The composer whose first message opens a thread, which the page then
 * moves to. */
function MemberChatFirst(props: {
  readonly tenant: string;
  readonly onStarted: (session: string) => void;
}): ReactNode {
  const sends = useMemberThreadSend({
    tenant: props.tenant,
    session: undefined,
    takes: true,
    onStarted: props.onStarted,
  });
  const sent = useMemo(
    () => sends.sending.map(conversationExchangeSent),
    [sends.sending],
  );
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="min-h-0 min-w-0 flex-1"
    >
      <Conversation
        exchanges={conversationExchangesStopped(sent, sends.stopping)}
        composer={{ ...sends.composer, focusOnMount: true }}
        pane
      />
    </div>
  );
}

function MemberChatThread(props: {
  readonly tenant: string;
  readonly session: string;
  readonly own: readonly ThreadEntryResponse[];
  readonly projects: readonly MemberChatProjectThread[];
}): ReactNode {
  const state = useMemberThread(props.tenant, props.session);
  const home = { scope: "Member", tenant: props.tenant } as const;
  return (
    <>
      <MemberChatBar {...props}>
        {state.state === "Ready" ? (
          <ChatPaneThreadActions home={home} thread={state.value} at="Page" />
        ) : (
          <h1 className="text-ink-1 font-strong min-w-0 flex-1 truncate text-md">
            Thread
          </h1>
        )}
      </MemberChatBar>
      {state.state === "Ready" ? (
        <div className="chat-reading flex min-h-0 min-w-0 flex-1 flex-col">
          <MemberThreadConversation
            tenant={props.tenant}
            thread={state.value}
            named
          />
        </div>
      ) : (
        <div className="p-4">
          <PanelUnready state={state} />
        </div>
      )}
    </>
  );
}

function MemberChatOpen(props: {
  readonly tenant: string;
  readonly session: string | undefined;
}): ReactNode {
  const { tenant, session } = props;
  const navigate = useNavigate();
  const threads = useMemberChatThreads(tenant);
  const { own, projects } = memberChatThreadsParted(
    tenant,
    threads.state === "Ready" ? threads.value.threads : [],
  );
  if (session !== undefined)
    return (
      <MemberChatThread
        key={session}
        tenant={tenant}
        session={session}
        own={own}
        projects={projects}
      />
    );
  return (
    <>
      <MemberChatBar
        tenant={tenant}
        session={undefined}
        own={own}
        projects={projects}
      >
        <h1 className="text-ink-1 font-strong min-w-0 flex-1 truncate text-md">
          New chat
        </h1>
      </MemberChatBar>
      <div className="chat-reading flex min-h-0 min-w-0 flex-1 flex-col">
        <MemberChatFirst
          tenant={tenant}
          onStarted={(started) => {
            void navigate({
              to: memberChatRoutes.thread,
              params: { tenant, session: started },
            });
          }}
        />
      </div>
    </>
  );
}

/** The chat, where the workspace lets the reader have one. */
function MemberChatGranted(props: {
  readonly tenant: string;
  readonly session: string | undefined;
}): ReactNode {
  const abilities = useChatAbilities(props.tenant);
  if (abilities.state === "Pending" || abilities.state === "Failed")
    return (
      <div className="p-4">
        <PanelUnready state={abilities} />
      </div>
    );
  if (
    !memberChatOpens(abilities.state === "Ready" ? abilities.value : undefined)
  )
    return (
      <div className="p-4">
        <SettingsListingWithheld line={memberChatWithheld} />
      </div>
    );
  return <MemberChatOpen tenant={props.tenant} session={props.session} />;
}

export function MemberChatPage(props: {
  readonly tenant: string;
  readonly session: string | undefined;
}): ReactNode {
  return (
    <MemberChatFrame tenant={props.tenant}>
      <MemberChatGranted tenant={props.tenant} session={props.session} />
    </MemberChatFrame>
  );
}
