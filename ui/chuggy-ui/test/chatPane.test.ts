/**
 * The chat pane's own decisions: what a store gives back, what a viewport too
 * narrow to divide draws instead, what each control and each drag moves the
 * pane to, how the frame is divided and stored, and which thread the pane
 * holds.
 *
 * None of it renders, which is the point: where the pane sits is a value the
 * shell reads rather than a shape only a mounted frame could be asked about.
 */

import { expect, test } from "vitest";

import {
  chatPaneChosenIn,
  chatPaneDefaulted,
  chatPaneContentDrawn,
  chatPaneDefault,
  chatPaneDefaultAt,
  chatPaneDragged,
  chatPaneFilled,
  chatPaneHeaderDoor,
  chatPaneHolding,
  chatPaneHoldRead,
  chatPaneHoldState,
  chatPaneHoldWritten,
  chatPaneKept,
  chatPaneLayoutId,
  chatPaneLayoutKept,
  chatPaneLayoutPanels,
  chatPaneLayoutShare,
  chatPaneLayoutStore,
  chatPaneNarrowed,
  chatPaneOnPage,
  chatPaneOrientation,
  chatPanePanels,
  chatPanePlacements,
  chatPanePresentations,
  chatPaneRead,
  chatPaneRepositioned,
  chatPaneRestored,
  chatPaneShareText,
  chatPaneSizes,
  chatPaneSizeStrip,
  chatPaneStoreKey,
  chatPaneStripped,
  chatPaneToggled,
  chatPaneTrailDrawn,
  chatPaneTrailMoved,
  chatPaneTrailOffered,
  chatPaneTrailStarted,
  chatPaneWrite,
  chatPaneYielded,
} from "../app/core/chatPane.ts";
import type {
  ChatPaneMove,
  ChatPaneState,
  ChatPaneTrail,
} from "../app/core/chatPane.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import type { ThreadDoor } from "../app/core/threads.ts";
import { viewportTwoColumnEm } from "../app/browser/shell/viewport.ts";
import { threadEntry } from "./threadFixture.ts";

function storeDouble(held: Record<string, string>): KeyValuePort {
  return {
    read: (key) => held[key] ?? null,
    write: (key, value) => {
      held[key] = value;
    },
    remove: (key) => {
      delete held[key];
    },
  };
}

const bottomFull: ChatPaneState = {
  placement: "Bottom",
  presentation: "Full",
};

test("a written state is read back, and an empty store reads as nothing chosen", () => {
  const held: Record<string, string> = {};
  const store = storeDouble(held);
  expect(chatPaneRead(store)).toBeUndefined();
  chatPaneWrite(store, bottomFull);
  expect(chatPaneRead(store)).toStrictEqual(bottomFull);
});

test("a stored value this console cannot parse is read as nothing chosen", () => {
  expect(
    chatPaneRead(storeDouble({ [chatPaneStoreKey]: "not json" })),
  ).toBeUndefined();
  expect(
    chatPaneRead(
      storeDouble({
        [chatPaneStoreKey]: JSON.stringify({
          placement: "Middle",
          presentation: "Docked",
        }),
      }),
    ),
  ).toBeUndefined();
});

test("a pane nobody moved is docked where the viewport divides and over the whole body where it does not", () => {
  expect(chatPaneDefaultAt(true)).toStrictEqual(chatPaneDefault);
  const narrow = chatPaneDefaultAt(false);
  expect(narrow).toStrictEqual(chatPaneFilled(chatPaneDefault));
  expect(chatPaneNarrowed(narrow, false)).toStrictEqual(narrow);
  expect(chatPaneNarrowed(chatPaneRestored(narrow), false)).toStrictEqual(
    narrow,
  );
});

/** Docked under the pages the pane takes a share of every page, so a phone
 * opens it over the whole body whatever a desk stored. */
test("below two columns the pane opens over the whole body whatever is stored, and at two columns what is stored wins", () => {
  for (const presentation of ["Docked", "Full"] as const) {
    const stored = { placement: "Left", presentation } as const;
    const hold = chatPaneHoldRead(
      storeDouble({ [chatPaneStoreKey]: JSON.stringify(stored) }),
    );
    expect(chatPaneHoldState(hold, false)).toStrictEqual(
      chatPaneDefaultAt(false),
    );
    expect(chatPaneHoldState(hold, true)).toStrictEqual(stored);
  }
  const unstored = chatPaneHoldRead(storeDouble({}));
  expect(chatPaneHoldState(unstored, true)).toStrictEqual(chatPaneDefault);
});

test("below two columns a collapse and an expand are held for the page and never stored, so a reload opens it whole", () => {
  const stored = JSON.stringify(chatPaneDefault);
  const held: Record<string, string> = { [chatPaneStoreKey]: stored };
  const store = storeDouble(held);
  const opened = chatPaneHoldRead(store);
  const toggled = (hold: typeof opened): typeof opened =>
    chatPaneHoldWritten(
      store,
      hold,
      chatPaneToggled(chatPaneHoldState(hold, false)),
      false,
    );
  const collapsed = toggled(opened);
  expect(chatPaneHoldState(collapsed, false).presentation).toBe("Collapsed");
  expect(chatPaneHoldState(toggled(collapsed), false)).toStrictEqual(
    chatPaneDefaultAt(false),
  );
  expect(held[chatPaneStoreKey]).toBe(stored);
  expect(chatPaneHoldState(collapsed, true)).toStrictEqual(chatPaneDefault);
  expect(chatPaneHoldState(chatPaneHoldRead(store), false)).toStrictEqual(
    chatPaneDefaultAt(false),
  );
  const docked = chatPaneHoldWritten(store, collapsed, chatPaneDefault, false);
  expect(chatPaneHoldState(docked, false).presentation).toBe("Full");
  expect(held[chatPaneStoreKey]).toBe(stored);
  const left = chatPaneRepositioned(chatPaneDefault, "Left");
  chatPaneHoldWritten(store, opened, left, true);
  expect(chatPaneRead(store)).toStrictEqual(left);
});

test("pressing for a screen puts a full pane beside the pages at two columns and in the strip below them", () => {
  const full = chatPaneFilled(chatPaneDefault);
  expect(chatPaneYielded(full, true)).toStrictEqual(chatPaneDefault);
  expect(chatPaneYielded(full, false)).toStrictEqual(chatPaneToggled(full));
  for (const twoColumn of [true, false])
    for (const state of [chatPaneDefault, chatPaneToggled(chatPaneDefault)])
      expect(chatPaneYielded(state, twoColumn)).toBe(state);
});

/** The width the reader leaves the pane at is kept as a layout of its own and
 * not in this state, so a state that once carried one still reads back. */
test("a stored state carrying a width this console no longer keeps still reads", () => {
  const held = {
    [chatPaneStoreKey]: JSON.stringify({
      placement: "Left",
      presentation: "Docked",
      fractionPercent: 44,
    }),
  };
  expect(chatPaneRead(storeDouble(held))).toStrictEqual({
    placement: "Left",
    presentation: "Docked",
  });
});

test("a viewport too narrow to divide draws a docked pane over the whole body", () => {
  expect(chatPaneNarrowed(chatPaneDefault, false)).toStrictEqual(
    chatPaneFilled(chatPaneDefault),
  );
  for (const placement of chatPanePlacements)
    expect(
      chatPaneNarrowed({ placement, presentation: "Docked" }, false)
        .presentation,
    ).toBe("Full");
  expect(chatPaneNarrowed(chatPaneDefault, true)).toStrictEqual(
    chatPaneDefault,
  );
});

test("a full pane is left where the reader put it, and a strip stacks under the pages", () => {
  expect(chatPaneNarrowed(bottomFull, false)).toStrictEqual(bottomFull);
  const left = chatPaneRepositioned(chatPaneDefault, "Left");
  expect(chatPaneNarrowed(chatPaneFilled(left), false)).toStrictEqual(
    chatPaneFilled(left),
  );
  expect(chatPaneNarrowed(chatPaneToggled(left), false)).toStrictEqual({
    placement: "Bottom",
    presentation: "Collapsed",
  });
  expect(chatPaneNarrowed(chatPaneToggled(left), true)).toStrictEqual(
    chatPaneToggled(left),
  );
});

test("the three ways the pane takes the frame, and what each control moves it to", () => {
  const collapsed = chatPaneToggled(chatPaneDefault);
  expect(collapsed.presentation).toBe("Collapsed");
  expect(chatPaneToggled(collapsed)).toStrictEqual(chatPaneDefault);
  expect(chatPaneFilled(chatPaneDefault).presentation).toBe("Full");
  expect(chatPaneRestored(chatPaneFilled(chatPaneDefault))).toStrictEqual(
    chatPaneDefault,
  );
  expect(chatPaneFilled(collapsed).presentation).toBe("Full");
});

/** Leaving a full screen is not collapsing it: the pages come back beside the
 * pane, which is the whole difference between the two controls. */
test("a pane that filled the frame is restored beside the pages", () => {
  const restored = chatPaneRestored(chatPaneFilled(chatPaneDefault));
  expect(chatPaneContentDrawn(restored)).toBe(true);
  expect(chatPaneStripped(restored)).toBe(false);
});

test("a placement is kept through every other move", () => {
  const left = chatPaneRepositioned(chatPaneDefault, "Left");
  expect(left.placement).toBe("Left");
  expect(chatPaneFilled(left).placement).toBe("Left");
  expect(chatPaneToggled(left).placement).toBe("Left");
  expect(chatPaneRepositioned(bottomFull, "Left")).toStrictEqual({
    placement: "Left",
    presentation: "Full",
  });
});

test("only a full pane takes the frame from the pages, and only a collapsed one is a strip", () => {
  expect(chatPaneContentDrawn(chatPaneDefault)).toBe(true);
  expect(chatPaneContentDrawn(chatPaneFilled(chatPaneDefault))).toBe(false);
  expect(chatPaneStripped(chatPaneToggled(chatPaneDefault))).toBe(true);
  expect(chatPaneStripped(chatPaneDefault)).toBe(false);
});

test("the frame divides across for a pane beside the pages or none, and down for one under them", () => {
  expect(chatPaneOrientation(chatPaneDefault)).toBe("horizontal");
  expect(
    chatPaneOrientation(chatPaneRepositioned(chatPaneDefault, "Left")),
  ).toBe("horizontal");
  expect(chatPaneOrientation(bottomFull)).toBe("vertical");
  expect(
    chatPaneOrientation(
      chatPaneNarrowed(chatPaneToggled(chatPaneDefault), false),
    ),
  ).toBe("vertical");
  expect(chatPaneOrientation(undefined)).toBe("horizontal");
});

test("the panels are named in the order drawn: the pages alone, the pane alone, or the pane on the reader's side", () => {
  const { pages, chat } = chatPanePanels;
  expect(chatPaneLayoutPanels(undefined)).toStrictEqual([pages]);
  expect(chatPaneLayoutPanels(chatPaneFilled(chatPaneDefault))).toStrictEqual([
    chat.Right,
  ]);
  expect(chatPaneLayoutPanels(chatPaneDefault)).toStrictEqual([
    pages,
    chat.Right,
  ]);
  expect(chatPaneLayoutPanels(chatPaneToggled(chatPaneDefault))).toStrictEqual([
    pages,
    chat.Right,
  ]);
  expect(
    chatPaneLayoutPanels(chatPaneRepositioned(chatPaneDefault, "Left")),
  ).toStrictEqual([chat.Left, pages]);
  expect(
    chatPaneLayoutPanels(
      chatPaneNarrowed(chatPaneToggled(chatPaneDefault), false),
    ),
  ).toStrictEqual([pages, chat.Bottom]);
  expect(chatPaneLayoutPanels(bottomFull)).toStrictEqual([chat.Bottom]);
});

/** The library remembers a layout for each set of panels it is handed, so a
 * pane on the right and one under the pages, drawn in the same order, are
 * still different sets. */
test("each place the pane sits divides the frame among panels of its own", () => {
  const drawn = chatPanePlacements.flatMap((placement) =>
    chatPanePresentations.map((presentation) =>
      chatPaneLayoutPanels({ placement, presentation }).join(),
    ),
  );
  expect(new Set(drawn).size).toBe(chatPanePlacements.length * 2);
  expect(new Set(Object.values(chatPanePanels.chat)).size).toBe(
    chatPanePlacements.length,
  );
});

/** The library keys what it restores on the list it is handed, so the same
 * panels are the same list rather than an equal one built again. */
test("the same panels are named by the same list every time", () => {
  expect(chatPaneLayoutPanels(chatPaneDefault)).toBe(
    chatPaneLayoutPanels(chatPaneToggled(chatPaneDefault)),
  );
  expect(chatPaneLayoutPanels(undefined)).toBe(chatPaneLayoutPanels(undefined));
  expect(chatPaneLayoutPanels(bottomFull)).toBe(
    chatPaneLayoutPanels(bottomFull),
  );
});

test("the layouts are stored beside the pane's own state", () => {
  expect(chatPaneLayoutId.startsWith(chatPaneStoreKey)).toBe(true);
  expect(chatPaneLayoutId).not.toBe(chatPaneStoreKey);
});

/** The library refuses a layout for panels it is not dividing, so a stored
 * one is handed to it only where it names exactly the panels drawn. */
test("a stored layout is kept only for the panels it names", () => {
  const { pages, chat } = chatPanePanels;
  const stored = { [pages]: 60, [chat.Right]: 40 };
  expect(chatPaneLayoutKept(stored, [pages, chat.Right])).toBe(stored);
  expect(chatPaneLayoutKept(stored, [chat.Right, pages])).toBe(stored);
  expect(chatPaneLayoutKept(stored, [chat.Left, pages])).toBeUndefined();
  expect(chatPaneLayoutKept(stored, [pages])).toBeUndefined();
  expect(
    chatPaneLayoutKept({ ...stored, [chat.Left]: 0 }, [pages, chat.Right]),
  ).toBeUndefined();
  expect(chatPaneLayoutKept(undefined, [pages, chat.Right])).toBeUndefined();
});

test("the edge says the pane's own share wherever it sits, rounded, and nothing without a pane", () => {
  const { pages, chat } = chatPanePanels;
  expect(chatPaneLayoutShare({ [chat.Left]: 31.25, [pages]: 68.75 })).toBe(
    31.25,
  );
  expect(chatPaneLayoutShare({ [pages]: 48, [chat.Bottom]: 52 })).toBe(52);
  expect(chatPaneLayoutShare({ [pages]: 100 })).toBeUndefined();
  expect(chatPaneShareText(31.25)).toBe("31%");
  expect(chatPaneShareText(3.125)).toBe("3%");
  expect(chatPaneShareText(46.875)).toBe("47%");
  expect(chatPaneShareText(undefined)).toBeUndefined();
});

/** The library parses what it reads with nothing around it, so what the store
 * hands back is a layout or nothing. */
test("the layout store reads back a layout and nothing else", () => {
  const held: Record<string, string> = {};
  const layouts = chatPaneLayoutStore(storeDouble(held));
  expect(layouts.getItem("dragged")).toBeNull();
  layouts.setItem("dragged", JSON.stringify({ pages: 60, chat: 40 }));
  expect(layouts.getItem("dragged")).toBe(
    JSON.stringify({ pages: 60, chat: 40 }),
  );
  for (const stored of [
    "not json",
    JSON.stringify({ pages: "60", chat: 40 }),
    JSON.stringify([60, 40]),
    JSON.stringify(60),
    "null",
  ]) {
    held["dragged"] = stored;
    expect(layouts.getItem("dragged"), stored).toBeNull();
  }
});

/** A browser that keeps nothing still has the layout it was handed read back
 * while the page is loaded, and one that keeps it is read first. */
test("the layout store reads back what it was handed where the store keeps nothing", () => {
  const refusing: KeyValuePort = {
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  };
  const layouts = chatPaneLayoutStore(refusing);
  const dragged = JSON.stringify({ pages: 60, chat: 40 });
  layouts.setItem("dragged", dragged);
  expect(layouts.getItem("dragged")).toBe(dragged);
  expect(layouts.getItem("other")).toBeNull();
  expect(chatPaneLayoutStore(refusing).getItem("dragged")).toBeNull();
  const held: Record<string, string> = {};
  const keeping = chatPaneLayoutStore(storeDouble(held));
  keeping.setItem("dragged", dragged);
  held["dragged"] = JSON.stringify({ pages: 70, chat: 30 });
  expect(keeping.getItem("dragged")).toBe(held["dragged"]);
});

/** A drag across the collapse threshold is the pane's own control, pressed by
 * dragging, and a drag that crosses nothing moves nothing. */
test("a drag past the threshold collapses the pane, back out docks it, and one that crosses nothing is the same state", () => {
  const left = chatPaneRepositioned(chatPaneDefault, "Left");
  expect(chatPaneDragged(left, true)).toStrictEqual(chatPaneToggled(left));
  expect(chatPaneDragged(chatPaneToggled(left), false)).toStrictEqual(left);
  expect(chatPaneDragged(left, false)).toBe(left);
  const collapsed = chatPaneToggled(left);
  expect(chatPaneDragged(collapsed, true)).toBe(collapsed);
});

test("a pane over the whole frame is not moved by what its panel measures", () => {
  const full = chatPaneFilled(chatPaneDefault);
  expect(chatPaneDragged(full, true)).toBe(full);
  expect(chatPaneDragged(full, false)).toBe(full);
});

/** A desk's frame, a width too narrow to divide that keeps the bar, and a
 * height and one half of it. */
const trailFrame = { wideEm: 80, narrowEm: 50, heightEm: 50 };

function trailWalked(...moves: readonly ChatPaneMove[]): ChatPaneTrail {
  return moves.reduce(chatPaneTrailMoved, chatPaneTrailStarted(trailFrame));
}

function trailShare(...moves: readonly ChatPaneMove[]): number | undefined {
  return chatPaneTrailDrawn(trailWalked(...moves)).share;
}

const collapsed: ChatPaneMove = { move: "Collapsed" };
const expanded: ChatPaneMove = { move: "Expanded" };
const placedLeft: ChatPaneMove = { move: "Placed", placement: "Left" };
const placedRight: ChatPaneMove = { move: "Placed", placement: "Right" };
const draggedHalf: ChatPaneMove = { move: "Dragged", share: 50 };

test("a trail starts docked on the right at the default share, and the strip is the strip's width of the frame", () => {
  const drawn = chatPaneTrailDrawn(trailWalked());
  expect(drawn.state).toStrictEqual(chatPaneDefault);
  expect(drawn.panels).toBe(chatPaneLayoutPanels(chatPaneDefault));
  expect(drawn.share).toBe(25);
  expect(trailShare(collapsed)).toBe(3.125);
  expect(trailShare(collapsed, expanded)).toBe(25);
});

/** The control collapsed and expanded gives back the width the pane had,
 * whatever was drawn between: another side, a thread, a reload. */
test("expanding after the control collapsed the pane gives back the width it was dragged to, on every path", () => {
  for (const between of [
    [placedLeft, placedRight],
    [{ move: "Visited" }],
    [{ move: "Reloaded" }],
    [{ move: "Placed", placement: "Bottom" }, placedLeft, placedRight],
    [{ move: "Narrowed" }, { move: "Widened" }],
  ] satisfies readonly (readonly ChatPaneMove[])[])
    expect(trailShare(draggedHalf, collapsed, ...between, expanded)).toBe(50);
});

test("a drag into the strip collapses the pane and leaves the stored share to expand to", () => {
  const strip = trailWalked(draggedHalf, { move: "Dragged", share: 0 });
  expect(chatPaneTrailDrawn(strip).state.presentation).toBe("Collapsed");
  expect(chatPaneTrailDrawn(strip).share).toBe(3.125);
  expect(chatPaneTrailDrawn(chatPaneTrailMoved(strip, expanded)).share).toBe(
    50,
  );
  const out = chatPaneTrailMoved(strip, { move: "Dragged", share: 40 });
  expect(chatPaneTrailDrawn(out).state.presentation).toBe("Docked");
  expect(chatPaneTrailDrawn(out).share).toBe(40);
});

/** A frame whose default share is narrower than the least starts the pane at
 * the least, and expands it there again. */
test("a pane whose default is narrower than its least is drawn at its least", () => {
  const narrow = chatPaneTrailStarted({ ...trailFrame, wideEm: 64 });
  expect(chatPaneTrailDrawn(narrow).share).toBe(31.25);
  const again = [collapsed, expanded].reduce(chatPaneTrailMoved, narrow);
  expect(chatPaneTrailDrawn(again).share).toBe(31.25);
});

test("a drag past either bound is held at it, along the axis the pane is drawn along", () => {
  expect(trailShare({ move: "Dragged", share: 95 })).toBe(70);
  const bottom: ChatPaneMove = { move: "Placed", placement: "Bottom" };
  expect(trailShare(bottom)).toBe(52);
  expect(trailShare(bottom, { move: "Dragged", share: 96 })).toBe(80);
  expect(trailShare(bottom, { move: "Dragged", share: 40 })).toBe(40);
  expect(trailShare(bottom, collapsed)).toBe(5);
});

/** Each set of panels keeps its own share, so another side or the place under
 * the pages starts at its default and hands the first side back its own. */
test("each place the pane sits keeps its own share, and a full screen keeps it too", () => {
  const bottom: ChatPaneMove = { move: "Placed", placement: "Bottom" };
  expect(trailShare(draggedHalf, placedLeft)).toBe(25);
  expect(trailShare(draggedHalf, bottom, placedLeft, placedRight)).toBe(50);
  const full = trailWalked(draggedHalf, { move: "Filled" });
  expect(chatPaneTrailDrawn(full).share).toBeUndefined();
  expect(
    chatPaneTrailDrawn(chatPaneTrailMoved(full, { move: "Restored" })).share,
  ).toBe(50);
  expect(
    chatPaneTrailDrawn(chatPaneTrailMoved(full, collapsed)).state.presentation,
  ).toBe("Collapsed");
});

/** Under the pages the bounds are shares, so the frame's height moves no share
 * laid there; only the strip, which is a height of type, and the default an
 * unlaid pane starts at are taken again at the height now. */
test("under the pages the pane keeps the share it was laid at as the frame's height changes", () => {
  const bottom: ChatPaneMove = { move: "Placed", placement: "Bottom" };
  const shortened: ChatPaneMove = { move: "Resized", heightEm: 25 };
  const heightened: ChatPaneMove = { move: "Resized", heightEm: 50 };
  const tiny: ChatPaneMove = { move: "Resized", heightEm: 5 };
  expect(trailShare(bottom, shortened)).toBe(52);
  expect(trailShare(bottom, shortened, { move: "Dragged", share: 34 })).toBe(
    34,
  );
  expect(
    trailShare(bottom, shortened, { move: "Dragged", share: 34 }, heightened),
  ).toBe(34);
  expect(trailShare(bottom, collapsed, shortened)).toBe(10);
  expect(trailShare(bottom, shortened, placedRight)).toBe(25);
  expect(trailShare(bottom, shortened, placedRight, bottom)).toBe(52);
  expect(trailShare(bottom, shortened, collapsed, expanded)).toBe(80);
  expect(trailShare(bottom, shortened, { move: "Reloaded" })).toBe(80);
  expect(trailShare(shortened, heightened)).toBe(25);
  expect(trailShare(bottom, tiny, collapsed)).toBe(50);
  expect(trailShare(bottom, tiny, collapsed, heightened)).toBe(5);
  expect(trailShare(bottom, tiny, { move: "Dragged", share: 40 })).toBe(40);
});

/** A reader who never chose is drawn the default the width decides, and a
 * drag that moves no presentation is not a choice. */
test("narrowed before the reader chose, the pane is over the whole body, and docked again widened", () => {
  const narrowed = trailWalked(draggedHalf, { move: "Narrowed" });
  expect(narrowed.hold.stored).toBeUndefined();
  expect(chatPaneTrailDrawn(narrowed).state).toStrictEqual(
    chatPaneFilled(chatPaneDefault),
  );
  expect(chatPaneTrailDrawn(narrowed).share).toBeUndefined();
  const widened = chatPaneTrailMoved(narrowed, { move: "Widened" });
  expect(chatPaneTrailDrawn(widened).state).toStrictEqual(chatPaneDefault);
  expect(chatPaneTrailDrawn(widened).share).toBe(50);
});

test("a trail offers the controls the pane draws as presented, and the edge only beside the pages", () => {
  const always = ["Placed", "Narrowed", "Resized", "Visited", "Reloaded"];
  expect(chatPaneTrailOffered(trailWalked())).toStrictEqual([
    ...always,
    "Collapsed",
    "Filled",
    "Dragged",
  ]);
  expect(chatPaneTrailOffered(trailWalked(collapsed))).toStrictEqual([
    ...always,
    "Expanded",
    "Dragged",
  ]);
  expect(chatPaneTrailOffered(trailWalked({ move: "Filled" }))).toStrictEqual([
    ...always,
    "Collapsed",
    "Restored",
  ]);
  expect(chatPaneTrailOffered(trailWalked({ move: "Narrowed" }))[0]).toBe(
    "Widened",
  );
});

/** Below two columns the pane is the whole body or the strip, so a trail
 * there offers no placement or full-screen control and never draws it docked. */
test("below two columns a trail offers no placement or full screen and draws no pane under the pages", () => {
  const always = ["Widened", "Resized", "Visited", "Reloaded"];
  const narrowed: ChatPaneMove = { move: "Narrowed" };
  const docked = trailWalked(draggedHalf, collapsed, expanded, narrowed);
  expect(docked.hold.stored?.presentation).toBe("Docked");
  expect(chatPaneTrailDrawn(docked).state.presentation).toBe("Full");
  expect(chatPaneTrailOffered(docked)).toStrictEqual([...always, "Collapsed"]);
  const strip = chatPaneTrailMoved(docked, collapsed);
  expect(chatPaneTrailOffered(strip)).toStrictEqual([
    ...always,
    "Expanded",
    "Dragged",
  ]);
  for (const back of [
    expanded,
    { move: "Reloaded" },
    { move: "Dragged", share: 50 },
  ] satisfies readonly ChatPaneMove[]) {
    const drawn = chatPaneTrailDrawn(chatPaneTrailMoved(strip, back));
    expect(drawn.state.presentation, back.move).toBe("Full");
    expect(drawn.share, back.move).toBeUndefined();
  }
  expect(chatPaneTrailMoved(strip, expanded).hold.stored).toBe(
    docked.hold.stored,
  );
  const widened = chatPaneTrailMoved(strip, { move: "Widened" });
  expect(chatPaneTrailDrawn(widened).state).toStrictEqual(chatPaneDefault);
});

test("a trail refuses a move the frame does not offer", () => {
  expect(() => trailWalked({ move: "Filled" }, draggedHalf)).toThrow(
    /no edge/u,
  );
  expect(() => trailWalked(placedRight)).toThrow(/already/u);
});

/** The pane is only ever docked beside the pages from the two-column width up,
 * so both its least and the pages' least fit there, with the strip narrower
 * than either. */
test("both sides of the edge fit at their least where the frame first divides, and the strip is narrower than either", () => {
  const remOf = (size: string): number => {
    expect(size).toMatch(/^[0-9.]+rem$/u);
    return Number.parseFloat(size);
  };
  const across = chatPaneSizes.horizontal;
  expect(remOf(across.chatMin) + remOf(across.pagesMin)).toBeLessThanOrEqual(
    viewportTwoColumnEm,
  );
  expect(remOf(chatPaneSizeStrip)).toBeLessThan(remOf(across.chatMin));
  const shareOf = (size: string): number => {
    expect(size).toMatch(/^[0-9.]+%$/u);
    return Number.parseFloat(size);
  };
  const down = chatPaneSizes.vertical;
  expect(shareOf(down.chatMin) + shareOf(down.pagesMin)).toBeLessThanOrEqual(
    100,
  );
});

/** A pane kept in one unit and held to a size in another is carried past it
 * by a frame resized: a strip kept as a share is laid open, and an open pane
 * kept in pixels falls under a least of shares, which the library takes for
 * a move no reader made. */
test("the pane is kept in the unit of the size it is held to: the strip's, else its least's", () => {
  expect(chatPaneSizeStrip).toMatch(/rem$/u);
  for (const sizes of Object.values(chatPaneSizes)) {
    const bounds = [sizes.chatMin, sizes.pagesMin];
    const inType = bounds.every((size) => size.endsWith("rem"));
    expect(inType || bounds.every((size) => size.endsWith("%"))).toBe(true);
    expect(chatPaneKept(sizes, false)).toBe(
      inType ? "preserve-pixel-size" : "preserve-relative-size",
    );
    expect(chatPaneKept(sizes, true)).toBe("preserve-pixel-size");
  }
  const shares = { chatDefault: "50%", chatMin: "10%", pagesMin: "10%" };
  expect(chatPaneKept(shares, false)).toBe("preserve-relative-size");
  expect(chatPaneKept({ ...shares, chatMin: "10rem" }, false)).toBe(
    "preserve-pixel-size",
  );
});

/** The thread is the page at its own address, so no presentation of the pane
 * is drawn beside it, and every other address draws the pane as stored. */
test("a thread's own page draws no pane however it was left, and every other page draws it as it was", () => {
  const partition: {
    readonly tenant: string;
    readonly project: string;
    readonly session?: string;
  } = { tenant: "acme", project: "atlas" };
  const states: readonly ChatPaneState[] = [
    chatPaneDefault,
    chatPaneFilled(chatPaneDefault),
    chatPaneToggled(chatPaneDefault),
    bottomFull,
  ];
  for (const state of states) {
    expect(chatPaneOnPage(state, { ...partition, session: "s" })).toBe(
      undefined,
    );
    expect(chatPaneOnPage(state, partition)).toBe(state);
    expect(chatPaneOnPage(state, { ...partition, session: undefined })).toBe(
      state,
    );
  }
});

/** The pick outlives the pane, and the frame outlives a change of project, so
 * a pick made in one project is not read as a thread of another. */
test("a pick is held in the project it was made in and in no other", () => {
  const atlas = { tenant: "acme", project: "atlas" };
  const chosen = { partition: atlas, session: "picked" };
  expect(chatPaneChosenIn(chosen, atlas)).toBe("picked");
  expect(chatPaneChosenIn(chosen, { ...atlas })).toBe("picked");
  expect(chatPaneChosenIn(chosen, { ...atlas, project: "beta" })).toBe(
    undefined,
  );
  expect(chatPaneChosenIn(chosen, { ...atlas, tenant: "other" })).toBe(
    undefined,
  );
  expect(chatPaneChosenIn(undefined, atlas)).toBe(undefined);
});

test("a listing that has not answered holds nothing", () => {
  expect(chatPaneHolding(undefined, undefined, undefined)).toBeUndefined();
});

test("a reader with no thread of their own holds none", () => {
  expect(
    chatPaneHolding(
      [threadEntry({ session: "other", mine: false })],
      undefined,
      undefined,
    ),
  ).toBeUndefined();
});

test("of the reader's own open threads, the pane holds the one that moved last", () => {
  const holding = chatPaneHolding(
    [
      threadEntry({ session: "other", mine: false }),
      threadEntry({ session: "earlier", mine: true }),
      threadEntry({
        session: "later",
        mine: true,
        lastActivityAt: "2026-09-02T11:00:00Z",
      }),
    ],
    undefined,
    undefined,
  );
  expect(holding).toBe("later");
});

test("a closed thread of the reader's own is not the one the pane holds", () => {
  expect(
    chatPaneHolding(
      [
        threadEntry({
          session: "old",
          mine: true,
          state: "Closed",
          lastActivityAt: "2026-09-02T11:00:00Z",
        }),
        threadEntry({ session: "mine", mine: true }),
      ],
      undefined,
      undefined,
    ),
  ).toBe("mine");
  expect(
    chatPaneHolding(
      [threadEntry({ session: "old", mine: true, state: "Closed" })],
      undefined,
      undefined,
    ),
  ).toBeUndefined();
});

/** The history reaches every thread the listing carries, so a reader can read
 * one that is closed or another member's. */
test("a thread picked out of the history is the one the pane holds", () => {
  const threads = [
    threadEntry({ session: "other", mine: false }),
    threadEntry({ session: "mine", mine: true }),
    threadEntry({ session: "old", mine: true, state: "Closed" }),
  ];
  expect(chatPaneHolding(threads, "other", "mine")).toBe("other");
  expect(chatPaneHolding(threads, "old", "mine")).toBe("old");
});

/** A thread just started is not in the listing yet — the frame that stales it
 * has not arrived — so the pane holds what the reader named and lets the read
 * of that thread say whether it is there. */
test("a thread the reader named is held before the listing carries it", () => {
  expect(
    chatPaneHolding(
      [threadEntry({ session: "mine", mine: true })],
      "just-opened",
      "mine",
    ),
  ).toBe("just-opened");
  expect(chatPaneHolding(undefined, "just-opened", undefined)).toBe(
    "just-opened",
  );
});

/** The box under the pane belongs to the thread it draws, so another of the
 * reader's threads moving does not move the pane, nor does a listing that did
 * not answer. */
test("the thread the pane holds for the reader stays held while it is listed open", () => {
  const threads = [
    threadEntry({ session: "held", mine: true }),
    threadEntry({
      session: "moved",
      mine: true,
      lastActivityAt: "2026-09-02T11:00:00Z",
    }),
  ];
  expect(chatPaneDefaulted(threads, undefined)).toBe("moved");
  expect(chatPaneDefaulted(threads, "held")).toBe("held");
  expect(chatPaneHolding(threads, undefined, "held")).toBe("held");
  expect(chatPaneDefaulted(undefined, "held")).toBe("held");
  expect(chatPaneDefaulted(undefined, undefined)).toBeUndefined();
});

test("the thread the pane holds for the reader moves on once it is closed or no longer listed", () => {
  const later = threadEntry({
    session: "later",
    mine: true,
    lastActivityAt: "2026-09-02T11:00:00Z",
  });
  expect(
    chatPaneDefaulted(
      [threadEntry({ session: "held", mine: true, state: "Closed" }), later],
      "held",
    ),
  ).toBe("later");
  expect(chatPaneDefaulted([later], "held")).toBe("later");
  expect(chatPaneDefaulted([], "held")).toBeUndefined();
});

function unhostedSaid(
  ...header: Parameters<typeof chatPaneHeaderDoor>
): boolean {
  return chatPaneHeaderDoor(...header).unhosted;
}

function runnerSaid(
  ...header: Parameters<typeof chatPaneHeaderDoor>
): ReturnType<typeof chatPaneHeaderDoor>["runner"] {
  return chatPaneHeaderDoor(...header).runner;
}

function door(
  route: ThreadDoor["route"],
  granted: ThreadDoor["granted"],
  runner: ThreadDoor["runner"] = undefined,
  reads: ThreadDoor["reads"] = 1,
): ThreadDoor {
  return { route, granted, runner, reads };
}

/** The header is the one place left to say the grant is withheld where a
 * thread is drawn whose composer would not; nowhere says it before the read,
 * nor where the thread's turns go to runners, which ask no grant. */
test("the header says the grant is withheld only beside a drawn thread that takes no messages", () => {
  const open = threadEntry({ session: "thread-open", state: "Open" });
  const closed = threadEntry({ session: "thread-closed", state: "Closed" });
  const withheld = door("InCluster", false);
  expect(unhostedSaid(withheld, true, closed)).toBe(true);
  expect(unhostedSaid(withheld, true, undefined)).toBe(true);
  expect(unhostedSaid(door(undefined, false), true, closed)).toBe(true);
  expect(unhostedSaid(withheld, true, open)).toBe(false);
  expect(unhostedSaid(withheld, false, closed)).toBe(false);
  expect(unhostedSaid(door("Pool", false), true, closed)).toBe(false);
  expect(unhostedSaid(door("InCluster", true), true, closed)).toBe(false);
  expect(unhostedSaid(door("InCluster", undefined), true, closed)).toBe(false);
});

/** New's own refusal is newer than the read a drawn thread's box reads, so the
 * header says it beside that thread until a later read says runners. */
test("the header says the grant New met beside a drawn thread until a later read says runners", () => {
  const open = threadEntry({ session: "thread-open", state: "Open" });
  const met = { send: "Unhosted", readsAt: 1 } as const;
  expect(unhostedSaid(door("Pool", false), true, open, met)).toBe(true);
  expect(unhostedSaid(door("Pool", false, undefined, 2), true, open, met)).toBe(
    false,
  );
  expect(unhostedSaid(door("InCluster", false), true, open, met)).toBe(false);
  expect(unhostedSaid(door("Pool", false), false, open, met)).toBe(false);
});

/** The runner is said where the grant would be. */
test("the header says the reader's runner only beside a drawn thread that takes no messages", () => {
  const open = threadEntry({ session: "thread-open", state: "Open" });
  const closed = threadEntry({ session: "thread-closed", state: "Closed" });
  const none = door("Pool", false, "Unregistered");
  expect(runnerSaid(none, true, closed)).toBe("NoRunner");
  expect(runnerSaid(none, true, undefined)).toBe("NoRunner");
  expect(runnerSaid(door("Pool", true, "Offline"), true, closed)).toBe(
    "RunnerOffline",
  );
  expect(runnerSaid(door("Pool", true, "Live"), true, closed)).toBeUndefined();
  expect(runnerSaid(none, true, open)).toBeUndefined();
  expect(runnerSaid(none, false, closed)).toBeUndefined();
  expect(
    runnerSaid(door("InCluster", true, "Unregistered"), true, closed),
  ).toBeUndefined();
});
