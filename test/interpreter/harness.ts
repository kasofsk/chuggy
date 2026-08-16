/**
 * The wiring the walk runs on, and the readings its evidence is taken from.
 *
 * THE WITNESS IS ON THE STORE, NOT ON THE PORTS. Journal-before-effect is a
 * claim about what the world had been told at the moment an entry became
 * durable, and the store is the one place that moment exists. Wrapping it costs
 * four methods where wrapping both port faces would cost eight, and the sample
 * it takes — how much of the world had heard anything — is all the claim needs.
 *
 * THE TWO READINGS ARE DELIVERIES AND HOLDINGS. A world absorbs when a second
 * delivery of one emission is more arrivals and no more holdings; `absorbed`
 * below is that sentence, and `filingByArrival` is a world it must answer no
 * for, because a reading nothing fails is not a reading.
 */

import type { Entry } from "../../src/actor/journal.ts";
import { deskStub, type DeskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub, type FabricStub } from "../../src/adapters/fabricStub.ts";
import {
  journalStoreStub,
  type JournalStoreStub,
} from "../../src/adapters/journalStoreStub.ts";
import type { Config } from "../../src/domain/config.ts";
import { drainPlan, type Executor } from "../../src/interpreter/executor.ts";
import type { Emission, JournalStore } from "../../src/interpreter/ports.ts";

/** A wired executor with its stubs kept in hand, and the sample taken at every append. */
export interface Wiring {
  readonly executor: Executor;
  readonly store: JournalStoreStub;
  readonly desk: DeskStub;
  readonly fabric: FabricStub;
  readonly witness: readonly number[];
}

/** The executor against fresh stubs, with a store that samples the world before each append. */
export function wiring(config: Config): Wiring {
  const store = journalStoreStub();
  const desk = deskStub();
  const fabric = fabricStub();
  const witness: number[] = [];
  const sampled: JournalStore = {
    append: async (entry) => {
      witness.push(desk.deliveries.length + fabric.requests.length);
      await store.append(entry);
    },
    load: () => store.load(),
    loadCursor: () => store.loadCursor(),
    saveCursor: (applied) => store.saveCursor(applied),
  };
  return {
    executor: { config, store: sampled, ports: { fabric, desk } },
    store,
    desk,
    fabric,
    witness,
  };
}

/** How many emissions the first `count` entries of a journal ask for between them. */
function journalPrecedesEffectCeiling(
  config: Config,
  journal: readonly Entry[],
  count: number,
): number {
  return drainPlan(config, journal.slice(0, count), 0).filter(
    (step) => step.step === "Emit",
  ).length;
}

/**
 * Whether nothing reached the world before the decision that asked for it was
 * durable. Entry `n + 1` was being appended when sample `n` was taken, so
 * everything the world had heard by then belongs to the entries before it.
 */
export function journalPrecedesEffect(
  config: Config,
  journal: readonly Entry[],
  witness: readonly number[],
): boolean {
  return witness.every(
    (told, index) =>
      told <= journalPrecedesEffectCeiling(config, journal, index),
  );
}

/** What a world can be read for: what arrived, and what it ended up holding. */
export interface Reading {
  readonly deliveries: number;
  readonly held: number;
}

/** The reading of a wired world, both ports together. */
export function reading(wired: Wiring): Reading {
  return {
    deliveries: wired.desk.deliveries.length + wired.fabric.requests.length,
    held: wired.desk.board.size + wired.fabric.running.size,
  };
}

/** Whether a re-delivery was absorbed: more of it arrived, and the world held no more for it. */
export function absorbed(before: Reading, after: Reading): boolean {
  return after.deliveries > before.deliveries && after.held === before.held;
}

/** A world that files each delivery as its own instruction, which is the one thing the ports forbid. */
export function filingByArrival(): {
  record(emission: Emission): void;
  reading(): Reading;
} {
  const filed = new Map<string, Emission>();
  let deliveries = 0;
  return {
    record: (emission) => {
      deliveries += 1;
      filed.set(String(deliveries), emission);
    },
    reading: () => ({ deliveries, held: filed.size }),
  };
}
