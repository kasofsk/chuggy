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
  creationConfigurationChosen,
  creationFaultSentence,
  creationFormFrom,
  creationStageOf,
} from "../app/core/ticketCreation.ts";
import {
  creationBinding,
  creationDeclared,
  creationForm,
  creationOffer,
  creationOffers,
  creationYamlKeptUnasked,
} from "./ticketCreationFixture.ts";

const context: TicketYamlContext = {
  base: creationForm({ intent: "" }),
  offers: creationOffers,
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
  const commanding = [creationOffer(undefined, { commandedCheckStage: 1 })];
  const over = { ...context, repositories, offers: commanding };
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

const chuggy = "https://forge.test/kasofsk/chuggy";

/** Two offers that differ in everything a configuration decides for a form:
 * whether it takes check lines, the program it defaults, and how long one may be. */
const development = creationOffer(
  creationDeclared("n-development", chuggy, "development"),
  { commandedCheckStage: 1 },
);
const sonnet = creationOffer(
  creationDeclared("n-sonnet", chuggy, "development-sonnet"),
  {
    defaults: { dependencies: [], program: [creationStageOf(2, 1)] },
    choices: { programStagesMax: 1, evaluatorsMax: 3 },
  },
);

/** A project offering several, on a form that has chosen none of them. */
const several: TicketYamlContext = {
  base: creationFormFrom([development, sonnet], []),
  offers: [development, sonnet],
  repositories: [],
  dependenciesLocked: false,
};

test("a project offering one configuration draws no key for it, and refuses one", () => {
  expect(ticketYamlOf(context.base, context)).not.toContain("configuration");
  expect(
    readForm("configuration: r3\nintent: y\n").problems.map(
      (problem) => problem.message,
    ),
  ).toStrictEqual(["this form has no `configuration`"]);
  expect(readForm("intent: y\n").form?.configuration).toBe("r3");
});

test("a project offering several writes the choice first, by name, and reads it back", () => {
  const form = {
    ...creationConfigurationChosen(several.base, several.offers, "development"),
    intent: "ship it",
    checks: ["npm test"],
  };
  const text = ticketYamlOf(form, several);
  expect(text.startsWith("configuration: development\n")).toBe(true);
  const read = ticketYamlRead(text, several);
  expect(read.problems).toStrictEqual([]);
  expect(read.form).toStrictEqual(form);
});

/** A form that has chosen nothing still switches to the YAML and back: the
 * text names none, and what is wrong with that is the form's fault to state. */
test("a form naming no configuration reads as YAML and back, without the keys one decides", () => {
  const text = ticketYamlOf(several.base, several);
  expect(text.startsWith('configuration: ""\n')).toBe(true);
  expect(text).not.toContain("program");
  expect(text).not.toContain("dependencies");
  const read = ticketYamlRead(text, several);
  expect(read.problems).toStrictEqual([]);
  expect(read.form).toStrictEqual(several.base);
  const fault = {
    field: "configuration" as const,
    reason: creationFaultSentence("configuration"),
  };
  expect(ticketYamlFaultProblems([fault], read.keys)).toStrictEqual([
    { from: 0, to: "configuration".length, message: fault.reason },
  ]);
});

test("a configuration nothing offers is refused, naming the ones offered", () => {
  const text =
    "configuration: development-opus\nintent: y\nprogram:\n  - evaluators: 1\n";
  const read = ticketYamlRead(text, several);
  expect(read.form).toBeUndefined();
  expect(read.problems).toStrictEqual([
    {
      from: text.indexOf("development-opus"),
      to: text.indexOf("development-opus") + "development-opus".length,
      message: "name one of development, development-sonnet",
    },
  ]);
});

const unnamed = creationFaultSentence("configuration");

/**
 * The keys a configuration decides wait on the name: a text that writes them
 * under none is told one thing, the form's own, and not that it has no
 * program. It reads as no form, since that form could not hold what they say.
 */
test("a text writing a key a configuration decides under none is held, and told only to name one", () => {
  const rest =
    "intent: y\nchecks:\n  - npm test\nprogram:\n  - evaluators: 9\n";
  const left = ticketYamlRead(rest, several);
  expect(left.form).toBeUndefined();
  expect(left.problems).toStrictEqual([{ from: 0, to: 0, message: unnamed }]);
  const empty = ticketYamlRead(`title: x\nconfiguration: ""\n${rest}`, several);
  expect(empty.form).toBeUndefined();
  expect(empty.problems).toStrictEqual([
    {
      from: "title: x\n".length,
      to: "title: x\nconfiguration".length,
      message: unnamed,
    },
  ]);
});

test("a text kept under one configuration reads as no form among several until it names one, and then whole", () => {
  const kept = ticketYamlRead(creationYamlKeptUnasked, several);
  expect(kept.form).toBeUndefined();
  expect(kept.problems.map((problem) => problem.message)).toStrictEqual([
    unnamed,
  ]);
  const named = ticketYamlRead(
    `configuration: development\n${creationYamlKeptUnasked}`,
    several,
  );
  expect(named.problems).toStrictEqual([]);
  expect(named.form).toMatchObject({
    configuration: "development",
    title: "Ship it",
    dependencies: [7],
    program: [creationStageOf(2, 1), creationStageOf(1, 2)],
  });
});

/** One offer the form does not already name is still a question, as it is on
 * an edit whose own revision went unread and under a read that missed some. */
test("a project offering one configuration the form does not name still asks in the YAML", () => {
  const asked: TicketYamlContext = {
    ...context,
    base: creationFormFrom(creationOffers, [], undefined, true),
  };
  expect(asked.base.configuration).toBe("");
  expect(
    ticketYamlOf(asked.base, asked).startsWith('configuration: ""\n'),
  ).toBe(true);
  const read = ticketYamlRead("configuration: r3\nintent: y\n", asked);
  expect(read.problems).toStrictEqual([]);
  expect(read.form?.configuration).toBe("r3");
});

test("the keys a configuration decides are read under the one the text names", () => {
  const named = (configuration: string, rest: string) =>
    ticketYamlRead(
      `intent: y\n${rest}configuration: ${configuration}\n`,
      several,
    );
  expect(named("development-sonnet", "").form?.program).toStrictEqual(
    sonnet.initialization.defaults.program,
  );
  expect(named("development", "").form?.program).toStrictEqual(
    development.initialization.defaults.program,
  );
  const checks = "checks:\n  - npm test\n";
  expect(named("development", checks).form?.checks).toStrictEqual(["npm test"]);
  expect(
    named("development-sonnet", checks).problems.map((one) => one.message),
  ).toStrictEqual(["this form has no `checks`"]);
  const twoStages = "program:\n  - evaluators: 1\n  - evaluators: 1\n";
  expect(named("development", twoStages).form?.program.length).toBe(2);
  expect(
    named("development-sonnet", twoStages).problems.map((one) => one.message),
  ).toStrictEqual(["a program has at most 1 stages here"]);
});

test("the vocabulary offers the configurations by name, and a program only under one", () => {
  const unchosen = ticketYamlVocabulary(several.base, several);
  expect(unchosen.map((key) => key.key)).toStrictEqual([
    "configuration",
    "title",
    "intent",
    "links",
    "branch",
    "landing",
    "target",
  ]);
  expect(unchosen[0]?.values).toStrictEqual([
    { label: "development", detail: "n-development" },
    { label: "development-sonnet", detail: "n-sonnet" },
  ]);
  const chosen = ticketYamlVocabulary(
    creationConfigurationChosen(several.base, several.offers, "development"),
    several,
  ).map((key) => key.key);
  expect(chosen).toContain("checks");
  expect(chosen).toContain("program");
  expect(chosen).toContain("evaluators");
});
