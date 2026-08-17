/**
 * Boot: rebuild the actor from the store, drain what the lost cursor owes,
 * and re-hand the gate instruction to every ticket holding the lease.
 *
 * THE RE-HAND IS LEGAL BECAUSE DELIVERY IS AT-LEAST-ONCE. A gate opened just
 * before a crash may have reached a performer that answered into the void, or
 * no performer at all; the journal cannot tell which, so boot re-delivers to
 * every holder and absorption at the port makes the surplus harmless. The
 * emission is reconstructed rather than invented — the sequence number of the
 * decision that opened the gate and the effect's own index in that record —
 * so a re-delivery carries the same identity the first delivery did.
 */

import type { Entry } from "../actor/journal.ts";
import { memoryCore, type ActorState } from "../actor/state.ts";
import { holdingIn } from "../domain/enablement.ts";
import type { TicketId } from "../domain/ids.ts";
import { drain, recover, type Executor } from "../interpreter/executor.ts";
import type { Emission } from "../interpreter/ports.ts";

/** The held gate's own emission, read back off the journal's last record that opened it for this ticket. */
function bootGateEmission(
  journal: readonly Entry[],
  ticket: TicketId,
): Emission {
  for (let at = journal.length - 1; at >= 0; at--) {
    const entry = journal[at];
    if (entry === undefined) continue;
    const effectIndex = entry.rec.effects.findIndex(
      (effect, position) =>
        effect === "OpenGate" &&
        entry.rec.transitions[position]?.ticket === ticket,
    );
    if (effectIndex >= 0) return { seq: entry.seq, effectIndex, ticket };
  }
  throw new Error(
    `boot: ticket ${String(ticket)} holds the lease with no journaled OpenGate to re-hand`,
  );
}

/** Recover, drain, and re-deliver the open gates; the returned state is the drive's to own. */
export async function boot(executor: Executor): Promise<ActorState> {
  const recovered = await recover(executor);
  const drained = await drain(executor, recovered);
  for (const ticket of holdingIn(memoryCore(drained))) {
    await executor.ports.wrapUp.openGate(
      bootGateEmission(drained.journal, ticket),
    );
  }
  return drained;
}
