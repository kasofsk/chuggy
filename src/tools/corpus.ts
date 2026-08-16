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
 * a run for tier 2) and the consts the machine it speaks about was
 * instantiated at. Nothing derived lives there — no counts, no coverage claims
 * — because a derived figure in a hand-edited file is a figure that goes stale
 * without anything noticing.
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

import { readFileSync } from "node:fs";

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

/** A tier-1 fixture: a seeded, budgeted search on one mc instance, under `--mbt`. */
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
  readonly pins: readonly string[];
  readonly rationale: string;
};

/** A tier-2 fixture: one deterministic witness run, exported by `quint test`. */
export type Tier2Fixture = {
  readonly name: string;
  readonly module: string;
  readonly run: string;
  readonly consts: Config;
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
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(from, i);
      }
    }
  }
  throw new CorpusError(`${at}: the const block's parentheses do not close`);
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
// the other thing a manifest-free part of this tree copies out of the model. A
// handful of rosters here are typed out by hand from `model/domain.qnt` — the
// thirteen deciders, the reachable step labels, the eight `stepDescends`
// exemption arms, the eight effect strings, the three mc instances, the nondet
// binder names and the const names — and every one of them is a second
// statement of something the model already says. The corpus does not catch a
// roster going stale: a model PR that adds a fourteenth decider adds no fixture
// either, so `coverageGaps` finds every rostered entry covered and reports
// nothing, and the whole gate stays green over a machine this tree does not
// describe.
//
// WHAT MAKES A SECOND STATEMENT LEGITIMATE, in this tree, is that something
// maintains it. Where the compiler can, it does — `effect.ts`'s `vocabulary`
// and `decode.ts`'s `labels` are `satisfies` clauses over their own unions, and
// `entry.ts`'s field tables are `Record<CmdTag, …>`. The compiler cannot reach
// across the language boundary, so this is what does instead: a text read of
// the Quint source, compared as EXACT SETS in both directions by
// `src/tools/verify.ts`.
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
  const literals = codeLiterals(domainCode);
  return {
    deciders: matchesOf(domainCode, /\bpure def (decide[A-Za-z]*)\s*\(/g, {
      at: `${domainSource}: pure def decide*`,
    }),
    // THE SPELLING IS THE MODEL'S OWN AND IT IS STATED AS A RULE, not inferred:
    // every effect the model writes is a constructor name in upper camel case
    // and every step label is lower case with dashes. Refutation trigger: a
    // model PR that writes either the other way round lands in `unclassified`
    // and reds this alarm, which is the review hook rather than a false alarm.
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
  };
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
