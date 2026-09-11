/**
 * The chat pane's own state: where in the frame it sits, how much of the frame
 * it takes, and which of the reader's threads it holds.
 *
 * There are three ways it takes the frame and no fourth: a column beside the
 * pages, the whole frame, or the strip its own control expands. The width of
 * that column is the token's and not the reader's, so nothing here carries a
 * size.
 *
 * The placement and the presentation are what a reader chose and what a reload
 * has to keep, so they are read from and written to a key-value store here
 * rather than held only in a component. What the pane holds is derived from the
 * reader's own thread listing, and a listing that has not answered holds
 * nothing and offers nothing — an offer to open a thread before the listing
 * says whether one stands would race the door that answers idempotently on it.
 */

import { z } from "zod";

import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import type { KeyValuePort } from "./sessionHolder.ts";
import { threadMine } from "./threads.ts";

export const chatPanePlacements = ["Right", "Left", "Bottom"] as const;

export type ChatPanePlacement = (typeof chatPanePlacements)[number];

export const chatPanePresentations = ["Docked", "Collapsed", "Full"] as const;

export type ChatPanePresentation = (typeof chatPanePresentations)[number];

export interface ChatPaneState {
  readonly placement: ChatPanePlacement;
  readonly presentation: ChatPanePresentation;
}

export const chatPaneDefault: ChatPaneState = {
  placement: "Right",
  presentation: "Docked",
};

export const chatPaneStoreKey = "chuggy.chatPane";

const chatPaneSchema = z.object({
  placement: z.enum(chatPanePlacements),
  presentation: z.enum(chatPanePresentations),
});

/** The stored state, or the default where nothing was stored and where what
 * was stored no longer parses. */
export function chatPaneRead(store: KeyValuePort): ChatPaneState {
  const stored = store.read(chatPaneStoreKey);
  if (stored === null) return chatPaneDefault;
  const held = chatPaneSchema.safeParse(
    ((): unknown => {
      try {
        return JSON.parse(stored);
      } catch {
        return undefined;
      }
    })(),
  );
  return held.success ? held.data : chatPaneDefault;
}

export function chatPaneWrite(store: KeyValuePort, state: ChatPaneState): void {
  store.write(chatPaneStoreKey, JSON.stringify(state));
}

/** Whether the frame draws the pages beside the pane, which a pane taking the
 * whole frame does not. */
export function chatPaneContentDrawn(state: ChatPaneState): boolean {
  return state.presentation !== "Full";
}

/** Whether the pane is drawn as the strip it is expanded back from, which is
 * what a collapse leaves rather than nothing at all. */
export function chatPaneStripped(state: ChatPaneState): boolean {
  return state.presentation === "Collapsed";
}

/**
 * The pane as a viewport too narrow to divide can draw it: docked beside the
 * pages there would leave neither of them a usable width, so it stacks under
 * them instead. What the reader stored is untouched, and a viewport that widens
 * again draws it where they put it.
 */
export function chatPaneNarrowed(
  state: ChatPaneState,
  twoColumn: boolean,
): ChatPaneState {
  if (twoColumn || state.presentation !== "Docked") return state;
  return { placement: "Bottom", presentation: "Docked" };
}

/** The pane moved to a placement the reader picked, keeping how it takes the
 * frame. */
export function chatPaneRepositioned(
  state: ChatPaneState,
  placement: ChatPanePlacement,
): ChatPaneState {
  return { placement, presentation: state.presentation };
}

/** What the collapse control leaves behind, and what expanding the strip
 * restores. */
export function chatPaneToggled(state: ChatPaneState): ChatPaneState {
  return {
    placement: state.placement,
    presentation: state.presentation === "Collapsed" ? "Docked" : "Collapsed",
  };
}

/** The pane over the whole frame. */
export function chatPaneFilled(state: ChatPaneState): ChatPaneState {
  return { placement: state.placement, presentation: "Full" };
}

/** The pane back beside the pages, which is what leaving a full screen means
 * and collapsing does not. */
export function chatPaneRestored(state: ChatPaneState): ChatPaneState {
  return { placement: state.placement, presentation: "Docked" };
}

export type ChatPaneStart =
  | { readonly start: "Unknown" }
  | { readonly start: "Offered"; readonly closes: string | undefined }
  | { readonly start: "Answering" };

export interface ChatPaneHolding {
  /** The thread the pane draws: the one the reader picked out of the history,
   * else their own open one, and absent while the listing has not answered and
   * while they have neither. */
  readonly session: string | undefined;
  readonly start: ChatPaneStart;
}

/** What the offer to start another says, which is about the reader's own
 * thread and never about the one they happen to be reading. */
function chatPaneStarts(
  mine: ThreadEntryResponse | undefined,
  answering: boolean,
): ChatPaneStart {
  if (mine === undefined) return { start: "Offered", closes: undefined };
  if (answering) return { start: "Answering" };
  return { start: "Offered", closes: mine.session };
}

/**
 * Which thread the pane draws and what starting another would do.
 *
 * A THREAD THE READER NAMED WINS OVER THE LISTING — they name one by picking it
 * out of the history and by starting one, and a thread just started is not in
 * the listing yet, so a pick held only where the listing already agreed would
 * draw an empty pane over the thread the reader is waiting to type in, the read
 * of the thread itself being what says whether it is there; a thread with a
 * turn the mailbox has not settled is not closed out from under itself, so the
 * offer says it is answering instead.
 */
export function chatPaneHolding(
  threads: readonly ThreadEntryResponse[] | undefined,
  answering: boolean,
  chosen: string | undefined,
): ChatPaneHolding {
  if (threads === undefined && chosen === undefined)
    return { session: undefined, start: { start: "Unknown" } };
  const mine = threads === undefined ? undefined : threadMine(threads);
  return {
    session: chosen ?? mine?.session,
    start:
      threads === undefined
        ? { start: "Unknown" }
        : chatPaneStarts(mine, answering),
  };
}
