/**
 * A reporter for node's test runner that keeps each suite's verdict apart from
 * every other's run beside it: for each suite file, `<suite>.outcome`, `pass`
 * or `fail`, and `<suite>.log`, what it printed and each test of it that
 * failed, under the directory `CHUG_UNIT_RESULTS` names.
 * `.chug/tasks/check-source.sh --unit` runs it beside the reporter it prints,
 * and `--unit-outcome` replays what it wrote.
 *
 * A SUITE PASSES ONLY ON THE RUNNER'S WORD FOR ITS FILE: the test that stands
 * for the whole file completed, and passed, which it does only where its
 * process exited clean and every test in it passed. A suite the runner never
 * finished is given no outcome, and no outcome is not a pass.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { TestsStreamEventMap } from "node:test";
import { inspect } from "node:util";

/** What the runner hands a reporter, one event at a time. */
type TestEvent = TestsStreamEventMap["data"][0];

/** The most of one suite's log kept; past it, the start is dropped and the end kept. */
export const unitOutcomesLogCharsMax = 1_048_576;

interface UnitOutcome {
  log: string;
  passed: boolean | undefined;
}

function unitOutcomesOf(
  outcomes: Map<string, UnitOutcome>,
  file: string | undefined,
): UnitOutcome | undefined {
  if (file === undefined) return undefined;
  const suite = relative(process.cwd(), resolve(file));
  let outcome = outcomes.get(suite);
  if (outcome === undefined) {
    outcome = { log: "", passed: undefined };
    outcomes.set(suite, outcome);
  }
  return outcome;
}

function unitOutcomesAppend(outcome: UnitOutcome, text: string): void {
  outcome.log += text;
  if (outcome.log.length > 2 * unitOutcomesLogCharsMax) {
    outcome.log = outcome.log.slice(-unitOutcomesLogCharsMax);
  }
}

function unitOutcomesFailure(name: string, error: unknown): string {
  const cause =
    error instanceof Error && error.cause !== undefined ? error.cause : error;
  const shown = inspect(cause).replaceAll("\n", "\n    ");
  return `✖ ${name}\n    ${shown}\n`;
}

function unitOutcomesRead(
  outcomes: Map<string, UnitOutcome>,
  event: TestEvent,
): void {
  if (event.type === "test:stdout" || event.type === "test:stderr") {
    const outcome = unitOutcomesOf(outcomes, event.data.file);
    if (outcome !== undefined) unitOutcomesAppend(outcome, event.data.message);
  } else if (event.type === "test:fail" && event.data.todo === undefined) {
    const outcome = unitOutcomesOf(outcomes, event.data.file);
    if (outcome !== undefined) {
      unitOutcomesAppend(
        outcome,
        unitOutcomesFailure(event.data.name, event.data.details.error),
      );
    }
  } else if (event.type === "test:complete" && event.data.nesting === 0) {
    const file = event.data.file;
    const outcome = unitOutcomesOf(outcomes, file);
    if (outcome !== undefined && file !== undefined) {
      if (event.data.name === relative(process.cwd(), resolve(file))) {
        outcome.passed = event.data.details.passed;
      }
    }
  }
}

function unitOutcomesWrite(
  results: string,
  suite: string,
  outcome: UnitOutcome,
): void {
  const kept = join(results, suite);
  mkdirSync(dirname(kept), { recursive: true });
  writeFileSync(`${kept}.log`, outcome.log);
  writeFileSync(
    `${kept}.outcome`,
    outcome.passed === true ? "pass\n" : "fail\n",
  );
}

export default async function* unitOutcomes(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const results = process.env["CHUG_UNIT_RESULTS"];
  if (results === undefined || results === "") {
    throw new Error(
      "unit-outcomes: CHUG_UNIT_RESULTS names no directory to write to",
    );
  }
  const outcomes = new Map<string, UnitOutcome>();
  for await (const event of source) unitOutcomesRead(outcomes, event);
  for (const [suite, outcome] of outcomes) {
    if (outcome.passed === undefined) continue;
    unitOutcomesWrite(results, suite, outcome);
    yield `${outcome.passed ? "pass" : "fail"}\t${suite}\n`;
  }
}
