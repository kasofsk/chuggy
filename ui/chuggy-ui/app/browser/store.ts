/**
 * The console's store: the browser-only state that must outlive what draws it,
 * one slice per cell, for the life of the tab and no longer. What outlives the
 * tab is the port's, and `chatPanes` reads and writes it there.
 *
 * EACH KIND OF STATE HAS ONE HOME. A server's answer is TanStack Query's. A
 * transcript's walk is the exception: it folds every page of one read in its
 * component and starts again on each mount. Where the reader is, and what a
 * list filters by, is the URL's. What one component draws, typing included, is
 * that component's. A write is `useConsoleWrite`'s, however many requests it
 * sends: one press has one outcome, and its steps and its abort are carried in
 * its variables, so they live and go with it. What must outlive a screen, or
 * that screens share, is a slice's, and a flow with state past one write, such
 * as a send with its queue and its stop, is a thunk. What must outlive the tab
 * is `persistentStore`'s. Credentials are the session and invite holders'. What
 * a mounted provider owns and goes with it, such as a DOM node, a measurement
 * or a live connection's status, is that provider's.
 *
 * WHAT NEVER ENTERS IT. A server's answer, which is TanStack Query's, and a
 * held draft's `DraftResponse` is not one: it is the console's own record of
 * its submission, and nothing refreshes it. A token or a one-time secret; a
 * function; a DOM node; a promise; bytes; and text that changes per token or
 * per keystroke. What the URL holds stays in the URL, and what only one
 * component draws stays in that component. A cell enters only because
 * something must survive the screen that drew it.
 *
 * THERE IS NO MODULE'S STORE. `consoleStore` is called once by `main.tsx`,
 * beside the query client, and once by each case, so no state crosses from one
 * case to the next. A write that reports into it takes the dispatch when it
 * mounts, and the store outliving every screen is what keeps that dispatch
 * good after the screen is gone. A thunk reaches the API and the query cache
 * through its `extra`, made over the services the store is given, and so does
 * what a thunk holds that may not enter the store. A store lives as long as
 * its client, so what it hears of the client, a refusal no screen drew and a
 * read the schema refused, it hears for good.
 *
 * THE DEVTOOLS ARE A DEVELOPMENT BUILD'S, because what a reader typed is in
 * the actions they log.
 */

import { combineSlices, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

import {
  consoleOutdated,
  consoleOutdatedHeardFrom,
} from "./consoleOutdated.ts";
import {
  consoleWriteUnseen,
  consoleWriteUnseenHeardFrom,
} from "./consoleWriteUnseen.ts";
import { creationDraftsHeld } from "./creationDraftsHeld.ts";
import { inboxProposalHeard } from "./inboxProposalHeard.ts";
import { inquiryBoxes } from "./lead/inquiryBoxes.ts";
import { chatPanes } from "./shell/chatPanes.ts";
import { threadSendsCarriedMade } from "./storeExtra.ts";
import type { ConsoleExtra, ConsoleServices } from "./storeExtra.ts";
import { threadSends } from "./thread/threadSends.ts";
import { ticketAttempts } from "./ticketAttempts.ts";

const consoleReducer = combineSlices(
  inquiryBoxes,
  inboxProposalHeard,
  ticketAttempts,
  creationDraftsHeld,
  chatPanes,
  threadSends,
  consoleWriteUnseen,
  consoleOutdated,
);

export type ConsoleState = ReturnType<typeof consoleReducer>;

export function consoleStore(services: ConsoleServices) {
  const extra: ConsoleExtra = {
    ...services,
    threadSends: threadSendsCarriedMade(),
  };
  const store = configureStore({
    reducer: consoleReducer,
    middleware: (defaults) => defaults({ thunk: { extraArgument: extra } }),
    devTools: import.meta.env.DEV,
  });
  consoleWriteUnseenHeardFrom(services.client, store.dispatch);
  consoleOutdatedHeardFrom(services.client, store.dispatch);
  return store;
}

export type ConsoleStore = ReturnType<typeof consoleStore>;

export type ConsoleDispatch = ConsoleStore["dispatch"];

export const useConsoleSelector = useSelector.withTypes<ConsoleState>();

export const useConsoleDispatch = useDispatch.withTypes<ConsoleDispatch>();
