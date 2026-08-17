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
 * The fabric runs the paid work a decision spawned, and decides nothing.
 * Delivery is at-least-once, so a call repeating an `emissionKey` already
 * served must change nothing.
 */
export interface FabricPort {
  spawnWorkTasks(emission: Emission): Promise<void>;
  spawnEvalTasks(emission: Emission): Promise<void>;

  /** Withdraws the revoked ticket's live task set: enablement already refuses a revoked ticket's completions, so this stops the spend rather than guards the machine. A set already withdrawn, or never running, is left as it is. */
  cancelTasks(emission: Emission): Promise<void>;
}

/**
 * The desk is the ticket board a human reads and acts on: what arrives here is
 * answered by a person, never performed by the machine. It carries the fabric's
 * idempotence promise unchanged: a repeated `emissionKey` is the same
 * instruction, never a second one.
 */
export interface DeskPort {
  createDraft(emission: Emission): Promise<void>;
  revoke(emission: Emission): Promise<void>;
  openHumanTask(emission: Emission): Promise<void>;
  complete(emission: Emission): Promise<void>;
}

/**
 * The wrap-up performer: the machine work a ticket finishes with — a merge, a
 * deploy — run under the lease the phase derives, which is why its two
 * instructions are not desk rows a person answers. Absorption binds it like the
 * others, with the one nuance stated here: a repeated `openGate` must not run a
 * second distinct attempt, and re-answering the same attempt's outcome is
 * exactly what the re-delivery asks of it.
 */
export interface WrapUpPort {
  /** Notice that the ticket entered the queue; advisory, since the true queue is derived from the core. */
  enqueueWrapUp(emission: Emission): Promise<void>;

  /** The instruction to perform the attempt for the ticket now holding the lease. */
  openGate(emission: Emission): Promise<void>;
}

/** Every side of the world an emission can reach, passed as one value so the routing takes one argument. */
export interface WorldPorts {
  readonly fabric: FabricPort;
  readonly desk: DeskPort;
  readonly wrapUp: WrapUpPort;
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
