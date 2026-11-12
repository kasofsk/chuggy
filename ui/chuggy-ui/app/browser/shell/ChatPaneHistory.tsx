/**
 * Every thread the reader can reach — their own, then a divider, then
 * everyone else's; and in the reader's own chat, the threads projects keep of
 * theirs, each a way to its project. A thread's page offers it behind a
 * control of its own, and the chat pane as a dialog its menu opens.
 *
 * This is the whole of what the Threads page used to be. The listing is a way
 * to choose which thread is held rather than a screen of its own, and the
 * actions the page carried per thread are offered on the thread being read
 * instead of on every row: a control inside a menu row is a shape neither a
 * pointer nor a screen reader handles well.
 */

import { Link, useRouter } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import type { ThreadStanding } from "../../../../../src/contract/rosters.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { copyOrDataText } from "../../core/copy.ts";
import type { Copy } from "../../core/copy.ts";
import { agoText } from "../../core/figures.ts";
import { memberChatRoutes } from "../../core/memberChat.ts";
import type { MemberChatProjectThread } from "../../core/memberChat.ts";
import { navRoutes } from "../../core/shellNav.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import {
  threadLabel,
  threadsByStanding,
  threadStandingLabel,
} from "../../core/threads.ts";
import { threadStandingTone } from "../../core/tones.ts";
import { ConsoleWriteRefusedWords } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { currentOrigin } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import {
  ChatPaneHeaderRow,
  ChatPaneIcon,
  ChatPaneMark,
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
function chatPaneActivityAgo(stated: string, nowMs: number): Copy | undefined {
  const at = Date.parse(stated);
  return Number.isFinite(at)
    ? { id: "figures-ago", args: { elapsed: agoText(nowMs, at) } }
    : undefined;
}

/** What a reader who does not see the row is told of it: its title, its
 * standing, and how long ago it last moved where that reads. */
function chatPaneHistoryRowSpoken(
  thread: ThreadEntryResponse,
  ago: Copy | undefined,
): Copy {
  const named = {
    title: threadLabel(thread),
    standing: threadStandingLabel(thread.state),
  };
  return ago === undefined
    ? { id: "chat-history-row-undated", args: named }
    : { id: "chat-history-row", args: { ...named, ago } };
}

/** What a row of the history draws: the thread's standing, its title and how
 * long ago it last moved. */
function ChatPaneHistoryFace(props: {
  readonly thread: ThreadEntryResponse;
  readonly ago: Copy | undefined;
}): ReactNode {
  const text = useCopyText();
  const { thread, ago } = props;
  return (
    <>
      <span className={`flex ${chatPaneStandingTones[thread.state]}`}>
        <ChatPaneIcon
          glyph={chatPaneStandingGlyphs[thread.state]}
          label={text(threadStandingLabel(thread.state))}
        />
      </span>
      <span className="max-w-[32ch] min-w-0 flex-1 truncate">
        {copyOrDataText(text, threadLabel(thread))}
      </span>
      <span className="text-ink-3 ml-auto pl-3 text-xs">
        {ago === undefined ? "" : text(ago)}
      </span>
    </>
  );
}

/** One thread in the history menu, each part of its face spoken in its name
 * for a reader who does not see them. */
function ChatPaneHistoryRow(props: {
  readonly thread: ThreadEntryResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const thread = props.thread;
  const ago = chatPaneActivityAgo(thread.lastActivityAt, props.nowMs);
  return (
    <DropdownMenu.RadioItem
      className={`${menuItemClassName} chat-history-row`}
      value={thread.session}
      aria-label={text(chatPaneHistoryRowSpoken(thread, ago))}
    >
      <ChatPaneHistoryFace thread={thread} ago={ago} />
    </DropdownMenu.RadioItem>
  );
}

const chatPaneHistoryLabel: Copy = { id: "chat-history" };

/** One of the reader's threads a project keeps, as a way to its own page there
 * rather than a thread this history holds. */
function ChatPaneHistoryElsewhere(props: {
  readonly held: MemberChatProjectThread;
}): ReactNode {
  const text = useCopyText();
  const { partition, thread } = props.held;
  const named = { project: partition.project, title: threadLabel(thread) };
  const standing = threadStandingLabel(thread.state);
  return (
    <DropdownMenu.Item
      className={`${menuItemClassName} chat-history-row text-ink-1 no-underline`}
      asChild
    >
      <Link
        to={navRoutes.thread}
        params={{ ...partition, session: thread.session }}
        aria-label={text({
          id: "chat-history-elsewhere-row",
          args: { ...named, standing },
        })}
      >
        <span className={`flex ${chatPaneStandingTones[thread.state]}`}>
          <ChatPaneIcon
            glyph={chatPaneStandingGlyphs[thread.state]}
            label={text(standing)}
          />
        </span>
        <span className="max-w-[32ch] min-w-0 flex-1 truncate">
          {text({ id: "chat-history-elsewhere", args: named })}
        </span>
      </Link>
    </DropdownMenu.Item>
  );
}

/** The threads projects keep of the reader's, under the history's own
 * threads where it has any. */
function ChatPaneHistoryElsewhereGroup(props: {
  readonly elsewhere: readonly MemberChatProjectThread[];
  readonly separated: boolean;
}): ReactNode {
  const text = useCopyText();
  if (props.elsewhere.length === 0) return null;
  return (
    <>
      {props.separated ? (
        <DropdownMenu.Separator className="bg-edge my-1 h-px" />
      ) : null}
      <DropdownMenu.Group>
        <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
          {text({ id: "chat-history-projects" })}
        </DropdownMenu.Label>
        {props.elsewhere.map((held) => (
          <ChatPaneHistoryElsewhere
            key={`${held.partition.project}/${held.thread.session}`}
            held={held}
          />
        ))}
      </DropdownMenu.Group>
    </>
  );
}

export function ChatPaneHistory(props: {
  /** Undefined while the listing is still being read. */
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly session: string | undefined;
  readonly onChoose: (session: string) => void;
  /** The reader's threads that projects keep, each read on its project's own
   * page and offered here as the way there. */
  readonly elsewhere?: readonly MemberChatProjectThread[];
}): ReactNode {
  const text = useCopyText();
  const rows = chatPaneHistoryRows(props.threads ?? []);
  const elsewhere = props.elsewhere ?? [];
  const nowMs = useNowMs();
  const empty =
    rows.mine.length === 0 &&
    rows.others.length === 0 &&
    elsewhere.length === 0;
  const drawn = (thread: ThreadEntryResponse): ReactNode => (
    <ChatPaneHistoryRow key={thread.session} thread={thread} nowMs={nowMs} />
  );
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip text={chatPaneHistoryLabel}>
        <DropdownMenu.Trigger
          className={buttonLookClassName({ size: "icon", variant: "quiet" })}
        >
          <ChatPaneIcon glyph="history" label={text(chatPaneHistoryLabel)} />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          {empty ? (
            <p className="text-ink-3 px-2 py-1 text-xs">
              {text(
                props.threads === undefined
                  ? { id: "chat-history-loading" }
                  : { id: "chat-history-none" },
              )}
            </p>
          ) : null}
          <DropdownMenu.RadioGroup
            value={props.session ?? ""}
            onValueChange={props.onChoose}
          >
            {rows.mine.length === 0 ? null : (
              <DropdownMenu.Group>
                <DropdownMenu.Label className="text-ink-3 px-2 py-1 text-xs">
                  {text({ id: "chat-history-mine" })}
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
                  {text({ id: "chat-history-others" })}
                </DropdownMenu.Label>
                {rows.others.map(drawn)}
              </DropdownMenu.Group>
            )}
          </DropdownMenu.RadioGroup>
          <ChatPaneHistoryElsewhereGroup
            elsewhere={elsewhere}
            separated={rows.mine.length > 0 || rows.others.length > 0}
          />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One thread in the history dialog: a button that holds it, marked current
 * where it is the one held. */
function ChatPaneHistoryChoice(props: {
  readonly thread: ThreadEntryResponse;
  readonly nowMs: number;
  readonly held: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  const text = useCopyText();
  const thread = props.thread;
  const ago = chatPaneActivityAgo(thread.lastActivityAt, props.nowMs);
  return (
    <li>
      <button
        type="button"
        className={`${menuItemClassName} chat-history-row w-full text-left`}
        aria-current={props.held ? "true" : undefined}
        aria-label={text(chatPaneHistoryRowSpoken(thread, ago))}
        onClick={props.onChoose}
      >
        <ChatPaneHistoryFace thread={thread} ago={ago} />
      </button>
    </li>
  );
}

/** One part of the history dialog, headed under the dialog's title. */
function ChatPaneHistoryPart(props: {
  readonly heading: Copy;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <section className="grid gap-1">
      <h3 className="text-ink-3 px-2 text-xs">{text(props.heading)}</h3>
      <ul className="m-0 grid list-none gap-1 p-0">{props.children}</ul>
    </section>
  );
}

/** The history as the chat pane opens it from its menu: a dialog titled
 * History, its parts headed under that, where choosing a thread holds it and
 * closes the dialog. */
export function ChatPaneHistoryDialog(props: {
  /** Undefined while the listing is still being read. */
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly session: string | undefined;
  readonly onChoose: (session: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  const rows = chatPaneHistoryRows(props.threads ?? []);
  const nowMs = useNowMs();
  const drawn = (thread: ThreadEntryResponse): ReactNode => (
    <ChatPaneHistoryChoice
      key={thread.session}
      thread={thread}
      nowMs={nowMs}
      held={thread.session === props.session}
      onChoose={() => {
        props.onChoose(thread.session);
        props.onOpenChange(false);
      }}
    />
  );
  return (
    <Dialog
      title={text(chatPaneHistoryLabel)}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      {rows.mine.length === 0 && rows.others.length === 0 ? (
        <p className="text-ink-3 m-0 text-sm">
          {text(
            props.threads === undefined
              ? { id: "chat-history-loading" }
              : { id: "chat-history-none" },
          )}
        </p>
      ) : null}
      {rows.mine.length === 0 ? null : (
        <ChatPaneHistoryPart heading={{ id: "chat-history-mine" }}>
          {rows.mine.map(drawn)}
        </ChatPaneHistoryPart>
      )}
      {rows.others.length === 0 ? null : (
        <ChatPaneHistoryPart heading={{ id: "chat-history-others" }}>
          {rows.others.map(drawn)}
        </ChatPaneHistoryPart>
      )}
    </Dialog>
  );
}

/**
 * What closing does, asked before it is done because it cannot be undone: the
 * server has no door back to open, and a turn still unanswered is abandoned
 * rather than left to finish. A thread that is not the reader's own is closed
 * for its owner too.
 */
export function ChatPaneCloseConfirm(props: {
  readonly mine: boolean;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Confirm
      question={text({ id: "chat-close-question" })}
      confirm={text({ id: "chat-close-confirm" })}
      busy={props.busy}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      {props.mine ? null : (
        <span className="block">{text({ id: "chat-close-not-mine" })}</span>
      )}
      <span className="block">{text({ id: "chat-close-kept" })}</span>
      <span className="block">{text({ id: "chat-close-final" })}</span>
    </Confirm>
  );
}

/** What of a thread its actions read, which a listing's entry and the
 * thread's own read both carry. */
export type ChatPaneThreadNamed = Pick<
  ThreadEntryResponse,
  "session" | "title" | "mine" | "state"
>;

/** The thread's title as its own page's heading, its standing said beside it. */
function ChatPaneThreadTitle(props: {
  readonly thread: ChatPaneThreadNamed;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <h1 className="text-ink-1 font-strong min-w-0 truncate text-md">
        {copyOrDataText(text, threadLabel(props.thread))}
      </h1>
      <span className="flex shrink-0 px-2">
        <Pill tone={threadStandingTone(props.thread.state)} emphasis>
          {text(threadStandingLabel(props.thread.state))}
        </Pill>
      </span>
    </>
  );
}

const chatPaneThreadMenuLabel: Copy = { id: "chat-actions" };

/** The control the thread's menu opens from, named for a reader who does not
 * see its glyph. */
function ChatPaneThreadMenuTrigger(): ReactNode {
  const text = useCopyText();
  return (
    <Tooltip text={chatPaneThreadMenuLabel}>
      <DropdownMenu.Trigger
        className={`${buttonLookClassName({ size: "icon", variant: "quiet" })} shrink-0`}
      >
        <ChatPaneIcon glyph="more" label={text(chatPaneThreadMenuLabel)} />
      </DropdownMenu.Trigger>
    </Tooltip>
  );
}

/** One item of the thread's menu: its glyph, then its name. */
function ChatPaneThreadItemFace(props: {
  readonly glyph: ChatPaneGlyphName;
  readonly label: string;
}): ReactNode {
  return (
    <>
      <ChatPaneMark glyph={props.glyph} />
      {props.label}
    </>
  );
}

/** The address of the thread's own page, wherever the thread is kept. */
export function useThreadPageHref(
  home: ThreadHome,
  session: string,
): () => string {
  const router = useRouter();
  return () =>
    (home.scope === "Project"
      ? router.buildLocation({
          to: navRoutes.thread,
          params: { ...home.partition, session },
        })
      : router.buildLocation({
          to: memberChatRoutes.thread,
          params: { tenant: home.tenant, session },
        })
    ).href;
}

/**
 * What is done to the thread, behind one control beside its title: Copy link,
 * which stays open to say it copied; and Rename and Close where the reader may
 * change the thread.
 */
function ChatPaneThreadMenu(props: {
  readonly home: ThreadHome;
  readonly session: string;
  readonly actions: ThreadEntryActions;
  readonly changes: boolean;
  readonly onConfirming: () => void;
}): ReactNode {
  const text = useCopyText();
  const copy = useCopyPress();
  const { home, session } = props;
  const pageHref = useThreadPageHref(home, session);
  const renames = props.actions.renameable && props.changes;
  const closes = props.actions.closable && props.changes;
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <ChatPaneThreadMenuTrigger />
        <DropdownMenu.Portal>
          <MenuContent sideOffset={4} align="start">
            {copy === undefined ? null : (
              <DropdownMenu.Item
                className={menuItemClassName}
                onSelect={(event) => {
                  event.preventDefault();
                  copy.press(new URL(pageHref(), currentOrigin()).href);
                }}
              >
                <ChatPaneThreadItemFace
                  glyph={copy.copied ? "copied" : "link"}
                  label={text(
                    copy.copied
                      ? { id: "chat-copied" }
                      : { id: "chat-copy-link" },
                  )}
                />
              </DropdownMenu.Item>
            )}
            {renames ? (
              <DropdownMenu.Item
                className={menuItemClassName}
                onSelect={props.actions.startRename}
              >
                <ChatPaneThreadItemFace
                  glyph="rename"
                  label={text({ id: "chat-rename" })}
                />
              </DropdownMenu.Item>
            ) : null}
            {closes ? (
              <DropdownMenu.Item
                className={menuItemClassName}
                onSelect={props.onConfirming}
              >
                <ChatPaneThreadItemFace
                  glyph="close"
                  label={text({ id: "chat-close" })}
                />
              </DropdownMenu.Item>
            ) : null}
          </MenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {copy === undefined ? null : <CopySaid copied={copy.copied} />}
    </>
  );
}

/**
 * The thread a page holds, at the start of the bar over it: its title, and
 * beside it the menu of what is done to it. While a rename is
 * open the editor takes the title's place and the menu stands aside for it;
 * what closing asks and what either was refused for go under the row.
 */
export function ChatPaneThreadActions(props: {
  readonly home: ThreadHome;
  readonly thread: ChatPaneThreadNamed;
  /** The reader may change no thread, so Rename and Close are not offered. */
  readonly viewOnly?: boolean;
}): ReactNode {
  const actions = useThreadEntryActions(props.home, props.thread);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        {actions.renaming ? (
          <ThreadEntryRename
            initial={props.thread.title ?? ""}
            actions={actions}
          />
        ) : (
          <>
            <ChatPaneThreadTitle thread={props.thread} />
            <ChatPaneThreadMenu
              home={props.home}
              session={props.thread.session}
              actions={actions}
              changes={props.viewOnly !== true}
              onConfirming={() => {
                setConfirming(true);
              }}
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
          <Notice tone="danger" inline>
            <ConsoleWriteRefusedWords refused={actions.refused} />
          </Notice>
        </ChatPaneHeaderRow>
      )}
    </>
  );
}
