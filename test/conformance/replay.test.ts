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
 * like. The states under the predicates are the model's own output, which is
 * weaker than states proved to satisfy them: what stands behind
 * `allInvariants` is the unseeded randomized run `.chug/tasks/check-model.sh`
 * makes over the full-roster instances, plus the witness and refinement suites,
 * which assert it at every step of the particular traces they walk. There is no
 * `quint verify` in this tree and no inductive proof, and the rows emitted under
 * `model/mc/mc_chuggy_directed.qnt`'s restricted step relation are longer than
 * that run's step bound. So a red bundle is a disagreement between this tree's
 * transcription and the specification, and the transcription is where to look
 * first — an invariant that is too strong goes red on a state the specification
 * sampled green, which is the direction the invariant make-it-red
 * demonstrations cannot reach, each of those showing a predicate red on a
 * state carrying its defect. On a state
 * from a directed emitter it is also the first evaluation the bundle has ever
 * had there, so a reading against the specification stays open until the
 * transcription is cleared.
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
 *
 * IT RECONCILES THE DIRECTORY AGAINST THE MANIFEST, which `test/golden/`'s own
 * coverage suite also does and for a different corpus. That one reads the
 * committed directory by construction; this one reads whatever `CHUG_GOLDEN_DIR`
 * points at, which is what the gate's suite hands it. Without the case here, a
 * corpus holding a golden no row names replays whatever the manifest happens to
 * list and the gate reports a clean sweep of the rest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { Config } from "../../src/domain/config.ts";
import type { Decision } from "../../src/domain/core.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  decodeTrace,
  decodeValue,
  encodeValue,
  field,
  stateValue,
  type ItfMap,
  type ItfRecord,
  type ItfSet,
  type ItfState,
  type ItfTrace,
  type ItfTuple,
  type ItfValue,
  type ItfVariant,
} from "../itf/decode.ts";
import {
  decodeCore,
  decodeStepRecord,
  encodeCore,
  encodeStepRecord,
} from "../itf/vocabulary.ts";
import { CONFIGS } from "../domain/configs.ts";
import { replayStep, type Picks } from "./dispatch.ts";
import { bundleHolds, evaluateBundle, type BundleVerdict } from "./evaluate.ts";

/** The corpus under test, which the gate's own suite points elsewhere. */
const GOLDEN_DIR =
  process.env["CHUG_GOLDEN_DIR"] ?? join(import.meta.dirname, "..", "golden");

/** The floor on how many findings are printed in full; every kind gets one. */
const DETAILED = 3;

/** What a golden file is called, once, so the reconciliation below can strip it. */
const SUFFIX = ".itf.json";

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

/**
 * One thing that is wrong, at the place a reader has to open to see it. `kind`
 * is what the report groups by, and is deliberately coarser than `what`: two
 * findings of one kind differ in which ticket or which leaf they name, and a
 * reader who has read the first has read the shape.
 */
interface Finding {
  readonly kind: string;
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
    readFileSync(join(GOLDEN_DIR, `${row.name}${SUFFIX}`), "utf8"),
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

/** Whether the run recorded this draw at all, as against recording it absent. */
function recorded(raw: ItfValue, name: string): boolean {
  return (
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.kind === "record" &&
    raw.fields.has(name)
  );
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

/**
 * `mbt::nondetPicks` is a record of options; an absent draw is `None`. A pick
 * the run's own roster never draws is absent from the record entirely, which is
 * how a directed emitter's traces carry no draw for the actions it dropped.
 */
function picksOf(state: ItfState): Picks {
  const raw = stateValue(state, "mbt::nondetPicks");
  const some = (name: string): ItfValue | undefined => {
    if (!recorded(raw, name)) return undefined;
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
    workFanout: some("workFanout_"),
    reworkPolicy: some("reworkPolicy_"),
    finalizationPricing: some("finalizationPricing_"),
    resumePricing: some("resumePricing_"),
    finalizer: some("finalizer_"),
    taskId: some("tid"),
    verdict: some("v"),
    outcome: some("out"),
    reason: some("why"),
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
  return terseValue(decodeValue(value));
}

function terseValue(value: ItfValue): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(terseValue).join(", ")}]`;
  return terseContainer(value);
}

/** The decoded containers: a set, a tuple, a map, a variant, or a record. */
function terseContainer(
  value: ItfMap | ItfRecord | ItfSet | ItfTuple | ItfVariant,
): string {
  switch (value.kind) {
    case "set":
      return `{${value.elements.map(terseValue).join(", ")}}`;
    case "tuple":
      return value.elements.length === 0
        ? ""
        : `(${value.elements.map(terseValue).join(", ")})`;
    case "map":
      return `[${value.entries.map(terseEntry).join(", ")}]`;
    case "variant": {
      const payload = terseValue(value.value);
      return payload === "" ? value.tag : `${value.tag}(${payload})`;
    }
    case "record":
      return `{${[...value.fields]
        .map(([name, held]) => `${name}: ${terseValue(held)}`)
        .join(", ")}}`;
  }
}

function terseEntry([key, held]: readonly [ItfValue, ItfValue]): string {
  return `${terseValue(key)} -> ${terseValue(held)}`;
}

/** A field one side does not carry, printed as the absence it is. */
function terseField(value: ItfValue | undefined): string {
  return value === undefined ? "(absent)" : terseValue(value);
}

/** An encoded ticket map, decoded and keyed by the id its entry carries. */
function ticketsOf(encoded: unknown): ReadonlyMap<string, ItfValue> {
  const decoded = decodeValue(encoded);
  const out = new Map<string, ItfValue>();
  if (
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    decoded.kind !== "map"
  ) {
    return out;
  }
  for (const [key, ticket] of decoded.entries) {
    out.set(typeof key === "bigint" ? key.toString() : terseValue(key), ticket);
  }
  return out;
}

/** The named fields of a decoded ticket, or nothing if it is not one. */
function fieldsOf(value: ItfValue | undefined): ReadonlyMap<string, ItfValue> {
  return typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "record"
    ? value.fields
    : new Map<string, ItfValue>();
}

/** Only the fields that differ, so a divergence points at a field rather than at a value. */
function fieldDiff(
  subject: string,
  got: ItfValue | undefined,
  want: ItfValue | undefined,
): string[] {
  const mine = fieldsOf(got);
  const theirs = fieldsOf(want);
  const names = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
  const rows = names.flatMap((name) =>
    isDeepStrictEqual(mine.get(name), theirs.get(name))
      ? []
      : [
          `  ${subject} ${name}: replayed ${terseField(mine.get(name))}, golden ${terseField(theirs.get(name))}`,
        ],
  );
  return rows.length > 0
    ? rows
    : [
        `  ${subject} replayed: ${terseField(got)}`,
        `  ${subject} golden  : ${terseField(want)}`,
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
    ([id, ticket]) => `  ${label} ticket ${id}: ${terseValue(ticket)}`,
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
  const got = encodeValue(encodeStepRecord(decision.rec));
  const want = rawAt(golden, index, golden.stepVar);
  if (isDeepStrictEqual(got, want)) return [];
  return [
    {
      kind: "record",
      where: siteOf(golden, index, action),
      what: "the step record diverged",
      detail: fieldDiff("record", decodeValue(got), decodeValue(want)),
    },
  ];
}

function coreFinding(
  golden: Golden,
  index: number,
  action: string,
  decision: Decision,
): readonly Finding[] {
  const got = encodeValue(encodeCore(decision.post));
  const want = rawAt(golden, index, golden.ticketsVar);
  if (isDeepStrictEqual(got, want)) return [];
  return [
    {
      kind: "post-state",
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
  const where = `${GOLDEN_DIR}/${golden.row.name}${SUFFIX}`;
  return [
    {
      kind: "bundle",
      where: siteOf(golden, index, action),
      what: bundleWhat(verdict),
      detail: [
        `  record: ${terse(encodeValue(encodeStepRecord(view.rec)))}`,
        ...coreLines("post", encodeValue(encodeCore(view.post))),
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

/**
 * The first finding of each distinct kind, then the rest in corpus order. Two
 * independent defects are the case worth printing for, and in corpus order the
 * commoner one fills the report and the other is counted rather than shown —
 * which reads as one defect and sends the reader back for a second run.
 */
function inPrintOrder(findings: readonly Finding[]): readonly Finding[] {
  const seen = new Set<string>();
  const first: Finding[] = [];
  const rest: Finding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.kind)) rest.push(finding);
    else {
      seen.add(finding.kind);
      first.push(finding);
    }
  }
  return [...first, ...rest];
}

function report(run: Run): string {
  if (run.findings.length === 0) return "";
  const kinds = new Set(run.findings.map((finding) => finding.kind)).size;
  const detailed = Math.max(DETAILED, kinds);
  const shown = inPrintOrder(run.findings)
    .slice(0, detailed)
    .flatMap((finding) => [
      `${finding.where}: ${finding.what}`,
      ...finding.detail,
    ]);
  const rest = run.findings.length - detailed;
  const tail =
    rest > 0 ? [`and ${String(rest)} further finding(s) not printed`] : [];
  const ordering = kinds > 1 ? ", one of each kind first" : "";
  return [
    `the replay found ${String(run.findings.length)} finding(s) against the committed corpus${ordering}:`,
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

test("what the replay consumed is the whole corpus in the directory", () => {
  const named = new Set(rows().map((row) => row.name));
  const found = readdirSync(GOLDEN_DIR)
    .filter((entry) => entry.endsWith(SUFFIX))
    .map((entry) => entry.slice(0, -SUFFIX.length));
  for (const golden of found) {
    assert.ok(
      named.has(golden),
      `${golden}${SUFFIX} is in ${GOLDEN_DIR} with no manifest row, so nothing replayed it`,
    );
  }
  for (const row of named) {
    assert.ok(
      found.includes(row),
      `manifest row ${row} names a golden ${GOLDEN_DIR} does not hold`,
    );
  }
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
