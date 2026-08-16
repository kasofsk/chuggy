/**
 * THE JOURNAL AS DATA — `model/refinement.qnt`'s pure half: the base state
 * replay starts from, the two replay folds, the legality checker that is
 * theorem 1, and the world/journal arithmetic theorem 2 is stated in.
 *
 * NOTHING HERE KNOWS THERE IS AN ACTOR. Every function below is a pure fold
 * over a list of rows, which is the property the whole recovery argument rests
 * on: the deciders are pure functions of `(Core, picks)`, so a journal is a
 * sufficient basis for reconstructing the state that wrote it, and the
 * reconstruction cannot depend on anything the crashed process held. The actor
 * that appends rows lives in `actor.ts`; it consumes this file and this file
 * consumes nothing of it.
 *
 * THE FOLDS ARE THIN OVER `cmd.ts`, DELIBERATELY. `execCmd` and `cmdEnabled`
 * are s3's and are not restated here in any form — the model's own words at
 * `execCmd` are that the actor's decide step and the replay step are ONE
 * function so that they cannot drift, and the same sentence is why replay here
 * calls the shipped dispatch rather than switching on a tag of its own.
 *
 * WHY THERE ARE TWO REPLAY FOLDS AND NOT ONE. `replayCore` is the model's:
 * `Core` in, `Core` out, no step history, which is exactly what
 * `recoveryComplete` compares and what the crash actions install. `replayMachine`
 * rebuilds the machine's four vars — the fleet, the last record and both
 * step-history ghosts — because a process that actually crashed lost all four,
 * and the model has no need for it only because its crash action keeps the
 * three it does not replay. Their agreement on the fleet is pinned in
 * `journal.test.ts` rather than assumed, and `replayCore` stays the model's
 * shape so lens A reads it beside the model's own line.
 *
 * BOTH FOLDS ASSUME A LEGAL JOURNAL, exactly as the model's does, and the
 * asymmetry with `journalLegalOn` is the interesting part. A decider assumes
 * its guard: handed a row the state refuses, the deciders here assert and throw
 * — the TypeScript spelling of the model's lookup error. That is why
 * `journalLegalOn` checks enablement BEFORE running the decider and why
 * `recoverFrom` runs it before replaying: a tampered journal is REFUSED by the
 * checker, and only a journal the checker accepted is ever handed to a fold.
 */

import type { Config } from "../domain/domain.ts";
import type { Core, StepRecord } from "../domain/measure.ts";
import { cmdEnabled, execCmd } from "./cmd.ts";
import { diffStepRecord } from "./compare.ts";
import type { Entry } from "./entry.ts";
import { applyDecision, initialState, type MachineState } from "./machine.ts";

/**
 * `model/refinement.qnt` genesis — the journal's base state: the machine's init
 * fleet, empty.
 *
 * It is stated here and pinned against `initialState(cfg).core` in the suite
 * rather than derived from it, because `initialState` takes a configuration and
 * the base state of a replay does not depend on one: entry 1's cmd must be
 * enabled HERE, and nothing but an arrival is enabled on an empty fleet, which
 * is what makes `journalLegalOn` enforce the shape of a journal's first row for
 * free.
 */
export const genesis: Core = { tickets: new Map() };

/**
 * `model/refinement.qnt` replayCore — RECOVERY: replay the journal into a fresh
 * in-memory state.
 *
 * Deterministic by purity, which is theorem 3's whole mechanism: `execCmd` is a
 * pure function, so this fold has one result, and the live actor took the same
 * function through the same picks.
 */
export function replayCore(cfg: Config, journal: readonly Entry[]): Core {
  let state = genesis;
  for (const entry of journal) {
    state = execCmd(cfg, state, entry.cmd).post;
  }
  return state;
}

/**
 * RECOVERY FOR A PROCESS THAT ACTUALLY CRASHED: replay the journal into the
 * machine's four vars, not just its fleet.
 *
 * The model's crash action installs a replayed `Core` and keeps `lastStep` and
 * both ghosts, which is sound there because they cannot have moved — a crash is
 * not a domain step. A real process holds all four in memory and loses all
 * four, so recovery has to produce all four, and it can: `lastStep` is the last
 * row's record, and the ghosts are what `apply` wrote at that row. Folding
 * `applyDecision` reproduces them by construction rather than by re-derivation,
 * which is why this is a fold over the same rows and not a second rule about
 * what the ghosts should hold.
 */
export function replayMachine(
  cfg: Config,
  journal: readonly Entry[],
): MachineState {
  let state = initialState(cfg);
  for (const entry of journal) {
    state = applyDecision(cfg, state, execCmd(cfg, state.core, entry.cmd));
  }
  return state;
}

/**
 * `model/refinement.qnt` journalLegalOn — THEOREM 1's checker: the journaled
 * history is a legal domain trace.
 *
 * One fold, three checks per row at the replayed prefix state — the sequence
 * number is the next in the dense monotone order, the decision was ENABLED
 * there under the domain's own guards, and the domain decider at the recorded
 * picks reproduces the recorded `StepRecord` exactly — chaining the decider's
 * post-state as the next prefix.
 *
 * TOTAL BY CONSTRUCTION, and the conjunct ORDER is what makes it so: a disabled
 * row returns false WITHOUT executing the decider. The deciders assume their
 * guards, so running one on a state that refuses it is an assertion failure
 * rather than a boolean, and a tampered journal must be rejected rather than
 * crashed on. The model returns early from the fold by carrying an `ok: false`
 * accumulator forward; returning here is the same answer and the same
 * short-circuit.
 *
 * THE RECORD COMPARISON IS `compare.ts`'s, not an equality of this file's own.
 * That is the shipped structural comparison the replayer already holds every
 * golden step to — sets compared as sets, lists in order — and a second
 * spelling of "the same record" is exactly the drift a checking layer exists to
 * catch.
 */
export function journalLegalOn(
  cfg: Config,
  journal: readonly Entry[],
): boolean {
  let state = genesis;
  let n = 0;
  for (const entry of journal) {
    n += 1;
    if (entry.seq !== n || !cmdEnabled(cfg, state, entry.cmd)) {
      return false;
    }
    const decision = execCmd(cfg, state, entry.cmd);
    if (diffStepRecord(decision.rec, entry.rec, "rec") !== undefined) {
      return false;
    }
    state = decision.post;
  }
  return true;
}

// ==========================================================================
// === World accounting =====================================================
// ==========================================================================
// What the world DOES with an emission is trusted fabric; what the theorems
// need is arithmetic over which DECISIONS reached it. A "spawn" emission runs
// a paid task fan-out — every one of them rides a charged account, per the
// domain's descent table — and a "completion" emission merges the ticket's
// diff. Attribution is `transitions[0].ticket`: every effect-bearing record's
// head transition is the stepped ticket.

/** `model/refinement.qnt` hasEffect. */
export function hasEffect(rec: StepRecord, effect: string): boolean {
  return rec.effects.includes(effect);
}

/**
 * `model/refinement.qnt` stepsTicket — this record's head transition is
 * ticket `j`'s.
 *
 * The model writes `transitions.length() >= 1 and transitions[0].ticket == j`;
 * `first !== undefined` IS that length check under
 * `noUncheckedIndexedAccess`, which is `invariants.ts`'s encoding decision 11.
 */
export function stepsTicket(rec: StepRecord, j: number): boolean {
  const first = rec.transitions[0];
  return first !== undefined && first.ticket === j;
}

/** `model/refinement.qnt` isSpawnFor — a paid task fan-out for ticket `j`. */
export function isSpawnFor(rec: StepRecord, j: number): boolean {
  return hasEffect(rec, "SpawnWorkTasks") && stepsTicket(rec, j);
}

/**
 * `model/refinement.qnt` isCompletionFor — the emission that merges ticket
 * `j`'s diff.
 *
 * The model's name for this is `isCompletionFor`, and the model is the spec, so
 * the name here is the model's. `PLAN.md`'s s5 row has since been brought to
 * it. The same rename reached `journalCompletionsMatchLedger`, which
 * `ORCHESTRATION.md` still calls `journalLandingsMatchLedger` — a name no
 * definition in `refinement.qnt` answers to, recorded in `PLAN.md`'s divergence
 * section rather than edited into the mandate text.
 */
export function isCompletionFor(rec: StepRecord, j: number): boolean {
  return rec.label === "ticket-done" && stepsTicket(rec, j);
}

/**
 * The world's count, over one class of emission: journaled rows whose seq the
 * world received at least once, plus every orphan.
 *
 * THE TWO HALVES COUNT DIFFERENTLY AND THAT IS THE WHOLE THEOREM. A journaled
 * row is counted once however many times its seq was emitted — re-emission
 * carries the same decision identity and the world absorbs it. An orphan is
 * counted every time, because it has NO seq to absorb against: an un-keyed
 * effect is a distinct spend by construction, which is why the discipline that
 * prevents orphans is load-bearing rather than tidy.
 */
function countWorld(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
  hit: (rec: StepRecord) => boolean,
): number {
  let n = 0;
  journal.forEach((entry, i) => {
    if (worldEffects.has(i + 1) && hit(entry.rec)) {
      n += 1;
    }
  });
  for (const orphan of orphans) {
    if (hit(orphan)) {
      n += 1;
    }
  }
  return n;
}

/** The book's count: decisions RECORDED, whether emitted yet or not. */
function countJournal(
  journal: readonly Entry[],
  hit: (rec: StepRecord) => boolean,
): number {
  let n = 0;
  for (const entry of journal) {
    if (hit(entry.rec)) {
      n += 1;
    }
  }
  return n;
}

/** `model/refinement.qnt` worldSpawnsOn — distinct-decision spawn emissions for `j`. */
export function worldSpawnsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
  j: number,
): number {
  return countWorld(journal, worldEffects, orphans, (rec) =>
    isSpawnFor(rec, j),
  );
}

/** `model/refinement.qnt` worldCompletionsOn — distinct-decision completions for `j`. */
export function worldCompletionsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
  j: number,
): number {
  return countWorld(journal, worldEffects, orphans, (rec) =>
    isCompletionFor(rec, j),
  );
}

/** `model/refinement.qnt` journalSpawnsOn — spawn decisions the book charged for `j`. */
export function journalSpawnsOn(journal: readonly Entry[], j: number): number {
  return countJournal(journal, (rec) => isSpawnFor(rec, j));
}

/** `model/refinement.qnt` journalCompletionsOn — completion decisions recorded for `j`. */
export function journalCompletionsOn(
  journal: readonly Entry[],
  j: number,
): number {
  return countJournal(journal, (rec) => isCompletionFor(rec, j));
}
