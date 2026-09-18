/**
 * The rename and close actions for the thread the pane holds, and the editor
 * the rename opens into.
 *
 * The state is separate from what draws it because the chat pane's header
 * swaps the title for this editor while a rename is open, and the buttons
 * beside it come and go with the same state, over one call to
 * `useThreadEntryActions`.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { threadTitleCharsMax } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { apiCloseThread, apiRenameThread } from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import { threadActions } from "../../core/threads.ts";
import { useApiPorts } from "../api.ts";

export interface ThreadEntryActions {
  readonly renaming: boolean;
  readonly busy: boolean;
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

/** The rename and close state for the thread the pane holds, called once and
 * shared by the title it swaps and the buttons beside it. */
export function useThreadEntryActions(
  partition: PartitionIdentity,
  thread: ThreadEntryResponse,
): ThreadEntryActions {
  const ports = useApiPorts();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const offered = threadActions(thread);

  return {
    renaming,
    busy,
    refused,
    closable: offered.includes("Close"),
    renameable: offered.includes("Rename"),
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
