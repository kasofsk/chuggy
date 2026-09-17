export const TicketId = (value) => value;
export const CycleNumber = (value) => value;
export const StageKey = (value) => value;
export const Generation = (value) => value;
export const EvaluatorKey = (value) => value;
export const ContentRef = (value) => value;
export const Digest = (value) => value;
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
export class ReadRepository {
  kind = "ReadRepository";
  constructor() {
    Object.freeze(this);
  }
}
export class PublishRepositoryResult {
  kind = "PublishRepositoryResult";
  constructor() {
    Object.freeze(this);
  }
}
export class ExecutionRequirements {
  repository;
  access;
  kind = "ExecutionRequirements";
  required_capabilities;
  constructor(repository, access, required_capabilities = []) {
    this.repository = repository;
    this.access = access;
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
export class WorkspaceSource {
  repository;
  commit;
  kind = "WorkspaceSource";
  constructor(repository, commit) {
    this.repository = repository;
    this.commit = commit;
    Object.freeze(this);
  }
}
export class GitOutput {
  output;
  kind = "GitOutput";
  constructor(output) {
    this.output = output;
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
  source;
  context;
  kind = "TaskObligation";
  constructor(task, definition, source, context) {
    this.task = task;
    this.definition = definition;
    this.source = source;
    this.context = context;
    this.context = Object.freeze([...context]);
    validate_TaskObligation(this);
    Object.freeze(this);
  }
}
export class ResultFinding {
  id;
  description;
  kind = "ResultFinding";
  constructor(id, description) {
    this.id = id;
    this.description = description;
    validate_ResultFinding(this);
    Object.freeze(this);
  }
}
export class ValidatedTaskResult {
  obligation;
  manifest;
  outputs;
  value;
  findings;
  kind = "ValidatedTaskResult";
  constructor(obligation, manifest, outputs, value, findings) {
    this.obligation = obligation;
    this.manifest = manifest;
    this.outputs = outputs;
    this.value = value;
    this.findings = findings;
    this.findings = Object.freeze([...findings]);
    this.outputs = Object.freeze([...outputs]);
    validate_ValidatedTaskResult(this);
    Object.freeze(this);
  }
  static produce(obligation, manifest, outputs, value, findings) {
    return new ValidatedTaskResult(
      obligation,
      manifest,
      outputs,
      value,
      findings,
    );
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
  positive(v.execution_requirements.repository, "repository must be present");
  positive(v.result_contract, "result contract must be present");
}
function validate_TaskObligation(v) {
  positive(v.source.repository, "source repository must be present");
  positive(v.source.commit, "source commit must be present");
  if (v.source.repository !== v.definition.execution_requirements.repository)
    throw new Error(
      `source repository ${v.source.repository} is not the definition's repository ${v.definition.execution_requirements.repository}`,
    );
}
export const FINDING_LIMIT = 32;
function validate_ResultFinding(v) {
  positive(v.id, "result finding id must be positive");
  positive(v.description, "result finding description must be present");
}
function validate_ValidatedTaskResult(v) {
  positive(v.manifest, "result manifest must be present");
  if (v.findings.length > FINDING_LIMIT)
    throw new Error(
      `at most ${FINDING_LIMIT} result findings: ${v.findings.length}`,
    );
  if (new Set(v.findings.map((f) => f.id)).size !== v.findings.length)
    throw new Error("result finding ids must be unique");
}
function validate_TaskFailure(v) {
  positive(v.evidence, "failure evidence must be present");
}
export function task_owner(task) {
  return task.ticket;
}
export function reads_repository(definition, repository) {
  return (
    definition.execution_requirements.repository === repository &&
    definition.execution_requirements.access instanceof ReadRepository
  );
}
export function publishes_repository_result(definition, repository) {
  return (
    definition.execution_requirements.repository === repository &&
    definition.execution_requirements.access instanceof PublishRepositoryResult
  );
}
export function exact_git_output(result) {
  if (result.outputs.length !== 1) return null;
  const output = result.outputs[0].output;
  return output.repository ===
    result.obligation.definition.execution_requirements.repository &&
    output.repository === result.obligation.source.repository &&
    output.commit > 0
    ? output
    : null;
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
