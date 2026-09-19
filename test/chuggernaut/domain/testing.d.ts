import * as t from "../../../src/domain/chuggernaut/task.js";
import * as e from "../../../src/domain/chuggernaut/evaluation.js";
import * as k from "../../../src/domain/chuggernaut/ticket.js";
export declare const source: (commit: number) => t.ContentRef;
export declare const WORK: t.TaskDefinition;
export declare const EVALUATOR: t.TaskDefinition;
export declare const PLAN: e.EvaluationPlan;
export declare function released(
  id: number,
  deps?: ReadonlySet<t.TicketId>,
  revised?: boolean,
): k.ReleasedTicket;
export declare const dispatch: (id: number) => k.DispatchTicket;
export declare function terminal_command(
  id: t.TicketId,
  terminal: t.TaskTerminal,
): k.TicketCommand;
export declare function finalization_command(
  g: k.TicketGraph,
  id: number,
  result: k.FinalizationResult,
): k.TicketCommand;
export declare function work_obligation(
  g: k.TicketGraph,
  id: number,
): t.TaskObligation;
export declare function evaluator_obligation(
  g: k.TicketGraph,
  id: number,
): t.TaskObligation;
export declare function work_result_command(
  g: k.TicketGraph,
  id: number,
  manifest: number,
): k.TicketCommand;
export declare function evaluator_result_command(
  g: k.TicketGraph,
  id: number,
  manifest: number,
  verdict: e.EvaluationVerdict,
): k.TicketCommand;
export declare function failure_command(
  g: k.TicketGraph,
  id: number,
  evidence: number,
  work: boolean,
  unavailable: boolean,
): k.TicketCommand;
export declare class Driver {
  graph: k.TicketGraph;
  prior_graph: k.TicketGraph;
  last_decision: k.TicketDecision;
  submit(c: k.TicketCommand, p?: k.EvaluationFailurePolicy): k.TicketDecision;
}
