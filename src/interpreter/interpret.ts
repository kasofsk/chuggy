/**
 * The effect interpreter: where an effect becomes a call, and the positional
 * rule that decides whom the call is about.
 *
 * AN EFFECT IS NULLARY, and `src/domain/effect.ts` states why that is the
 * model's decision rather than a shortcut. The consequence lands here: no port
 * call can be formed from the effect list alone, so the subject is read off the
 * record by position — `effects[i]` belongs to `transitions[i]`, which is what
 * every decider builds by construction.
 *
 * `transitions[0].ticket` IS THE WRONG GENERALISATION, and it is worth naming
 * because it passes almost everywhere. It holds for every single-transition
 * step, which is most of them; a revoke records the revocation and every
 * cascade park in one decision, effect for transition, and there the shortcut
 * would open the revoked ticket's desk task once per parked dependent instead
 * of one task per dependent.
 *
 * THE ARRIVAL IS THE ONE EXCEPTION, because there is nothing to be positional
 * about: `ticket-arrived` records one effect against no transition. Its subject
 * is the id the arrival appended, and the dense never-reused id domain makes
 * that the largest key of the post-state — which is the reason the interpreter
 * takes `(Entry, post-Core)` and not the entry alone.
 *
 * THE ROUTING IS TOTAL over the effect constructors and exhaustively switched,
 * so an effect added to the vocabulary is a compile error here rather than an
 * emission that reaches nothing. It is total without being a partition: a
 * revocation reaches the fabric and then the desk — the withdrawal lands before
 * the board hears, because the board's answer is a human's and the fabric's is
 * money still burning — and both deliveries share the one emission key, each
 * port absorbing against its own store. The journal store is reached by the
 * executor before any emission and never by this file.
 */

import { assertNever } from "../domain/assertNever.ts";
import { ticketIds, type Core } from "../domain/core.ts";
import type { Effect } from "../domain/effect.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Entry } from "../actor/journal.ts";
import type { Emission, WorldPorts } from "./ports.ts";

/** One effect of one decision, with the subject the record attributes it to already read. */
export interface PlannedEmission {
  readonly effect: Effect;
  readonly emission: Emission;
}

/** The label of the one decision that records an effect against no transition. */
export const arrivalLabel = "ticket-arrived";

/** Every emission one journaled decision asks for, in the record's own effect order. */
export function emissionsOf(
  entry: Entry,
  post: Core,
): readonly PlannedEmission[] {
  if (entry.rec.label === arrivalLabel) {
    return [emissionsOfArrival(entry, post)];
  }
  return entry.rec.effects.map((effect, effectIndex) => ({
    effect,
    emission: {
      seq: entry.seq,
      effectIndex,
      ticket: emissionsOfSubject(entry, effectIndex),
    },
  }));
}

/** The subject of `effects[effectIndex]`: the ticket its own transition steps. */
function emissionsOfSubject(entry: Entry, effectIndex: number): TicketId {
  const transition = entry.rec.transitions[effectIndex];
  if (transition === undefined) {
    throw new Error(
      `interpret: ${entry.rec.label} at seq ${String(entry.seq)} asks for an effect against no transition of its own; only an arrival records one`,
    );
  }
  return transition.ticket;
}

/** The arrival's subject: the id it appended, which the dense id domain makes the post-state's largest key. */
function emissionsOfArrival(entry: Entry, post: Core): PlannedEmission {
  const effect = entry.rec.effects[0];
  if (
    effect === undefined ||
    entry.rec.effects.length !== 1 ||
    entry.rec.transitions.length !== 0
  ) {
    throw new Error(
      `interpret: ${arrivalLabel} at seq ${String(entry.seq)} is not the one-effect no-transition shape the exception is stated over`,
    );
  }
  const appended = ticketIds(post).at(-1);
  if (appended === undefined) {
    throw new Error(
      `interpret: ${arrivalLabel} at seq ${String(entry.seq)} left an empty fleet behind it`,
    );
  }
  return {
    effect,
    emission: { seq: entry.seq, effectIndex: 0, ticket: appended },
  };
}

/** Performs one planned emission at the port its constructor names: total, and the only place that mapping exists. */
export function perform(
  ports: WorldPorts,
  planned: PlannedEmission,
): Promise<void> {
  const at = planned.emission;
  switch (planned.effect) {
    case "CreateDraft":
      return ports.desk.createDraft(at);
    case "Revoke":
      return ports.fabric.cancelTasks(at).then(() => ports.desk.revoke(at));
    case "OpenHumanTask":
      return ports.desk.openHumanTask(at);
    case "SpawnWorkTasks":
      return ports.fabric.spawnWorkTasks(at);
    case "SpawnEvalTasks":
      return ports.fabric.spawnEvalTasks(at);
    case "EnqueueWrapUp":
      return ports.wrapUp.enqueueWrapUp(at);
    case "OpenGate":
      return ports.wrapUp.openGate(at);
    case "Complete":
      return ports.desk.complete(at);
    default:
      return assertNever(planned.effect);
  }
}
