/**
 * Every thread the reader can reach, behind one control in the pane's header —
 * their own first, then everyone else's.
 *
 * This is the whole of what the Threads page used to be. A thread is read in
 * the pane and nowhere else, so the listing is a way to choose which one the
 * pane holds rather than a screen of its own, and the row actions the page
 * carried are offered on the thread being read instead of on every row: a menu
 * inside a menu is a shape neither a pointer nor a screen reader handles well.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { threadLabel, threadsMineFirst } from "../../core/threads.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  ThreadEntryMenu,
  ThreadEntryRename,
  useThreadEntryActions,
} from "../thread/ThreadEntryLabel.tsx";

import "../ui/Picker.css";

/** The threads the history offers: hidden ones are the reader's own way of
 * saying they are done with a thread, so the menu honours that and the listing
 * still carries them for anything that asks. */
function chatPaneHistoryRows(
  threads: readonly ThreadEntryResponse[],
): readonly ThreadEntryResponse[] {
  return threadsMineFirst(threads.filter((thread) => !thread.hidden));
}

export function ChatPaneHistory(props: {
  readonly threads: readonly ThreadEntryResponse[];
  readonly session: string | undefined;
  readonly onChoose: (session: string) => void;
}): ReactNode {
  const rows = chatPaneHistoryRows(props.threads);
  if (rows.length === 0) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonLookClassName({ size: "sm", variant: "quiet" })}
      >
        History
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          <DropdownMenu.RadioGroup
            value={props.session ?? ""}
            onValueChange={props.onChoose}
          >
            {rows.map((thread) => (
              <DropdownMenu.RadioItem
                key={thread.session}
                className={menuItemClassName}
                value={thread.session}
              >
                <span className="picker-gutter">
                  <DropdownMenu.ItemIndicator className="picker-mark" />
                </span>
                {threadLabel(thread)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Rename, close and hide, offered on the thread the pane is holding. */
export function ChatPaneThreadActions(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
}): ReactNode {
  const actions = useThreadEntryActions(props.partition, props.thread);
  if (actions.renaming)
    return (
      <ThreadEntryRename initial={props.thread.title ?? ""} actions={actions} />
    );
  return (
    <>
      <ThreadEntryMenu actions={actions} />
      {actions.refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${actions.refused}`} />
      )}
    </>
  );
}
