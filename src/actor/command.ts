/**
 * The ticket commands: what the actor is asked to decide, spelled once.
 *
 * A COMMAND IS THE DECIDER'S INPUT, NOT THE JOURNAL'S ROW. It names a choice
 * already made at the writer's serialization point — which ticket the selector
 * proposed, what a task came back with — and `decide` (`src/domain/deciders.ts`)
 * either turns it into the `TicketEvent` the journal keeps or refuses it by
 * name. Replay folds `evolve` over events and never consults a decider, a
 * policy or a refusal.
 */

import type {
  FinalizationResult,
  ReleasedTicket,
  TaskTerminalReport,
  TicketCommand,
} from "../domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";

export { ticketCommandTags } from "../domain/generated/modelTypes.ts";
export type { TicketCommand };

/**
 * A release freezes the whole definition onto the ticket, and the ticket it
 * names is the `id` inside it: the payload and the graph's key cannot
 * disagree, so the command carries no second ticket field.
 */
export function createTicketCommand(definition: ReleasedTicket): TicketCommand {
  return { type: "CreateTicket", value: definition };
}

export function revokeTicketCommand(ticket: TicketId): TicketCommand {
  return { type: "RevokeTicket", value: ticket };
}

/**
 * The dispatch carries the source it observed: the one edge that looks at what
 * the ticket's repository is at, so the observation is the actor's pick.
 */
export function dispatchTicketCommand(
  ticket: TicketId,
  source: number,
): TicketCommand {
  return { type: "DispatchTicket", value: { ticket, source } };
}

/** What a task came back with; the failure policy is the decide step's own argument. */
export function reportTaskTerminalCommand(
  report: TaskTerminalReport,
): TicketCommand {
  return { type: "ReportTaskTerminal", value: report };
}

/** The finalizer's result, for the attempt (`workCycle`, `generation`) it ran. */
export function reportFinalizationResultCommand(
  ticket: TicketId,
  workCycle: number,
  generation: number,
  result: FinalizationResult,
): TicketCommand {
  return {
    type: "ReportFinalizationResult",
    value: { ticket, workCycle, generation, result },
  };
}

export function resumeTicketCommand(ticket: TicketId): TicketCommand {
  return { type: "ResumeTicket", value: ticket };
}

/** The ticket a command is about, which every reader needs and no arm hides. */
export function commandSubject(command: TicketCommand): TicketId {
  switch (command.type) {
    case "CreateTicket":
      return asTicketId(command.value.id);
    case "DispatchTicket":
    case "ReportFinalizationResult":
      return asTicketId(command.value.ticket);
    case "ReportTaskTerminal":
      return asTicketId(command.value.value.ticket);
    case "RevokeTicket":
    case "ResumeTicket":
      return asTicketId(command.value);
  }
}
