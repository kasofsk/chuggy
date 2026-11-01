/**
 * The console's store: the browser-only state that must outlive what draws it,
 * one slice per cell, for the life of the tab and no longer.
 *
 * WHAT NEVER ENTERS IT. A server's answer, which is TanStack Query's, and a
 * held draft's `DraftResponse` is not one: it is the console's own record of
 * its submission, and nothing refreshes it. A token or a one-time secret; a
 * function; a DOM node; a promise; and text that changes per token or per
 * keystroke. The one exception is the question typed
 * at an inquiry box, because the pair held beside it is a retry of that
 * question and no other, so the two are kept together or not at all. What the URL
 * holds stays in the URL, and what only one component draws stays in that
 * component. A cell enters only because something must survive the screen
 * that drew it.
 *
 * THERE IS NO MODULE'S STORE. `consoleStore` is called once by `main.tsx`,
 * beside the query client, and once by each case, so no state crosses from one
 * case to the next. A write that reports into it takes the dispatch when it
 * mounts, and the store outliving every screen is what keeps that dispatch
 * good after the screen is gone.
 *
 * THE DEVTOOLS ARE A DEVELOPMENT BUILD'S, because what a reader typed is in
 * the actions they log.
 */

import { combineSlices, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

import { creationDraftsHeld } from "./creationDraftsHeld.ts";
import { inboxProposalHeard } from "./inboxProposalHeard.ts";
import { inquiryBoxes } from "./lead/inquiryBoxes.ts";
import { ticketAttempts } from "./ticketAttempts.ts";

const consoleReducer = combineSlices(
  inquiryBoxes,
  inboxProposalHeard,
  ticketAttempts,
  creationDraftsHeld,
);

export type ConsoleState = ReturnType<typeof consoleReducer>;

export function consoleStore() {
  return configureStore({
    reducer: consoleReducer,
    devTools: import.meta.env.DEV,
  });
}

export type ConsoleStore = ReturnType<typeof consoleStore>;

export type ConsoleDispatch = ConsoleStore["dispatch"];

export const useConsoleSelector = useSelector.withTypes<ConsoleState>();

export const useConsoleDispatch = useDispatch.withTypes<ConsoleDispatch>();
