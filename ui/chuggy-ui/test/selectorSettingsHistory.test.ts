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
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyOrDataText } from "../app/core/copy.ts";

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
  return (diffs[at]?.changes ?? []).map((change) => copyTextEn(change.label));
}

test("a revision names the fields it moved and nothing it left alone", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(15, {
      northStar: "ship the console",
      threadStandingRules: "- Ask first.",
      threadModel: "opus",
    }),
    revisionAt(14, {
      northStar: "ship the console",
      threadStandingRules: "- Ask before deleting.",
      threadModel: "opus",
    }),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Standing rules"]);
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
    revisionAt(11, { northStar: "ship the settings page" }),
  ]);
  expect(diffs[1]?.changes).toBeUndefined();
});

function sidesOf(
  diffs: ReturnType<typeof selectorSettingsHistoryDiffs>,
): readonly (readonly [string, string])[] {
  return (diffs[0]?.changes ?? []).map((change) => [
    copyOrDataText(copyTextEn, change.before),
    copyOrDataText(copyTextEn, change.after),
  ]);
}

/** A field going back to the installation default is a change, and drawing the
 * empty side as blank would leave it reading as a field nobody touched. */
test("an override cleared is a change, and both sides say what stood", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, {}),
    revisionAt(13, { threadModel: "opus" }),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Chat model"]);
  expect(sidesOf(diffs)).toStrictEqual([["opus", "Default"]]);
});

/** A text a person typed is data, so one that spells the default's word is
 * still a change from the default. */
test("a text override that spells the default's word is a change from the default", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(14, { northStar: "Default" }),
    revisionAt(13, {}),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["North Star"]);
  expect(diffs[0]?.changes?.[0]?.after).toBe("Default");
  expect(diffs[0]?.changes?.[0]?.before).toStrictEqual({
    id: "settings-threads-default",
  });
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

test("a model or effort that moved is named by its row, a model as its name and an effort as its word", () => {
  const diffs = selectorSettingsHistoryDiffs([
    revisionAt(13, { threadModel: "claude-opus-5-5", threadEffort: "xhigh" }),
    revisionAt(12, {}),
  ]);
  expect(labelsOf(diffs, 0)).toStrictEqual(["Chat model", "Chat effort"]);
  expect(sidesOf(diffs)).toStrictEqual([
    ["Default", "claude-opus-5-5"],
    ["Default", "Extra high"],
  ]);
});
