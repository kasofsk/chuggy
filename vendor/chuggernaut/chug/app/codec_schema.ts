export type CodecField =
  | readonly [string, string]
  | readonly [string, string, "optional" | "default-empty"];
export const codec_schema: Readonly<
  Record<string, { fields?: readonly CodecField[]; alias?: string }>
> = {
  TicketId: {
    alias: "int",
  },
  CycleNumber: {
    alias: "int",
  },
  StageKey: {
    alias: "int",
  },
  Generation: {
    alias: "int",
  },
  EvaluatorKey: {
    alias: "int",
  },
  ContentRef: {
    alias: "int",
  },
  Digest: {
    alias: "int",
  },
  WorkTaskId: {
    fields: [
      ["ticket", "TicketId"],
      ["cycle", "CycleNumber"],
    ],
  },
  EvaluationTaskId: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["stage", "StageKey"],
      ["generation", "Generation"],
      ["evaluator", "EvaluatorKey"],
    ],
  },
  TaskId: {
    alias: "WorkTaskId | EvaluationTaskId",
  },
  ReadRepository: {
    fields: [],
  },
  PublishRepositoryResult: {
    fields: [],
  },
  GitAccess: {
    alias: "ReadRepository | PublishRepositoryResult",
  },
  ExecutionRequirements: {
    fields: [
      ["repository", "ContentRef"],
      ["access", "GitAccess"],
      ["required_capabilities", "tuple[str, ...]", "default-empty"],
    ],
  },
  WorkspaceSource: {
    fields: [
      ["repository", "ContentRef"],
      ["commit", "Digest"],
    ],
  },
  GitOutput: {
    fields: [["output", "WorkspaceSource"]],
  },
  OutputRef: {
    alias: "GitOutput",
  },
  TaskDefinition: {
    fields: [
      ["workload", "ContentRef"],
      ["inputs", "ContentRef"],
      ["execution_requirements", "ExecutionRequirements"],
      ["result_contract", "ContentRef"],
    ],
  },
  TaskObligation: {
    fields: [
      ["task", "TaskId"],
      ["definition", "TaskDefinition"],
      ["source", "WorkspaceSource"],
      ["context", "tuple[ContentRef, ...]"],
    ],
  },
  ResultFinding: {
    fields: [
      ["id", "int"],
      ["description", "ContentRef"],
    ],
  },
  ValidatedTaskResult: {
    fields: [
      ["obligation", "TaskObligation"],
      ["manifest", "ContentRef"],
      ["outputs", "tuple[OutputRef, ...]"],
      ["value", "int"],
      ["findings", "tuple[ResultFinding, ...]"],
    ],
  },
  TaskFailure: {
    fields: [
      ["task", "TaskId"],
      ["evidence", "ContentRef"],
    ],
  },
  TaskResultProduced: {
    fields: [["result", "ValidatedTaskResult"]],
  },
  TaskProcessFailed: {
    fields: [["failure", "TaskFailure"]],
  },
  TaskExecutionUnavailable: {
    fields: [["failure", "TaskFailure"]],
  },
  TaskTerminal: {
    alias: "TaskResultProduced | TaskProcessFailed | TaskExecutionUnavailable",
  },
  EvaluatorDefinition: {
    fields: [
      ["key", "EvaluatorKey"],
      ["task", "TaskDefinition"],
    ],
  },
  StageDefinition: {
    fields: [
      ["key", "StageKey"],
      ["evaluators", "tuple[EvaluatorDefinition, ...]"],
    ],
  },
  EvaluationPlan: {
    fields: [["stages", "tuple[StageDefinition, ...]"]],
  },
  EvaluationInput: {
    fields: [
      ["ticket", "TicketId"],
      ["work_result", "ContentRef"],
      ["accepted_source", "WorkspaceSource"],
    ],
  },
  SummaryReason: {
    fields: [["value", "int"]],
  },
  ExitCodeReason: {
    fields: [["code", "int"]],
  },
  EvaluationReason: {
    alias: "SummaryReason | ExitCodeReason",
  },
  EvaluationFinding: {
    fields: [
      ["id", "int"],
      ["description", "ContentRef"],
    ],
  },
  PassDetail: {
    fields: [
      ["reason", "EvaluationReason"],
      ["result_manifest", "ContentRef"],
    ],
  },
  FailDetail: {
    fields: [
      ["reason", "EvaluationReason"],
      ["result_manifest", "ContentRef"],
      ["findings", "tuple[EvaluationFinding, ...]"],
    ],
  },
  EvaluatorPassed: {
    fields: [["detail", "PassDetail"]],
  },
  EvaluatorFailed: {
    fields: [["detail", "FailDetail"]],
  },
  EvaluatorResult: {
    alias: "EvaluatorPassed | EvaluatorFailed",
  },
  Awaiting: {
    fields: [],
  },
  Produced: {
    fields: [["result", "EvaluatorResult"]],
  },
  EvaluatorProcessFailed: {
    fields: [["evidence", "ContentRef"]],
  },
  EvaluatorExecutionUnavailable: {
    fields: [["evidence", "ContentRef"]],
  },
  EvaluatorStatus: {
    alias:
      "Awaiting | Produced | EvaluatorProcessFailed | EvaluatorExecutionUnavailable",
  },
  EvaluationReworkEntry: {
    fields: [
      ["evaluator", "EvaluatorKey"],
      ["reason", "EvaluationReason"],
      ["result_manifest", "ContentRef"],
      ["findings", "tuple[EvaluationFinding, ...]"],
    ],
  },
  StageRun: {
    fields: [
      ["stage_index", "int"],
      ["generation", "Generation"],
      ["evaluators", "Mapping[EvaluatorKey, EvaluatorStatus]"],
    ],
  },
  EvaluationProgress: {
    fields: [
      ["completed_stages", "tuple[StageRun, ...]"],
      ["stage", "StageRun"],
    ],
  },
  Running: {
    fields: [["progress", "EvaluationProgress"]],
  },
  EvaluationPassed: {
    fields: [["completed_stages", "tuple[StageRun, ...]"]],
  },
  EvaluationFailed: {
    fields: [["completed_stages", "tuple[StageRun, ...]"]],
  },
  EvaluationBlocked: {
    fields: [["progress", "EvaluationProgress"]],
  },
  EvaluationState: {
    alias: "Running | EvaluationPassed | EvaluationFailed | EvaluationBlocked",
  },
  EvaluationInstance: {
    fields: [
      ["work_cycle", "CycleNumber"],
      ["input", "EvaluationInput"],
      ["plan", "EvaluationPlan"],
      ["state", "EvaluationState"],
    ],
  },
  AuthoredContent: {
    fields: [
      ["title", "ContentRef"],
      ["instructions", "ContentRef"],
    ],
  },
  LegacyContent: {
    fields: [["content", "ContentRef"]],
  },
  ReleasedContent: {
    alias: "AuthoredContent | LegacyContent",
  },
  ReleasedWorkInput: {
    fields: [
      ["content", "ReleasedContent"],
      ["input_bindings", "ContentRef"],
    ],
  },
  InitialWork: {
    fields: [],
  },
  EvaluationRework: {
    fields: [["entries", "tuple[EvaluationReworkEntry, ...]"]],
  },
  FinalizationRework: {
    fields: [["evidence", "ContentRef"]],
  },
  WorkCause: {
    alias: "InitialWork | EvaluationRework | FinalizationRework",
  },
  WorkInput: {
    fields: [
      ["released", "ReleasedWorkInput"],
      ["cause", "WorkCause"],
      ["retry_evidence", "tuple[ContentRef, ...]"],
    ],
  },
  WorkExecution: {
    fields: [
      ["input", "WorkInput"],
      ["source", "WorkspaceSource"],
    ],
  },
  FinalizationOperation: {
    fields: [
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
      ["input", "ContentRef"],
      ["source", "WorkspaceSource"],
    ],
  },
  ReworkEvaluationFailure: {
    fields: [],
  },
  EscalateEvaluationFailure: {
    fields: [],
  },
  FailureDisposition: {
    alias: "ReworkEvaluationFailure | EscalateEvaluationFailure",
  },
  EvaluationFailurePolicy: {
    alias: "Callable[[EvaluationInstance], FailureDisposition]",
  },
  WorkEscalation: {
    fields: [
      ["resume_input", "WorkInput"],
      ["source", "WorkspaceSource"],
      ["evidence", "ContentRef"],
    ],
  },
  EvaluationFailureEscalation: {
    fields: [
      ["evidence", "tuple[EvaluationReworkEntry, ...]"],
      ["source", "WorkspaceSource"],
    ],
  },
  FinalizationEscalation: {
    fields: [
      ["finalization", "FinalizationOperation"],
      ["evidence", "ContentRef"],
    ],
  },
  WorkFailureEscalated: {
    fields: [["escalation", "WorkEscalation"]],
  },
  WorkExecutionUnavailableEscalated: {
    fields: [["escalation", "WorkEscalation"]],
  },
  EvaluationFailureEscalated: {
    fields: [["escalation", "EvaluationFailureEscalation"]],
  },
  EvaluationBlockedEscalated: {
    fields: [["evaluation", "EvaluationInstance"]],
  },
  FinalizationUnavailableEscalated: {
    fields: [["escalation", "FinalizationEscalation"]],
  },
  Escalation: {
    alias:
      "WorkFailureEscalated | WorkExecutionUnavailableEscalated | EvaluationFailureEscalated | EvaluationBlockedEscalated | FinalizationUnavailableEscalated",
  },
  ReleasedTicket: {
    fields: [
      ["id", "TicketId"],
      ["content", "ReleasedContent"],
      ["input_bindings", "ContentRef"],
      ["dependencies", "frozenset[TicketId]"],
      ["work_configuration", "TaskDefinition"],
      ["evaluation_plan", "EvaluationPlan"],
      ["finalization_configuration", "ContentRef"],
    ],
  },
  Pending: {
    fields: [],
  },
  Work: {
    fields: [["execution", "WorkExecution"]],
  },
  Evaluation: {
    fields: [["evaluation", "EvaluationInstance"]],
  },
  Finalization: {
    fields: [["operation", "FinalizationOperation"]],
  },
  Escalated: {
    fields: [["escalation", "Escalation"]],
  },
  Done: {
    fields: [],
  },
  Revoked: {
    fields: [],
  },
  TicketState: {
    alias:
      "Pending | Work | Evaluation | Finalization | Escalated | Done | Revoked",
  },
  Ticket: {
    fields: [
      ["definition", "ReleasedTicket"],
      ["revision", "int"],
      ["work_cycles_started", "int"],
      ["state", "TicketState"],
    ],
  },
  TicketGraph: {
    fields: [["tickets", "Mapping[TicketId, Ticket]"]],
  },
  TaskTerminalReport: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
    ],
  },
  FinalizationSucceeded: {
    fields: [["evidence", "ContentRef"]],
  },
  FinalizationNeedsWork: {
    fields: [["evidence", "ContentRef"]],
  },
  FinalizationResultUnavailable: {
    fields: [["evidence", "ContentRef"]],
  },
  FinalizationResult: {
    alias:
      "FinalizationSucceeded | FinalizationNeedsWork | FinalizationResultUnavailable",
  },
  FinalizationResultReport: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
      ["result", "FinalizationResult"],
    ],
  },
  CreateTicket: {
    fields: [["definition", "ReleasedTicket"]],
  },
  UpdateTicket: {
    fields: [
      ["ticket", "TicketId"],
      ["expected_revision", "int"],
      ["definition", "ReleasedTicket"],
    ],
  },
  DispatchTicket: {
    fields: [
      ["ticket", "TicketId"],
      ["source", "WorkspaceSource"],
    ],
  },
  RevokeTicket: {
    fields: [["ticket", "TicketId"]],
  },
  ResumeTicket: {
    fields: [["ticket", "TicketId"]],
  },
  ReportTaskTerminal: {
    fields: [["report", "TaskTerminalReport"]],
  },
  ReportFinalizationResult: {
    fields: [["report", "FinalizationResultReport"]],
  },
  TicketCommand: {
    alias:
      "CreateTicket | UpdateTicket | DispatchTicket | RevokeTicket | ResumeTicket | ReportTaskTerminal | ReportFinalizationResult",
  },
  TicketAlreadyExists: {
    fields: [["ticket", "TicketId"]],
  },
  DependenciesNotFound: {
    fields: [
      ["ticket", "TicketId"],
      ["dependencies", "frozenset[TicketId]"],
    ],
  },
  SelfDependency: {
    fields: [["ticket", "TicketId"]],
  },
  TicketNotFound: {
    fields: [["ticket", "TicketId"]],
  },
  TicketNotPending: {
    fields: [["ticket", "TicketId"]],
  },
  TicketIdentityMismatch: {
    fields: [["ticket", "TicketId"]],
  },
  TicketRevisionStale: {
    fields: [
      ["ticket", "TicketId"],
      ["expected", "int"],
      ["current", "int"],
    ],
  },
  TicketDependenciesChanged: {
    fields: [["ticket", "TicketId"]],
  },
  DispatchSourceRepositoryMismatch: {
    fields: [["ticket", "TicketId"]],
  },
  DependenciesIncomplete: {
    fields: [
      ["ticket", "TicketId"],
      ["dependencies", "frozenset[TicketId]"],
    ],
  },
  TicketNotRevocable: {
    fields: [["ticket", "TicketId"]],
  },
  TicketNotResumable: {
    fields: [["ticket", "TicketId"]],
  },
  TaskNotCurrent: {
    fields: [
      ["ticket", "TicketId"],
      ["task", "TaskId"],
    ],
  },
  WorkResultMissingExactGitOutput: {
    fields: [["ticket", "TicketId"]],
  },
  FinalizationNotCurrent: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
    ],
  },
  TicketRefusal: {
    alias:
      "TicketAlreadyExists | DependenciesNotFound | SelfDependency | TicketNotFound | TicketNotPending | TicketIdentityMismatch | TicketRevisionStale | TicketDependenciesChanged | DispatchSourceRepositoryMismatch | DependenciesIncomplete | TicketNotRevocable | TicketNotResumable | TaskNotCurrent | WorkResultMissingExactGitOutput | FinalizationNotCurrent",
  },
  TicketCreated: {
    fields: [["definition", "ReleasedTicket"]],
  },
  TicketUpdated: {
    fields: [
      ["ticket", "TicketId"],
      ["revision", "int"],
      ["definition", "ReleasedTicket"],
    ],
  },
  TicketDispatched: {
    fields: [
      ["ticket", "TicketId"],
      ["source", "WorkspaceSource"],
    ],
  },
  TicketRevoked: {
    fields: [["ticket", "TicketId"]],
  },
  TicketWorkResumed: {
    fields: [["ticket", "TicketId"]],
  },
  TicketEvaluationResumed: {
    fields: [["ticket", "TicketId"]],
  },
  TicketFinalizationResumed: {
    fields: [["ticket", "TicketId"]],
  },
  TicketWorkResultAccepted: {
    fields: [
      ["ticket", "TicketId"],
      ["result", "ValidatedTaskResult"],
    ],
  },
  TicketWorkProcessFailed: {
    fields: [
      ["ticket", "TicketId"],
      ["task", "TaskId"],
      ["evidence", "ContentRef"],
    ],
  },
  TicketWorkExecutionUnavailable: {
    fields: [
      ["ticket", "TicketId"],
      ["task", "TaskId"],
      ["evidence", "ContentRef"],
    ],
  },
  TicketEvaluationProgressed: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
    ],
  },
  TicketEvaluationPassed: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
    ],
  },
  TicketEvaluationReworkStarted: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
      ["evidence", "tuple[EvaluationReworkEntry, ...]"],
    ],
  },
  TicketEvaluationFailureEscalated: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
      ["evidence", "tuple[EvaluationReworkEntry, ...]"],
    ],
  },
  TicketEvaluationBlocked: {
    fields: [
      ["ticket", "TicketId"],
      ["terminal", "TaskTerminal"],
    ],
  },
  TicketFinalizationSucceeded: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
      ["evidence", "ContentRef"],
    ],
  },
  TicketFinalizationNeedsWork: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
      ["evidence", "ContentRef"],
    ],
  },
  TicketFinalizationUnavailable: {
    fields: [
      ["ticket", "TicketId"],
      ["work_cycle", "CycleNumber"],
      ["generation", "Generation"],
      ["evidence", "ContentRef"],
    ],
  },
  TicketEvent: {
    alias:
      "TicketCreated | TicketUpdated | TicketDispatched | TicketRevoked | TicketWorkResumed | TicketEvaluationResumed | TicketFinalizationResumed | TicketWorkResultAccepted | TicketWorkProcessFailed | TicketWorkExecutionUnavailable | TicketEvaluationProgressed | TicketEvaluationPassed | TicketEvaluationReworkStarted | TicketEvaluationFailureEscalated | TicketEvaluationBlocked | TicketFinalizationSucceeded | TicketFinalizationNeedsWork | TicketFinalizationUnavailable",
  },
  ExecuteTask: {
    fields: [
      ["ticket", "TicketId"],
      ["task", "TaskObligation"],
    ],
  },
  FinalizeTicket: {
    fields: [
      ["ticket", "TicketId"],
      ["finalization", "FinalizationOperation"],
      ["configuration", "ContentRef"],
    ],
  },
  CancelTask: {
    fields: [
      ["ticket", "TicketId"],
      ["task", "TaskId"],
    ],
  },
  Obligation: {
    alias: "ExecuteTask | FinalizeTicket | CancelTask",
  },
  TicketRefused: {
    fields: [["reason", "TicketRefusal"]],
  },
  TicketDecided: {
    fields: [
      ["event", "TicketEvent"],
      ["obligations", "tuple[Obligation, ...]"],
    ],
  },
  TicketDecision: {
    alias: "TicketRefused | TicketDecided",
  },
  Authorization: {
    fields: [
      ["principal", "str"],
      ["operation", "str"],
      ["policy_revision", "str"],
    ],
  },
  CreateTicketRequest: {
    fields: [
      ["content", "ReleasedContent"],
      ["input_bindings", "ContentRef"],
      ["dependencies", "frozenset[TicketId]"],
      ["work_configuration", "TaskDefinition"],
      ["evaluation_plan", "EvaluationPlan"],
      ["finalization_configuration", "ContentRef"],
      ["stage_names", "Mapping[StageKey, str]"],
      ["evaluator_names", "Mapping[EvaluatorKey, str]"],
      ["rework_limit", "int", "optional"],
    ],
  },
  UpdateTicketRequest: {
    fields: [
      ["ticket", "TicketId"],
      ["expected_revision", "int"],
      ["content", "ReleasedContent"],
      ["input_bindings", "ContentRef"],
      ["dependencies", "frozenset[TicketId]"],
      ["work_configuration", "TaskDefinition"],
      ["evaluation_plan", "EvaluationPlan"],
      ["finalization_configuration", "ContentRef"],
      ["stage_names", "Mapping[StageKey, str]"],
      ["evaluator_names", "Mapping[EvaluatorKey, str]"],
      ["rework_limit", "int", "optional"],
    ],
  },
  TicketRequest: {
    alias: "CreateTicketRequest | UpdateTicketRequest",
  },
  AdmittedCommand: {
    alias:
      "CreateTicketRequest | UpdateTicketRequest | DispatchTicket | RevokeTicket | ResumeTicket | ReportTaskTerminal | ReportFinalizationResult",
  },
  AcceptedInput: {
    fields: [
      ["input_id", "str"],
      ["ordinal", "int"],
      ["content_digest", "str"],
      ["authorization", "Authorization"],
      ["command", "AdmittedCommand"],
    ],
  },
  Decided: {
    fields: [
      ["event", "TicketEvent"],
      ["obligations", "tuple[Obligation, ...]"],
    ],
  },
  Refused: {
    fields: [["reason", "TicketRefusal"]],
  },
  Outcome: {
    alias: "Decided | Refused",
  },
  PublishedOutcome: {
    fields: [
      ["position", "int"],
      ["input", "AcceptedInput"],
      ["outcome", "Outcome"],
    ],
  },
  DeliverableObligation: {
    fields: [
      ["outcome_position", "int"],
      ["obligation_ordinal", "int"],
      ["obligation", "Obligation"],
    ],
  },
};
