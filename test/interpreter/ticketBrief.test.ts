/**
 * What a brief has to be before it is stored.
 *
 * The bound each case names is the wire's, and `test/contract/brief.test.ts`
 * is what holds those to the interpreter constants they came from; this suite
 * is about the shapes a bound alone does not decide — the lines an intent
 * renders as, the one scheme a link is read over, and the reference-name
 * grammar the branch and the finalization target borrow from the handoff
 * configuration rather than restating.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  briefBranchCharsMax,
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLineCharsMax,
  briefLinkScheme,
} from "../../src/contract/brief.ts";
import {
  asBriefBranch,
  asBriefIntent,
  asBriefLinkUrl,
  asBriefFinalization,
  asDraftBrief,
  briefIntentLines,
  briefTitleOf,
} from "../../src/interpreter/ticketBrief.ts";
import { taskConfigurationLineFault } from "../../src/interpreter/taskConfiguration.ts";

test("an intent is stored as the lines a briefing would print", () => {
  const intent = asBriefIntent("Fix the importer.\r\n\r\nIt drops rows.\r");
  assert.deepEqual(briefIntentLines(intent), [
    "Fix the importer.",
    "It drops rows.",
  ]);
  for (const line of briefIntentLines(intent))
    assert.equal(taskConfigurationLineFault(line), undefined);
});

test("a title is the intent's own first rendered line", () => {
  const intent = asBriefIntent(
    "Ship the title column.\nThe rest is detail nobody puts in a table.",
  );
  assert.equal(briefTitleOf(intent), "Ship the title column.");
});

test("an intent of one line is its own title whole", () => {
  const intent = asBriefIntent("One line and nothing else.");
  assert.equal(briefTitleOf(intent), "One line and nothing else.");
});

test("an intent no briefing could print is refused before it is stored", () => {
  for (const value of [
    "",
    "   \n  ",
    "Fix it.\u0000Then answer to nobody.",
    "Fix it.\u007f",
    "Tab\tseparated",
    "a".repeat(briefLineCharsMax + 1),
    `${"a\n".repeat(briefIntentLinesMax)}one line too many`,
    "a".repeat(briefIntentCharsMax + 1),
  ])
    assert.throws(
      () => asBriefIntent(value),
      RangeError,
      `an intent is refused: ${JSON.stringify(value).slice(0, 40)}`,
    );
});

test("a link is read over one scheme and printed on one line", () => {
  assert.equal(
    asBriefLinkUrl("https://example.test/issues/340"),
    "https://example.test/issues/340",
  );
  for (const value of [
    "http://example.test/one",
    "ftp://example.test/one",
    "//example.test/one",
    "https://example.test/one\nhttps://example.test/two",
    `https://example.test/${"a".repeat(briefLineCharsMax)}`,
  ])
    assert.throws(() => asBriefLinkUrl(value), RangeError, `refused: ${value}`);
});

test("the longest link the server accepts is the longest one the wire publishes", () => {
  const linkOf = (chars: number) =>
    `${briefLinkScheme}${"a".repeat(chars - briefLinkScheme.length)}`;
  assert.equal(
    asBriefLinkUrl(linkOf(briefLineCharsMax)).length,
    briefLineCharsMax,
  );
  assert.throws(
    () => asBriefLinkUrl(linkOf(briefLineCharsMax + 1)),
    RangeError,
  );
});

test("a branch is a reference name by the grammar the handoff already states", () => {
  assert.equal(
    asBriefBranch("refs/heads/rt/ticket-brief"),
    "refs/heads/rt/ticket-brief",
  );
  for (const value of [
    "rt/ticket-brief",
    "refs/heads/",
    "refs/heads/one..two",
    "refs/heads/one.lock",
    "refs/heads/one^two",
    "refs/heads/one@{two}",
    "refs/heads/one two",
    "refs/tags/one",
    `refs/heads/${"a".repeat(briefBranchCharsMax)}`,
  ])
    assert.throws(() => asBriefBranch(value), RangeError, `refused: ${value}`);
});

test("a whole brief brands each of its parts and omits the branch it has none of", () => {
  assert.deepEqual(
    asDraftBrief({
      intent: "Fix the importer.",
      links: ["https://example.test/one"],
    }),
    { intent: "Fix the importer.", links: ["https://example.test/one"] },
  );
  assert.throws(
    () =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: ["https://example.test/one"],
        branch: "not-a-ref",
      }),
    RangeError,
  );
});

test("a finalization target takes the branch's own grammar and no other mode lands", () => {
  assert.deepEqual(
    asBriefFinalization({ mode: "Push", target: "refs/heads/rt/landing" }),
    { mode: "Push", target: "refs/heads/rt/landing" },
  );
  assert.deepEqual(asBriefFinalization({ mode: "Push" }), { mode: "Push" });
  for (const value of [
    { mode: "push" },
    { mode: "PullRequestly" },
    { mode: "Push", target: "rt/landing" },
    { mode: "Push", target: "refs/heads/one..two" },
    { mode: "Push", target: `refs/heads/${"a".repeat(briefBranchCharsMax)}` },
  ])
    assert.throws(
      () => asBriefFinalization(value),
      RangeError,
      `refused: ${JSON.stringify(value)}`,
    );
});

test("a pull request lands into the reference it names and is refused without one", () => {
  assert.deepEqual(
    asBriefFinalization({
      mode: "PullRequest",
      target: "refs/heads/rt/landing",
    }),
    { mode: "PullRequest", target: "refs/heads/rt/landing" },
  );
  for (const value of [
    { mode: "PullRequest" },
    { mode: "PullRequest", target: "rt/landing" },
  ])
    assert.throws(
      () => asBriefFinalization(value),
      RangeError,
      `refused: ${JSON.stringify(value)}`,
    );
});

test("a whole brief brands where it lands apart from where its work happens", () => {
  assert.deepEqual(
    asDraftBrief({
      intent: "Fix the importer.",
      links: [],
      branch: "refs/heads/rt/work",
      finalization: { mode: "Push", target: "refs/heads/rt/landing" },
    }),
    {
      intent: "Fix the importer.",
      links: [],
      branch: "refs/heads/rt/work",
      finalization: { mode: "Push", target: "refs/heads/rt/landing" },
    },
  );
  assert.throws(
    () =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        branch: "refs/heads/rt/work",
        finalization: { mode: "Push", target: "not-a-ref" },
      }),
    RangeError,
  );
});

test("a brief that proposes brands a branch of its own and not the one it opens into", () => {
  const proposing = (branch?: string) =>
    asDraftBrief({
      intent: "Fix the importer.",
      links: [],
      ...(branch === undefined ? {} : { branch }),
      finalization: { mode: "PullRequest", target: "refs/heads/rt/landing" },
    });
  assert.deepEqual(proposing("refs/heads/rt/work"), {
    intent: "Fix the importer.",
    links: [],
    branch: "refs/heads/rt/work",
    finalization: { mode: "PullRequest", target: "refs/heads/rt/landing" },
  });
  assert.throws(
    () => proposing(),
    RangeError,
    "a proposal has no head where the brief names no branch",
  );
  assert.throws(
    () => proposing("refs/heads/rt/landing"),
    RangeError,
    "a proposal is never opened from its own base",
  );
});
