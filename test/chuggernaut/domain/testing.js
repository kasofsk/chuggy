import * as t from "../../../src/domain/chuggernaut/task.js";
import * as e from "../../../src/domain/chuggernaut/evaluation.js";
import * as k from "../../../src/domain/chuggernaut/ticket.js";
export const source = (commit) => t.ContentRef(commit);
export const WORK = new t.TaskDefinition(
  t.ContentRef(1),
  t.ContentRef(1),
  new t.ExecutionRequirements(),
  t.ContentRef(1),
);
export const EVALUATOR = new t.TaskDefinition(
  t.ContentRef(2),
  t.ContentRef(2),
  new t.ExecutionRequirements(),
  t.ContentRef(2),
);
export const PLAN = new e.EvaluationPlan([
  new e.StageDefinition(t.StageKey(10), [
    new e.EvaluatorDefinition(t.EvaluatorKey(11), EVALUATOR),
    new e.EvaluatorDefinition(t.EvaluatorKey(12), EVALUATOR),
  ]),
  new e.StageDefinition(t.StageKey(20), [
    new e.EvaluatorDefinition(t.EvaluatorKey(21), EVALUATOR),
  ]),
]);
export function released(id, deps = new Set(), revised = false) {
  return new k.ReleasedTicket(
    t.TicketId(id),
    t.ContentRef(id * 100 + (revised ? 51 : 1)),
    t.ContentRef(id * 100 + 3),
    deps,
    WORK,
    PLAN,
    t.ContentRef(1),
  );
}
export const dispatch = (id) =>
  new k.DispatchTicket(t.TicketId(id), source(id * 1000 + 1));
export function terminal_command(id, terminal) {
  if (terminal instanceof t.TaskResultProduced) {
    const task = terminal.result.obligation.task;
    if (!(task instanceof t.WorkTaskId))
      throw new Error("evaluator result requires an explicit verdict");
    return new k.ReportTaskTerminal(
      new k.WorkResultReport(
        id,
        terminal.result,
        source(terminal.result.result_ref),
      ),
    );
  }
  return new k.ReportTaskTerminal(
    new k.TerminalFailureReport(
      id,
      terminal.failure,
      terminal instanceof t.TaskProcessFailed
        ? new k.ProcessFailure()
        : new k.ExecutionUnavailableFailure(),
    ),
  );
}
export function finalization_command(g, id, result) {
  const s = g.tickets.get(t.TicketId(id))?.state;
  if (!(s instanceof k.Finalization))
    throw new Error("finalization not applicable");
  return new k.ReportFinalizationResult(
    new k.FinalizationResultReport(
      t.TicketId(id),
      s.operation.work_cycle,
      s.operation.generation,
      result,
    ),
  );
}
export function work_obligation(g, id) {
  const held = g.tickets.get(t.TicketId(id));
  if (!held || !(held.state instanceof k.Work))
    throw new Error("work not applicable");
  return k.work_task_obligation(
    held,
    t.CycleNumber(held.work_cycles_started),
    held.state.execution.source,
    held.state.execution.input,
  );
}
export function evaluator_obligation(g, id) {
  const s = g.tickets.get(t.TicketId(id))?.state;
  if (!(s instanceof k.Evaluation))
    throw new Error("evaluation not applicable");
  const o = e.current_task_obligations(s.evaluation)[0];
  if (!o) throw new Error("no current evaluator");
  return o;
}
export function work_result_command(g, id, manifest) {
  return terminal_command(
    t.TicketId(id),
    new t.TaskResultProduced(
      new t.ValidatedTaskResult(work_obligation(g, id), t.ContentRef(manifest)),
    ),
  );
}
export function evaluator_result_command(g, id, manifest, verdict) {
  return new k.ReportTaskTerminal(
    new k.EvaluationResultReport(
      t.TicketId(id),
      new t.ValidatedTaskResult(
        evaluator_obligation(g, id),
        t.ContentRef(manifest),
      ),
      verdict,
    ),
  );
}
export function failure_command(g, id, evidence, work, unavailable) {
  const f = new t.TaskFailure(
    (work ? work_obligation(g, id) : evaluator_obligation(g, id)).task,
    t.ContentRef(evidence),
  );
  return terminal_command(
    t.TicketId(id),
    unavailable
      ? new t.TaskExecutionUnavailable(f)
      : new t.TaskProcessFailed(f),
  );
}
export class Driver {
  graph = new k.TicketGraph(new Map());
  prior_graph = this.graph;
  last_decision = new k.TicketRefused(new k.TicketNotFound(t.TicketId(0)));
  submit(c, p = k.rework_policy) {
    k.validate_command(c);
    this.prior_graph = this.graph;
    this.last_decision = k.decide(this.graph, c, p);
    this.graph = k.apply_decision(this.graph, this.last_decision);
    return this.last_decision;
  }
}
