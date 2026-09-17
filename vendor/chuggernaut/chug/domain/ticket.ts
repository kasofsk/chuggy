import {
  EvaluationBlocked,
  EvaluationFailed,
  EvaluationInput,
  EvaluationInstance,
  EvaluationPassed,
  EvaluationPlan,
  EvaluationReworkEntry,
  Running,
  apply_terminal,
  begin,
  current_task_obligations,
  evaluation_invariant,
  resume_blocked,
  rework_entries,
  task_current,
  validate_plan,
} from "./evaluation.js";

import {
  ContentRef,
  CycleNumber,
  Generation,
  TaskDefinition,
  TaskId,
  TaskObligation,
  TaskProcessFailed,
  TaskResultProduced,
  TaskTerminal,
  TicketId,
  ValidatedTaskResult,
  WorkspaceSource,
  WorkTaskId,
  exact_git_output,
  publishes_repository_result,
  task_owner,
  terminal_task,
} from "./task.js";

export class AuthoredContent {
  readonly kind = "AuthoredContent";
  constructor(
    readonly title: ContentRef,
    readonly instructions: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class LegacyContent {
  readonly kind = "LegacyContent";
  constructor(readonly content: ContentRef) {
    Object.freeze(this);
  }
}

export type ReleasedContent = AuthoredContent | LegacyContent;

export class ReleasedWorkInput {
  readonly kind = "ReleasedWorkInput";
  constructor(
    readonly content: ReleasedContent,
    readonly input_bindings: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class InitialWork {
  readonly kind = "InitialWork";
  constructor() {
    Object.freeze(this);
  }
}

export class EvaluationRework {
  readonly kind = "EvaluationRework";
  constructor(readonly entries: readonly EvaluationReworkEntry[]) {
    this.entries = Object.freeze([...entries]);

    Object.freeze(this);
  }
}

export class FinalizationRework {
  readonly kind = "FinalizationRework";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export type WorkCause = InitialWork | EvaluationRework | FinalizationRework;

export class WorkInput {
  readonly kind = "WorkInput";
  constructor(
    readonly released: ReleasedWorkInput,
    readonly cause: WorkCause,
    readonly retry_evidence: readonly ContentRef[],
  ) {
    this.retry_evidence = Object.freeze([...retry_evidence]);

    Object.freeze(this);
  }
}

export class WorkExecution {
  readonly kind = "WorkExecution";
  constructor(
    readonly input: WorkInput,
    readonly source: WorkspaceSource,
  ) {
    Object.freeze(this);
  }
}

export class FinalizationOperation {
  readonly kind = "FinalizationOperation";
  constructor(
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
    readonly input: ContentRef,
    readonly source: WorkspaceSource,
  ) {
    Object.freeze(this);
  }
}

export class ReworkEvaluationFailure {
  readonly kind = "ReworkEvaluationFailure";
  constructor() {
    Object.freeze(this);
  }
}

export class EscalateEvaluationFailure {
  readonly kind = "EscalateEvaluationFailure";
  constructor() {
    Object.freeze(this);
  }
}

export type FailureDisposition =
  ReworkEvaluationFailure | EscalateEvaluationFailure;

export type EvaluationFailurePolicy = (
  evaluation: EvaluationInstance,
) => FailureDisposition;

export class WorkEscalation {
  readonly kind = "WorkEscalation";
  constructor(
    readonly resume_input: WorkInput,
    readonly source: WorkspaceSource,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class EvaluationFailureEscalation {
  readonly kind = "EvaluationFailureEscalation";
  constructor(
    readonly evidence: readonly EvaluationReworkEntry[],
    readonly source: WorkspaceSource,
  ) {
    this.evidence = Object.freeze([...evidence]);

    Object.freeze(this);
  }
}

export class FinalizationEscalation {
  readonly kind = "FinalizationEscalation";
  constructor(
    readonly finalization: FinalizationOperation,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class WorkFailureEscalated {
  readonly kind = "WorkFailureEscalated";
  constructor(readonly escalation: WorkEscalation) {
    Object.freeze(this);
  }
}

export class WorkExecutionUnavailableEscalated {
  readonly kind = "WorkExecutionUnavailableEscalated";
  constructor(readonly escalation: WorkEscalation) {
    Object.freeze(this);
  }
}

export class EvaluationFailureEscalated {
  readonly kind = "EvaluationFailureEscalated";
  constructor(readonly escalation: EvaluationFailureEscalation) {
    Object.freeze(this);
  }
}

export class EvaluationBlockedEscalated {
  readonly kind = "EvaluationBlockedEscalated";
  constructor(readonly evaluation: EvaluationInstance) {
    Object.freeze(this);
  }
}

export class FinalizationUnavailableEscalated {
  readonly kind = "FinalizationUnavailableEscalated";
  constructor(readonly escalation: FinalizationEscalation) {
    Object.freeze(this);
  }
}

export type Escalation =
  | WorkFailureEscalated
  | WorkExecutionUnavailableEscalated
  | EvaluationFailureEscalated
  | EvaluationBlockedEscalated
  | FinalizationUnavailableEscalated;

export class ReleasedTicket {
  readonly kind = "ReleasedTicket";
  constructor(
    readonly id: TicketId,
    readonly content: ReleasedContent,
    readonly input_bindings: ContentRef,
    readonly dependencies: ReadonlySet<TicketId>,
    readonly work_configuration: TaskDefinition,
    readonly evaluation_plan: EvaluationPlan,
    readonly finalization_configuration: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class Pending {
  readonly kind = "Pending";
  constructor() {
    Object.freeze(this);
  }
}

export class Work {
  readonly kind = "Work";
  constructor(readonly execution: WorkExecution) {
    Object.freeze(this);
  }
}

export class Evaluation {
  readonly kind = "Evaluation";
  constructor(readonly evaluation: EvaluationInstance) {
    Object.freeze(this);
  }
}

export class Finalization {
  readonly kind = "Finalization";
  constructor(readonly operation: FinalizationOperation) {
    Object.freeze(this);
  }
}

export class Escalated {
  readonly kind = "Escalated";
  constructor(readonly escalation: Escalation) {
    Object.freeze(this);
  }
}

export class Done {
  readonly kind = "Done";
  constructor() {
    Object.freeze(this);
  }
}

export class Revoked {
  readonly kind = "Revoked";
  constructor() {
    Object.freeze(this);
  }
}

export type TicketState =
  Pending | Work | Evaluation | Finalization | Escalated | Done | Revoked;

export class Ticket {
  readonly kind = "Ticket";
  constructor(
    readonly definition: ReleasedTicket,
    readonly revision: number,
    readonly work_cycles_started: number,
    readonly state: TicketState,
  ) {
    Object.freeze(this);
  }
}

export class TicketGraph {
  readonly kind = "TicketGraph";
  constructor(readonly tickets: ReadonlyMap<TicketId, Ticket>) {
    validate_TicketGraph(this);
    Object.freeze(this);
  }
}

export class TaskTerminalReport {
  readonly kind = "TaskTerminalReport";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
  ) {
    Object.freeze(this);
  }
}

export class FinalizationSucceeded {
  readonly kind = "FinalizationSucceeded";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export class FinalizationNeedsWork {
  readonly kind = "FinalizationNeedsWork";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export class FinalizationResultUnavailable {
  readonly kind = "FinalizationResultUnavailable";
  constructor(readonly evidence: ContentRef) {
    Object.freeze(this);
  }
}

export type FinalizationResult =
  FinalizationSucceeded | FinalizationNeedsWork | FinalizationResultUnavailable;

export class FinalizationResultReport {
  readonly kind = "FinalizationResultReport";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
    readonly result: FinalizationResult,
  ) {
    Object.freeze(this);
  }
}

export class CreateTicket {
  readonly kind = "CreateTicket";
  constructor(readonly definition: ReleasedTicket) {
    Object.freeze(this);
  }
}

export class UpdateTicket {
  readonly kind = "UpdateTicket";
  constructor(
    readonly ticket: TicketId,
    readonly expected_revision: number,
    readonly definition: ReleasedTicket,
  ) {
    Object.freeze(this);
  }
}

export class DispatchTicket {
  readonly kind = "DispatchTicket";
  constructor(
    readonly ticket: TicketId,
    readonly source: WorkspaceSource,
  ) {
    Object.freeze(this);
  }
}

export class RevokeTicket {
  readonly kind = "RevokeTicket";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class ResumeTicket {
  readonly kind = "ResumeTicket";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class ReportTaskTerminal {
  readonly kind = "ReportTaskTerminal";
  constructor(readonly report: TaskTerminalReport) {
    Object.freeze(this);
  }
}

export class ReportFinalizationResult {
  readonly kind = "ReportFinalizationResult";
  constructor(readonly report: FinalizationResultReport) {
    Object.freeze(this);
  }
}

export type TicketCommand =
  | CreateTicket
  | UpdateTicket
  | DispatchTicket
  | RevokeTicket
  | ResumeTicket
  | ReportTaskTerminal
  | ReportFinalizationResult;

export class TicketAlreadyExists {
  readonly kind = "TicketAlreadyExists";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class DependenciesNotFound {
  readonly kind = "DependenciesNotFound";
  constructor(
    readonly ticket: TicketId,
    readonly dependencies: ReadonlySet<TicketId>,
  ) {
    Object.freeze(this);
  }
}

export class SelfDependency {
  readonly kind = "SelfDependency";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketNotFound {
  readonly kind = "TicketNotFound";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketNotPending {
  readonly kind = "TicketNotPending";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketIdentityMismatch {
  readonly kind = "TicketIdentityMismatch";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketRevisionStale {
  readonly kind = "TicketRevisionStale";
  constructor(
    readonly ticket: TicketId,
    readonly expected: number,
    readonly current: number,
  ) {
    Object.freeze(this);
  }
}

export class TicketDependenciesChanged {
  readonly kind = "TicketDependenciesChanged";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class DispatchSourceRepositoryMismatch {
  readonly kind = "DispatchSourceRepositoryMismatch";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class DependenciesIncomplete {
  readonly kind = "DependenciesIncomplete";
  constructor(
    readonly ticket: TicketId,
    readonly dependencies: ReadonlySet<TicketId>,
  ) {
    Object.freeze(this);
  }
}

export class TicketNotRevocable {
  readonly kind = "TicketNotRevocable";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketNotResumable {
  readonly kind = "TicketNotResumable";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TaskNotCurrent {
  readonly kind = "TaskNotCurrent";
  constructor(
    readonly ticket: TicketId,
    readonly task: TaskId,
  ) {
    Object.freeze(this);
  }
}

export class WorkResultMissingExactGitOutput {
  readonly kind = "WorkResultMissingExactGitOutput";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class FinalizationNotCurrent {
  readonly kind = "FinalizationNotCurrent";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
  ) {
    Object.freeze(this);
  }
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

export class TicketCreated {
  readonly kind = "TicketCreated";
  constructor(readonly definition: ReleasedTicket) {
    Object.freeze(this);
  }
}

export class TicketUpdated {
  readonly kind = "TicketUpdated";
  constructor(
    readonly ticket: TicketId,
    readonly revision: number,
    readonly definition: ReleasedTicket,
  ) {
    Object.freeze(this);
  }
}

export class TicketDispatched {
  readonly kind = "TicketDispatched";
  constructor(
    readonly ticket: TicketId,
    readonly source: WorkspaceSource,
  ) {
    Object.freeze(this);
  }
}

export class TicketRevoked {
  readonly kind = "TicketRevoked";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketWorkResumed {
  readonly kind = "TicketWorkResumed";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketEvaluationResumed {
  readonly kind = "TicketEvaluationResumed";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketFinalizationResumed {
  readonly kind = "TicketFinalizationResumed";
  constructor(readonly ticket: TicketId) {
    Object.freeze(this);
  }
}

export class TicketWorkResultAccepted {
  readonly kind = "TicketWorkResultAccepted";
  constructor(
    readonly ticket: TicketId,
    readonly result: ValidatedTaskResult,
  ) {
    Object.freeze(this);
  }
}

export class TicketWorkProcessFailed {
  readonly kind = "TicketWorkProcessFailed";
  constructor(
    readonly ticket: TicketId,
    readonly task: TaskId,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class TicketWorkExecutionUnavailable {
  readonly kind = "TicketWorkExecutionUnavailable";
  constructor(
    readonly ticket: TicketId,
    readonly task: TaskId,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class TicketEvaluationProgressed {
  readonly kind = "TicketEvaluationProgressed";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
  ) {
    Object.freeze(this);
  }
}

export class TicketEvaluationPassed {
  readonly kind = "TicketEvaluationPassed";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
  ) {
    Object.freeze(this);
  }
}

export class TicketEvaluationReworkStarted {
  readonly kind = "TicketEvaluationReworkStarted";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
    readonly evidence: readonly EvaluationReworkEntry[],
  ) {
    this.evidence = Object.freeze([...evidence]);

    Object.freeze(this);
  }
}

export class TicketEvaluationFailureEscalated {
  readonly kind = "TicketEvaluationFailureEscalated";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
    readonly evidence: readonly EvaluationReworkEntry[],
  ) {
    this.evidence = Object.freeze([...evidence]);

    Object.freeze(this);
  }
}

export class TicketEvaluationBlocked {
  readonly kind = "TicketEvaluationBlocked";
  constructor(
    readonly ticket: TicketId,
    readonly terminal: TaskTerminal,
  ) {
    Object.freeze(this);
  }
}

export class TicketFinalizationSucceeded {
  readonly kind = "TicketFinalizationSucceeded";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class TicketFinalizationNeedsWork {
  readonly kind = "TicketFinalizationNeedsWork";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class TicketFinalizationUnavailable {
  readonly kind = "TicketFinalizationUnavailable";
  constructor(
    readonly ticket: TicketId,
    readonly work_cycle: CycleNumber,
    readonly generation: Generation,
    readonly evidence: ContentRef,
  ) {
    Object.freeze(this);
  }
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

export class ExecuteTask {
  readonly kind = "ExecuteTask";
  constructor(
    readonly ticket: TicketId,
    readonly task: TaskObligation,
  ) {
    Object.freeze(this);
  }
}

export class FinalizeTicket {
  readonly kind = "FinalizeTicket";
  constructor(
    readonly ticket: TicketId,
    readonly finalization: FinalizationOperation,
    readonly configuration: ContentRef,
  ) {
    Object.freeze(this);
  }
}

export class CancelTask {
  readonly kind = "CancelTask";
  constructor(
    readonly ticket: TicketId,
    readonly task: TaskId,
  ) {
    Object.freeze(this);
  }
}

export type Obligation = ExecuteTask | FinalizeTicket | CancelTask;

export class TicketRefused {
  readonly kind = "TicketRefused";
  constructor(readonly reason: TicketRefusal) {
    Object.freeze(this);
  }
}

export class TicketDecided {
  readonly kind = "TicketDecided";
  constructor(
    readonly event: TicketEvent,
    readonly obligations: readonly Obligation[],
  ) {
    this.obligations = Object.freeze([...obligations]);

    Object.freeze(this);
  }
}

export type TicketDecision = TicketRefused | TicketDecided;

import { equal, repr } from "./task.js";
function validate_TicketGraph(v: TicketGraph): void {
  Object.defineProperty(v, "tickets", {
    value: new Map(v.tickets),
    enumerable: true,
  });
}
export function rework_policy(
  _evaluation: EvaluationInstance,
): FailureDisposition {
  return new ReworkEvaluationFailure();
}
export function is_terminal(s: TicketState): boolean {
  return s instanceof Done || s instanceof Revoked;
}
export function is_pending(s: TicketState): boolean {
  return s instanceof Pending;
}
export function is_escalated(s: TicketState): boolean {
  return s instanceof Escalated;
}
function _released_content_error(c: ReleasedContent): string | null {
  if (c instanceof AuthoredContent) {
    if (c.title <= 0) return `released title must be present: ${c.title}`;
    if (c.instructions <= 0)
      return `released instructions must be present: ${c.instructions}`;
  } else if (c.content <= 0)
    return `legacy released content must be present: ${c.content}`;
  return null;
}
function _release_error(d: ReleasedTicket): string | null {
  if (d.id <= 0) return `ticket id must be present: ${d.id}`;
  const e = _released_content_error(d.content);
  if (e) return e;
  if (d.input_bindings <= 0)
    return `input bindings must be present: ${d.input_bindings}`;
  const absent = [...d.dependencies]
    .filter((x) => x <= 0)
    .sort((a, b) => a - b);
  if (absent.length)
    return `dependencies must be present ticket ids: [${absent.join(", ")}]`;
  const r = d.work_configuration.execution_requirements.repository;
  if (!validate_plan(d.evaluation_plan, r))
    return `evaluation plan is not releasable on repository ${r}`;
  if (d.finalization_configuration <= 0)
    return `finalization configuration must be present: ${d.finalization_configuration}`;
  return null;
}
export function validate_release(d: ReleasedTicket): void {
  const error = _release_error(d);
  if (error) throw new Error(error);
}
export function validate_command(c: TicketCommand): void {
  const pos = (v: number, label: string) => {
    if (v <= 0) throw new Error(`${label}: ${v}`);
  };
  if (c instanceof CreateTicket) validate_release(c.definition);
  else if (c instanceof UpdateTicket) {
    pos(c.ticket, "updated ticket must be present");
    pos(c.expected_revision, "expected revision must be present");
    validate_release(c.definition);
  } else if (c instanceof DispatchTicket) {
    pos(c.ticket, "dispatched ticket must be present");
    pos(c.source.repository, "dispatch source repository must be present");
    pos(c.source.commit, "dispatch source commit must be present");
  } else if (c instanceof ReportFinalizationResult) {
    pos(c.report.ticket, "reported ticket must be present");
    pos(c.report.work_cycle, "reported work cycle must be present");
    pos(c.report.generation, "reported generation must be present");
    pos(c.report.result.evidence, "finalization evidence must be present");
  }
}
export function work_task_identity(
  ticket: TicketId,
  cycle: CycleNumber,
): TaskId {
  return new WorkTaskId(ticket, cycle);
}
export function released_work_input(d: ReleasedTicket): ReleasedWorkInput {
  return new ReleasedWorkInput(d.content, d.input_bindings);
}
export function initial_work_input(d: ReleasedTicket): WorkInput {
  return new WorkInput(released_work_input(d), new InitialWork(), []);
}
export function retry_work_input(i: WorkInput, e: ContentRef): WorkInput {
  return new WorkInput(i.released, i.cause, [...i.retry_evidence, e]);
}
export function next_cycle_number(t: Ticket): CycleNumber {
  return CycleNumber(t.work_cycles_started + 1);
}
export function evaluation_rework_input(
  d: ReleasedTicket,
  entries: readonly EvaluationReworkEntry[],
): WorkInput {
  return new WorkInput(
    released_work_input(d),
    new EvaluationRework(entries),
    [],
  );
}
export function finalization_rework_input(
  d: ReleasedTicket,
  e: ContentRef,
): WorkInput {
  return new WorkInput(released_work_input(d), new FinalizationRework(e), []);
}
export function work_context(i: WorkInput): readonly ContentRef[] {
  const c = i.released.content;
  return [
    ...(c instanceof AuthoredContent ? [c.title, c.instructions] : [c.content]),
    i.released.input_bindings,
    ...(i.cause instanceof InitialWork
      ? []
      : i.cause instanceof EvaluationRework
        ? i.cause.entries.map((e) => e.result_manifest)
        : [i.cause.evidence]),
    ...i.retry_evidence,
  ];
}
export function work_task_obligation(
  t: Ticket,
  n: CycleNumber,
  s: WorkspaceSource,
  i: WorkInput,
): TaskObligation {
  return new TaskObligation(
    work_task_identity(t.definition.id, n),
    t.definition.work_configuration,
    s,
    work_context(i),
  );
}
export function execute_work(
  t: Ticket,
  n: CycleNumber,
  s: WorkspaceSource,
  i: WorkInput,
): Obligation {
  return new ExecuteTask(t.definition.id, work_task_obligation(t, n, s, i));
}
export function resumed_finalization(
  o: FinalizationOperation,
): FinalizationOperation {
  return new FinalizationOperation(
    o.work_cycle,
    Generation(o.generation + 1),
    o.input,
    o.source,
  );
}
export function execute_evaluation_tasks(
  id: TicketId,
  e: EvaluationInstance,
): readonly Obligation[] {
  return current_task_obligations(e).map((t) => new ExecuteTask(id, t));
}
export function finalize(t: Ticket, o: FinalizationOperation): Obligation {
  return new FinalizeTicket(
    t.definition.id,
    o,
    t.definition.finalization_configuration,
  );
}
export function dependency_complete(g: TicketGraph, id: TicketId): boolean {
  return g.tickets.get(id)?.state instanceof Done;
}
export function incomplete_dependencies(
  g: TicketGraph,
  t: Ticket,
): ReadonlySet<TicketId> {
  return new Set(
    [...t.definition.dependencies].filter((id) => !dependency_complete(g, id)),
  );
}
export function dependencies_complete(g: TicketGraph, t: Ticket): boolean {
  return incomplete_dependencies(g, t).size === 0;
}
export function is_ready(g: TicketGraph, id: TicketId): boolean {
  const t = g.tickets.get(id);
  return t !== undefined && is_pending(t.state) && dependencies_complete(g, t);
}
export function revocation_allowed(s: TicketState): boolean {
  return !(
    s instanceof Finalization ||
    s instanceof Done ||
    s instanceof Revoked
  );
}
export function live_task_list(t: Ticket): readonly TaskId[] {
  return t.state instanceof Work
    ? [work_task_identity(t.definition.id, CycleNumber(t.work_cycles_started))]
    : t.state instanceof Evaluation
      ? current_task_obligations(t.state.evaluation).map((o) => o.task)
      : [];
}
export function list_has_task(ts: readonly TaskId[], t: TaskId): boolean {
  return ts.some((c) => equal(c, t));
}
export function cancel_live_tasks(t: Ticket): readonly Obligation[] {
  return live_task_list(t).map((task) => new CancelTask(t.definition.id, task));
}
export function ticket_live_tasks(
  g: TicketGraph,
  id: TicketId,
): readonly TaskId[] {
  const t = g.tickets.get(id);
  return t ? live_task_list(t) : [];
}
function refuse(r: TicketRefusal): TicketDecision {
  return new TicketRefused(r);
}
function decided(
  e: TicketEvent,
  obligations: readonly Obligation[] = [],
): TicketDecision {
  return new TicketDecided(e, obligations);
}
export function decide(
  g: TicketGraph,
  c: TicketCommand,
  policy: EvaluationFailurePolicy,
): TicketDecision {
  if (c instanceof CreateTicket) {
    const d = c.definition;
    if (g.tickets.has(d.id)) return refuse(new TicketAlreadyExists(d.id));
    if (d.dependencies.has(d.id)) return refuse(new SelfDependency(d.id));
    const missing = new Set(
      [...d.dependencies].filter((id) => !g.tickets.has(id)),
    );
    return missing.size
      ? refuse(new DependenciesNotFound(d.id, missing))
      : decided(new TicketCreated(d));
  }
  const id =
      c instanceof ReportTaskTerminal || c instanceof ReportFinalizationResult
        ? c.report.ticket
        : c.ticket,
    t = g.tickets.get(id);
  if (!t) return refuse(new TicketNotFound(id));
  if (c instanceof UpdateTicket) {
    if (!is_pending(t.state)) return refuse(new TicketNotPending(id));
    if (c.definition.id !== id) return refuse(new TicketIdentityMismatch(id));
    if (c.expected_revision !== t.revision)
      return refuse(
        new TicketRevisionStale(id, c.expected_revision, t.revision),
      );
    if (!equal(c.definition.dependencies, t.definition.dependencies))
      return refuse(new TicketDependenciesChanged(id));
    return decided(new TicketUpdated(id, t.revision + 1, c.definition));
  }
  if (c instanceof DispatchTicket) {
    if (!is_pending(t.state)) return refuse(new TicketNotPending(id));
    if (
      c.source.repository !==
      t.definition.work_configuration.execution_requirements.repository
    )
      return refuse(new DispatchSourceRepositoryMismatch(id));
    const incomplete = incomplete_dependencies(g, t);
    return incomplete.size
      ? refuse(new DependenciesIncomplete(id, incomplete))
      : decided(new TicketDispatched(id, c.source), [
          execute_work(
            t,
            next_cycle_number(t),
            c.source,
            initial_work_input(t.definition),
          ),
        ]);
  }
  if (c instanceof RevokeTicket)
    return revocation_allowed(t.state)
      ? decided(new TicketRevoked(id), cancel_live_tasks(t))
      : refuse(new TicketNotRevocable(id));
  if (c instanceof ResumeTicket) {
    if (!(t.state instanceof Escalated))
      return refuse(new TicketNotResumable(id));
    const e = t.state.escalation;
    if (
      e instanceof WorkFailureEscalated ||
      e instanceof WorkExecutionUnavailableEscalated
    )
      return decided(new TicketWorkResumed(id), [
        execute_work(
          t,
          next_cycle_number(t),
          e.escalation.source,
          e.escalation.resume_input,
        ),
      ]);
    if (e instanceof EvaluationFailureEscalated)
      return decided(new TicketWorkResumed(id), [
        execute_work(
          t,
          next_cycle_number(t),
          e.escalation.source,
          evaluation_rework_input(t.definition, e.escalation.evidence),
        ),
      ]);
    if (e instanceof EvaluationBlockedEscalated)
      return decided(
        new TicketEvaluationResumed(id),
        execute_evaluation_tasks(id, resume_blocked(e.evaluation)),
      );
    return decided(new TicketFinalizationResumed(id), [
      finalize(t, resumed_finalization(e.escalation.finalization)),
    ]);
  }
  if (c instanceof ReportFinalizationResult) {
    const r = c.report;
    if (
      !(t.state instanceof Finalization) ||
      !_finalization_current(t.state.operation, r.work_cycle, r.generation)
    )
      return refuse(new FinalizationNotCurrent(id, r.work_cycle, r.generation));
    const evidence = r.result.evidence;
    if (r.result instanceof FinalizationSucceeded)
      return decided(
        new TicketFinalizationSucceeded(
          id,
          r.work_cycle,
          r.generation,
          evidence,
        ),
      );
    if (r.result instanceof FinalizationNeedsWork)
      return decided(
        new TicketFinalizationNeedsWork(
          id,
          r.work_cycle,
          r.generation,
          evidence,
        ),
        [
          execute_work(
            t,
            next_cycle_number(t),
            t.state.operation.source,
            finalization_rework_input(t.definition, evidence),
          ),
        ],
      );
    return decided(
      new TicketFinalizationUnavailable(
        id,
        r.work_cycle,
        r.generation,
        evidence,
      ),
    );
  }
  const terminal = c.report.terminal,
    task = terminal_task(terminal);
  if (
    t.state instanceof Work &&
    equal(work_task_identity(id, CycleNumber(t.work_cycles_started)), task)
  ) {
    if (terminal instanceof TaskResultProduced) {
      const source = publishes_repository_result(
        t.definition.work_configuration,
        t.state.execution.source.repository,
      )
        ? exact_git_output(terminal.result)
        : t.state.execution.source;
      if (!source) return refuse(new WorkResultMissingExactGitOutput(id));
      const e = begin(
        CycleNumber(t.work_cycles_started),
        new EvaluationInput(id, terminal.result.manifest, source),
        t.definition.evaluation_plan,
      );
      return decided(
        new TicketWorkResultAccepted(id, terminal.result),
        execute_evaluation_tasks(id, e),
      );
    }
    return decided(
      terminal instanceof TaskProcessFailed
        ? new TicketWorkProcessFailed(id, task, terminal.failure.evidence)
        : new TicketWorkExecutionUnavailable(
            id,
            task,
            terminal.failure.evidence,
          ),
    );
  }
  if (t.state instanceof Evaluation && task_current(t.state.evaluation, task)) {
    const prior = t.state.evaluation,
      updated = apply_terminal(prior, task, terminal),
      s = updated.state;
    if (s instanceof Running)
      return decided(
        new TicketEvaluationProgressed(id, terminal),
        prior.state instanceof Running &&
          prior.state.progress.stage.stage_index ===
            s.progress.stage.stage_index
          ? []
          : execute_evaluation_tasks(id, updated),
      );
    if (s instanceof EvaluationPassed)
      return decided(new TicketEvaluationPassed(id, terminal), [
        finalize(
          t,
          new FinalizationOperation(
            updated.work_cycle,
            Generation(1),
            updated.input.work_result,
            updated.input.accepted_source,
          ),
        ),
      ]);
    if (s instanceof EvaluationBlocked)
      return decided(new TicketEvaluationBlocked(id, terminal));
    const entries = rework_entries(updated, s.completed_stages);
    return policy(updated) instanceof ReworkEvaluationFailure
      ? decided(new TicketEvaluationReworkStarted(id, terminal, entries), [
          execute_work(
            t,
            next_cycle_number(t),
            updated.input.accepted_source,
            evaluation_rework_input(t.definition, entries),
          ),
        ])
      : decided(new TicketEvaluationFailureEscalated(id, terminal, entries));
  }
  return refuse(new TaskNotCurrent(id, task));
}
function _update_ticket(g: TicketGraph, id: TicketId, t: Ticket): TicketGraph {
  const tickets = new Map(g.tickets);
  tickets.set(id, t);
  return new TicketGraph(tickets);
}
function with_state(t: Ticket, s: TicketState): Ticket {
  return new Ticket(t.definition, t.revision, t.work_cycles_started, s);
}
function _enter_work_cycle(
  g: TicketGraph,
  t: Ticket,
  i: WorkInput,
  s: WorkspaceSource,
): TicketGraph {
  return _update_ticket(
    g,
    t.definition.id,
    new Ticket(
      t.definition,
      t.revision,
      next_cycle_number(t),
      new Work(new WorkExecution(i, s)),
    ),
  );
}
function _finalization_current(
  o: FinalizationOperation,
  c: CycleNumber,
  n: Generation,
): boolean {
  return o.work_cycle === c && o.generation === n;
}
function _evolve(g: TicketGraph, f: TicketEvent): TicketGraph | null {
  if (f instanceof TicketCreated)
    return g.tickets.has(f.definition.id)
      ? null
      : _update_ticket(
          g,
          f.definition.id,
          new Ticket(f.definition, 1, 0, new Pending()),
        );
  const t = g.tickets.get(f.ticket);
  if (!t) return null;
  const s = t.state,
    put = (state: TicketState) =>
      _update_ticket(g, f.ticket, with_state(t, state));
  if (f instanceof TicketUpdated)
    return is_pending(s) && f.revision === t.revision + 1
      ? _update_ticket(
          g,
          f.ticket,
          new Ticket(f.definition, f.revision, t.work_cycles_started, s),
        )
      : null;
  if (f instanceof TicketDispatched)
    return s instanceof Pending
      ? _enter_work_cycle(g, t, initial_work_input(t.definition), f.source)
      : null;
  if (f instanceof TicketRevoked)
    return revocation_allowed(s) ? put(new Revoked()) : null;
  if (f instanceof TicketWorkResumed) {
    if (!(s instanceof Escalated)) return null;
    const e = s.escalation;
    if (
      e instanceof WorkFailureEscalated ||
      e instanceof WorkExecutionUnavailableEscalated
    )
      return _enter_work_cycle(
        g,
        t,
        e.escalation.resume_input,
        e.escalation.source,
      );
    if (e instanceof EvaluationFailureEscalated)
      return _enter_work_cycle(
        g,
        t,
        evaluation_rework_input(t.definition, e.escalation.evidence),
        e.escalation.source,
      );
    return null;
  }
  if (f instanceof TicketEvaluationResumed)
    return s instanceof Escalated &&
      s.escalation instanceof EvaluationBlockedEscalated
      ? put(new Evaluation(resume_blocked(s.escalation.evaluation)))
      : null;
  if (f instanceof TicketFinalizationResumed)
    return s instanceof Escalated &&
      s.escalation instanceof FinalizationUnavailableEscalated
      ? put(
          new Finalization(
            resumed_finalization(s.escalation.escalation.finalization),
          ),
        )
      : null;
  if (f instanceof TicketWorkResultAccepted) {
    if (!(s instanceof Work)) return null;
    const source = publishes_repository_result(
      t.definition.work_configuration,
      s.execution.source.repository,
    )
      ? exact_git_output(f.result)
      : s.execution.source;
    return source
      ? put(
          new Evaluation(
            begin(
              CycleNumber(t.work_cycles_started),
              new EvaluationInput(f.ticket, f.result.manifest, source),
              t.definition.evaluation_plan,
            ),
          ),
        )
      : null;
  }
  if (
    f instanceof TicketWorkProcessFailed ||
    f instanceof TicketWorkExecutionUnavailable
  ) {
    if (!(s instanceof Work)) return null;
    const escalation = new WorkEscalation(
      retry_work_input(s.execution.input, f.evidence),
      s.execution.source,
      f.evidence,
    );
    return put(
      new Escalated(
        f instanceof TicketWorkProcessFailed
          ? new WorkFailureEscalated(escalation)
          : new WorkExecutionUnavailableEscalated(escalation),
      ),
    );
  }
  if (
    f instanceof TicketFinalizationSucceeded ||
    f instanceof TicketFinalizationNeedsWork ||
    f instanceof TicketFinalizationUnavailable
  ) {
    if (
      !(s instanceof Finalization) ||
      !_finalization_current(s.operation, f.work_cycle, f.generation)
    )
      return null;
    if (f instanceof TicketFinalizationSucceeded) return put(new Done());
    if (f instanceof TicketFinalizationNeedsWork)
      return _enter_work_cycle(
        g,
        t,
        finalization_rework_input(t.definition, f.evidence),
        s.operation.source,
      );
    return put(
      new Escalated(
        new FinalizationUnavailableEscalated(
          new FinalizationEscalation(s.operation, f.evidence),
        ),
      ),
    );
  }
  if (
    !(s instanceof Evaluation) ||
    !task_current(s.evaluation, terminal_task(f.terminal))
  )
    return null;
  const updated = apply_terminal(
    s.evaluation,
    terminal_task(f.terminal),
    f.terminal,
  );
  if (f instanceof TicketEvaluationProgressed)
    return updated.state instanceof Running
      ? put(new Evaluation(updated))
      : null;
  if (f instanceof TicketEvaluationPassed)
    return updated.state instanceof EvaluationPassed
      ? put(
          new Finalization(
            new FinalizationOperation(
              updated.work_cycle,
              Generation(1),
              updated.input.work_result,
              updated.input.accepted_source,
            ),
          ),
        )
      : null;
  if (f instanceof TicketEvaluationBlocked)
    return updated.state instanceof EvaluationBlocked
      ? put(new Escalated(new EvaluationBlockedEscalated(updated)))
      : null;
  if (!(updated.state instanceof EvaluationFailed)) return null;
  if (f instanceof TicketEvaluationReworkStarted)
    return _enter_work_cycle(
      g,
      t,
      evaluation_rework_input(t.definition, f.evidence),
      s.evaluation.input.accepted_source,
    );
  return put(
    new Escalated(
      new EvaluationFailureEscalated(
        new EvaluationFailureEscalation(
          f.evidence,
          s.evaluation.input.accepted_source,
        ),
      ),
    ),
  );
}
export function evolve(g: TicketGraph, f: TicketEvent): TicketGraph {
  return _evolve(g, f) ?? g;
}
export function evolve_checked(g: TicketGraph, f: TicketEvent): TicketGraph {
  const result = _evolve(g, f);
  if (!result)
    throw new Error(`no ticket state this event can be applied to: ${repr(f)}`);
  return result;
}
export function apply_decision(g: TicketGraph, d: TicketDecision): TicketGraph {
  return d instanceof TicketRefused ? g : evolve(g, d.event);
}
export function apply_command(
  g: TicketGraph,
  c: TicketCommand,
  p: EvaluationFailurePolicy,
): TicketGraph {
  return apply_decision(g, decide(g, c, p));
}
function _work_input_valid(i: WorkInput): boolean {
  return (
    _released_content_error(i.released.content) === null &&
    i.released.input_bindings > 0 &&
    i.retry_evidence.every((e) => e > 0) &&
    (i.cause instanceof InitialWork ||
      (i.cause instanceof EvaluationRework
        ? i.cause.entries.length > 0 &&
          i.cause.entries.every((e) => e.evaluator > 0 && e.result_manifest > 0)
        : i.cause.evidence > 0))
  );
}
function _work_input_matches_ticket(t: Ticket, i: WorkInput): boolean {
  return (
    _work_input_valid(i) && equal(i.released, released_work_input(t.definition))
  );
}
function _escalation_valid(t: Ticket, e: Escalation): boolean {
  const r = t.definition.work_configuration.execution_requirements.repository;
  if (
    e instanceof WorkFailureEscalated ||
    e instanceof WorkExecutionUnavailableEscalated
  ) {
    const f = e.escalation;
    return (
      _work_input_matches_ticket(t, f.resume_input) &&
      f.source.repository === r &&
      f.source.commit > 0 &&
      f.evidence > 0
    );
  }
  if (e instanceof EvaluationFailureEscalated) {
    const f = e.escalation;
    return (
      _work_input_matches_ticket(
        t,
        evaluation_rework_input(t.definition, f.evidence),
      ) &&
      f.source.repository === r &&
      f.source.commit > 0
    );
  }
  if (e instanceof EvaluationBlockedEscalated) {
    const v = e.evaluation;
    return (
      evaluation_invariant(v) &&
      v.input.ticket === t.definition.id &&
      v.work_cycle === t.work_cycles_started &&
      v.state instanceof EvaluationBlocked
    );
  }
  const f = e.escalation,
    o = f.finalization;
  return (
    o.work_cycle === t.work_cycles_started &&
    o.generation > 0 &&
    o.input > 0 &&
    o.source.repository === r &&
    o.source.commit > 0 &&
    f.evidence > 0
  );
}
function _ticket_invariant(t: Ticket): boolean {
  if (
    _release_error(t.definition) !== null ||
    t.revision < 1 ||
    t.work_cycles_started < 0
  )
    return false;
  const s = t.state,
    r = t.definition.work_configuration.execution_requirements.repository;
  if (s instanceof Pending) return t.work_cycles_started === 0;
  if (s instanceof Work)
    return (
      t.work_cycles_started > 0 &&
      _work_input_matches_ticket(t, s.execution.input) &&
      s.execution.source.repository === r &&
      s.execution.source.commit > 0
    );
  if (s instanceof Evaluation) {
    const e = s.evaluation;
    return (
      evaluation_invariant(e) &&
      e.input.ticket === t.definition.id &&
      e.work_cycle === t.work_cycles_started &&
      e.input.accepted_source.repository === r
    );
  }
  if (s instanceof Finalization) {
    const o = s.operation;
    return (
      o.work_cycle === t.work_cycles_started &&
      o.generation > 0 &&
      o.input > 0 &&
      o.source.repository === r &&
      o.source.commit > 0
    );
  }
  if (s instanceof Escalated) return _escalation_valid(t, s.escalation);
  return true;
}
function _dependency_closure(
  g: TicketGraph,
  id: TicketId,
): ReadonlySet<TicketId> {
  const reached = new Set(g.tickets.get(id)?.definition.dependencies ?? []);
  for (const key of reached)
    for (const d of g.tickets.get(key)?.definition.dependencies ?? [])
      reached.add(d);
  return reached;
}
export function graph_invariant(g: TicketGraph): boolean {
  return [...g.tickets].every(
    ([id, t]) =>
      t.definition.id === id &&
      _ticket_invariant(t) &&
      !t.definition.dependencies.has(id) &&
      [...t.definition.dependencies].every((d) => g.tickets.has(d)) &&
      !_dependency_closure(g, id).has(id),
  );
}
function _obligation_valid(o: Obligation): boolean {
  if (o instanceof ExecuteTask) return o.ticket === task_owner(o.task.task);
  if (o instanceof CancelTask) return o.ticket === task_owner(o.task);
  const f = o.finalization;
  return (
    o.ticket > 0 &&
    f.work_cycle > 0 &&
    f.generation > 0 &&
    o.configuration > 0 &&
    f.input > 0 &&
    f.source.repository > 0 &&
    f.source.commit > 0
  );
}
function _obligation_agrees(
  prior: TicketGraph,
  evolved: TicketGraph,
  o: Obligation,
): boolean {
  if (o instanceof ExecuteTask)
    return list_has_task(ticket_live_tasks(evolved, o.ticket), o.task.task);
  if (o instanceof CancelTask)
    return (
      list_has_task(ticket_live_tasks(prior, o.ticket), o.task) &&
      !list_has_task(ticket_live_tasks(evolved, o.ticket), o.task)
    );
  const s = evolved.tickets.get(o.ticket)?.state;
  return s instanceof Finalization && equal(s.operation, o.finalization);
}
export function decision_valid(g: TicketGraph, d: TicketDecision): boolean {
  if (d instanceof TicketRefused) return equal(apply_decision(g, d), g);
  const evolved = evolve(g, d.event);
  return (
    d.obligations.every(
      (o, i) =>
        _obligation_valid(o) &&
        _obligation_agrees(g, evolved, o) &&
        d.obligations.every((p, j) => i === j || !equal(o, p)),
    ) && graph_invariant(evolved)
  );
}
