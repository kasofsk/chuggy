import {
  ContentRef,
  CycleNumber,
  EvaluationTaskId,
  EvaluatorKey,
  Generation,
  StageKey,
  TaskDefinition,
  TaskId,
  TaskObligation,
  TaskProcessFailed,
  TaskResultProduced,
  TaskTerminal,
  TicketId,
  ValidatedTaskResult,
  WorkspaceSource,
} from "./task.js";

export class EvaluatorDefinition {
  readonly kind = "EvaluatorDefinition";
  constructor(
    readonly key: EvaluatorKey,
    readonly task: TaskDefinition,
  ) {
    Object.freeze(this);
  }
}

export class StageDefinition {
  readonly kind = "StageDefinition";
  constructor(
    readonly key: StageKey,
    readonly evaluators: readonly EvaluatorDefinition[],
  ) {
    this.evaluators = Object.freeze([...evaluators]);

    Object.freeze(this);
  }
}

export class EvaluationPlan {
  readonly kind = "EvaluationPlan";
  constructor(readonly stages: readonly StageDefinition[]) {
    this.stages = Object.freeze([...stages]);

    Object.freeze(this);
  }
}

export class EvaluationInput {
  readonly kind = "EvaluationInput";
  constructor(
    readonly ticket: TicketId,
    readonly work_result: ContentRef,
    readonly accepted_source: WorkspaceSource,
  ) {
    Object.freeze(this);
  }
}

export class SummaryReason {
  readonly kind = "SummaryReason";
  constructor(readonly value: number) {
    Object.freeze(this);
  }
}

export class ExitCodeReason {
  readonly kind = "ExitCodeReason";
  constructor(readonly code: number) {
    Object.freeze(this);
  }
}

export type EvaluationReason = SummaryReason | ExitCodeReason;

export class EvaluationFinding {
  readonly kind = "EvaluationFinding";
  constructor(
    readonly id: number,
    readonly description: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class PassDetail {
  readonly kind = "PassDetail";
  constructor(
    readonly reason: EvaluationReason,
    readonly result_manifest: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class FailDetail {
  readonly kind = "FailDetail";
  constructor(
    readonly reason: EvaluationReason,
    readonly result_manifest: ContentRef,
    readonly findings: readonly EvaluationFinding[],
  ) {
    this.findings = Object.freeze([...findings]);
    validate_FailDetail(this);
    Object.freeze(this);
  }
}

export class EvaluatorPassed {
  readonly kind = "EvaluatorPassed";
  constructor(readonly detail: PassDetail) {
    Object.freeze(this);
  }
}

export class EvaluatorFailed {
  readonly kind = "EvaluatorFailed";
  constructor(readonly detail: FailDetail) {
    Object.freeze(this);
  }
}

export type EvaluatorResult = EvaluatorPassed | EvaluatorFailed;

export class Awaiting {
  readonly kind = "Awaiting";
  constructor() {
    Object.freeze(this);
  }
}

export class Produced {
  readonly kind = "Produced";
  constructor(readonly result: EvaluatorResult) {
    Object.freeze(this);
  }
}

export class EvaluatorProcessFailed {
  readonly kind = "EvaluatorProcessFailed";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export class EvaluatorExecutionUnavailable {
  readonly kind = "EvaluatorExecutionUnavailable";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export type EvaluatorStatus =
  Awaiting | Produced | EvaluatorProcessFailed | EvaluatorExecutionUnavailable;

export class EvaluationReworkEntry {
  readonly kind = "EvaluationReworkEntry";
  constructor(
    readonly evaluator: EvaluatorKey,
    readonly reason: EvaluationReason,
    readonly result_manifest: ContentRef,
    readonly findings: readonly EvaluationFinding[],
  ) {
    this.findings = Object.freeze([...findings]);
    validate_EvaluationReworkEntry(this);
    Object.freeze(this);
  }
}

export class StageRun {
  readonly kind = "StageRun";
  constructor(
    readonly stage_index: number,
    readonly generation: Generation,
    readonly evaluators: ReadonlyMap<EvaluatorKey, EvaluatorStatus>,
  ) {
    validate_StageRun(this);
    Object.freeze(this);
  }
}

export class EvaluationProgress {
  readonly kind = "EvaluationProgress";
  constructor(
    readonly completed_stages: readonly StageRun[],
    readonly stage: StageRun,
  ) {
    this.completed_stages = Object.freeze([...completed_stages]);

    Object.freeze(this);
  }
}

export class Running {
  readonly kind = "Running";
  constructor(readonly progress: EvaluationProgress) {
    Object.freeze(this);
  }
}

export class EvaluationPassed {
  readonly kind = "EvaluationPassed";
  constructor(readonly completed_stages: readonly StageRun[]) {
    this.completed_stages = Object.freeze([...completed_stages]);

    Object.freeze(this);
  }
}

export class EvaluationFailed {
  readonly kind = "EvaluationFailed";
  constructor(readonly completed_stages: readonly StageRun[]) {
    this.completed_stages = Object.freeze([...completed_stages]);

    Object.freeze(this);
  }
}

export class EvaluationBlocked {
  readonly kind = "EvaluationBlocked";
  constructor(readonly progress: EvaluationProgress) {
    Object.freeze(this);
  }
}

export type EvaluationState =
  Running | EvaluationPassed | EvaluationFailed | EvaluationBlocked;

export class EvaluationInstance {
  readonly kind = "EvaluationInstance";
  constructor(
    readonly work_cycle: CycleNumber,
    readonly input: EvaluationInput,
    readonly plan: EvaluationPlan,
    readonly state: EvaluationState,
  ) {
    Object.freeze(this);
  }
}

import { equal } from "./task.js";
export const MAX_FINDINGS = 32;
export function finding_valid(f: EvaluationFinding): boolean {
  return f.id > 0 && f.description > 0;
}
export function findings_valid(fs: readonly EvaluationFinding[]): boolean {
  return (
    fs.length <= MAX_FINDINGS &&
    fs.every(finding_valid) &&
    new Set(fs.map((f) => f.id)).size === fs.length
  );
}
function validate_FailDetail(v: FailDetail): void {
  if (!findings_valid(v.findings)) throw new Error("findings are not valid");
}
function validate_EvaluationReworkEntry(v: EvaluationReworkEntry): void {
  if (!findings_valid(v.findings)) throw new Error("findings are not valid");
}
function validate_StageRun(v: StageRun): void {
  Object.defineProperty(v, "evaluators", {
    value: new Map(v.evaluators),
    enumerable: true,
  });
}
export function evaluator_task_id(
  ticket: TicketId,
  work_cycle: CycleNumber,
  stage: StageKey,
  generation: Generation,
  evaluator: EvaluatorKey,
): TaskId {
  return new EvaluationTaskId(ticket, work_cycle, stage, generation, evaluator);
}
export function task_id_for(
  current: EvaluationInstance,
  progress: StageRun,
  evaluator: EvaluatorKey,
): TaskId {
  return evaluator_task_id(
    current.input.ticket,
    current.work_cycle,
    current.plan.stages[progress.stage_index]!.key,
    progress.generation,
    evaluator,
  );
}
export function evaluator_keys(
  stage: StageDefinition,
): ReadonlySet<EvaluatorKey> {
  return new Set(stage.evaluators.map((e) => e.key));
}
export function evaluator_key_for_task(
  current: EvaluationInstance,
  progress: StageRun,
  task: TaskId,
): EvaluatorKey {
  for (const entry of current.plan.stages[progress.stage_index]!.evaluators)
    if (equal(task_id_for(current, progress, entry.key), task))
      return entry.key;
  throw new Error("no evaluator of the active stage owns task");
}
export function initial_stage_run(
  stage: StageDefinition,
  stage_index: number,
): StageRun {
  return new StageRun(
    stage_index,
    Generation(1),
    new Map(stage.evaluators.map((e) => [e.key, new Awaiting()])),
  );
}
export function is_awaiting(s: EvaluatorStatus): boolean {
  return s instanceof Awaiting;
}
export function is_failed(s: EvaluatorStatus): boolean {
  return s instanceof Produced && s.result instanceof EvaluatorFailed;
}
export function is_blocked(s: EvaluatorStatus): boolean {
  return (
    s instanceof EvaluatorProcessFailed ||
    s instanceof EvaluatorExecutionUnavailable
  );
}
export function stage_has_awaiting(p: StageRun): boolean {
  return [...p.evaluators.values()].some(is_awaiting);
}
export function stage_has_failed(p: StageRun): boolean {
  return [...p.evaluators.values()].some(is_failed);
}
export function stage_has_blocked(p: StageRun): boolean {
  return [...p.evaluators.values()].some(is_blocked);
}
export function state_stage_complete(s: EvaluationState): boolean {
  return s instanceof Running && !stage_has_awaiting(s.progress.stage);
}
export function is_current_stage_complete(v: EvaluationInstance): boolean {
  return state_stage_complete(v.state);
}
export function task_current(c: EvaluationInstance, t: TaskId): boolean {
  if (!(c.state instanceof Running)) return false;
  const p = c.state.progress.stage;
  return [...p.evaluators].some(
    ([key, s]) => is_awaiting(s) && equal(task_id_for(c, p, key), t),
  );
}
function with_state(
  c: EvaluationInstance,
  state: EvaluationState,
): EvaluationInstance {
  return new EvaluationInstance(c.work_cycle, c.input, c.plan, state);
}
function _with_status(
  c: EvaluationInstance,
  p: EvaluationProgress,
  key: EvaluatorKey,
  s: EvaluatorStatus,
): EvaluationInstance {
  const entries = new Map(p.stage.evaluators);
  entries.set(key, s);
  return with_state(
    c,
    new Running(
      new EvaluationProgress(
        p.completed_stages,
        new StageRun(p.stage.stage_index, p.stage.generation, entries),
      ),
    ),
  );
}
function _conclude_stage(c: EvaluationInstance): EvaluationInstance {
  if (!(c.state instanceof Running)) return c;
  const p = c.state.progress,
    stage = p.stage,
    completed = [...p.completed_stages, stage];
  if (stage_has_awaiting(stage)) return c;
  if (stage_has_failed(stage))
    return with_state(c, new EvaluationFailed(completed));
  if (stage_has_blocked(stage)) return with_state(c, new EvaluationBlocked(p));
  if (stage.stage_index + 1 === c.plan.stages.length)
    return with_state(c, new EvaluationPassed(completed));
  const index = stage.stage_index + 1;
  return with_state(
    c,
    new Running(
      new EvaluationProgress(
        completed,
        initial_stage_run(c.plan.stages[index]!, index),
      ),
    ),
  );
}
export function decode_evaluator_result(
  r: ValidatedTaskResult,
): EvaluatorResult {
  const reason = new SummaryReason(r.value);
  return r.value > 0
    ? new EvaluatorPassed(new PassDetail(reason, r.manifest))
    : new EvaluatorFailed(
        new FailDetail(
          reason,
          r.manifest,
          r.findings.map((f) => new EvaluationFinding(f.id, f.description)),
        ),
      );
}
export function apply_terminal(
  c: EvaluationInstance,
  task: TaskId,
  t: TaskTerminal,
): EvaluationInstance {
  let recorded = c;
  if (c.state instanceof Running && task_current(c, task)) {
    const status =
      t instanceof TaskResultProduced
        ? new Produced(decode_evaluator_result(t.result))
        : t instanceof TaskProcessFailed
          ? new EvaluatorProcessFailed(t.failure.evidence)
          : new EvaluatorExecutionUnavailable(t.failure.evidence);
    recorded = _with_status(
      c,
      c.state.progress,
      evaluator_key_for_task(c, c.state.progress.stage, task),
      status,
    );
  }
  return _conclude_stage(recorded);
}
export function resume_blocked(c: EvaluationInstance): EvaluationInstance {
  if (!(c.state instanceof EvaluationBlocked)) return c;
  const p = c.state.progress,
    s = p.stage;
  return with_state(
    c,
    new Running(
      new EvaluationProgress(
        p.completed_stages,
        new StageRun(
          s.stage_index,
          Generation(s.generation + 1),
          new Map(
            [...s.evaluators].map(([key, status]) => [
              key,
              is_blocked(status) ? new Awaiting() : status,
            ]),
          ),
        ),
      ),
    ),
  );
}
export function current_task_obligations(
  c: EvaluationInstance,
): readonly TaskObligation[] {
  if (!(c.state instanceof Running)) return [];
  const p = c.state.progress.stage;
  return c.plan.stages[p.stage_index]!.evaluators.filter((e) =>
    is_awaiting(p.evaluators.get(e.key)!),
  ).map(
    (e) =>
      new TaskObligation(
        task_id_for(c, p, e.key),
        e.task,
        c.input.accepted_source,
        [c.input.work_result],
      ),
  );
}
export function failed_entries(
  key: EvaluatorKey,
  s: EvaluatorStatus,
): readonly EvaluationReworkEntry[] {
  return s instanceof Produced && s.result instanceof EvaluatorFailed
    ? [
        new EvaluationReworkEntry(
          key,
          s.result.detail.reason,
          s.result.detail.result_manifest,
          s.result.detail.findings,
        ),
      ]
    : [];
}
export function rework_entries(
  c: EvaluationInstance,
  completed: readonly StageRun[],
): readonly EvaluationReworkEntry[] {
  const s = completed.at(-1);
  if (!s) throw new Error("rework entries need a concluded stage");
  return c.plan.stages[s.stage_index]!.evaluators.flatMap((e) =>
    failed_entries(e.key, s.evaluators.get(e.key)!),
  );
}
export function stage_run_invariant(
  c: EvaluationInstance,
  p: StageRun,
): boolean {
  if (
    p.stage_index < 0 ||
    p.stage_index >= c.plan.stages.length ||
    p.generation <= 0 ||
    !equal(
      new Set(p.evaluators.keys()),
      evaluator_keys(c.plan.stages[p.stage_index]!),
    )
  )
    return false;
  return [...p.evaluators.values()].every((s) =>
    s instanceof Awaiting
      ? true
      : s instanceof Produced
        ? s.result.detail.result_manifest > 0 &&
          (!(s.result instanceof EvaluatorFailed) ||
            findings_valid(s.result.detail.findings))
        : s.evidence > 0,
  );
}
export function stage_passed(s: StageRun): boolean {
  return !(
    stage_has_awaiting(s) ||
    stage_has_failed(s) ||
    stage_has_blocked(s)
  );
}
export function completed_history_invariant(
  c: EvaluationInstance,
  stages: readonly StageRun[],
): boolean {
  return stages.every(
    (s, i) =>
      s.stage_index === i &&
      stage_run_invariant(c, s) &&
      !stage_has_awaiting(s) &&
      (i + 1 === stages.length || stage_passed(s)),
  );
}
export function state_history_invariant(c: EvaluationInstance): boolean {
  const s = c.state;
  if (s instanceof Running || s instanceof EvaluationBlocked) {
    const p = s.progress;
    return (
      completed_history_invariant(c, p.completed_stages) &&
      stage_run_invariant(c, p.stage) &&
      p.completed_stages.length === p.stage.stage_index &&
      (s instanceof Running
        ? stage_has_awaiting(p.stage)
        : !stage_has_awaiting(p.stage) &&
          !stage_has_failed(p.stage) &&
          stage_has_blocked(p.stage))
    );
  }
  return (
    completed_history_invariant(c, s.completed_stages) &&
    (s instanceof EvaluationPassed
      ? s.completed_stages.length === c.plan.stages.length &&
        s.completed_stages.every(stage_passed)
      : s.completed_stages.length > 0 &&
        stage_has_failed(s.completed_stages.at(-1)!))
  );
}
export function begin(
  work_cycle: CycleNumber,
  input: EvaluationInput,
  plan: EvaluationPlan,
): EvaluationInstance {
  if (!plan.stages.length)
    throw new Error("an evaluation plan has at least one stage");
  return new EvaluationInstance(
    work_cycle,
    input,
    plan,
    new Running(
      new EvaluationProgress([], initial_stage_run(plan.stages[0]!, 0)),
    ),
  );
}
export function stage_keys_unique(plan: EvaluationPlan): boolean {
  return new Set(plan.stages.map((s) => s.key)).size === plan.stages.length;
}
export function evaluator_keys_unique(stage: StageDefinition): boolean {
  return evaluator_keys(stage).size === stage.evaluators.length;
}
export function plan_valid(plan: EvaluationPlan): boolean {
  return (
    plan.stages.length > 0 &&
    stage_keys_unique(plan) &&
    plan.stages.every(
      (s) =>
        s.key > 0 &&
        s.evaluators.length > 0 &&
        evaluator_keys_unique(s) &&
        s.evaluators.every((e) => e.key > 0),
    )
  );
}
export function plan_uses_repository(
  plan: EvaluationPlan,
  r: ContentRef,
): boolean {
  return plan.stages.every((s) =>
    s.evaluators.every((e) => e.task.execution_requirements.repository === r),
  );
}
export function validate_plan(plan: EvaluationPlan, r: ContentRef): boolean {
  return plan_valid(plan) && plan_uses_repository(plan, r);
}
export function evaluation_invariant(c: EvaluationInstance): boolean {
  return (
    c.work_cycle > 0 &&
    c.input.ticket > 0 &&
    c.input.work_result > 0 &&
    c.input.accepted_source.repository > 0 &&
    c.input.accepted_source.commit > 0 &&
    validate_plan(c.plan, c.input.accepted_source.repository) &&
    state_history_invariant(c)
  );
}
