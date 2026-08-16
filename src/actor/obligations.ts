/**
 * The refinement obligations, in the model's own two bundles.
 *
 * NEITHER BUNDLE TAKES THE DOMAIN'S `Invariant` SIGNATURE. These read the
 * actor's journal, cursor and world, so theirs is over `ActorState`, and
 * forcing them into the domain's `StepView` shape would invent arguments they
 * do not use; the one-signature rule in `src/domain/invariants.ts` governs the
 * domain bundle and does not reach here.
 *
 * THE SPLIT IS THE DEMONSTRATION. `refinementCore` is the
 * discipline-independent bundle: the hazard corrupts the world and never the
 * journal or the replay, so its members hold under both step relations.
 * `refinementInvariants` adds the world-facing members, green under the
 * disciplined machine and the expected violations under the hazard — a flat
 * list would lose exactly that, which is the same argument the domain's
 * anti-vacuity witnesses make on the other side. The crash-seam suites in
 * `test/actor/` assert precisely which members fall at which seam, and the
 * membership of both bundles is held against `model/refinement.qnt` itself.
 */

import type { Config } from "../domain/config.ts";
import { liveTickets, ticketAt } from "../domain/core.ts";
import { completionsOf } from "../domain/ticket.ts";
import { coreEquals } from "./equality.ts";
import { journalLegalOn, replayCore } from "./journal.ts";
import { memoryCore, type ActorState } from "./state.ts";
import {
  journalCompletions,
  journalSpawns,
  worldCompletions,
  worldSpawns,
} from "./world.ts";

/** The one signature every obligation has: a predicate over the actor's own state. */
export type Obligation = (config: Config, state: ActorState) => boolean;

/** One obligation under the name `model/refinement.qnt` declares it by. */
export interface NamedObligation {
  readonly obligation: string;
  readonly holds: Obligation;
}

/** Refinement: the journaled history is a legal domain trace. */
export const journalLegal: Obligation = (config, state) =>
  journalLegalOn(config, state.journal);

/** Recovery completeness: replay of the current journal is exactly the state the actor holds. */
export const recoveryComplete: Obligation = (config, state) =>
  coreEquals(replayCore(config, state.journal), memoryCore(state));

/**
 * The executor's bookkeeping is sound: the cursor stays inside the journal,
 * and the received set is exactly the emitted prefix — no larger than the
 * journal, and holding every seq up to its own size, which pins it to a dense
 * run from one.
 */
export const executorSound: Obligation = (_config, state) => {
  if (state.applied < 0 || state.applied > state.journal.length) return false;
  if (state.worldEffects.size > state.journal.length) return false;
  for (let seq = 1; seq <= state.worldEffects.size; seq++) {
    if (!state.worldEffects.has(seq)) return false;
  }
  return true;
};

/**
 * The journal's completion count per ticket is the ledger's, where the ledger
 * ghost the model stores is derived here from the phase (`completionsOf`). A
 * corollary of legality plus recovery on any reachable state, stated anyway so
 * a mutant journal is caught by name.
 */
export const journalCompletionsMatchLedger: Obligation = (_config, state) =>
  liveTickets(memoryCore(state)).every(
    (ticket) =>
      journalCompletions(state, ticket) ===
      completionsOf(ticketAt(memoryCore(state), ticket)),
  );

/** Coverage: every effect the world ever received traces to a journaled decision — no orphans. */
export const journalCoversWorld: Obligation = (_config, state) =>
  state.orphans.length === 0;

/** No double-spent budget: the world never runs more paid work for a ticket than the journal charged. */
export const noDoubleSpentBudget: Obligation = (_config, state) =>
  liveTickets(memoryCore(state)).every(
    (ticket) => worldSpawns(state, ticket) <= journalSpawns(state, ticket),
  );

/** No duplicate cycle: the world lands a ticket's diff at most once, across crashes at any seam. */
export const noDuplicateCycle: Obligation = (_config, state) =>
  liveTickets(memoryCore(state)).every(
    (ticket) => worldCompletions(state, ticket) <= 1,
  );

/** The discipline-independent bundle, green under both step relations. */
export const refinementCore: readonly NamedObligation[] = [
  { obligation: "journalLegal", holds: journalLegal },
  { obligation: "recoveryComplete", holds: recoveryComplete },
  { obligation: "executorSound", holds: executorSound },
  {
    obligation: "journalCompletionsMatchLedger",
    holds: journalCompletionsMatchLedger,
  },
];

/**
 * The full journal-then-effect bundle: the core plus the world-facing
 * obligations, derived from the core roster rather than listed beside it.
 */
export const refinementInvariants: readonly NamedObligation[] = [
  ...refinementCore,
  { obligation: "journalCoversWorld", holds: journalCoversWorld },
  { obligation: "noDoubleSpentBudget", holds: noDoubleSpentBudget },
  { obligation: "noDuplicateCycle", holds: noDuplicateCycle },
];

/** The bundle's members that came back false, named; an empty list is the green answer. */
export function failedObligations(
  config: Config,
  state: ActorState,
  bundle: readonly NamedObligation[],
): readonly string[] {
  return bundle
    .filter((member) => !member.holds(config, state))
    .map((member) => member.obligation);
}

/** The bundle's own verdict, as the model's conjunction asks it. */
export function obligationsHold(
  config: Config,
  state: ActorState,
  bundle: readonly NamedObligation[],
): boolean {
  return bundle.every((member) => member.holds(config, state));
}
