/**
 * `model/refinement.qnt`'s INVARIANT BLOCK in TypeScript: the seven refinement
 * invariants and the two bundles, over the journaled actor's state.
 *
 * THE FOUR THEOREMS LIVE HERE. Refinement (`journalLegal`), no double-spent
 * budget and no duplicate cycle across crashes (`noDoubleSpentBudget`,
 * `noDuplicateCycle`, with `journalCoversWorld` as the coverage half and
 * `journalCompletionsMatchLedger` as the ledger bridge), recovery completeness
 * (`recoveryComplete`), and — not statable as an invariant, because it is the
 * DEMONSTRATION that these can fall — the hazard, which is `crash-seam.test.ts`'s.
 * The model's own argument for each sits beside its `val` in
 * `model/refinement.qnt` and is deliberately not restated here, on
 * `invariants.ts`'s rule: a second copy of an argument is the copy that drifts.
 *
 * WHY THEY LIVE BESIDE THE ACTOR AND NOT IN `src/domain/`. The model puts each
 * invariant with the vars it reads — the domain's inside `chuggy_domain`, this
 * layer's inside `chuggy_refinement` — and these read the journal, the cursor,
 * the world's ledger and the orphans, none of which the domain machine has any
 * vocabulary for. That separation is the formal guard the model calls platform
 * capture: a second runtime shape rewrites THIS file and re-proves these
 * obligations against a byte-identical domain machine.
 *
 * WHAT IS DELIBERATELY NOT HERE. The domain bundle. Every expect in the model's
 * refinement runs conjoins `allDomainInvariants` beside these, and the
 * crash-seam suite does the same — through `machine.ts`'s `invariantsHold`,
 * which is the one spelling of "the domain bundle at a machine state". A
 * refinement bundle that quietly included the domain's would make the two
 * indistinguishable in a failure, and the hazard runs need them distinguishable
 * above all: their whole content is that the domain half stays GREEN while this
 * half falls.
 */

import type { Config } from "../domain/domain.ts";
import type { ActorState } from "./actor.ts";
import { diffCore } from "./compare.ts";
import {
  journalCompletionsOn,
  journalLegalOn,
  journalSpawnsOn,
  replayCore,
  worldCompletionsOn,
  worldSpawnsOn,
} from "./journal.ts";

/** The model's `liveTickets.forall(j => ...)` — the fleet's keys, once. */
function everyLiveTicket(
  s: ActorState,
  holds: (j: number) => boolean,
): boolean {
  for (const j of s.mem.core.tickets.keys()) {
    if (!holds(j)) {
      return false;
    }
  }
  return true;
}

/**
 * THEOREM 1 — REFINEMENT: every journaled history projects to a legal
 * domain-machine trace.
 *
 * Structural under the actor's own step — `journalStep` conjoins `cmdEnabled`,
 * so the machine cannot journal a refused decision — and stated here as a state
 * predicate anyway, exactly as the model states it, so that a mutant actor or a
 * tampered journal is caught by a check rather than by a construction argument
 * nobody can run.
 */
export function journalLegal(cfg: Config, s: ActorState): boolean {
  return journalLegalOn(cfg, s.journal);
}

/**
 * THEOREM 3 — RECOVERY COMPLETENESS: replay of the current journal is exactly
 * the actor's in-memory state, in every reachable state.
 *
 * The crash actions genuinely install the replay; this invariant is what makes
 * that installation a no-op on the domain vars. Equality is `compare.ts`'s
 * structural `Core` comparison — sets as sets, the fleet by key — which is the
 * same comparison every golden step is held to, rather than a deep equality
 * this file would have to define and defend.
 */
export function recoveryComplete(cfg: Config, s: ActorState): boolean {
  return diffCore(replayCore(cfg, s.journal), s.mem.core, "core") === undefined;
}

/**
 * The executor's bookkeeping is sound: the cursor stays inside the journal, and
 * the world's received-seq set is exactly the emitted prefix `1..high-water`.
 *
 * The model writes the prefix claim as `worldEffects == 1.to(worldEffects.size())`,
 * which says two things at once — emission is in journal order, and regression
 * re-covers ground rather than skipping it. It is asked here as membership of
 * every seq up to the size, which is the same claim over a `Set` that cannot be
 * compared to a range literal.
 */
export function executorSound(s: ActorState): boolean {
  if (s.applied < 0 || s.applied > s.journal.length) {
    return false;
  }
  if (s.worldEffects.size > s.journal.length) {
    return false;
  }
  for (let seq = 1; seq <= s.worldEffects.size; seq += 1) {
    if (!s.worldEffects.has(seq)) {
      return false;
    }
  }
  return true;
}

/**
 * THE DISCIPLINE CLAIM, coverage half: every effect the world ever received
 * traces to a journaled decision — no orphans.
 *
 * Structural under the disciplined actions, since only `effectCrash` appends
 * one; the FIRST invariant to fall under the hazard, on the very crash step.
 */
export function journalCoversWorld(s: ActorState): boolean {
  return s.orphans.length === 0;
}

/**
 * THEOREM 2, budget half — NO DOUBLE-SPENT BUDGET across crashes: the world
 * never runs more paid work for a ticket than the journal charged.
 *
 * Every journaled spawn decision rides a charged account, and re-emissions are
 * the same decision absorbed by seq. Under the hazard an orphaned spawn is a
 * Job the book never charged for, which is the double-spend as arithmetic.
 */
export function noDoubleSpentBudget(s: ActorState): boolean {
  return everyLiveTicket(
    s,
    (j) =>
      worldSpawnsOn(s.journal, s.worldEffects, s.orphans, j) <=
      journalSpawnsOn(s.journal, j),
  );
}

/**
 * THEOREM 2, cycle half — NO DUPLICATE CYCLE: the world lands a ticket's diff
 * at most once, across crashes at any seam.
 */
export function noDuplicateCycle(s: ActorState): boolean {
  return everyLiveTicket(
    s,
    (j) => worldCompletionsOn(s.journal, s.worldEffects, s.orphans, j) <= 1,
  );
}

/**
 * Theorem 2's journal half, as the ledger bridge: the journal's completion
 * count per ticket IS the domain's `completions` ghost, which the domain's own
 * `completionExclusive` caps at one.
 *
 * The journal cannot gain a duplicate completion decision without the ledger
 * disagreeing. The lookup is the fleet's own map read, which cannot miss: the
 * quantifier is over that map's keys.
 */
export function journalCompletionsMatchLedger(s: ActorState): boolean {
  return everyLiveTicket(s, (j) => {
    const jb = s.mem.core.tickets.get(j);
    return (
      jb !== undefined && journalCompletionsOn(s.journal, j) === jb.completions
    );
  });
}

/**
 * The discipline-INDEPENDENT core: holds under the disciplined machine AND
 * under the hazard, because the hazard corrupts the world, never the journal or
 * the replay. The hazard runs assert exactly this bundle at the step where the
 * world-facing half has already fallen.
 */
export function refinementCore(cfg: Config, s: ActorState): boolean {
  return (
    journalLegal(cfg, s) &&
    recoveryComplete(cfg, s) &&
    executorSound(s) &&
    journalCompletionsMatchLedger(s)
  );
}

/**
 * The full journal-then-effect gate: the core plus the three world-facing
 * theorems. Green at every step of every disciplined run; the expected
 * violations are the hazard's.
 */
export function refinementInvariants(cfg: Config, s: ActorState): boolean {
  return (
    refinementCore(cfg, s) &&
    journalCoversWorld(s) &&
    noDoubleSpentBudget(s) &&
    noDuplicateCycle(s)
  );
}
