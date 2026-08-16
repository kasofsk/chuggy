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
import { everyTicket } from "../domain/invariants.ts";
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
export function executorSound(_cfg: Config, s: ActorState): boolean {
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
export function journalCoversWorld(_cfg: Config, s: ActorState): boolean {
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
export function noDoubleSpentBudget(_cfg: Config, s: ActorState): boolean {
  return everyTicket(
    s.mem.core,
    (_jb, j) =>
      worldSpawnsOn(s.journal, s.worldEffects, s.orphans, j) <=
      journalSpawnsOn(s.journal, j),
  );
}

/**
 * THEOREM 2, cycle half — NO DUPLICATE CYCLE: the world lands a ticket's diff
 * at most once, across crashes at any seam.
 */
export function noDuplicateCycle(_cfg: Config, s: ActorState): boolean {
  return everyTicket(
    s.mem.core,
    (_jb, j) =>
      worldCompletionsOn(s.journal, s.worldEffects, s.orphans, j) <= 1,
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
export function journalCompletionsMatchLedger(
  _cfg: Config,
  s: ActorState,
): boolean {
  return everyTicket(
    s.mem.core,
    (jb, j) => journalCompletionsOn(s.journal, j) === jb.completions,
  );
}

/**
 * ONE MEMBER OF A BUNDLE: the conjunct itself, and the name it is known by.
 *
 * THE NAME COMES FROM THE FUNCTION, which is the whole of what this helper is
 * for. Written as a table of name/call pairs, a bundle can be wrong in a way no
 * value ever shows: `["noDoubleSpentBudget", journalCoversWorld]` typechecks,
 * evaluates identically wherever the two agree, and leaves the roster claiming
 * a conjunct the bundle never asks. Taking the name off the reference makes
 * that pairing unwritable — a member IS its function, and the roster is a
 * projection of the members rather than a second list beside them.
 *
 * IT REQUIRES EVERY MEMBER TO TAKE THE SAME TWO ARGUMENTS, which is why three
 * of the seven carry a `_cfg` they do not read. That is the MODEL's shape
 * rather than a concession to this helper: `refinement.qnt` states both bundles
 * as `and { … }` over module vars, where every conjunct is a `val` of the same
 * kind, and the split between "reads the consts" and "does not" is an artifact
 * of writing them as functions. A reader meeting `_cfg` should read it as the
 * bundle's signature, not as a parameter that went unused by accident.
 *
 * IT DEPENDS ON `Function.prototype.name`, and the one thing that would break
 * it is a build step that renames functions. There is none: node runs this tree
 * from source. A tree that grew one would have to say so here.
 */
type BundleMember = readonly [
  name: string,
  holds: (cfg: Config, s: ActorState) => boolean,
];

function member(holds: (cfg: Config, s: ActorState) => boolean): BundleMember {
  return [holds.name, holds];
}

/**
 * `model/refinement.qnt` refinementCore's conjuncts, in the model's order.
 *
 * THE BUNDLE IS THE ROSTER AND THE ROSTER IS THE BUNDLE, which is the guard the
 * domain layer gets from `bundle.test.ts`'s agreement test and this layer had
 * nothing of. Both were name arrays beside an `&&` chain, and nothing tied
 * one to the other: dropping `journalCompletionsMatchLedger` from the chain and
 * swapping `noDoubleSpentBudget` for a duplicate call both left every gate at
 * exit 0, with the hazard runs' asserts false-green because the hazard states
 * are over-determined. Now a conjunct dropped from the chain is a conjunct
 * dropped from the roster, and `src/tools/verify.ts` compares the roster to
 * `model/refinement.qnt`'s own `and { … }` as an exact set in both directions —
 * so the chain is checked against the model rather than against a list beside
 * it.
 */
const refinementCoreMembers: readonly BundleMember[] = [
  member(journalLegal),
  member(recoveryComplete),
  member(executorSound),
  member(journalCompletionsMatchLedger),
];

/**
 * The discipline-INDEPENDENT core: holds under the disciplined machine AND
 * under the hazard, because the hazard corrupts the world, never the journal or
 * the replay. The hazard runs assert exactly this bundle at the step where the
 * world-facing half has already fallen.
 *
 * `every` SHORT-CIRCUITS, so this is the `&&` chain it replaced, member for
 * member and in the model's order — which matters because `invariants.ts`
 * argues that a bundle evaluating every conjunct turns a state the model
 * reports as a plain violation into whatever the conjuncts after it do with it.
 * Naming the failing conjunct is still a checking-layer job and still evaluates
 * them all; that is `refinement-invariants.test.ts`'s, exactly as the domain's
 * is `bundle.test.ts`'s.
 */
export function refinementCore(cfg: Config, s: ActorState): boolean {
  return refinementCoreMembers.every(([, holds]) => holds(cfg, s));
}

/** `model/refinement.qnt` refinementInvariants' conjuncts, in the model's order. */
const refinementBundleMembers: readonly BundleMember[] = [
  member(refinementCore),
  member(journalCoversWorld),
  member(noDoubleSpentBudget),
  member(noDuplicateCycle),
];

/**
 * The full journal-then-effect gate: the core plus the three world-facing
 * theorems. Green at every step of every disciplined run; the expected
 * violations are the hazard's.
 */
export function refinementInvariants(cfg: Config, s: ActorState): boolean {
  return refinementBundleMembers.every(([, holds]) => holds(cfg, s));
}

/**
 * The two bundles above as NAMES, in the model's own conjunct order — the
 * rosters `src/tools/verify.ts` holds against `model/refinement.qnt`'s own
 * `and { … }` blocks as exact sets in both directions.
 *
 * `invariants.ts`'s `bundleConjunctNames`, one layer up, and it is here for the
 * same reason: this layer's obligations are a list in the model and a chain of
 * calls here, and nothing in TypeScript compares a chain of calls to a Quint
 * declaration. An invariant the model adds to either bundle brings no fixture
 * and no decider with it, so replay stays green over an obligation this tree
 * does not know it owes — which is the whole failure mode the roster alarm was
 * built for, on a surface it could not see.
 *
 * THEY ARE PROJECTIONS OF THE MEMBERS, never typed out beside them. That is the
 * difference between this roster and the hand-written pair it replaced: a name
 * here cannot name a conjunct the bundle does not ask, and a conjunct the
 * bundle stopped asking cannot go on being named.
 *
 * TWO ROSTERS AND NOT THEIR UNION, because the model states two blocks and the
 * split is load-bearing: the core is what survives the hazard, and a conjunct
 * that moved from one block to the other would be exactly the change a union
 * could not see.
 */
export const refinementCoreConjuncts: readonly string[] =
  refinementCoreMembers.map(([name]) => name);

export const refinementBundleConjuncts: readonly string[] =
  refinementBundleMembers.map(([name]) => name);

/**
 * The bundles' members as name/call pairs, for the one caller that needs to
 * evaluate every conjunct rather than stop at the first false: the suite that
 * states the EXACT SET a defective state reds.
 *
 * `bundle.test.ts` is the domain's counterpart and lives in a `.test.ts` file
 * because it is a second opinion the shipped code does not use. This one is
 * here because it is not a second opinion at all — it IS the bundle, and
 * exporting it is what keeps the suite from building a third copy.
 */
export const refinementBundles: Readonly<
  Record<"refinementCore" | "refinementInvariants", readonly BundleMember[]>
> = {
  refinementCore: refinementCoreMembers,
  refinementInvariants: refinementBundleMembers,
};
