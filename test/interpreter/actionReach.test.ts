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
  actionReachEarlierRowsMax,
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
      earlier = earlierRows.slice(0, next.count);
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

/** One commit succeeded at over and over since the ticket landed, the newest of those rows at the ordinal given. */
function repeated(
  top: number,
  digit: string,
  count: number,
): readonly ActionReachEarlierSuccess[] {
  return Array.from({ length: count }, (_, at) => beneath(top - at, digit));
}

test("successes at the commit of the newest, however many, cost a reading none of the commits it may weigh", () => {
  const repeats = actionReachEarlierSuccessesMax + 1;
  assert.deepEqual(
    reading(
      newestSucceeded(repeats + 1, "a"),
      { a: "NotAncestor" },
      repeated(repeats, "a", repeats),
    ),
    {
      mark: { reach: "NotYet" },
      asked: ["a"],
      read: [{ beneath: repeats + 1, count: actionReachEarlierRowsMax + 1 }],
    },
  );
});

test("a success holding the ticket's commit is found beneath more successes at one commit than a reading may weigh commits", () => {
  const repeats = actionReachEarlierSuccessesMax + 1;
  const held = beneath(1, "b");
  assert.deepEqual(
    reading(
      newestSucceeded(repeats + 2, "a"),
      { a: "NotAncestor", b: "Ancestor" },
      [...repeated(repeats + 1, "a", repeats), held],
    ),
    {
      mark: { reach: "RolledBack", observation: held.observation },
      asked: ["a", "b"],
      read: [{ beneath: repeats + 2, count: actionReachEarlierReadMax }],
    },
  );
});

test("a reading asks for the row past those it walks, and more successes since the ticket landed than it walks is unknown", () => {
  const rows = actionReachEarlierRowsMax + 1;
  assert.deepEqual(
    reading(
      newestSucceeded(rows + 1, "a"),
      { a: "NotAncestor" },
      repeated(rows, "a", rows),
    ).mark,
    { reach: "Unknown" },
  );
});

/** A commit of the second width, which no single-digit fixture commit is. */
function wideOf(digit: string): GitObjectId {
  return asGitObjectId(digit.repeat(64));
}

const newestWide = wideOf("f");
const failedWide = wideOf("d");
const pastWide = wideOf("e");

/** As many commits as a reading weighs beneath an action's newest, each named by a digit of its own. */
function weighable(): readonly GitObjectId[] {
  const commits = [..."0123456789abcdef"].map(commitOf);
  assert.equal(commits.length, actionReachEarlierSuccessesMax);
  return commits;
}

/** Successes one beneath another, newest first, at the commits given in order, each reported since the ticket landed unless a case says the last was not. */
function successesAt(
  commits: readonly GitObjectId[],
  lastSinceLanded = true,
): readonly ActionReachEarlierSuccess[] {
  return commits.map((commit, at) => ({
    observation: { ...succeeded(commits.length - at, "0"), commit },
    sinceLanded: lastSinceLanded || at < commits.length - 1,
  }));
}

/** What a walk came to: its mark and each commit it asked about, in order. */
interface Walk {
  readonly mark: ActionReachMark;
  readonly asked: readonly GitObjectId[];
}

/**
 * Drives a reading over the rows given as its earlier successes, beneath a
 * newest success at `newestWide` and, where a case says so, a newer failure at
 * `failedWide`. Every commit asked about is answered as not holding the
 * ticket's but those `holding` names, and a reading that takes more turns than
 * its newest reports and the commits it may weigh allow fails the case.
 */
function walked(
  rows: readonly ActionReachEarlierSuccess[],
  chosen: { failed?: boolean; holding?: readonly GitObjectId[] } = {},
): Walk {
  const success = { ...succeeded(rows.length + 1, "0"), commit: newestWide };
  const failure = { ...failed(rows.length + 2, "0"), commit: failedWide };
  const newest: ActionReachNewest =
    chosen.failed === true
      ? { success, report: failure }
      : { success, report: success };
  const known = new Map<GitObjectId, CommitAncestry>();
  const asked: GitObjectId[] = [];
  for (let turn = 0; turn < actionReachEarlierSuccessesMax + 3; turn += 1) {
    const next = actionReachNext({ newest, earlier: rows, answers: known });
    if (next.next === "Marked") return { mark: next.mark, asked };
    if (next.next !== "Ask")
      return assert.fail("the successes were read twice");
    asked.push(next.tip);
    known.set(
      next.tip,
      chosen.holding?.includes(next.tip) === true ? "Ancestor" : "NotAncestor",
    );
  }
  return assert.fail("the reading did not end");
}

test("as many commits weighed as a reading may, with a success at one more since the ticket landed beneath them, is unknown and never not yet", () => {
  assert.deepEqual(walked(successesAt([...weighable(), pastWide])), {
    mark: { reach: "Unknown" },
    asked: [newestWide, ...weighable()],
  });
});

test("the walk ending on its last row, or on a commit past those it may weigh reported before the ticket landed, is not yet", () => {
  assert.deepEqual(walked(successesAt(weighable())), {
    mark: { reach: "NotYet" },
    asked: [newestWide, ...weighable()],
  });
  assert.deepEqual(walked(successesAt([...weighable(), pastWide], false)), {
    mark: { reach: "NotYet" },
    asked: [newestWide, ...weighable()],
  });
});

test("the commit past those a reading may weigh is never weighed, though it holds the ticket's", () => {
  assert.deepEqual(
    walked(successesAt([...weighable(), pastWide]), { holding: [pastWide] }),
    { mark: { reach: "Unknown" }, asked: [newestWide, ...weighable()] },
  );
});

test("a commit the walk weighed is passed over wherever it succeeded again, so as many commits as a reading may weigh are each weighed however often each is reported", () => {
  const commits = weighable();
  assert.deepEqual(walked(successesAt([...commits, ...commits, ...commits])), {
    mark: { reach: "NotYet" },
    asked: [newestWide, ...commits],
  });
  const last = successesAt([...commits, ...commits, pastWide]);
  assert.deepEqual(walked(last, { holding: [pastWide] }), {
    mark: { reach: "Unknown" },
    asked: [newestWide, ...commits],
  });
});

test("a success at the commit of the newest success, or of the failure after it, costs the walk none of the commits it may weigh", () => {
  assert.deepEqual(walked(successesAt([newestWide, ...weighable()])), {
    mark: { reach: "NotYet" },
    asked: [newestWide, ...weighable()],
  });
  assert.deepEqual(
    walked(successesAt([newestWide, failedWide, ...weighable()]), {
      failed: true,
    }),
    {
      mark: { reach: "NotYet" },
      asked: [newestWide, failedWide, ...weighable()],
    },
  );
});

/** As many successes as a reading walks, every one at the commit of the newest. */
function walkedInFull(): readonly GitObjectId[] {
  return Array.from({ length: actionReachEarlierRowsMax }, () => newestWide);
}

test("the row past those a reading walks is never weighed though its commit holds the ticket's, and one reported since the ticket landed is unknown", () => {
  assert.deepEqual(
    walked(successesAt([...walkedInFull(), pastWide]), { holding: [pastWide] }),
    { mark: { reach: "Unknown" }, asked: [newestWide] },
  );
});

test("a walk that ends on the last row it may walk, or with the row past it reported before the ticket landed, is not yet", () => {
  assert.deepEqual(walked(successesAt(walkedInFull())), {
    mark: { reach: "NotYet" },
    asked: [newestWide],
  });
  assert.deepEqual(walked(successesAt([...walkedInFull(), pastWide], false)), {
    mark: { reach: "NotYet" },
    asked: [newestWide],
  });
});

test("the last row a reading may walk is weighed", () => {
  const rows = successesAt([...walkedInFull().slice(1), pastWide]);
  assert.deepEqual(walked(rows, { holding: [pastWide] }), {
    mark: { reach: "RolledBack", observation: rows.at(-1)?.observation },
    asked: [newestWide, pastWide],
  });
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
