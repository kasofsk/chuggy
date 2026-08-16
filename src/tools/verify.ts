/**
 * REPLAY THE COMMITTED CORPUS: the one walk both the gate and the emitter make,
 * so that what the emitter accepts and what the gate enforces cannot drift.
 *
 * IT NEVER REGENERATES. Everything here reads the manifest and the committed
 * fixture files; nothing runs quint. That is what insulates the verdict from
 * `--mbt`'s experimental status and from a quint upgrade — either would break
 * regeneration visibly, under the pin `check-model.sh` holds, and never the
 * gate.
 *
 * THE TWO OUTCOMES ARE KEPT APART ALL THE WAY OUT. A finding is a disagreement
 * about the machine: a step whose record came back different, a state whose
 * fleet moved elsewhere, an invariant false after a step, an obligation no
 * fixture covers, a file the manifest does not name. An error is the check
 * being unable to run at all: an absent corpus, a fixture that is not JSON, a
 * trace this tree cannot decode. They exit 1 and 2, and 2 is not a pass.
 */

import { readdirSync } from "node:fs";

import { messageOf } from "../domain/assert.ts";
import type { Config } from "../domain/domain.ts";
import { bundleConjunctNames } from "../domain/invariants.ts";
import { effectVocabulary } from "../effects/effect.ts";
import { shippedDeciders } from "../spine/cmd.ts";
import {
  entryFieldNames,
  shippedCmdTags,
  stepRecordFieldNames,
} from "../spine/entry.ts";
import {
  refinementBundleConjuncts,
  refinementCoreConjuncts,
} from "../spine/refinement-invariants.ts";
import {
  CoverageBuilder,
  coverageGaps,
  effectGaps,
  exemptionArms,
  mcInstances,
  pinsMissed,
  type Coverage,
} from "../spine/coverage.ts";
import {
  decodeSteps,
  guardedUnreachableStepLabel,
  reachableStepLabels,
} from "../spine/decode.ts";
import {
  DecodeError,
  decodedRecordFields,
  decodeTrace,
  nondetBinders,
} from "../spine/itf.ts";
import { replayTrace } from "../spine/replay.ts";
import {
  CorpusError,
  constNames,
  constsDisagree,
  fixturePath,
  loadManifest,
  mcSource,
  readJson,
  readModelRosters,
  readModuleConsts,
  readWitnessRuns,
  tier1Dir,
  tier2Dir,
  witnessSource,
  type Manifest,
  type ModelRecordName,
} from "./corpus.ts";

export type Verification = {
  readonly findings: readonly string[];
  readonly errors: readonly string[];
  readonly coverage: Coverage;
  readonly replayed: readonly string[];
};

/**
 * Walk the whole corpus. A could-not-run stops the walk — there is nothing to
 * say about a corpus that cannot be read — while findings accumulate, because a
 * reader fixing a mismatch wants every fixture's verdict, not the first.
 */
export function verifyCorpus(): Verification {
  const findings: string[] = [];
  const coverage = new CoverageBuilder();
  const replayed: string[] = [];
  let manifest: Manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    return errorOnly(error, coverage);
  }

  try {
    findings.push(...orphanFixtures(manifest));
    // THE ROSTERS BEFORE THE CONSTS, because the coarser alarm goes first. If
    // the model's SURFACE has moved, the const comparison's own module lookups
    // are reading a file whose shape this tree no longer describes — and a
    // module it cannot find is a could-not-run, which would stop the walk
    // before the roster finding that explains it had been recorded.
    findings.push(...staleRosters());
    findings.push(...staleWitnessRuns(manifest));
    findings.push(...staleConsts(manifest));
    for (const fixture of manifest.tier1) {
      findings.push(
        ...replayFixture(
          fixture,
          fixturePath(fixture, 1),
          coverage,
          fixture.instance,
        ),
      );
      replayed.push(fixture.name);
    }
    for (const fixture of manifest.tier2) {
      findings.push(
        ...replayFixture(fixture, fixturePath(fixture, 2), coverage),
      );
      replayed.push(fixture.name);
    }
  } catch (error) {
    return { ...errorOnly(error, coverage), findings, replayed };
  }

  const taken = coverage.taken();
  findings.push(
    ...[...coverageGaps(taken), ...effectGaps(effectVocabulary, taken)].map(
      (gap) => `coverage: ${gap.obligation} ${gap.missing}`,
    ),
  );
  return { findings, errors: [], coverage: taken, replayed };
}

function errorOnly(error: unknown, coverage: CoverageBuilder): Verification {
  if (error instanceof CorpusError || error instanceof DecodeError) {
    return {
      findings: [],
      errors: [messageOf(error)],
      coverage: coverage.taken(),
      replayed: [],
    };
  }
  throw error;
}

/**
 * Replay one fixture at its own consts, then check the two claims it makes:
 * that it replays, and that it reaches what the manifest says it is in the
 * corpus for.
 *
 * ITS COVERAGE IS TAKEN ON ITS OWN FIRST and folded into the corpus's after,
 * which is the whole of what makes a pin checkable: against a corpus-wide
 * accumulator every pin would be satisfied as long as SOME fixture reached the
 * entry, which is exactly the claim a pin is not making.
 *
 * AND THE INSTANCE IS TAKEN FROM A REPLAY THAT WENT CLEAN, which is the one
 * obligation this walk cannot observe from a trace at all: an mc instance is a
 * manifest field, so it used to be counted before the fixture was opened and
 * was satisfiable by DECLARATION — a corpus whose only DeadlineOnly fixture no
 * longer replayed still reported the instance covered, and the reader saw one
 * finding where there were two obligations in trouble. Counting it only when
 * the fixture came back clean makes the claim "this instance is exercised"
 * rather than "this instance is mentioned".
 */
function replayFixture(
  fixture: {
    readonly name: string;
    readonly consts: Config;
    readonly states: number;
    readonly pins: readonly string[];
  },
  path: string,
  corpus: CoverageBuilder,
  instance?: string,
): readonly string[] {
  const trace = decodeTrace(readJson(path), fixture.name);
  const plans = decodeSteps(trace, fixture.name);
  const own = new CoverageBuilder();
  const report = replayTrace(fixture.consts, trace, plans, own, fixture.name);
  const taken = own.taken();
  corpus.absorb(taken);
  const problems = [
    ...truncated(fixture, trace.states.length),
    ...report.findings.map(
      (finding) =>
        `${fixture.name}: state ${String(finding.state)}: ${finding.detail}`,
    ),
    ...pinsMissed(fixture.pins, taken).map(
      (pin) =>
        `${fixture.name}: the manifest pins ${pin} to this fixture, and it reaches no such step`,
    ),
  ];
  if (instance !== undefined && problems.length === 0) {
    corpus.observeInstance(instance);
  }
  return problems;
}

/**
 * The fixture's length against the manifest's — the one corruption the trace
 * cannot report about itself.
 *
 * `itf.ts` checks every state's `#meta.index` against its position, so a state
 * removed from the MIDDLE of a fixture is a decode failure naming the state.
 * A state removed from the END leaves a dense, ascending, perfectly readable
 * shorter trace, and replay has nothing to say about the steps that are no
 * longer there: the committed corpus holds fixtures whose `pins` are all
 * reached before their last state, so truncating one of those was measured to
 * pass the whole gate at exit 0. The manifest's count is the second statement that makes the
 * loss visible — written by the emitter, checked here, and in a different file
 * from the one a hand truncation edits.
 */
function truncated(
  fixture: { readonly name: string; readonly states: number },
  found: number,
): readonly string[] {
  if (found === fixture.states) {
    return [];
  }
  return [
    `${fixture.name}: the manifest says the trace holds ${String(fixture.states)} state(s) and it holds ${String(found)}`,
  ];
}

/**
 * Every committed fixture file is named by the manifest, and every manifest
 * entry has a file. A file nothing names is a trace nothing replays — the
 * shape a dropped manifest entry leaves behind — and the missing direction is
 * raised as could-not-run by the read itself.
 */
function orphanFixtures(manifest: Manifest): readonly string[] {
  const named = new Set([
    ...manifest.tier1.map((f) => fixturePath(f, 1)),
    ...manifest.tier2.map((f) => fixturePath(f, 2)),
  ]);
  const findings: string[] = [];
  for (const [dir, tier] of [
    [tier1Dir, 1],
    [tier2Dir, 2],
  ] as const) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new CorpusError(`${dir} cannot be listed: ${messageOf(error)}`);
    }
    for (const entry of entries) {
      const path = `${dir}/${entry}`;
      if (!named.has(path)) {
        findings.push(
          `corpus: ${path} is committed and the manifest names no fixture for it (tier ${String(tier)})`,
        );
      }
    }
  }
  return findings;
}

/**
 * The witness suite's runs against the tier-2 corpus, as an exact set in both
 * directions.
 *
 * TIER 2 IS SUPPOSED TO BE THE MODEL'S OWN WITNESS RUNS — that is the trace
 * mechanism's whole argument for it: the model already maintains those pins
 * under its no-arm-without-a-witness rule, and the implementation inherits
 * them. Nothing checked that inheritance. A run the model ADDS is a
 * deterministic obligation this tree does not replay, and it arrives with no
 * fixture, so every roster stays complete and `coverageGaps` reports nothing —
 * the roster alarm's own failure mode, one file further out. A run the manifest
 * names and the module does not declare is a fixture nobody can regenerate,
 * which today is discovered by running the emitter and not by any gate.
 */
function staleWitnessRuns(manifest: Manifest): readonly string[] {
  return rosterDisagrees(
    "witness run",
    manifest.tier2.map((fixture) => fixture.run),
    readWitnessRuns(),
  );
}

/**
 * The manifest's consts against the model's own const blocks. A trace speaks
 * about the machine it was emitted from; if the model has moved since, the
 * fixture is stale and its green verdict means nothing.
 */
function staleConsts(manifest: Manifest): readonly string[] {
  const findings: string[] = [];
  for (const fixture of manifest.tier1) {
    const module = `mc_chuggy_${fixture.instance}`;
    const difference = constsDisagree(
      fixture.consts,
      readModuleConsts(mcSource, module),
      `${fixture.name} (${module})`,
    );
    if (difference !== undefined) {
      findings.push(`corpus: ${difference}`);
    }
  }
  for (const fixture of manifest.tier2) {
    const difference = constsDisagree(
      fixture.consts,
      readModuleConsts(witnessSource, fixture.module),
      `${fixture.name} (${fixture.module})`,
    );
    if (difference !== undefined) {
      findings.push(`corpus: ${difference}`);
    }
  }
  return findings;
}

/**
 * The rosters this tree types out by hand, against the ones `model/` states.
 *
 * THE CONST ALARM'S ARGUMENT, ONE LEVEL UP. `staleConsts` catches an instance
 * moving under the corpus; this catches the MACHINE'S SURFACE moving under the
 * rosters that describe it. Neither is caught by replay, and the roster case is
 * the quieter of the two: a model PR that adds a fourteenth decider adds no
 * fixture either, so every entry `shippedDeciders` names is still covered,
 * `coverageGaps` reports nothing, and the whole gate stays green over an
 * obligation nobody now owes. There is no drift today, and there was no alarm
 * either — which is the shape of control this repo refuses.
 *
 * NO COMPILER MAINTAINS ANY OF THESE ROSTERS AGAINST THE MODEL, which is what
 * separates them from the second statements this tree is happy to keep.
 * `effect.ts`'s `vocabulary`, `decode.ts`'s `labels` and `entry.ts`'s field
 * tables are copies the TYPE CHECKER holds to their unions — and that is a
 * check against TypeScript, never against `model/`: `shippedCmdTags` is derived
 * from a `Record` the compiler proves exhaustive over `Cmd`, and neither it nor
 * `Cmd` can notice the model growing an arm. Every roster below is a copy of
 * something written in another language, and nothing in TypeScript reaches
 * across that boundary. `corpus.ts`'s reader is what reaches, and this is where
 * the two sides meet.
 *
 * THE BUNDLE, THE `Cmd` ARMS AND THE REFINEMENT BLOCKS ARE THE ONES A
 * `pure def` READ COULD NOT SEE, and they are here because their absence
 * reproduced this alarm's own failure mode: a model
 * surface stated as a `val … = and { … }` or as a sum type is invisible to a
 * reader that looks for definitions, code literals and consts, so a conjunct
 * added to `allInvariants` and an arm added to `type Cmd` both passed every
 * gate at exit 0. Two of them also mean this walk reads `refinement.qnt`, which
 * `staleConsts` never opens.
 *
 * AND THE RECORD SCHEMAS ARE THE ONES NO ROSTER OF NAMES COULD SEE AT ALL,
 * which is why they arrived last and cost the most. Every roster above is a set
 * of NAMES; a record is the VOCABULARY those names are written in, and it goes
 * stale a FIELD at a time. `measure.qnt`'s `StepRecord` and everything it is
 * made of, plus `refinement.qnt`'s journal row, are copied into `itf.ts`'s
 * exact-field decodes and `entry.ts`'s schema — and the only thing that had
 * ever compared either copy to the model was regenerating the corpus, which no
 * gate does and which is run by hand. A field rename upstream therefore crossed
 * a whole release with both bundles green; `shippedRecordFields` below is what
 * makes that a finding on every run.
 *
 * EXACT SETS, BOTH DIRECTIONS, ORDER IGNORED. A roster entry the model has and
 * this tree does not is an obligation nobody owes; one this tree has and the
 * model does not is an obligation nothing can ever cover, which would red
 * `coverageGaps` eventually and blame the corpus for it. Order is deliberately
 * not compared: `decode.ts`'s roster is the union's declaration order and the
 * model's literal order is where its deciders happen to write them, and a
 * gate that argued about sequence would be a gate somebody turns off.
 *
 * THE ONE ENTRY THAT NEEDS SAYING OUT LOUD is
 * `operator-retry-unreachable`. The model emits it and `reachableStepLabels`
 * deliberately excludes it, so the comparison adds it back by name — from
 * `decode.ts`'s own constant rather than from a literal here, because an
 * exclusion spelled twice is an exclusion that drifts.
 */
function staleRosters(): readonly string[] {
  const model = readModelRosters();
  return [
    ...rosterDisagrees("decider", shippedDeciders, model.deciders),
    ...rosterDisagrees("effect", effectVocabulary, model.effects),
    ...rosterDisagrees(
      "step label",
      [...reachableStepLabels, guardedUnreachableStepLabel],
      model.stepLabels,
    ),
    ...rosterDisagrees(
      "stepDescends exemption arm",
      exemptionArms,
      model.exemptionArms,
    ),
    ...rosterDisagrees("mc instance", mcInstances, model.instances),
    ...rosterDisagrees(
      "nondet binder",
      nondetBinders.map(([bound]) => bound),
      model.binders,
    ),
    ...rosterDisagrees("model const", constNames, model.consts),
    ...rosterDisagrees(
      "allInvariants conjunct",
      bundleConjunctNames,
      model.bundleConjuncts,
    ),
    ...rosterDisagrees("Cmd arm", shippedCmdTags, model.cmdArms),
    ...rosterDisagrees(
      "refinementCore conjunct",
      refinementCoreConjuncts,
      model.refinementCoreConjuncts,
    ),
    ...rosterDisagrees(
      "refinementInvariants conjunct",
      refinementBundleConjuncts,
      model.refinementBundleConjuncts,
    ),
    ...shippedRecordFields.flatMap(({ type, twin, fields }) =>
      rosterDisagrees(
        `${type} field (${twin})`,
        fields,
        model.recordFields[type],
      ),
    ),
    ...model.unclassified.map(
      (text) =>
        `model: string literal ${JSON.stringify(text)} — the model's code holds it and it is spelled as neither an effect nor a step label`,
    ),
  ];
}

/**
 * THE RECORD SCHEMAS THIS TREE SHIPS, and where each is written.
 *
 * The twelfth roster, and the one every roster above it is expressed in. A decider,
 * a label and an effect are NAMES: a comparison of them catches the model
 * gaining or losing one. A record is a VOCABULARY, and the way it goes stale is
 * a FIELD — which no name roster can see. Both shipped copies of the model's
 * record types are hand-typed (`itf.ts` decodes against an exact field set,
 * `entry.ts` states the journal row's schema), and the only thing that ever
 * compared either to `model/` was regenerating the corpus, which no gate does.
 * That is how the `landing` → `attempt` rename crossed a release with every
 * gate green.
 *
 * `StepRecord` APPEARS TWICE ON PURPOSE. Two files copy it — the decoder and
 * the journal schema — and they can drift from the model independently, so a
 * finding names the file as well as the field. The alternative, comparing one
 * of them and trusting the other to follow, is the arrangement this whole
 * section exists to refuse.
 */
const shippedRecordFields: readonly {
  readonly type: ModelRecordName;
  readonly twin: string;
  readonly fields: readonly string[];
}[] = [
  { type: "Task", twin: "src/spine/itf.ts", fields: decodedRecordFields.Task },
  {
    type: "Stage",
    twin: "src/spine/itf.ts",
    fields: decodedRecordFields.Stage,
  },
  {
    type: "WOAttempt",
    twin: "src/spine/itf.ts",
    fields: decodedRecordFields.WOAttempt,
  },
  {
    type: "Ticket",
    twin: "src/spine/itf.ts",
    fields: decodedRecordFields.Ticket,
  },
  {
    type: "Transition",
    twin: "src/spine/itf.ts",
    fields: decodedRecordFields.Transition,
  },
  {
    type: "StepRecord",
    twin: "src/spine/itf.ts",
    fields: decodedRecordFields.StepRecord,
  },
  {
    type: "StepRecord",
    twin: "src/spine/entry.ts",
    fields: stepRecordFieldNames,
  },
  { type: "Entry", twin: "src/spine/entry.ts", fields: entryFieldNames },
];

/** One roster, compared as an exact set in both directions. */
function rosterDisagrees(
  what: string,
  shipped: readonly string[],
  model: readonly string[],
): readonly string[] {
  const held = new Set(shipped);
  const stated = new Set(model);
  return [
    ...model
      .filter((entry) => !held.has(entry))
      .map(
        (entry) =>
          `model: ${what} ${entry} — the model has it and this tree's roster does not`,
      ),
    ...shipped
      .filter((entry) => !stated.has(entry))
      .map(
        (entry) =>
          `model: ${what} ${entry} — this tree's roster has it and the model does not`,
      ),
  ];
}
