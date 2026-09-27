/**
 * A ticket form written as YAML and read back: that the two are one value,
 * that the text is refused where the form could not hold it, and that a fault
 * the form earns is drawn at the key it names.
 */

import { expect, test } from "vitest";

import {
  ticketYamlFaultProblems,
  ticketYamlOf,
  ticketYamlRead,
  ticketYamlVocabulary,
} from "../app/browser/editor/ticketYaml.ts";
import type { TicketYamlContext } from "../app/browser/editor/ticketYaml.ts";
import {
  creationBinding,
  creationForm,
  creationInitialization,
} from "./ticketCreationFixture.ts";

const context: TicketYamlContext = {
  base: creationForm({ intent: "" }),
  initialization: creationInitialization,
  repositories: [],
  dependenciesLocked: false,
};

function readForm(text: string, over: Partial<TicketYamlContext> = {}) {
  return ticketYamlRead(text, { ...context, ...over });
}

/** Switching to the YAML and back must not move a single field, or the
 * screen would call itself dirty the moment it was opened. */
test("a form read as YAML reads back as the same form", () => {
  const repositories = [creationBinding("acme/one", "PullRequest")];
  const commanding = { ...creationInitialization, commandedCheckStage: 1 };
  const over = { ...context, repositories, initialization: commanding };
  const form = creationForm(
    {
      title: "Ship it",
      intent: "first line\nsecond line",
      links: ["https://example.com/a"],
      checks: ["npm test"],
      branchName: "topic/one",
      targetBranchName: "main",
      repository: "acme/one",
      landingMode: "PullRequest",
      dependencies: [7],
      program: [
        { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
        { key: 2, evaluators: [{ key: 1 }] },
      ],
    },
    repositories,
  );
  const read = ticketYamlRead(ticketYamlOf(form, over), over);
  expect(read.problems).toStrictEqual([]);
  expect(read.form).toStrictEqual(form);
});

test("the intent is written as a block, one line of text a line", () => {
  const text = ticketYamlOf(creationForm({ intent: "first\nsecond" }), context);
  expect(text).toContain("intent: |-\n  first\n  second\n");
});

test("a key the form does not draw is refused at that key", () => {
  const text = "title: x\nintent: y\nchecks:\n  - npm test\n";
  const read = readForm(text);
  expect(read.form).toBeUndefined();
  expect(read.problems).toStrictEqual([
    {
      from: text.indexOf("checks") + "checks:".length + 3,
      to: text.length,
      message: "this form has no `checks`",
    },
  ]);
});

test("text the parser cannot read is a problem where it stopped", () => {
  const read = readForm("title: [unclosed\n");
  expect(read.form).toBeUndefined();
  expect(read.problems.length).toBeGreaterThan(0);
  expect(read.problems[0]?.from).toBeGreaterThan(0);
});

test("a landing the roster does not carry names the ones it does", () => {
  const read = readForm("intent: y\nlanding: Teleport\n");
  expect(read.problems.map((problem) => problem.message)).toStrictEqual([
    "land as one of Push, PullRequest, PullRequestMerge, None",
  ]);
});

test("a stage is written by its evaluator count and keyed by position", () => {
  const read = readForm(
    "intent: y\nprogram:\n  - evaluators: 2\n  - evaluators: 1\n",
  );
  expect(read.form?.program).toStrictEqual([
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ]);
  expect(readForm("program:\n  - evaluators: 9\n").problems[0]?.message).toBe(
    "a stage takes at most 3 evaluators here",
  );
});

/** An emptied line is an emptied field, but the three a form never leaves
 * empty keep what the screen began with. */
test("a key left out is empty, except landing, program and dependencies", () => {
  const base = creationForm({
    title: "held",
    landingMode: "PullRequest",
    dependencies: [8],
  });
  const read = readForm("intent: y\n", { base });
  expect(read.form?.title).toBe("");
  expect(read.form?.landingMode).toBe("PullRequest");
  expect(read.form?.dependencies).toStrictEqual([8]);
  expect(read.form?.program).toStrictEqual(base.program);
});

test("a released ticket's dependencies may be written but not changed", () => {
  const base = creationForm({ dependencies: [7] });
  const locked = { base, dependenciesLocked: true };
  const text = ticketYamlOf(base, { ...context, ...locked });
  expect(text).toContain("# fixed once the ticket was released");
  expect(readForm(text, locked).form?.dependencies).toStrictEqual([7]);
  expect(
    readForm(text.replace("[ 7 ]", "[ 7, 8 ]"), locked).problems[0]?.message,
  ).toMatch(/cannot change/u);
});

/** The parser refuses a repeated key itself, so no reading of one is kept. */
test("a key written twice is refused", () => {
  const text = "title: a\ntitle: b\n";
  expect(readForm(text).problems[0]?.message).toMatch(
    /Map keys must be unique/u,
  );
});

test("a fault is drawn at the key it names, and the fence at the start", () => {
  const text = "title: x\nintent: y\n";
  const keys = readForm(text).keys;
  expect(
    ticketYamlFaultProblems(
      [
        { field: "intent", reason: "say more" },
        { field: "fence", reason: "read again" },
      ],
      keys,
    ),
  ).toStrictEqual([
    {
      from: text.indexOf("intent"),
      to: text.indexOf("intent") + 6,
      message: "say more",
    },
    { from: 0, to: 0, message: "read again" },
  ]);
});

test("the vocabulary offers what this project's form draws", () => {
  const keys = ticketYamlVocabulary(context.base, context);
  const named = keys.map((key) => key.key);
  expect(named).not.toContain("checks");
  expect(named).not.toContain("repository");
  expect(
    keys
      .find((key) => key.key === "landing")
      ?.values.map((value) => value.label),
  ).toStrictEqual(["Push", "PullRequest", "PullRequestMerge", "None"]);
  expect(
    keys.find((key) => key.key === "dependencies")?.values.map((v) => v.label),
  ).toStrictEqual(["7", "8"]);
  const evaluators = keys.find((key) => key.key === "evaluators");
  expect(evaluators?.nested).toBe(true);
  expect(evaluators?.values.map((value) => value.label)).toStrictEqual([
    "1",
    "2",
    "3",
  ]);
});

/** The form's own control stops at the project's bound, so the text does too
 * rather than passing a program the server refuses. */
test("a program longer than the project offers is refused", () => {
  const read = readForm(
    "intent: y\nprogram:\n  - evaluators: 1\n  - evaluators: 1\n  - evaluators: 1\n",
  );
  expect(read.form).toBeUndefined();
  expect(read.problems[0]?.message).toBe("a program has at most 2 stages here");
});

test("a dependency named twice is refused at the dependencies", () => {
  const text = "intent: y\ndependencies: [7, 7]\n";
  expect(readForm(text).problems).toStrictEqual([
    {
      from: text.indexOf("[7"),
      to: text.indexOf("]") + 1,
      message: "ticket 7 is named twice",
    },
  ]);
});
