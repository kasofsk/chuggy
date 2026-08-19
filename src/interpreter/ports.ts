/**
 * The ports: what the layer that calls out needs of the world, declared here
 * because this is the layer that calls out.
 *
 * WHY THE PROMISES ARE WRITTEN HERE AND NOT IN AN ADAPTER. An adapter is one
 * answer to a port; the promise is what every answer owes. Whoever writes the
 * second one reads this file and no other, which is the whole of what makes the
 * substitution `model/refinement.qnt` calls PLATFORM CAPTURE a compile-time
 * fact rather than an intention.
 *
 * IDEMPOTENCE, KEYED. The model's world is a set of decision sequence numbers:
 * emitting one twice is absorbed, and that is the one thing the fabric is
 * trusted to honour, given a key. One decision may ask for several effects —
 * a revoke records the revocation and every cascade park in a single record —
 * so the key here is the pair, the deciding sequence number and the effect's
 * own position in that decision's list. The pair is a function of the sequence
 * number, since a decision's effect list is fixed the moment it is journaled,
 * so this refines the model's key rather than replacing it.
 */

import type { Entry } from "../actor/journal.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Parsed } from "./wire.ts";

/** What one effect asks of the world: whose decision, which of its effects, and about which ticket. */
export interface Emission {
  readonly seq: number;
  readonly effectIndex: number;
  readonly ticket: TicketId;
}

/** The identity two deliveries of the same emission share, and the only thing an adapter may absorb on. */
export function emissionKey(emission: Emission): string {
  return `${String(emission.seq)}:${String(emission.effectIndex)}`;
}

/**
 * The fabric runs the paid work a decision spawned and decides nothing;
 * delivery is at-least-once, so a call repeating an `emissionKey` already
 * served must change nothing. Cancellation is addressed to whatever is running
 * that work, so it belongs here rather than beside the desk.
 */
export interface FabricPort {
  spawnWorkTasks(emission: Emission): Promise<void>;
  spawnEvalTasks(emission: Emission): Promise<void>;
  cancelTicketWork(emission: Emission): Promise<void>;
}

/**
 * The finalizer is its own side of the world, not the fabric's. It is the only
 * authority that may report a finalization result, its concurrency is its own,
 * and it is the one adapter that can reach a point of no return — which is why
 * an implementation of it owes a reconciliation story the fabric does not.
 */
export interface FinalizerPort {
  runFinalizer(emission: Emission): Promise<void>;
}

/**
 * The ticket board a human reads and acts on, carrying the fabric's idempotence
 * promise unchanged: a repeated `emissionKey` is the same instruction, never a
 * second one. It has one member because entering Done is transactional with the
 * journal, leaving completion and revocation nothing to ask the world for.
 */
export interface DeskPort {
  openHumanTask(emission: Emission): Promise<void>;
}

/** Every side of the world an emission can reach, passed as one value so the routing takes one argument. */
export interface WorldPorts {
  readonly fabric: FabricPort;
  readonly finalizer: FinalizerPort;
  readonly desk: DeskPort;
}

/**
 * The durable decision log. It is a port with no second side today because the
 * refinement obligation is exactly that a real store substitutes without the
 * core moving, and a port is what makes that substitution checkable instead of
 * promised.
 */
export interface JournalStore {
  /** Resolves only once the entry would survive a crash, which is the whole of journal-then-effect. */
  append(entry: Entry): Promise<void>;

  /** Every stored entry in sequence order, parsed at this boundary, refused rather than thrown. */
  load(): Promise<Parsed<readonly Entry[]>>;

  /** The executor cursor's last checkpoint, or zero when none was ever written. */
  loadCursor(): Promise<number>;

  /** Checkpoints the cursor, deliberately not atomically with emission: a lost checkpoint re-emits its suffix. */
  saveCursor(applied: number): Promise<void>;
}
