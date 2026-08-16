/**
 * THE REPLAYER — spine layer 1, to the letter: drive the shipped deciders
 * through a golden trace's own decisions, require the `StepRecord` and the
 * post-`Core` to come back EXACTLY, and evaluate the whole domain invariant
 * bundle after every step.
 *
 * WHAT IS COMPARED AT EACH STEP, and it is all four of the machine's vars
 * rather than the two the contract names. `tickets` and `lastStep` are the
 * decision's own output. The two step-history ghosts are the model's `apply`,
 * and comparing them is what puts `sysMeasure` and the retained-record snapshot
 * under the corpus too: `prevMeasure` is the measure of the state the step
 * departed from, so every trace is also a per-step pin of the measure
 * implementation against the model's, and `prevRecords` is that state's
 * retained records. Nothing about the machine's state is left uncompared.
 *
 * ENABLEMENT IS CHECKED BEFORE THE DECIDER RUNS, exactly as `journalLegalOn`
 * does and for its reason: the deciders assume their guards, so a decision the
 * state refuses must be REFUSED rather than crashed on. A refused decision is a
 * finding naming the command; it is never an exception.
 *
 * THE STUTTER STEPS ARE DRIVEN ACROSS THEIR WHOLE ABSORBING PICK CLASS.
 * `task-done-duplicate` and `complete-duplicate` record no transition and move
 * no state, so no pair of trace states carries the pick that produced them —
 * and replaying one guessed pick would prove less than the step claims. What
 * the step claims is that the decision ABSORBED, so every pick that could have
 * produced this label from this state is driven and each must return the
 * recorded noop and the identical state. Where the trace does carry the pick
 * (tier 1), it is driven too, so nothing recorded goes unchecked.
 *
 * A `settled` STEP DRIVES NO DECIDER, because the model has none for it:
 * `settle` is simulator plumbing, `refinement.qnt` journals no counterpart, and
 * `Cmd` has no constructor. What is checked instead is everything the action
 * itself says — the machine was quiet, the fleet did not move, and the record
 * is the settled noop exactly.
 *
 * WHY A FAILING BUNDLE IS REPORTED WITHOUT NAMING THE CONJUNCT. `invariants.ts`
 * ships the bundle as a plain conjunction and its twenty-four conjuncts
 * individually; asking each of them here to label the failure would put a
 * second copy of that roster in this file, which is the drift the checking
 * layer exists to catch. The fixture and the step index are in the finding, and
 * the conjunct is one call away with them in hand.
 */

import type { Config } from "../domain/domain.ts";
import type { Core, StepRecord } from "../domain/measure.ts";
import {
  cmdEnabled,
  completeDuplicateAbsorbingClass,
  execCmd,
  taskDoneAbsorbingClass,
  type Cmd,
} from "./cmd.ts";
import { diffCore, diffRecords, diffStepRecord } from "./compare.ts";
import { stepLabel, type StepPlan } from "./decode.ts";
import type { DecodedState, DecodedTrace } from "./itf.ts";
import {
  applyDecision,
  initialState,
  invariantsHold,
  quiet,
  settle,
  settledStepRecord,
  type MachineState,
} from "./machine.ts";
import type { CoverageBuilder } from "./coverage.ts";

/** One disagreement between the model's trace and this implementation. */
export type ReplayFinding = {
  /** The trace state the finding is about; 0 is the initial state. */
  readonly state: number;
  readonly detail: string;
};

export type ReplayReport = { readonly findings: readonly ReplayFinding[] };

/**
 * Replay one decoded trace at its fixture's consts, accumulating coverage.
 *
 * It walks the whole trace rather than stopping at the first finding: a corpus
 * regeneration that changed one decider tends to disagree at every step after
 * it, and the shape of that spread is what tells a reader which decider moved.
 */
export function replayTrace(
  cfg: Config,
  trace: DecodedTrace,
  plans: readonly StepPlan[],
  coverage: CoverageBuilder,
  where: string,
): ReplayReport {
  const findings: ReplayFinding[] = [];
  const genesis = trace.states[0];
  if (genesis === undefined) {
    return {
      findings: [{ state: 0, detail: `${where}: the trace has no states` }],
    };
  }
  let state = initialState(cfg);
  findings.push(...compareState(genesis, state, 0, "init"));
  observe(coverage, cfg, genesis, findings, 0, where);
  findings.push(...bundleFindings(cfg, state, 0));

  for (let i = 1; i < trace.states.length; i += 1) {
    const expected = trace.states[i];
    const plan = plans[i - 1];
    if (expected === undefined || plan === undefined) {
      findings.push({ state: i, detail: `${where}: no plan for this state` });
      break;
    }
    const stepped = takeStep(cfg, state, expected, plan, coverage, i, findings);
    if (stepped === undefined) {
      break;
    }
    state = stepped;
    findings.push(...compareState(expected, state, i, expected.lastStep.label));
    observe(coverage, cfg, expected, findings, i, where);
    findings.push(...bundleFindings(cfg, state, i));
  }
  return { findings };
}

/**
 * One step. Returns the machine state the trace's own decision produced, or
 * nothing when the step could not be taken at all — in which case the walk
 * stops, because every later state would be measured against a state this
 * implementation never reached.
 */
function takeStep(
  cfg: Config,
  state: MachineState,
  expected: DecodedState,
  plan: StepPlan,
  coverage: CoverageBuilder,
  index: number,
  findings: ReplayFinding[],
): MachineState | undefined {
  switch (plan.kind) {
    case "decided":
      return decidedStep(
        cfg,
        state,
        expected,
        plan.cmd,
        coverage,
        index,
        findings,
      );
    case "stutter":
      return stutterStep(cfg, state, expected, plan, coverage, index, findings);
    case "settled":
      return settledStep(cfg, state, expected, index, findings);
  }
}

function decidedStep(
  cfg: Config,
  state: MachineState,
  expected: DecodedState,
  cmd: Cmd,
  coverage: CoverageBuilder,
  index: number,
  findings: ReplayFinding[],
): MachineState | undefined {
  coverage.observeCmd(cmd);
  const decision = driveOne(
    cfg,
    state.core,
    cmd,
    expected.lastStep,
    index,
    findings,
  );
  if (decision === undefined) {
    return undefined;
  }
  return applyDecision(cfg, state, decision.value);
}

/**
 * The absorbing pick class, plus the pick the trace recorded when it has one.
 * Every member must be enabled, must return the recorded noop, and must leave
 * the fleet identical — the class IS the check, and a class with no members is
 * itself the finding.
 */
function stutterStep(
  cfg: Config,
  state: MachineState,
  expected: DecodedState,
  plan: Extract<StepPlan, { kind: "stutter" }>,
  coverage: CoverageBuilder,
  index: number,
  findings: ReplayFinding[],
): MachineState | undefined {
  const derived =
    plan.label === "task-done-duplicate"
      ? taskDoneAbsorbingClass(state.core)
      : completeDuplicateAbsorbingClass(state.core);
  const recorded = plan.recorded;
  const picks = recorded === undefined ? derived : [...derived, recorded];
  if (picks.length === 0) {
    findings.push({
      state: index,
      detail: `${plan.label}: no pick absorbs at this state, so the step is unreachable`,
    });
    return undefined;
  }
  let first: Decided | undefined;
  for (const cmd of picks) {
    coverage.observeCmd(cmd);
    const decision = driveOne(
      cfg,
      state.core,
      cmd,
      expected.lastStep,
      index,
      findings,
    );
    if (decision === undefined) {
      return undefined;
    }
    const moved = diffCore(
      state.core,
      decision.value.post,
      `${plan.label}.post`,
    );
    if (moved !== undefined) {
      findings.push({
        state: index,
        detail: `${plan.label} at ${render(cmd)} is not state-identical: ${moved}`,
      });
      return undefined;
    }
    first ??= decision;
  }
  return first === undefined
    ? undefined
    : applyDecision(cfg, state, first.value);
}

function settledStep(
  cfg: Config,
  state: MachineState,
  expected: DecodedState,
  index: number,
  findings: ReplayFinding[],
): MachineState | undefined {
  if (!quiet(cfg, state.core)) {
    findings.push({
      state: index,
      detail:
        "settled: the machine is not quiet, and settle is the dead-end stutter",
    });
    return undefined;
  }
  const record = diffStepRecord(
    settledStepRecord,
    expected.lastStep,
    "settled.rec",
  );
  if (record !== undefined) {
    findings.push({ state: index, detail: `settled: ${record}` });
    return undefined;
  }
  const moved = diffCore(state.core, expected.core, "settled.post");
  if (moved !== undefined) {
    findings.push({
      state: index,
      detail: `settled moved the fleet: ${moved}`,
    });
    return undefined;
  }
  return settle(cfg, state);
}

/** A decision that came back, boxed so `undefined` means "could not". */
type Decided = {
  readonly value: { readonly rec: StepRecord; readonly post: Core };
};

/**
 * Drive one command: refuse it if the state does not enable it, run it if the
 * state does, and require the record it returns to be the recorded one exactly.
 *
 * The decider is called inside a guard against its own assertions. It should
 * not throw — enablement has already been established — so a throw here is
 * reported as the finding it is rather than ending the gate: a gate that dies
 * produces no verdict, and "could not run" is a verdict this one has already
 * spent on decoding.
 */
function driveOne(
  cfg: Config,
  core: Core,
  cmd: Cmd,
  recorded: StepRecord,
  index: number,
  findings: ReplayFinding[],
): Decided | undefined {
  if (!cmdEnabled(cfg, core, cmd)) {
    findings.push({
      state: index,
      detail: `${render(cmd)} is not enabled at the replayed state, and the trace took it`,
    });
    return undefined;
  }
  let decision;
  try {
    decision = execCmd(cfg, core, cmd);
  } catch (error) {
    findings.push({
      state: index,
      detail: `${render(cmd)} threw: ${messageOf(error)}`,
    });
    return undefined;
  }
  const difference = diffStepRecord(recorded, decision.rec, "rec");
  if (difference !== undefined) {
    findings.push({
      state: index,
      detail: `${render(cmd)} recorded a different step: ${difference}`,
    });
    return undefined;
  }
  return { value: decision };
}

/** The four vars, compared against the trace's own state. */
function compareState(
  expected: DecodedState,
  actual: MachineState,
  index: number,
  label: string,
): readonly ReplayFinding[] {
  const differences = [
    diffCore(expected.core, actual.core, "tickets"),
    diffStepRecord(expected.lastStep, actual.lastStep, "lastStep"),
    expected.prevMeasure === actual.prevMeasure
      ? undefined
      : `prevMeasure: expected ${String(expected.prevMeasure)}, got ${String(actual.prevMeasure)}`,
    diffRecords(expected.prevRecords, actual.prevRecords, "prevRecords"),
  ];
  return differences
    .filter((d): d is string => d !== undefined)
    .map((detail) => ({ state: index, detail: `${label}: ${detail}` }));
}

/** The whole domain bundle, after every step. */
function bundleFindings(
  cfg: Config,
  state: MachineState,
  index: number,
): readonly ReplayFinding[] {
  try {
    if (invariantsHold(cfg, state)) {
      return [];
    }
    return [
      {
        state: index,
        detail: `${state.lastStep.label}: the domain invariant bundle is false after this step`,
      },
    ];
  } catch (error) {
    return [
      {
        state: index,
        detail: `${state.lastStep.label}: the domain invariant bundle threw: ${messageOf(error)}`,
      },
    ];
  }
}

/**
 * The label and the exemption arm this state reached. Observed from the TRACE's
 * own state rather than the replayed one, because coverage is a claim about
 * what the corpus contains; the two agree wherever the replay is green, and
 * where it is not the finding is already recorded.
 */
function observe(
  coverage: CoverageBuilder,
  cfg: Config,
  state: DecodedState,
  findings: ReplayFinding[],
  index: number,
  where: string,
): void {
  try {
    coverage.observeLabel(
      stepLabel(state.lastStep, `${where}.states[${String(index)}]`),
    );
    coverage.observeArm(cfg, state.core, state.lastStep);
  } catch (error) {
    findings.push({ state: index, detail: `coverage: ${messageOf(error)}` });
  }
}

function render(cmd: Cmd): string {
  return JSON.stringify(cmd, (_key, value: unknown) =>
    value instanceof Set ? [...value] : value,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
