/**
 * The decision semantics a stored journal row may have been decided under.
 *
 * ONE MACHINE DECIDES AND THE OTHERS ONLY REPLAY. `src/domain/` is the machine
 * the model proves and the only one that takes a new step; a superseded
 * semantics lives here to re-derive rows already written, and is stated as a
 * correction to the current decision rather than as a second copy of the
 * deciders — a copy would be a machine the model does not check, drifting
 * beside the one it does.
 *
 * A SUPERSEDED SEMANTICS IS FROZEN. What it decided is already durable, so
 * revising one would turn a legal history illegal, which is the failure this
 * module exists to prevent.
 */

import type { Config } from "../domain/config.ts";
import { ticketAt, withTicket, type Decision } from "../domain/core.ts";
import type { Core } from "../domain/generated/modelTypes.ts";
import {
  decisionEventSubject,
  execDecisionEvent,
  type DecisionEvent,
} from "./decisionEvent.ts";

/** Which deciders produced a row, as the row's own durable envelope declares it. */
export type DecisionSemanticsVersion = 1 | 2;

/** The semantics every new decision is taken under, and the one `model/` describes. */
export const decisionSemanticsVersionCurrent: DecisionSemanticsVersion = 2;

/** Whether a stored number names decision semantics this image knows how to replay. */
export function isDecisionSemanticsVersion(
  value: number,
): value is DecisionSemanticsVersion {
  return value === 1 || value === 2;
}

/**
 * The rework wall parked at the eval resume before the wall had a resume of its
 * own, which is the whole of what the first semantics decided differently.
 */
function decisionAtReworkWallParkedEvaluating(
  event: DecisionEvent,
  decision: Decision,
): Decision {
  if (event.type !== "EvalReduce") return decision;
  const id = decisionEventSubject(event);
  const parked = ticketAt(decision.post, id);
  if (parked.phase !== "Escalated" || parked.reason !== "ReworkBudgetExhausted")
    return decision;
  return {
    rec: decision.rec,
    post: withTicket(decision.post, id, {
      ...parked,
      resumeAt: "ResumeEvaluating",
    }),
  };
}

/**
 * One journaled decision re-derived under the semantics its row declares. The
 * record is the current decider's either way; only the parked resume differs.
 */
export function execDecisionEventAt(
  semantics: DecisionSemanticsVersion,
  config: Config,
  core: Core,
  event: DecisionEvent,
): Decision {
  const decision = execDecisionEvent(config, core, event);
  if (semantics === decisionSemanticsVersionCurrent) return decision;
  return decisionAtReworkWallParkedEvaluating(event, decision);
}
