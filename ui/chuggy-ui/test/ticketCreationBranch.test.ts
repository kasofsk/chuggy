/**
 * The branch a creation proposes for a pull request: the name a title
 * becomes, when a form proposes it, and that a body carries it only for a box
 * left empty.
 *
 * The assembly an edit shares is checked unmoved beside it, so the proposal
 * is seen to be the creation's own step and not the form's.
 */

import { expect, test } from "vitest";

import {
  briefBranchCharsMax,
  briefBranchPrefix,
} from "../../../src/contract/brief.ts";
import { draftCreationSchema } from "../../../src/contract/requests.ts";
import {
  creationBodyFrom,
  creationBranchNameOf,
  creationBranchPrefixedSentence,
  creationBranchProposed,
  creationBranchProposedCharsMax,
  creationFormProposed,
  creationLandingBranchSentence,
} from "../app/core/ticketCreation.ts";
import type {
  CreationAssembly,
  TicketCreationForm,
} from "../app/core/ticketCreation.ts";
import { creationForm, creationOffers } from "./ticketCreationFixture.ts";

const titled = "Fix the login page";
const named = "fix-the-login-page";

const names: readonly (readonly [string, string, string])[] = [
  ["a plain title", titled, named],
  ["punctuation", "Fix: the login page (again!)", "fix-the-login-page-again"],
  ["hyphens and spaces at its ends", " --Fix the login-- ", "fix-the-login"],
  ["an underscore and a slash", "login_page/v2", "login-page-v2"],
  ["digits", "Bump node 20 to 22", "bump-node-20-to-22"],
  ["accented letters", "Café Ångström", "café-ångström"],
  ["Cyrillic", "Добавить страницу входа", "добавить-страницу-входа"],
  ["Japanese", "修正 ログイン", "修正-ログイン"],
  ["Devanagari, whose vowel signs are marks", "लॉगिन पेज", "लॉगिन-पेज"],
  ["full-width forms", "Ｆｉｘ　ｉｔ", "fix-it"],
  ["two dots, which git refuses", "wip..done", "wip-done"],
  ["a lock suffix, which git refuses", "v1.lock", "v1-lock"],
  ["a reflog selector, which git refuses", "@{upstream}", "upstream"],
  ["a trailing slash, which git refuses", "feature/", "feature"],
  ["a leading dot, which git refuses", ".hidden", "hidden"],
  [
    "the characters git refuses in a name",
    "a~b^c:d?e*f[g\\h",
    "a-b-c-d-e-f-g-h",
  ],
  ["the reference prefix", "refs/heads/main", "refs-heads-main"],
  ["nothing", "", ""],
  ["only spaces", "   ", ""],
  ["only punctuation", "!!! --- ???", ""],
  ["only emoji", "🚀✨", ""],
];

test.each(names)("a title of %s becomes its name", (_kind, title, name) => {
  expect(creationBranchNameOf(title)).toBe(name);
});

/** Letters and digits in runs joined by single hyphens is inside what git
 * admits of a reference name, whatever the title held. */
test.each(names)(
  "the name of a title of %s is one git admits",
  (_kind, title) => {
    expect(creationBranchNameOf(title)).toMatch(
      /^(?:[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*)?$/u,
    );
  },
);

function wordsOf(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}

/** A word the bound falls inside is dropped whole, so the name ends on the
 * last word that fits. */
test("a long title is cut at the end of the last word that fits", () => {
  const name = creationBranchNameOf(wordsOf("seven77", 20));
  expect(name).toBe(wordsOf("seven77", 6).replaceAll(" ", "-"));
  expect(name.length).toBeLessThan(creationBranchProposedCharsMax);
});

test("a long title whose word ends on the bound keeps that word", () => {
  const head = "a".repeat(creationBranchProposedCharsMax - 6);
  expect(creationBranchNameOf(`${head} bcdef ghijk`)).toBe(`${head}-bcdef`);
  expect(`${head}-bcdef`.length).toBe(creationBranchProposedCharsMax);
});

test("a title whose name is exactly the bound is kept whole", () => {
  const name = `${"a".repeat(creationBranchProposedCharsMax - 6)}-bcdef`;
  expect(creationBranchNameOf(name.replace("-", " "))).toBe(name);
});

test("a title of one long word is cut at the bound", () => {
  expect(creationBranchNameOf("a".repeat(300))).toBe(
    "a".repeat(creationBranchProposedCharsMax),
  );
});

/** The bound counts characters and not the units a string stores them in, so
 * a letter stored as two is never cut in half. */
test("a long title of letters outside the basic plane is cut between letters", () => {
  const letter = "𠮷";
  expect(letter.length).toBe(2);
  const name = creationBranchNameOf(letter.repeat(60));
  expect(Array.from(name)).toStrictEqual(
    Array.from({ length: creationBranchProposedCharsMax }, () => letter),
  );
  expect(`${briefBranchPrefix}${name}`.length).toBeLessThan(
    briefBranchCharsMax,
  );
});

function proposing(over: Partial<TicketCreationForm> = {}): TicketCreationForm {
  return creationForm({ landingMode: "PullRequest", title: titled, ...over });
}

test.each(["PullRequest", "PullRequestMerge"] as const)(
  "a %s with a title and an empty branch box proposes the title's name",
  (landingMode) => {
    expect(creationBranchProposed(proposing({ landingMode }))).toBe(named);
  },
);

test.each(["Push", "None"] as const)(
  "a landing of %s opens no pull request and proposes no branch",
  (landingMode) => {
    const form = proposing({ landingMode });
    expect(creationBranchProposed(form)).toBeUndefined();
    expect(creationFormProposed(form)).toBe(form);
  },
);

const typed: readonly (readonly [string, string])[] = [
  ["a name", "mine"],
  ["the proposal's own name", named],
  ["one character", "x"],
  ["a reference", `${briefBranchPrefix}mine`],
  ["only a space", " "],
];

test.each(typed)(
  "a branch box holding %s is the reader's, and is not proposed over",
  (_kind, branchName) => {
    const form = proposing({ branchName });
    expect(creationBranchProposed(form)).toBeUndefined();
    expect(creationFormProposed(form)).toBe(form);
  },
);

test.each(["", "   ", "!!!", "🚀"])(
  "a title of %j has no name in it, and nothing is proposed",
  (title) => {
    const form = proposing({ title });
    expect(creationBranchProposed(form)).toBeUndefined();
    expect(creationFormProposed(form)).toBe(form);
  },
);

/** What a creation's Form side submits: the form with its proposal in it. */
function sent(form: TicketCreationForm): CreationAssembly {
  return creationBodyFrom(creationOffers, creationFormProposed(form), []);
}

function branchSent(form: TicketCreationForm): string | undefined {
  const assembled = sent(form);
  if (assembled.assembled !== "Body")
    throw new Error("the form was refused where a body was expected");
  expect(draftCreationSchema.parse(assembled.body)).toStrictEqual(
    assembled.body,
  );
  return assembled.body.brief.branch;
}

function refusals(assembled: CreationAssembly): readonly string[] {
  return assembled.assembled === "Faults"
    ? assembled.faults.map((fault) => `${fault.field}: ${fault.reason}`)
    : [];
}

test("a box left empty sends the proposal as a reference", () => {
  expect(branchSent(proposing())).toBe(`${briefBranchPrefix}${named}`);
});

test("a typed branch is what is sent, whatever the title would have proposed", () => {
  expect(branchSent(proposing({ branchName: "mine" }))).toBe(
    `${briefBranchPrefix}mine`,
  );
});

test("a push sends no branch for a box left empty, as it did", () => {
  expect(branchSent(proposing({ landingMode: "Push" }))).toBeUndefined();
});

test.each(["", "!!!"])(
  "with a title of %j the refusal stands as it was",
  (title) => {
    expect(refusals(sent(proposing({ title })))).toStrictEqual([
      `branch: ${creationLandingBranchSentence}`,
    ]);
  },
);

test("a branch box holding only a space is refused, not filled", () => {
  expect(refusals(sent(proposing({ branchName: " " })))).toStrictEqual([
    `branch: ${creationLandingBranchSentence}`,
  ]);
});

test("a pasted reference is refused for its prefix, not replaced", () => {
  expect(
    refusals(sent(proposing({ branchName: `${briefBranchPrefix}mine` }))),
  ).toStrictEqual([`branch: ${creationBranchPrefixedSentence}`]);
});

/** A proposal that is the target's own name is a pull request into itself,
 * which the pairing refuses at the target as it does a typed one. */
test("a proposal naming the target branch is refused at the target", () => {
  const assembled = sent(proposing({ targetBranchName: named }));
  expect(
    assembled.assembled === "Faults"
      ? assembled.faults.map((fault) => fault.field)
      : [],
  ).toStrictEqual(["target"]);
});

/** An edit assembles its revision with this, over the form as it is held. */
test("the assembly itself proposes nothing: the same form is refused unproposed", () => {
  expect(
    refusals(creationBodyFrom(creationOffers, proposing(), [])),
  ).toStrictEqual([`branch: ${creationLandingBranchSentence}`]);
});
