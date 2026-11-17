/**
 * The reader's own chat at their tenant, outside every project: a thread of
 * it as a column to read under a head that names it and the chat host it runs
 * on, or the composer whose first message opens one, and the history of their
 * threads among the head's controls.
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
 *
 * A thread's head offers its Context, which opens what the thread's model
 * holds beside the conversation, as a project thread's page does. A thread
 * that takes no more messages says so in its composer's place, with the way
 * to a new one.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
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
import { settingsRoutes } from "../core/settingsNav.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { PanelUnready } from "./DataPanel.tsx";
import { clipboardWritten, elapsedMs, syntaxWorkerOpened } from "./ports.ts";
import { SettingsListingWithheld } from "./settings/SettingsListing.tsx";
import { ChatPaneIcon } from "./shell/chatPaneIcons.tsx";
import { ChatPaneHistory } from "./shell/ChatPaneHistory.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { StreamPortsProvider } from "./stream.tsx";
import { MemberThreadConversation } from "./thread/ThreadConversation.tsx";
import { ThreadPageDrawn } from "./thread/ThreadPageDrawn.tsx";
import {
  useChatAbilities,
  useMemberChatThreads,
  useMemberThread,
} from "./thread/threadRead.ts";
import { useMemberThreadSend } from "./thread/threadSend.tsx";
import { buttonLookClassName } from "./ui/Button.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { MarkdownProvider } from "./ui/markdownHeld.ts";
import { PageHeader } from "./ui/PageHeader.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./shell/shell.css";

/** The bar's frame with no project in it, the page filling what is left. What
 * is left is the page's container, named `page` as the shell names its own,
 * since no shell draws this one. */
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
            <main className="chat-page @container/page flex min-h-0 min-w-0 flex-col">
              {props.children}
            </main>
          </div>
        </StreamPortsProvider>
      </MarkdownProvider>
    </CopyProvider>
  );
}

/** What the page offers beside a thread's menu: the way to a new chat where
 * it holds a thread, and the history. */
function MemberChatOffers(props: {
  readonly tenant: string;
  readonly session: string | undefined;
  readonly own: readonly ThreadEntryResponse[];
  readonly projects: readonly MemberChatProjectThread[];
}): ReactNode {
  const text = useCopyText();
  const navigate = useNavigate();
  const { tenant } = props;
  return (
    <>
      {props.session === undefined ? null : (
        <Tooltip trigger="control" text={{ id: "chat-new" }}>
          <Link
            to={memberChatRoutes.chat}
            params={{ tenant }}
            className={buttonLookClassName({ size: "icon", variant: "quiet" })}
          >
            <ChatPaneIcon glyph="new" label={text({ id: "chat-new" })} />
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
    </>
  );
}

/** The reader's chat host, which every thread here runs on, linked to the
 * page where it is registered. */
function MemberChatHostLink(props: { readonly tenant: string }): ReactNode {
  const text = useCopyText();
  return (
    <Link
      to={settingsRoutes.workspace.myRunner}
      params={{ tenant: props.tenant }}
    >
      {text({ id: "chat-page-host" })}
    </Link>
  );
}

/** The composer whose first message opens a thread, which the page then
 * moves to. */
function MemberChatFirst(props: {
  readonly tenant: string;
  readonly onStarted: (session: string) => void;
}): ReactNode {
  const text = useCopyText();
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
      aria-label={text({ id: "chat-conversation" })}
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
  const text = useCopyText();
  const state = useMemberThread(props.tenant, props.session);
  if (state.state !== "Ready")
    return (
      <div className="chat-page-head">
        <PageHeader
          title={text({ id: "chat-heading" })}
          overflow={<MemberChatOffers {...props} />}
        />
        <PanelUnready state={state} />
      </div>
    );
  return (
    <ThreadPageDrawn
      home={{ scope: "Member", tenant: props.tenant }}
      thread={state.value}
      meta={<MemberChatHostLink tenant={props.tenant} />}
      offers={<MemberChatOffers {...props} />}
      forward={
        <Link to={memberChatRoutes.chat} params={{ tenant: props.tenant }}>
          {text({ id: "chat-new" })}
        </Link>
      }
      conversation={(drawn) => (
        <MemberThreadConversation
          tenant={props.tenant}
          thread={state.value}
          named
          unavailable={drawn.unavailable}
          beside={drawn.beside}
        />
      )}
    />
  );
}

function MemberChatOpen(props: {
  readonly tenant: string;
  readonly session: string | undefined;
}): ReactNode {
  const text = useCopyText();
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
      <div className="chat-page-head">
        <PageHeader
          title={text({ id: "chat-new" })}
          meta={<MemberChatHostLink tenant={tenant} />}
          overflow={
            <MemberChatOffers
              tenant={tenant}
              session={undefined}
              own={own}
              projects={projects}
            />
          }
        />
      </div>
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
  const text = useCopyText();
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
        <SettingsListingWithheld line={text(memberChatWithheld)} />
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
