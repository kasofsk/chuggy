/**
 * The refusals no screen took, and the last landing a write said, held for
 * the shell's toasts until each is let go. What keeping and letting go do is `core/consoleWrite.ts`'s,
 * and which refusals arrive is the client's watch's.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { Dispatch, PayloadAction } from "@reduxjs/toolkit";
import type { QueryClient } from "@tanstack/react-query";

import {
  consoleWriteLandedKept,
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
    consoleWriteLandedHeard: (held, action: PayloadAction<string>) =>
      consoleWriteLandedKept(held, action.payload),
    consoleWriteUnseenLetGo: (held, action: PayloadAction<number>) =>
      consoleWriteUnseenDismissed(held, action.payload),
  },
  selectors: {
    consoleWriteUnseenOf: (held) => held.unseen,
    consoleWriteLandedOf: (held) => held.landed,
  },
});

export const {
  consoleWriteLandedHeard,
  consoleWriteUnseenHeard,
  consoleWriteUnseenLetGo,
} = consoleWriteUnseen.actions;

export const { consoleWriteLandedOf, consoleWriteUnseenOf } =
  consoleWriteUnseen.selectors;

/** Each refusal and each landing `client`'s watch hands on, dispatched for
 * as long as the client lives. */
export function consoleWriteUnseenHeardFrom(
  client: QueryClient,
  dispatch: Dispatch,
): void {
  const watch = consoleWriteWatchOf(client);
  watch.unseenHeard((refused) => {
    dispatch(consoleWriteUnseenHeard(consoleWriteUnseenSaidOf(refused)));
  });
  watch.landedHeard((sentence) => {
    dispatch(consoleWriteLandedHeard(sentence));
  });
}
