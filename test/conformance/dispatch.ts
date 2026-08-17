/**
 * The dispatch table from a golden's recorded action name to the decider that
 * action calls, and nothing else: no decision is taken here.
 *
 * IT IS READ OFF `model/domain.qnt`'s ACTION ROSTER ONE ACTION AT A TIME, and
 * two rows are worth reading twice. `wrapUpStart` calls `decideDequeue` rather
 * than `decideWrapUpStart`, because the quiet/moved routing is a decider and
 * not a composition inside the action — the model hoisted it there after an
 * inline copy let a valid artifact take the lease with every isolation
 * conjunct staying self-consistently wrong. And `settle` has no decider at
 * all: it is the stutter that keeps a quiesced fleet from deadlocking the
 * sampler, so its arm asserts state identity and carries the label the model
 * writes.
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
import type { Core, Decision } from "../../src/domain/core.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import type { Verdict } from "../../src/domain/task.ts";
import type { WrapUpOutcome } from "../../src/domain/wrapUp.ts";
import {
  decideArrive,
  decideCompleteDuplicate,
  decideDequeue,
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
  settledRecord,
} from "../../src/domain/deciders.ts";
import type { ItfValue } from "../itf/decode.ts";
import {
  decodeDeps,
  decodeInvalidated,
  decodeProgram,
  decodeProjectId,
  decodeTaskId,
  decodeTicketId,
  decodeWrapUp,
} from "../itf/vocabulary.ts";

/**
 * Every action name this table routes, in the order `model/domain.qnt`'s `step`
 * lists them. It is checked against that roster rather than trusted.
 */
export const replayActions: readonly string[] = [
  "arrive",
  "release",
  "revoke",
  "dispatch",
  "taskDone",
  "workReduce",
  "evalReduce",
  "wrapUpStart",
  "wrapUpResolve",
  "completeDuplicate",
  "revalFail",
  "opRetry",
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
  readonly project: ItfValue | undefined;
  readonly wrapUp: ItfValue | undefined;
  readonly taskId: ItfValue | undefined;
  readonly verdict: ItfValue | undefined;
  readonly moved: ItfValue | undefined;
  readonly outcome: ItfValue | undefined;
  readonly decodeVerdict: (value: ItfValue) => Verdict;
  readonly decodeWrapUpOutcome: (value: ItfValue) => WrapUpOutcome;
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
    case "arrive":
      return decideArrive(
        config,
        pre,
        decodeDeps(need(picks.deps, "deps_")),
        decodeProgram(need(picks.program, "prog")),
        decodeProjectId(need(picks.project, "project_")),
        decodeWrapUp(need(picks.wrapUp, "wrapUp_")),
      );
    case "release":
      return decideRelease(pre, j());
    case "revoke":
      return decideRevoke(pre, j());
    case "dispatch":
      return decideDispatch(config, pre, j());
    case "taskDone":
      return decideTaskDone(
        pre,
        j(),
        decodeTaskId(need(picks.taskId, "tid")),
        picks.decodeVerdict(need(picks.verdict, "v")),
      );
    case "workReduce":
      return decideWorkReduce(pre, j());
    case "evalReduce":
      return decideEvalStageReduce(config, pre, j());
    case "wrapUpStart":
      return decideDequeue(
        config,
        pre,
        j(),
        decodeInvalidated(need(picks.moved, "moved")),
      );
    case "wrapUpResolve":
      return decideWrapUpResolve(
        config,
        pre,
        j(),
        picks.decodeWrapUpOutcome(need(picks.outcome, "out")),
        true,
      );
    case "completeDuplicate":
      return decideCompleteDuplicate(pre, j());
    case "revalFail":
      return decideRevalFail(pre, j());
    case "opRetry":
      return decideOpRetry(config, pre, j());
    case "settle":
      return { rec: settledRecord(), post: pre };
    default:
      throw new Error(`replay: ${action} ${unknownActionMessage}`);
  }
}
