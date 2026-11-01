/**
 * The refusals no screen took, held for the shell's toasts until the reader
 * lets each go. What keeping and letting go do is `core/consoleWrite.ts`'s,
 * and which refusals arrive is the client's watch's.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { Dispatch, PayloadAction } from "@reduxjs/toolkit";
import type { QueryClient } from "@tanstack/react-query";

import {
  consoleWriteUnseenDismissed,
  consoleWriteUnseenHeldEmpty,
  consoleWriteUnseenKept,
  consoleWriteUnseenSaidOf,
  consoleWriteWatchOf,
} from "../core/consoleWrite.ts";
import type { ConsoleWriteUnseenSaid } from "../core/consoleWrite.ts";

export const consoleWriteUnseen = createSlice({
  name: "consoleWriteUnseen",
  initialState: consoleWriteUnseenHeldEmpty,
  reducers: {
    consoleWriteUnseenHeard: (
      held,
      action: PayloadAction<ConsoleWriteUnseenSaid>,
    ) => consoleWriteUnseenKept(held, action.payload),
    consoleWriteUnseenLetGo: (held, action: PayloadAction<number>) =>
      consoleWriteUnseenDismissed(held, action.payload),
  },
  selectors: {
    consoleWriteUnseenOf: (held) => held.unseen,
  },
});

export const { consoleWriteUnseenHeard, consoleWriteUnseenLetGo } =
  consoleWriteUnseen.actions;

export const { consoleWriteUnseenOf } = consoleWriteUnseen.selectors;

/** Each refusal `client`'s watch hands on, dispatched for as long as the
 * client lives. */
export function consoleWriteUnseenHeardFrom(
  client: QueryClient,
  dispatch: Dispatch,
): void {
  consoleWriteWatchOf(client).unseenHeard((refused) => {
    dispatch(consoleWriteUnseenHeard(consoleWriteUnseenSaidOf(refused)));
  });
}
