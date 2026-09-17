export type TicketId = number & { readonly __brand: "TicketId" };
export const TicketId = (value: number): TicketId => value as TicketId;

export type CycleNumber = number & { readonly __brand: "CycleNumber" };
export const CycleNumber = (value: number): CycleNumber => value as CycleNumber;

export type StageKey = number & { readonly __brand: "StageKey" };
export const StageKey = (value: number): StageKey => value as StageKey;

export type Generation = number & { readonly __brand: "Generation" };
export const Generation = (value: number): Generation => value as Generation;

export type EvaluatorKey = number & { readonly __brand: "EvaluatorKey" };
export const EvaluatorKey = (value: number): EvaluatorKey =>
  value as EvaluatorKey;

export type ContentRef = number & { readonly __brand: "ContentRef" };
export const ContentRef = (value: number): ContentRef => value as ContentRef;

export type Digest = number & { readonly __brand: "Digest" };
export const Digest = (value: number): Digest => value as Digest;

export class WorkTaskId {
  readonly kind = "WorkTaskId";
  constructor(
    readonly ticket: TicketId,
    readonly cycle: CycleNumber,
  ) {
    validate_WorkTaskId(this);
    Object.freeze(this);
  }
}

export class EvaluationTaskId {
  readonly kind = "EvaluationTaskId";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly stage: StageKey,
    readonly generation: Generation,
    readonly evaluator: EvaluatorKey,
  ) {
    validate_EvaluationTaskId(this);
    Object.freeze(this);
  }
}

export type TaskId = WorkTaskId | EvaluationTaskId;

export class ReadRepository {
  readonly kind = "ReadRepository";
  constructor() {
    Object.freeze(this);
  }
}

export class PublishRepositoryResult {
  readonly kind = "PublishRepositoryResult";
  constructor() {
    Object.freeze(this);
  }
}

export type GitAccess = ReadRepository | PublishRepositoryResult;

export class ExecutionRequirements {
  readonly kind = "ExecutionRequirements";
  readonly required_capabilities: readonly string[];
  constructor(
    readonly repository: ContentRef,
    readonly access: GitAccess,
    required_capabilities: readonly string[] | ReadonlySet<string> = [],
  ) {
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
  readonly kind = "WorkspaceSource";
  constructor(
    readonly repository: ContentRef,
    readonly commit: Digest,
  ) {
    Object.freeze(this);
  }
}

export class GitOutput {
  readonly kind = "GitOutput";
  constructor(readonly output: WorkspaceSource) {
    Object.freeze(this);
  }
}

export type OutputRef = GitOutput;

export class TaskDefinition {
  readonly kind = "TaskDefinition";
  constructor(
    readonly workload: ContentRef,
    readonly inputs: ContentRef,
    readonly execution_requirements: ExecutionRequirements,
    readonly result_contract: ContentRef,
  ) {
    validate_TaskDefinition(this);
    Object.freeze(this);
  }
}

export class TaskObligation {
  readonly kind = "TaskObligation";
  constructor(
    readonly task: TaskId,
    readonly definition: TaskDefinition,
    readonly source: WorkspaceSource,
    readonly context: readonly ContentRef[],
  ) {
    this.context = Object.freeze([...context]);
    validate_TaskObligation(this);
    Object.freeze(this);
  }
}

export class ResultFinding {
  readonly kind = "ResultFinding";
  constructor(
    readonly id: number,
    readonly description: ContentRef,
  ) {
    validate_ResultFinding(this);
    Object.freeze(this);
  }
}

export class ValidatedTaskResult {
  readonly kind = "ValidatedTaskResult";
  constructor(
    readonly obligation: TaskObligation,
    readonly manifest: ContentRef,
    readonly outputs: readonly OutputRef[],
    readonly value: number,
    readonly findings: readonly ResultFinding[],
  ) {
    this.findings = Object.freeze([...findings]);
    this.outputs = Object.freeze([...outputs]);
    validate_ValidatedTaskResult(this);
    Object.freeze(this);
  }
  static produce(
    obligation: TaskObligation,
    manifest: ContentRef,
    outputs: readonly OutputRef[],
    value: number,
    findings: readonly ResultFinding[],
  ): ValidatedTaskResult {
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
  readonly kind = "TaskFailure";
  constructor(
    readonly task: TaskId,
    readonly evidence: ContentRef,
  ) {
    validate_TaskFailure(this);
    Object.freeze(this);
  }
}

export class TaskResultProduced {
  readonly kind = "TaskResultProduced";
  constructor(readonly result: ValidatedTaskResult) {
    Object.freeze(this);
  }
}

export class TaskProcessFailed {
  readonly kind = "TaskProcessFailed";
  constructor(readonly failure: TaskFailure) {
    Object.freeze(this);
  }
}

export class TaskExecutionUnavailable {
  readonly kind = "TaskExecutionUnavailable";
  constructor(readonly failure: TaskFailure) {
    Object.freeze(this);
  }
}

export type TaskTerminal =
  TaskResultProduced | TaskProcessFailed | TaskExecutionUnavailable;

export function equal(left: unknown, right: unknown): boolean {
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
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
}
function positive(value: number, label: string): void {
  if (value <= 0) throw new Error(`${label}: ${value}`);
}
function validate_WorkTaskId(v: WorkTaskId): void {
  positive(v.ticket, "work task ticket must be positive");
  positive(v.cycle, "work task cycle must be positive");
}
function validate_EvaluationTaskId(v: EvaluationTaskId): void {
  positive(v.ticket, "evaluation task ticket must be positive");
  positive(v.work_cycle, "work cycle must be positive");
  positive(v.stage, "stage key must be positive");
  positive(v.generation, "generation must be positive");
  positive(v.evaluator, "evaluator key must be positive");
}
function validate_TaskDefinition(v: TaskDefinition): void {
  positive(v.workload, "workload must be present");
  positive(v.inputs, "inputs must be present");
  positive(v.execution_requirements.repository, "repository must be present");
  positive(v.result_contract, "result contract must be present");
}
function validate_TaskObligation(v: TaskObligation): void {
  positive(v.source.repository, "source repository must be present");
  positive(v.source.commit, "source commit must be present");
  if (v.source.repository !== v.definition.execution_requirements.repository)
    throw new Error(
      `source repository ${v.source.repository} is not the definition's repository ${v.definition.execution_requirements.repository}`,
    );
}
export const FINDING_LIMIT = 32;
function validate_ResultFinding(v: ResultFinding): void {
  positive(v.id, "result finding id must be positive");
  positive(v.description, "result finding description must be present");
}
function validate_ValidatedTaskResult(v: ValidatedTaskResult): void {
  positive(v.manifest, "result manifest must be present");
  if (v.findings.length > FINDING_LIMIT)
    throw new Error(
      `at most ${FINDING_LIMIT} result findings: ${v.findings.length}`,
    );
  if (new Set(v.findings.map((f) => f.id)).size !== v.findings.length)
    throw new Error("result finding ids must be unique");
}
function validate_TaskFailure(v: TaskFailure): void {
  positive(v.evidence, "failure evidence must be present");
}
export function task_owner(task: TaskId): TicketId {
  return task.ticket;
}
export function reads_repository(
  definition: TaskDefinition,
  repository: ContentRef,
): boolean {
  return (
    definition.execution_requirements.repository === repository &&
    definition.execution_requirements.access instanceof ReadRepository
  );
}
export function publishes_repository_result(
  definition: TaskDefinition,
  repository: ContentRef,
): boolean {
  return (
    definition.execution_requirements.repository === repository &&
    definition.execution_requirements.access instanceof PublishRepositoryResult
  );
}
export function exact_git_output(
  result: ValidatedTaskResult,
): WorkspaceSource | null {
  if (result.outputs.length !== 1) return null;
  const output = result.outputs[0]!.output;
  return output.repository ===
    result.obligation.definition.execution_requirements.repository &&
    output.repository === result.obligation.source.repository &&
    output.commit > 0
    ? output
    : null;
}
export function terminal_task(terminal: TaskTerminal): TaskId {
  return terminal instanceof TaskResultProduced
    ? terminal.result.obligation.task
    : terminal.failure.task;
}

export function repr(value: unknown): string {
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
