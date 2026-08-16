/**
 * THE INTERPRETER — the executor made real: it takes the rows the actor has
 * journaled, hands each row's whole effect list to the ports, and advances the
 * cursor behind it.
 *
 * IT IS THE ONLY THING IN THIS TREE THAT PERFORMS ON THE ACTOR'S BEHALF, and it
 * decides nothing to do it. The qualifier is the honest form of a claim a
 * `grep` would otherwise refute: `src/adapters/` performs too — that is what an
 * adapter is — and the suites drive ports directly. What is exclusive is the
 * ROUTE: every effect the machine's decisions ask for reaches the world through
 * this file's table and this file's loop, so there is no second path from a
 * journal row to a port. There is no second decision path here: the actor decides (`commit`), the
 * journal is the record, and this file is a total routing table plus a loop. It
 * never asks whether an effect is wanted, never derives a fact a decider could
 * have derived, and never consults the world.
 *
 * ==========================================================================
 * THE THREE PROMISES IT KEEPS, EACH BANKED SOMEWHERE ELSE
 * ==========================================================================
 *
 * JOURNAL BEFORE EFFECT, STRUCTURALLY. Every function here takes a
 * `DurableState`, which `actor.ts` mints only after a store's `append` has
 * returned. A state whose rows are decided but not durable is not a value this
 * file can be called with, so the ordering is a program that does not compile
 * rather than a discipline asked for in a header.
 *
 * THE WHOLE LIST, THEN THE CURSOR. A row's effects all carry that row's seq,
 * they go out in the order the decider emitted them, and `emitNext` is called
 * only once the last of them has returned. That is the promise `actor.ts` hands
 * forward at `emitNext`: a crash part-way through a list leaves the cursor
 * where it was, so the whole list re-emits and every element of it is a
 * redelivery under a key the world already holds. An executor that advanced per
 * effect would break that collapse and would need the refinement layer
 * re-proved rather than reused.
 *
 * THE GRAIN OF ABSORPTION IS THE ROW. What `deliverOnce` is handed here is one
 * keyed item PER ROW, whose payload is the whole row — never one keyed item per
 * effect. That is what makes the two files compose: `deliver.ts` absorbs by key
 * within one call, and its key here is a row's seq, so nothing inside a row can
 * absorb against anything else inside it. The revoke cascade's two identical
 * `OpenHumanTask`s stay two.
 *
 * ==========================================================================
 * WHAT ABSORBS WHAT, SINCE THREE MECHANISMS MEET HERE
 * ==========================================================================
 *
 *   - ACROSS CALLS, THE CURSOR ABSORBS. A row already emitted is not in
 *     `interpretPending`, so a second call re-delivers nothing. This is the
 *     absorber `deliver.ts`'s header names as the real one: `actor.ts`'s cursor.
 *   - WITHIN ONE CALL, `deliverOnce` ABSORBS — and finds nothing to absorb,
 *     because a journal's seqs are dense and each appears once in the pending
 *     slice. Said plainly rather than sold: what it contributes here is the
 *     ISSUE-ORDER check and the explicit ceiling, both of which are live.
 *   - AFTER A CURSOR REGRESSION, THE WORLD ABSORBS. Recovery brings the cursor
 *     back to whatever checkpoint survived, so rows the world already received
 *     are re-emitted deliberately. Nothing in this file suppresses them; the
 *     ports' idempotence promise is what makes that safe, and `ports.ts` states
 *     it as a promise of the contract rather than a courtesy of a stub.
 *
 * ==========================================================================
 * A PORT THAT THROWS
 * ==========================================================================
 *
 * It propagates. Nothing here catches, because there is no answer this file
 * could give that would not be a decision — retrying is a policy, skipping is a
 * dropped effect, and marking the row done is the double-spend the whole design
 * exists to prevent. The caller keeps the state it passed in, so the cursor did
 * not advance for the failing row NOR for any row this call had already emitted;
 * the next drain re-emits all of them. That is a cursor regression, which is
 * `crashRecoverTo`'s own case (the cursor's durability lags emission), and it is
 * absorbed the same way.
 */

import { assertNever, invariant } from "../domain/assert.ts";
import type { Config } from "../domain/domain.ts";
import { effectsOf } from "../effects/effect.ts";
import { keyed, type Keyed } from "../effects/keyed.ts";
import { emitNext, type DurableState } from "../spine/actor.ts";
import type { Entry } from "../spine/entry.ts";
import { deliverOnce } from "./deliver.ts";
import type { Delivery, Ports } from "./ports.ts";

/**
 * THE EFFECT-TO-PORT MAPPING, total over the vocabulary.
 *
 * The whole of the routing, in one switch with an `assertNever` arm, so an
 * effect added to `Effect` without a home here is a compile error rather than a
 * request that quietly reaches nobody.
 *
 * THE TWO ARMS WORTH THE ARGUMENT. `CreateDraft` reaches the authoring
 * surface, `OpenHumanTask` the desk, `SpawnWorkTasks` and `SpawnEvalTasks` the
 * fabric's `spawn`, `EnqueueWrapUp` and `Complete` the wrap-up port: each of
 * those routes where its name says. These do not:
 *
 *   `Revoke` REACHES THE FABRIC'S `cancel`. Revoking retires the ticket's live
 *   set, so something must stop paying for runs that are still going — "stop it
 *   when I say" is the fabric's third promise and there is no other port that
 *   makes it. It reaches `cancel` even when the ticket never ran anything,
 *   which the port promises to succeed at; the cascade revokes Drafts routinely.
 *
 *   `OpenGate` REACHES THE WRAP-UP PORT, NOT THE FABRIC. A gate is a run in the
 *   loose sense, but it carries no task id, appears in no task set, and its
 *   outcome comes back as a wrap-up verdict against a project rather than as a
 *   task completion. Routing it to a port whose `spawn` starts a ticket's task
 *   set would mean inventing a task identity the machine does not have.
 */
export function deliverEffect(ports: Ports, delivery: Delivery): void {
  switch (delivery.effect) {
    case "CreateDraft":
      ports.authoring.createDraft(delivery);
      return;
    case "Revoke":
      ports.fabric.cancel(delivery);
      return;
    case "OpenHumanTask":
      ports.desk.openTask(delivery);
      return;
    case "SpawnWorkTasks":
    case "SpawnEvalTasks":
      ports.fabric.spawn(delivery);
      return;
    case "EnqueueWrapUp":
      ports.wrapUp.enqueue(delivery);
      return;
    case "OpenGate":
      ports.wrapUp.openGate(delivery);
      return;
    case "Complete":
      ports.wrapUp.land(delivery);
      return;
    default:
      return assertNever(delivery.effect, "unhandled effect");
  }
}

/**
 * THE EXECUTOR: drain every row the cursor has not reached, in journal order,
 * and hand back the state with the cursor where it now is.
 *
 * THE CEILING IS THE JOURNAL'S OWN LENGTH, which is the honest bound rather
 * than a number: the executor can never be asked to emit more rows than the
 * journal holds, and a pending slice longer than that would mean the slice was
 * built from something other than this journal.
 *
 * IT IS `emitNext` THAT ADVANCES THE CURSOR, never this file's arithmetic. The
 * world's ledger, the refinement label and the stale-ghost seam all live in
 * that function, and a second spelling of "the cursor moved" would be a second
 * thing for `executorSound` to be true of.
 */
export function interpret(
  cfg: Config,
  s: DurableState,
  ports: Ports,
): DurableState {
  let state = s;
  deliverOnce(
    interpretPending(s),
    (row) => {
      interpretRow(cfg, ports, row.effect);
      const next = emitNext(state);
      invariant(
        next !== undefined,
        `interpret: the cursor refused row ${String(row.seq)}, which the journal holds`,
      );
      state = next;
      return row.seq;
    },
    s.journal.length,
  );
  return state;
}

/**
 * The rows the world has not received, each keyed by its own seq.
 *
 * THE PAYLOAD IS THE ROW, and that is the grain statement in code: one key, one
 * whole effect list. Keying the elements instead would hand `deliverOnce` a
 * batch in which a row's second effect absorbs against its first.
 */
function interpretPending(s: DurableState): readonly Keyed<Entry>[] {
  return s.journal.slice(s.applied).map((entry) => keyed(entry.seq, entry));
}

/**
 * One row's whole effect list, out in the order the decider emitted it.
 *
 * THE CEILING IS THE FLEET, and `decideRevoke` is the only decider it is ever
 * about. Every other effect-bearing decision in `model/domain.qnt` goes through
 * `move`, `escalate` or `completeTicket` and emits exactly one effect; the
 * cascade emits one `Revoke` plus one `OpenHumanTask` per parked dependent, and
 * a dependent is a ticket, so the list cannot outrun the fleet the
 * configuration admits. Anything longer is a decider that has stopped agreeing
 * with the machine it belongs to, and the executor is a good place to hear so.
 */
function interpretRow(cfg: Config, ports: Ports, entry: Entry): void {
  const effects = effectsOf(entry.rec);
  invariant(
    effects.length <= cfg.nTickets,
    `interpret: row ${String(entry.seq)} carries ${String(effects.length)} effects, past the fleet's ceiling of ${String(cfg.nTickets)}`,
  );
  effects.forEach((effect, ordinal) => {
    // `keyed` rather than a record literal, so the seq goes through the
    // envelope's own check on the way to the world and a `Delivery` is visibly
    // `Keyed<Effect>` widened rather than a second envelope.
    deliverEffect(ports, {
      ...keyed(entry.seq, effect),
      ordinal,
      rec: entry.rec,
    });
  });
}
