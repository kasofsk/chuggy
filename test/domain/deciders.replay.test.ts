/**
 * Every step of every golden replayed through this implementation's own
 * deciders, reproducing the model's `StepRecord` and post-`Core` exactly.
 *
 * This is S3's evidence rather than S5's gate: the conformance gate, the
 * invariant evaluation after every step and the dispatch table's formal
 * contract are that slice's. What is here is the check that the deciders decide
 * what the model decides, which no hand-written expectation establishes with
 * the same force — reproduction is exact equality on the whole state, so a
 * dropped field or a mis-ordered fold has nowhere to hide.
 *
 * IT SAYS NOTHING ABOUT THE ENABLEMENT PREDICATES, and cannot. A replayer
 * routes on the action the trace recorded, because the golden's existence is
 * the guarantee that the action was enabled; no guard is ever consulted. Their
 * evidence is `enablement.test.ts`, and the arms no committed trace reaches are
 * `deciders.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decodeTrace,
  field,
  stateValue,
  type ItfState,
  type ItfValue,
} from "../itf/decode.ts";
import {
  decodeCore,
  decodeVerdict,
  decodeWrapUpOutcome,
  encodeCore,
  encodeStepRecord,
} from "../itf/vocabulary.ts";
import { loadCorpus } from "../golden/corpus.ts";
import { replayStep, type Picks } from "./replay.ts";
import { CONFIGS } from "./configs.ts";

const GOLDEN_DIR = join(import.meta.dirname, "..", "golden");

interface Row {
  readonly name: string;
  readonly instance: string;
  readonly steps: number;
}

function rows(): readonly Row[] {
  return (
    JSON.parse(readFileSync(join(GOLDEN_DIR, "manifest.json"), "utf8")) as {
      goldens: Row[];
    }
  ).goldens;
}

/**
 * Every label the corpus carries but `init`, which the initial state writes and
 * no decider produces. Derived rather than listed, so a label the corpus gains
 * becomes a replay obligation instead of silence.
 */
function decidedLabels(): ReadonlySet<string> {
  const carried = new Set(loadCorpus().firedAcross().labels);
  carried.delete("init");
  return carried;
}

/** The action a state records, which `--mbt` writes as a bare string beside the picks. */
function actionOf(state: ItfState): string {
  const action = stateValue(state, "mbt::actionTaken");
  if (typeof action !== "string") {
    throw new Error(
      `replay: state ${String(state.index)} records no action name`,
    );
  }
  return action;
}

/** `mbt::nondetPicks` is a record of options; an absent draw is `None`. */
function picksOf(state: ItfState): Picks {
  const raw = stateValue(state, "mbt::nondetPicks");
  const some = (name: string): ItfValue | undefined => {
    const option = field(raw, name);
    if (
      typeof option !== "object" ||
      Array.isArray(option) ||
      option.kind !== "variant"
    ) {
      throw new Error(`replay: pick ${name} is not an option`);
    }
    return option.tag === "Some" ? option.value : undefined;
  };
  return {
    ticket: some("j"),
    deps: some("deps_"),
    program: some("prog"),
    project: some("project_"),
    wrapUp: some("wrapUp_"),
    taskId: some("tid"),
    verdict: some("v"),
    moved: some("moved"),
    outcome: some("out"),
    decodeVerdict,
    decodeWrapUpOutcome,
  };
}

test("every golden step replays through this implementation's deciders", () => {
  let steps = 0;
  const labels = new Set<string>();
  for (const row of rows()) {
    const config = CONFIGS[row.instance];
    assert.ok(config, `${row.instance} has no configuration declared`);
    const raw = JSON.parse(
      readFileSync(join(GOLDEN_DIR, `${row.name}.itf.json`), "utf8"),
    ) as {
      states: Record<string, unknown>[];
    };
    const trace = decodeTrace(raw);
    const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
    const stepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
    assert.ok(
      ticketsVar && stepVar,
      `${row.name}: the state variables are not in this trace`,
    );

    for (let i = 1; i < trace.states.length; i++) {
      const before = trace.states[i - 1];
      const after = trace.states[i];
      if (!before || !after) continue;
      const action = actionOf(after);
      const pre = decodeCore(stateValue(before, ticketsVar));
      const got = replayStep(config, pre, action, picksOf(after));
      labels.add(got.rec.label);
      assert.deepEqual(
        encodeStepRecord(got.rec),
        raw.states[i]?.[stepVar],
        `${row.name} state ${String(i)} (${action}): the step record diverged`,
      );
      assert.deepEqual(
        encodeCore(got.post),
        raw.states[i]?.[ticketsVar],
        `${row.name} state ${String(i)} (${action}): the post-state diverged`,
      );
      steps++;
    }
  }
  assert.equal(
    steps,
    rows().reduce((n, row) => n + row.steps, 0),
    "the replay did not consume every step the manifest counts",
  );
  assert.deepEqual(
    [...labels].sort(),
    [...decidedLabels()].sort(),
    "the deciders did not produce every label the corpus carries",
  );
});

test("every golden's initial state is the one a fresh core starts from", () => {
  for (const row of rows()) {
    const trace = decodeTrace(
      JSON.parse(
        readFileSync(join(GOLDEN_DIR, `${row.name}.itf.json`), "utf8"),
      ) as unknown,
    );
    const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
    assert.ok(ticketsVar);
    const first = trace.states[0];
    assert.ok(first);
    assert.equal(
      decodeCore(stateValue(first, ticketsVar)).tickets.size,
      0,
      `${row.name}: a run starts with no tickets, because authoring is the only source`,
    );
  }
});
