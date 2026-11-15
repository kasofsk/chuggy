/**
 * The open chat pane's header: the thread's title, New and the control that
 * puts the pane away, and one menu holding everything else — History, the
 * thread's own page, Copy link, Rename, Full screen and Close, each by its
 * word.
 *
 * Where the viewport does not divide the pane is the whole body, so putting it
 * away is Back, named on its face at the start of the row, rather than a
 * glyph at its end.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  chatPaneFilled,
  chatPaneRestored,
  chatPaneToggled,
} from "../../core/chatPane.ts";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import { copyOrDataText } from "../../core/copy.ts";
import { memberChatRoutes } from "../../core/memberChat.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { threadHomeOf } from "../../core/threadHome.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import { threadLabel } from "../../core/threads.ts";
import { ConsoleWriteRefusedWords } from "../consoleWrite.tsx";
import { currentOrigin } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import { MoreMenu } from "../ui/MoreMenu.tsx";
import type { MoreMenuAnchor, MoreMenuItem } from "../ui/MoreMenu.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import {
  ThreadEntryRename,
  useThreadEntryActions,
} from "../thread/ThreadEntryLabel.tsx";
import type { ThreadEntryActions } from "../thread/ThreadEntryLabel.tsx";
import { useChatPane } from "./chatPaneHeld.ts";
import {
  ChatPaneHeaderRow,
  ChatPaneIconButton,
  ChatPaneMark,
} from "./chatPaneIcons.tsx";
import {
  ChatPaneCloseConfirm,
  ChatPaneHistoryDialog,
  useThreadPageHref,
} from "./ChatPaneHistory.tsx";

/** The threads History offers, and what choosing one does. */
export interface ChatPaneHeaderHistory {
  /** Undefined while the listing is still being read. */
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly session: string | undefined;
  readonly onChoose: (session: string) => void;
}

interface ChatPaneHeaderProps {
  readonly partition: PartitionIdentity;
  /** The thread the pane holds, absent where it holds none yet. */
  readonly thread: ThreadEntryResponse | undefined;
  /** The reader may change no thread, so Rename and Close are not offered. */
  readonly viewOnly: boolean;
  readonly placement: ChatPanePlacement;
  /** New, which a reader who may start no thread is not offered. */
  readonly start: ReactNode;
  /** What New was answered, on rows of their own under the header's. */
  readonly said: ReactNode;
  readonly history: ChatPaneHeaderHistory;
}

/** The thread's title, or New chat where the pane holds none yet. */
function ChatPaneHeaderTitle(props: {
  readonly thread: ThreadEntryResponse | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <h2 className="text-ink-2 font-strong min-w-0 flex-1 truncate px-2 text-sm">
      {props.thread === undefined
        ? text({ id: "chat-new" })
        : copyOrDataText(text, threadLabel(props.thread))}
    </h2>
  );
}

/** Back to the page under the pane, where the pane is the whole body. */
function ChatPaneBack(): ReactNode {
  const text = useCopyText();
  const held = useChatPane();
  return (
    <span className="chat-back flex shrink-0">
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          held.moveTo(chatPaneToggled(held.state));
        }}
      >
        <ChatPaneMark glyph="back" />
        {text({ id: "chat-back" })}
      </Button>
    </span>
  );
}

/** The glyph that puts the pane away where it stands beside the pages. */
function ChatPaneCollapse(props: {
  readonly placement: ChatPanePlacement;
}): ReactNode {
  const text = useCopyText();
  const held = useChatPane();
  return (
    <ChatPaneIconButton
      glyph={`collapse${props.placement}`}
      label={text({ id: "chat-collapse" })}
      onClick={() => {
        held.moveTo(chatPaneToggled(held.state));
      }}
    />
  );
}

/** The thread's own page, as a real anchor, so a modified press opens it in a
 * tab of its own. */
function chatPaneOpenItem(
  label: string,
  home: ThreadHome,
  session: string,
): MoreMenuItem {
  return {
    kind: "link",
    label,
    link: (anchor: MoreMenuAnchor) =>
      home.scope === "Project" ? (
        <Link
          to={navRoutes.thread}
          params={{ ...home.partition, session }}
          {...anchor}
        />
      ) : (
        <Link
          to={memberChatRoutes.thread}
          params={{ tenant: home.tenant, session }}
          {...anchor}
        />
      ),
  };
}

/** What of the menu is the pane's rather than the thread's: History, and Full
 * screen or leaving it where the viewport divides. */
function useChatPaneMenuItems(onHistory: () => void): {
  readonly history: MoreMenuItem;
  readonly frame: readonly MoreMenuItem[];
} {
  const text = useCopyText();
  const held = useChatPane();
  const state = held.state;
  const full = state.presentation === "Full";
  return {
    history: {
      kind: "action",
      label: text({ id: "chat-history" }),
      onSelect: onHistory,
    },
    frame: held.twoColumn
      ? [
          {
            kind: "action",
            label: text({ id: full ? "chat-restore" : "chat-fill" }),
            onSelect: () => {
              held.moveTo(
                full ? chatPaneRestored(state) : chatPaneFilled(state),
              );
            },
          },
        ]
      : [],
  };
}

/** The menu, named again as a tooltip on focus, as every glyph of the row is. */
function ChatPaneMenu(props: {
  readonly items: readonly MoreMenuItem[];
}): ReactNode {
  const text = useCopyText();
  const label = text({ id: "chat-more" });
  return (
    <Tooltip text={label}>
      <span className="flex">
        <MoreMenu label={label} items={props.items} />
      </span>
    </Tooltip>
  );
}

/** The header's one row: Back where the pane is the whole body, the title,
 * New, the collapse glyph where the pane stands beside the pages, and the
 * menu, which stands aside while a rename has the title's place. */
function ChatPaneHeaderDrawn(props: {
  readonly title: ReactNode;
  readonly start: ReactNode;
  readonly placement: ChatPanePlacement;
  readonly items: readonly MoreMenuItem[] | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const held = useChatPane();
  return (
    <header className="border-edge flex min-w-0 flex-wrap items-center border-b px-1 py-1">
      {held.twoColumn ? null : <ChatPaneBack />}
      {props.title}
      <div className="chat-icons flex shrink-0 items-center">
        {props.start}
        {held.twoColumn ? (
          <ChatPaneCollapse placement={props.placement} />
        ) : null}
        {props.items === undefined ? null : (
          <ChatPaneMenu items={props.items} />
        )}
      </div>
      {props.children}
    </header>
  );
}

/** Copy link, which stays open to say it copied, where the browser can
 * copy. */
function useChatPaneCopyItem(
  home: ThreadHome,
  session: string,
): {
  readonly items: readonly MoreMenuItem[];
  readonly said: ReactNode;
} {
  const text = useCopyText();
  const copy = useCopyPress();
  const pageHref = useThreadPageHref(home, session);
  if (copy === undefined) return { items: [], said: null };
  return {
    items: [
      {
        kind: "action",
        label: text({ id: copy.copied ? "chat-copied" : "chat-copy-link" }),
        onSelect: (event) => {
          event.preventDefault();
          copy.press(new URL(pageHref(), currentOrigin()).href);
        },
      },
    ],
    said: <CopySaid copied={copy.copied} />,
  };
}

/** What closing asks and what a change was refused, under the row. */
function ChatPaneThreadSaid(props: {
  readonly thread: ThreadEntryResponse;
  readonly actions: ThreadEntryActions;
  readonly confirming: boolean;
  readonly onConfirming: (confirming: boolean) => void;
}): ReactNode {
  const { actions } = props;
  return (
    <>
      {props.confirming && !actions.renaming ? (
        <ChatPaneHeaderRow>
          <ChatPaneCloseConfirm
            mine={props.thread.mine}
            busy={actions.busy}
            onConfirm={() => {
              props.onConfirming(false);
              actions.close();
            }}
            onCancel={() => {
              props.onConfirming(false);
            }}
          />
        </ChatPaneHeaderRow>
      ) : null}
      {actions.refused === undefined ? null : (
        <ChatPaneHeaderRow>
          <Notice tone="danger" inline>
            <ConsoleWriteRefusedWords refused={actions.refused} />
          </Notice>
        </ChatPaneHeaderRow>
      )}
    </>
  );
}

/** The header over a thread: the menu offers what is done to it too, Rename
 * and Close only to a reader who may change it. */
function ChatPaneHeaderThread(
  props: ChatPaneHeaderProps & {
    readonly thread: ThreadEntryResponse;
    readonly onHistory: () => void;
  },
): ReactNode {
  const text = useCopyText();
  const home = threadHomeOf(props.partition);
  const { thread } = props;
  const actions = useThreadEntryActions(home, thread);
  const [confirming, setConfirming] = useState(false);
  const copy = useChatPaneCopyItem(home, thread.session);
  const pane = useChatPaneMenuItems(props.onHistory);
  const changes = !props.viewOnly;
  const items: readonly MoreMenuItem[] = [
    pane.history,
    chatPaneOpenItem(text({ id: "chat-open" }), home, thread.session),
    ...copy.items,
    ...(actions.renameable && changes
      ? [
          {
            kind: "action",
            label: text({ id: "chat-rename" }),
            onSelect: actions.startRename,
          } as const,
        ]
      : []),
    ...pane.frame,
    ...(actions.closable && changes
      ? [
          {
            kind: "destructive",
            label: text({ id: "chat-close" }),
            onSelect: () => {
              setConfirming(true);
            },
          } as const,
        ]
      : []),
  ];
  return (
    <ChatPaneHeaderDrawn
      title={
        actions.renaming ? (
          <ThreadEntryRename initial={thread.title ?? ""} actions={actions} />
        ) : (
          <ChatPaneHeaderTitle thread={thread} />
        )
      }
      start={props.start}
      placement={props.placement}
      items={actions.renaming ? undefined : items}
    >
      {props.said}
      <ChatPaneThreadSaid
        thread={thread}
        actions={actions}
        confirming={confirming}
        onConfirming={setConfirming}
      />
      {copy.said}
    </ChatPaneHeaderDrawn>
  );
}

/** The header over the composer whose first press opens a thread, whose menu
 * offers only what is the pane's. */
function ChatPaneHeaderIdle(
  props: ChatPaneHeaderProps & { readonly onHistory: () => void },
): ReactNode {
  const pane = useChatPaneMenuItems(props.onHistory);
  return (
    <ChatPaneHeaderDrawn
      title={<ChatPaneHeaderTitle thread={undefined} />}
      start={props.start}
      placement={props.placement}
      items={[pane.history, ...pane.frame]}
    >
      {props.said}
    </ChatPaneHeaderDrawn>
  );
}

export function ChatPaneHeader(props: ChatPaneHeaderProps): ReactNode {
  const [history, setHistory] = useState(false);
  const opened = (): void => {
    setHistory(true);
  };
  return (
    <>
      {props.thread === undefined ? (
        <ChatPaneHeaderIdle {...props} onHistory={opened} />
      ) : (
        <ChatPaneHeaderThread
          {...props}
          thread={props.thread}
          onHistory={opened}
        />
      )}
      <ChatPaneHistoryDialog
        threads={props.history.threads}
        session={props.history.session}
        onChoose={props.history.onChoose}
        open={history}
        onOpenChange={setHistory}
      />
    </>
  );
}
