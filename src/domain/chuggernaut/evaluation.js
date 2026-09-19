import {
  ContextRef,
  EvaluationTaskId,
  Generation,
  TaskObligation,
  TaskProcessFailed,
  TaskResultProduced,
} from "./task.js";
export class EvaluatorDefinition {
  key;
  task;
  kind = "EvaluatorDefinition";
  constructor(key, task) {
    this.key = key;
    this.task = task;
    Object.freeze(this);
  }
}
export class StageDefinition {
  key;
  evaluators;
  kind = "StageDefinition";
  constructor(key, evaluators) {
    this.key = key;
    this.evaluators = evaluators;
    this.evaluators = Object.freeze([...evaluators]);
    Object.freeze(this);
  }
}
export class EvaluationPlan {
  stages;
  kind = "EvaluationPlan";
  constructor(stages) {
    this.stages = stages;
    this.stages = Object.freeze([...stages]);
    Object.freeze(this);
  }
}
export class EvaluationInput {
  ticket;
  work_result;
  accepted_source_ref;
  kind = "EvaluationInput";
  constructor(ticket, work_result, accepted_source_ref) {
    this.ticket = ticket;
    this.work_result = work_result;
    this.accepted_source_ref = accepted_source_ref;
    Object.freeze(this);
  }
}
export class EvaluatorPass {
  kind = "EvaluatorPass";
  constructor() {
    Object.freeze(this);
  }
}
export class EvaluatorFail {
  kind = "EvaluatorFail";
  constructor() {
    Object.freeze(this);
  }
}
export class EvaluatorPassed {
  result_ref;
  kind = "EvaluatorPassed";
  constructor(result_ref) {
    this.result_ref = result_ref;
    Object.freeze(this);
  }
}
export class EvaluatorFailed {
  result_ref;
  kind = "EvaluatorFailed";
  constructor(result_ref) {
    this.result_ref = result_ref;
    Object.freeze(this);
  }
}
export class Awaiting {
  kind = "Awaiting";
  constructor() {
    Object.freeze(this);
  }
}
export class Produced {
  result;
  kind = "Produced";
  constructor(result) {
    this.result = result;
    Object.freeze(this);
  }
}
export class EvaluatorProcessFailed {
  evidence;
  kind = "EvaluatorProcessFailed";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class EvaluatorExecutionUnavailable {
  evidence;
  kind = "EvaluatorExecutionUnavailable";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class EvaluationReworkEntry {
  evaluator;
  result_ref;
  kind = "EvaluationReworkEntry";
  constructor(evaluator, result_ref) {
    this.evaluator = evaluator;
    this.result_ref = result_ref;
    Object.freeze(this);
  }
}
export class StageRun {
  stage_index;
  generation;
  evaluators;
  kind = "StageRun";
  constructor(stage_index, generation, evaluators) {
    this.stage_index = stage_index;
    this.generation = generation;
    this.evaluators = evaluators;
    validate_StageRun(this);
    Object.freeze(this);
  }
}
export class EvaluationProgress {
  completed_stages;
  stage;
  kind = "EvaluationProgress";
  constructor(completed_stages, stage) {
    this.completed_stages = completed_stages;
    this.stage = stage;
    this.completed_stages = Object.freeze([...completed_stages]);
    Object.freeze(this);
  }
}
export class Running {
  progress;
  kind = "Running";
  constructor(progress) {
    this.progress = progress;
    Object.freeze(this);
  }
}
export class EvaluationPassed {
  completed_stages;
  kind = "EvaluationPassed";
  constructor(completed_stages) {
    this.completed_stages = completed_stages;
    this.completed_stages = Object.freeze([...completed_stages]);
    Object.freeze(this);
  }
}
export class EvaluationFailed {
  completed_stages;
  kind = "EvaluationFailed";
  constructor(completed_stages) {
    this.completed_stages = completed_stages;
    this.completed_stages = Object.freeze([...completed_stages]);
    Object.freeze(this);
  }
}
export class EvaluationBlocked {
  progress;
  kind = "EvaluationBlocked";
  constructor(progress) {
    this.progress = progress;
    Object.freeze(this);
  }
}
export class EvaluationInstance {
  work_cycle;
  input;
  plan;
  state;
  kind = "EvaluationInstance";
  constructor(work_cycle, input, plan, state) {
    this.work_cycle = work_cycle;
    this.input = input;
    this.plan = plan;
    this.state = state;
    Object.freeze(this);
  }
}
import { equal } from "./task.js";
function validate_StageRun(v) {
  Object.defineProperty(v, "evaluators", {
    value: new Map(v.evaluators),
    enumerable: true,
  });
}
export function evaluator_task_id(
  ticket,
  work_cycle,
  stage,
  generation,
  evaluator,
) {
  return new EvaluationTaskId(ticket, work_cycle, stage, generation, evaluator);
}
export function task_id_for(current, progress, evaluator) {
  return evaluator_task_id(
    current.input.ticket,
    current.work_cycle,
    current.plan.stages[progress.stage_index].key,
    progress.generation,
    evaluator,
  );
}
export function evaluator_keys(stage) {
  return new Set(stage.evaluators.map((e) => e.key));
}
export function evaluator_key_for_task(current, progress, task) {
  for (const entry of current.plan.stages[progress.stage_index].evaluators)
    if (equal(task_id_for(current, progress, entry.key), task))
      return entry.key;
  throw new Error("no evaluator of the active stage owns task");
}
export function initial_stage_run(stage, stage_index) {
  return new StageRun(
    stage_index,
    Generation(1),
    new Map(stage.evaluators.map((e) => [e.key, new Awaiting()])),
  );
}
export function is_awaiting(s) {
  return s instanceof Awaiting;
}
export function is_failed(s) {
  return s instanceof Produced && s.result instanceof EvaluatorFailed;
}
export function is_blocked(s) {
  return (
    s instanceof EvaluatorProcessFailed ||
    s instanceof EvaluatorExecutionUnavailable
  );
}
export function stage_has_awaiting(p) {
  return [...p.evaluators.values()].some(is_awaiting);
}
export function stage_has_failed(p) {
  return [...p.evaluators.values()].some(is_failed);
}
export function stage_has_blocked(p) {
  return [...p.evaluators.values()].some(is_blocked);
}
export function state_stage_complete(s) {
  return s instanceof Running && !stage_has_awaiting(s.progress.stage);
}
export function is_current_stage_complete(v) {
  return state_stage_complete(v.state);
}
export function task_current(c, t) {
  if (!(c.state instanceof Running)) return false;
  const p = c.state.progress.stage;
  return [...p.evaluators].some(
    ([key, s]) => is_awaiting(s) && equal(task_id_for(c, p, key), t),
  );
}
function with_state(c, state) {
  return new EvaluationInstance(c.work_cycle, c.input, c.plan, state);
}
function _with_status(c, p, key, s) {
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
function _conclude_stage(c) {
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
        initial_stage_run(c.plan.stages[index], index),
      ),
    ),
  );
}
export function apply_produced(c, task, result, verdict) {
  let recorded = c;
  if (
    c.state instanceof Running &&
    task_current(c, task) &&
    current_task_obligations(c).some((obligation) =>
      equal(obligation, result.obligation),
    )
  ) {
    recorded = _with_status(
      c,
      c.state.progress,
      evaluator_key_for_task(c, c.state.progress.stage, task),
      new Produced(
        verdict instanceof EvaluatorPass
          ? new EvaluatorPassed(result.result_ref)
          : new EvaluatorFailed(result.result_ref),
      ),
    );
  }
  return _conclude_stage(recorded);
}
export function apply_failure(c, task, terminal) {
  let recorded = c;
  if (c.state instanceof Running && task_current(c, task)) {
    if (terminal instanceof TaskResultProduced) return _conclude_stage(c);
    const status =
      terminal instanceof TaskProcessFailed
        ? new EvaluatorProcessFailed(terminal.failure.evidence)
        : new EvaluatorExecutionUnavailable(terminal.failure.evidence);
    recorded = _with_status(
      c,
      c.state.progress,
      evaluator_key_for_task(c, c.state.progress.stage, task),
      status,
    );
  }
  return _conclude_stage(recorded);
}
export function resume_blocked(c) {
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
export function current_task_obligations(c) {
  if (!(c.state instanceof Running)) return [];
  const p = c.state.progress.stage;
  return c.plan.stages[p.stage_index].evaluators
    .filter((e) => is_awaiting(p.evaluators.get(e.key)))
    .map(
      (e) =>
        new TaskObligation(
          task_id_for(c, p, e.key),
          e.task,
          ContextRef(c.input.work_result),
        ),
    );
}
export function failed_entries(key, s) {
  return s instanceof Produced && s.result instanceof EvaluatorFailed
    ? [new EvaluationReworkEntry(key, s.result.result_ref)]
    : [];
}
export function rework_entries(c, completed) {
  const s = completed.at(-1);
  if (!s) throw new Error("rework entries need a concluded stage");
  return c.plan.stages[s.stage_index].evaluators.flatMap((e) =>
    failed_entries(e.key, s.evaluators.get(e.key)),
  );
}
export function stage_run_invariant(c, p) {
  if (
    p.stage_index < 0 ||
    p.stage_index >= c.plan.stages.length ||
    p.generation <= 0 ||
    !equal(
      new Set(p.evaluators.keys()),
      evaluator_keys(c.plan.stages[p.stage_index]),
    )
  )
    return false;
  return [...p.evaluators.values()].every((s) =>
    s instanceof Awaiting
      ? true
      : s instanceof Produced
        ? s.result.result_ref > 0
        : s.evidence > 0,
  );
}
export function stage_passed(s) {
  return !(
    stage_has_awaiting(s) ||
    stage_has_failed(s) ||
    stage_has_blocked(s)
  );
}
export function completed_history_invariant(c, stages) {
  return stages.every(
    (s, i) =>
      s.stage_index === i &&
      stage_run_invariant(c, s) &&
      !stage_has_awaiting(s) &&
      (i + 1 === stages.length || stage_passed(s)),
  );
}
export function state_history_invariant(c) {
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
        stage_has_failed(s.completed_stages.at(-1)))
  );
}
export function begin(work_cycle, input, plan) {
  if (!plan.stages.length)
    throw new Error("an evaluation plan has at least one stage");
  return new EvaluationInstance(
    work_cycle,
    input,
    plan,
    new Running(
      new EvaluationProgress([], initial_stage_run(plan.stages[0], 0)),
    ),
  );
}
export function stage_keys_unique(plan) {
  return new Set(plan.stages.map((s) => s.key)).size === plan.stages.length;
}
export function evaluator_keys_unique(stage) {
  return evaluator_keys(stage).size === stage.evaluators.length;
}
export function plan_valid(plan) {
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
export function evaluation_invariant(c) {
  return (
    c.work_cycle > 0 &&
    c.input.ticket > 0 &&
    c.input.work_result > 0 &&
    c.input.accepted_source_ref > 0 &&
    plan_valid(c.plan) &&
    state_history_invariant(c)
  );
}
