/**
 * The command map: which ticket command one stored envelope asks the writer
 * to decide, given what was read for it.
 *
 * IT IS PURE AND IT IS THE ONLY ONE. The adapter reads the rows an envelope
 * names — the retained revision a release pins, the escalation an answer
 * resolves, the request a finalizer's result answers — and the writer reads
 * the source a dispatch pins; both hand what they read here, and nothing else
 * spells a `TicketCommand`. So what an envelope means is stated once, beside
 * the envelopes, and never in a transaction.
 *
 * A COMMAND IS NOT A DECISION. Every arm below builds what was asked for and
 * weighs nothing: whether the ticket can take it is `decide`'s answer, which
 * names its refusal when it cannot.
 */

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  resumeTicketCommand,
  revokeTicketCommand,
  type TicketCommand,
} from "../actor/command.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import type { ReleaseAuthoring } from "./authoring.ts";
import type {
  EscalationResolution,
  FinalizationOutcome,
  StoredProjectCommand,
} from "./projectCommand.ts";
import {
  releasedTicketDefinition,
  type TicketDefinitionMaterial,
} from "./ticketDefinition.ts";

/**
 * One envelope and what its reader found for it. A `Decide` already carries
 * its command and needs nothing read; every other envelope names rows, and
 * the arm carries what those rows said.
 */
export type CommandMaterials =
  | {
      readonly envelope: "Decide";
      readonly command: Extract<StoredProjectCommand, { command: "Decide" }>;
    }
  | {
      readonly envelope: "ReleaseDraft";
      readonly ticket: TicketId;
      readonly authoring: ReleaseAuthoring;
      readonly material: TicketDefinitionMaterial;
    }
  | {
      readonly envelope: "Dispatch";
      readonly ticket: TicketId;
      /** The reference the writer's observation of the ticket's repository answered. */
      readonly source: number;
    }
  | {
      readonly envelope: "ResolveNativeAction";
      readonly ticket: TicketId;
      readonly resolution: EscalationResolution;
    }
  | {
      readonly envelope: "SubmitFinalizationResult";
      readonly ticket: TicketId;
      /** The attempt the request was materialized for, read off its row. */
      readonly workCycle: number;
      readonly generation: number;
      readonly outcome: FinalizationOutcome;
      /** The reference the settled attempt folds to. */
      readonly evidence: number;
    };

/** The ticket command one answer to an escalation asks for. */
function commandMapResolution(
  ticket: TicketId,
  resolution: EscalationResolution,
): TicketCommand {
  switch (resolution) {
    case "Resume":
      return resumeTicketCommand(ticket);
    case "Revoke":
      return revokeTicketCommand(ticket);
    default:
      return assertNever(resolution);
  }
}

/** THE MAP: the ticket command an envelope and its materials ask the writer to decide. */
export function ticketCommandOf(materials: CommandMaterials): TicketCommand {
  switch (materials.envelope) {
    case "Decide":
      return materials.command.ticketCommand;
    case "ReleaseDraft":
      return createTicketCommand(
        releasedTicketDefinition(
          materials.ticket,
          materials.authoring,
          materials.material,
        ),
      );
    case "Dispatch":
      return dispatchTicketCommand(materials.ticket, materials.source);
    case "ResolveNativeAction":
      return commandMapResolution(materials.ticket, materials.resolution);
    case "SubmitFinalizationResult":
      return reportFinalizationResultCommand(
        materials.ticket,
        materials.workCycle,
        materials.generation,
        { type: materials.outcome, value: materials.evidence },
      );
    default:
      return assertNever(materials);
  }
}
