/**
 * THE CORPUS'S COVERAGE OBLIGATIONS: which deciders, which step labels, which
 * `stepDescends` exemption arms, which `decideOpRetry` resume arms and which
 * instances the committed traces actually reach. The emitter refuses to write a
 * corpus that misses one and the gate re-checks the same rosters, so an
 * obligation is a property of the tree rather than a claim in a description.
 *
 * A DECIDER IS NOT ALWAYS THE RIGHT GRAIN, which is why the resume arms are
 * here. `decideOpRetry` matches on the ticket's `resumeAt` and does something
 * structurally different in each of its arms, so "the corpus reaches
 * `decideOpRetry`" is satisfied by any one of them and silent about the rest — and
 * that silence was measured, not supposed. The roster below is the arms; the
 * one the corpus cannot reach is declared with its argument rather than left
 * to be discovered as an absence.
 *
 * THE ARM ATTRIBUTION DOES NOT RESTATE THE PREDICATE — it interrogates the
 * shipped one, which is the whole difficulty of this file. `stepDescends`
 * answers one boolean over a disjunction of eight arms; naming the arm that
 * fired would ordinarily mean writing the disjunction down a second time, and a
 * second copy of a guard is what `domain.ts` and `invariants.ts` both forbid
 * and what would quietly go on reporting an arm the predicate had stopped
 * having. So the arm is read off the predicate by two probes, neither of which
 * restates a condition:
 *
 *   1. IS THE STEP EXEMPT AT ALL? Ask `stepDescends` with a previous measure
 *      BELOW the current one. A climb cannot satisfy the descent disjunct, so a
 *      true answer is an arm firing and nothing else. (`invariants.test.ts`
 *      pins the same technique arm by arm; this is that technique applied to a
 *      trace instead of a fixture.)
 *   2. WHICH ARM? The label separates six of the eight outright, because no two
 *      of those arms share one. The two that do share a label are the
 *      operator-resume flavors, and the pricing separates them: the free
 *      pipeline flavor exists only under `RetryFree`, so a step that stays
 *      exempt when the config is read at `RetryCharged` is the pre-work flavor
 *      and a step that does not is the pipeline one. The measure reads no
 *      retry pricing — `Bounds` carries none, and `measure.ts` says why — so
 *      the substituted config changes the answer of this predicate alone.
 *
 * A label alone would be the weaker attribution, and the exemption probe is
 * what makes it a claim about the ARM: a `ticket-revoked` step that dragged a
 * live rank down is not exempt, so it is not counted as the desk-only arm, and
 * the roster stays honest about the arm the corpus actually fired.
 */

import { stepDescends } from "../domain/invariants.ts";
import type { Config } from "../domain/domain.ts";
import type { Core, Resume, StepRecord } from "../domain/measure.ts";
import { currentMeasure } from "./machine.ts";
import { decidersReached, shippedDeciders, type Cmd } from "./cmd.ts";
import { reachableStepLabels, type StepLabel } from "./decode.ts";
import { nondetBinders, type Picks } from "./itf.ts";

/** The binder names the model's actions draw, as a roster the corpus owes. */
const boundBinderNames: readonly string[] = nondetBinders.map(
  ([bound]) => bound,
);

/**
 * `model/domain.qnt`'s eight `stepDescends` exemption arms, in the order the
 * disjunction writes them. The two operator-resume entries are one disjunct
 * with an inner pair, exactly as the model's comment lists them: one entry per
 * FLAVOR.
 */
export const exemptionArms = [
  "init",
  "task-done-duplicate",
  "complete-duplicate",
  "settled",
  "operator-retry, RPending flavor",
  "operator-retry, RetryFree pipeline flavor",
  "ticket-arrived",
  "ticket-revoked, desk-only flat",
] as const;

export type ExemptionArm = (typeof exemptionArms)[number];

/** The mc instances a corpus owes a fixture each. */
export const mcInstances = ["budgeted", "deadline_only", "retryfree"] as const;

export type McInstance = (typeof mcInstances)[number];

/**
 * `model/domain.qnt`'s `decideOpRetry` RESUME POINTS — the arms of the one
 * decider whose arms no roster in this file could see.
 *
 * WHY A DECIDER ROSTER IS NOT ENOUGH HERE, and it is the only decider this is
 * true of. Every other one answers a single shape; `decideOpRetry` matches on
 * the ticket's `resumeAt` and does something structurally different in each
 * arm — re-derive at Pending, respawn work, fresh eval fan-out, re-enqueue the
 * wrap-up — so "the corpus reaches `decideOpRetry`" is satisfied by any one of
 * them and says nothing about the rest. Deleting the `EnqueueWrapUp`
 * effect from the `RWrapUp` arm was measured to leave the whole tree green
 * except one hand-written unit assertion, with `decideOpRetry` reported
 * covered throughout.
 *
 * `RNone` IS NOT AN ARM HERE, for `operator-retry-unreachable`'s reason:
 * `retryableIn` refuses a ticket with no modeled resume, so the model's own
 * `RNone` arm is guarded-unreachable and a corpus can never owe it.
 *
 * THE ROSTER IS THE UNION MINUS THAT ONE, held by the compiler: the table
 * below is a `Record<ResumeArm, true>`, so a `Resume` constructor added to
 * `measure.ts` is a compile error in this file rather than an arm nothing
 * counts. What no compiler can do is notice `model/measure.qnt` growing one,
 * which is `src/tools/verify.ts`'s business.
 */
export type ResumeArm = Exclude<Resume, "RNone">;

const resumeArmRoster: Readonly<Record<ResumeArm, true>> = {
  RPending: true,
  RWorking: true,
  REvaluating: true,
  RWrapUp: true,
};

export const resumeArms = Object.keys(resumeArmRoster) as readonly ResumeArm[];

/**
 * THE RESUME ARMS NEITHER TIER OF THE CORPUS CAN REACH — declared, argued, and
 * checked in the one direction a declaration can be checked in.
 *
 * `RWrapUp` is stamped by the three wrap-up walls and resumed by an operator
 * afterwards, which is a long chain of correctly-drawn steps. Tier 1
 * is a uniform sampled search and does not come close — PLAN.md records the
 * same negative for two shallower targets, at budgets to 200000 samples — and
 * tier 2 exports the model's OWN witness runs, and none of them drives an
 * operator retry off a wrap-up wall. So the arm is reachable in
 * the machine, exercised in this tree by a deterministic script through the
 * shipped deciders (`randomized.test.ts`), and absent from the corpus for a
 * reason that is not the corpus's to fix: PLAN.md's own fallback names it —
 * an obligation neither tier reaches is first a hole in the model's witness
 * discipline, and the fix is a model PR adding the run.
 *
 * THE DECLARATION IS REFUTABLE, which is the whole of what makes it a control
 * rather than an excuse: a fixture that DOES reach `RWrapUp` reds
 * `coverageGaps` naming it, so the day the model grows that witness this list
 * must shrink in the same change.
 */
export const resumeArmsBeyondTheCorpus: readonly ResumeArm[] = ["RWrapUp"];

/**
 * Is this step exempt from descent? Asked by handing `stepDescends` a previous
 * measure the state has already climbed past, so only an arm can answer true.
 */
function exemptOnAClimb(cfg: Config, c: Core, lastStep: StepRecord): boolean {
  return stepDescends(cfg, c, lastStep, currentMeasure(cfg, c) - 1);
}

/**
 * The exemption arm this step fired, or nothing when it fired none.
 *
 * The `default` arm answers nothing rather than throwing: a step under a label
 * outside the roster below IS exempt only if `stepDescends` has grown an arm
 * this file does not know, and the corpus's own roster check is where that is
 * reported — as an obligation nobody covered, with the arm named — rather than
 * as an exception from a coverage counter.
 */
export function exemptionArmOf(
  cfg: Config,
  c: Core,
  lastStep: StepRecord,
): ExemptionArm | undefined {
  if (!exemptOnAClimb(cfg, c, lastStep)) {
    return undefined;
  }
  switch (lastStep.label) {
    case "init":
    case "task-done-duplicate":
    case "complete-duplicate":
    case "settled":
    case "ticket-arrived":
      return lastStep.label;
    case "ticket-revoked":
      return "ticket-revoked, desk-only flat";
    case "operator-retry":
      return exemptOnAClimb(
        { ...cfg, opRetryPricing: "RetryCharged" },
        c,
        lastStep,
      )
        ? "operator-retry, RPending flavor"
        : "operator-retry, RetryFree pipeline flavor";
    default:
      return undefined;
  }
}

/** What one replayed fixture reached. Accumulated across the corpus. */
export type Coverage = {
  readonly deciders: ReadonlySet<string>;
  readonly labels: ReadonlySet<StepLabel>;
  readonly arms: ReadonlySet<ExemptionArm>;
  readonly instances: ReadonlySet<string>;
  /** The model's nondet binders a decision event was decoded from. */
  readonly binders: ReadonlySet<string>;
  /** The `decideOpRetry` resume points an operator retry was taken at. */
  readonly resumes: ReadonlySet<ResumeArm>;
  /** The effect strings a replayed step actually asked the world for. */
  readonly effects: ReadonlySet<string>;
};

/** A mutable accumulator, so a corpus walk needs no set unions per step. */
export class CoverageBuilder {
  private readonly deciders = new Set<string>();
  private readonly labels = new Set<StepLabel>();
  private readonly arms = new Set<ExemptionArm>();
  private readonly instances = new Set<string>();
  private readonly binders = new Set<string>();
  private readonly resumes = new Set<ResumeArm>();
  private readonly effects = new Set<string>();

  observeLabel(label: StepLabel): void {
    this.labels.add(label);
  }

  /**
   * The deciders this decision event reaches, and — for an operator retry —
   * the arm of `decideOpRetry` it will take.
   *
   * THE ARM IS READ OFF THE PRE-STATE TICKET, not off the step it produced.
   * `resumeAt` is the model's own field and the decider's own match subject, so
   * reading it is asking the machine which arm this is; reading the transition
   * the step LANDED on would be a second copy of the decider's match, and a
   * second copy of a decider is what `domain.ts` and `invariants.ts` both
   * forbid. That is also why this takes the state the decision departed from:
   * the arm's whole point is that `resumeAt` is `RNone` again afterwards.
   */
  observeCmd(before: Core, cmd: Cmd): void {
    for (const decider of decidersReached(cmd)) {
      this.deciders.add(decider);
    }
    if (cmd.tag !== "JOpRetry") {
      return;
    }
    const resumeAt = before.tickets.get(cmd.ticket)?.resumeAt;
    if (resumeAt !== undefined && resumeAt !== "RNone") {
      this.resumes.add(resumeAt);
    }
  }

  observeArm(cfg: Config, c: Core, lastStep: StepRecord): void {
    const arm = exemptionArmOf(cfg, c, lastStep);
    if (arm !== undefined) {
      this.arms.add(arm);
    }
  }

  observeInstance(instance: string): void {
    this.instances.add(instance);
  }

  /**
   * The effects a step asked the world for.
   *
   * IT IS A REACH CHECK AND THE ROSTER COMPARISON IS NOT, which is the whole
   * reason it exists. `src/tools/verify.ts` holds `effectVocabulary` against
   * the model's own code literals as an exact set — a check that the two
   * SPELLINGS agree, satisfied by a vocabulary nothing ever emits. An effect
   * the model can produce and the corpus never carries is a wire the
   * interpreter routes and no golden trace exercises, which is exactly the
   * shape the coverage obligations exist to refuse everywhere else.
   */
  observeEffects(effects: readonly string[]): void {
    for (const effect of effects) {
      this.effects.add(effect);
    }
  }

  /**
   * Which of the machine's nondet draws this decision event carried. The
   * mapping is `itf.ts`'s own binder table rather than a second list of names,
   * so the roster this reports and the roster the decoder demands are one.
   */
  observePicks(picks: Picks): void {
    for (const [bound, as] of nondetBinders) {
      if (picks[as] !== undefined) {
        this.binders.add(bound);
      }
    }
  }

  /** Fold another walk's coverage in — the corpus is the union of its fixtures. */
  absorb(other: Coverage): void {
    for (const decider of other.deciders) {
      this.deciders.add(decider);
    }
    for (const label of other.labels) {
      this.labels.add(label);
    }
    for (const arm of other.arms) {
      this.arms.add(arm);
    }
    for (const instance of other.instances) {
      this.instances.add(instance);
    }
    for (const binder of other.binders) {
      this.binders.add(binder);
    }
    for (const resume of other.resumes) {
      this.resumes.add(resume);
    }
    for (const effect of other.effects) {
      this.effects.add(effect);
    }
  }

  taken(): Coverage {
    return {
      deciders: this.deciders,
      labels: this.labels,
      arms: this.arms,
      instances: this.instances,
      binders: this.binders,
      resumes: this.resumes,
      effects: this.effects,
    };
  }
}

/**
 * Every roster entry a fixture may PIN — the manifest's per-fixture claim about
 * what that fixture is in the corpus for, checked against what it actually
 * reaches.
 *
 * The three trace-observable rosters and no more: an instance is a manifest
 * field rather than something a trace says, and a binder is vetted at decode —
 * both are checked as their own obligations instead.
 *
 * IT IS A UNION, SO A FEW NAMES ARE AMBIGUOUS BY CONSTRUCTION: `init`,
 * `task-done-duplicate`, `complete-duplicate`, `settled` and `ticket-arrived`
 * are each both a step label and an exemption arm, and a pin naming one cannot
 * say which of the two claims it makes. Nothing is lost — the fixture must
 * reach the entry under either reading, and the two readings coincide on every
 * one of them, since the arm is what the label's own step fires. Splitting the
 * namespace would buy precision no obligation is asking for.
 */
export const pinnableEntries: readonly string[] = [
  ...shippedDeciders,
  ...reachableStepLabels,
  ...exemptionArms,
  ...resumeArms,
];

/** The pins this fixture claims and does not reach. */
export function pinsMissed(
  pins: readonly string[],
  reached: Coverage,
): readonly string[] {
  const covered = new Set<string>([
    ...reached.deciders,
    ...reached.labels,
    ...reached.arms,
    ...reached.resumes,
  ]);
  return pins.filter((pin) => !covered.has(pin));
}

/** One unmet obligation, named as the roster entry nothing covered. */
export type CoverageGap = {
  readonly obligation: string;
  readonly missing: string;
};

/**
 * The obligations, checked as EXACT ROSTERS. A missing entry is the gap the
 * emitter refuses over; an entry the corpus reached that no roster names is
 * reported too, because it means this tree's roster and the machine's have
 * drifted and the corpus is the evidence.
 *
 * TWO OBLIGATIONS ARE CHECKED ONE-WAY, and each for the same reason: the entry
 * has already been vetted before it could be observed, so the unexpected
 * direction has nothing to report. An INSTANCE name is not observed from a
 * trace at all — it is read from the manifest, where the loader refuses any
 * name outside this roster. A NONDET BINDER is observed from a trace, but only
 * through `decodePicks`, whose `fieldsExactly` demands the decoder's own binder
 * table exactly: a binder the machine gained is a decode failure naming it
 * rather than a coverage entry nobody rostered. The rest — deciders,
 * step labels, exemption arms, resume arms — are read off the traces
 * themselves, where nothing has vetted them, so those are the ones checked in
 * both directions.
 *
 * THE EFFECT ROSTER IS NOT HERE, and the reason is the purity rule rather than
 * a judgement about the obligation: `effectVocabulary` lives in
 * `src/effects/`, which `src/spine/` may not reach at any depth. So the reach
 * check is `effectGaps` below, which takes the roster as an argument, and
 * `src/tools/verify.ts` is where the two meet — the same file that already
 * holds `effectVocabulary` against the model's own literals. That comparison is
 * a check that the two SPELLINGS agree and is satisfied by a vocabulary nothing
 * emits; this one asks whether the corpus ever asked the world for it.
 *
 * THE RESUME ARMS ARE CHECKED THREE WAYS, because one of them is declared
 * unreachable by this corpus. What the corpus owes is the roster minus that
 * declaration; what no roster names is reported as usual; and the declared arm
 * gets its own check in the opposite direction — reaching it is the finding,
 * because the declaration has then outlived its reason and must go in the same
 * change as the fixture that refuted it.
 */
export function effectGaps(
  vocabulary: readonly string[],
  coverage: Coverage,
): readonly CoverageGap[] {
  return [
    ...missing("effect", vocabulary, coverage.effects),
    ...unexpected("effect", vocabulary, coverage.effects),
  ];
}

export function coverageGaps(coverage: Coverage): readonly CoverageGap[] {
  return [
    ...missing("decider", shippedDeciders, coverage.deciders),
    ...missing("step label", reachableStepLabels, coverage.labels),
    ...missing("stepDescends exemption arm", exemptionArms, coverage.arms),
    ...missing("mc instance", mcInstances, coverage.instances),
    ...missing("nondet binder", boundBinderNames, coverage.binders),
    // THE DECLARED ARM IS SUBTRACTED FROM WHAT THE CORPUS OWES, and added back
    // as its own check below: `resumeArmsBeyondTheCorpus` says why, and the
    // check is what stops the declaration from outliving its reason.
    ...missing(
      "decideOpRetry resume arm",
      resumeArms.filter((arm) => !resumeArmsBeyondTheCorpus.includes(arm)),
      coverage.resumes,
    ),
    ...unexpected("decider", shippedDeciders, coverage.deciders),
    ...unexpected("step label", reachableStepLabels, coverage.labels),
    ...unexpected("stepDescends exemption arm", exemptionArms, coverage.arms),
    ...unexpected("decideOpRetry resume arm", resumeArms, coverage.resumes),
    ...resumeArmsBeyondTheCorpus
      .filter((arm) => coverage.resumes.has(arm))
      .map((arm) => ({
        obligation: "decideOpRetry resume arm",
        missing: `${arm} — declared beyond both tiers of the corpus, and a fixture reaches it`,
      })),
  ];
}

function missing(
  obligation: string,
  roster: readonly string[],
  reached: ReadonlySet<string>,
): readonly CoverageGap[] {
  return roster
    .filter((entry) => !reached.has(entry))
    .map((entry) => ({
      obligation,
      missing: `${entry} — no fixture reaches it`,
    }));
}

function unexpected(
  obligation: string,
  roster: readonly string[],
  reached: ReadonlySet<string>,
): readonly CoverageGap[] {
  return [...reached]
    .filter((entry) => !roster.includes(entry))
    .map((entry) => ({
      obligation,
      missing: `${entry} — reached, and the roster does not name it`,
    }));
}
