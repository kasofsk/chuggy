/**
 * Every thread the reader can reach, behind one control in the pane's header —
 * their own, then a divider, then everyone else's.
 *
 * This is the whole of what the Threads page used to be. The listing is a way
 * to choose which thread the pane holds rather than a screen of its own, and
 * the actions the page carried per thread are offered on the thread being read
 * instead of on every row: a control inside a menu row is a shape neither a
 * pointer nor a screen reader handles well. Among them is the way to the
 * thread's own page.
 */

import { Link, useRouter } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import type { ThreadStanding } from "../../../../../src/contract/rosters.ts";
import { agoText } from "../../core/figures.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { threadLabel, threadsByStanding } from "../../core/threads.ts";
import { threadStandingTone } from "../../core/tones.ts";
import { useNowMs } from "../Freshness.tsx";
import { currentOrigin } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import {
  ChatPaneHeaderRow,
  ChatPaneIcon,
  ChatPaneIconButton,
  ChatPaneIconTip,
} from "./chatPaneIcons.tsx";
import type { ChatPaneGlyphName } from "./chatPaneIcons.tsx";
import {
  ThreadEntryRename,
  useThreadEntryActions,
} from "../thread/ThreadEntryLabel.tsx";
import type { ThreadEntryActions } from "../thread/ThreadEntryLabel.tsx";

import "./shell.css";

/** The threads the history offers, the reader's own apart from everyone
 * else's, each part open first and each standing's most recent first. */
function chatPaneHistoryRows(threads: readonly ThreadEntryResponse[]): {
  readonly mine: readonly ThreadEntryResponse[];
  readonly others: readonly ThreadEntryResponse[];
} {
  return {
    mine: threadsByStanding(threads.filter((thread) => thread.mine)),
    others: threadsByStanding(threads.filter((thread) => !thread.mine)),
  };
}

/** Each standing's glyph and tone, total so a standing the roster grows stops
 * compiling rather than drawing as another. */
const chatPaneStandingGlyphs: Readonly<
  Record<ThreadStanding, ChatPaneGlyphName>
> = { Open: "open", Closed: "closed", Orphaned: "orphaned" };

const chatPaneStandingTones: Readonly<Record<ThreadStanding, string>> = {
  Open: "text-tone-live",
  Closed: "text-ink-3",
  Orphaned: "text-tone-parked",
};

/** How long ago the thread last moved, and nothing where the instant does not
 * read. */
function chatPaneActivityAgo(stated: string, nowMs: number): string {
  const at = Date.parse(stated);
  return Number.isFinite(at) ? `${agoText(nowMs, at)} ago` : "";
}

/** One thread in the history: its standing, its title and how long ago it
 * last moved, each spoken in its name for a reader who does not see them. */
function ChatPaneHistoryRow(props: {
  readonly thread: ThreadEntryResponse;
  readonly nowMs: number;
}): ReactNode {
  const thread = props.thread;
  const nowMs = props.nowMs;
  return (
    <DropdownMenu.RadioItem
      className={`${menuItemClassName} chat-history-row`}
      value={thread.session}
      aria-label={[
        threadLabel(thread),
        thread.state,
        chatPaneActivityAgo(thread.lastActivityAt, nowMs),
      ]
        .filter((part) => part !== "")
        .join(", ")}
    >
      <span className={`flex ${chatPaneStandingTones[thread.state]}`}>
        <ChatPaneIcon
          glyph={chatPaneStandingGlyphs[thread.state]}
          label={thread.state}
        />
      </span>
      <span className="max-w-[32ch] min-w-0 flex-1 truncate">
        {threadLabel(thread)}
      </span>
      <span className="text-ink-3 ml-auto pl-3 text-xs">
        {chatPaneActivityAgo(thread.lastActivityAt, nowMs)}
      </span>
    </DropdownMenu.RadioItem>
  );
}

const chatPaneHistoryLabel = "History";

export function ChatPaneHistory(props: {
  readonly threads: readonly ThreadEntryResponse[];
  readonly session: string | undefined;
  readonly onChoose: (session: string) => void;
}): ReactNode {
  const rows = chatPaneHistoryRows(props.threads);
  const nowMs = useNowMs();
  if (rows.mine.length === 0 && rows.others.length === 0) return null;
  const drawn = (thread: ThreadEntryResponse): ReactNode => (
    <ChatPaneHistoryRow key={thread.session} thread={thread} nowMs={nowMs} />
  );
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip text={chatPaneHistoryLabel}>
        <DropdownMenu.Trigger
          className={buttonLookClassName({ size: "icon", variant: "quiet" })}
        >
          <ChatPaneIcon glyph="history" label={chatPaneHistoryLabel} />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          <DropdownMenu.RadioGroup
            value={props.session ?? ""}
            onValueChange={props.onChoose}
          >
            {rows.mine.length === 0 ? null : (
              <DropdownMenu.Group>
                <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
                  Yours
                </DropdownMenu.Label>
                {rows.mine.map(drawn)}
              </DropdownMenu.Group>
            )}
            {rows.mine.length === 0 || rows.others.length === 0 ? null : (
              <DropdownMenu.Separator className="bg-edge my-1 h-px" />
            )}
            {rows.others.length === 0 ? null : (
              <DropdownMenu.Group>
                <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
                  Everyone else's
                </DropdownMenu.Label>
                {rows.others.map(drawn)}
              </DropdownMenu.Group>
            )}
          </DropdownMenu.RadioGroup>
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * What closing does, asked before it is done because it cannot be undone: the
 * server has no door back to open, and a turn still unanswered is abandoned
 * rather than left to finish. A thread that is not the reader's own is closed
 * for its owner too.
 */
function ChatPaneCloseConfirm(props: {
  readonly mine: boolean;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <Confirm
      question="Close this thread?"
      confirm="Close thread"
      busy={props.busy}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      {props.mine
        ? ""
        : "This thread is not yours; closing it ends it for its owner too. "}
      It stays readable in History, but it will take no more messages, and a
      reply still in progress is abandoned. This cannot be undone.
    </Confirm>
  );
}

/** What of a thread its actions read, which a listing's entry and the
 * thread's own read both carry. */
type ChatPaneThreadNamed = Pick<
  ThreadEntryResponse,
  "session" | "title" | "mine" | "state"
>;

/** Where the actions are drawn: the pane's header, or the bar over the
 * thread's own page, where the title is the page's and its standing is said
 * beside it. */
export type ChatPaneThreadActionsAt = "Pane" | "Page";

function ChatPaneThreadTitle(props: {
  readonly thread: ChatPaneThreadNamed;
  readonly at: ChatPaneThreadActionsAt;
}): ReactNode {
  if (props.at === "Pane")
    return (
      <h2 className="text-ink-2 font-strong min-w-0 truncate pr-1 text-sm">
        {threadLabel(props.thread)}
      </h2>
    );
  return (
    <>
      <h1 className="text-ink-1 font-strong min-w-0 truncate text-md">
        {threadLabel(props.thread)}
      </h1>
      <span className="flex shrink-0 px-2">
        <Pill tone={threadStandingTone(props.thread.state)} emphasis>
          {props.thread.state}
        </Pill>
      </span>
    </>
  );
}

/** The thread's own page, as a real anchor in the look of the pane's icon
 * buttons, so a modified press opens it in a tab of its own. */
function ChatPaneThreadOpen(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
}): ReactNode {
  return (
    <ChatPaneIconTip label="Open">
      <Link
        to={navRoutes.thread}
        params={{ ...props.partition, session: props.session }}
        className={buttonLookClassName({ size: "icon", variant: "quiet" })}
      >
        <ChatPaneIcon glyph="page" label="Open" />
      </Link>
    </ChatPaneIconTip>
  );
}

/** The whole address of the thread's own page onto the clipboard, built by
 * the router that answers it. */
function ChatPaneThreadCopy(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
}): ReactNode {
  const router = useRouter();
  const copy = useCopyPress();
  if (copy === undefined) return null;
  return (
    <>
      <ChatPaneIconButton
        glyph={copy.copied ? "copied" : "link"}
        label="Copy link"
        onClick={() => {
          const page = router.buildLocation({
            to: navRoutes.thread,
            params: { ...props.partition, session: props.session },
          });
          copy.press(new URL(page.href, currentOrigin()).href);
        }}
      />
      <CopySaid copied={copy.copied} />
    </>
  );
}

/** The buttons beside the title: Rename and Close where the reader may change
 * the thread, and the way to its own page wherever it is not that page. */
function ChatPaneThreadButtons(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly at: ChatPaneThreadActionsAt;
  readonly actions: ThreadEntryActions;
  readonly changes: boolean;
  readonly confirming: boolean;
  readonly onConfirming: (confirming: boolean) => void;
}): ReactNode {
  return (
    <>
      {props.actions.renameable && props.changes ? (
        <ChatPaneIconButton
          glyph="rename"
          label="Rename"
          onClick={props.actions.startRename}
        />
      ) : null}
      {props.actions.closable && props.changes ? (
        <ChatPaneIconButton
          glyph="close"
          label="Close"
          pressed={props.confirming}
          onClick={() => {
            props.onConfirming(!props.confirming);
          }}
        />
      ) : null}
      {props.at === "Pane" ? (
        <ChatPaneThreadOpen
          partition={props.partition}
          session={props.session}
        />
      ) : null}
      <ChatPaneThreadCopy partition={props.partition} session={props.session} />
    </>
  );
}

/**
 * The thread the pane or its page holds, at the start of the header's one row:
 * its title, and beside it Rename, Close, which asks before it closes, and the
 * links to its own page. While a rename is open the editor takes the title's
 * place and the buttons stand aside for it; what closing asks and what either
 * was refused for go under the row.
 */
export function ChatPaneThreadActions(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ChatPaneThreadNamed;
  /** The reader may change no thread, so Rename and Close are not offered. */
  readonly viewOnly?: boolean;
  readonly at: ChatPaneThreadActionsAt;
}): ReactNode {
  const actions = useThreadEntryActions(props.partition, props.thread);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div
        className={`flex min-w-0 flex-1 items-center ${props.at === "Pane" ? "pl-3" : ""}`}
      >
        {actions.renaming ? (
          <ThreadEntryRename
            initial={props.thread.title ?? ""}
            actions={actions}
          />
        ) : (
          <>
            <ChatPaneThreadTitle thread={props.thread} at={props.at} />
            <ChatPaneThreadButtons
              partition={props.partition}
              session={props.thread.session}
              at={props.at}
              actions={actions}
              changes={props.viewOnly !== true}
              confirming={confirming}
              onConfirming={setConfirming}
            />
          </>
        )}
      </div>
      {confirming && !actions.renaming ? (
        <ChatPaneHeaderRow>
          <ChatPaneCloseConfirm
            mine={props.thread.mine}
            busy={actions.busy}
            onConfirm={() => {
              setConfirming(false);
              actions.close();
            }}
            onCancel={() => {
              setConfirming(false);
            }}
          />
        </ChatPaneHeaderRow>
      ) : null}
      {actions.refused === undefined ? null : (
        <ChatPaneHeaderRow>
          <Notice
            tone="danger"
            inline
            detail={`Refused · ${actions.refused}`}
          />
        </ChatPaneHeaderRow>
      )}
    </>
  );
}
