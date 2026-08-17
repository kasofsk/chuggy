/**
 * The wiring the walk runs on, and the readings its evidence is taken from.
 *
 * THE WITNESS IS ON THE STORE, NOT ON THE PORTS. Journal-before-effect is a
 * claim about what the world had been told at the moment an entry became
 * durable, and the store is the one place that moment exists. Wrapping it costs
 * one face where wrapping the ports would cost every method of every one, and
 * the sample it takes — how much of the world had heard anything — is all the
 * claim needs.
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
import { wrapUpStub, type WrapUpStub } from "../../src/adapters/wrapUpStub.ts";
import type { Config } from "../../src/domain/config.ts";
import {
  drainPlan,
  type DrainStep,
  type Executor,
} from "../../src/interpreter/executor.ts";
import type { Emission, JournalStore } from "../../src/interpreter/ports.ts";

/** A wired executor with its stubs kept in hand, and the sample taken at every append. */
export interface Wiring {
  readonly executor: Executor;
  readonly store: JournalStoreStub;
  readonly desk: DeskStub;
  readonly fabric: FabricStub;
  readonly wrapUp: WrapUpStub;
  readonly witness: readonly number[];
}

/**
 * The sample the witness takes, at emission grain to match the schedule's
 * `Emit` steps: a revocation's withdrawal precedes its desk delivery inside one
 * `perform`, so the desk row is the pair's closing half and the one counted. An
 * emission whose withdrawal landed without its desk half is one not yet
 * performed, which errs the safe way — a smaller sample can only tighten the
 * `journalPrecedesEffect` bound, never satisfy it falsely.
 */
function wiringSample(
  desk: DeskStub,
  fabric: FabricStub,
  wrapUp: WrapUpStub,
): number {
  return desk.deliveries.length + fabric.requests.length + wrapUp.handed.length;
}

/** The executor against fresh stubs, with a store that samples the world before each append. */
export function wiring(config: Config): Wiring {
  const store = journalStoreStub();
  const desk = deskStub();
  const fabric = fabricStub();
  const wrapUp = wrapUpStub();
  const witness: number[] = [];
  const sampled: JournalStore = {
    append: async (entry) => {
      witness.push(wiringSample(desk, fabric, wrapUp));
      await store.append(entry);
    },
    load: () => store.load(),
    loadCursor: () => store.loadCursor(),
    saveCursor: (applied) => store.saveCursor(applied),
  };
  return {
    executor: { config, store: sampled, ports: { fabric, desk, wrapUp } },
    store,
    desk,
    fabric,
    wrapUp,
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

/**
 * Whether every emission a schedule asks for is closed by a later checkpoint of
 * its own decision. The other order checkpoints the cursor past an entry whose
 * effects have not happened, so a crash between the two loses them and the
 * recovered cursor skips the entry that asked.
 */
export function emissionPrecedesCheckpoint(
  plan: readonly DrainStep[],
): boolean {
  return plan.every(
    (step, index) =>
      step.step !== "Emit" ||
      plan
        .slice(index + 1)
        .some(
          (later) =>
            later.step === "Checkpoint" &&
            later.seq === step.planned.emission.seq,
        ),
  );
}

/** What a world can be read for: what arrived, and what it ended up holding. */
export interface Reading {
  readonly deliveries: number;
  readonly held: number;
}

/** The reading of a wired world, every port face together, at delivery grain. */
export function reading(wired: Wiring): Reading {
  return {
    deliveries:
      wired.desk.deliveries.length +
      wired.fabric.requests.length +
      wired.fabric.cancellations.length +
      wired.wrapUp.handed.length,
    held:
      wired.desk.board.size +
      wired.fabric.running.size +
      wired.fabric.withdrawn.size +
      wired.wrapUp.held.size,
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
