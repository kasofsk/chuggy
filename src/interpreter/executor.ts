/**
 * The one impure loop, and the two calls either side of it.
 *
 * WHY EXACTLY ONE. `src/actor/` is a pure state machine, and mixing its cursor
 * arithmetic with an `await` would turn crashing at every observable seam from
 * something exhaustive into a scheduling problem. So the impurity is here, and
 * it is one loop over a schedule that was computed before it started — which is
 * also what bounds it, since the schedule's length is known when the loop
 * begins.
 *
 * JOURNAL BEFORE EFFECT, STRUCTURALLY. Two facts, neither of them a convention
 * anyone has to remember. `decide` returns the state holding a new entry only
 * after the store's `append` has resolved, so an entry that was refused durably
 * is an entry no caller ever holds; and `drain` emits from the entries the STORE
 * hands back, having first held memory against them entry for entry, so an entry
 * the store never took — or no longer holds — is one nothing emits, whatever
 * memory believes. The interpreter never sees the store at all: its argument is
 * `(Entry, post-Core)` and nothing else.
 *
 * TWO REFUSALS ON THE WAY IN, at two grains. The store's parse refuses a
 * malformed row; `journalLegalOn` refuses a well-formed journal of a run this
 * machine could not have taken. Both are failures of the machine's own book to
 * be readable rather than refusals to serve this work now, so both throw: there
 * is no decision left to take with an unreadable journal.
 *
 * WHAT RECOVERY CAN AND CANNOT KNOW. The journal and the cursor are all a crash
 * leaves, so recovered memory is the replay and the recovered world ledger is
 * the cursor's own claim — a dense prefix, which is the shape `executorSound`
 * requires of it and the most a restarted process can say. The world
 * may have received more than the cursor recorded; that surplus arrives again
 * on the next drain, and being absorbed by `emissionKey` is what the ports
 * promise.
 */

import {
  execDecisionEvent,
  type DecisionEvent,
} from "../actor/decisionEvent.ts";
import { recordEquals } from "../actor/equality.ts";
import { genesis, journalLegalOn, type Entry } from "../actor/journal.ts";
import { emitNext, journalStep, type ActorState } from "../actor/state.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { Config } from "../domain/config.ts";
import { initRecord } from "../domain/core.ts";
import type { StepView } from "../domain/invariants.ts";
import { emissionsOf, perform, type PlannedEmission } from "./interpret.ts";
import type { JournalStore, WorldPorts } from "./ports.ts";

/** Everything the loop calls out through: the store it journals to, and the world it emits toward. */
export interface Executor {
  readonly config: Config;
  readonly store: JournalStore;
  readonly ports: WorldPorts;
}

/** One step of a drain: an effect to perform, or the cursor checkpoint that closes an entry. */
export type DrainStep =
  | { readonly step: "Emit"; readonly planned: PlannedEmission }
  | { readonly step: "Checkpoint"; readonly seq: number };

/**
 * The whole schedule a drain will perform, as data. Every entry past the cursor
 * contributes its emissions in record order and then its checkpoint, including
 * the entries whose decisions ask the world for nothing.
 */
export function drainPlan(
  config: Config,
  journal: readonly Entry[],
  applied: number,
): readonly DrainStep[] {
  const plan: DrainStep[] = [];
  let replayed = genesis;
  for (const [index, entry] of journal.entries()) {
    replayed = execDecisionEvent(config, replayed, entry.event).post;
    if (index < applied) continue;
    for (const planned of emissionsOf(entry, replayed)) {
      plan.push({ step: "Emit", planned });
    }
    plan.push({ step: "Checkpoint", seq: entry.seq });
  }
  return plan;
}

/** The carried view the actor would hold at the end of this journal, rebuilt by the same fold recovery uses. */
function executorReplayView(
  config: Config,
  journal: readonly Entry[],
): StepView {
  let view: StepView = { pre: genesis, rec: initRecord, post: genesis };
  for (const entry of journal) {
    const decision = execDecisionEvent(config, view.post, entry.event);
    view = { pre: view.post, rec: decision.rec, post: decision.post };
  }
  return view;
}

/**
 * Whether the store's journal is the one this actor holds, entry for entry. The
 * record is the grain because the record is what gets emitted, `journalLegalOn`
 * has already tied each one to a decision this machine would take at that
 * prefix, and the replay the schedule is built from folds the stored `event`s
 * rather than memory's, so a `event` the two disagreed about reaches no port.
 */
function executorAgrees(
  stored: readonly Entry[],
  held: readonly Entry[],
): boolean {
  return (
    stored.length === held.length &&
    stored.every((entry, index) => {
      const mine = held[index];
      return (
        mine !== undefined &&
        entry.seq === mine.seq &&
        recordEquals(entry.rec, mine.rec)
      );
    })
  );
}

/** The store's journal, through the parse and then through the legality check the model states as `journalLegal`. */
async function executorReadJournal(
  executor: Executor,
): Promise<readonly Entry[]> {
  const loaded = await executor.store.load();
  if (loaded.parsed === "Refused") {
    throw new Error(
      `executor: the stored journal did not parse — ${loaded.why}`,
    );
  }
  if (!journalLegalOn(executor.config, loaded.value)) {
    throw new Error(
      "executor: the stored journal is not a history this machine could have taken",
    );
  }
  return loaded.value;
}

/**
 * Journal a decision. The entry is durable before the returned state holds it,
 * which is what makes the discipline structural: a caller that never receives
 * the state never had the decision.
 */
export async function decide(
  executor: Executor,
  state: ActorState,
  event: DecisionEvent,
): Promise<ActorState> {
  const journaled = journalStep(executor.config, state, event);
  const entry = journaled.journal.at(-1);
  if (entry === undefined) {
    throw new Error("decide: the journaled state carries no entry to append");
  }
  await executor.store.append(entry);
  return journaled;
}

/**
 * THE ONE IMPURE LOOP: perform the schedule, checkpointing the cursor as each
 * entry closes. Nothing inside it decides anything, and its length was fixed
 * before it began.
 */
export async function drain(
  executor: Executor,
  state: ActorState,
): Promise<ActorState> {
  const journal = await executorReadJournal(executor);
  if (!executorAgrees(journal, state.journal)) {
    throw new Error(
      `drain: the store's journal is not the one this actor holds — the store has ${String(journal.length)} entr(ies) and memory ${String(state.journal.length)}; recover before draining`,
    );
  }
  let draining = state;
  for (const step of drainPlan(executor.config, journal, state.applied)) {
    switch (step.step) {
      case "Emit":
        await perform(executor.ports, step.planned);
        break;
      case "Checkpoint":
        draining = emitNext(draining);
        if (draining.applied !== step.seq) {
          throw new Error(
            `drain: the cursor reached ${String(draining.applied)} where the schedule closed seq ${String(step.seq)}`,
          );
        }
        await executor.store.saveCursor(draining.applied);
        break;
      default:
        assertNever(step);
    }
  }
  return draining;
}

/** Rebuild the actor from the store alone, which is all a crash leaves standing. */
export async function recover(executor: Executor): Promise<ActorState> {
  const journal = await executorReadJournal(executor);
  const applied = await executor.store.loadCursor();
  if (!Number.isInteger(applied) || applied < 0 || applied > journal.length) {
    throw new Error(
      `recover: the stored cursor ${String(applied)} is not a checkpoint this journal could have written`,
    );
  }
  const emitted = new Set<number>();
  for (let seq = 1; seq <= applied; seq++) emitted.add(seq);
  return {
    view: executorReplayView(executor.config, journal),
    journal,
    applied,
    worldEffects: emitted,
    orphans: [],
  };
}
