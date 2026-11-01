/**
 * Whether this console is older than the API, as `core/consoleOutdated.ts`
 * says, held for the life of the store, so it stands across every screen and
 * project. A read is heard through the query cache the store is made over,
 * and a frame the stream skipped by the stream dispatching it.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { Dispatch } from "@reduxjs/toolkit";
import type { QueryClient } from "@tanstack/react-query";

import { consoleOutdatedRead } from "../core/consoleOutdated.ts";

export const consoleOutdated = createSlice({
  name: "consoleOutdated",
  initialState: false,
  reducers: {
    consoleOutdatedHeard: () => true,
  },
  selectors: {
    consoleOutdatedOf: (outdated) => outdated,
  },
});

export const { consoleOutdatedHeard } = consoleOutdated.actions;

export const { consoleOutdatedOf } = consoleOutdated.selectors;

/** Each read of `client` whose document the schema refused, dispatched for as
 * long as the client lives. */
export function consoleOutdatedHeardFrom(
  client: QueryClient,
  dispatch: Dispatch,
): void {
  client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "error" &&
      consoleOutdatedRead(event.action.error)
    )
      dispatch(consoleOutdatedHeard());
  });
}
