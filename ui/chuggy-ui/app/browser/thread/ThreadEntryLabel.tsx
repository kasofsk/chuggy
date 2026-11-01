/**
 * The rename and close actions for the thread the pane or its own page holds,
 * and the editor the rename opens into.
 *
 * The state is separate from what draws it because the header drawing them
 * swaps the title for this editor while a rename is open, and the menu
 * beside it comes and goes with the same state, over one call to
 * `useThreadEntryActions`.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { threadTitleCharsMax } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  apiCloseThreadAt,
  apiRenameThreadAt,
  threadHomeNamed,
} from "../../core/threadHome.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import { threadActions } from "../../core/threads.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { memberChatReread } from "./threadRead.ts";

export interface ThreadEntryActions {
  readonly renaming: boolean;
  readonly busy: boolean;
  /** The sentence the last press was refused in. */
  readonly refused: string | undefined;
  readonly closable: boolean;
  /** Whether renaming this thread is the reader's to do: the door is
   * owner-scoped and refuses `NotYourThread` otherwise, so a thread that is
   * not the reader's own does not offer an action it can only ever be
   * refused. */
  readonly renameable: boolean;
  readonly startRename: () => void;
  readonly submitRename: (title: string) => void;
  readonly cancelRename: () => void;
  readonly close: () => void;
}

/** One change to a thread, keyed by the thread it changes, and over once a
 * thread of the reader's own chat, which no frame names, has been read again. */
function threadEntryWrite<V>(
  named: string,
  home: ThreadHome,
  session: string,
  write: ConsoleWrite<V, unknown>["write"],
): ConsoleWrite<V, unknown> {
  return {
    mutationKey: consoleWriteKey(named, threadHomeNamed(home), session),
    write,
    refusal: (failure) => `Refused · ${panelReason(failure)}`,
    landed: async (client) => {
      if (home.scope === "Member")
        await memberChatReread(client, home.tenant, session);
    },
  };
}

/** The thread renamed to the title its press typed. */
function threadRenameWrite(
  home: ThreadHome,
  session: string,
): ConsoleWrite<string, unknown> {
  return threadEntryWrite("thread-rename", home, session, (ports, title) =>
    apiRenameThreadAt(ports, home, session, title),
  );
}

/** The thread closed, wherever the control that closes it is drawn. */
export function threadCloseWrite(
  home: ThreadHome,
  session: string,
): ConsoleWrite<undefined, unknown> {
  return threadEntryWrite("thread-close", home, session, (ports) =>
    apiCloseThreadAt(ports, home, session),
  );
}

/** The rename and close state for one thread, called once and shared by the
 * title it swaps and the menu beside it. */
export function useThreadEntryActions(
  home: ThreadHome,
  thread: Pick<ThreadEntryResponse, "session" | "mine" | "state">,
): ThreadEntryActions {
  const [renaming, setRenaming] = useState(false);
  const renames = useConsoleWrite(threadRenameWrite(home, thread.session), {
    drawn: true,
  });
  const closes = useConsoleWrite(threadCloseWrite(home, thread.session), {
    drawn: true,
  });
  const offered = threadActions(thread);

  return {
    renaming,
    busy: renames.isPending || closes.isPending,
    refused: (renames.error ?? closes.error)?.message,
    closable: offered.includes("Close"),
    renameable: offered.includes("Rename"),
    startRename: () => {
      setRenaming(true);
    },
    cancelRename: () => {
      setRenaming(false);
    },
    submitRename: (title: string) => {
      closes.reset();
      renames.mutate(title, {
        onSuccess: () => {
          setRenaming(false);
        },
      });
    },
    close: () => {
      renames.reset();
      closes.mutate(undefined);
    },
  };
}

/** The rename editor: Enter saves, and Escape or leaving it restores the title
 * it opened with — except while a save is in flight, whose disabling the input
 * is what took the focus. */
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
      onBlur={() => {
        if (!props.actions.busy) props.actions.cancelRename();
      }}
    />
  );
}
