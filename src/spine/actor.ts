/**
 * THE JOURNALED ACTOR — `model/refinement.qnt`'s machine: one single writer
 * holding all state and making every decision, over a fabric that runs things
 * and decides nothing.
 *
 * HOW A DECISION REACHES THE WORLD. Decision events ARE journal rows. Every
 * decision appends `(seq, cmd, rec)` to a durable journal; the EXECUTOR is a
 * cursor (`applied`) consuming that journal in order and emitting each row's
 * effects toward the world; crash recovery replays the journal into a fresh
 * in-memory state and resumes the cursor. Decisions flow decide -> journal ->
 * cursor -> world. The seam between recording a decision and effecting it is
 * the atomicity this layer proves safe in one order (`journalStep` then
 * `emitNext`) and demonstrates unsafe in the other (`effectCrash`, which
 * double-spends).
 *
 * THE STATE IS THE MODEL'S VARS, FLAT. `mem` is the embedded domain machine's
 * four vars — so every domain invariant is askable of the actor's memory at
 * every step — and the five beside it are this layer's own, under the model's
 * names, so the two files read side by side.
 *
 * THE SEAM MODEL, and why there are exactly two crash actions. A decision
 * passes three points — decided, journaled, effected — and the actor may die
 * between any two. The decide/journal seam is UNOBSERVABLE: a pure decision
 * that dies before the journal has no footprint anywhere, so the crashed run is
 * indistinguishable from the run where the actor never decided, and the
 * machine's nondeterminism already contains that run. That is why `journalStep`
 * is one action and not two. The two observable seams are `crashRecoverTo` (the
 * correct discipline's crash, at any instant, with the cursor regressing) and
 * `effectCrash` (the hazard: emit, then die before the journal write).
 *
 * WHAT AN EMISSION IS HERE. `worldEffects` is a SET OF SEQS — what the world
 * received, by decision identity — which is the model's form of "every effect
 * is idempotent, given its key". Emitting the same seq twice is absorbed by the
 * union; that is the composition with an at-least-once fabric, and it is the
 * reason re-emission after cursor loss costs nothing. The payload a real
 * executor hands the fabric is the row's `rec` under that key — the envelope is
 * `src/effects/keyed.ts`'s `Keyed<E>` — and the typed effect vocabulary, the
 * interpreter and the fabric port are s6's. What this layer owns is the
 * identity that makes the redelivery absorbable at all.
 *
 * EVERY ACTION IS TOTAL AND REFUSES BY ANSWERING. A guard that does not hold
 * returns `undefined`; nothing here throws to say "not enabled". That is
 * `journalLegalOn`'s rule one layer down and it is the same rule: the deciders
 * assume their guards, so the guard is asked first and a refused decision is a
 * verdict rather than an exception.
 */

import { invariant } from "../domain/assert.ts";
import type { Config } from "../domain/domain.ts";
import type { StepRecord } from "../domain/measure.ts";
import { cmdEnabled, execCmd, type Cmd } from "./cmd.ts";
import { hasEntryShape, type Entry } from "./entry.ts";
import type { JournalStore } from "./journal-store.ts";
import { journalLegalOn, replayCore, replayMachine } from "./journal.ts";
import {
  applyDecision,
  initialState,
  installCore,
  type MachineState,
} from "./machine.ts";

/**
 * `model/refinement.qnt` rlabel — the refinement-layer step label. Trace
 * visibility only: no invariant reads it, and it is here for the same reason
 * the model keeps it, that a run's shape should be legible in the state it
 * stops at.
 */
export type RefinementLabel =
  "init" | "actor-step" | "emit" | "crash-recover" | "effect-crash-recover";

/**
 * `model/refinement.qnt`'s machine state: the embedded domain instance's vars,
 * plus this layer's five.
 *
 * `journal` IS THE MODEL'S VAR, and it is not a second copy of the store's log
 * wearing a different name. The store is the durability boundary — where the
 * row survives the process — and this is the actor's view of it, which is
 * populated on the way in (`commit` appends the row it just wrote) and rebuilt
 * from the store on the way back (`recoverFrom` takes the store's rows and
 * nothing else). The two can only disagree if a row was durable and the actor
 * never learned of it, and that disagreement has exactly one outcome by
 * construction: recovery believes the store.
 */
export type ActorState = {
  /** The actor's in-memory view of the domain machine — its four vars. */
  readonly mem: MachineState;
  /** THE DURABLE DECISION LOG, as the actor holds it. */
  readonly journal: readonly Entry[];
  /** THE EXECUTOR CURSOR: how many rows' effects have been emitted. */
  readonly applied: number;
  /** WHAT THE WORLD RECEIVED, by decision identity (journal seq). */
  readonly worldEffects: ReadonlySet<number>;
  /** Effects the world received from decisions the journal never recorded. */
  readonly orphans: readonly StepRecord[];
  readonly rlabel: RefinementLabel;
};

/** What the world holds. A crash of the actor cannot touch it — hence the name. */
export type WorldLedger = {
  readonly worldEffects: ReadonlySet<number>;
  readonly orphans: readonly StepRecord[];
};

/** `model/refinement.qnt` rinit — the domain machine's init, with an empty log. */
export function actorInit(cfg: Config): ActorState {
  return {
    mem: initialState(cfg),
    journal: [],
    applied: 0,
    worldEffects: new Set(),
    orphans: [],
    rlabel: "init",
  };
}

/**
 * `model/refinement.qnt` journalStep — THE ACTOR'S STEP: decide and journal,
 * atomically.
 *
 * The decision is the domain decider at the named picks (`execCmd`), refused
 * unless enabled (`cmdEnabled`) — so the actor structurally cannot journal a
 * decision the machine would refuse. `applyDecision` installs the post-state in
 * memory and records the step, which is a REAL domain step and snapshots both
 * ghosts; the row appends with the next dense seq.
 *
 * NO EMISSION HAPPENS HERE. The executor cursor lags by construction, and that
 * lag IS journal-before-effect: there is no code path from this function to the
 * world.
 */
export function journalStep(
  cfg: Config,
  s: ActorState,
  cmd: Cmd,
): ActorState | undefined {
  if (!cmdEnabled(cfg, s.mem.core, cmd)) {
    return undefined;
  }
  const decision = execCmd(cfg, s.mem.core, cmd);
  return {
    // The spread is the model's `applied' = applied, worldEffects' =
    // worldEffects, orphans' = orphans`: the three vars this step does not move.
    ...s,
    mem: applyDecision(cfg, s.mem, decision),
    journal: [
      ...s.journal,
      { seq: s.journal.length + 1, cmd, rec: decision.rec },
    ],
    rlabel: "actor-step",
  };
}

/**
 * THE SINGLE WRITER'S STEP: decide, make the row DURABLE, and only then hand
 * back a state the executor may emit from.
 *
 * This is `journalStep` with the durability boundary in it, and the ordering is
 * the whole point. `store.append` returns only once the row has survived, and
 * the state it returns is the first one from which `emitNext` can reach the
 * world — so no effect of a decision can precede that decision's durability,
 * structurally rather than by discipline.
 *
 * IF THE APPEND THROWS, THE CALLER STILL HOLDS THE OLD STATE and nothing was
 * emitted. That is the failure the ordering is chosen for: a decision that
 * could not be made durable is simply lost, from a state that never moved, and
 * may be re-decided. The opposite order loses nothing and gains an orphan,
 * which is what `effectCrash` demonstrates.
 */
export function commit(
  cfg: Config,
  store: JournalStore,
  s: ActorState,
  cmd: Cmd,
): ActorState | undefined {
  const next = journalStep(cfg, s, cmd);
  if (next === undefined) {
    return undefined;
  }
  const row = next.journal[next.journal.length - 1];
  invariant(row !== undefined, "commit: journalStep appended no row");
  store.append(row);
  return next;
}

/**
 * `model/refinement.qnt` emitNext — THE EXECUTOR: emit the next unemitted row's
 * effects to the world, and advance the cursor.
 *
 * The row at index `applied` carries seq `applied + 1`. The union absorbs a
 * re-emission — same seq, same decision, the world's idempotency key — which is
 * why a cursor that regressed can safely re-cover ground.
 *
 * NOT A DOMAIN STEP: `installCore` puts the fleet back exactly where it was and
 * leaves both ghosts stale. It is called rather than skipped precisely because
 * it is identity here — that identity IS the claim "the domain vars do not
 * move", and a seam that started snapshotting the ghosts would silently make
 * this step a flat domain step that `stepDescends` could never falsify.
 */
export function emitNext(s: ActorState): ActorState | undefined {
  if (s.applied >= s.journal.length) {
    return undefined;
  }
  return {
    ...s,
    mem: installCore(s.mem, s.mem.core, s.mem.lastStep),
    applied: s.applied + 1,
    worldEffects: new Set(s.worldEffects).add(s.applied + 1),
    rlabel: "emit",
  };
}

/**
 * `model/refinement.qnt` crashRecoverTo — CRASH AND RECOVERY at a pinned cursor
 * point.
 *
 * The actor dies at any instant and comes back with memory replayed from the
 * journal — the genuine reconstruction, which by `recoveryComplete` equals the
 * state it lost, so the domain vars do not move — and the executor cursor
 * regressed to any `a <= applied`, because the cursor's own durability lags
 * emission. The lost suffix will re-emit, absorbed by seq. The journal is the
 * one thing that neither moves nor lies.
 *
 * A CRASH NEEDS NO PERMISSION, so the only refusal here is an incoherent
 * request: a cursor below zero or above the one being lost is not a crash, it
 * is a caller error, and answering `undefined` says so without inventing a
 * recovery nobody can have.
 */
export function crashRecoverTo(
  cfg: Config,
  s: ActorState,
  a: number,
): ActorState | undefined {
  if (!Number.isSafeInteger(a) || a < 0 || a > s.applied) {
    return undefined;
  }
  return {
    ...s,
    mem: installCore(s.mem, replayCore(cfg, s.journal), s.mem.lastStep),
    applied: a,
    rlabel: "crash-recover",
  };
}

/**
 * `model/refinement.qnt` effectCrash — THE HAZARD SEAM: the effect-then-journal
 * ordering's crash. Decide, EMIT THE EFFECTS, die before the journal write.
 *
 * The world keeps the emission as an un-keyed orphan; the journal never learns;
 * recovered memory is the replay of a journal that never saw the decision — the
 * pre-decision state. Every domain invariant keeps holding across this step:
 * the domain machine is BLIND to the hazard, which is the whole reason the
 * refinement layer exists.
 *
 * IT IS NOT AN ACTION OF THE DISCIPLINED MACHINE. `model/refinement.qnt` keeps
 * the hazard reproducible by CONFIGURATION — the `rstepHazard` step relation,
 * whose one delta over `rstep` is this seam — and this file's counterpart of
 * that configuration is that nothing but the hazard runs in the crash-seam
 * suite calls it.
 */
export function effectCrash(
  cfg: Config,
  s: ActorState,
  cmd: Cmd,
): ActorState | undefined {
  if (!cmdEnabled(cfg, s.mem.core, cmd)) {
    return undefined;
  }
  const decision = execCmd(cfg, s.mem.core, cmd);
  return {
    ...s,
    mem: installCore(s.mem, replayCore(cfg, s.journal), s.mem.lastStep),
    orphans: [...s.orphans, decision.rec],
    rlabel: "effect-crash-recover",
  };
}

/**
 * THE DURABLE CRASH: everything in memory is gone. The actor comes back holding
 * nothing but the rows the store hands it, whatever cursor checkpoint survived,
 * and the world's ledger — which was never the actor's to lose.
 *
 * WHY THIS EXISTS BESIDE `crashRecoverTo`. The model's crash action keeps
 * `lastStep` and both step-history ghosts, which is sound in a model where a
 * crash cannot move them. A process that actually died held all four vars in
 * memory and lost all four, so this rebuilds all four (`replayMachine`) from
 * rows that arrived as `unknown` from a store. That the two agree — that a
 * recovery which keeps nothing lands on the same state as the model's — is a
 * claim the crash-seam suite makes at every seam it crashes at, not an
 * assumption made here.
 *
 * IT REFUSES RATHER THAN CRASHING, at three gates, and the order is the same
 * order `journalLegalOn` uses and for the same reason. A row that is not
 * shaped like a journal row is refused by the schema's gate before anything
 * reads it; a journal that is not a legal history is refused by the legality
 * fold before any decider is handed a state that refuses it; an incoherent
 * cursor is refused before it can index past the log. A recovering process is
 * exactly the wrong place to throw: the alternative to answering "this log is
 * not readable" is dying again in the same way.
 */
export function recoverFrom(
  cfg: Config,
  rows: readonly unknown[],
  cursor: number,
  world: WorldLedger,
): ActorState | undefined {
  const journal: Entry[] = [];
  for (const row of rows) {
    if (!hasEntryShape(row)) {
      return undefined;
    }
    journal.push(row);
  }
  if (!journalLegalOn(cfg, journal)) {
    return undefined;
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > journal.length) {
    return undefined;
  }
  return {
    mem: replayMachine(cfg, journal),
    journal,
    applied: cursor,
    worldEffects: world.worldEffects,
    orphans: world.orphans,
    rlabel: "crash-recover",
  };
}
