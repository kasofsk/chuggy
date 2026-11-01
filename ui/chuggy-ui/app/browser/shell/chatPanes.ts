/**
 * The chat pane as the console holds it: where it sits and how much of the
 * frame it takes, and a record per project of the thread the reader picked,
 * the thread held for a reader who picked none, New's open key, and a first
 * message's hand-over to the thread it opened. What each move does is
 * `core/chatPane.ts`'s.
 *
 * A store a browser refuses is read as empty and written to in vain, so what is
 * drawn is the state held here and never a re-read. A pick is not stored,
 * because it is only worth keeping for the tab. A thread's own page draws no
 * pane, and returning from one draws the pick again.
 */

import { createSlice } from "@reduxjs/toolkit";
import type {
  PayloadAction,
  ThunkAction,
  UnknownAction,
} from "@reduxjs/toolkit";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  chatPaneDefaultHeld,
  chatPaneHoldRead,
  chatPaneHoldWritten,
  chatPaneOpened,
  chatPaneOpening,
  chatPaneOpenKeyHeld,
  chatPanePicked,
  chatPaneOpeningRead,
  chatPaneRecordOf,
  chatPaneRecordWith,
  chatPaneStarting,
  chatPaneStayed,
} from "../../core/chatPane.ts";
import type { ChatPaneRecord } from "../../core/chatPane.ts";
import type {
  ChatPaneHold,
  ChatPaneRecords,
  ChatPaneState,
} from "../../core/chatPane.ts";
import {
  threadOpenKeyBytesCount,
  threadOpenKeyMinted,
} from "../../core/threads.ts";
import { drawBytes, persistentStore } from "../ports.ts";

export interface ChatPanesHeld {
  readonly hold: ChatPaneHold;
  readonly records: ChatPaneRecords;
}

/** Which project's record an action writes, and the thread it names. */
interface ChatPaneSessionAt {
  readonly partition: PartitionIdentity;
  readonly session: string;
}

/** The pane's records with one project's moved by `move`. */
function chatPanesWith(
  held: ChatPanesHeld,
  partition: PartitionIdentity,
  move: (record: ChatPaneRecord) => ChatPaneRecord,
): ChatPanesHeld {
  return {
    ...held,
    records: chatPaneRecordWith(held.records, partition, move),
  };
}

export const chatPanes = createSlice({
  name: "chatPanes",
  initialState: (): ChatPanesHeld => ({
    hold: chatPaneHoldRead(persistentStore),
    records: {},
  }),
  reducers: {
    chatPaneHoldKept: (held, action: PayloadAction<ChatPaneHold>) => ({
      ...held,
      hold: action.payload,
    }),
    chatPanePickedAt: (held, action: PayloadAction<ChatPaneSessionAt>) => ({
      ...held,
      records: chatPaneRecordWith(
        held.records,
        action.payload.partition,
        (record) => chatPanePicked(record, action.payload.session),
      ),
    }),
    chatPaneDefaultHeldAt: (
      held,
      action: PayloadAction<{
        readonly partition: PartitionIdentity;
        readonly session: string | undefined;
      }>,
    ) => ({
      ...held,
      records: chatPaneRecordWith(
        held.records,
        action.payload.partition,
        (record) => chatPaneDefaultHeld(record, action.payload.session),
      ),
    }),
    chatPaneOpenKeyHeldAt: (
      held,
      action: PayloadAction<{
        readonly partition: PartitionIdentity;
        readonly key: string;
      }>,
    ) => ({
      ...held,
      records: chatPaneRecordWith(
        held.records,
        action.payload.partition,
        (record) => chatPaneOpenKeyHeld(record, action.payload.key),
      ),
    }),
    chatPaneOpenedAt: (held, action: PayloadAction<ChatPaneSessionAt>) => ({
      ...held,
      records: chatPaneRecordWith(
        held.records,
        action.payload.partition,
        (record) => chatPaneOpened(record, action.payload.session),
      ),
    }),
    chatPaneStartingAt: (held, action: PayloadAction<PartitionIdentity>) =>
      chatPanesWith(held, action.payload, chatPaneStarting),
    chatPaneStayedAt: (held, action: PayloadAction<PartitionIdentity>) =>
      chatPanesWith(held, action.payload, chatPaneStayed),
    chatPaneOpeningAt: (held, action: PayloadAction<ChatPaneSessionAt>) =>
      chatPanesWith(held, action.payload.partition, (record) =>
        chatPaneOpening(record, action.payload.session),
      ),
    chatPaneReadAt: (held, action: PayloadAction<PartitionIdentity>) =>
      chatPanesWith(held, action.payload, chatPaneOpeningRead),
  },
  selectors: {
    chatPaneHoldOf: (held) => held.hold,
    chatPaneRecordAt: (held, partition: PartitionIdentity) =>
      chatPaneRecordOf(held.records, partition),
  },
});

export const {
  chatPaneHoldKept,
  chatPanePickedAt,
  chatPaneDefaultHeldAt,
  chatPaneOpenKeyHeldAt,
  chatPaneOpenedAt,
  chatPaneStartingAt,
  chatPaneStayedAt,
  chatPaneOpeningAt,
  chatPaneReadAt,
} = chatPanes.actions;

export const { chatPaneHoldOf, chatPaneRecordAt } = chatPanes.selectors;

type ChatPanesThunk<T> = ThunkAction<
  T,
  { readonly chatPanes: ChatPanesHeld },
  unknown,
  UnknownAction
>;

/** The pane moved, written to the browser's store where it is stored, and held
 * as the write answered. */
export function chatPaneMoved(
  next: ChatPaneState,
  twoColumn: boolean,
): ChatPanesThunk<void> {
  return (dispatch, getState) => {
    const hold = chatPaneHoldOf(getState());
    dispatch(
      chatPaneHoldKept(
        chatPaneHoldWritten(persistentStore, hold, next, twoColumn),
      ),
    );
  };
}

/** The key a press of New asks its open under: the one standing, which an
 * open whose answer was lost may have opened a thread under, or one drawn and
 * held before the open is made. */
export function chatPaneOpenPressed(
  partition: PartitionIdentity,
): ChatPanesThunk<string> {
  return (dispatch, getState) => {
    const standing = chatPaneRecordAt(getState(), partition).openKey;
    if (standing !== undefined) return standing;
    const key = threadOpenKeyMinted(drawBytes(threadOpenKeyBytesCount));
    dispatch(chatPaneOpenKeyHeldAt({ partition, key }));
    return key;
  };
}
