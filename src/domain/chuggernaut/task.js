export const TicketId = (value) => value;
export const CycleNumber = (value) => value;
export const StageKey = (value) => value;
export const Generation = (value) => value;
export const EvaluatorKey = (value) => value;
export const ContentRef = (value) => value;
export const ContextRef = (value) => value;
export class WorkTaskId {
  ticket;
  cycle;
  kind = "WorkTaskId";
  constructor(ticket, cycle) {
    this.ticket = ticket;
    this.cycle = cycle;
    validate_WorkTaskId(this);
    Object.freeze(this);
  }
}
export class EvaluationTaskId {
  ticket;
  work_cycle;
  stage;
  generation;
  evaluator;
  kind = "EvaluationTaskId";
  constructor(ticket, work_cycle, stage, generation, evaluator) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.stage = stage;
    this.generation = generation;
    this.evaluator = evaluator;
    validate_EvaluationTaskId(this);
    Object.freeze(this);
  }
}
export class ExecutionRequirements {
  kind = "ExecutionRequirements";
  required_capabilities;
  constructor(required_capabilities = []) {
    if (
      !Array.isArray(required_capabilities) &&
      !(required_capabilities instanceof Set)
    )
      throw new Error("required capabilities must be a collection of names");
    const capabilities = [...required_capabilities];
    if (
      capabilities.some((name) => typeof name !== "string" || name.length === 0)
    )
      throw new Error("required capabilities must be nonempty names");
    this.required_capabilities = Object.freeze(
      [...new Set(capabilities)].sort(),
    );
    Object.freeze(this);
  }
}
export class TaskDefinition {
  workload;
  inputs;
  execution_requirements;
  result_contract;
  kind = "TaskDefinition";
  constructor(workload, inputs, execution_requirements, result_contract) {
    this.workload = workload;
    this.inputs = inputs;
    this.execution_requirements = execution_requirements;
    this.result_contract = result_contract;
    validate_TaskDefinition(this);
    Object.freeze(this);
  }
}
export class TaskObligation {
  task;
  definition;
  context_ref;
  kind = "TaskObligation";
  constructor(task, definition, context_ref) {
    this.task = task;
    this.definition = definition;
    this.context_ref = context_ref;
    validate_TaskObligation(this);
    Object.freeze(this);
  }
}
export class ValidatedTaskResult {
  obligation;
  result_ref;
  kind = "ValidatedTaskResult";
  constructor(obligation, result_ref) {
    this.obligation = obligation;
    this.result_ref = result_ref;
    validate_ValidatedTaskResult(this);
    Object.freeze(this);
  }
  static produce(obligation, result_ref) {
    return new ValidatedTaskResult(obligation, result_ref);
  }
}
export class TaskFailure {
  task;
  evidence;
  kind = "TaskFailure";
  constructor(task, evidence) {
    this.task = task;
    this.evidence = evidence;
    validate_TaskFailure(this);
    Object.freeze(this);
  }
}
export class TaskResultProduced {
  result;
  kind = "TaskResultProduced";
  constructor(result) {
    this.result = result;
    Object.freeze(this);
  }
}
export class TaskProcessFailed {
  failure;
  kind = "TaskProcessFailed";
  constructor(failure) {
    this.failure = failure;
    Object.freeze(this);
  }
}
export class TaskExecutionUnavailable {
  failure;
  kind = "TaskExecutionUnavailable";
  constructor(failure) {
    this.failure = failure;
    Object.freeze(this);
  }
}
export function equal(left, right) {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  if (left instanceof Map && right instanceof Map)
    return (
      left.size === right.size &&
      [...left].every(([k, v]) => right.has(k) && equal(v, right.get(k)))
    );
  if (left instanceof Set && right instanceof Set)
    return left.size === right.size && [...left].every((v) => right.has(v));
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((v, i) => equal(v, right[i]))
    );
  const a = left,
    b = right;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
}
function positive(value, label) {
  if (value <= 0) throw new Error(`${label}: ${value}`);
}
function validate_WorkTaskId(v) {
  positive(v.ticket, "work task ticket must be positive");
  positive(v.cycle, "work task cycle must be positive");
}
function validate_EvaluationTaskId(v) {
  positive(v.ticket, "evaluation task ticket must be positive");
  positive(v.work_cycle, "work cycle must be positive");
  positive(v.stage, "stage key must be positive");
  positive(v.generation, "generation must be positive");
  positive(v.evaluator, "evaluator key must be positive");
}
function validate_TaskDefinition(v) {
  positive(v.workload, "workload must be present");
  positive(v.inputs, "inputs must be present");
  positive(v.result_contract, "result contract must be present");
}
function validate_TaskObligation(v) {
  positive(v.context_ref, "context reference must be present");
}
function validate_ValidatedTaskResult(v) {
  positive(v.result_ref, "result reference must be present");
}
function validate_TaskFailure(v) {
  positive(v.evidence, "failure evidence must be present");
}
export function task_owner(task) {
  return task.ticket;
}
export function terminal_task(terminal) {
  return terminal instanceof TaskResultProduced
    ? terminal.result.obligation.task
    : terminal.failure.task;
}
export function repr(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string")
    return (
      "'" +
      value
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t") +
      "'"
    );
  if (Array.isArray(value))
    return (
      "(" + value.map(repr).join(", ") + (value.length === 1 ? "," : "") + ")"
    );
  if (value instanceof Set)
    return value.size
      ? "frozenset({" + [...value].map(repr).join(", ") + "})"
      : "frozenset()";
  if (value instanceof Map)
    return (
      "mappingproxy({" +
      [...value].map(([k, v]) => repr(k) + ": " + repr(v)).join(", ") +
      "})"
    );
  if (typeof value === "object") {
    const fields = Object.entries(value).filter(([key]) => key !== "kind");
    return (
      value.constructor.name +
      "(" +
      fields.map(([k, v]) => k + "=" + repr(v)).join(", ") +
      ")"
    );
  }
  return String(value);
}
