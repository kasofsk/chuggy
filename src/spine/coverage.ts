/**
 * THE CORPUS'S COVERAGE OBLIGATIONS: which deciders, which step labels, which
 * `stepDescends` exemption arms and which instances the committed traces
 * actually reach. The emitter refuses to write a corpus that misses one and the
 * gate re-checks the same rosters, so an obligation is a property of the tree
 * rather than a claim in a description.
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
import type { Core, StepRecord } from "../domain/measure.ts";
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
};

/** A mutable accumulator, so a corpus walk needs no set unions per step. */
export class CoverageBuilder {
  private readonly deciders = new Set<string>();
  private readonly labels = new Set<StepLabel>();
  private readonly arms = new Set<ExemptionArm>();
  private readonly instances = new Set<string>();
  private readonly binders = new Set<string>();

  observeLabel(label: StepLabel): void {
    this.labels.add(label);
  }

  observeCmd(cmd: Cmd): void {
    for (const decider of decidersReached(cmd)) {
      this.deciders.add(decider);
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
  }

  taken(): Coverage {
    return {
      deciders: this.deciders,
      labels: this.labels,
      arms: this.arms,
      instances: this.instances,
      binders: this.binders,
    };
  }
}

/**
 * Every roster entry a fixture may PIN — the manifest's per-fixture claim about
 * what that fixture is in the corpus for, checked against what it actually
 * reaches.
 *
 * The three trace-observable rosters and no more: an instance is a manifest
 * field rather than something a trace says, and it is checked as its own
 * obligation.
 */
export const pinnableEntries: readonly string[] = [
  ...shippedDeciders,
  ...reachableStepLabels,
  ...exemptionArms,
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
 * THE INSTANCE OBLIGATION IS CHECKED ONE-WAY, and only that one: an instance
 * name is not observed from a trace but read from the manifest, where the
 * loader has already refused any name outside this roster. The other three are
 * observed from the traces themselves, where nothing has vetted them.
 */
export function coverageGaps(coverage: Coverage): readonly CoverageGap[] {
  return [
    ...missing("decider", shippedDeciders, coverage.deciders),
    ...missing("step label", reachableStepLabels, coverage.labels),
    ...missing("stepDescends exemption arm", exemptionArms, coverage.arms),
    ...missing("mc instance", mcInstances, coverage.instances),
    ...missing("nondet binder", boundBinderNames, coverage.binders),
    ...unexpected("decider", shippedDeciders, coverage.deciders),
    ...unexpected("step label", reachableStepLabels, coverage.labels),
    ...unexpected("stepDescends exemption arm", exemptionArms, coverage.arms),
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
