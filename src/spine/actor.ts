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
 * the atomicity this layer proves safe in one order (`commit` then `emitNext`)
 * and demonstrates unsafe in the other (`effectCrash`, which double-spends).
 *
 * AND THAT ORDER IS A TYPE, NOT A SENTENCE. `emitNext` takes a `DurableState`;
 * `journalStep` — the model's decide-and-journal action — does not return one;
 * only `commit`, after `store.append` has returned, and `recoverFrom`, from
 * rows a store handed back, mint one. So "decide, then emit, with nothing
 * durable in between" is not a discipline asked for in a header: it is a
 * program that does not compile. `actor.test.ts` holds that claim to a
 * `@ts-expect-error`, so the day the type stops discriminating, the gate's
 * types stage says so.
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
 * WHICH EXCLUDES ONE SEAM, INHERITED RATHER THAN CHOSEN, AND SAID OUT LOUD. A
 * row may carry several effects, so a real executor can die with SOME of a row's
 * effect list out and the rest not. That seam is not modeled here because the
 * model does not model it: keying is per DECISION, and a set of seqs cannot
 * express "half of seq 8". Under rule 4 that is inherited, not decided — and the
 * inheritance is safe only if s6's real executor keeps the promise the set
 * semantics assumes, which is written down here so that it is inherited too:
 * EVERY effect of a row carries that row's seq, and the cursor advances only
 * once the WHOLE list is out. Then a crash mid-list re-emits the whole list,
 * every element of it is a redelivery under a key the world already holds, and
 * the partial seam collapses into the re-emission this layer already absorbs. An
 * executor that advanced the cursor per effect would break that collapse and
 * would need this layer re-proved, not reused.
 *
 * AND THE GRAIN OF ABSORPTION IS THE ROW, WHICH IS THE OTHER HALF OF THE SAME
 * SENTENCE. `worldEffects: ReadonlySet<number>` says the unit is one seq
 * carrying one whole effect list — not one key per effect. A fabric that keyed
 * elements individually would deduplicate WITHIN a row, and a row's effect list
 * is not a set: `corpus/tier2/witness-cascade-park.itf.json`'s `ticket-revoked`
 * row carries `["Revoke", "OpenHumanTask", "OpenHumanTask"]`, two desk tasks for
 * two cascade-parked dependents, and collapsing them would open one desk task
 * for two tickets. Same key for the whole list, absorbed as a list; that is what
 * this layer proves.
 *
 * AND `src/interp/` IS WHERE IT IS NOW WIRED, with one refinement worth reading
 * before trusting the sentence above too literally. `execute.ts` keeps the
 * promise exactly — every effect of a row carries the row's seq, and `emitNext`
 * is called only once the whole list has returned — but `ports.ts`'s `Delivery`
 * keys the WORLD by the pair (seq, ordinal-in-the-row) rather than by the seq
 * alone. That is not the per-effect key this paragraph forbids: an ordinal is a
 * position in the row, not a property of the effect, so it collapses nothing
 * within a row while absorbing a re-emitted row element for element. Project
 * the ordinal away and what is left is this file's set of seqs, which is why
 * `worldEffects` needed no change.
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

declare const durable: unique symbol;

/**
 * AN ACTOR STATE WHOSE JOURNAL IS DURABLE — every row in it has been through a
 * store's `append` and survived. `emitNext` takes one of these and nothing
 * else, which is what makes journal-before-effect a property of the TYPE rather
 * than of a sentence in a header.
 *
 * THREE THINGS MINT ONE, and each has the same right to: `actorInit` (an empty
 * journal has nothing to lose), `commit` (the append returned), and
 * `recoverFrom` (the rows came out of a store). `journalStep` does not, because
 * a decided-but-unstored row is exactly the state from which an emission would
 * be the double-spend this layer exists to forbid.
 *
 * THE BRAND IS A PHANTOM, and it has exactly two escapes. A caller who writes
 * `as DurableState` has told the compiler something untrue; and a caller who
 * SPREADS one — `{ ...durable, journal: rowsNobodyStored }` — carries the brand
 * onto a journal no store ever saw, and that compiles clean. Neither is a hole
 * this type could close, and the second is not left to the type anyway: a
 * journal the store does not hold IS the single-writer violation, and both the
 * store's append fence and `commit`'s length cross-check refuse it at the next
 * commit. What the brand stops is the honest mistake — wiring an executor to
 * the output of a decide step — which is the one that actually happens, and the
 * one `src/interp/` will be built on top of.
 */
export type DurableState = ActorState & { readonly [durable]: true };

/**
 * What the world holds. A crash of the ACTOR cannot touch it — hence the name,
 * and hence that recovery takes it as an argument rather than rebuilding it: the
 * world's ledger is not in the journal, was never the actor's to lose, and an
 * orphan in it survives every recovery the actor can perform. That survival is
 * the composition the hazard sweep drives across `recoverFrom`.
 */
export type WorldLedger = {
  readonly worldEffects: ReadonlySet<number>;
  readonly orphans: readonly StepRecord[];
};

/** `model/refinement.qnt` rinit — the domain machine's init, with an empty log. */
export function actorInit(cfg: Config): DurableState {
  const fresh: ActorState = {
    mem: initialState(cfg),
    journal: [],
    applied: 0,
    worldEffects: new Set(),
    orphans: [],
    rlabel: "init",
  };
  return fresh as DurableState;
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
 * NO EMISSION HAPPENS HERE, and the return type says so: this hands back a
 * plain `ActorState`, which `emitNext` will not take. The row is decided and
 * journaled in the actor's own view of the log, and until a store has accepted
 * it there is nothing the executor may do with it.
 *
 * IT IS STILL EXPORTED, because it is the model's action: the mirrored runs are
 * written against `model/refinement.qnt`'s `journalStep`, and this is it. What
 * the model gets for free — a `journal` var that is durable by fiat — is what
 * `commit` supplies here, so the runs drive `commit` and this function is the
 * half of it the model's own text describes.
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
 * IT IS THE ONLY WAY A DECISION BECOMES EMITTABLE, and that is the structural
 * half of journal-before-effect: `emitNext` takes a `DurableState`,
 * `journalStep` does not return one, and `commit` mints one only after
 * `store.append` has returned. So "decide, then emit, with nothing durable in
 * between" is not a discipline this file asks for — it is a program that does
 * not compile. The limit of that guarantee is stated at `DurableState`: a
 * caller who asserts the brand has lied to the compiler, and no type stops
 * that.
 *
 * IF THE APPEND THROWS, THE CALLER STILL HOLDS THE OLD STATE and nothing was
 * emitted for the decision — which is what the ordering is chosen for. Whether
 * the row reached the LOG is the one thing the caller cannot know, and the port
 * says so: an append may fail after the row is durable (a lost
 * acknowledgement). So the row is either absent — the decision is lost, from a
 * state that never moved, and may be re-decided — or durable and unknown to
 * this actor, in which case the next append collides on its seq and recovery
 * reads the store and believes it. Both are safe for the same reason: nothing
 * was emitted either way. The opposite order loses nothing and gains an orphan,
 * which is what `effectCrash` demonstrates.
 *
 * THE LENGTH CROSS-CHECK IS THE SINGLE-WRITER RULE, ASKED RATHER THAN ASSUMED.
 * After an append returns, a store holding a different number of rows than this
 * actor believes it wrote has been written by somebody else — the store's own
 * fence catches the collision case, and this catches the case where the fence
 * cannot, because the other writer's rows were accepted in order.
 */
export function commit(
  cfg: Config,
  store: JournalStore,
  s: ActorState,
  cmd: Cmd,
): DurableState | undefined {
  const next = journalStep(cfg, s, cmd);
  if (next === undefined) {
    return undefined;
  }
  const row = next.journal[next.journal.length - 1];
  invariant(row !== undefined, "commit: journalStep appended no row");
  store.append(row);
  invariant(
    store.length() === next.journal.length,
    `commit: the store holds ${String(store.length())} rows and this actor wrote ${String(next.journal.length)} — a second writer`,
  );
  return next as DurableState;
}

/**
 * `model/refinement.qnt` emitNext — THE EXECUTOR: emit the next unemitted row's
 * effects to the world, and advance the cursor.
 *
 * The row at index `applied` carries seq `applied + 1`. The union absorbs a
 * re-emission — same seq, same decision, the world's idempotency key — which is
 * why a cursor that regressed can safely re-cover ground.
 *
 * IT TAKES A `DurableState`, WHICH IS THE STRUCTURAL HALF OF THE DISCIPLINE.
 * The row whose effects this hands to the world is one a store already accepted;
 * there is no way to call it on a state whose journal is only decided.
 *
 * NOT A DOMAIN STEP: `installCore` puts the fleet back exactly where it was and
 * leaves both ghosts stale. It is called rather than skipped precisely because
 * it is identity here — that identity IS the claim "the domain vars do not
 * move", and a seam that started snapshotting the ghosts would silently make
 * this step a flat domain step that `stepDescends` could never falsify.
 */
export function emitNext(s: DurableState): DurableState | undefined {
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
 * DURABILITY SURVIVES A CRASH, which is why this returns a `DurableState`
 * without minting one: the rows were durable before the actor died, and dying
 * is the one thing that cannot make them less so.
 *
 * A CRASH NEEDS NO PERMISSION, so the only refusal here is an incoherent
 * request: a cursor below zero or above the one being lost is not a crash, it
 * is a caller error, and answering `undefined` says so without inventing a
 * recovery nobody can have.
 */
export function crashRecoverTo(
  cfg: Config,
  s: DurableState,
  a: number,
): DurableState | undefined {
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
 * whose one delta over `rstep` is this seam. This file ships no step relation
 * (the picks are data here, so there is nothing to draw), so the configuration
 * has no counterpart to be: what stands in its place is that only the hazard
 * runs call this function. Any later driver that enumerates the actor's steps —
 * a randomized walker, an interpreter's loop — is choosing `rstep` or
 * `rstepHazard` by whether its roster includes this function, and must say
 * which.
 */
export function effectCrash(
  cfg: Config,
  s: DurableState,
  cmd: Cmd,
): DurableState | undefined {
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
 * THE WORLD'S LEDGER IS CARRIED THROUGH, NOT REBUILT. Nothing in the journal
 * records what the world received, and nothing should: an orphan is precisely
 * an effect no row accounts for. So recovery takes the ledger as an argument
 * and hands it back unchanged — a hazard that happened before the crash is
 * still true after it, and `journalCoversWorld` still says so on the recovered
 * state. Dropping it here would erase the hazard on exactly the path a real
 * process takes, which is the composition the hazard sweep drives.
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
): DurableState | undefined {
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
  const rebuilt: ActorState = {
    mem: replayMachine(cfg, journal),
    journal,
    applied: cursor,
    worldEffects: world.worldEffects,
    orphans: world.orphans,
    rlabel: "crash-recover",
  };
  return rebuilt as DurableState;
}
