import {
  ContentRef,
  CycleNumber,
  EvaluatorKey,
  Generation,
  StageKey,
  TaskDefinition,
  TaskId,
  TaskObligation,
  TaskTerminal,
  TicketId,
  ValidatedTaskResult,
} from "./task.js";
export declare class EvaluatorDefinition {
  readonly key: EvaluatorKey;
  readonly task: TaskDefinition;
  readonly kind = "EvaluatorDefinition";
  constructor(key: EvaluatorKey, task: TaskDefinition);
}
export declare class StageDefinition {
  readonly key: StageKey;
  readonly evaluators: readonly EvaluatorDefinition[];
  readonly kind = "StageDefinition";
  constructor(key: StageKey, evaluators: readonly EvaluatorDefinition[]);
}
export declare class EvaluationPlan {
  readonly stages: readonly StageDefinition[];
  readonly kind = "EvaluationPlan";
  constructor(stages: readonly StageDefinition[]);
}
export declare class EvaluationInput {
  readonly ticket: TicketId;
  readonly work_result: ContentRef;
  readonly accepted_source_ref: ContentRef;
  readonly kind = "EvaluationInput";
  constructor(
    ticket: TicketId,
    work_result: ContentRef,
    accepted_source_ref: ContentRef,
  );
}
export declare class EvaluatorPass {
  readonly kind = "EvaluatorPass";
  constructor();
}
export declare class EvaluatorFail {
  readonly kind = "EvaluatorFail";
  constructor();
}
export type EvaluationVerdict = EvaluatorPass | EvaluatorFail;
export declare class EvaluatorPassed {
  readonly result_ref: ContentRef;
  readonly kind = "EvaluatorPassed";
  constructor(result_ref: ContentRef);
}
export declare class EvaluatorFailed {
  readonly result_ref: ContentRef;
  readonly kind = "EvaluatorFailed";
  constructor(result_ref: ContentRef);
}
export type EvaluatorResult = EvaluatorPassed | EvaluatorFailed;
export declare class Awaiting {
  readonly kind = "Awaiting";
  constructor();
}
export declare class Produced {
  readonly result: EvaluatorResult;
  readonly kind = "Produced";
  constructor(result: EvaluatorResult);
}
export declare class EvaluatorProcessFailed {
  readonly evidence: ContentRef;
  readonly kind = "EvaluatorProcessFailed";
  constructor(evidence: ContentRef);
}
export declare class EvaluatorExecutionUnavailable {
  readonly evidence: ContentRef;
  readonly kind = "EvaluatorExecutionUnavailable";
  constructor(evidence: ContentRef);
}
export type EvaluatorStatus =
  Awaiting | Produced | EvaluatorProcessFailed | EvaluatorExecutionUnavailable;
export declare class EvaluationReworkEntry {
  readonly evaluator: EvaluatorKey;
  readonly result_ref: ContentRef;
  readonly kind = "EvaluationReworkEntry";
  constructor(evaluator: EvaluatorKey, result_ref: ContentRef);
}
export declare class StageRun {
  readonly stage_index: number;
  readonly generation: Generation;
  readonly evaluators: ReadonlyMap<EvaluatorKey, EvaluatorStatus>;
  readonly kind = "StageRun";
  constructor(
    stage_index: number,
    generation: Generation,
    evaluators: ReadonlyMap<EvaluatorKey, EvaluatorStatus>,
  );
}
export declare class EvaluationProgress {
  readonly completed_stages: readonly StageRun[];
  readonly stage: StageRun;
  readonly kind = "EvaluationProgress";
  constructor(completed_stages: readonly StageRun[], stage: StageRun);
}
export declare class Running {
  readonly progress: EvaluationProgress;
  readonly kind = "Running";
  constructor(progress: EvaluationProgress);
}
export declare class EvaluationPassed {
  readonly completed_stages: readonly StageRun[];
  readonly kind = "EvaluationPassed";
  constructor(completed_stages: readonly StageRun[]);
}
export declare class EvaluationFailed {
  readonly completed_stages: readonly StageRun[];
  readonly kind = "EvaluationFailed";
  constructor(completed_stages: readonly StageRun[]);
}
export declare class EvaluationBlocked {
  readonly progress: EvaluationProgress;
  readonly kind = "EvaluationBlocked";
  constructor(progress: EvaluationProgress);
}
export type EvaluationState =
  Running | EvaluationPassed | EvaluationFailed | EvaluationBlocked;
export declare class EvaluationInstance {
  readonly work_cycle: CycleNumber;
  readonly input: EvaluationInput;
  readonly plan: EvaluationPlan;
  readonly state: EvaluationState;
  readonly kind = "EvaluationInstance";
  constructor(
    work_cycle: CycleNumber,
    input: EvaluationInput,
    plan: EvaluationPlan,
    state: EvaluationState,
  );
}
export declare function evaluator_task_id(
  ticket: TicketId,
  work_cycle: CycleNumber,
  stage: StageKey,
  generation: Generation,
  evaluator: EvaluatorKey,
): TaskId;
export declare function task_id_for(
  current: EvaluationInstance,
  progress: StageRun,
  evaluator: EvaluatorKey,
): TaskId;
export declare function evaluator_keys(
  stage: StageDefinition,
): ReadonlySet<EvaluatorKey>;
export declare function evaluator_key_for_task(
  current: EvaluationInstance,
  progress: StageRun,
  task: TaskId,
): EvaluatorKey;
export declare function initial_stage_run(
  stage: StageDefinition,
  stage_index: number,
): StageRun;
export declare function is_awaiting(s: EvaluatorStatus): boolean;
export declare function is_failed(s: EvaluatorStatus): boolean;
export declare function is_blocked(s: EvaluatorStatus): boolean;
export declare function stage_has_awaiting(p: StageRun): boolean;
export declare function stage_has_failed(p: StageRun): boolean;
export declare function stage_has_blocked(p: StageRun): boolean;
export declare function state_stage_complete(s: EvaluationState): boolean;
export declare function is_current_stage_complete(
  v: EvaluationInstance,
): boolean;
export declare function task_current(c: EvaluationInstance, t: TaskId): boolean;
export declare function apply_produced(
  c: EvaluationInstance,
  task: TaskId,
  result: ValidatedTaskResult,
  verdict: EvaluationVerdict,
): EvaluationInstance;
export declare function apply_failure(
  c: EvaluationInstance,
  task: TaskId,
  terminal: TaskTerminal,
): EvaluationInstance;
export declare function resume_blocked(
  c: EvaluationInstance,
): EvaluationInstance;
export declare function current_task_obligations(
  c: EvaluationInstance,
): readonly TaskObligation[];
export declare function failed_entries(
  key: EvaluatorKey,
  s: EvaluatorStatus,
): readonly EvaluationReworkEntry[];
export declare function rework_entries(
  c: EvaluationInstance,
  completed: readonly StageRun[],
): readonly EvaluationReworkEntry[];
export declare function stage_run_invariant(
  c: EvaluationInstance,
  p: StageRun,
): boolean;
export declare function stage_passed(s: StageRun): boolean;
export declare function completed_history_invariant(
  c: EvaluationInstance,
  stages: readonly StageRun[],
): boolean;
export declare function state_history_invariant(c: EvaluationInstance): boolean;
export declare function begin(
  work_cycle: CycleNumber,
  input: EvaluationInput,
  plan: EvaluationPlan,
): EvaluationInstance;
export declare function stage_keys_unique(plan: EvaluationPlan): boolean;
export declare function evaluator_keys_unique(stage: StageDefinition): boolean;
export declare function plan_valid(plan: EvaluationPlan): boolean;
export declare function evaluation_invariant(c: EvaluationInstance): boolean;
