/**
 * What one recorded revision moved, derived from the override sets the history
 * read already carries.
 *
 * THE OLDEST ROW OF A PAGE IS THE CASE WITH TEETH. The history is paged, so the
 * revision before the last row of a read may simply not have been fetched;
 * diffing it against an empty override set would draw every field the project
 * has as though that revision had set it.
 */

import { expect, test } from "vitest";

import {
  selectorSettingsHistoryDiffered,
  selectorSettingsHistoryDiffs,
} from "../app/core/selectorSettingsHistory.ts";
import type { SelectorSettingsRevisionRead } from "../app/core/selectorSettingsHistory.ts";

function revisionAt(
  revision: number,
  overrides: SelectorSettingsRevisionRead["overrides"],
): SelectorSettingsRevisionRead {
  return {
    revision,
    overrides,
    administrator: { kind: "member", subject: "geoff@vteng.io" },
    recordedAt: "2026-09-05T17:13:00.000Z",
  };
}

function labelsOf(
  diffs: ReturnType<typeof selectorSettingsHistoryDiffs>,
  at: number,
): readonly string[] {
  return (diffs[at]?.changes ?? []).map((change) => change.label);
}

test("a revision names the fields it moved and nothing it left alone", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(15, {
      northStar: "ship the console",
      basePrompt: "choose the newest",
      limits: { tokensPerDecision: 17_523_063 },
    }),
    revisionAt(14, {
      northStar: "ship the console",
      basePrompt: "choose the next ticket",
      limits: { tokensPerDecision: 12_000_000 },
    }),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Base prompt", "Tokens"]);
});

test("a revision that moved nothing has an empty change list", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(12, { northStar: "ship the console" }),
    revisionAt(11, { northStar: "ship the console" }),
  ]);
  expect(diffs[0]?.changes).toStrictEqual([]);
});

/** The read is a page. Its last row's predecessor may be a revision nobody
 * fetched, so what that row moved is unknown rather than everything it holds. */
test("the oldest row of a read has no changes, not a diff against nothing", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(12, { northStar: "ship the console" }),
    revisionAt(11, { northStar: "ship the lead page" }),
  ]);
  expect(diffs[1]?.changes).toBeUndefined();
});

/** A field going back to the installation default is a change, and drawing the
 * empty side as blank would leave it reading as a field nobody touched. */
test("an override cleared is a change, and both sides say what stood", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, {}),
    revisionAt(13, { mode: "Paused" }),
  ]);
  expect(diffs[0]?.changes).toStrictEqual([
    { label: "Mode", before: "Paused", after: "Default", mono: false },
  ]);
});

/** The limits are one override on the wire and six rows on the page, so a diff
 * comparing the limit sets whole would name `Limits` rather than the ceiling
 * that moved. */
test("a limit that moved is named by its own row and not by its wire key", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, {
      limits: { tokensPerDecision: 100, dispatchesPerDecision: 3 },
    }),
    revisionAt(13, {
      limits: { tokensPerDecision: 100, dispatchesPerDecision: 2 },
    }),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Dispatches"]);
});

/** Every override the wire admits is compared, including the ones no section
 * draws: a change to an allowlist that read as `No change` would be a lie the
 * page tells about its own history. */
test("an override no section draws is still named when it moves", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, { toolAllowlist: ["Read", "Grep"] }),
    revisionAt(13, { toolAllowlist: ["Read"] }),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Tools"]);
  expect(diffs[0]?.changes?.[0]?.before).toBe("Read");
});

test("the base prompt is the one field a diff row draws in the mono face", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, { basePrompt: "b", northStar: "y" }),
    revisionAt(13, { basePrompt: "a", northStar: "x" }),
  ]);
  expect(
    diffs[0]?.changes?.map((change) => [change.label, change.mono]),
  ).toStrictEqual([
    ["North Star", false],
    ["Base prompt", true],
  ]);
});

/** A prompt of many paragraphs whose last sentence moved is unreadable drawn
 * whole on both sides of an arrow. */
test("a long text is diffed to the first line the two differ on", () => {
  expect(
    selectorSettingsHistoryDiffered("one\ntwo\nthree", "one\ntwo\nfour"),
  ).toStrictEqual({ before: "three", after: "four" });
});

test("a text that grew differs at the line the shorter one does not have", () => {
  expect(selectorSettingsHistoryDiffered("one", "one\ntwo")).toStrictEqual({
    before: "",
    after: "two",
  });
});
