/**
 * The chat pane's own decisions: what a store gives back, what a viewport too
 * narrow to divide draws instead, what each control moves the pane to, and
 * which thread the pane holds.
 *
 * None of it renders, which is the point: where the pane sits is a value the
 * shell reads rather than a shape only a mounted frame could be asked about.
 */

import { expect, test } from "vitest";

import {
  chatPaneContentDrawn,
  chatPaneDefault,
  chatPaneFilled,
  chatPaneHolding,
  chatPaneNarrowed,
  chatPaneRead,
  chatPaneRepositioned,
  chatPaneRestored,
  chatPaneStoreKey,
  chatPaneStripped,
  chatPaneToggled,
  chatPaneWrite,
} from "../app/core/chatPane.ts";
import type { ChatPaneState } from "../app/core/chatPane.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";
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

test("a written state is read back, and an empty store is the default", () => {
  const held: Record<string, string> = {};
  const store = storeDouble(held);
  expect(chatPaneRead(store)).toStrictEqual(chatPaneDefault);
  chatPaneWrite(store, bottomFull);
  expect(chatPaneRead(store)).toStrictEqual(bottomFull);
});

test("a stored value this console cannot parse is read as the default", () => {
  expect(
    chatPaneRead(storeDouble({ [chatPaneStoreKey]: "not json" })),
  ).toStrictEqual(chatPaneDefault);
  expect(
    chatPaneRead(
      storeDouble({
        [chatPaneStoreKey]: JSON.stringify({
          placement: "Middle",
          presentation: "Docked",
        }),
      }),
    ),
  ).toStrictEqual(chatPaneDefault);
});

/** How wide the pane is was once the reader's and is now the token's, so a
 * state this console stored while it was still theirs reads back. */
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

test("a viewport too narrow to divide stacks a docked pane under the pages", () => {
  expect(chatPaneNarrowed(chatPaneDefault, false)).toStrictEqual({
    placement: "Bottom",
    presentation: "Docked",
  });
  expect(chatPaneNarrowed(chatPaneDefault, true)).toStrictEqual(
    chatPaneDefault,
  );
});

test("a pane that is not docked is left where the reader put it", () => {
  expect(chatPaneNarrowed(bottomFull, false)).toStrictEqual(bottomFull);
  const collapsed = chatPaneToggled(chatPaneDefault);
  expect(chatPaneNarrowed(collapsed, false)).toStrictEqual(collapsed);
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

test("a listing that has not answered holds nothing and offers nothing", () => {
  expect(chatPaneHolding(undefined, false, undefined)).toStrictEqual({
    session: undefined,
    start: { start: "Unknown" },
  });
});

test("a reader with no thread of their own is offered one to open", () => {
  const holding = chatPaneHolding(
    [threadEntry({ session: "other", mine: false })],
    false,
    undefined,
  );
  expect(holding.session).toBeUndefined();
  expect(holding.start).toStrictEqual({ start: "Offered", closes: undefined });
});

test("the reader's own open thread is what the pane holds, and starting another closes it", () => {
  const holding = chatPaneHolding(
    [
      threadEntry({ session: "other", mine: false }),
      threadEntry({ session: "mine", mine: true }),
    ],
    false,
    undefined,
  );
  expect(holding.session).toBe("mine");
  expect(holding.start).toStrictEqual({ start: "Offered", closes: "mine" });
});

test("a thread the mailbox has not settled is not closed out from under itself", () => {
  const holding = chatPaneHolding(
    [threadEntry({ session: "mine", mine: true })],
    true,
    undefined,
  );
  expect(holding.session).toBe("mine");
  expect(holding.start).toStrictEqual({ start: "Answering" });
});

test("a closed thread of the reader's own is not the one the pane holds", () => {
  const holding = chatPaneHolding(
    [threadEntry({ session: "mine", mine: true, state: "Closed" })],
    false,
    undefined,
  );
  expect(holding.session).toBeUndefined();
  expect(holding.start).toStrictEqual({ start: "Offered", closes: undefined });
});

/** The history reaches every thread the listing carries, so a reader can read
 * one that is closed or another member's — and the offer to start their own is
 * unchanged by which one they are looking at. */
test("a thread picked out of the history is the one the pane holds", () => {
  const threads = [
    threadEntry({ session: "other", mine: false }),
    threadEntry({ session: "mine", mine: true }),
    threadEntry({ session: "old", mine: true, state: "Closed" }),
  ];
  expect(chatPaneHolding(threads, false, "other").session).toBe("other");
  expect(chatPaneHolding(threads, false, "old").session).toBe("old");
  expect(chatPaneHolding(threads, false, "other").start).toStrictEqual({
    start: "Offered",
    closes: "mine",
  });
});

/** A thread just started is not in the listing yet — the frame that stales it
 * has not arrived — so the pane holds what the reader named and lets the read
 * of that thread say whether it is there. */
test("a thread the reader named is held before the listing carries it", () => {
  expect(
    chatPaneHolding(
      [threadEntry({ session: "mine", mine: true })],
      false,
      "just-opened",
    ).session,
  ).toBe("just-opened");
  expect(chatPaneHolding(undefined, false, "just-opened")).toStrictEqual({
    session: "just-opened",
    start: { start: "Unknown" },
  });
});
