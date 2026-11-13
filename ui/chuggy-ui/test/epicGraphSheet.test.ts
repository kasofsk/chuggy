/**
 * How far the phone's sheet scrolls to bring a card into the room above it:
 * not at all where the card is wholly in the room, and otherwise as far as
 * centres it there, from below or above.
 */

import { expect, test } from "vitest";

import { epicGraphSheetScrollOf } from "../app/core/epicGraphSheet.ts";

const room = { top: 0, bottom: 600 };

test("a card wholly in the room, even at its edges, is not scrolled", () => {
  expect(epicGraphSheetScrollOf({ top: 100, bottom: 180 }, room)).toBe(
    undefined,
  );
  expect(epicGraphSheetScrollOf({ top: 0, bottom: 600 }, room)).toBe(undefined);
});

test("a card under the sheet or above the room is scrolled until its middle is the room's", () => {
  expect(epicGraphSheetScrollOf({ top: 900, bottom: 980 }, room)).toBe(640);
  expect(epicGraphSheetScrollOf({ top: 560, bottom: 640 }, room)).toBe(300);
  expect(epicGraphSheetScrollOf({ top: -200, bottom: -120 }, room)).toBe(-460);
  expect(
    epicGraphSheetScrollOf({ top: 40, bottom: 120 }, { top: 60, bottom: 300 }),
  ).toBe(-100);
});

test("an extent whose top is below its bottom is refused", () => {
  expect(() => epicGraphSheetScrollOf({ top: 10, bottom: 0 }, room)).toThrow();
  expect(() =>
    epicGraphSheetScrollOf({ top: 0, bottom: 10 }, { top: 5, bottom: 0 }),
  ).toThrow();
});
