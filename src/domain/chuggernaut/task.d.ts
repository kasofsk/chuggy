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
export type ContextRef = number & {
  readonly __brand: "ContextRef";
};
export declare const ContextRef: (value: number) => ContextRef;
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
export declare class ExecutionRequirements {
  readonly kind = "ExecutionRequirements";
  readonly required_capabilities: readonly string[];
  constructor(required_capabilities?: readonly string[] | ReadonlySet<string>);
}
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
  readonly context_ref: ContextRef;
  readonly kind = "TaskObligation";
  constructor(
    task: TaskId,
    definition: TaskDefinition,
    context_ref: ContextRef,
  );
}
export declare class ValidatedTaskResult {
  readonly obligation: TaskObligation;
  readonly result_ref: ContentRef;
  readonly kind = "ValidatedTaskResult";
  constructor(obligation: TaskObligation, result_ref: ContentRef);
  static produce(
    obligation: TaskObligation,
    result_ref: ContentRef,
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
export declare function task_owner(task: TaskId): TicketId;
export declare function terminal_task(terminal: TaskTerminal): TaskId;
export declare function repr(value: unknown): string;
