/**
 * The control that stands between a run which established nothing and an exit
 * code saying it did, held to a report Playwright actually wrote.
 *
 * THE FIXTURE IS CAPTURED, NOT COMPOSED. `runVerdict` reads details of a shape
 * it does not own — that a skipped test spells its outcome on the test rather
 * than on the result it produced, that the reason arrives as a `skip` annotation
 * beside it, that a thrown error reaches `error.message` and not only `errors`,
 * and that the containers are called `suites`, `specs` and `tests`. A
 * hand-written fixture would agree with all of them by construction, which is
 * the failure this tree has met before; `verdictReport.json` is the report of a
 * real run with one drill that passed, one that skipped and one that threw, with
 * the capturing machine's checkout path rewritten out and nothing else touched.
 *
 * Each of those is planted against this suite in the commit that added it,
 * because a control nobody has seen refuse anything is not a control. Depth is
 * not among them and deliberately so: the walk recurses and reads a flattened
 * root as readily as a nested one, so only the names carry weight.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { rigCouldNotRunPrefix, runVerdict } from "./verdict.ts";

const captured: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "verdictReport.json"), "utf8"),
);

const skippedTitle = "a drill that did not run";
const unaskableTitle = "a drill that could not ask the rig";
const reachedTitle = "a drill that reached a verdict";

test("a captured report's skipped drill is named with the reason it stated", () => {
  const verdict = runVerdict(captured);
  assert.deepEqual(
    verdict.skipped.map((drill) => drill.title),
    [skippedTitle],
  );
  assert.equal(
    verdict.skipped[0]?.reason,
    "the installation runs its selector at no replicas, so nothing dispatches",
  );
});

test("a captured report's unaskable drill is named with what the command said", () => {
  const verdict = runVerdict(captured);
  assert.deepEqual(
    verdict.unaskable.map((drill) => drill.title),
    [unaskableTitle],
  );
  const said = verdict.unaskable[0]?.reason ?? "";
  assert.ok(said.includes(rigCouldNotRunPrefix), said);
  assert.ok(said.includes("chuggy-ticket-service"), said);
});

test("a drill that ran is counted and is in neither list", () => {
  const verdict = runVerdict(captured);
  assert.equal(verdict.reached, 1);
  for (const drill of [...verdict.skipped, ...verdict.unaskable])
    assert.notEqual(drill.title, reachedTitle);
});

/** The same walk over the same report with everything but the drill that ran
 * taken out, which is what a clean run looks like. */
test("a report in which every drill ran reaches a clean verdict", () => {
  const suites = (captured as { suites: { specs: { title: string }[] }[] })
    .suites;
  const clean = {
    suites: suites.map((suite) => ({
      ...suite,
      specs: suite.specs.filter((spec) => spec.title === reachedTitle),
    })),
  };
  assert.deepEqual(runVerdict(clean), {
    reached: 1,
    skipped: [],
    unaskable: [],
  });
});

test("a report this walk cannot read reaches nothing rather than a clean verdict", () => {
  assert.deepEqual(runVerdict({}), {
    reached: 0,
    skipped: [],
    unaskable: [],
  });
  assert.deepEqual(runVerdict(undefined), {
    reached: 0,
    skipped: [],
    unaskable: [],
  });
});
