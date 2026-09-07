/**
 * One thread's name and the menu that renames, closes and hides it — the
 * pieces are separate because the rail draws them side by side in one row and
 * the Threads page draws them in two columns, and the state behind both is
 * `useThreadEntryActions`, called once per row either way.
 *
 * THE MENU'S TRIGGER IS NEVER INSIDE THE LINK. Radix's dropdown needs its own
 * button, and a button nested in an anchor is invalid markup a screen reader
 * cannot parse either arm of.
 */

import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { threadTitleCharsMax } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import {
  apiCloseThread,
  apiHideThread,
  apiRenameThread,
} from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import { threadLabel, threadRowActions } from "../../core/threads.ts";
import { useApiPorts } from "../api.ts";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { Notice } from "../ui/Notice.tsx";

export interface ThreadEntryActions {
  readonly renaming: boolean;
  readonly busy: boolean;
  readonly refused: string | undefined;
  readonly closable: boolean;
  /** Whether renaming this thread is the reader's to do: the door is
   * owner-scoped and refuses `NotYourThread` otherwise, so a row that is not
   * the reader's own does not offer an action it can only ever be refused. */
  readonly renameable: boolean;
  /** Hiding or showing is owner-scoped the same way. */
  readonly hideable: boolean;
  readonly hidden: boolean;
  /** Whether the row offers any action at all — a stranger's closed row
   * offers none, and draws no `…` trigger. */
  readonly actionable: boolean;
  readonly startRename: () => void;
  readonly submitRename: (title: string) => void;
  readonly cancelRename: () => void;
  readonly toggleHidden: () => void;
  readonly close: () => void;
}

/** The rename, hide and close state for one thread's row, called once per
 * row wherever it is drawn. */
export function useThreadEntryActions(
  partition: PartitionIdentity,
  thread: ThreadEntryResponse,
): ThreadEntryActions {
  const ports = useApiPorts();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const rowActions = threadRowActions(thread);

  return {
    renaming,
    busy,
    refused,
    closable: rowActions.includes("Close"),
    renameable: rowActions.includes("Rename"),
    hideable: rowActions.includes("Hide") || rowActions.includes("Show"),
    hidden: thread.hidden,
    actionable: rowActions.length > 0,
    startRename: () => {
      setRenaming(true);
    },
    cancelRename: () => {
      setRenaming(false);
    },
    submitRename: (title: string) => {
      setBusy(true);
      setRefused(undefined);
      void apiRenameThread(ports, partition, thread.session, title).then(
        (result) => {
          setBusy(false);
          if (result.outcome !== "Ok") {
            setRefused(panelReason(result));
            return;
          }
          setRenaming(false);
        },
      );
    },
    toggleHidden: () => {
      setBusy(true);
      setRefused(undefined);
      void apiHideThread(ports, partition, thread.session, !thread.hidden).then(
        (result) => {
          setBusy(false);
          if (result.outcome !== "Ok") setRefused(panelReason(result));
        },
      );
    },
    close: () => {
      setBusy(true);
      setRefused(undefined);
      void apiCloseThread(ports, partition, thread.session).then((result) => {
        setBusy(false);
        if (result.outcome !== "Ok") setRefused(panelReason(result));
      });
    },
  };
}

/** The rename editor: Enter saves, Escape restores the title it opened with. */
export function ThreadEntryRename(props: {
  readonly initial: string;
  readonly actions: ThreadEntryActions;
}): ReactNode {
  const [title, setTitle] = useState(props.initial);
  return (
    <input
      className="bg-surface-1 border-edge-control rounded-2 min-w-0 flex-1 border px-2 py-1 text-md"
      value={title}
      aria-label="Thread title"
      maxLength={threadTitleCharsMax}
      disabled={props.actions.busy}
      autoFocus
      onChange={(event) => {
        setTitle(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.actions.submitRename(title);
        if (event.key === "Escape") props.actions.cancelRename();
      }}
    />
  );
}

const threadEntryMenuTriggerClassName =
  "shrink-0 rounded-2 px-1 text-ink-3 opacity-0 group-hover:opacity-100" +
  " group-focus-within:opacity-100 data-[state=open]:opacity-100";

export function ThreadEntryMenu(props: {
  readonly actions: ThreadEntryActions;
}): ReactNode {
  const actions = props.actions;
  if (!actions.actionable) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label="Thread actions"
        className={threadEntryMenuTriggerClassName}
      >
        …
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          {actions.renameable ? (
            <DropdownMenu.Item
              className={menuItemClassName}
              onSelect={actions.startRename}
            >
              Rename
            </DropdownMenu.Item>
          ) : null}
          {actions.closable ? (
            <DropdownMenu.Item
              className={menuItemClassName}
              onSelect={actions.close}
            >
              Close
            </DropdownMenu.Item>
          ) : null}
          {actions.hideable ? (
            <DropdownMenu.Item
              className={menuItemClassName}
              onSelect={actions.toggleHidden}
            >
              {actions.hidden ? "Show" : "Hide"}
            </DropdownMenu.Item>
          ) : null}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The rail's own row: name, menu and refusal side by side, over one call to
 * the actions hook. */
export function ThreadEntryLabel(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
  readonly onNavigate?: (() => void) | undefined;
}): ReactNode {
  const thread = props.thread;
  const actions = useThreadEntryActions(props.partition, thread);
  return (
    <>
      {actions.renaming ? (
        <ThreadEntryRename initial={thread.title ?? ""} actions={actions} />
      ) : (
        <>
          <Link
            to="/$tenant/$project/threads/$session"
            params={{ ...props.partition, session: thread.session }}
            onClick={props.onNavigate}
            className="min-w-0 flex-1 truncate no-underline"
            activeProps={{ className: "text-ink-1" }}
          >
            {threadLabel(thread)}
          </Link>
          <ThreadEntryMenu actions={actions} />
        </>
      )}
      {actions.refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${actions.refused}`} />
      )}
    </>
  );
}
