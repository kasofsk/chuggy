/**
 * Every thread the reader can reach, behind one control in the pane's header —
 * their own first, then everyone else's.
 *
 * This is the whole of what the Threads page used to be. A thread is read in
 * the pane and nowhere else, so the listing is a way to choose which one the
 * pane holds rather than a screen of its own, and the actions the page
 * carried per thread are offered on the thread being read instead of on every
 * row: a control inside a menu row is a shape neither a pointer nor a screen
 * reader handles well.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { threadLabel, threadsMineFirst } from "../../core/threads.ts";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  ThreadEntryRename,
  useThreadEntryActions,
} from "../thread/ThreadEntryLabel.tsx";

import "../ui/Picker.css";

/** The threads the history offers: every one the reader can reach, their own
 * first. */
function chatPaneHistoryRows(
  threads: readonly ThreadEntryResponse[],
): readonly ThreadEntryResponse[] {
  return threadsMineFirst(threads);
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

/**
 * The title of the thread the pane holds, and Rename and Close beside the
 * pane's own controls. While a rename is open, the editor takes the title's
 * place and the buttons stand aside for it.
 */
export function ChatPaneThreadActions(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
}): ReactNode {
  const actions = useThreadEntryActions(props.partition, props.thread);
  return (
    <>
      <div className="flex w-full min-w-0 items-center gap-2">
        {actions.renaming ? (
          <ThreadEntryRename
            initial={props.thread.title ?? ""}
            actions={actions}
          />
        ) : (
          <h2 className="text-ink-2 font-strong min-w-0 flex-1 truncate text-sm">
            {threadLabel(props.thread)}
          </h2>
        )}
      </div>
      {actions.renaming ? null : (
        <>
          {actions.renameable ? (
            <Button variant="quiet" size="sm" onClick={actions.startRename}>
              Rename
            </Button>
          ) : null}
          {actions.closable ? (
            <Button variant="quiet" size="sm" onClick={actions.close}>
              Close
            </Button>
          ) : null}
        </>
      )}
      {actions.refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${actions.refused}`} />
      )}
    </>
  );
}
