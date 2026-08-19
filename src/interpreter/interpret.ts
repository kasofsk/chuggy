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
 * THERE IS NO EXCEPTION TO IT. Every decision that emits an effect emits it
 * alongside the transition it belongs to, release included — release changes a
 * ticket's existence rather than its phase, and asks the world for nothing — so
 * the subject is always read positionally and the entry alone is enough.
 *
 * THE ROUTING IS TOTAL over the effect constructors and exhaustively switched,
 * so an effect added to the vocabulary is a compile error here rather than an
 * emission that reaches nothing. It is not a partition into three: the journal
 * store is reached by the executor before any emission and never by this file.
 */

import { assertNever } from "../domain/assertNever.ts";
import { effectFromLabel, type Effect } from "../domain/effect.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import type { Entry } from "../actor/journal.ts";
import type { Emission, WorldPorts } from "./ports.ts";

/** One effect of one decision, with the subject the record attributes it to already read. */
export interface PlannedEmission {
  readonly effect: Effect;
  readonly emission: Emission;
}

/** Every emission one journaled decision asks for, in the record's own effect order. */
export function emissionsOf(entry: Entry): readonly PlannedEmission[] {
  return entry.rec.effects.map((effect, effectIndex) => ({
    effect: effectFromLabel(effect),
    emission: {
      seq: entry.seq,
      effectIndex,
      ticket: emissionsOfSubject(entry, effectIndex),
    },
  }));
}

/**
 * The subject of `effects[effectIndex]`: the ticket its own transition steps.
 * The positions line up because every decider that emits an effect emits it
 * alongside the transition it belongs to — the revoke cascade included, where
 * the parked dependents' tasks and effects are appended in one order.
 */
function emissionsOfSubject(entry: Entry, effectIndex: number): TicketId {
  const transition = entry.rec.transitions[effectIndex];
  if (transition === undefined) {
    throw new Error(
      `interpret: ${entry.rec.label} at seq ${String(entry.seq)} asks for an effect against no transition of its own`,
    );
  }
  return asTicketId(transition.ticket);
}

/** Performs one planned emission at the port its constructor names: total, and the only place that mapping exists. */
export function perform(
  ports: WorldPorts,
  planned: PlannedEmission,
): Promise<void> {
  const at = planned.emission;
  switch (planned.effect) {
    case "SpawnWorkTasks":
      return ports.fabric.spawnWorkTasks(at);
    case "SpawnEvalTasks":
      return ports.fabric.spawnEvalTasks(at);
    case "CancelTicketWork":
      return ports.fabric.cancelTicketWork(at);
    case "RunFinalizer":
      return ports.finalizer.runFinalizer(at);
    case "OpenHumanTask":
      return ports.desk.openHumanTask(at);
    default:
      return assertNever(planned.effect);
  }
}
