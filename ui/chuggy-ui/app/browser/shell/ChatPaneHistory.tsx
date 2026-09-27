/**
 * Every thread the reader can reach, behind one control in the pane's header —
 * their own, then a divider, then everyone else's.
 *
 * This is the whole of what the Threads page used to be. A thread is read in
 * the pane and nowhere else, so the listing is a way to choose which one the
 * pane holds rather than a screen of its own, and the actions the page
 * carried per thread are offered on the thread being read instead of on every
 * row: a control inside a menu row is a shape neither a pointer nor a screen
 * reader handles well.
 */

import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import type { ThreadStanding } from "../../../../../src/contract/rosters.ts";
import { agoText } from "../../core/figures.ts";
import { threadLabel, threadsByStanding } from "../../core/threads.ts";
import { useNowMs } from "../Freshness.tsx";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { ChatPaneIcon, ChatPaneIconButton } from "./chatPaneIcons.tsx";
import type { ChatPaneGlyphName } from "./chatPaneIcons.tsx";
import {
  ThreadEntryRename,
  useThreadEntryActions,
} from "../thread/ThreadEntryLabel.tsx";

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
          className={buttonLookClassName({ size: "sm", variant: "quiet" })}
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
    <div
      role="group"
      aria-label="Close this thread?"
      className="border-edge grid gap-2 rounded-2 border p-3 text-sm"
    >
      <p className="text-ink-2 m-0">
        {props.mine
          ? ""
          : "This thread is not yours; closing it ends it for its owner too. "}
        It stays readable in History, but it will take no more messages, and a
        reply still in progress is abandoned. This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="quiet" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          busy={props.busy}
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          Close thread
        </Button>
      </div>
    </div>
  );
}

/**
 * The thread the pane holds, on a row of its own under the pane's controls:
 * its title with Rename beside it, and Close at the row's end, which asks
 * before it closes. While a rename is open, the editor takes the title's place
 * and the buttons stand aside for it.
 */
export function ChatPaneThreadActions(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
}): ReactNode {
  const actions = useThreadEntryActions(props.partition, props.thread);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className="flex w-full min-w-0 items-center gap-1">
        {actions.renaming ? (
          <ThreadEntryRename
            initial={props.thread.title ?? ""}
            actions={actions}
          />
        ) : (
          <>
            <h2 className="text-ink-2 font-strong min-w-0 truncate text-sm">
              {threadLabel(props.thread)}
            </h2>
            {actions.renameable ? (
              <ChatPaneIconButton
                glyph="rename"
                label="Rename"
                onClick={actions.startRename}
              />
            ) : null}
            {actions.closable ? (
              <span className="ml-auto">
                <ChatPaneIconButton
                  glyph="close"
                  label="Close"
                  pressed={confirming}
                  onClick={() => {
                    setConfirming(!confirming);
                  }}
                />
              </span>
            ) : null}
          </>
        )}
      </div>
      {confirming && !actions.renaming ? (
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
      ) : null}
      {actions.refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${actions.refused}`} />
      )}
    </>
  );
}
