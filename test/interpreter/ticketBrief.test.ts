/**
 * What a brief has to be before it is stored.
 *
 * The bound each case names is the wire's, and `test/contract/brief.test.ts`
 * is what holds those to the interpreter constants they came from; this suite
 * is about the shapes a bound alone does not decide — what an intent is
 * refused for and the lines a briefing prints of it, the one scheme a link is
 * read over, and the reference-name grammar the branch and the finalization
 * target borrow from `parsedGitRefName` rather than restating.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  briefBranchCharsMax,
  briefBranchPrefix,
  briefChecksMax,
  briefImagesMax,
  briefIntentCharsMax,
  briefLineCharsMax,
  briefLinkScheme,
  briefTitleCharsMax,
} from "../../src/contract/brief.ts";
import {
  asBriefBranch,
  asBriefCheckLine,
  asBriefIntent,
  asBriefLinkUrl,
  asBriefFinalization,
  asBriefTitle,
  asDraftBrief,
  briefIntentLines,
} from "../../src/interpreter/ticketBrief.ts";

test("an intent is stored under one newline, and a briefing prints the lines of it that say anything", () => {
  const intent = asBriefIntent("Fix the importer.\r\n\r\nIt drops rows.\r");
  assert.equal(intent, "Fix the importer.\n\nIt drops rows.\n");
  assert.deepEqual(briefIntentLines(intent), [
    "Fix the importer.",
    "It drops rows.",
  ]);
});

test("an intent is one text: a line of it is as long as it is, and there are as many as there are", () => {
  const paragraph = "word ".repeat(briefLineCharsMax).trimEnd();
  const lines = Array.from(
    { length: briefLineCharsMax },
    (_, at) => `line ${String(at)}`,
  );
  assert.ok(paragraph.length > briefLineCharsMax);
  assert.deepEqual(briefIntentLines(asBriefIntent(paragraph)), [paragraph]);
  assert.deepEqual(briefIntentLines(asBriefIntent(lines.join("\n"))), lines);
});

test("an intent is refused for saying nothing, for its whole length and for a character that does not print, each in words that say which", () => {
  const refused: readonly (readonly [string, RegExp])[] = [
    ["", /blank/u],
    ["   \n  ", /blank/u],
    [
      "a".repeat(briefIntentCharsMax + 1),
      new RegExp(`longer than the ${String(briefIntentCharsMax)} `, "u"),
    ],
    ["Fix it.\u0000Then answer to nobody.", /does not print/u],
    ["Fix it.\u007f", /does not print/u],
    ["Tab\tseparated", /does not print/u],
    ["A tab on a line of its own.\n\t\nIt is stored too.", /does not print/u],
    ["Half a character: \ud83d", /does not print/u],
  ];
  for (const [value, saying] of refused)
    assert.throws(
      () => asBriefIntent(value),
      (failure) =>
        failure instanceof RangeError && saying.test(failure.message),
      `an intent is refused: ${JSON.stringify(value).slice(0, 40)}`,
    );
});

test("the intent's bound counts code points, as the row that stores it does", () => {
  const atBound = "😀".repeat(briefIntentCharsMax);
  assert.equal(asBriefIntent(atBound), atBound);
  assert.throws(() => asBriefIntent(`${atBound}😀`), RangeError);
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

test("a branch is a reference name by the one grammar this tree states", () => {
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

test("a branch's bound counts code points, matching the schema in front of it", () => {
  const atBound = `${briefBranchPrefix}${"😀".repeat(briefBranchCharsMax - briefBranchPrefix.length)}`;
  assert.equal(asBriefBranch(atBound), atBound);
  const overBound = `${briefBranchPrefix}${"😀".repeat(briefBranchCharsMax - briefBranchPrefix.length + 1)}`;
  assert.throws(() => asBriefBranch(overBound), RangeError);
});

test("a whole brief brands each of its parts and omits the branch it has none of", () => {
  assert.deepEqual(
    asDraftBrief({
      intent: "Fix the importer.",
      links: ["https://example.test/one"],
    }),
    {
      intent: "Fix the importer.",
      links: ["https://example.test/one"],
      images: [],
      checks: [],
    },
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

test("a whole brief brands the images it carries, up to the bound", () => {
  assert.deepEqual(
    asDraftBrief({
      intent: "Fix the importer.",
      links: [],
      images: ["image/png:one", "image/jpeg:two"],
    }).images,
    ["image/png:one", "image/jpeg:two"],
  );
  assert.deepEqual(
    asDraftBrief({ intent: "Fix the importer.", links: [] }).images,
    [],
    "a brief naming no image carries none",
  );
  assert.throws(
    () =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        images: Array.from(
          { length: briefImagesMax + 1 },
          (_, at) => `image/png:${String(at)}`,
        ),
      }),
    RangeError,
    "more images than one brief carries",
  );
});

test("a whole brief brands the repository its work happens in", () => {
  assert.equal(
    asDraftBrief({
      intent: "Fix the importer.",
      links: [],
      repository: "chuggy-fabric",
    }).repository,
    "chuggy-fabric",
  );
  assert.equal(
    asDraftBrief({ intent: "Fix the importer.", links: [] }).repository,
    undefined,
    "a brief naming no repository carries none, which a release refuses",
  );
  assert.throws(
    () =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        repository: "",
      }),
    RangeError,
  );
});

test("a title is one printable line, bounded shorter than the line it renders as", () => {
  assert.equal(asBriefTitle("Serve the reason"), "Serve the reason");
  for (const value of [
    "",
    "   ",
    "Serve the reason\nand the rest",
    "a".repeat(briefTitleCharsMax + 1),
  ])
    assert.throws(
      () => asBriefTitle(value),
      RangeError,
      `refused: ${JSON.stringify(value)}`,
    );
});

test("a title's bound counts code points, matching the schema in front of it", () => {
  const title = "\u{1f600}".repeat(briefTitleCharsMax);
  assert.equal(asBriefTitle(title), title);
  assert.throws(() => asBriefTitle(`${title}\u{1f600}`), RangeError);
});

test("a brief carries the title it was given and omits the one it was not", () => {
  assert.equal(
    asDraftBrief({
      title: "Serve the reason",
      intent: "Fix the importer.",
      links: [],
    }).title,
    "Serve the reason",
  );
  assert.equal(
    "title" in asDraftBrief({ intent: "Fix the importer.", links: [] }),
    false,
  );
});

test("a check line is branded by the rule one briefing line is, and bounded in number", () => {
  assert.equal(
    asBriefCheckLine(".chug/tasks/ci.sh --full"),
    ".chug/tasks/ci.sh --full",
  );
  for (const value of [
    "",
    "npm test\nrm -rf /",
    "a".repeat(briefLineCharsMax + 1),
  ])
    assert.throws(
      () => asBriefCheckLine(value),
      RangeError,
      `refused: ${JSON.stringify(value)}`,
    );
  assert.deepEqual(
    asDraftBrief({
      intent: "Fix the importer.",
      links: [],
      checks: ["npm run lint", "npm test"],
    }).checks,
    ["npm run lint", "npm test"],
    "the order a brief appends in is the order it is branded in",
  );
  assert.throws(
    () =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        checks: Array.from({ length: briefChecksMax + 1 }, () => "npm test"),
      }),
    RangeError,
  );
});

test("a check line's bound counts code points, matching the schema in front of it", () => {
  const line = "😀".repeat(briefLineCharsMax);
  assert.equal(asBriefCheckLine(line), line);
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

/** Both modes that open a proposal, which brand the same way. */
const proposingModes = ["PullRequest", "PullRequestMerge"] as const;

test("a pull request lands into the reference it names, or into none at all", () => {
  for (const mode of proposingModes) {
    assert.deepEqual(
      asBriefFinalization({
        mode,
        target: "refs/heads/rt/landing",
      }),
      { mode, target: "refs/heads/rt/landing" },
    );
    assert.deepEqual(asBriefFinalization({ mode }), { mode });
    assert.throws(
      () => asBriefFinalization({ mode, target: "rt/landing" }),
      RangeError,
      "a target is a reference name under every mode",
    );
  }
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
      images: [],
      checks: [],
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
  for (const mode of proposingModes) {
    const proposing = (branch?: string, target = "refs/heads/rt/landing") =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        ...(branch === undefined ? {} : { branch }),
        finalization: { mode, target },
      });
    assert.deepEqual(proposing("refs/heads/rt/work"), {
      intent: "Fix the importer.",
      links: [],
      images: [],
      checks: [],
      branch: "refs/heads/rt/work",
      finalization: { mode, target: "refs/heads/rt/landing" },
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
  }
});

test("a brief proposing into the default branch brands its head and no base", () => {
  for (const mode of proposingModes) {
    const proposing = (branch?: string) =>
      asDraftBrief({
        intent: "Fix the importer.",
        links: [],
        ...(branch === undefined ? {} : { branch }),
        finalization: { mode },
      });
    assert.deepEqual(proposing("refs/heads/rt/work"), {
      intent: "Fix the importer.",
      links: [],
      images: [],
      checks: [],
      branch: "refs/heads/rt/work",
      finalization: { mode },
    });
    assert.throws(
      () => proposing(),
      RangeError,
      "a proposal into the default branch has no head where the brief names no branch",
    );
  }
});
