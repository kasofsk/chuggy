export type TicketId = number & {
  readonly __brand: "TicketId";
};
export declare const TicketId: (value: number) => TicketId;
export type CycleNumber = number & {
  readonly __brand: "CycleNumber";
};
export declare const CycleNumber: (value: number) => CycleNumber;
export type StageKey = number & {
  readonly __brand: "StageKey";
};
export declare const StageKey: (value: number) => StageKey;
export type Generation = number & {
  readonly __brand: "Generation";
};
export declare const Generation: (value: number) => Generation;
export type EvaluatorKey = number & {
  readonly __brand: "EvaluatorKey";
};
export declare const EvaluatorKey: (value: number) => EvaluatorKey;
export type ContentRef = number & {
  readonly __brand: "ContentRef";
};
export declare const ContentRef: (value: number) => ContentRef;
export type Digest = number & {
  readonly __brand: "Digest";
};
export declare const Digest: (value: number) => Digest;
export declare class WorkTaskId {
  readonly ticket: TicketId;
  readonly cycle: CycleNumber;
  readonly kind = "WorkTaskId";
  constructor(ticket: TicketId, cycle: CycleNumber);
}
export declare class EvaluationTaskId {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly stage: StageKey;
  readonly generation: Generation;
  readonly evaluator: EvaluatorKey;
  readonly kind = "EvaluationTaskId";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    stage: StageKey,
    generation: Generation,
    evaluator: EvaluatorKey,
  );
}
export type TaskId = WorkTaskId | EvaluationTaskId;
export declare class ReadRepository {
  readonly kind = "ReadRepository";
  constructor();
}
export declare class PublishRepositoryResult {
  readonly kind = "PublishRepositoryResult";
  constructor();
}
export type GitAccess = ReadRepository | PublishRepositoryResult;
export declare class ExecutionRequirements {
  readonly repository: ContentRef;
  readonly access: GitAccess;
  readonly kind = "ExecutionRequirements";
  readonly required_capabilities: readonly string[];
  constructor(
    repository: ContentRef,
    access: GitAccess,
    required_capabilities?: readonly string[] | ReadonlySet<string>,
  );
}
export declare class WorkspaceSource {
  readonly repository: ContentRef;
  readonly commit: Digest;
  readonly kind = "WorkspaceSource";
  constructor(repository: ContentRef, commit: Digest);
}
export declare class GitOutput {
  readonly output: WorkspaceSource;
  readonly kind = "GitOutput";
  constructor(output: WorkspaceSource);
}
export type OutputRef = GitOutput;
export declare class TaskDefinition {
  readonly workload: ContentRef;
  readonly inputs: ContentRef;
  readonly execution_requirements: ExecutionRequirements;
  readonly result_contract: ContentRef;
  readonly kind = "TaskDefinition";
  constructor(
    workload: ContentRef,
    inputs: ContentRef,
    execution_requirements: ExecutionRequirements,
    result_contract: ContentRef,
  );
}
export declare class TaskObligation {
  readonly task: TaskId;
  readonly definition: TaskDefinition;
  readonly source: WorkspaceSource;
  readonly context: readonly ContentRef[];
  readonly kind = "TaskObligation";
  constructor(
    task: TaskId,
    definition: TaskDefinition,
    source: WorkspaceSource,
    context: readonly ContentRef[],
  );
}
export declare class ResultFinding {
  readonly id: number;
  readonly description: ContentRef;
  readonly kind = "ResultFinding";
  constructor(id: number, description: ContentRef);
}
export declare class ValidatedTaskResult {
  readonly obligation: TaskObligation;
  readonly manifest: ContentRef;
  readonly outputs: readonly OutputRef[];
  readonly value: number;
  readonly findings: readonly ResultFinding[];
  readonly kind = "ValidatedTaskResult";
  constructor(
    obligation: TaskObligation,
    manifest: ContentRef,
    outputs: readonly OutputRef[],
    value: number,
    findings: readonly ResultFinding[],
  );
  static produce(
    obligation: TaskObligation,
    manifest: ContentRef,
    outputs: readonly OutputRef[],
    value: number,
    findings: readonly ResultFinding[],
  ): ValidatedTaskResult;
}
export declare class TaskFailure {
  readonly task: TaskId;
  readonly evidence: ContentRef;
  readonly kind = "TaskFailure";
  constructor(task: TaskId, evidence: ContentRef);
}
export declare class TaskResultProduced {
  readonly result: ValidatedTaskResult;
  readonly kind = "TaskResultProduced";
  constructor(result: ValidatedTaskResult);
}
export declare class TaskProcessFailed {
  readonly failure: TaskFailure;
  readonly kind = "TaskProcessFailed";
  constructor(failure: TaskFailure);
}
export declare class TaskExecutionUnavailable {
  readonly failure: TaskFailure;
  readonly kind = "TaskExecutionUnavailable";
  constructor(failure: TaskFailure);
}
export type TaskTerminal =
  TaskResultProduced | TaskProcessFailed | TaskExecutionUnavailable;
export declare function equal(left: unknown, right: unknown): boolean;
export declare const FINDING_LIMIT = 32;
export declare function task_owner(task: TaskId): TicketId;
export declare function reads_repository(
  definition: TaskDefinition,
  repository: ContentRef,
): boolean;
export declare function publishes_repository_result(
  definition: TaskDefinition,
  repository: ContentRef,
): boolean;
export declare function exact_git_output(
  result: ValidatedTaskResult,
): WorkspaceSource | null;
export declare function terminal_task(terminal: TaskTerminal): TaskId;
export declare function repr(value: unknown): string;
