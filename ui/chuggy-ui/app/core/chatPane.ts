/**
 * The chat pane's own state: where in the frame it sits, how much of the frame
 * it takes, and which of the reader's threads it holds.
 *
 * There are three ways it takes the frame and no fourth: a column beside the
 * pages, the whole frame, or the strip its own control expands. How wide that
 * column is, or what share of the height it takes under the pages, is the
 * reader's: they drag its edge, and the sizes here are only where it starts
 * and how far it goes. They are stated here rather than as tokens because the
 * library that divides the frame takes them as props.
 *
 * The placement and the presentation are what a reader chose and what a reload
 * has to keep, so they are read from and written to a key-value store here
 * rather than held only in a component, and so is the share the reader dragged
 * the column to. A reader who has chosen nothing is drawn a default the
 * viewport decides: docked where it divides, and the strip where it does not,
 * since docked there the pane takes a share of every page. The presentation
 * stays the one record of whether the pane is collapsed: a drag across the
 * collapse threshold moves it, as the pane's own control does.
 *
 * THE TRAIL IS THE PANE AFTER A READER'S MOVES, a model the frame is held to:
 * which panels it draws and the pane's share of them, stated as the rules the
 * shell keeps rather than worked out as the library dividing the frame works
 * them. A collapsed pane is the strip. A docked one keeps the share it was
 * last laid open at where it sits, through another side, a full screen, a
 * thread's own page and the frame's height changing, and it is laid afresh
 * only where it was the strip and on a reload: at the share the reader last
 * dragged it open to there, else at its default. So the pane collapsed by its
 * control and expanded again has the width it had, and one dragged into the
 * strip expands to the width it was dragged from. Beside the pages the trail
 * holds the frame's width: a pane no reader has sized keeps its pixels as the
 * width changes, and another side, a full screen or a thread's own page then
 * lays it at its default again.
 *
 * What the pane holds is derived from the reader's own thread listing, and a
 * listing that has not answered holds nothing and offers nothing — an offer to
 * open a thread before the listing says whether one stands would race the door
 * that answers idempotently on it.
 */

import { z } from "zod";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../src/contract/responses.ts";
import type { KeyValuePort } from "./sessionHolder.ts";
import type { SessionRunnerShort } from "./sessionRunners.ts";
import {
  threadDoorRunnerShort,
  threadDoorUnhosted,
  threadMine,
  threadSendStanding,
  threadTakesMessages,
} from "./threads.ts";
import type { ThreadDoor, ThreadSend } from "./threads.ts";

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

const chatPaneDefaultNarrow: ChatPaneState = {
  placement: chatPaneDefault.placement,
  presentation: "Collapsed",
};

/** Where a pane the reader has never moved is drawn from, which is the strip
 * on a viewport too narrow to divide. */
export function chatPaneDefaultAt(twoColumn: boolean): ChatPaneState {
  return twoColumn ? chatPaneDefault : chatPaneDefaultNarrow;
}

/** The stored state, or nothing where nothing was stored and where what was
 * stored no longer parses. */
export function chatPaneRead(store: KeyValuePort): ChatPaneState | undefined {
  const stored = store.read(chatPaneStoreKey);
  if (stored === null) return undefined;
  const held = chatPaneSchema.safeParse(chatPaneParsed(stored));
  return held.success ? held.data : undefined;
}

/** What a stored value parses to, which is nothing where it is not JSON. */
function chatPaneParsed(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

export function chatPaneWrite(store: KeyValuePort, state: ChatPaneState): void {
  store.write(chatPaneStoreKey, JSON.stringify(state));
}

/** Whether the frame draws the pages beside the pane, which a pane taking the
 * whole frame does not. */
export function chatPaneContentDrawn(state: ChatPaneState): boolean {
  return state.presentation !== "Full";
}

/**
 * The pane the frame draws at a route, which is none on a thread's own page,
 * the one route that names a session: the thread is the page there, and a pane
 * beside it would draw the reader's own open thread twice, each with a
 * composer. What the reader stored is untouched.
 */
export function chatPaneOnPage(
  state: ChatPaneState,
  route: { readonly session?: string | undefined },
): ChatPaneState | undefined {
  return route.session === undefined ? state : undefined;
}

/** Whether the pane is drawn as the strip it is expanded back from, which is
 * what a collapse leaves rather than nothing at all. */
export function chatPaneStripped(state: ChatPaneState): boolean {
  return state.presentation === "Collapsed";
}

/**
 * The pane as a viewport too narrow to divide can draw it: docked beside the
 * pages it would leave neither a usable width, and its strip beside them takes
 * width the pages cannot spare, so either stacks under them instead. What the
 * reader stored is untouched, and a viewport that widens again draws it where
 * they put it.
 */
export function chatPaneNarrowed(
  state: ChatPaneState,
  twoColumn: boolean,
): ChatPaneState {
  if (twoColumn || state.presentation === "Full") return state;
  return { placement: "Bottom", presentation: state.presentation };
}

/**
 * Whether the pane takes the bar's rows as well as the body, which a pane over
 * the whole frame does on a viewport too narrow to spare them: there the bar
 * wraps to a share of the screen a conversation cannot give up, and leaving
 * the full screen draws it again.
 */
export function chatPaneCoversBar(
  state: ChatPaneState,
  narrow: boolean,
): boolean {
  return narrow && state.presentation === "Full";
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

/** The axis the frame divides along, which is down for a pane under the pages
 * and across for one beside them or with no pane drawn. */
export type ChatPaneOrientation = "horizontal" | "vertical";

export function chatPaneOrientation(
  state: ChatPaneState | undefined,
): ChatPaneOrientation {
  return state?.placement === "Bottom" ? "vertical" : "horizontal";
}

/** Where a docked pane starts and how far a drag takes either side of its
 * edge, in the terms the library dividing the frame takes. */
export interface ChatPaneSizes {
  readonly chatDefault: string;
  readonly chatMin: string;
  readonly pagesMin: string;
}

/**
 * Across, neither side is dragged narrower than a phone draws it: the
 * conversation at the narrowest phone, and the pages at the phone width every
 * page already lays itself out at. Down, the bounds are shares, since a
 * frame's height is the device's and a share never asks for more than it holds.
 */
export const chatPaneSizes: Readonly<
  Record<ChatPaneOrientation, ChatPaneSizes>
> = {
  horizontal: {
    chatDefault: "25%",
    chatMin: "20rem",
    pagesMin: "24rem",
  },
  vertical: {
    chatDefault: "26rem",
    chatMin: "33%",
    pagesMin: "20%",
  },
};

/**
 * What the pane keeps as the frame around it resizes, which is the unit of the
 * size it is held to: the strip's while it is the strip, else its least's. So
 * a frame alone never carries a size the pane was laid at past the strip or
 * its least, either of which the library would take for an expand or a
 * collapse no reader made.
 */
export function chatPaneKept(
  sizes: ChatPaneSizes,
  stripped: boolean,
): "preserve-pixel-size" | "preserve-relative-size" {
  const held = stripped ? chatPaneSizeStrip : sizes.chatMin;
  return held.endsWith("%") ? "preserve-relative-size" : "preserve-pixel-size";
}

/** The collapsed pane, which is a strip its own control expands rather than a
 * share of the frame. */
export const chatPaneSizeStrip = "2.5rem";

/**
 * The panels the frame divides into. The pane's is named for where it is
 * drawn, so each side and the place under the pages is a configuration of its
 * own: the library dividing the frame remembers the shares it last laid for
 * each set of panels and stores the reader's under their names, and a share of
 * one side's width says nothing of the other's or of a height.
 */
export const chatPanePanels = {
  pages: "pages",
  chat: { Right: "chat-right", Left: "chat-left", Bottom: "chat-bottom" },
} as const satisfies {
  readonly pages: string;
  readonly chat: Readonly<Record<ChatPanePlacement, string>>;
};

const chatPaneLayoutPagesAlone = [chatPanePanels.pages] as const;

const chatPaneLayoutChatAlone: Readonly<
  Record<ChatPanePlacement, readonly string[]>
> = {
  Right: [chatPanePanels.chat.Right],
  Left: [chatPanePanels.chat.Left],
  Bottom: [chatPanePanels.chat.Bottom],
};

const chatPaneLayoutBeside: Readonly<
  Record<ChatPanePlacement, readonly string[]>
> = {
  Right: [chatPanePanels.pages, chatPanePanels.chat.Right],
  Left: [chatPanePanels.chat.Left, chatPanePanels.pages],
  Bottom: [chatPanePanels.pages, chatPanePanels.chat.Bottom],
};

/** The panels drawn, in the order they are drawn: the pages alone on a
 * thread's page, the pane alone over the whole frame, and the pane first where
 * the reader put it on the left. */
export function chatPaneLayoutPanels(
  state: ChatPaneState | undefined,
): readonly string[] {
  if (state === undefined) return chatPaneLayoutPagesAlone;
  return chatPaneContentDrawn(state)
    ? chatPaneLayoutBeside[state.placement]
    : chatPaneLayoutChatAlone[state.placement];
}

/** The pane as a drag left it: one dragged across the collapse threshold is
 * the strip, one dragged back out is docked, and one over the whole frame is
 * not dragged at all. The state itself where the drag changed neither. */
export function chatPaneDragged(
  state: ChatPaneState,
  collapsed: boolean,
): ChatPaneState {
  if (!chatPaneContentDrawn(state) || chatPaneStripped(state) === collapsed)
    return state;
  return collapsed ? chatPaneToggled(state) : chatPaneRestored(state);
}

/** The name the frame's layouts are stored under, beside the pane's own
 * state; the panels each one divides are named in its key. */
export const chatPaneLayoutId = `${chatPaneStoreKey}.layout`;

/** The shares a layout gives its panels, by their names. */
export type ChatPaneLayout = Readonly<Record<string, number>>;

/** The layout stored for these panels, or none where what was stored divides
 * the frame among others: the library would refuse it. */
export function chatPaneLayoutKept(
  stored: ChatPaneLayout | undefined,
  panels: readonly string[],
): ChatPaneLayout | undefined {
  if (stored === undefined) return undefined;
  const named = Object.keys(stored);
  const same =
    named.length === panels.length &&
    panels.every((panel) => named.includes(panel));
  return same ? stored : undefined;
}

/** The share of the frame the pane takes in a layout, wherever it sits, and
 * none in a layout without it. */
export function chatPaneLayoutShare(
  layout: ChatPaneLayout,
): number | undefined {
  for (const panel of Object.values(chatPanePanels.chat)) {
    const share = layout[panel];
    if (share !== undefined) return share;
  }
  return undefined;
}

/** What the edge says of the pane's share, which is the pane's own wherever it
 * sits and not the share of the panel before the edge. */
export function chatPaneShareText(
  share: number | undefined,
): string | undefined {
  return share === undefined ? undefined : `${String(Math.round(share))}%`;
}

const chatPaneLayoutSchema = z.record(z.string(), z.number().finite());

/**
 * A layout store over a key-value store, which reads back only a layout: the
 * library parses what it reads unguarded, so a value that is not one is read
 * as nothing stored. What it was handed is read back where the store has
 * nothing, so a browser that keeps nothing still opens the pane to the width
 * the reader left until the page is loaded again.
 */
export function chatPaneLayoutStore(store: KeyValuePort): {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
} {
  const handed = new Map<string, string>();
  return {
    getItem: (key) => {
      const stored = store.read(key) ?? handed.get(key);
      if (stored === undefined) return null;
      return chatPaneLayoutSchema.safeParse(chatPaneParsed(stored)).success
        ? stored
        : null;
    },
    setItem: (key, value) => {
      handed.set(key, value);
      store.write(key, value);
    },
  };
}

/** The pane after a reader's moves, in a frame of two widths, one that divides
 * it and one that does not, and of any height. So a share across it is only
 * ever laid at the width that divides it, and one down it is kept at every
 * height. */
export interface ChatPaneTrail {
  readonly frame: ChatPaneTrailFrame;
  readonly twoColumn: boolean;
  readonly heightEm: number;
  /** What the reader chose, which is nothing until they move the pane. */
  readonly chosen: ChatPaneState | undefined;
  /** The share the reader last dragged the pane open to, by the panels it
   * divided. */
  readonly stored: Readonly<Record<string, number>>;
  /** The share the pane was last laid open at, by the panels it divided, for
   * as long as the frame is not loaded again. */
  readonly laid: Readonly<Record<string, number>>;
}

/** The frame a trail is drawn in, in the root `em` the pane's sizes are stated
 * in: a desk's width, or one too narrow to divide that still keeps the bar,
 * and the height it starts at. */
export interface ChatPaneTrailFrame {
  readonly wideEm: number;
  readonly narrowEm: number;
  readonly heightEm: number;
}

/**
 * A move the reader makes: a placement other than the one chosen, from the
 * gear; a control of the pane; the window narrowed, widened or made another
 * height; a thread's own page and back; a reload; or the edge dragged to a
 * share of the frame along its axis. A drag short of the pane's least is one
 * into the strip: the threshold between the two is the library's, and a trail
 * drags past it.
 */
export type ChatPaneMove =
  | { readonly move: "Placed"; readonly placement: ChatPanePlacement }
  | { readonly move: "Dragged"; readonly share: number }
  | { readonly move: "Resized"; readonly heightEm: number }
  | {
      readonly move:
        | "Collapsed"
        | "Expanded"
        | "Filled"
        | "Restored"
        | "Narrowed"
        | "Widened"
        | "Visited"
        | "Reloaded";
    };

/** What the frame draws at a point on a trail: the pane's share is of the
 * panels beside each other, and none where one panel has the frame. */
export interface ChatPaneTrailDrawn {
  readonly state: ChatPaneState;
  readonly orientation: ChatPaneOrientation;
  readonly panels: readonly string[];
  readonly share: number | undefined;
}

export function chatPaneTrailStarted(frame: ChatPaneTrailFrame): ChatPaneTrail {
  return {
    frame,
    twoColumn: true,
    heightEm: frame.heightEm,
    chosen: undefined,
    stored: {},
    laid: {},
  };
}

/** The pane as the shell holds it, which is the default until the reader
 * chooses. */
export function chatPaneTrailHeld(trail: ChatPaneTrail): ChatPaneState {
  return trail.chosen ?? chatPaneDefaultAt(trail.twoColumn);
}

/** A size the pane states, as a share of an axis this many `em` long. */
function chatPaneTrailShareOf(size: string, axisEm: number): number {
  const amount = Number.parseFloat(size);
  if (size.endsWith("%")) return amount;
  if (size.endsWith("rem")) return (amount / axisEm) * 100;
  throw new Error(`a pane size in a unit the trail does not read: ${size}`);
}

/** How long the frame is along an axis, in root `em`. */
export function chatPaneTrailAxisEm(
  trail: ChatPaneTrail,
  orientation: ChatPaneOrientation,
): number {
  if (orientation === "vertical") return trail.heightEm;
  return trail.twoColumn ? trail.frame.wideEm : trail.frame.narrowEm;
}

/** How far the pane's share goes along an axis of the frame, and where it
 * starts. */
function chatPaneTrailBounds(
  trail: ChatPaneTrail,
  orientation: ChatPaneOrientation,
): {
  readonly chatDefault: number;
  readonly chatMin: number;
  readonly chatMax: number;
  readonly strip: number;
} {
  const axisEm = chatPaneTrailAxisEm(trail, orientation);
  const sizes = chatPaneSizes[orientation];
  const chatMin = chatPaneTrailShareOf(sizes.chatMin, axisEm);
  const chatMax = 100 - chatPaneTrailShareOf(sizes.pagesMin, axisEm);
  const chatDefault = chatPaneTrailShareOf(sizes.chatDefault, axisEm);
  return {
    chatDefault: Math.min(Math.max(chatDefault, chatMin), chatMax),
    chatMin,
    chatMax,
    strip: chatPaneTrailShareOf(chatPaneSizeStrip, axisEm),
  };
}

export function chatPaneTrailDrawn(trail: ChatPaneTrail): ChatPaneTrailDrawn {
  const state = chatPaneNarrowed(chatPaneTrailHeld(trail), trail.twoColumn);
  const orientation = chatPaneOrientation(state);
  const panels = chatPaneLayoutPanels(state);
  const bounds = chatPaneTrailBounds(trail, orientation);
  const key = panels.join();
  const opened = trail.laid[key] ?? trail.stored[key] ?? bounds.chatDefault;
  const share = chatPaneStripped(state) ? bounds.strip : opened;
  return {
    state,
    orientation,
    panels,
    share: panels.length < 2 ? undefined : share,
  };
}

/** The edge let go at a share: open, it is stored and laid, and in the strip it
 * moves the presentation as the control would and leaves the stored share. */
function chatPaneTrailDragged(
  trail: ChatPaneTrail,
  share: number,
): ChatPaneTrail {
  const drawn = chatPaneTrailDrawn(trail);
  if (drawn.share === undefined)
    throw new Error("a drag where no edge is drawn");
  const bounds = chatPaneTrailBounds(trail, drawn.orientation);
  const collapsed = share < bounds.chatMin;
  const held = chatPaneTrailHeld(trail);
  const moved = chatPaneDragged(held, collapsed);
  const stored = { [drawn.panels.join()]: Math.min(share, bounds.chatMax) };
  return {
    ...trail,
    chosen: moved === held ? trail.chosen : moved,
    stored: collapsed ? trail.stored : { ...trail.stored, ...stored },
    laid: collapsed ? trail.laid : { ...trail.laid, ...stored },
  };
}

/** The trail with the share the frame now draws laid for its panels, or none
 * where the pane is the strip: expanded, it is laid afresh. */
function chatPaneTrailLaid(trail: ChatPaneTrail): ChatPaneTrail {
  const drawn = chatPaneTrailDrawn(trail);
  if (drawn.share === undefined) return trail;
  const key = drawn.panels.join();
  const others = Object.entries(trail.laid).filter(
    ([panels]) => panels !== key,
  );
  const laid = chatPaneStripped(drawn.state)
    ? others
    : [...others, [key, drawn.share] as const];
  return { ...trail, laid: Object.fromEntries(laid) };
}

/** The trail after one more move, with the share the frame then draws laid. */
export function chatPaneTrailMoved(
  trail: ChatPaneTrail,
  move: ChatPaneMove,
): ChatPaneTrail {
  return chatPaneTrailLaid(chatPaneTrailChanged(trail, move));
}

/** What one move changes. A thread's own page leaves the frame to draw again
 * what it drew, a height changes no share laid, and a reload forgets them. */
function chatPaneTrailChanged(
  trail: ChatPaneTrail,
  move: ChatPaneMove,
): ChatPaneTrail {
  const held = chatPaneTrailHeld(trail);
  const chose = (chosen: ChatPaneState): ChatPaneTrail => ({
    ...trail,
    chosen,
  });
  switch (move.move) {
    case "Placed":
      if (move.placement === held.placement)
        throw new Error(
          `the pane placed where it already is: ${held.placement}`,
        );
      return chose(chatPaneRepositioned(held, move.placement));
    case "Collapsed":
    case "Expanded":
      return chose(chatPaneToggled(held));
    case "Filled":
      return chose(chatPaneFilled(held));
    case "Restored":
      return chose(chatPaneRestored(held));
    case "Narrowed":
      return { ...trail, twoColumn: false };
    case "Widened":
      return { ...trail, twoColumn: true };
    case "Resized":
      return { ...trail, heightEm: move.heightEm };
    case "Visited":
      return trail;
    case "Reloaded":
      return { ...trail, laid: {} };
    case "Dragged":
      return chatPaneTrailDragged(trail, move.share);
  }
}

/** The moves the frame offers the reader now: the gear, the window, a thread
 * and a reload always, the edge wherever it is drawn, and the controls the
 * pane draws as it is presented. */
export function chatPaneTrailOffered(
  trail: ChatPaneTrail,
): readonly ChatPaneMove["move"][] {
  const always = [
    "Placed",
    trail.twoColumn ? "Narrowed" : "Widened",
    "Resized",
    "Visited",
    "Reloaded",
  ] as const;
  switch (chatPaneTrailDrawn(trail).state.presentation) {
    case "Docked":
      return [...always, "Collapsed", "Filled", "Dragged"];
    case "Collapsed":
      return [...always, "Expanded", "Dragged"];
    case "Full":
      return [...always, "Collapsed", "Restored"];
  }
}

/** The thread the reader picked for the pane to hold, and the project they
 * picked it in. */
export interface ChatPaneChosen {
  readonly partition: PartitionIdentity;
  readonly session: string;
}

/** The pick the pane holds in a project, which is none where it was made in
 * another: the pick outlives the pane, and the frame outlives a change of
 * project. */
export function chatPaneChosenIn(
  chosen: ChatPaneChosen | undefined,
  partition: PartitionIdentity,
): string | undefined {
  if (chosen === undefined) return undefined;
  const same =
    chosen.partition.tenant === partition.tenant &&
    chosen.partition.project === partition.project;
  return same ? chosen.session : undefined;
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

/** What the header says of the reader's thread door: whether it would refuse
 * for the hosted grant, and why no runner of theirs can take a turn now. */
export interface ChatPaneHeaderDoor {
  readonly unhosted: boolean;
  readonly runner: SessionRunnerShort | undefined;
}

/** Whether the pane's door refuses for the hosted grant: as read, or as New
 * last met it, until a read after that says runners. */
export function chatPaneUnhosted(
  door: ThreadDoor,
  refusal: ThreadSend,
): boolean {
  return threadSendStanding(refusal, true, door).send === "Unhosted";
}

/**
 * The body says what the door would answer where no thread is drawn, and a
 * drawn thread's composer where it takes messages, so the header says it only
 * beside a drawn thread that takes none, or one the listing has not caught up
 * with. A grant New met after the read is said beside any drawn thread whose
 * box, reading only the read, would not say it.
 */
export function chatPaneHeaderDoor(
  door: ThreadDoor,
  threadDrawn: boolean,
  held: ThreadEntryResponse | undefined,
  refusal: ThreadSend = { send: "Idle" },
): ChatPaneHeaderDoor {
  const takes = held !== undefined && threadTakesMessages(held);
  const says = threadDrawn && !takes;
  return {
    unhosted:
      threadDrawn &&
      chatPaneUnhosted(door, refusal) &&
      !(takes && threadDoorUnhosted(door)),
    runner: says ? threadDoorRunnerShort(door) : undefined,
  };
}
