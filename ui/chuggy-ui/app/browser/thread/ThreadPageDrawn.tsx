/**
 * A chat's own page: its head, and its conversation filling the page under it
 * as a column to read, Context's panel beside it while it is open.
 *
 * The head is drawn through `PageHeader`: the thread's title as the page's one
 * heading, the line naming what it belongs to, its standing and what its chat
 * host holds of it, and its controls — Context, whatever else the page
 * offers, and the menu the pane's header offers on a thread, by the pane's own
 * words. While a rename is open the menu stands aside and the editor is drawn
 * under the title.
 *
 * Where the reader can send the thread nothing, one line stands in the
 * composer's place, saying why before the way forward the page hands it.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { copyOrDataText } from "../../core/copy.ts";
import type { LeadTranscriptHeld } from "../../core/leadTranscript.ts";
import { sessionCapabilitiesSaid } from "../../core/sessionCapabilities.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import {
  threadPageUnavailable,
  threadPageUnavailableLine,
} from "../../core/threadPage.ts";
import type { ThreadPageUnavailable } from "../../core/threadPage.ts";
import { threadLabel, threadStandingLabel } from "../../core/threads.ts";
import { threadStandingTone } from "../../core/tones.ts";
import {
  ContextToggle,
  ThreadContextPanel,
} from "../context/SessionContext.tsx";
import { ChatPaneMenu, useChatThreadMenu } from "../shell/ChatPaneHeader.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { ThreadEntryRename } from "./ThreadEntryLabel.tsx";

/** The thread's standing, which is all the bar standing in for the head
 * once it has scrolled away says of it. */
function ThreadPageStandingPill(props: {
  readonly thread: ThreadResponse;
}): ReactNode {
  const text = useCopyText();
  return (
    <Pill tone={threadStandingTone(props.thread.state)} emphasis>
      {text(threadStandingLabel(props.thread.state))}
    </Pill>
  );
}

/** The thread's standing, then whether it is kept running and what its chat
 * host lets it do, each with what it means on focus. */
function ThreadPageStanding(props: {
  readonly thread: ThreadResponse;
}): ReactNode {
  const text = useCopyText();
  const { thread } = props;
  return (
    <>
      <ThreadPageStandingPill thread={thread} />
      {thread.jobsStanding === true ? (
        <Tooltip
          trigger="abbreviation"
          text={{ id: "chat-kept-running-detail" }}
        >
          <span>
            <Pill tone="live">{text({ id: "chat-kept-running" })}</Pill>
          </span>
        </Tooltip>
      ) : null}
      {thread.chatHostCapabilities === undefined ? null : (
        <Tooltip
          trigger="abbreviation"
          text={text({
            id: "chat-host-capabilities-detail",
            args: {
              capabilities: sessionCapabilitiesSaid(
                text,
                thread.chatHostCapabilities,
              ),
            },
          })}
        >
          <span>
            <Pill tone="neutral">{text({ id: "chat-host-capabilities" })}</Pill>
          </span>
        </Tooltip>
      )}
    </>
  );
}

export function ThreadPageHeader(props: {
  readonly home: ThreadHome;
  readonly thread: ThreadResponse;
  /** The reader may change no thread, so Rename and Close are not offered. */
  readonly viewOnly?: boolean;
  /** What the thread belongs to, linked there. */
  readonly meta: ReactNode;
  readonly context: boolean;
  readonly onContext: (open: boolean) => void;
  /** What the page offers between Context and the menu. */
  readonly offers?: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const { thread } = props;
  const menu = useChatThreadMenu(props.home, thread, props.viewOnly === true);
  const items = [...menu.copy, ...menu.rename, ...menu.close];
  return (
    <PageHeader
      title={copyOrDataText(text, threadLabel(thread))}
      meta={props.meta}
      status={<ThreadPageStanding thread={thread} />}
      statusCondensed={<ThreadPageStandingPill thread={thread} />}
      overflow={
        <>
          <ContextToggle open={props.context} onToggle={props.onContext} />
          {props.offers}
          {menu.actions.renaming || items.length === 0 ? null : (
            <ChatPaneMenu items={items} />
          )}
        </>
      }
    >
      {menu.actions.renaming ? (
        <ThreadEntryRename
          initial={thread.title ?? ""}
          actions={menu.actions}
        />
      ) : null}
      {menu.said}
    </PageHeader>
  );
}

/** Why the reader can send this thread nothing, and the way forward. */
function ThreadPageUnavailableLine(props: {
  readonly unavailable: ThreadPageUnavailable;
  readonly forward: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <p className="text-ink-3 m-0 flex flex-wrap justify-center gap-3 text-center">
      <span>{text(threadPageUnavailableLine(props.unavailable))}</span>
      {props.forward}
    </p>
  );
}

/** What the page hands the conversation it draws. */
export interface ThreadPageConversation {
  readonly unavailable: ReactNode;
  readonly beside: ((held: LeadTranscriptHeld) => ReactNode) | undefined;
}

export function ThreadPageDrawn(props: {
  readonly home: ThreadHome;
  readonly thread: ThreadResponse;
  readonly viewOnly?: boolean;
  /** What the thread belongs to, linked there. */
  readonly meta: ReactNode;
  /** What the page offers between Context and the menu. */
  readonly offers?: ReactNode;
  /** The way forward from a thread the reader can send nothing. */
  readonly forward: ReactNode;
  readonly conversation: (drawn: ThreadPageConversation) => ReactNode;
}): ReactNode {
  const { home, thread } = props;
  const [context, setContext] = useState(false);
  const unavailable = threadPageUnavailable(thread);
  return (
    <>
      <div className="chat-page-head">
        <ThreadPageHeader
          home={home}
          thread={thread}
          viewOnly={props.viewOnly === true}
          meta={props.meta}
          context={context}
          onContext={setContext}
          offers={props.offers}
        />
      </div>
      <div
        className="chat-reading context-beside flex min-h-0 min-w-0 flex-1"
        data-open={context}
      >
        {props.conversation({
          unavailable:
            unavailable === undefined ? undefined : (
              <ThreadPageUnavailableLine
                unavailable={unavailable}
                forward={props.forward}
              />
            ),
          beside: context
            ? (held) => (
                <ThreadContextPanel
                  home={home}
                  thread={thread}
                  held={held}
                  onClose={() => {
                    setContext(false);
                  }}
                />
              )
            : undefined,
        })}
      </div>
    </>
  );
}
