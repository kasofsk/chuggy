/**
 * The reading of one action's mark, every arm of it from a fixture: what was
 * reported is written out, each commit's answer is looked up in a table, and
 * the reading is driven to its mark with every question it put and every read
 * of the earlier successes recorded. No git runs and nothing is stored.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actionReachEarlierReadMax,
  actionReachEarlierSuccessesMax,
  actionReachNext,
  type ActionReachEarlierSuccess,
  type ActionReachMark,
  type ActionReachNewest,
  type ActionReachObservation,
  type ActionReachView,
} from "../../src/interpreter/actionReach.ts";
import type { CommitAncestry } from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  type GitObjectId,
} from "../../src/interpreter/finalizer.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";

/** A commit named by one hex digit, so a fixture reads as the letters it weighs. */
function commitOf(digit: string): GitObjectId {
  return asGitObjectId(digit.repeat(40));
}

function reported(
  ordinal: number,
  outcome: ActionReachObservation["outcome"],
  digit: string,
): ActionReachObservation {
  return {
    ordinal,
    outcome,
    commit: commitOf(digit),
    receivedAt: asPublicInstant("2026-01-01T00:00:00.000000Z"),
  };
}

const succeeded = (ordinal: number, digit: string) =>
  reported(ordinal, "Succeeded", digit);
const failed = (ordinal: number, digit: string) =>
  reported(ordinal, "Failed", digit);

/** A success beneath the newest, reported since the ticket landed unless a case says it was not. */
function beneath(
  ordinal: number,
  digit: string,
  sinceLanded = true,
): ActionReachEarlierSuccess {
  return { observation: succeeded(ordinal, digit), sinceLanded };
}

/** A log whose newest report is a success, which is then its newest success too. */
function newestSucceeded(ordinal: number, digit: string): ActionReachNewest {
  const success = succeeded(ordinal, digit);
  return { success, report: success };
}

/** What one reading came to: its mark, each commit it asked about in order, and each read of the earlier successes it made. */
interface Reading {
  readonly mark: ActionReachMark;
  readonly asked: readonly string[];
  readonly read: readonly { beneath: number; count: number }[];
}

/**
 * Drives one reading to its mark. `answers` names each commit's answer by its
 * digit, and a commit asked about that the table does not name fails the case,
 * so a fixture states every question it expects.
 */
function reading(
  newest: ActionReachNewest,
  answers: Readonly<Record<string, CommitAncestry>>,
  earlierRows: readonly ActionReachEarlierSuccess[] = [],
): Reading {
  const known = new Map<GitObjectId, CommitAncestry>();
  const asked: string[] = [];
  const read: { beneath: number; count: number }[] = [];
  let earlier: ActionReachView["earlier"];
  for (let turn = 0; turn < actionReachEarlierReadMax + 8; turn += 1) {
    const next = actionReachNext({ newest, earlier, answers: known });
    if (next.next === "Marked") return { mark: next.mark, asked, read };
    if (next.next === "ReadEarlier") {
      read.push({ beneath: next.beneath, count: next.count });
      earlier = earlierRows;
      continue;
    }
    const digit = next.tip.slice(0, 1);
    const answer = answers[digit];
    assert.ok(answer !== undefined, `commit ${digit} was asked about`);
    asked.push(digit);
    known.set(next.tip, answer);
  }
  return assert.fail("the reading did not end");
}

test("an action nothing was reported of is not yet, with nothing asked and nothing read", () => {
  assert.deepEqual(reading({}, {}), {
    mark: { reach: "NotYet" },
    asked: [],
    read: [],
  });
});

test("the newest success at a commit holding the ticket's is reached, showing that success", () => {
  const newest = newestSucceeded(4, "a");
  assert.deepEqual(reading(newest, { a: "Ancestor" }), {
    mark: { reach: "Reached", observation: newest.success },
    asked: ["a"],
    read: [],
  });
});

test("the newest success is weighed before a newer failure, and one that holds is reached whatever the failure's commit holds", () => {
  const newest = { success: succeeded(4, "a"), report: failed(5, "b") };
  assert.deepEqual(reading(newest, { a: "Ancestor" }), {
    mark: { reach: "Reached", observation: newest.success },
    asked: ["a"],
    read: [],
  });
});

test("the newest success unknown is unknown, and nothing after it is weighed", () => {
  for (const newest of [
    newestSucceeded(4, "a"),
    { success: succeeded(4, "a"), report: failed(5, "b") },
  ])
    assert.deepEqual(reading(newest, { a: "Unknown" }, [beneath(2, "c")]), {
      mark: { reach: "Unknown" },
      asked: ["a"],
      read: [],
    });
});

test("the newest report a failure at a commit holding the ticket's is failed, showing that failure", () => {
  const newest = { success: succeeded(4, "a"), report: failed(5, "b") };
  assert.deepEqual(reading(newest, { a: "NotAncestor", b: "Ancestor" }), {
    mark: { reach: "Failed", observation: newest.report },
    asked: ["a", "b"],
    read: [],
  });
});

test("before an action's first success, a failure at a commit holding the ticket's is failed and one at a commit that does not is not yet", () => {
  const newest = { report: failed(1, "b") };
  assert.deepEqual(reading(newest, { b: "Ancestor" }), {
    mark: { reach: "Failed", observation: newest.report },
    asked: ["b"],
    read: [],
  });
  assert.deepEqual(reading(newest, { b: "NotAncestor" }), {
    mark: { reach: "NotYet" },
    asked: ["b"],
    read: [],
  });
});

test("the newest failure unknown is unknown, and no earlier success is read", () => {
  for (const newest of [
    { success: succeeded(4, "a"), report: failed(5, "b") },
    { report: failed(1, "b") },
  ])
    assert.deepEqual(
      reading(newest, { a: "NotAncestor", b: "Unknown" }, [beneath(2, "c")])
        .mark,
      { reach: "Unknown" },
    );
});

test("a success beneath the newest, reported since the ticket landed and holding its commit, is rolled back, showing the newest such", () => {
  const rows = [beneath(3, "b"), beneath(2, "c"), beneath(1, "d")];
  assert.deepEqual(
    reading(
      newestSucceeded(4, "a"),
      { a: "NotAncestor", b: "NotAncestor", c: "Ancestor" },
      rows,
    ),
    {
      mark: { reach: "RolledBack", observation: rows[1]?.observation },
      asked: ["a", "b", "c"],
      read: [{ beneath: 4, count: actionReachEarlierReadMax }],
    },
  );
});

test("the earlier successes are read beneath the newest success and not beneath a failure after it", () => {
  const newest = { success: succeeded(4, "a"), report: failed(9, "b") };
  const rows = [beneath(3, "c")];
  assert.deepEqual(
    reading(
      newest,
      { a: "NotAncestor", b: "NotAncestor", c: "Ancestor" },
      rows,
    ),
    {
      mark: { reach: "RolledBack", observation: rows[0]?.observation },
      asked: ["a", "b", "c"],
      read: [{ beneath: 4, count: actionReachEarlierReadMax }],
    },
  );
});

test("an earlier success unknown is unknown, and those beneath it are not weighed", () => {
  assert.deepEqual(
    reading(newestSucceeded(4, "a"), { a: "NotAncestor", b: "Unknown" }, [
      beneath(3, "b"),
      beneath(2, "c"),
    ]),
    {
      mark: { reach: "Unknown" },
      asked: ["a", "b"],
      read: [{ beneath: 4, count: actionReachEarlierReadMax }],
    },
  );
});

test("a success reported before the ticket landed is passed over without being asked about", () => {
  assert.deepEqual(
    reading(newestSucceeded(4, "a"), { a: "NotAncestor", c: "Ancestor" }, [
      beneath(3, "b", false),
      beneath(2, "c"),
    ]).asked,
    ["a", "c"],
  );
  assert.deepEqual(
    reading(newestSucceeded(4, "a"), { a: "NotAncestor" }, [
      beneath(3, "b", false),
    ]),
    {
      mark: { reach: "NotYet" },
      asked: ["a"],
      read: [{ beneath: 4, count: actionReachEarlierReadMax }],
    },
  );
});

test("no success holding the ticket's commit is not yet", () => {
  assert.deepEqual(
    reading(
      newestSucceeded(4, "a"),
      { a: "NotAncestor", b: "NotAncestor", c: "NotAncestor" },
      [beneath(3, "b"), beneath(2, "c")],
    ).mark,
    { reach: "NotYet" },
  );
  assert.deepEqual(
    reading(newestSucceeded(1, "a"), { a: "NotAncestor" }).mark,
    {
      reach: "NotYet",
    },
  );
});

test("a commit is asked about once, however many reports name it", () => {
  const newest = { success: succeeded(6, "a"), report: failed(7, "a") };
  assert.deepEqual(
    reading(newest, { a: "NotAncestor", b: "NotAncestor", c: "Ancestor" }, [
      beneath(5, "b"),
      beneath(4, "a"),
      beneath(3, "b"),
      beneath(2, "c"),
    ]).asked,
    ["a", "b", "c"],
  );
});

/** As many successes beneath the newest as a reading weighs, each at a commit of its own that does not hold the ticket's, and the answers that say so. */
function weighedInFull(): {
  readonly rows: readonly ActionReachEarlierSuccess[];
  readonly answers: Record<string, CommitAncestry>;
} {
  const digits = "0123456789abcdef".slice(0, actionReachEarlierSuccessesMax);
  assert.equal(digits.length, actionReachEarlierSuccessesMax);
  const top = actionReachEarlierSuccessesMax + 1;
  return {
    rows: [...digits].map((digit, at) => beneath(top - at, digit)),
    answers: Object.fromEntries(
      [...digits].map((digit) => [digit, "NotAncestor" as const]),
    ),
  };
}

/** A commit of a second width, which no single-digit fixture commit is. */
const newestWide = asGitObjectId("f".repeat(64));

/** The newest success of a log `weighedInFull` lies beneath, at a commit none of those rows is at. */
function newestOverFull(): ActionReachNewest {
  const success = {
    ...succeeded(actionReachEarlierSuccessesMax + 2, "f"),
    commit: newestWide,
  };
  return { success, report: success };
}

/** Drives a reading over `weighedInFull` and whatever row a case puts past it, the newest success answered no. */
function readingOverFull(past: readonly ActionReachEarlierSuccess[]): {
  readonly mark: ActionReachMark;
  readonly asked: number;
} {
  const { rows, answers } = weighedInFull();
  const known = new Map<GitObjectId, CommitAncestry>([
    [newestWide, "NotAncestor"],
  ]);
  let asked = 0;
  for (let turn = 0; turn < actionReachEarlierReadMax + 8; turn += 1) {
    const next = actionReachNext({
      newest: newestOverFull(),
      earlier: [...rows, ...past],
      answers: known,
    });
    if (next.next === "Marked") return { mark: next.mark, asked };
    if (next.next !== "Ask")
      return assert.fail("the successes were read twice");
    const answer = answers[next.tip.slice(0, 1)];
    assert.ok(answer !== undefined, "a commit past the walk was asked about");
    asked += 1;
    known.set(next.tip, answer);
  }
  return assert.fail("the reading did not end");
}

test("as many successes weighed as a reading may, with one more since the ticket landed beneath them, is unknown and never not yet", () => {
  assert.deepEqual(readingOverFull([beneath(1, "a")]), {
    mark: { reach: "Unknown" },
    asked: actionReachEarlierSuccessesMax,
  });
});

test("the walk ending on its last row, or on one from before the ticket landed, is not yet", () => {
  assert.deepEqual(readingOverFull([]), {
    mark: { reach: "NotYet" },
    asked: actionReachEarlierSuccessesMax,
  });
  assert.deepEqual(readingOverFull([beneath(1, "a", false)]), {
    mark: { reach: "NotYet" },
    asked: actionReachEarlierSuccessesMax,
  });
});

test("the success past the walk is never weighed, though its commit holds the ticket's", () => {
  const { rows } = weighedInFull();
  const past = { ...beneath(1, "a"), commit: asGitObjectId("e".repeat(64)) };
  const row = {
    ...past,
    observation: { ...past.observation, commit: past.commit },
  };
  const answers = new Map<GitObjectId, CommitAncestry>([
    [newestWide, "NotAncestor"],
    [past.commit, "Ancestor"],
    ...rows.map((each): [GitObjectId, CommitAncestry] => [
      each.observation.commit,
      "NotAncestor",
    ]),
  ]);
  assert.deepEqual(
    actionReachNext({
      newest: newestOverFull(),
      earlier: [...rows, row],
      answers,
    }),
    { next: "Marked", mark: { reach: "Unknown" } },
  );
});

const none = new Map<GitObjectId, CommitAncestry>();

/** Holds that each view named is refused, by the name a failure is told under. */
function refused(
  views: Readonly<Record<string, Omit<ActionReachView, "answers">>>,
): void {
  for (const [what, view] of Object.entries(views))
    assert.throws(
      () => actionReachNext({ ...view, answers: none }),
      RangeError,
      what,
    );
}

test("newest reports no log could hold together are refused before any mark is read from them", () => {
  refused({
    "a success with no newest report": {
      newest: { success: succeeded(1, "a") },
      earlier: undefined,
    },
    "a newest success that failed": {
      newest: { success: failed(1, "a"), report: failed(2, "b") },
      earlier: undefined,
    },
    "a newest report that succeeded and is not the newest success": {
      newest: { success: succeeded(1, "a"), report: succeeded(2, "b") },
      earlier: undefined,
    },
    "a newest report that succeeded with no newest success": {
      newest: { report: succeeded(2, "b") },
      earlier: undefined,
    },
    "a success above the failure that is the newest report": {
      newest: { success: succeeded(3, "a"), report: failed(2, "b") },
      earlier: undefined,
    },
  });
});

test("earlier successes no read could have answered are refused before any mark is read from them", () => {
  refused({
    "more earlier successes than a reading reads": {
      newest: newestSucceeded(actionReachEarlierReadMax + 2, "a"),
      earlier: Array.from({ length: actionReachEarlierReadMax + 1 }, (_, at) =>
        beneath(actionReachEarlierReadMax + 1 - at, "b"),
      ),
    },
    "an earlier success not beneath the newest": {
      newest: newestSucceeded(4, "a"),
      earlier: [beneath(4, "b")],
    },
    "earlier successes out of order": {
      newest: newestSucceeded(4, "a"),
      earlier: [beneath(2, "b"), beneath(3, "c")],
    },
    "an earlier report that failed": {
      newest: newestSucceeded(4, "a"),
      earlier: [{ observation: failed(3, "b"), sinceLanded: true }],
    },
  });
});
