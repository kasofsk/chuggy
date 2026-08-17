/**
 * The seeded walk: the machine driven by its own enablement predicates and the
 * model's own draw sets, with the whole invariant bundle and the per-ticket
 * completion-emission accumulator asserted after every step.
 *
 * A RUN IS A PURE FUNCTION OF ITS SEED. Every choice — which enabled action,
 * and each of that action's draws — comes from one seeded generator, so the
 * seed and the instance name reproduce the run exactly, and that pair is what
 * a failure carries.
 *
 * EVERY DECISION GOES THROUGH THE CONFORMANCE DISPATCH TABLE, picks encoded the
 * way the corpus wires them, so the walk exercises the same route a replayed
 * golden takes and a counterexample written from it replays through the same
 * arms. `settle` is drawn only when the model's `quiet` holds and stutters,
 * exactly as the model's `step` does.
 *
 * THE ACCUMULATOR IS THE MODEL'S `completions` GHOST REBUILT FROM THE EFFECT
 * STREAM. `test/domain/invariants.test.ts` says why no single state this tree
 * can build refutes `completionExclusive`: the count is derived from the phase,
 * so the disagreement can only exist across time, in the emissions themselves.
 * Here every `Complete` effect is charged to the stepped ticket and the
 * per-ticket predicate is asked after every step, so a decider that emits a
 * second completion — or completes without emitting — goes red with the whole
 * bundle green, which no golden subsumes because no golden constrains a walk
 * nobody recorded.
 *
 * `walkInit` IS THE FIRST INIT OUTSIDE THE MODEL, and it refuses what the
 * model's `init` refuses: a gasless instantiation has no initial state at all,
 * and the other well-formedness conjuncts hold or there is nothing to walk.
 */

import type { Config } from "../../src/domain/config.ts";
import type { Core, Decision, StepRecord } from "../../src/domain/core.ts";
import { liveTickets, ticketAt } from "../../src/domain/core.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import { completionExclusiveFor } from "../../src/domain/invariants.ts";
import { reworkBudget, wrapUpBudget } from "../../src/domain/pricing.ts";
import { replayStep, type Picks } from "../conformance/dispatch.ts";
import { bundleHolds, evaluateBundle } from "../conformance/evaluate.ts";
import { initialView } from "../domain/fixtures.ts";
import { drawnPicks, walkActionOf, walkActions, type Drawn } from "./draws.ts";
import { pickFrom, randomOf } from "./random.ts";

/** The step bound every run takes in full, the same bound the model gate samples under. */
export const walkStepsMax = 40;

/** How a step becomes a decision; the seam a suite injects a broken decider through. */
export type Decide = (
  config: Config,
  core: Core,
  action: string,
  picks: Picks,
) => Decision;

/** The default: the conformance dispatch table, exactly as a replayed golden routes. */
export const decideViaTable: Decide = (config, core, action, picks) =>
  replayStep(config, core, action, picks);

/** One step as the walk took it: the action's name and its draws. */
export interface WalkStep {
  readonly action: string;
  readonly drawn: Drawn;
}

/** What one red step reports: the leaves, the refusals, the accumulator, or the break. */
export interface StepFailure {
  readonly failed: readonly string[];
  readonly refused: readonly string[];
  readonly emissions: readonly string[];
  readonly broke: string | undefined;
}

/** A finding, placed: which step of the trace, under which action. */
export interface WalkFinding {
  readonly step: number;
  readonly action: string;
  readonly failure: StepFailure;
}

/** A whole run: the trace as taken, and the finding that ended it if one did. */
export interface WalkOutcome {
  readonly steps: readonly WalkStep[];
  readonly finding: WalkFinding | undefined;
}

/**
 * The initial state, refusing every instantiation the model's `init` refuses.
 * The gas conjunct is the required-account rule: a gasless graph is invalid,
 * not merely unmetered, and there is no state to walk from.
 */
export function walkInit(config: Config): Core {
  const refusals: string[] = [];
  if (config.gas < 1) {
    refusals.push(
      "a gasless graph is invalid: gas >= 1 or there is no initial state",
    );
  }
  if (config.nTasks < 1) refusals.push("a phase carries a real task set");
  if (config.nTickets < 1) {
    refusals.push("the arrival bound must admit at least one ticket");
  }
  if (config.maxStages < 1) {
    refusals.push("at least one authorable program must exist");
  }
  if (config.nProjects < 1) refusals.push("a ticket needs a project to target");
  if (reworkBudget(config.reworkPolicy) < 0) {
    refusals.push("the rework account cannot open overdrawn");
  }
  if (wrapUpBudget(config.wrapUpPricing) < 0) {
    refusals.push("the wrap-up account cannot open overdrawn");
  }
  if (refusals.length > 0) {
    throw new Error(`walk: no initial state: ${refusals.join("; ")}`);
  }
  return { tickets: new Map() };
}

/** Completion emissions per ticket, accumulated across one run's record stream. */
export type CompletionCounts = Map<TicketId, number>;

/**
 * Charge a step's `Complete` emissions to the ticket the step was drawn for.
 * A completion on a step with no stepped ticket has no subject to charge and is
 * itself the finding.
 */
export function creditCompletions(
  counts: CompletionCounts,
  subject: TicketId | undefined,
  rec: StepRecord,
): readonly string[] {
  const emitted = rec.effects.filter((effect) => effect === "Complete").length;
  if (emitted === 0) return [];
  if (subject === undefined) {
    return [
      `a Complete effect on a "${rec.label}" step with no drawn ticket to charge it to`,
    ];
  }
  counts.set(subject, (counts.get(subject) ?? 0) + emitted);
  return [];
}

/** The accumulator's verdict: the model's ghost conjunction, per live ticket, over the counted stream. */
export function completionFindings(
  counts: CompletionCounts,
  core: Core,
): readonly string[] {
  return liveTickets(core).flatMap((id) => {
    const emitted = counts.get(id) ?? 0;
    const phase = ticketAt(core, id).phase;
    return completionExclusiveFor(emitted, phase)
      ? []
      : [
          `ticket ${String(id)}: ${String(emitted)} Complete emission(s) with phase ${phase}`,
        ];
  });
}

/** A failure that is neither a leaf nor the accumulator: a refusal or a throw. */
function brokenFailure(why: string): StepFailure {
  return { failed: [], refused: [], emissions: [], broke: why };
}

type StepOutcome =
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "threw"; readonly why: string }
  | {
      readonly kind: "stepped";
      readonly decision: Decision;
      readonly failure: StepFailure | undefined;
    };

/**
 * One step applied: the guard and the draw membership first, then the decision,
 * then the accumulator and the whole bundle on `{pre, rec, post}`.
 */
function walkStepOutcome(
  config: Config,
  core: Core,
  counts: CompletionCounts,
  step: WalkStep,
  decide: Decide,
): StepOutcome {
  const acted = walkActionOf(step.action);
  if (!acted.enabledIn(config, core)) {
    return { kind: "refused", why: `${step.action} is not enabled here` };
  }
  if (!acted.permitsIn(config, core, step.drawn)) {
    return {
      kind: "refused",
      why: `${step.action} does not permit this draw here`,
    };
  }
  let decision: Decision;
  try {
    decision = decide(config, core, step.action, drawnPicks(step.drawn));
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return { kind: "threw", why };
  }
  const emissions = [
    ...creditCompletions(counts, step.drawn.ticket, decision.rec),
    ...completionFindings(counts, decision.post),
  ];
  const verdict = evaluateBundle(config, {
    pre: core,
    rec: decision.rec,
    post: decision.post,
  });
  const failure =
    bundleHolds(verdict) && emissions.length === 0
      ? undefined
      : {
          failed: verdict.failed,
          refused: verdict.refused,
          emissions,
          broke: undefined,
        };
  return { kind: "stepped", decision, failure };
}

/**
 * One seeded run of the machine: enabled actions from the enablement
 * predicates, the action and its picks drawn, the bundle and the accumulator
 * asserted after every step, the trace kept for shrinking.
 */
export function walkRun(
  config: Config,
  seed: number,
  stepsMax: number,
  decide: Decide = decideViaTable,
): WalkOutcome {
  const random = randomOf(seed);
  let core = walkInit(config);
  const opening = evaluateBundle(config, initialView(core));
  if (!bundleHolds(opening)) {
    const failure = {
      failed: opening.failed,
      refused: opening.refused,
      emissions: [],
      broke: undefined,
    };
    return { steps: [], finding: { step: 0, action: "init", failure } };
  }
  const counts: CompletionCounts = new Map();
  const steps: WalkStep[] = [];
  for (let index = 1; index <= stepsMax; index++) {
    const enabled = walkActions.filter((entry) =>
      entry.enabledIn(config, core),
    );
    if (enabled.length === 0) {
      const why =
        "no action is enabled, and the model proves the stutter covers every dead end";
      return {
        steps,
        finding: { step: index, action: "step", failure: brokenFailure(why) },
      };
    }
    const acted = pickFrom(random, enabled);
    const step: WalkStep = {
      action: acted.action,
      drawn: acted.drawIn(config, core, random),
    };
    steps.push(step);
    const outcome = walkStepOutcome(config, core, counts, step, decide);
    if (outcome.kind !== "stepped") {
      const why =
        outcome.kind === "refused"
          ? `the machine refused its own draw: ${outcome.why}`
          : `the decider threw: ${outcome.why}`;
      const finding = {
        step: index,
        action: step.action,
        failure: brokenFailure(why),
      };
      return { steps, finding };
    }
    if (outcome.failure !== undefined) {
      return {
        steps,
        finding: { step: index, action: step.action, failure: outcome.failure },
      };
    }
    core = outcome.decision.post;
  }
  return { steps, finding: undefined };
}

/** A replayed candidate's verdict: not a machine trace, a clean one, or one that still fails. */
export type ReplayOutcome =
  | { readonly kind: "invalid"; readonly at: number; readonly why: string }
  | { readonly kind: "clean" }
  | {
      readonly kind: "finding";
      readonly at: number;
      readonly finding: WalkFinding;
    };

/**
 * Replays recorded steps through the same per-step application the run used,
 * checking each draw's membership at the state it meets. The shrinker's oracle.
 */
export function walkReplay(
  config: Config,
  steps: readonly WalkStep[],
  decide: Decide = decideViaTable,
): ReplayOutcome {
  let core = walkInit(config);
  const counts: CompletionCounts = new Map();
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step === undefined) {
      throw new Error(`walk: no step ${String(index)} to replay`);
    }
    const at = index + 1;
    const outcome = walkStepOutcome(config, core, counts, step, decide);
    if (outcome.kind === "refused") {
      return { kind: "invalid", at, why: outcome.why };
    }
    if (outcome.kind === "threw") {
      const finding = {
        step: at,
        action: step.action,
        failure: brokenFailure(`the decider threw: ${outcome.why}`),
      };
      return { kind: "finding", at, finding };
    }
    if (outcome.failure !== undefined) {
      const finding = {
        step: at,
        action: step.action,
        failure: outcome.failure,
      };
      return { kind: "finding", at, finding };
    }
    core = outcome.decision.post;
  }
  return { kind: "clean" };
}

/** A step with the decision it produced, which is what a written counterexample records. */
export interface RecordedStep {
  readonly step: WalkStep;
  readonly decision: Decision;
}

/**
 * Replays steps and keeps every decision, for encoding into the corpus format.
 * A candidate that is not a machine trace has no states to record and throws.
 */
export function walkRecord(
  config: Config,
  steps: readonly WalkStep[],
  decide: Decide = decideViaTable,
): readonly RecordedStep[] {
  let core = walkInit(config);
  const counts: CompletionCounts = new Map();
  const recorded: RecordedStep[] = [];
  for (const step of steps) {
    const outcome = walkStepOutcome(config, core, counts, step, decide);
    if (outcome.kind !== "stepped") {
      throw new Error(
        `walk: ${step.action} cannot be recorded here: ${outcome.why}`,
      );
    }
    recorded.push({ step, decision: outcome.decision });
    core = outcome.decision.post;
  }
  return recorded;
}
