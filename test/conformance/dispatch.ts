/**
 * The dispatch table from a golden's recorded action name to the command that
 * action sends, and nothing else: `decide` takes every decision.
 *
 * IT IS READ OFF `model/domain.qnt`'s ACTION ROSTER ONE ACTION AT A TIME, and
 * two rows are worth reading twice: `refuse` sends a command `decide` refuses,
 * so its arm answers a refusal, and `settle` has no decider at all. It is the
 * stutter that keeps a quiesced fleet from deadlocking the sampler, so its arm
 * decides nothing and the caller carries the last decision the model kept.
 *
 * AN UNKNOWN ACTION THROWS. A trace names its action, and falling through to a
 * neighbouring decider would replay something the model never took while
 * reporting agreement.
 *
 * `replayActions` IS THE TABLE'S DOMAIN, WRITTEN DOWN SO IT CAN BE CHECKED. A
 * switch cannot be enumerated at run time, so the roster is a value beside it
 * and `dispatch.test.ts` binds it at both ends: to `model/domain.qnt`'s own
 * `step` roster, and to this switch, which must route every name in it and
 * refuse every name outside it. Read off by eye, an action added to the model
 * costs nothing here until a golden happens to fire it; read against the
 * model, it is a failure the moment the model moves.
 */

import {
  alwaysPolicy,
  decide,
  unaskedDisposition,
} from "../../src/domain/deciders.ts";
import type {
  EvaluationFailureDisposition,
  StageDefinition,
  TicketCommand,
  TicketDecision,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { releasedTicketOf } from "../../src/domain/config.ts";
import { updateOf } from "../../src/domain/enablement.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decodeEvaluationFailureDisposition,
  decodeFinalizationResult,
  decodeStageDefinition,
  decodeTicketCommand,
  decodeTaskTerminalReport,
} from "../../src/generated/model-api.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import type { ItfValue } from "../itf/decode.ts";
import { decodeTicketId, itfToWire } from "../itf/vocabulary.ts";

/**
 * Every action name this table routes, in the order `model/domain.qnt`'s `step`
 * lists them. It is checked against that roster rather than trusted.
 */
export const replayActions: readonly string[] = [
  "releaseTicket",
  "updateTicket",
  "revoke",
  "dispatch",
  "taskDone",
  "finalizationResult",
  "resumeTicket",
  "refuse",
  "settle",
];

/**
 * The actions the directed emitter's step relations offer beyond the model's,
 * each drawing and sending what a machine action does from a narrower set. It
 * is checked against `model/mc/mc_chuggy_directed.qnt` rather than trusted.
 */
export const emitterActions: readonly string[] = ["refuseUpdate"];

/** What `replayStep` throws when a trace names an action this table has no arm for. */
export const unknownActionMessage = "is not an action of this machine";

/**
 * One step's draws, under the names `mbt::nondetPicks` records them by. Each is
 * absent on every action that does not draw it, which is what the undefined is.
 */
export interface Picks {
  readonly ticket: ItfValue | undefined;
  readonly dependencies: ItfValue | undefined;
  readonly stages: ItfValue | undefined;
  readonly source: ItfValue | undefined;
  readonly onFailure: ItfValue | undefined;
  readonly report: ItfValue | undefined;
  readonly result: ItfValue | undefined;
  readonly command: ItfValue | undefined;
}

/** A drawn set of ticket ids, which no single model type names. */
function drawnIds(value: ItfValue): readonly number[] {
  const raw = itfToWire(value);
  if (!Array.isArray(raw))
    throw new Error("replay: a dependency draw is a set");
  return raw.map(Number);
}

/** A drawn plan: a list of stages, each read through its own decoder. */
function drawnStages(value: ItfValue): readonly StageDefinition[] {
  const raw = itfToWire(value);
  if (!Array.isArray(raw)) throw new Error("replay: a plan draw is a list");
  return raw.map((stage) => decodeStageDefinition(stage));
}

/** A drawn source, which the model draws as a bare integer. */
function drawnReference(value: ItfValue): number {
  const raw = itfToWire(value);
  if (typeof raw !== "number")
    throw new Error("replay: a reference draw is an integer");
  return raw;
}

/** A draw the action needs, refused rather than defaulted when the trace has none. */
function drawn(
  value: ItfValue | undefined,
  name: string,
  action: string,
): ItfValue {
  if (value === undefined) {
    throw new Error(
      `replay: ${action} draws ${name}, and this state records no such pick`,
    );
  }
  return value;
}

/** A command as a step sent it, and the disposition it was taken under. */
interface Sent {
  readonly command: TicketCommand;
  readonly onFailure: EvaluationFailureDisposition;
}

/** The finalizer's result for the attempt the ticket is on, which the model reads off the state. */
function finalizationCommand(
  pre: TicketGraph,
  ticket: TicketId,
  result: ItfValue,
): TicketCommand {
  const held = ticketAt(pre, ticket);
  return {
    type: "ReportFinalizationResult",
    value: {
      ticket,
      workCycle: held.workCyclesStarted,
      generation: held.finalizationGeneration,
      result: decodeFinalizationResult(itfToWire(result)),
    },
  };
}

/**
 * The command a recorded step sent, rebuilt from its draws the way the
 * model's action builds it; the stutter sends none.
 */
function commandOf(
  pre: TicketGraph,
  action: string,
  picks: Picks,
): Sent | undefined {
  const need = (value: ItfValue | undefined, name: string): ItfValue =>
    drawn(value, name, action);
  const j = (): TicketId => decodeTicketId(need(picks.ticket, "j"));
  const unasked = (command: TicketCommand): Sent => ({
    command,
    onFailure: unaskedDisposition,
  });

  switch (action) {
    case "releaseTicket":
      return unasked({
        type: "CreateTicket",
        value: releasedTicketOf(
          j(),
          new Set(drawnIds(need(picks.dependencies, "dependencies_"))),
          drawnStages(need(picks.stages, "stages")),
        ),
      });
    case "updateTicket":
      return unasked(
        updateOf(ticketAt(pre, j()), drawnStages(need(picks.stages, "stages"))),
      );
    case "revoke":
      return unasked({ type: "RevokeTicket", value: j() });
    case "dispatch":
      return unasked({
        type: "DispatchTicket",
        value: {
          ticket: j(),
          source: drawnReference(need(picks.source, "source")),
        },
      });
    case "taskDone":
      return {
        command: {
          type: "ReportTaskTerminal",
          value: decodeTaskTerminalReport(
            itfToWire(need(picks.report, "report")),
          ),
        },
        onFailure: decodeEvaluationFailureDisposition(
          itfToWire(need(picks.onFailure, "onFailure")),
        ),
      };
    case "finalizationResult":
      return unasked(
        finalizationCommand(pre, j(), need(picks.result, "result")),
      );
    case "resumeTicket":
      return unasked({ type: "ResumeTicket", value: j() });
    case "refuse":
    case "refuseUpdate":
      return unasked(
        decodeTicketCommand(itfToWire(need(picks.command, "command"))),
      );
    case "settle":
      return undefined;
    default:
      throw new Error(`replay: ${action} ${unknownActionMessage}`);
  }
}

/**
 * Replays one recorded step through this implementation's `decide`, and
 * answers undefined for the stutter, which decides nothing. Whether the
 * command is accepted or refused is `decide`'s answer, compared against the
 * decision the golden recorded.
 */
export function replayStep(
  pre: TicketGraph,
  action: string,
  picks: Picks,
): TicketDecision | undefined {
  const sent = commandOf(pre, action, picks);
  return sent === undefined
    ? undefined
    : decide(pre, sent.command, alwaysPolicy(sent.onFailure));
}
