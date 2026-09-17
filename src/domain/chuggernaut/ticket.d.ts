import {
  EvaluationInstance,
  EvaluationPlan,
  EvaluationReworkEntry,
} from "./evaluation.js";
import {
  ContentRef,
  CycleNumber,
  Generation,
  TaskDefinition,
  TaskId,
  TaskObligation,
  TaskTerminal,
  TicketId,
  ValidatedTaskResult,
  WorkspaceSource,
} from "./task.js";
export declare class AuthoredContent {
  readonly title: ContentRef;
  readonly instructions: ContentRef;
  readonly kind = "AuthoredContent";
  constructor(title: ContentRef, instructions: ContentRef);
}
export declare class LegacyContent {
  readonly content: ContentRef;
  readonly kind = "LegacyContent";
  constructor(content: ContentRef);
}
export type ReleasedContent = AuthoredContent | LegacyContent;
export declare class ReleasedWorkInput {
  readonly content: ReleasedContent;
  readonly input_bindings: ContentRef;
  readonly kind = "ReleasedWorkInput";
  constructor(content: ReleasedContent, input_bindings: ContentRef);
}
export declare class InitialWork {
  readonly kind = "InitialWork";
  constructor();
}
export declare class EvaluationRework {
  readonly entries: readonly EvaluationReworkEntry[];
  readonly kind = "EvaluationRework";
  constructor(entries: readonly EvaluationReworkEntry[]);
}
export declare class FinalizationRework {
  readonly evidence: ContentRef;
  readonly kind = "FinalizationRework";
  constructor(evidence: ContentRef);
}
export type WorkCause = InitialWork | EvaluationRework | FinalizationRework;
export declare class WorkInput {
  readonly released: ReleasedWorkInput;
  readonly cause: WorkCause;
  readonly retry_evidence: readonly ContentRef[];
  readonly kind = "WorkInput";
  constructor(
    released: ReleasedWorkInput,
    cause: WorkCause,
    retry_evidence: readonly ContentRef[],
  );
}
export declare class WorkExecution {
  readonly input: WorkInput;
  readonly source: WorkspaceSource;
  readonly kind = "WorkExecution";
  constructor(input: WorkInput, source: WorkspaceSource);
}
export declare class FinalizationOperation {
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly input: ContentRef;
  readonly source: WorkspaceSource;
  readonly kind = "FinalizationOperation";
  constructor(
    work_cycle: CycleNumber,
    generation: Generation,
    input: ContentRef,
    source: WorkspaceSource,
  );
}
export declare class ReworkEvaluationFailure {
  readonly kind = "ReworkEvaluationFailure";
  constructor();
}
export declare class EscalateEvaluationFailure {
  readonly kind = "EscalateEvaluationFailure";
  constructor();
}
export type FailureDisposition =
  ReworkEvaluationFailure | EscalateEvaluationFailure;
export type EvaluationFailurePolicy = (
  evaluation: EvaluationInstance,
) => FailureDisposition;
export declare class WorkEscalation {
  readonly resume_input: WorkInput;
  readonly source: WorkspaceSource;
  readonly evidence: ContentRef;
  readonly kind = "WorkEscalation";
  constructor(
    resume_input: WorkInput,
    source: WorkspaceSource,
    evidence: ContentRef,
  );
}
export declare class EvaluationFailureEscalation {
  readonly evidence: readonly EvaluationReworkEntry[];
  readonly source: WorkspaceSource;
  readonly kind = "EvaluationFailureEscalation";
  constructor(
    evidence: readonly EvaluationReworkEntry[],
    source: WorkspaceSource,
  );
}
export declare class FinalizationEscalation {
  readonly finalization: FinalizationOperation;
  readonly evidence: ContentRef;
  readonly kind = "FinalizationEscalation";
  constructor(finalization: FinalizationOperation, evidence: ContentRef);
}
export declare class WorkFailureEscalated {
  readonly escalation: WorkEscalation;
  readonly kind = "WorkFailureEscalated";
  constructor(escalation: WorkEscalation);
}
export declare class WorkExecutionUnavailableEscalated {
  readonly escalation: WorkEscalation;
  readonly kind = "WorkExecutionUnavailableEscalated";
  constructor(escalation: WorkEscalation);
}
export declare class EvaluationFailureEscalated {
  readonly escalation: EvaluationFailureEscalation;
  readonly kind = "EvaluationFailureEscalated";
  constructor(escalation: EvaluationFailureEscalation);
}
export declare class EvaluationBlockedEscalated {
  readonly evaluation: EvaluationInstance;
  readonly kind = "EvaluationBlockedEscalated";
  constructor(evaluation: EvaluationInstance);
}
export declare class FinalizationUnavailableEscalated {
  readonly escalation: FinalizationEscalation;
  readonly kind = "FinalizationUnavailableEscalated";
  constructor(escalation: FinalizationEscalation);
}
export type Escalation =
  | WorkFailureEscalated
  | WorkExecutionUnavailableEscalated
  | EvaluationFailureEscalated
  | EvaluationBlockedEscalated
  | FinalizationUnavailableEscalated;
export declare class ReleasedTicket {
  readonly id: TicketId;
  readonly content: ReleasedContent;
  readonly input_bindings: ContentRef;
  readonly dependencies: ReadonlySet<TicketId>;
  readonly work_configuration: TaskDefinition;
  readonly evaluation_plan: EvaluationPlan;
  readonly finalization_configuration: ContentRef;
  readonly kind = "ReleasedTicket";
  constructor(
    id: TicketId,
    content: ReleasedContent,
    input_bindings: ContentRef,
    dependencies: ReadonlySet<TicketId>,
    work_configuration: TaskDefinition,
    evaluation_plan: EvaluationPlan,
    finalization_configuration: ContentRef,
  );
}
export declare class Pending {
  readonly kind = "Pending";
  constructor();
}
export declare class Work {
  readonly execution: WorkExecution;
  readonly kind = "Work";
  constructor(execution: WorkExecution);
}
export declare class Evaluation {
  readonly evaluation: EvaluationInstance;
  readonly kind = "Evaluation";
  constructor(evaluation: EvaluationInstance);
}
export declare class Finalization {
  readonly operation: FinalizationOperation;
  readonly kind = "Finalization";
  constructor(operation: FinalizationOperation);
}
export declare class Escalated {
  readonly escalation: Escalation;
  readonly kind = "Escalated";
  constructor(escalation: Escalation);
}
export declare class Done {
  readonly kind = "Done";
  constructor();
}
export declare class Revoked {
  readonly kind = "Revoked";
  constructor();
}
export type TicketState =
  Pending | Work | Evaluation | Finalization | Escalated | Done | Revoked;
export declare class Ticket {
  readonly definition: ReleasedTicket;
  readonly revision: number;
  readonly work_cycles_started: number;
  readonly state: TicketState;
  readonly kind = "Ticket";
  constructor(
    definition: ReleasedTicket,
    revision: number,
    work_cycles_started: number,
    state: TicketState,
  );
}
export declare class TicketGraph {
  readonly tickets: ReadonlyMap<TicketId, Ticket>;
  readonly kind = "TicketGraph";
  constructor(tickets: ReadonlyMap<TicketId, Ticket>);
}
export declare class TaskTerminalReport {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly kind = "TaskTerminalReport";
  constructor(ticket: TicketId, terminal: TaskTerminal);
}
export declare class FinalizationSucceeded {
  readonly evidence: ContentRef;
  readonly kind = "FinalizationSucceeded";
  constructor(evidence: ContentRef);
}
export declare class FinalizationNeedsWork {
  readonly evidence: ContentRef;
  readonly kind = "FinalizationNeedsWork";
  constructor(evidence: ContentRef);
}
export declare class FinalizationResultUnavailable {
  readonly evidence: ContentRef;
  readonly kind = "FinalizationResultUnavailable";
  constructor(evidence: ContentRef);
}
export type FinalizationResult =
  FinalizationSucceeded | FinalizationNeedsWork | FinalizationResultUnavailable;
export declare class FinalizationResultReport {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly result: FinalizationResult;
  readonly kind = "FinalizationResultReport";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    generation: Generation,
    result: FinalizationResult,
  );
}
export declare class CreateTicket {
  readonly definition: ReleasedTicket;
  readonly kind = "CreateTicket";
  constructor(definition: ReleasedTicket);
}
export declare class UpdateTicket {
  readonly ticket: TicketId;
  readonly expected_revision: number;
  readonly definition: ReleasedTicket;
  readonly kind = "UpdateTicket";
  constructor(
    ticket: TicketId,
    expected_revision: number,
    definition: ReleasedTicket,
  );
}
export declare class DispatchTicket {
  readonly ticket: TicketId;
  readonly source: WorkspaceSource;
  readonly kind = "DispatchTicket";
  constructor(ticket: TicketId, source: WorkspaceSource);
}
export declare class RevokeTicket {
  readonly ticket: TicketId;
  readonly kind = "RevokeTicket";
  constructor(ticket: TicketId);
}
export declare class ResumeTicket {
  readonly ticket: TicketId;
  readonly kind = "ResumeTicket";
  constructor(ticket: TicketId);
}
export declare class ReportTaskTerminal {
  readonly report: TaskTerminalReport;
  readonly kind = "ReportTaskTerminal";
  constructor(report: TaskTerminalReport);
}
export declare class ReportFinalizationResult {
  readonly report: FinalizationResultReport;
  readonly kind = "ReportFinalizationResult";
  constructor(report: FinalizationResultReport);
}
export type TicketCommand =
  | CreateTicket
  | UpdateTicket
  | DispatchTicket
  | RevokeTicket
  | ResumeTicket
  | ReportTaskTerminal
  | ReportFinalizationResult;
export declare class TicketAlreadyExists {
  readonly ticket: TicketId;
  readonly kind = "TicketAlreadyExists";
  constructor(ticket: TicketId);
}
export declare class DependenciesNotFound {
  readonly ticket: TicketId;
  readonly dependencies: ReadonlySet<TicketId>;
  readonly kind = "DependenciesNotFound";
  constructor(ticket: TicketId, dependencies: ReadonlySet<TicketId>);
}
export declare class SelfDependency {
  readonly ticket: TicketId;
  readonly kind = "SelfDependency";
  constructor(ticket: TicketId);
}
export declare class TicketNotFound {
  readonly ticket: TicketId;
  readonly kind = "TicketNotFound";
  constructor(ticket: TicketId);
}
export declare class TicketNotPending {
  readonly ticket: TicketId;
  readonly kind = "TicketNotPending";
  constructor(ticket: TicketId);
}
export declare class TicketIdentityMismatch {
  readonly ticket: TicketId;
  readonly kind = "TicketIdentityMismatch";
  constructor(ticket: TicketId);
}
export declare class TicketRevisionStale {
  readonly ticket: TicketId;
  readonly expected: number;
  readonly current: number;
  readonly kind = "TicketRevisionStale";
  constructor(ticket: TicketId, expected: number, current: number);
}
export declare class TicketDependenciesChanged {
  readonly ticket: TicketId;
  readonly kind = "TicketDependenciesChanged";
  constructor(ticket: TicketId);
}
export declare class DispatchSourceRepositoryMismatch {
  readonly ticket: TicketId;
  readonly kind = "DispatchSourceRepositoryMismatch";
  constructor(ticket: TicketId);
}
export declare class DependenciesIncomplete {
  readonly ticket: TicketId;
  readonly dependencies: ReadonlySet<TicketId>;
  readonly kind = "DependenciesIncomplete";
  constructor(ticket: TicketId, dependencies: ReadonlySet<TicketId>);
}
export declare class TicketNotRevocable {
  readonly ticket: TicketId;
  readonly kind = "TicketNotRevocable";
  constructor(ticket: TicketId);
}
export declare class TicketNotResumable {
  readonly ticket: TicketId;
  readonly kind = "TicketNotResumable";
  constructor(ticket: TicketId);
}
export declare class TaskNotCurrent {
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly kind = "TaskNotCurrent";
  constructor(ticket: TicketId, task: TaskId);
}
export declare class WorkResultMissingExactGitOutput {
  readonly ticket: TicketId;
  readonly kind = "WorkResultMissingExactGitOutput";
  constructor(ticket: TicketId);
}
export declare class FinalizationNotCurrent {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly kind = "FinalizationNotCurrent";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    generation: Generation,
  );
}
export type TicketRefusal =
  | TicketAlreadyExists
  | DependenciesNotFound
  | SelfDependency
  | TicketNotFound
  | TicketNotPending
  | TicketIdentityMismatch
  | TicketRevisionStale
  | TicketDependenciesChanged
  | DispatchSourceRepositoryMismatch
  | DependenciesIncomplete
  | TicketNotRevocable
  | TicketNotResumable
  | TaskNotCurrent
  | WorkResultMissingExactGitOutput
  | FinalizationNotCurrent;
export declare class TicketCreated {
  readonly definition: ReleasedTicket;
  readonly kind = "TicketCreated";
  constructor(definition: ReleasedTicket);
}
export declare class TicketUpdated {
  readonly ticket: TicketId;
  readonly revision: number;
  readonly definition: ReleasedTicket;
  readonly kind = "TicketUpdated";
  constructor(ticket: TicketId, revision: number, definition: ReleasedTicket);
}
export declare class TicketDispatched {
  readonly ticket: TicketId;
  readonly source: WorkspaceSource;
  readonly kind = "TicketDispatched";
  constructor(ticket: TicketId, source: WorkspaceSource);
}
export declare class TicketRevoked {
  readonly ticket: TicketId;
  readonly kind = "TicketRevoked";
  constructor(ticket: TicketId);
}
export declare class TicketWorkResumed {
  readonly ticket: TicketId;
  readonly kind = "TicketWorkResumed";
  constructor(ticket: TicketId);
}
export declare class TicketEvaluationResumed {
  readonly ticket: TicketId;
  readonly kind = "TicketEvaluationResumed";
  constructor(ticket: TicketId);
}
export declare class TicketFinalizationResumed {
  readonly ticket: TicketId;
  readonly kind = "TicketFinalizationResumed";
  constructor(ticket: TicketId);
}
export declare class TicketWorkResultAccepted {
  readonly ticket: TicketId;
  readonly result: ValidatedTaskResult;
  readonly kind = "TicketWorkResultAccepted";
  constructor(ticket: TicketId, result: ValidatedTaskResult);
}
export declare class TicketWorkProcessFailed {
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly evidence: ContentRef;
  readonly kind = "TicketWorkProcessFailed";
  constructor(ticket: TicketId, task: TaskId, evidence: ContentRef);
}
export declare class TicketWorkExecutionUnavailable {
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly evidence: ContentRef;
  readonly kind = "TicketWorkExecutionUnavailable";
  constructor(ticket: TicketId, task: TaskId, evidence: ContentRef);
}
export declare class TicketEvaluationProgressed {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly kind = "TicketEvaluationProgressed";
  constructor(ticket: TicketId, terminal: TaskTerminal);
}
export declare class TicketEvaluationPassed {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly kind = "TicketEvaluationPassed";
  constructor(ticket: TicketId, terminal: TaskTerminal);
}
export declare class TicketEvaluationReworkStarted {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly evidence: readonly EvaluationReworkEntry[];
  readonly kind = "TicketEvaluationReworkStarted";
  constructor(
    ticket: TicketId,
    terminal: TaskTerminal,
    evidence: readonly EvaluationReworkEntry[],
  );
}
export declare class TicketEvaluationFailureEscalated {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly evidence: readonly EvaluationReworkEntry[];
  readonly kind = "TicketEvaluationFailureEscalated";
  constructor(
    ticket: TicketId,
    terminal: TaskTerminal,
    evidence: readonly EvaluationReworkEntry[],
  );
}
export declare class TicketEvaluationBlocked {
  readonly ticket: TicketId;
  readonly terminal: TaskTerminal;
  readonly kind = "TicketEvaluationBlocked";
  constructor(ticket: TicketId, terminal: TaskTerminal);
}
export declare class TicketFinalizationSucceeded {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly evidence: ContentRef;
  readonly kind = "TicketFinalizationSucceeded";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    generation: Generation,
    evidence: ContentRef,
  );
}
export declare class TicketFinalizationNeedsWork {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly evidence: ContentRef;
  readonly kind = "TicketFinalizationNeedsWork";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    generation: Generation,
    evidence: ContentRef,
  );
}
export declare class TicketFinalizationUnavailable {
  readonly ticket: TicketId;
  readonly work_cycle: CycleNumber;
  readonly generation: Generation;
  readonly evidence: ContentRef;
  readonly kind = "TicketFinalizationUnavailable";
  constructor(
    ticket: TicketId,
    work_cycle: CycleNumber,
    generation: Generation,
    evidence: ContentRef,
  );
}
export type TicketEvent =
  | TicketCreated
  | TicketUpdated
  | TicketDispatched
  | TicketRevoked
  | TicketWorkResumed
  | TicketEvaluationResumed
  | TicketFinalizationResumed
  | TicketWorkResultAccepted
  | TicketWorkProcessFailed
  | TicketWorkExecutionUnavailable
  | TicketEvaluationProgressed
  | TicketEvaluationPassed
  | TicketEvaluationReworkStarted
  | TicketEvaluationFailureEscalated
  | TicketEvaluationBlocked
  | TicketFinalizationSucceeded
  | TicketFinalizationNeedsWork
  | TicketFinalizationUnavailable;
export declare class ExecuteTask {
  readonly ticket: TicketId;
  readonly task: TaskObligation;
  readonly kind = "ExecuteTask";
  constructor(ticket: TicketId, task: TaskObligation);
}
export declare class FinalizeTicket {
  readonly ticket: TicketId;
  readonly finalization: FinalizationOperation;
  readonly configuration: ContentRef;
  readonly kind = "FinalizeTicket";
  constructor(
    ticket: TicketId,
    finalization: FinalizationOperation,
    configuration: ContentRef,
  );
}
export declare class CancelTask {
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly kind = "CancelTask";
  constructor(ticket: TicketId, task: TaskId);
}
export type Obligation = ExecuteTask | FinalizeTicket | CancelTask;
export declare class TicketRefused {
  readonly reason: TicketRefusal;
  readonly kind = "TicketRefused";
  constructor(reason: TicketRefusal);
}
export declare class TicketDecided {
  readonly event: TicketEvent;
  readonly obligations: readonly Obligation[];
  readonly kind = "TicketDecided";
  constructor(event: TicketEvent, obligations: readonly Obligation[]);
}
export type TicketDecision = TicketRefused | TicketDecided;
export declare function rework_policy(
  _evaluation: EvaluationInstance,
): FailureDisposition;
export declare function is_terminal(s: TicketState): boolean;
export declare function is_pending(s: TicketState): boolean;
export declare function is_escalated(s: TicketState): boolean;
export declare function validate_release(d: ReleasedTicket): void;
export declare function validate_command(c: TicketCommand): void;
export declare function work_task_identity(
  ticket: TicketId,
  cycle: CycleNumber,
): TaskId;
export declare function released_work_input(
  d: ReleasedTicket,
): ReleasedWorkInput;
export declare function initial_work_input(d: ReleasedTicket): WorkInput;
export declare function retry_work_input(
  i: WorkInput,
  e: ContentRef,
): WorkInput;
export declare function next_cycle_number(t: Ticket): CycleNumber;
export declare function evaluation_rework_input(
  d: ReleasedTicket,
  entries: readonly EvaluationReworkEntry[],
): WorkInput;
export declare function finalization_rework_input(
  d: ReleasedTicket,
  e: ContentRef,
): WorkInput;
export declare function work_context(i: WorkInput): readonly ContentRef[];
export declare function work_task_obligation(
  t: Ticket,
  n: CycleNumber,
  s: WorkspaceSource,
  i: WorkInput,
): TaskObligation;
export declare function execute_work(
  t: Ticket,
  n: CycleNumber,
  s: WorkspaceSource,
  i: WorkInput,
): Obligation;
export declare function resumed_finalization(
  o: FinalizationOperation,
): FinalizationOperation;
export declare function execute_evaluation_tasks(
  id: TicketId,
  e: EvaluationInstance,
): readonly Obligation[];
export declare function finalize(
  t: Ticket,
  o: FinalizationOperation,
): Obligation;
export declare function dependency_complete(
  g: TicketGraph,
  id: TicketId,
): boolean;
export declare function incomplete_dependencies(
  g: TicketGraph,
  t: Ticket,
): ReadonlySet<TicketId>;
export declare function dependencies_complete(
  g: TicketGraph,
  t: Ticket,
): boolean;
export declare function is_ready(g: TicketGraph, id: TicketId): boolean;
export declare function revocation_allowed(s: TicketState): boolean;
export declare function live_task_list(t: Ticket): readonly TaskId[];
export declare function list_has_task(
  ts: readonly TaskId[],
  t: TaskId,
): boolean;
export declare function cancel_live_tasks(t: Ticket): readonly Obligation[];
export declare function ticket_live_tasks(
  g: TicketGraph,
  id: TicketId,
): readonly TaskId[];
export declare function decide(
  g: TicketGraph,
  c: TicketCommand,
  policy: EvaluationFailurePolicy,
): TicketDecision;
export declare function evolve(g: TicketGraph, f: TicketEvent): TicketGraph;
export declare function evolve_checked(
  g: TicketGraph,
  f: TicketEvent,
): TicketGraph;
export declare function apply_decision(
  g: TicketGraph,
  d: TicketDecision,
): TicketGraph;
export declare function apply_command(
  g: TicketGraph,
  c: TicketCommand,
  p: EvaluationFailurePolicy,
): TicketGraph;
export declare function graph_invariant(g: TicketGraph): boolean;
export declare function decision_valid(
  g: TicketGraph,
  d: TicketDecision,
): boolean;
