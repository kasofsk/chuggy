/**
 * Every step of every committed golden, replayed through this implementation's
 * own deciders: the model's `StepRecord` and post-`Core` reproduced exactly,
 * and the whole invariant bundle evaluated on every state either side of it.
 *
 * REPRODUCTION IS EXACT EQUALITY ON THE WHOLE STATE, at the encode boundary,
 * because a spot check is how a dropped field survives. The bundle is the whole
 * of `invariantLeaves` on every state and not a sample of it: an invariant is
 * cheap to evaluate and the expensive thing is a corpus that exercised the
 * cheap ones and left a sweep unrun.
 *
 * WHAT THE BUNDLE ADDS THAT EQUALITY DOES NOT, and it is not what it looks
 * like. Where equality holds, the state under the predicates is the model's own
 * — already proved to satisfy them — so the bundle cannot report a defect in
 * the machine. What it reports is a defect in *this tree's* transcription of
 * the predicates: an invariant that is too strong goes red on a state the
 * specification proved green. S4's demonstrations run the other way, each
 * showing a predicate red on a state carrying its defect, and neither direction
 * substitutes for the other.
 *
 * A LEAF THAT CANNOT BE ASKED IS NAMED RATHER THAN THROWN, which `evaluate.ts`
 * is for: the states where a report matters most are the ones a wrong decider
 * built, and those are exactly the states a walk over the dependency closure
 * falls over on.
 *
 * IT SAYS NOTHING ABOUT THE ENABLEMENT PREDICATES, and cannot. A replayer
 * routes on the action the trace recorded, because the golden's existence is
 * the guarantee that the action was enabled; no guard is ever consulted, so a
 * guard that drifted replays green on every step. Their evidence is
 * `test/domain/enablement.test.ts`, and the decider arms no committed trace
 * reaches are `test/domain/deciders.test.ts`.
 *
 * IT READS THE CORPUS AND NEVER WRITES IT. `.chug/tasks/emit-goldens.sh` is the
 * one thing that writes a golden, because a job that can rewrite its own
 * expected output is not a check; `CHUG_GOLDEN_DIR` moves what is read and
 * nothing here opens a file for writing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { Config } from "../../src/domain/config.ts";
import type { Decision } from "../../src/domain/core.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  decodeTrace,
  field,
  stateValue,
  type ItfState,
  type ItfTrace,
  type ItfValue,
} from "../itf/decode.ts";
import {
  decodeCore,
  decodeStepRecord,
  decodeVerdict,
  decodeWrapUpOutcome,
  encodeCore,
  encodeStepRecord,
} from "../itf/vocabulary.ts";
import { CONFIGS } from "../domain/configs.ts";
import { replayStep, type Picks } from "./dispatch.ts";
import { bundleHolds, evaluateBundle, type BundleVerdict } from "./evaluate.ts";

/** The corpus under test, which the gate's own suite points elsewhere. */
const GOLDEN_DIR =
  process.env["CHUG_GOLDEN_DIR"] ?? join(import.meta.dirname, "..", "golden");

/** How many findings are printed in full before the rest are counted. */
const DETAILED = 3;

interface Row {
  readonly name: string;
  readonly instance: string;
  readonly steps: number;
}

interface Golden {
  readonly row: Row;
  readonly raw: { states: Record<string, unknown>[] };
  readonly trace: ItfTrace;
  readonly ticketsVar: string;
  readonly stepVar: string;
}

/** One thing that is wrong, at the place a reader has to open to see it. */
interface Finding {
  readonly where: string;
  readonly what: string;
  readonly detail: readonly string[];
}

/** What one whole pass over the corpus accumulates. */
interface Run {
  readonly findings: Finding[];
  readonly decided: Set<string>;
  readonly carried: Set<string>;
  steps: number;
  evaluated: number;
}

function rows(): readonly Row[] {
  const doc = JSON.parse(
    readFileSync(join(GOLDEN_DIR, "manifest.json"), "utf8"),
  ) as { goldens?: unknown };
  const goldens: readonly Row[] = Array.isArray(doc.goldens)
    ? (doc.goldens as readonly Row[])
    : [];
  if (goldens.length === 0) {
    throw new Error(`replay: ${GOLDEN_DIR}/manifest.json lists no goldens`);
  }
  return goldens;
}

function loadGolden(row: Row): Golden {
  const raw = JSON.parse(
    readFileSync(join(GOLDEN_DIR, `${row.name}.itf.json`), "utf8"),
  ) as { states: Record<string, unknown>[] };
  const trace = decodeTrace(raw);
  const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
  const stepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  if (ticketsVar === undefined || stepVar === undefined) {
    throw new Error(
      `replay: ${row.name}: the state variables are not in this trace`,
    );
  }
  return { row, raw, trace, ticketsVar, stepVar };
}

function stateAt(golden: Golden, index: number): ItfState {
  const state = golden.trace.states[index];
  if (state === undefined) {
    throw new Error(`replay: ${golden.row.name} has no state ${String(index)}`);
  }
  return state;
}

/** The golden's own encoding of one variable, which is what a replay is compared against. */
function rawAt(golden: Golden, index: number, name: string): unknown {
  const state = golden.raw.states[index];
  if (state === undefined) {
    throw new Error(`replay: ${golden.row.name} has no state ${String(index)}`);
  }
  return state[name];
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

/** The label a state's own record carries, read off the golden rather than replayed. */
function labelAt(golden: Golden, index: number): string {
  const label = field(
    stateValue(stateAt(golden, index), golden.stepVar),
    "label",
  );
  if (typeof label !== "string") {
    throw new Error(
      `replay: ${golden.row.name} state ${String(index)}: no label`,
    );
  }
  return label;
}

/**
 * An ITF value in the vocabulary a reader has in their head, because a
 * divergence read out of the wire tagging is a divergence nobody reads.
 */
function terse(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(terse).join(", ")}]`;
  const record = value as Record<string, unknown>;
  const literal = record["#bigint"];
  if (typeof literal === "string") return literal;
  return terseContainer(record);
}

/** The tagged shapes: a set, a tuple, a map, a variant, or a plain record. */
function terseContainer(record: Record<string, unknown>): string {
  const set = record["#set"];
  if (Array.isArray(set)) return `{${set.map(terse).join(", ")}}`;
  const tuple = record["#tup"];
  if (Array.isArray(tuple)) {
    return tuple.length === 0 ? "" : `(${tuple.map(terse).join(", ")})`;
  }
  const map = record["#map"];
  if (Array.isArray(map)) return `[${map.map(terseEntry).join(", ")}]`;
  const tag = record["tag"];
  if (typeof tag === "string") {
    const payload = terse(record["value"]);
    return payload === "" ? tag : `${tag}(${payload})`;
  }
  return `{${Object.entries(record)
    .map(([name, held]) => `${name}: ${terse(held)}`)
    .join(", ")}}`;
}

function terseEntry(pair: unknown): string {
  return Array.isArray(pair) && pair.length === 2
    ? `${terse(pair[0])} -> ${terse(pair[1])}`
    : terse(pair);
}

/** An encoded ticket map, keyed by the id its entry carries. */
function ticketsOf(encoded: unknown): ReadonlyMap<string, unknown> {
  const entries = (encoded as { "#map"?: unknown } | null)?.["#map"];
  const out = new Map<string, unknown>();
  if (!Array.isArray(entries)) return out;
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const key = (pair[0] as { "#bigint"?: unknown } | null)?.["#bigint"];
    out.set(typeof key === "string" ? key : JSON.stringify(pair[0]), pair[1]);
  }
  return out;
}

/** The named fields of an encoded ticket, or nothing if it is not one. */
function fieldsOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Only the fields that differ, so a divergence points at a field rather than at a value. */
function fieldDiff(subject: string, got: unknown, want: unknown): string[] {
  const mine = fieldsOf(got);
  const theirs = fieldsOf(want);
  const names = [
    ...new Set([...Object.keys(mine), ...Object.keys(theirs)]),
  ].sort();
  const rows = names.flatMap((name) =>
    isDeepStrictEqual(mine[name], theirs[name])
      ? []
      : [
          `  ${subject} ${name}: replayed ${terse(mine[name])}, golden ${terse(theirs[name])}`,
        ],
  );
  return rows.length > 0
    ? rows
    : [
        `  ${subject} replayed: ${terse(got)}`,
        `  ${subject} golden  : ${terse(want)}`,
      ];
}

/** Only the tickets that differ, so a divergence points at a ticket rather than at a state. */
function coreDiff(got: unknown, want: unknown): string[] {
  const mine = ticketsOf(got);
  const theirs = ticketsOf(want);
  const ids = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
  return ids.flatMap((id) => {
    if (mine.has(id) !== theirs.has(id)) {
      return [
        `  ticket ${id} is only in the ${mine.has(id) ? "replay" : "golden"}`,
      ];
    }
    return isDeepStrictEqual(mine.get(id), theirs.get(id))
      ? []
      : fieldDiff(`ticket ${id}`, mine.get(id), theirs.get(id));
  });
}

/** One line per ticket, which is how a whole state stays readable in a report. */
function coreLines(label: string, encoded: unknown): string[] {
  return [...ticketsOf(encoded)].map(
    ([id, ticket]) => `  ${label} ticket ${id}: ${terse(ticket)}`,
  );
}

/** Where a finding is, in the terms a reader opens the corpus with. */
function siteOf(golden: Golden, index: number, action: string): string {
  return `${golden.row.name} state ${String(index)} (${action})`;
}

function recordFinding(
  golden: Golden,
  index: number,
  action: string,
  decision: Decision,
): readonly Finding[] {
  const got = encodeStepRecord(decision.rec);
  const want = rawAt(golden, index, golden.stepVar);
  if (isDeepStrictEqual(got, want)) return [];
  return [
    {
      where: siteOf(golden, index, action),
      what: "the step record diverged",
      detail: fieldDiff("record", got, want),
    },
  ];
}

function coreFinding(
  golden: Golden,
  index: number,
  action: string,
  decision: Decision,
): readonly Finding[] {
  const got = encodeCore(decision.post);
  const want = rawAt(golden, index, golden.ticketsVar);
  if (isDeepStrictEqual(got, want)) return [];
  return [
    {
      where: siteOf(golden, index, action),
      what: "the post-state diverged",
      detail: coreDiff(got, want),
    },
  ];
}

/** What went wrong, leaf by leaf: the ones that answered no, then the ones that could not answer. */
function bundleWhat(verdict: BundleVerdict): string {
  const parts: string[] = [];
  if (verdict.failed.length > 0) {
    parts.push(`came back false: ${verdict.failed.join(", ")}`);
  }
  if (verdict.refused.length > 0) {
    parts.push(`could not be asked: ${verdict.refused.join(", ")}`);
  }
  return `these invariants ${parts.join("; ")}`;
}

/**
 * The bundle over one state, named leaf by leaf. The previous state is pointed
 * at rather than printed: it is the state before this one in the file named.
 */
function bundleFinding(
  golden: Golden,
  index: number,
  action: string,
  view: StepView,
  config: Config,
): readonly Finding[] {
  const verdict = evaluateBundle(config, view);
  if (bundleHolds(verdict)) return [];
  const where = `${GOLDEN_DIR}/${golden.row.name}.itf.json`;
  return [
    {
      where: siteOf(golden, index, action),
      what: bundleWhat(verdict),
      detail: [
        `  record: ${terse(encodeStepRecord(view.rec))}`,
        ...coreLines("post", encodeCore(view.post)),
        index === 0
          ? "  pre is this same state, which is what an initial state means"
          : `  pre is state ${String(index - 1)} of ${where}`,
      ],
    },
  ];
}

/** The initial state: no decider produced it, so the bundle is all there is to ask. */
function checkInit(golden: Golden, config: Config, run: Run): void {
  const post = decodeCore(stateValue(stateAt(golden, 0), golden.ticketsVar));
  const rec = decodeStepRecord(stateValue(stateAt(golden, 0), golden.stepVar));
  run.evaluated++;
  run.findings.push(
    ...bundleFinding(golden, 0, "init", { pre: post, rec, post }, config),
  );
}

function checkStep(
  golden: Golden,
  config: Config,
  index: number,
  run: Run,
): void {
  const after = stateAt(golden, index);
  const action = actionOf(after);
  const pre = decodeCore(
    stateValue(stateAt(golden, index - 1), golden.ticketsVar),
  );
  const decision = replayStep(config, pre, action, picksOf(after));
  run.steps++;
  run.decided.add(decision.rec.label);
  run.findings.push(
    ...recordFinding(golden, index, action, decision),
    ...coreFinding(golden, index, action, decision),
  );
  run.evaluated++;
  const view: StepView = { pre, rec: decision.rec, post: decision.post };
  run.findings.push(...bundleFinding(golden, index, action, view, config));
}

function replayGolden(golden: Golden, config: Config, run: Run): void {
  checkInit(golden, config, run);
  run.carried.add(labelAt(golden, 0));
  for (let index = 1; index < golden.trace.states.length; index++) {
    run.carried.add(labelAt(golden, index));
    checkStep(golden, config, index, run);
  }
}

function report(run: Run): string {
  if (run.findings.length === 0) return "";
  const shown = run.findings
    .slice(0, DETAILED)
    .flatMap((finding) => [
      `${finding.where}: ${finding.what}`,
      ...finding.detail,
    ]);
  const rest = run.findings.length - DETAILED;
  const tail =
    rest > 0 ? [`and ${String(rest)} further finding(s) not printed`] : [];
  return [
    `the replay found ${String(run.findings.length)} finding(s) against the committed corpus:`,
    ...shown,
    ...tail,
  ].join("\n");
}

function replayCorpus(): Run {
  const run: Run = {
    findings: [],
    decided: new Set(),
    carried: new Set(),
    steps: 0,
    evaluated: 0,
  };
  for (const row of rows()) {
    const config = CONFIGS[row.instance];
    assert.ok(config, `${row.name}: ${row.instance} has no configuration here`);
    replayGolden(loadGolden(row), config, run);
  }
  return run;
}

/**
 * One pass, shared by the cases below. It runs inside the first case rather than
 * at module scope so a decoder that gives up is reported as a failing test.
 */
let pass: Run | undefined;
function corpusRun(): Run {
  pass ??= replayCorpus();
  return pass;
}

test("every golden step reproduces the model's step, and every state holds the bundle", () => {
  const run = corpusRun();
  assert.ok(run.findings.length === 0, report(run));
});

test("the replay consumed every step and every state the manifest accounts for", () => {
  const run = corpusRun();
  const steps = rows().reduce((n, row) => n + row.steps, 0);
  assert.equal(
    run.steps,
    steps,
    "the replay did not consume every step the manifest counts",
  );
  assert.equal(
    run.evaluated,
    steps + rows().length,
    "the bundle was not evaluated on every state, initial states included",
  );
});

test("the deciders produced every label the corpus carries", () => {
  const carried = new Set(corpusRun().carried);
  carried.delete("init");
  assert.deepEqual([...corpusRun().decided].sort(), [...carried].sort());
});

test("every golden's initial state is the one a fresh core starts from", () => {
  for (const row of rows()) {
    const golden = loadGolden(row);
    assert.equal(
      decodeCore(stateValue(stateAt(golden, 0), golden.ticketsVar)).tickets
        .size,
      0,
      `${row.name}: a run starts with no tickets, because authoring is the only source`,
    );
  }
});
