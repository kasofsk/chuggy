/**
 * The dispatch table from a golden's recorded action name to the decider that
 * action calls, and nothing else: no decision is taken here.
 *
 * IT IS READ OFF `model/domain.qnt`'s ACTION ROSTER ONE ACTION AT A TIME, and
 * one row is worth reading twice: `settle` has no decider at all. It is the
 * stutter that keeps a quiesced fleet from deadlocking the sampler, so its arm
 * asserts state identity and carries the label the model writes.
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

import type { Config } from "../../src/domain/config.ts";
import type { Decision } from "../../src/domain/core.ts";
import {
  decideAbandonHandoff,
  decideDispatch,
  decideEvalStageReduce,
  decideExecutionBlocked,
  decideFinalizationResult,
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  settledRecord,
} from "../../src/domain/deciders.ts";
import type { Core, Stage } from "../../src/domain/generated/modelTypes.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  decodeFinalizationOutcome,
  decodeFinalizationPricing,
  decodeFinalizer,
  decodeReason,
  decodeRetryPricing,
  decodeReworkPolicy,
  decodeStage,
  decodeVerdict,
} from "../../src/generated/model-api.ts";
import type { ItfValue } from "../itf/decode.ts";
import { decodeTaskId, decodeTicketId, itfToWire } from "../itf/vocabulary.ts";

/**
 * Every action name this table routes, in the order `model/domain.qnt`'s `step`
 * lists them. It is checked against that roster rather than trusted.
 */
export const replayActions: readonly string[] = [
  "releaseTicket",
  "revoke",
  "dispatch",
  "taskDone",
  "workReduce",
  "evalReduce",
  "finalizationResult",
  "abandonHandoff",
  "executionBlocked",
  "resumeTicket",
  "settle",
];

/** What `replayStep` throws when a trace names an action this table has no arm for. */
export const unknownActionMessage = "is not an action of this machine";

/**
 * One step's draws, under the names `mbt::nondetPicks` records them by. Each is
 * absent on every action that does not draw it, which is what the undefined is.
 */
export interface Picks {
  readonly ticket: ItfValue | undefined;
  readonly deps: ItfValue | undefined;
  readonly program: ItfValue | undefined;
  readonly workFanout: ItfValue | undefined;
  readonly reworkPolicy: ItfValue | undefined;
  readonly finalizationPricing: ItfValue | undefined;
  readonly resumePricing: ItfValue | undefined;
  readonly finalizer: ItfValue | undefined;
  readonly taskId: ItfValue | undefined;
  readonly verdict: ItfValue | undefined;
  readonly outcome: ItfValue | undefined;
  readonly reason: ItfValue | undefined;
}

/** A drawn set of ticket ids, which no single model type names. */
function drawnIds(value: ItfValue): readonly number[] {
  const raw = itfToWire(value);
  if (!Array.isArray(raw))
    throw new Error("replay: a dependency draw is a set");
  return raw.map(Number);
}

/** A drawn program: a list of stages, each read through its own decoder. */
function drawnProgram(value: ItfValue): readonly Stage[] {
  const raw = itfToWire(value);
  if (!Array.isArray(raw)) throw new Error("replay: a program draw is a list");
  return raw.map((stage) => decodeStage(stage));
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

/**
 * Replays one recorded step through this implementation's deciders. The caller
 * guarantees the action was enabled at `pre`, which the golden's existence is.
 */
export function replayStep(
  config: Config,
  pre: Core,
  action: string,
  picks: Picks,
): Decision {
  const need = (value: ItfValue | undefined, name: string): ItfValue =>
    drawn(value, name, action);
  const j = (): TicketId => decodeTicketId(need(picks.ticket, "j"));

  switch (action) {
    case "releaseTicket":
      return decideReleaseTicket(config, pre, j(), {
        deps: new Set(drawnIds(need(picks.deps, "deps_"))),
        program: drawnProgram(need(picks.program, "prog")),
        workFanout: Number(itfToWire(need(picks.workFanout, "workFanout_"))),
        reworkPolicy: decodeReworkPolicy(
          itfToWire(need(picks.reworkPolicy, "reworkPolicy_")),
        ),
        finalizationPricing: decodeFinalizationPricing(
          itfToWire(need(picks.finalizationPricing, "finalizationPricing_")),
        ),
        resumePricing: decodeRetryPricing(
          itfToWire(need(picks.resumePricing, "resumePricing_")),
        ),
        finalizer: decodeFinalizer(
          itfToWire(need(picks.finalizer, "finalizer_")),
        ),
      });
    case "revoke":
      return decideRevoke(config, pre, j());
    case "dispatch":
      return decideDispatch(pre, j());
    case "taskDone":
      return decideTaskDone(
        pre,
        j(),
        decodeTaskId(need(picks.taskId, "tid")),
        decodeVerdict(itfToWire(need(picks.verdict, "v"))),
      );
    case "workReduce":
      return decideWorkReduce(pre, j());
    case "evalReduce":
      return decideEvalStageReduce(pre, j());
    case "finalizationResult":
      return decideFinalizationResult(
        pre,
        j(),
        decodeFinalizationOutcome(itfToWire(need(picks.outcome, "out"))),
      );
    case "abandonHandoff":
      return decideAbandonHandoff(pre, j());
    case "executionBlocked":
      return decideExecutionBlocked(
        pre,
        j(),
        decodeReason(itfToWire(need(picks.reason, "why"))),
      );
    case "resumeTicket":
      return decideResumeTicket(pre, j());
    case "settle":
      return { rec: settledRecord(), post: pre };
    default:
      throw new Error(`replay: ${action} ${unknownActionMessage}`);
  }
}
