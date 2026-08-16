/**
 * THE CORPUS ON DISK: the manifest, the fixture files, and the one place that
 * reads either.
 *
 * WHY IT IS UNDER `src/` AND NOT BESIDE THE GATES. Everything in this directory
 * touches the filesystem, so none of it may live under `src/domain/` — that is
 * the purity rule, and the module graph enforces it. What decides the rest is
 * reach: `tsconfig.json` includes `src/**` and `eslint.config.js` type-checks
 * the same tree, so a tool written here is strictly typed and type-aware
 * linted, and one written in `.chug/tasks/` beside the shell gates would be
 * neither. A regeneration tool that silently mis-parses its own manifest is
 * exactly the failure this corpus cannot afford, so it goes where the
 * toolchain can see it. `src/spine/` stays free of every import below.
 *
 * THE MANIFEST IS THE PROVENANCE, one entry per committed fixture: the command
 * that regenerates it (an instance and a seeded search for tier 1, a module and
 * a run for tier 2), the consts the machine it speaks about was instantiated
 * at, and how many states the emitted trace has.
 *
 * THAT LAST FIELD IS DERIVED, WHICH THIS HEADER USED TO FORBID OUTRIGHT, and
 * the rule it broke is worth restating before the exception: a derived figure
 * in a hand-edited file is a figure that goes stale without anything noticing.
 * `states` is the one figure that cannot, because it is compared against the
 * decoded trace on every replay — the emitter WRITES it, the gate CHECKS it,
 * and a disagreement is a finding naming the fixture.
 *
 * WHAT IT IS AND IS NOT, SAID EXACTLY, because the difference is easy to
 * mis-read as strength it does not have. It is a TWO-FILE CONSISTENCY check,
 * not integrity against the model: a fixture truncated and its count edited to
 * match passes green, and correctly so — nothing here can tell that pair from a
 * regeneration whose search found a shorter trace, and only re-running the
 * emitter could. What the pin buys is that the corruption stops being a
 * ONE-FILE edit, which is the shape a hand truncation actually has and the
 * shape the trace itself cannot report (`itf.ts` checks each state's
 * `#meta.index`, so only the LAST state can go without a decode failure).
 * `.chug/tasks/check-conformance.sh` carries the same sentence in its list of
 * what it cannot see. What it buys is the one
 * corruption the trace itself cannot report: `itf.ts` checks each state's
 * `#meta.index` against its position, so a state removed from the MIDDLE is a
 * decode failure, and a state removed from the END leaves a dense, ascending,
 * perfectly readable shorter trace. The committed corpus holds fixtures whose
 * `pins` are all reached before their last state, so truncating one of those was
 * measured to pass the whole gate at exit 0. No coverage claim has joined it: a claim about what
 * a fixture REACHES is `pins`, checked against the replay, and a count of
 * states is not one.
 *
 * WHY THE TIER-1 HALF IS NOT ROSTER-MINIMAL, measured rather than assumed. Six
 * of its fixtures could be dropped with every decider, label and exemption arm
 * still covered — the panel measured exactly that — and they are kept, because
 * those three rosters are not the only thing a tier-1 trace carries:
 *
 *   1. IT CARRIES THE DECISION EVENT. Tier 2 has no picks at all, so the
 *      `--mbt` decode path is exercised by tier-1 fixtures alone, and its
 *      binder roster is a fourth obligation the gate now checks by name. It is
 *      not implied by the other three: `out` — the gate resolution's outcome
 *      draw — is bound by exactly two fixtures, and dropping both leaves that
 *      decode arm covered by nothing while every decider, label and exemption
 *      arm stays covered. (Not every roster: one of the two is the only
 *      tier-1 entry on the DeadlineOnly instance, so the instance obligation
 *      reds as well — which is also what makes the droppable set exactly six
 *      rather than larger. The binder roster is the one that has no other
 *      guardian.) That is measured, and `coverageGaps` is what keeps it so.
 *   2. IT IS THE GROUND TRUTH FOR THE TIER-2 RECONSTRUCTION.
 *      `src/spine/decode.test.ts` reconstructs every tier-1 trace with its
 *      decision events hidden and requires the same commands back. That case
 *      is only as wide as the tier-1 corpus, so each fixture dropped is a
 *      label whose reconstruction is checked by replay alone.
 *
 * The trade is bytes against those two, and the corpus is small enough that
 * the bytes are not the constraint. A fixture whose only claim is a roster
 * entry another fixture already covers, and whose picks and labels are covered
 * too, has no argument for staying — which is what `pins` makes visible.
 *
 * THE CONSTS ARE CHECKED AGAINST THE MODEL, not taken on trust, and that check
 * is the corpus's staleness alarm. A committed trace is a trace of the machine
 * `model/` described WHEN IT WAS EMITTED; if an instance's consts move
 * upstream, every fixture goes on replaying green against a machine that no
 * longer exists. Reading the model's own const block and comparing it to the
 * manifest is what turns that silence into a red gate. It is a text parse of a
 * stable declaration, and a parse that fails is reported as could-not-run
 * rather than guessed at.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { messageOf } from "../domain/assert.ts";
import type { Config } from "../domain/domain.ts";
import {
  mcInstances,
  pinnableEntries,
  type McInstance,
} from "../spine/coverage.ts";

/** Raised when the corpus cannot be read or believed — a could-not-run, never a finding. */
export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusError";
  }
}

/**
 * A tier-1 fixture: a seeded, budgeted search on one mc instance, under `--mbt`.
 *
 * EVERY ONE OF THEM IS A VIOLATION SEARCH TODAY, and the vocabulary below is
 * wider than the corpus. `expect` admits `"ok"` — a plain walk that finds
 * nothing, which is the sampled-walk modality the trace mechanism describes —
 * and no committed fixture uses it, so that arm of the emitter's exit-code
 * comparison is exercised by nothing and the modality has no representative
 * here. That is a consequence of what a fixture is FOR rather than an
 * oversight: a corpus entry earns its place by REACHING something (`pins` is
 * the checked claim), and a search that found nothing reaches nothing to pin —
 * the trace it writes is the prefix the search happened to stop at. The
 * sampled-walk modality is covered instead by `src/spine/randomized.test.ts`,
 * which walks the same instances at the same consts and asserts the bundle
 * after every step, which is what an `"ok"` run is a weaker form of.
 *
 * The vocabulary keeps the arm because the EMITTER needs it: `expect` is the
 * exit code a regeneration must see, and an entry that expected `"ok"` and got
 * a violation is a finding whether or not this corpus holds one.
 */
export type Tier1Fixture = {
  readonly name: string;
  readonly instance: McInstance;
  readonly seed: string;
  readonly maxSamples: number;
  readonly maxSteps: number;
  readonly invariant: string;
  /** What the search must report: a targeted search finds a violation, a plain walk does not. */
  readonly expect: "violation" | "ok";
  readonly consts: Config;
  /** How many states the emitted trace holds — the truncation pin. */
  readonly states: number;
  readonly pins: readonly string[];
  readonly rationale: string;
};

/** A tier-2 fixture: one deterministic witness run, exported by `quint test`. */
export type Tier2Fixture = {
  readonly name: string;
  readonly module: string;
  readonly run: string;
  readonly consts: Config;
  /** How many states the emitted trace holds — the truncation pin. */
  readonly states: number;
  readonly pins: readonly string[];
  readonly rationale: string;
};

export type Manifest = {
  readonly tier1: readonly Tier1Fixture[];
  readonly tier2: readonly Tier2Fixture[];
};

export const manifestPath = "corpus/manifest.json";
export const tier1Dir = "corpus/tier1";
export const tier2Dir = "corpus/tier2";

/** Where the tier-1 searches run, and where the tier-2 witness modules live. */
export const mcSource = "model/mc/mc_chuggy.qnt";
export const witnessSource = "model/tests/chuggy_witness_test.qnt";

export function fixturePath(
  fixture: { readonly name: string },
  tier: 1 | 2,
): string {
  return `${tier === 1 ? tier1Dir : tier2Dir}/${fixture.name}.itf.json`;
}

export function readJson(path: string): unknown {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new CorpusError(`${path} cannot be read: ${messageOf(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CorpusError(`${path} is not JSON: ${messageOf(error)}`);
  }
}

// === The manifest ==========================================================

export function loadManifest(): Manifest {
  const raw = object(readJson(manifestPath), manifestPath);
  const tier1 = array(raw["tier1"], `${manifestPath}.tier1`).map((entry, i) =>
    tier1Fixture(entry, `${manifestPath}.tier1[${String(i)}]`),
  );
  const tier2 = array(raw["tier2"], `${manifestPath}.tier2`).map((entry, i) =>
    tier2Fixture(entry, `${manifestPath}.tier2[${String(i)}]`),
  );
  const names = [...tier1, ...tier2].map((f) => f.name);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new CorpusError(`${manifestPath}: two fixtures are named ${name}`);
    }
    seen.add(name);
  }
  if (tier1.length === 0 || tier2.length === 0) {
    throw new CorpusError(
      `${manifestPath}: the corpus is two-tier, and one tier is empty`,
    );
  }
  return { tier1, tier2 };
}

function tier1Fixture(raw: unknown, at: string): Tier1Fixture {
  const entry = object(raw, at);
  const instance = str(entry["instance"], `${at}.instance`);
  const known = mcInstances.find((i) => i === instance);
  if (known === undefined) {
    throw new CorpusError(
      `${at}.instance: ${instance} is outside [${mcInstances.join(", ")}]`,
    );
  }
  const expect = str(entry["expect"], `${at}.expect`);
  if (expect !== "violation" && expect !== "ok") {
    throw new CorpusError(
      `${at}.expect: expected violation or ok, got ${expect}`,
    );
  }
  return {
    name: name(entry["name"], `${at}.name`),
    instance: known,
    seed: str(entry["seed"], `${at}.seed`),
    maxSamples: count(entry["maxSamples"], `${at}.maxSamples`),
    maxSteps: count(entry["maxSteps"], `${at}.maxSteps`),
    invariant: str(entry["invariant"], `${at}.invariant`),
    expect,
    consts: consts(entry["consts"], `${at}.consts`),
    states: count(entry["states"], `${at}.states`),
    pins: pins(entry["pins"], `${at}.pins`),
    rationale: str(entry["rationale"], `${at}.rationale`),
  };
}

function tier2Fixture(raw: unknown, at: string): Tier2Fixture {
  const entry = object(raw, at);
  return {
    name: name(entry["name"], `${at}.name`),
    module: str(entry["module"], `${at}.module`),
    run: str(entry["run"], `${at}.run`),
    consts: consts(entry["consts"], `${at}.consts`),
    states: count(entry["states"], `${at}.states`),
    pins: pins(entry["pins"], `${at}.pins`),
    rationale: str(entry["rationale"], `${at}.rationale`),
  };
}

/**
 * THE FIXTURE'S CHECKED CLAIM about what it is in the corpus for: roster
 * entries it must be observed to reach, verified against its own replay rather
 * than believed.
 *
 * It replaces a prose `covers` field, which was the wrong shape for the same
 * sentence: nothing read it, so it could say anything, and a fixture reseeded
 * into no longer reaching the label it was added for would go on claiming it in
 * a file nobody re-reads. `rationale` beside it is still prose and is still
 * read by nothing — which is why it is named for what it is.
 *
 * An entry outside the three trace-observable rosters is refused here, so a
 * pin cannot be satisfied by a typo nothing could ever cover.
 */
function pins(raw: unknown, at: string): readonly string[] {
  const entries = array(raw, at).map((entry, i) =>
    str(entry, `${at}[${String(i)}]`),
  );
  if (entries.length === 0) {
    throw new CorpusError(
      `${at}: a fixture states what it is in the corpus for`,
    );
  }
  for (const entry of entries) {
    if (!pinnableEntries.includes(entry)) {
      throw new CorpusError(
        `${at}: ${entry} is not a decider, a step label or an exemption arm`,
      );
    }
  }
  return entries;
}

/**
 * Write each fixture's emitted state count back into the manifest — the
 * emitter's half of the truncation pin.
 *
 * IT IS THE ONLY WRITE THIS TREE MAKES TO THE MANIFEST, and it is deliberately
 * a field update rather than a re-authoring: the document is parsed, the named
 * fixtures' `states` are set in place, and everything else is written back as
 * it was read. A fixture the manifest does not name is refused rather than
 * added, because the manifest is where a human declares what the corpus is FOR
 * and this function has no opinion about that.
 *
 * `regenerate, then read the diff` IS STILL THE WORKFLOW. A count that moved
 * shows up in the same diff as the trace that moved, which is the pairing a
 * reader needs: a fixture whose search found a longer trace and a fixture
 * somebody truncated by hand look identical in the corpus and completely
 * different here.
 */
export function writeManifestStateCounts(
  counts: ReadonlyMap<string, number>,
): void {
  const doc = object(readJson(manifestPath), manifestPath);
  const written = new Set<string>();
  for (const tier of ["tier1", "tier2"] as const) {
    for (const raw of array(doc[tier], `${manifestPath}.${tier}`)) {
      const entry = object(raw, `${manifestPath}.${tier}`);
      const named = str(entry["name"], `${manifestPath}.${tier}[].name`);
      const found = counts.get(named);
      if (found === undefined) {
        throw new CorpusError(
          `${manifestPath}: ${named} was not emitted, so its state count is unknown`,
        );
      }
      entry["states"] = found;
      written.add(named);
    }
  }
  for (const named of counts.keys()) {
    if (!written.has(named)) {
      throw new CorpusError(
        `${manifestPath}: ${named} was emitted and the manifest names no fixture for it`,
      );
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/** A fixture name is its file name, so it may hold nothing a path would read. */
function name(raw: unknown, at: string): string {
  const value = str(raw, at);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new CorpusError(
      `${at}: a fixture name is lowercase, digits and dashes, got ${value}`,
    );
  }
  return value;
}

// === The consts ============================================================
// Written in the model's own spelling, so a manifest entry reads against the
// `import chuggy_domain(...)` block it names and the comparison below is
// between two texts rather than between a text and an interpretation.

export const constNames = [
  "N_TICKETS",
  "N_TASKS",
  "REWORK_POLICY",
  "GAS",
  "WRAPUP_PRICING",
  "OP_RETRY_PRICING",
  "MAX_STAGES",
  "N_PROJECTS",
] as const;

export type ModelConsts = Readonly<Record<(typeof constNames)[number], string>>;

function consts(raw: unknown, at: string): Config {
  return configOf(modelConsts(raw, at), at);
}

function modelConsts(raw: unknown, at: string): ModelConsts {
  const entry = object(raw, at);
  const keys = Object.keys(entry).sort();
  const want = [...constNames].sort();
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
    throw new CorpusError(
      `${at}: the consts are [${want.join(", ")}], got [${keys.join(", ")}]`,
    );
  }
  const out: Record<string, string> = {};
  for (const key of constNames) {
    out[key] = String(entry[key]);
  }
  return out as unknown as ModelConsts;
}

/** The model's const spelling into `domain.ts`'s explicit `Config`. */
export function configOf(model: ModelConsts, at: string): Config {
  return {
    nTickets: constInt(model.N_TICKETS, `${at}.N_TICKETS`),
    nTasks: constInt(model.N_TASKS, `${at}.N_TASKS`),
    reworkPolicy: reworkPolicy(model.REWORK_POLICY, `${at}.REWORK_POLICY`),
    gas: constInt(model.GAS, `${at}.GAS`),
    wrapUpPricing: wrapUpPricing(model.WRAPUP_PRICING, `${at}.WRAPUP_PRICING`),
    opRetryPricing: retryPricing(
      model.OP_RETRY_PRICING,
      `${at}.OP_RETRY_PRICING`,
    ),
    maxStages: constInt(model.MAX_STAGES, `${at}.MAX_STAGES`),
    nProjects: constInt(model.N_PROJECTS, `${at}.N_PROJECTS`),
  };
}

function constInt(raw: string, at: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new CorpusError(`${at}: expected a whole number, got ${raw}`);
  }
  return Number(raw);
}

function reworkPolicy(raw: string, at: string): Config["reworkPolicy"] {
  const budget = /^RWBudget\(([0-9]+)\)$/.exec(raw);
  if (budget?.[1] === undefined) {
    throw new CorpusError(`${at}: expected RWBudget(n), got ${raw}`);
  }
  return { tag: "RWBudget", budget: Number(budget[1]) };
}

function wrapUpPricing(raw: string, at: string): Config["wrapUpPricing"] {
  if (raw === "DeadlineOnly") {
    return { tag: "DeadlineOnly" };
  }
  const budgeted = /^Budgeted\(([0-9]+)\)$/.exec(raw);
  if (budgeted?.[1] === undefined) {
    throw new CorpusError(
      `${at}: expected Budgeted(n) or DeadlineOnly, got ${raw}`,
    );
  }
  return { tag: "Budgeted", budget: Number(budgeted[1]) };
}

function retryPricing(raw: string, at: string): Config["opRetryPricing"] {
  if (raw !== "RetryCharged" && raw !== "RetryFree") {
    throw new CorpusError(
      `${at}: expected RetryCharged or RetryFree, got ${raw}`,
    );
  }
  return raw;
}

// === The model's own const block ===========================================

/**
 * The consts a module instantiates `chuggy_domain` at, read out of the Quint
 * source. The declaration is one `import chuggy_domain( … )` inside the named
 * module, and this reads exactly that — a module whose block it cannot find is
 * an error rather than an empty answer, because "no consts" and "consts this
 * parse cannot see" must not report the same.
 *
 * THE SEARCH IS BOUNDED BY THE MODULE IT NAMES. Without that bound there is a
 * fourth outcome the header does not admit and the suite could not see: a
 * module with no instantiation of its own answers with the next module's, and
 * every fixture naming it is then checked against a machine it does not name.
 * The bound is what makes the promise true.
 */
export function readModuleConsts(path: string, module: string): ModelConsts {
  const source = readSource(path);
  const start = source.indexOf(`module ${module} {`);
  if (start < 0) {
    throw new CorpusError(`${path}: no module ${module}`);
  }
  // BOUNDED AT THE NEXT MODULE, which is what makes the missing case the third
  // outcome this function's header promises rather than a silently wrong
  // answer: a module carrying no instantiation of its own would otherwise find
  // the NEXT module's, and the manifest would be checked against consts
  // belonging to a machine it does not name — the staleness alarm reporting
  // green off another instance's numbers. A file's last module has no next
  // one, so the bound is the end of the source.
  const next = source.indexOf("\nmodule ", start);
  const ends = next < 0 ? source.length : next;
  const opened = source.indexOf("import chuggy_domain(", start);
  if (opened < 0 || opened > ends) {
    throw new CorpusError(
      `${path}: module ${module} has no chuggy_domain instantiation of its own`,
    );
  }
  const block = balanced(
    source,
    opened + "import chuggy_domain(".length,
    `${path} module ${module}`,
  );
  const out: Record<string, string> = {};
  for (const assignment of block.split(",")) {
    const parts = /^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/.exec(assignment);
    const key = parts?.[1];
    const value = parts?.[2];
    if (key === undefined || value === undefined) {
      throw new CorpusError(
        `${path}: module ${module}'s const block does not parse at ${JSON.stringify(assignment)}`,
      );
    }
    out[key] = value;
  }
  return modelConsts(out, `${path} module ${module}`);
}

/**
 * The text between an opening parenthesis and the one that closes it, counting
 * depth rather than taking the first close — a const list holds `RWBudget(1)`
 * and `Budgeted(1)`, so the first `)` is inside a value rather than after the
 * last one.
 */
function balanced(source: string, from: number, at: string): string {
  return balancedIn(source, from, "(", ")", `${at}: the const block's`);
}

/**
 * The text between an opening bracket and the one that closes it, counting
 * depth. `balanced` is this over parentheses; the record readers below want it
 * over braces, and a second copy of a depth counter is a second place for an
 * off-by-one to live. `what` names the thing that did not close, because the
 * caller is the only one that knows.
 */
function balancedIn(
  source: string,
  from: number,
  open: string,
  close: string,
  what: string,
): string {
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(from, i);
      }
    }
  }
  throw new CorpusError(
    `${what} ${open === "(" ? "parentheses" : "braces"} do not close`,
  );
}

/** The first const the manifest and the model disagree about, if any. */
export function constsDisagree(
  manifest: Config,
  model: ModelConsts,
  at: string,
): string | undefined {
  const asConfig = configOf(model, at);
  for (const key of Object.keys(manifest) as (keyof Config)[]) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(asConfig[key])) {
      return `${at}.${key}: the manifest says ${JSON.stringify(manifest[key])}, the model says ${JSON.stringify(asConfig[key])}`;
    }
  }
  return undefined;
}

// === Small readers =========================================================

function object(raw: unknown, at: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CorpusError(`${at}: expected an object`);
  }
  return raw as Record<string, unknown>;
}

function array(raw: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(raw)) {
    throw new CorpusError(`${at}: expected an array`);
  }
  return raw as readonly unknown[];
}

function str(raw: unknown, at: string): string {
  if (typeof raw !== "string") {
    throw new CorpusError(`${at}: expected a string`);
  }
  return raw;
}

function count(raw: unknown, at: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1) {
    throw new CorpusError(`${at}: expected a positive whole number`);
  }
  return raw;
}

// === The model's own rosters ===============================================
//
// THE SECOND STALENESS ALARM, and it is the const alarm's argument applied to
// the other thing a manifest-free part of this tree copies out of the model.
// The rosters here are typed out by hand from the model's own sources — the
// deciders, the reachable step labels, the `stepDescends` exemption arms, the
// effect strings, the mc instances, the nondet binder names, the const names,
// the conjuncts of `allInvariants` and of the two refinement bundles, the `Cmd`
// constructors, and the FIELD LISTS of the records a trace is written in — and
// every one of them is a second statement of something the model already says.
// The corpus does not catch a roster going stale: a model PR that adds a
// decider adds no fixture either, so `coverageGaps` finds every rostered entry
// covered and reports nothing, and the whole gate stays green over a machine
// this tree does not describe. The record schemas are the one surface where the
// corpus WOULD have caught it — a regenerated trace carries the moved field and
// the exact-field decode refuses it — and that is no help at all, because
// regeneration is a developer's command and no gate runs it.
//
// WHAT MAKES A SECOND STATEMENT LEGITIMATE, in this tree, is that something
// maintains it. Where the compiler can, it does — `effect.ts`'s `vocabulary`
// and `decode.ts`'s `labels` are `satisfies` clauses over their own unions, and
// `entry.ts`'s field tables are `Record<CmdTag, …>`. What the compiler holds it
// holds against a TypeScript union and never against `model/`: `entry.ts`'s
// table cannot fall behind `cmd.ts`'s `Cmd`, and neither of them can notice the
// model growing an arm. So this is what reaches across the language boundary
// instead: a text read of the Quint source, compared as EXACT SETS in both
// directions by `src/tools/verify.ts`.
//
// IT IS A TEXT PARSE AND IT SAYS SO. Quint has no exported schema this could
// ask, so what follows reads declarations whose spelling the model has held
// since it was written. A parse that finds nothing where a roster must be
// non-empty is reported as could-not-run rather than as an empty roster
// disagreeing with everything — the `readModuleConsts` rule, for the same
// reason: "no entries" and "entries this parse cannot see" must not report the
// same.

/** The module the machine, its labels, its effects and its consts live in. */
export const domainSource = "model/domain.qnt";

/**
 * The module the machine's VOCABULARY lives in: the record and sum declarations
 * every other roster is written in terms of.
 *
 * IT IS READ BECAUSE THE FIELD LISTS ARE COPIED HERE and nothing held them
 * against the declaration. `itf.ts` decodes each record against an exact field
 * set and `entry.ts` states the journal row's schema, both hand-typed from this
 * file; a model-side field rename left both spelling the old name with every
 * gate green, which is how the `landing` → `attempt` rename crossed a whole
 * release. Regenerating the corpus would have caught it — and no gate
 * regenerates, by design.
 */
export const measureSource = "model/measure.qnt";

/**
 * The module the journaled actor lives in: the decision-event vocabulary the
 * spine replays and this layer's own invariants.
 *
 * IT IS READ BECAUSE TWO SURFACES OF IT ARE COPIED HERE and neither is stated
 * in `domain.qnt` at all — a roster read of that file alone left them invisible,
 * and a model-side addition to either passed every gate.
 */
export const refinementSource = "model/refinement.qnt";

/**
 * THE RECORD DECLARATIONS THIS TREE DECODES, by the model's own name for each.
 *
 * It is `StepRecord` and everything a `StepRecord` is made of — the trace
 * vocabulary the whole conformance argument is expressed in — plus the fleet
 * record a trace state carries and `refinement.qnt`'s journal row. `WOAttempt`
 * is the one entry that is not a `type` of its own: it is `WrapUpObs`'s payload
 * arm, read from the arm because that is where the model declares its fields.
 *
 * WHAT IS DELIBERATELY ABSENT, so the omission is a decision rather than a gap.
 * `Core`, `Decision` and `Bounds` are records the model declares and this tree
 * does not decode field-wise: `Core` arrives as a map and is read as one,
 * `Decision` is a decider's return value that no trace carries, and `Bounds` is
 * the measure's parameter record, whose fields `measure.ts` reads through a
 * `Config` this file already compares const by const. A roster entry for any of
 * them would compare a model declaration against nothing.
 */
export const modelRecordNames = [
  "Task",
  "Stage",
  "WOAttempt",
  "Ticket",
  "Transition",
  "StepRecord",
  "Entry",
] as const;

export type ModelRecordName = (typeof modelRecordNames)[number];

/** The hand-maintained rosters, as `model/` actually spells them. */
export type ModelRosters = {
  /** `pure def decide*` in definition order. */
  readonly deciders: readonly string[];
  /** Code literals spelled as a constructor — the effect vocabulary. */
  readonly effects: readonly string[];
  /** Code literals spelled as a step label, the guarded-unreachable one included. */
  readonly stepLabels: readonly string[];
  /** The `stepDescends` roster comment's entries, flavors and all. */
  readonly exemptionArms: readonly string[];
  /** `module mc_chuggy_*` in `mc/mc_chuggy.qnt`. */
  readonly instances: readonly string[];
  /** The names the machine's actions bind with `nondet`. */
  readonly binders: readonly string[];
  /** The module's `const` declarations. */
  readonly consts: readonly string[];
  /** `val allInvariants`' conjuncts — the safety bundle, by name. */
  readonly bundleConjuncts: readonly string[];
  /** `type Cmd`'s constructors, in `model/refinement.qnt`. */
  readonly cmdArms: readonly string[];
  /** `val refinementCore`'s conjuncts, in `model/refinement.qnt`. */
  readonly refinementCoreConjuncts: readonly string[];
  /** `val refinementInvariants`' conjuncts, in `model/refinement.qnt`. */
  readonly refinementBundleConjuncts: readonly string[];
  /**
   * The FIELD LIST of every record declaration this tree decodes, in the
   * model's own declaration order.
   *
   * The twelfth roster, and the one every roster above it is written in:
   * a decider, a label and an effect are all names, while a record is a
   * VOCABULARY, and every hand-typed copy of one in this tree — `itf.ts`'s
   * exact-field decodes, `entry.ts`'s journal schema — was held against
   * nothing at gate time.
   */
  readonly recordFields: Readonly<Record<ModelRecordName, readonly string[]>>;
  /**
   * Code literals neither spelling rule classified, module paths aside.
   *
   * It exists so that the two spelling rules below are a PARTITION rather than
   * two filters: a literal the model grows that is neither an effect nor a
   * label would otherwise be silently absent from both rosters, which is the
   * silence this whole section is against.
   */
  readonly unclassified: readonly string[];
};

export function readModelRosters(): ModelRosters {
  const domainText = readSource(domainSource);
  const domainCode = withoutComments(domainText);
  const refinementCode = withoutComments(readSource(refinementSource));
  const measureCode = withoutComments(readSource(measureSource));
  const literals = codeLiterals(domainCode);
  return {
    deciders: matchesOf(domainCode, /\bpure def (decide[A-Za-z]*)\s*\(/g, {
      at: `${domainSource}: pure def decide*`,
    }),
    // THE SPELLING IS THE MODEL'S OWN AND IT IS STATED AS A RULE, not inferred:
    // every effect the model writes is a constructor name in upper camel case
    // and every step label is lower case with dashes.
    //
    // A MIS-CASED ENTRY IS SORTED INTO THE WRONG ROSTER AND REDS BOTH — absent
    // from the one it belongs to, present-and-unrostered in the one it landed
    // in — which is the alarm firing twice rather than a spelling rule going
    // unchecked. It does NOT reach `unclassified`, which holds only a literal
    // starting with neither case; saying otherwise would name a mutation that
    // does not fire, and a control is only worth what its stated refutation is.
    //
    // Refutation trigger: the partition assumes the model never writes a code
    // literal that is neither an effect nor a label. One that is — a debug
    // string, a tag, a name — lands in `unclassified` and reds this alarm; the
    // fix is a third roster here, not a widened filter.
    effects: literals.filter((text) => /^[A-Z]/.test(text)),
    stepLabels: literals.filter((text) => /^[a-z]/.test(text)),
    unclassified: literals.filter((text) => !/^[A-Za-z]/.test(text)),
    exemptionArms: exemptionRoster(domainText),
    instances: matchesOf(
      readSource(mcSource),
      /^module mc_chuggy_([A-Za-z_]+) \{/gm,
      { at: `${mcSource}: module mc_chuggy_*` },
    ),
    binders: unique(
      matchesOf(domainCode, /\bnondet ([A-Za-z_]+)\s*=/g, {
        at: `${domainSource}: nondet binders`,
      }),
    ),
    consts: matchesOf(domainCode, /^\s*const ([A-Z_]+)\s*:/gm, {
      at: `${domainSource}: const declarations`,
    }),
    bundleConjuncts: conjunctsOf(domainCode, "allInvariants", domainSource),
    cmdArms: sumTypeArms(refinementCode, "Cmd", refinementSource),
    refinementCoreConjuncts: conjunctsOf(
      refinementCode,
      "refinementCore",
      refinementSource,
    ),
    refinementBundleConjuncts: conjunctsOf(
      refinementCode,
      "refinementInvariants",
      refinementSource,
    ),
    recordFields: {
      Task: recordTypeFields(measureCode, "Task", measureSource),
      Stage: recordTypeFields(measureCode, "Stage", measureSource),
      WOAttempt: armRecordFields(measureCode, "WOAttempt", measureSource),
      Ticket: recordTypeFields(measureCode, "Ticket", measureSource),
      Transition: recordTypeFields(measureCode, "Transition", measureSource),
      StepRecord: recordTypeFields(measureCode, "StepRecord", measureSource),
      Entry: recordTypeFields(refinementCode, "Entry", refinementSource),
    },
  };
}

/**
 * The model's three ANTI-VACUITY WITNESSES, by name.
 *
 * THEY ARE NOT INVARIANTS AND THEY ARE NOT IN A BUNDLE, which is why no roster
 * above can see them: `model/domain.qnt` declares each as a plain `val` that is
 * EXPECTED TO BE VIOLATED, so a read of `pure def`s, of code literals, of the
 * safety bundle's conjuncts or of a sum type's arms passes over all three. The
 * tree mirrors them in `src/spine/walk.test.ts` as `witnessNames`, hand-typed,
 * and a fourth witness the model adds under its own no-arm-without-a-witness
 * discipline arrives with nothing to notice it — the roster alarm's own failure
 * mode, on the one surface that says which green invariants are vacuous.
 *
 * READ FROM THE MARKER COMMENT, on `exemptionRoster`'s argument and for its
 * reason. The model states them as a numbered series — each `val` is introduced
 * by an `ANTI-VACUITY WITNESS` header saying so — and the code has nothing that
 * distinguishes them from any other `val … : bool`: `revokedNeverCompletes` is
 * a bundle conjunct with the same spelling, so a name pattern would roster the
 * wrong thing and call it agreement. The marker is the model's own declaration
 * of what these are.
 *
 * A MARKER WITH NO `val` UNDER IT IS A COULD-NOT-RUN naming the marker, and so
 * is a file with no marker at all — the `readModuleConsts` rule, again: "no
 * witnesses" and "witnesses this parse cannot see" must not report the same.
 *
 * `path` IS A PARAMETER so the suite that owns the comparison can hand this a
 * fixture, which is `readModuleConsts`' arrangement: the shipped side of this
 * roster lives in a `.test.ts` file, so the comparison cannot live in
 * `verify.ts` and its red proofs need model fragments of their own.
 */
export function readAntiVacuityWitnesses(
  path: string = domainSource,
): readonly string[] {
  const marker = "ANTI-VACUITY WITNESS";
  const lines = readSource(path).split("\n");
  const names: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!(lines[i] ?? "").includes(marker)) {
      continue;
    }
    const declared = witnessValUnder(lines, i);
    if (declared === undefined) {
      throw new CorpusError(
        `${path}: the ${marker} comment at line ${String(i + 1)} is followed by no bool val`,
      );
    }
    names.push(declared);
  }
  if (names.length === 0) {
    throw new CorpusError(`${path}: no ${marker} comment`);
  }
  return names;
}

/**
 * The name of the first `val <name>: bool =` under a marker line, skipping the
 * rest of the comment it opens — and answering nothing if any other declaration
 * gets there first, because a marker that has drifted away from its `val` is a
 * parse this reader must not guess at.
 */
function witnessValUnder(
  lines: readonly string[],
  from: number,
): string | undefined {
  for (let i = from + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const text = line.trimStart();
    if (text.startsWith("//") || text.length === 0) {
      continue;
    }
    return /^\s*val ([A-Za-z][A-Za-z0-9_]*)\s*:\s*bool\s*=/.exec(line)?.[1];
  }
  return undefined;
}

/**
 * Every `run` the witness suite declares, by name.
 *
 * THE TIER-2 CORPUS IS SUPPOSED TO BE THAT LIST, and until sweep 2 nothing said
 * so in either direction. A run the model added under its own
 * no-arm-without-a-witness rule and this corpus never exported is a
 * deterministic pin the implementation does not replay — which is exactly the
 * shape of the obligation the model keeps witnesses FOR; and a manifest entry
 * naming a run the module does not declare is a fixture nobody can regenerate,
 * discoverable today only by running the emitter.
 *
 * It is `matchesOf`'s rule again: a suite with no runs at all is this parse
 * having stopped seeing them, not a suite that pins nothing.
 */
export function readWitnessRuns(): readonly string[] {
  return matchesOf(readSource(witnessSource), /^\s*run ([A-Za-z0-9_]+)\s*=/gm, {
    at: `${witnessSource}: run declarations`,
  });
}

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CorpusError(`${path} cannot be read: ${messageOf(error)}`);
  }
}

/**
 * The source with every `//` comment stripped, so a roster read below sees code
 * and not the model's prose about it.
 *
 * The model argues at length in `///` headers and names its own labels there,
 * so a literal scan over the raw text would report the prose as the machine.
 * It is a line-wise strip rather than a lexer: a `//` inside a string literal
 * would truncate that line, and the only literals in this file with a slash in
 * them are module paths, which the literal reader drops anyway.
 */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Every distinct string literal in the model's code, module paths aside. */
function codeLiterals(code: string): readonly string[] {
  return unique(
    matchesOf(code, /"([^"]*)"/g, { at: `${domainSource}: string literals` }),
  ).filter((text) => !text.includes("/"));
}

/**
 * The `stepDescends` roster comment's entries — the one roster the model states
 * in prose rather than in code, because the flavors it distinguishes are two
 * readings of ONE disjunct and the code has no separate name for either.
 *
 * The model keeps that list under its own no-arm-without-a-witness rule, which
 * is what makes it a roster worth comparing rather than a comment: an arm added
 * without a line here is already a review finding in the model's own terms.
 */
function exemptionRoster(source: string): readonly string[] {
  const marker = "Current roster:";
  const from = source.indexOf(marker);
  const to = source.indexOf("val stepDescends", from);
  if (from < 0 || to < 0) {
    throw new CorpusError(
      `${domainSource}: no ${JSON.stringify(marker)} comment before val stepDescends`,
    );
  }
  const entries = source
    .slice(from + marker.length, to)
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/\/\s*/, "").trim())
    // A continuation line carries only this entry's witness run, after the
    // dash: the two-line entries are the two whose names do not fit beside it.
    .map((line) => line.split("—")[0]?.trim() ?? "")
    .map((line) => line.replace(/[;.]$/, "").trim())
    .filter((line) => line.length > 0);
  if (entries.length === 0) {
    throw new CorpusError(`${domainSource}: the exemption roster reads empty`);
  }
  return entries;
}

/**
 * The names a `val <name>: bool = and { … }` conjoins, as the model spells
 * them — the shape `allInvariants` and the two refinement bundles are written
 * in, and the one a roster read of `pure def` and of code literals cannot see.
 *
 * A BUNDLE IS A ROSTER THAT LOOKS LIKE CODE, which is why it needed saying: the
 * model states its safety bundle as a conjunction of names, this tree states the
 * same list as a chain of calls and again as a roster its suites read, and
 * nothing compared the two. The bundle has already grown by a conjunct once,
 * and what caught it was attention.
 *
 * EVERY ENTRY MUST BE A BARE NAME. A conjunct that is an expression — `and`
 * takes them, and `executorSound` is one — is reported as could-not-run rather
 * than rostered as whatever the text between two commas happened to be. That is
 * `readModuleConsts`'s rule again: a parse that cannot see the declaration must
 * not answer as though it had.
 */
function conjunctsOf(
  code: string,
  val: string,
  source: string,
): readonly string[] {
  const at = `${source}: val ${val}`;
  const marker = `val ${val}: bool = and {`;
  const opened = code.indexOf(marker);
  if (opened < 0) {
    throw new CorpusError(`${at}: no ${JSON.stringify(marker)} declaration`);
  }
  const from = opened + marker.length;
  const to = code.indexOf("}", from);
  if (to < 0) {
    throw new CorpusError(`${at}: the conjunction does not close`);
  }
  const entries = code
    .slice(from, to)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new CorpusError(`${at}: this parse matched nothing`);
  }
  for (const entry of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(entry)) {
      throw new CorpusError(
        `${at}: ${JSON.stringify(entry)} is not a conjunct name`,
      );
    }
  }
  return entries;
}

/**
 * The constructors of a `|`-separated sum type, as the model declares them —
 * `type Cmd`, the decision-event vocabulary this tree mirrors as a union.
 *
 * THE ARMS ARE READ LINE BY LINE, one arm per line, which is how the model
 * writes them. A payload may hold commas and brackets and is not read at all —
 * `entry.ts` is where a payload's fields are checked, against the union rather
 * than against the model — so what this compares is the constructor roster.
 *
 * WHAT BOUNDS THE READ IS INDENTATION, AND IT USED TO BE THE FIRST EMPTY LINE.
 * That was a truncation with no alarm on it: `withoutComments` rewrites a `//`
 * line to whitespace, so a model author's ordinary note beside a new arm ended
 * the list, and every arm below it left this roster in silence while the
 * exact-set comparison went on reporting agreement. A blank line inside the
 * list did the same. So an interior blank — comment or otherwise — is SKIPPED,
 * and the declaration ends where Quint's own layout ends it: at the first
 * non-blank line indented no deeper than the `type` line itself, which is the
 * next declaration or the module's own close.
 *
 * A DECLARATION WHOSE ARMS DO NOT START ON THE NEXT LINE IS REFUSED, rather
 * than answered with the arms this reader can see, and so is one whose arm list
 * comes out empty. The same rule as everywhere in this section: a shape the
 * parse no longer recognizes is a could-not-run.
 */
function sumTypeArms(
  code: string,
  type: string,
  source: string,
): readonly string[] {
  const at = `${source}: type ${type}`;
  const marker = `type ${type} =`;
  const opened = code.indexOf(marker);
  if (opened < 0) {
    throw new CorpusError(`${at}: no ${JSON.stringify(marker)} declaration`);
  }
  const [rest, ...lines] = code.slice(opened + marker.length).split("\n");
  if ((rest ?? "").trim().length > 0) {
    throw new CorpusError(
      `${at}: the arm list does not start on the line below the declaration`,
    );
  }
  const arms: string[] = [];
  const declaredAt = declarationIndent(code, opened);
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    if (indentOf(line) <= declaredAt) {
      break;
    }
    for (const piece of line.split("|")) {
      const text = piece.trim();
      if (text.length === 0) {
        continue;
      }
      const name = /^([A-Z][A-Za-z0-9_]*)\s*(\(|$)/.exec(text)?.[1];
      if (name === undefined) {
        throw new CorpusError(
          `${at}: ${JSON.stringify(text)} is not a constructor`,
        );
      }
      arms.push(name);
    }
  }
  if (arms.length === 0) {
    throw new CorpusError(`${at}: this parse matched nothing`);
  }
  return arms;
}

/** How many spaces a line opens with — Quint's own nesting, read as a number. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The indentation of the line a declaration starts on. */
function declarationIndent(code: string, opened: number): number {
  const lineStart = code.lastIndexOf("\n", opened) + 1;
  return indentOf(code.slice(lineStart, opened + 1));
}

/**
 * The fields a `type <name> = { … }` declares, in the model's own order.
 *
 * THIS IS THE ROSTER EVERY OTHER ONE IS WRITTEN IN. A decider, an effect and
 * a label are names this tree copies; a record is the vocabulary a golden trace
 * is expressed in, copied into `itf.ts`'s exact-field decodes and into
 * `entry.ts`'s journal schema, and until this reader existed both copies were
 * held against nothing at gate time. The comparison is `src/tools/verify.ts`'s
 * and it is an exact set in both directions, like every other.
 *
 * COMMENTS AND BLANK LINES INSIDE THE BLOCK ARE NOT A BOUNDARY, which the sum
 * reader above learned the hard way: the model documents `Ticket` field by
 * field, so a reader that stopped at the first blank line would see the first
 * field and none of the rest. The block is bounded by its own braces instead, counted by depth,
 * and split on top-level commas — `deps: Set[int]` and `program: List[Stage]`
 * are why the split cannot be a plain `,`.
 *
 * EVERY ENTRY MUST BE `name: type`. Anything else is reported as could-not-run
 * rather than rostered as whatever the text between two commas happened to be —
 * `readModuleConsts`'s rule, and `conjunctsOf`'s.
 */
function recordTypeFields(
  code: string,
  type: string,
  source: string,
): readonly string[] {
  return recordFieldsAt(
    code,
    `type ${type} = {`,
    `${source}: type ${type}`,
    "declaration",
  );
}

/**
 * The fields a sum type's record-payload ARM declares — `WrapUpObs`'s
 * `WOAttempt({ … })`, the wrap-up attribution the golden traces carry.
 *
 * It is read from the arm rather than from a `type` of its own because that is
 * where the model declares it: the payload is anonymous, so there is no
 * declaration for `recordTypeFields` to find, and leaving it unrostered would
 * leave the one record whose fields moved most recently the only one nothing
 * compares.
 */
function armRecordFields(
  code: string,
  arm: string,
  source: string,
): readonly string[] {
  return recordFieldsAt(code, `${arm}({`, `${source}: ${arm}`, "arm");
}

function recordFieldsAt(
  code: string,
  marker: string,
  at: string,
  what: string,
): readonly string[] {
  const opened = code.indexOf(marker);
  if (opened < 0) {
    throw new CorpusError(`${at}: no ${JSON.stringify(marker)} ${what}`);
  }
  const block = balancedIn(
    code,
    opened + marker.length,
    "{",
    "}",
    `${at}: the record's`,
  );
  const fields = splitTopLevel(block)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const name = /^([a-z][A-Za-z0-9_]*)\s*:/.exec(entry)?.[1];
      if (name === undefined) {
        throw new CorpusError(
          `${at}: ${JSON.stringify(entry)} is not a field declaration`,
        );
      }
      return name;
    });
  if (fields.length === 0) {
    throw new CorpusError(`${at}: this parse matched nothing`);
  }
  return fields;
}

/**
 * A comma-separated list, split at depth zero only. A field's type may itself
 * carry commas — a nested record, a `Set[…]` of one — and a plain `split(",")`
 * would turn one field into several unreadable halves and report the parse as
 * broken rather than the model as changed.
 */
function splitTopLevel(block: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      parts.push(block.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(block.slice(from));
  return parts;
}

/**
 * Every first capture of `pattern`, refusing an empty answer.
 *
 * A roster this tree compares against is never legitimately empty, so an empty
 * match set is the parse having stopped seeing the declaration rather than the
 * model having dropped every one — and reporting it as a roster disagreement
 * would blame the tree for a defect in this reader.
 */
function matchesOf(
  source: string,
  pattern: RegExp,
  where: { readonly at: string },
): readonly string[] {
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const captured = match[1];
    if (captured !== undefined) {
      found.push(captured);
    }
  }
  if (found.length === 0) {
    throw new CorpusError(`${where.at}: this parse matched nothing`);
  }
  return found;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
