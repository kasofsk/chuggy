import * as t from "../../../src/domain/chuggernaut/task.js";
import * as k from "../../../src/domain/chuggernaut/ticket.js";
import * as b from "../domain/builders.js";
import { NO_DECISION } from "./itf.js";
import { ConversionError, decision_from_itf } from "./convert.js";
export {
  ConversionError,
  decision_from_itf,
  graph_from_itf,
} from "./convert.js";
export class Reconstructed {
  command;
  policy;
  origin;
  constructor(command, policy, origin) {
    this.command = command;
    this.policy = policy;
    this.origin = origin;
  }
}
export class EvolveOnly {
  reason;
  constructor(reason) {
    this.reason = reason;
  }
}
function simulation(action, prior) {
  switch (action) {
    case "createOne":
      return new k.CreateTicket(b.released(1));
    case "createTwo":
      return new k.CreateTicket(b.released(2, new Set([t.TicketId(1)])));
    case "updateOne":
      return new k.UpdateTicket(
        t.TicketId(1),
        prior.tickets.get(t.TicketId(1))?.revision ?? 1,
        b.released(1, new Set(), true),
      );
    case "dispatchOne":
      return b.dispatch(1);
    case "dispatchTwo":
      return b.dispatch(2);
    case "revokeOne":
      return new k.RevokeTicket(t.TicketId(1));
    case "resumeOne":
      return new k.ResumeTicket(t.TicketId(1));
    case "passWorkOne":
      return b.work_result_command(prior, 1, 501);
    case "failWorkOne":
      return b.failure_command(prior, 1, 508, true, false);
    case "unavailableWorkOne":
      return b.failure_command(prior, 1, 509, true, true);
    case "passEvaluatorOne":
      return b.evaluator_result_command(prior, 1, 502, 1);
    case "failEvaluatorOne":
      return b.evaluator_result_command(prior, 1, 503, -1);
    case "unavailableEvaluatorOne":
      return b.failure_command(prior, 1, 504, false, true);
    case "completeFinalizationOne":
      return b.finalization_command(
        prior,
        1,
        new k.FinalizationSucceeded(t.ContentRef(505)),
      );
    case "reworkFinalizationOne":
      return b.finalization_command(
        prior,
        1,
        new k.FinalizationNeedsWork(t.ContentRef(506)),
      );
    case "unavailableFinalizationOne":
      return b.finalization_command(
        prior,
        1,
        new k.FinalizationResultUnavailable(t.ContentRef(507)),
      );
    default:
      throw new ConversionError(`unknown step alternative ${action}`);
  }
}
function event_command(e) {
  let command;
  let policy = k.rework_policy;
  switch (e.kind) {
    case "TicketCreated":
      command = new k.CreateTicket(e.definition);
      break;
    case "TicketUpdated":
      command = new k.UpdateTicket(e.ticket, e.revision - 1, e.definition);
      break;
    case "TicketDispatched":
      command = new k.DispatchTicket(e.ticket, e.source);
      break;
    case "TicketRevoked":
      command = new k.RevokeTicket(e.ticket);
      break;
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      command = new k.ResumeTicket(e.ticket);
      break;
    case "TicketWorkResultAccepted":
      command = b.terminal_command(
        e.ticket,
        new t.TaskResultProduced(e.result),
      );
      break;
    case "TicketWorkProcessFailed":
      command = b.terminal_command(
        e.ticket,
        new t.TaskProcessFailed(new t.TaskFailure(e.task, e.evidence)),
      );
      break;
    case "TicketWorkExecutionUnavailable":
      command = b.terminal_command(
        e.ticket,
        new t.TaskExecutionUnavailable(new t.TaskFailure(e.task, e.evidence)),
      );
      break;
    case "TicketEvaluationFailureEscalated":
      policy = () => new k.EscalateEvaluationFailure();
      command = b.terminal_command(e.ticket, e.terminal);
      break;
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationBlocked":
    case "TicketEvaluationReworkStarted":
      command = b.terminal_command(e.ticket, e.terminal);
      break;
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      command = new k.ReportFinalizationResult(
        new k.FinalizationResultReport(
          e.ticket,
          e.work_cycle,
          e.generation,
          e instanceof k.TicketFinalizationSucceeded
            ? new k.FinalizationSucceeded(e.evidence)
            : e instanceof k.TicketFinalizationNeedsWork
              ? new k.FinalizationNeedsWork(e.evidence)
              : new k.FinalizationResultUnavailable(e.evidence),
        ),
      );
      break;
  }
  return new Reconstructed(command, policy, "event");
}
export function command_from_step(step, prior) {
  if (step.action !== null) {
    if (step.nondet_picks && Object.keys(step.nondet_picks).length)
      throw new ConversionError("model step makes no nondeterministic pick");
    return new Reconstructed(
      simulation(step.action, prior),
      k.rework_policy,
      "action",
    );
  }
  if (t.equal(step.decision, NO_DECISION))
    return new EvolveOnly(
      "the init sentinel: the scenario asserted inside check(...)",
    );
  const d = decision_from_itf(step.decision);
  return d instanceof k.TicketRefused
    ? new EvolveOnly(`a refusal names no command: ${d.reason.kind}`)
    : event_command(d.event);
}
