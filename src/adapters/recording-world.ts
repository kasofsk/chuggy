/**
 * THE RECORDING WORLD — an in-memory implementation of all four outbound ports,
 * which keeps every promise they make except doing anything.
 *
 * IT IS A STUB AND IT IS REAL CODE, on `in-memory-journal-store.ts`'s argument
 * and for its reason. What it stands in for is the DOING — starting a task set,
 * opening a desk task, landing a diff — and nothing else: the idempotence
 * promise, the ordering it is promised, the refusal to interpret and the
 * refusal to decide are all kept here exactly as a real adapter must keep them,
 * so a suite that passes against this one is exercising the contract rather
 * than the stand-in.
 *
 * IT DECIDES NOTHING, AND EVERY LINE IS ARRANGED TO KEEP THAT TRUE. It
 * synthesizes no completion, orders nothing, filters nothing, drops nothing,
 * merges nothing and retries nothing. It never looks at a ticket's phase, its
 * accounts or its program. It does not know the machine exists. The three
 * things it does are the three the ports document: it records what it was
 * handed, it absorbs a redelivery under a key it already holds, and it refuses
 * a delivery that is not shaped like one.
 *
 * WHICH IS WHY THE HARNESS DELIVERS COMPLETIONS AND THIS FILE DOES NOT. A
 * fabric that decided when a run ends would be deciding, so nothing here ever
 * produces an inbound event. The test harness reads this ledger, chooses what
 * the world did — including delivering the same completion twice, and one for a
 * task the machine has already retired — and hands it to `events.ts` as an
 * external event. At-least-once is the contract, so the harness must be able to
 * exercise it, and a stub that could not be driven that way would be a stub
 * that had quietly made the channel exactly-once.
 *
 * ==========================================================================
 * ABSORPTION, WHICH IS THE ONE MECHANISM WORTH READING CLOSELY
 * ==========================================================================
 *
 * The ledger is keyed by `Delivery`'s pair — the decision's journal seq and the
 * effect's ordinal in that decision's list — and a delivery under a key already
 * held is recorded once. That is the port's idempotence promise, and both
 * halves of it matter:
 *
 *   - A ROW RE-EMITTED AFTER A CURSOR REGRESSION absorbs completely, because
 *     the whole list re-arrives under the same seq at the same ordinals.
 *   - A ROW'S OWN REPEATED EFFECTS DO NOT ABSORB against each other, because
 *     their ordinals differ. The revoke cascade's two `OpenHumanTask`s are two
 *     desk tasks for two parked tickets, and a world that collapsed them would
 *     leave one ticket parked with nobody looking at it.
 *
 * A KEY THAT CHANGES ITS EFFECT IS REFUSED. Two deliveries agreeing on seq and
 * ordinal but disagreeing on the effect mean an executor that reordered or
 * rewrote a row between emissions, which nothing downstream can detect and
 * which would make the ledger a record of something that never happened. It is
 * refused here because this is the last place it is cheap to refuse.
 *
 * IT HOLDS NO CLOCK AND NO AMBIENT CAPABILITY, for the store's reason: a walk
 * driven through it twice gives the same ledger twice, which is what makes it
 * usable in the deterministic runs that prove recovery.
 *
 * WHY THE READS COPY, AND WHY ALL THE WAY DOWN. `ledger` and `recorded` return
 * a fresh DEEP copy every time, on `in-memory-journal-store.ts`'s argument and
 * for a sharper version of its reason. There the risk was a caller splicing the
 * log; here the entries are the values `accepted` is keyed against, so a caller
 * holding a live reference could retag one and change what the world believes
 * it was asked for — the absorption state itself, not just a report of it. A
 * one-level copy stops the splice and not the retag, so it stops the half that
 * does not matter. `readonly` fields are a compile-time claim and this file's
 * consumers include tests that reach past it.
 */

import { invariant } from "../domain/assert.ts";
import type { Delivery, PortCall, Ports } from "../interp/ports.ts";
import { hasDeliveryShape, subjectOf } from "../interp/ports.ts";

/** One thing the world was asked to do, and the decision that asked. */
export type WorldRecord = {
  readonly call: PortCall;
  /** The decision's journal sequence number. */
  readonly seq: number;
  /** The effect's position in that decision's list. */
  readonly ordinal: number;
  /** The effect string the decision emitted. */
  readonly effect: string;
  /**
   * The ticket the decision stepped, or `undefined` where the record steps
   * none. `ticket-arrived` is the only such record that carries an effect; see
   * `subjectOf`.
   */
  readonly ticket: number | undefined;
};

/** The world, and the ledger of everything it was asked to do. */
export type RecordingWorld = {
  readonly ports: Ports;
  /** Everything recorded, in the order it was accepted. */
  ledger(): readonly WorldRecord[];
  /** Everything recorded through one port method, in order. */
  recorded(call: PortCall): readonly WorldRecord[];
};

/**
 * A fresh world that has been asked for nothing.
 *
 * A factory rather than a class, on `createInMemoryJournalStore`'s precedent:
 * the closure gives the ledger the encapsulation a private field would, and
 * `accepted` is unreachable except through the methods that keep the promises.
 */
export function createRecordingWorld(): RecordingWorld {
  const accepted = new Map<string, WorldRecord>();
  const order: WorldRecord[] = [];

  function record(call: PortCall, delivery: Delivery): void {
    // THE PORT'S SHAPE PROMISE, kept with the port's own predicate rather than
    // with a check written here. Every implementation owes this refusal, so the
    // thing being refused has one definition, in the layer that declares the
    // contract — `journal-store.ts` and `hasEntryShape` are the same
    // arrangement one layer down. Asserting rather than answering is this
    // file's choice, not the port's: the shape is the contract, how loudly an
    // implementation fails is the implementation's.
    invariant(
      hasDeliveryShape(delivery),
      `recording world: seq ${String(delivery.seq)} ordinal ${String(delivery.ordinal)} delivered as ${delivery.effect} is not a delivery`,
    );

    const key = `${String(delivery.seq)}:${String(delivery.ordinal)}`;
    const held = accepted.get(key);
    if (held !== undefined) {
      invariant(
        held.effect === delivery.effect && held.call === call,
        `recording world: key ${key} was ${held.call}/${held.effect} and has come back as ${call}/${delivery.effect}`,
      );
      return;
    }

    const entry: WorldRecord = {
      call,
      seq: delivery.seq,
      ordinal: delivery.ordinal,
      effect: delivery.effect,
      ticket: subjectOf(delivery.rec),
    };
    accepted.set(key, entry);
    order.push(entry);
  }

  return {
    ports: {
      fabric: {
        spawn: (delivery) => {
          record("spawn", delivery);
        },
        cancel: (delivery) => {
          record("cancel", delivery);
        },
      },
      desk: {
        openTask: (delivery) => {
          record("openTask", delivery);
        },
      },
      authoring: {
        createDraft: (delivery) => {
          record("createDraft", delivery);
        },
      },
      landing: {
        enqueue: (delivery) => {
          record("enqueue", delivery);
        },
        openGate: (delivery) => {
          record("openGate", delivery);
        },
        land: (delivery) => {
          record("land", delivery);
        },
      },
    },

    ledger(): readonly WorldRecord[] {
      return structuredClone(order);
    },

    recorded(call: PortCall): readonly WorldRecord[] {
      return structuredClone(order.filter((entry) => entry.call === call));
    },
  };
}
