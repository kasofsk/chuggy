import {
  EvaluationBlocked,
  EvaluationFailed,
  EvaluationInput,
  EvaluationPassed,
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
  CycleNumber,
  Generation,
  TaskObligation,
  TaskProcessFailed,
  TaskResultProduced,
  WorkTaskId,
  exact_git_output,
  publishes_repository_result,
  task_owner,
  terminal_task,
} from "./task.js";
export class AuthoredContent {
  title;
  instructions;
  kind = "AuthoredContent";
  constructor(title, instructions) {
    this.title = title;
    this.instructions = instructions;
    Object.freeze(this);
  }
}
export class LegacyContent {
  content;
  kind = "LegacyContent";
  constructor(content) {
    this.content = content;
    Object.freeze(this);
  }
}
export class ReleasedWorkInput {
  content;
  input_bindings;
  kind = "ReleasedWorkInput";
  constructor(content, input_bindings) {
    this.content = content;
    this.input_bindings = input_bindings;
    Object.freeze(this);
  }
}
export class InitialWork {
  kind = "InitialWork";
  constructor() {
    Object.freeze(this);
  }
}
export class EvaluationRework {
  entries;
  kind = "EvaluationRework";
  constructor(entries) {
    this.entries = entries;
    this.entries = Object.freeze([...entries]);
    Object.freeze(this);
  }
}
export class FinalizationRework {
  evidence;
  kind = "FinalizationRework";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class WorkInput {
  released;
  cause;
  retry_evidence;
  kind = "WorkInput";
  constructor(released, cause, retry_evidence) {
    this.released = released;
    this.cause = cause;
    this.retry_evidence = retry_evidence;
    this.retry_evidence = Object.freeze([...retry_evidence]);
    Object.freeze(this);
  }
}
export class WorkExecution {
  input;
  source;
  kind = "WorkExecution";
  constructor(input, source) {
    this.input = input;
    this.source = source;
    Object.freeze(this);
  }
}
export class FinalizationOperation {
  work_cycle;
  generation;
  input;
  source;
  kind = "FinalizationOperation";
  constructor(work_cycle, generation, input, source) {
    this.work_cycle = work_cycle;
    this.generation = generation;
    this.input = input;
    this.source = source;
    Object.freeze(this);
  }
}
export class ReworkEvaluationFailure {
  kind = "ReworkEvaluationFailure";
  constructor() {
    Object.freeze(this);
  }
}
export class EscalateEvaluationFailure {
  kind = "EscalateEvaluationFailure";
  constructor() {
    Object.freeze(this);
  }
}
export class WorkEscalation {
  resume_input;
  source;
  evidence;
  kind = "WorkEscalation";
  constructor(resume_input, source, evidence) {
    this.resume_input = resume_input;
    this.source = source;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class EvaluationFailureEscalation {
  evidence;
  source;
  kind = "EvaluationFailureEscalation";
  constructor(evidence, source) {
    this.evidence = evidence;
    this.source = source;
    this.evidence = Object.freeze([...evidence]);
    Object.freeze(this);
  }
}
export class FinalizationEscalation {
  finalization;
  evidence;
  kind = "FinalizationEscalation";
  constructor(finalization, evidence) {
    this.finalization = finalization;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class WorkFailureEscalated {
  escalation;
  kind = "WorkFailureEscalated";
  constructor(escalation) {
    this.escalation = escalation;
    Object.freeze(this);
  }
}
export class WorkExecutionUnavailableEscalated {
  escalation;
  kind = "WorkExecutionUnavailableEscalated";
  constructor(escalation) {
    this.escalation = escalation;
    Object.freeze(this);
  }
}
export class EvaluationFailureEscalated {
  escalation;
  kind = "EvaluationFailureEscalated";
  constructor(escalation) {
    this.escalation = escalation;
    Object.freeze(this);
  }
}
export class EvaluationBlockedEscalated {
  evaluation;
  kind = "EvaluationBlockedEscalated";
  constructor(evaluation) {
    this.evaluation = evaluation;
    Object.freeze(this);
  }
}
export class FinalizationUnavailableEscalated {
  escalation;
  kind = "FinalizationUnavailableEscalated";
  constructor(escalation) {
    this.escalation = escalation;
    Object.freeze(this);
  }
}
export class ReleasedTicket {
  id;
  content;
  input_bindings;
  dependencies;
  work_configuration;
  evaluation_plan;
  finalization_configuration;
  kind = "ReleasedTicket";
  constructor(
    id,
    content,
    input_bindings,
    dependencies,
    work_configuration,
    evaluation_plan,
    finalization_configuration,
  ) {
    this.id = id;
    this.content = content;
    this.input_bindings = input_bindings;
    this.dependencies = dependencies;
    this.work_configuration = work_configuration;
    this.evaluation_plan = evaluation_plan;
    this.finalization_configuration = finalization_configuration;
    Object.freeze(this);
  }
}
export class Pending {
  kind = "Pending";
  constructor() {
    Object.freeze(this);
  }
}
export class Work {
  execution;
  kind = "Work";
  constructor(execution) {
    this.execution = execution;
    Object.freeze(this);
  }
}
export class Evaluation {
  evaluation;
  kind = "Evaluation";
  constructor(evaluation) {
    this.evaluation = evaluation;
    Object.freeze(this);
  }
}
export class Finalization {
  operation;
  kind = "Finalization";
  constructor(operation) {
    this.operation = operation;
    Object.freeze(this);
  }
}
export class Escalated {
  escalation;
  kind = "Escalated";
  constructor(escalation) {
    this.escalation = escalation;
    Object.freeze(this);
  }
}
export class Done {
  kind = "Done";
  constructor() {
    Object.freeze(this);
  }
}
export class Revoked {
  kind = "Revoked";
  constructor() {
    Object.freeze(this);
  }
}
export class Ticket {
  definition;
  revision;
  work_cycles_started;
  state;
  kind = "Ticket";
  constructor(definition, revision, work_cycles_started, state) {
    this.definition = definition;
    this.revision = revision;
    this.work_cycles_started = work_cycles_started;
    this.state = state;
    Object.freeze(this);
  }
}
export class TicketGraph {
  tickets;
  kind = "TicketGraph";
  constructor(tickets) {
    this.tickets = tickets;
    validate_TicketGraph(this);
    Object.freeze(this);
  }
}
export class TaskTerminalReport {
  ticket;
  terminal;
  kind = "TaskTerminalReport";
  constructor(ticket, terminal) {
    this.ticket = ticket;
    this.terminal = terminal;
    Object.freeze(this);
  }
}
export class FinalizationSucceeded {
  evidence;
  kind = "FinalizationSucceeded";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class FinalizationNeedsWork {
  evidence;
  kind = "FinalizationNeedsWork";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class FinalizationResultUnavailable {
  evidence;
  kind = "FinalizationResultUnavailable";
  constructor(evidence) {
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class FinalizationResultReport {
  ticket;
  work_cycle;
  generation;
  result;
  kind = "FinalizationResultReport";
  constructor(ticket, work_cycle, generation, result) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.generation = generation;
    this.result = result;
    Object.freeze(this);
  }
}
export class CreateTicket {
  definition;
  kind = "CreateTicket";
  constructor(definition) {
    this.definition = definition;
    Object.freeze(this);
  }
}
export class UpdateTicket {
  ticket;
  expected_revision;
  definition;
  kind = "UpdateTicket";
  constructor(ticket, expected_revision, definition) {
    this.ticket = ticket;
    this.expected_revision = expected_revision;
    this.definition = definition;
    Object.freeze(this);
  }
}
export class DispatchTicket {
  ticket;
  source;
  kind = "DispatchTicket";
  constructor(ticket, source) {
    this.ticket = ticket;
    this.source = source;
    Object.freeze(this);
  }
}
export class RevokeTicket {
  ticket;
  kind = "RevokeTicket";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class ResumeTicket {
  ticket;
  kind = "ResumeTicket";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class ReportTaskTerminal {
  report;
  kind = "ReportTaskTerminal";
  constructor(report) {
    this.report = report;
    Object.freeze(this);
  }
}
export class ReportFinalizationResult {
  report;
  kind = "ReportFinalizationResult";
  constructor(report) {
    this.report = report;
    Object.freeze(this);
  }
}
export class TicketAlreadyExists {
  ticket;
  kind = "TicketAlreadyExists";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class DependenciesNotFound {
  ticket;
  dependencies;
  kind = "DependenciesNotFound";
  constructor(ticket, dependencies) {
    this.ticket = ticket;
    this.dependencies = dependencies;
    Object.freeze(this);
  }
}
export class SelfDependency {
  ticket;
  kind = "SelfDependency";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketNotFound {
  ticket;
  kind = "TicketNotFound";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketNotPending {
  ticket;
  kind = "TicketNotPending";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketIdentityMismatch {
  ticket;
  kind = "TicketIdentityMismatch";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketRevisionStale {
  ticket;
  expected;
  current;
  kind = "TicketRevisionStale";
  constructor(ticket, expected, current) {
    this.ticket = ticket;
    this.expected = expected;
    this.current = current;
    Object.freeze(this);
  }
}
export class TicketDependenciesChanged {
  ticket;
  kind = "TicketDependenciesChanged";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class DispatchSourceRepositoryMismatch {
  ticket;
  kind = "DispatchSourceRepositoryMismatch";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class DependenciesIncomplete {
  ticket;
  dependencies;
  kind = "DependenciesIncomplete";
  constructor(ticket, dependencies) {
    this.ticket = ticket;
    this.dependencies = dependencies;
    Object.freeze(this);
  }
}
export class TicketNotRevocable {
  ticket;
  kind = "TicketNotRevocable";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketNotResumable {
  ticket;
  kind = "TicketNotResumable";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TaskNotCurrent {
  ticket;
  task;
  kind = "TaskNotCurrent";
  constructor(ticket, task) {
    this.ticket = ticket;
    this.task = task;
    Object.freeze(this);
  }
}
export class WorkResultMissingExactGitOutput {
  ticket;
  kind = "WorkResultMissingExactGitOutput";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class FinalizationNotCurrent {
  ticket;
  work_cycle;
  generation;
  kind = "FinalizationNotCurrent";
  constructor(ticket, work_cycle, generation) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.generation = generation;
    Object.freeze(this);
  }
}
export class TicketCreated {
  definition;
  kind = "TicketCreated";
  constructor(definition) {
    this.definition = definition;
    Object.freeze(this);
  }
}
export class TicketUpdated {
  ticket;
  revision;
  definition;
  kind = "TicketUpdated";
  constructor(ticket, revision, definition) {
    this.ticket = ticket;
    this.revision = revision;
    this.definition = definition;
    Object.freeze(this);
  }
}
export class TicketDispatched {
  ticket;
  source;
  kind = "TicketDispatched";
  constructor(ticket, source) {
    this.ticket = ticket;
    this.source = source;
    Object.freeze(this);
  }
}
export class TicketRevoked {
  ticket;
  kind = "TicketRevoked";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketWorkResumed {
  ticket;
  kind = "TicketWorkResumed";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketEvaluationResumed {
  ticket;
  kind = "TicketEvaluationResumed";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketFinalizationResumed {
  ticket;
  kind = "TicketFinalizationResumed";
  constructor(ticket) {
    this.ticket = ticket;
    Object.freeze(this);
  }
}
export class TicketWorkResultAccepted {
  ticket;
  result;
  kind = "TicketWorkResultAccepted";
  constructor(ticket, result) {
    this.ticket = ticket;
    this.result = result;
    Object.freeze(this);
  }
}
export class TicketWorkProcessFailed {
  ticket;
  task;
  evidence;
  kind = "TicketWorkProcessFailed";
  constructor(ticket, task, evidence) {
    this.ticket = ticket;
    this.task = task;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class TicketWorkExecutionUnavailable {
  ticket;
  task;
  evidence;
  kind = "TicketWorkExecutionUnavailable";
  constructor(ticket, task, evidence) {
    this.ticket = ticket;
    this.task = task;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class TicketEvaluationProgressed {
  ticket;
  terminal;
  kind = "TicketEvaluationProgressed";
  constructor(ticket, terminal) {
    this.ticket = ticket;
    this.terminal = terminal;
    Object.freeze(this);
  }
}
export class TicketEvaluationPassed {
  ticket;
  terminal;
  kind = "TicketEvaluationPassed";
  constructor(ticket, terminal) {
    this.ticket = ticket;
    this.terminal = terminal;
    Object.freeze(this);
  }
}
export class TicketEvaluationReworkStarted {
  ticket;
  terminal;
  evidence;
  kind = "TicketEvaluationReworkStarted";
  constructor(ticket, terminal, evidence) {
    this.ticket = ticket;
    this.terminal = terminal;
    this.evidence = evidence;
    this.evidence = Object.freeze([...evidence]);
    Object.freeze(this);
  }
}
export class TicketEvaluationFailureEscalated {
  ticket;
  terminal;
  evidence;
  kind = "TicketEvaluationFailureEscalated";
  constructor(ticket, terminal, evidence) {
    this.ticket = ticket;
    this.terminal = terminal;
    this.evidence = evidence;
    this.evidence = Object.freeze([...evidence]);
    Object.freeze(this);
  }
}
export class TicketEvaluationBlocked {
  ticket;
  terminal;
  kind = "TicketEvaluationBlocked";
  constructor(ticket, terminal) {
    this.ticket = ticket;
    this.terminal = terminal;
    Object.freeze(this);
  }
}
export class TicketFinalizationSucceeded {
  ticket;
  work_cycle;
  generation;
  evidence;
  kind = "TicketFinalizationSucceeded";
  constructor(ticket, work_cycle, generation, evidence) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.generation = generation;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class TicketFinalizationNeedsWork {
  ticket;
  work_cycle;
  generation;
  evidence;
  kind = "TicketFinalizationNeedsWork";
  constructor(ticket, work_cycle, generation, evidence) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.generation = generation;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class TicketFinalizationUnavailable {
  ticket;
  work_cycle;
  generation;
  evidence;
  kind = "TicketFinalizationUnavailable";
  constructor(ticket, work_cycle, generation, evidence) {
    this.ticket = ticket;
    this.work_cycle = work_cycle;
    this.generation = generation;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
export class ExecuteTask {
  ticket;
  task;
  kind = "ExecuteTask";
  constructor(ticket, task) {
    this.ticket = ticket;
    this.task = task;
    Object.freeze(this);
  }
}
export class FinalizeTicket {
  ticket;
  finalization;
  configuration;
  kind = "FinalizeTicket";
  constructor(ticket, finalization, configuration) {
    this.ticket = ticket;
    this.finalization = finalization;
    this.configuration = configuration;
    Object.freeze(this);
  }
}
export class CancelTask {
  ticket;
  task;
  kind = "CancelTask";
  constructor(ticket, task) {
    this.ticket = ticket;
    this.task = task;
    Object.freeze(this);
  }
}
export class TicketRefused {
  reason;
  kind = "TicketRefused";
  constructor(reason) {
    this.reason = reason;
    Object.freeze(this);
  }
}
export class TicketDecided {
  event;
  obligations;
  kind = "TicketDecided";
  constructor(event, obligations) {
    this.event = event;
    this.obligations = obligations;
    this.obligations = Object.freeze([...obligations]);
    Object.freeze(this);
  }
}
import { equal, repr } from "./task.js";
function validate_TicketGraph(v) {
  Object.defineProperty(v, "tickets", {
    value: new Map(v.tickets),
    enumerable: true,
  });
}
export function rework_policy(_evaluation) {
  return new ReworkEvaluationFailure();
}
export function is_terminal(s) {
  return s instanceof Done || s instanceof Revoked;
}
export function is_pending(s) {
  return s instanceof Pending;
}
export function is_escalated(s) {
  return s instanceof Escalated;
}
function _released_content_error(c) {
  if (c instanceof AuthoredContent) {
    if (c.title <= 0) return `released title must be present: ${c.title}`;
    if (c.instructions <= 0)
      return `released instructions must be present: ${c.instructions}`;
  } else if (c.content <= 0)
    return `legacy released content must be present: ${c.content}`;
  return null;
}
function _release_error(d) {
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
export function validate_release(d) {
  const error = _release_error(d);
  if (error) throw new Error(error);
}
export function validate_command(c) {
  const pos = (v, label) => {
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
export function work_task_identity(ticket, cycle) {
  return new WorkTaskId(ticket, cycle);
}
export function released_work_input(d) {
  return new ReleasedWorkInput(d.content, d.input_bindings);
}
export function initial_work_input(d) {
  return new WorkInput(released_work_input(d), new InitialWork(), []);
}
export function retry_work_input(i, e) {
  return new WorkInput(i.released, i.cause, [...i.retry_evidence, e]);
}
export function next_cycle_number(t) {
  return CycleNumber(t.work_cycles_started + 1);
}
export function evaluation_rework_input(d, entries) {
  return new WorkInput(
    released_work_input(d),
    new EvaluationRework(entries),
    [],
  );
}
export function finalization_rework_input(d, e) {
  return new WorkInput(released_work_input(d), new FinalizationRework(e), []);
}
export function work_context(i) {
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
export function work_task_obligation(t, n, s, i) {
  return new TaskObligation(
    work_task_identity(t.definition.id, n),
    t.definition.work_configuration,
    s,
    work_context(i),
  );
}
export function execute_work(t, n, s, i) {
  return new ExecuteTask(t.definition.id, work_task_obligation(t, n, s, i));
}
export function resumed_finalization(o) {
  return new FinalizationOperation(
    o.work_cycle,
    Generation(o.generation + 1),
    o.input,
    o.source,
  );
}
export function execute_evaluation_tasks(id, e) {
  return current_task_obligations(e).map((t) => new ExecuteTask(id, t));
}
export function finalize(t, o) {
  return new FinalizeTicket(
    t.definition.id,
    o,
    t.definition.finalization_configuration,
  );
}
export function dependency_complete(g, id) {
  return g.tickets.get(id)?.state instanceof Done;
}
export function incomplete_dependencies(g, t) {
  return new Set(
    [...t.definition.dependencies].filter((id) => !dependency_complete(g, id)),
  );
}
export function dependencies_complete(g, t) {
  return incomplete_dependencies(g, t).size === 0;
}
export function is_ready(g, id) {
  const t = g.tickets.get(id);
  return t !== undefined && is_pending(t.state) && dependencies_complete(g, t);
}
export function revocation_allowed(s) {
  return !(
    s instanceof Finalization ||
    s instanceof Done ||
    s instanceof Revoked
  );
}
export function live_task_list(t) {
  return t.state instanceof Work
    ? [work_task_identity(t.definition.id, CycleNumber(t.work_cycles_started))]
    : t.state instanceof Evaluation
      ? current_task_obligations(t.state.evaluation).map((o) => o.task)
      : [];
}
export function list_has_task(ts, t) {
  return ts.some((c) => equal(c, t));
}
export function cancel_live_tasks(t) {
  return live_task_list(t).map((task) => new CancelTask(t.definition.id, task));
}
export function ticket_live_tasks(g, id) {
  const t = g.tickets.get(id);
  return t ? live_task_list(t) : [];
}
function refuse(r) {
  return new TicketRefused(r);
}
function decided(e, obligations = []) {
  return new TicketDecided(e, obligations);
}
export function decide(g, c, policy) {
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
function _update_ticket(g, id, t) {
  const tickets = new Map(g.tickets);
  tickets.set(id, t);
  return new TicketGraph(tickets);
}
function with_state(t, s) {
  return new Ticket(t.definition, t.revision, t.work_cycles_started, s);
}
function _enter_work_cycle(g, t, i, s) {
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
function _finalization_current(o, c, n) {
  return o.work_cycle === c && o.generation === n;
}
function _evolve(g, f) {
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
    put = (state) => _update_ticket(g, f.ticket, with_state(t, state));
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
export function evolve(g, f) {
  return _evolve(g, f) ?? g;
}
export function evolve_checked(g, f) {
  const result = _evolve(g, f);
  if (!result)
    throw new Error(`no ticket state this event can be applied to: ${repr(f)}`);
  return result;
}
export function apply_decision(g, d) {
  return d instanceof TicketRefused ? g : evolve(g, d.event);
}
export function apply_command(g, c, p) {
  return apply_decision(g, decide(g, c, p));
}
function _work_input_valid(i) {
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
function _work_input_matches_ticket(t, i) {
  return (
    _work_input_valid(i) && equal(i.released, released_work_input(t.definition))
  );
}
function _escalation_valid(t, e) {
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
function _ticket_invariant(t) {
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
function _dependency_closure(g, id) {
  const reached = new Set(g.tickets.get(id)?.definition.dependencies ?? []);
  for (const key of reached)
    for (const d of g.tickets.get(key)?.definition.dependencies ?? [])
      reached.add(d);
  return reached;
}
export function graph_invariant(g) {
  return [...g.tickets].every(
    ([id, t]) =>
      t.definition.id === id &&
      _ticket_invariant(t) &&
      !t.definition.dependencies.has(id) &&
      [...t.definition.dependencies].every((d) => g.tickets.has(d)) &&
      !_dependency_closure(g, id).has(id),
  );
}
function _obligation_valid(o) {
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
function _obligation_agrees(prior, evolved, o) {
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
export function decision_valid(g, d) {
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
