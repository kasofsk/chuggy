/**
 * THE OUTBOUND PORTS — everything a decision can ask of the world, as four
 * contracts the pure core states and nothing in the pure core reaches.
 *
 * EACH IS NAMED FOR WHAT IT PROMISES, never for the stub that first implements
 * it, which is `journal-store.ts`'s rule one layer down and the same rule.
 * `src/adapters/recording-world.ts` is today's only implementation of all four
 * and is named after recording, because that is what a stub does and not what a
 * fabric is.
 *
 * WHY FOUR AND NOT ONE, and the line is the audience rather than the
 * convenience. A `FabricPort` runs and stops a ticket's task sets; a `DeskPort`
 * puts work in front of a person; an `AuthoringPort` shows an author a draft; a
 * `LandingPort` moves a ticket across the boundary onto its project. Those are
 * four different things to be wrong about, four different failure modes and
 * four different things a deployment substitutes independently, and one port
 * with seven methods would have one contract paragraph covering all of them —
 * which is to say none of them.
 *
 * WHY THE EFFECT ARRIVES AS DATA AND NOT AS A METHOD ARGUMENT LIST. Every
 * method takes one `Delivery` and returns nothing. The interpreter's whole job
 * is to route, and a routing table whose arms have different shapes is a
 * routing table that has started interpreting: the moment a port method takes a
 * ticket id and a task width, somebody has to derive them, and that somebody is
 * either a decider (which would then be performing) or the interpreter (which
 * would then be deciding). What the world gets is the decision's identity, the
 * effect it asked for, and the record it asked in — and an adapter derives the
 * rest from the view it already holds.
 *
 * WHAT NO PORT HERE IS. There is no port for reading anything: reads are not
 * effects, and everything a decision needs is in the `Core` before the decider
 * runs. There is no port for scheduling, capacity, fairness or retry below the
 * cycle — `model/domain.qnt`'s header puts all four outside the machine's
 * knowledge, so there is nothing for a port to carry them to.
 */

import type { Keyed } from "../effects/keyed.ts";
import type { Effect } from "../effects/effect.ts";
import type { StepRecord } from "../domain/measure.ts";

/**
 * WHAT THE EXECUTOR HANDS A PORT: one effect, the decision that authorized it,
 * and where in that decision's list it sat.
 *
 * IT IS `Keyed<Effect>` WIDENED, not a replacement for it. `keyed.ts`'s
 * envelope is the seq-and-effect pair, and this adds the two fields a port
 * needs beside it: the record the decision performed, because an adapter must
 * be able to attribute the request without the interpreter deriving anything;
 * and the ordinal, for the reason below.
 *
 * ==========================================================================
 * THE KEY IS THE PAIR (seq, ordinal), AND THE GRAIN IS STILL THE ROW
 * ==========================================================================
 *
 * `actor.ts` banks two sentences this type has to keep at once, and they pull
 * in opposite directions until the ordinal is there.
 *
 *   - THE GRAIN OF ABSORPTION IS THE ROW. One journal seq carries one whole
 *     effect list, and the list is not a set: the revoke cascade emits
 *     `["Revoke", "OpenHumanTask", "OpenHumanTask"]` for two parked dependents
 *     — the shape frozen in `corpus/tier2/witness-cascade-park.itf.json` — and
 *     a world that keyed by the effect's VALUE would collapse the two and open
 *     one desk task for two tickets.
 *   - A CRASH MID-LIST RE-EMITS THE WHOLE LIST. The cursor advances only once
 *     the whole list is out, so every element of a re-emitted row is a
 *     redelivery under a key the world already holds, and the partial seam
 *     collapses into the re-emission the refinement layer already absorbs.
 *
 * A key of `seq` alone keeps the second and breaks the first — the row's second
 * and third effects would absorb against its own first. A key derived from the
 * effect keeps neither. The pair keeps both, and it is not a per-effect key in
 * the sense `actor.ts` forbids: the ordinal is a POSITION IN THE ROW, not a
 * property of the effect, so it deduplicates nothing within a row and
 * deduplicates a re-emitted row exactly. Project the ordinal away and what is
 * left is `model/refinement.qnt`'s `worldEffects: Set[int]` — this is that set
 * refined, not replaced.
 */
export type Delivery = Keyed<Effect> & {
  /**
   * Where this effect sat in its decision's effect list, from zero. With `seq`
   * it is the world's idempotency key.
   */
  readonly ordinal: number;
  /** The record the decision performed, as journaled. */
  readonly rec: StepRecord;
};

/**
 * The ticket a record stepped, or `undefined` for a record that stepped none.
 *
 * `model/refinement.qnt`'s attribution rule, in its projection form: every
 * effect-bearing record's head transition is the stepped ticket, which is what
 * `journal.ts`'s `stepsTicket` asks as a predicate and what an adapter needs as
 * a value. `ports.test.ts` pins the two together over every record the walks
 * produce, so the projection cannot drift from the predicate.
 *
 * IT IS THE DECISION'S SUBJECT, AND AN EFFECT HAS NONE OF ITS OWN. A row's
 * effects are a list under one key and the model gives no per-element
 * attribution: the revoke cascade's whole list — the `Revoke` and both
 * `OpenHumanTask`s — belongs to the decision that revoked ticket `j`, and every
 * one of its deliveries answers `j` here. That is not a gap the interpreter
 * should close by pairing effects with transitions positionally, which is a
 * fact about how `decideRevoke` happens to build two lists rather than anything
 * the machine promises. What an adapter needs instead is the derived view:
 * `model/domain.qnt` says it in as many words at `escalate` — the open desk
 * task is DERIVED from the phase (`hasOpenHumanTask`) and `OpenHumanTask` is
 * its trace-visible effect. The desk reads which tickets are parked; the effect
 * is the notification that the answer changed, once per newly parked ticket so
 * that nothing is missed.
 *
 * THE ONE RECORD THAT ANSWERS `undefined` WHILE CARRYING AN EFFECT is
 * `ticket-arrived`, and the reason is worth stating rather than working out
 * twice: `decideArrive` records NO transition, because an arrival creates a
 * ticket instead of moving one and there is no phase to come from. So a
 * `CreateDraft` names no ticket, and the id the arrival minted is not in the
 * row at all — it is in the fleet the decision posted, which is where the
 * authoring surface reads it. An adapter that needed the id from the effect
 * would be re-deriving `decideArrive`'s own id rule outside the decider.
 */
export function subjectOf(rec: StepRecord): number | undefined {
  return rec.transitions[0]?.ticket;
}

// ==========================================================================
// === The fabric ===========================================================
// ==========================================================================

/**
 * THE FABRIC PORT — run this task, tell me when it ends, stop it when I say.
 *
 * ==========================================================================
 * WHAT IT PROMISES
 * ==========================================================================
 *
 *   IT RUNS WHAT IT IS TOLD TO RUN. `spawn` is handed a decision that spawned a
 *   task set — `SpawnWorkTasks` or `SpawnEvalTasks` — and starts the ticket's
 *   live set. The width, the kind and the ids are the ticket's, and they are
 *   already in the view the adapter holds; nothing about them is a choice the
 *   fabric makes.
 *
 *   IT STOPS WHAT IT IS TOLD TO STOP. `cancel` withdraws the ticket's
 *   outstanding runs. Cancelling a ticket that has nothing running SUCCEEDS and
 *   does nothing: the revoke cascade reaches Drafts and Pendings that never ran
 *   a task, and a port that treated that as an error would make the commonest
 *   revocation a failure.
 *
 *   IT REPORTS ENDINGS. A run that ends is reported, and the report reaches the
 *   actor as an external event that a surface translates into a candidate
 *   command (`events.ts`). What the port promises about that report is only
 *   that it happens AT LEAST ONCE.
 *
 *   IT DECIDES NOTHING, AND THAT IS ITS DEFINING PROMISE. It does not synthesize
 *   a completion nobody's run produced, does not order the completions it
 *   reports, does not filter one it thinks is redundant, does not suppress a
 *   stale one for a ticket that has moved on, does not retry below the cycle,
 *   does not batch and does not schedule. Every one of those is a decision, and
 *   a decision made here is a second writer — the machine would then be
 *   refining a fabric rather than the other way round, and the theorems would
 *   be about a journal that is no longer the whole story.
 *
 * ==========================================================================
 * WHERE IT MAY FAIL
 * ==========================================================================
 *
 *   - `spawn` may fail: no placement, no quota, an unreachable medium. It
 *     signals by throwing. The decision is already durable when the throw
 *     arrives — that is what journal-before-effect buys — so the executor's
 *     cursor does not advance and the whole row re-emits on the next drain.
 *     A THROW IS NOT A DENIAL: the run may have started and the acknowledgement
 *     been lost, which is why the re-emission has to be absorbable rather than
 *     merely safe.
 *   - `cancel` may fail, and a failed cancel leaves a run alive. Nothing
 *     downstream breaks: the ticket is `PRevoked` in the actor's memory before
 *     the effect is ever emitted, its live set is retired, and a completion
 *     arriving later for one of its task ids is absorbed by `decideTaskDone`'s
 *     first-write-wins arm. A cancel is a request to stop paying for a run, not
 *     a precondition of correctness.
 *   - A run may end and its report never arrive. The machine waits; waiting is
 *     unbounded by decision, and the way out is the human desk.
 *
 * ==========================================================================
 * ORDERING
 * ==========================================================================
 *
 * INBOUND, the port promises nothing and is promised everything. Deliveries
 * arrive in journal order, one row at a time, with every effect of a row
 * delivered before any effect of its successor — that is the EXECUTOR's
 * promise (`execute.ts`), and an adapter may rely on it.
 *
 * OUTBOUND, the port promises nothing at all. Completions may arrive in any
 * order, more than once, or for runs the machine has already retired. That is
 * at-least-once stated as a contract rather than as a caveat, and the machine
 * is built for it: `decideTaskDone` absorbs a duplicate or stale delivery by
 * task identity, and `journalLegalOn` refuses to journal a decision the state
 * would not enable.
 *
 * ==========================================================================
 * IDEMPOTENCE
 * ==========================================================================
 *
 * A delivery under a key this port has already accepted has NO FURTHER EFFECT.
 * The key is `Delivery`'s pair, and the promise is what makes an at-least-once
 * channel upstream safe: a cursor that regressed re-emits rows the world
 * already has, and re-running a task set for a decision already run would be
 * the double-spend `noDoubleSpentBudget` prices.
 *
 * The promise is the PORT's, not the stub's convenience. An implementation that
 * cannot absorb — because the medium beneath it cannot — has not implemented
 * this port, and the theorems above it do not hold of the system it is in.
 */
export type FabricPort = {
  /** Start the ticket's live task set for this decision. */
  spawn(delivery: Delivery): void;
  /** Stop whatever the ticket has running. Succeeds when there is nothing. */
  cancel(delivery: Delivery): void;
};

// ==========================================================================
// === The desk =============================================================
// ==========================================================================

/**
 * THE DESK PORT — put this ticket in front of a person, and say what wall it
 * hit.
 *
 * WHAT IT PROMISES. `openTask` makes a parked ticket visible to an operator. The
 * ticket's wall and where a retry resumes are on the ticket (`reason`,
 * `resumeAt`), derived by the machine before the effect was emitted; the desk
 * displays them and decides nothing about them. The open-desk flag itself is
 * NOT storage this port keeps — it is `hasOpenHumanTask`, a predicate over the
 * phase, and a desk that kept its own copy would be the second thing that can
 * disagree.
 *
 * IT DECIDES NOTHING. It does not close a task on its own, does not merge two
 * tasks for one ticket, and does not choose what an operator may do — an
 * operator's retry arrives back as an external event and the machine decides
 * whether it is enabled.
 *
 * WHERE IT MAY FAIL. `openTask` may fail if the desk is unreachable. It signals
 * by throwing; the row re-emits, and the redelivery is absorbed by key. A desk
 * task that never opens strands the ticket in `PEscalated`, which is a terminal
 * for the machine's purposes and a page for somebody's — it is not a
 * correctness failure, because nothing downstream of a park is metered.
 *
 * ORDERING. Deliveries arrive in journal order. A row may carry SEVERAL
 * `OpenHumanTask` effects — one per dependent parked by a revoke cascade — and
 * they arrive in the order the cascade parked them, which is ascending ticket
 * id. They are distinct tasks for distinct tickets and nothing may merge them.
 *
 * IDEMPOTENCE. Keyed exactly as `FabricPort` is, by `Delivery`'s pair, which is
 * what keeps the cascade's two identical effects two tasks while a re-emitted
 * cascade row stays two.
 */
export type DeskPort = {
  /** Open a desk task for the ticket this decision parked. */
  openTask(delivery: Delivery): void;
};

// ==========================================================================
// === Authoring ============================================================
// ==========================================================================

/**
 * THE AUTHORING PORT — a ticket has been drafted; show it to its author.
 *
 * WHAT IT PROMISES. `createDraft` makes a newly arrived ticket visible on the
 * authoring surface. THE RECORD NAMES NO TICKET, for `subjectOf`'s stated
 * reason — an arrival creates rather than moves, so there is no transition and
 * no id in the row — so the adapter reads the fleet it already holds. That is
 * not a gap in the effect: the id `decideArrive` mints is a fact about the
 * posted state, and re-deriving it from the effect would be a second copy of
 * the decider's own rule.
 *
 * IT DECIDES NOTHING. Release is the author's, and it arrives back as an
 * external event. This port never releases, never edits a draft's program,
 * deps, project or wrap-up kind, and never withdraws one — revocation is a
 * decision, and it reaches the world as `Revoke` through the fabric.
 *
 * WHERE IT MAY FAIL. `createDraft` may fail if the surface is unreachable. It
 * signals by throwing; the row re-emits and the redelivery is absorbed. A draft
 * that never appears leaves a ticket the machine holds and nobody can see,
 * which is a visibility failure and not a safety one — nothing is metered until
 * release.
 *
 * ORDERING. Deliveries arrive in journal order, which is arrival order, which is
 * the order the ids were minted in.
 *
 * IDEMPOTENCE. Keyed as the others are. A re-emitted arrival row shows the
 * author one draft, not two.
 */
export type AuthoringPort = {
  /** Show the author the draft this arrival created. */
  createDraft(delivery: Delivery): void;
};

// ==========================================================================
// === Landing ==============================================================
// ==========================================================================

/**
 * THE LANDING PORT — the boundary a ticket's work crosses onto its project.
 *
 * WHAT IT PROMISES.
 *
 *   `enqueue` announces that a ticket wants its wrap-up. It queues nothing that
 *   decides anything: WHEN the ticket is dequeued is the machine's, because
 *   dequeueing depends on whether the project's lease is free and that is a
 *   read of another ticket's state — a global decision, and a second writer if
 *   an adapter made it.
 *
 *   `openGate` starts the wrap-up step behind the lease the machine has already
 *   granted. What that step DOES — a merge, a registry push, a deploy — is the
 *   adapter's entirely; `model/domain.qnt`'s header puts the internal structure
 *   of a wrap-up step outside the machine's knowledge, and a gate that reported
 *   its own stages would be reporting them to nobody. It ends in one abstract
 *   verdict, reported back as an external event.
 *
 *   `land` publishes the ticket's completion. It is the one effect the headline
 *   property is about — exactly one completion per ticket, ever — so an
 *   implementation that landed twice for one key would falsify the theorem
 *   rather than merely misbehave.
 *
 *   NONE OF THE THREE DECIDES. The port does not choose the queue's order, does
 *   not grant or release a lease, does not judge a gate's outcome, and does not
 *   decide whether a landing is wanted. The machine owns mutual exclusion — it
 *   is the one thing it owns about a project — and it does not own git.
 *
 * WHERE IT MAY FAIL. All three may fail and signal by throwing, and the row
 * re-emits. `land` is the one where the difference between a throw and a denial
 * is expensive: a landing that succeeded and lost its acknowledgement will be
 * re-delivered, and only the idempotence promise below keeps the diff from
 * being applied twice. An implementation whose medium cannot absorb a
 * re-delivered landing under its key must make itself absorbable — by the key
 * this port already carries — before it can claim to implement this port.
 *
 * ORDERING. Deliveries arrive in journal order, so `enqueue` precedes the
 * `openGate` of the same ticket's attempt and `land` follows whichever of them
 * the route went through. The three are never concurrent for one ticket:
 * there is one writer.
 *
 * IDEMPOTENCE. Keyed as the others are, and here the promise is load-bearing
 * rather than tidy: `noDuplicateCycle` says the world lands a ticket's diff at
 * most once across crashes at any seam, and the crash seam it survives is
 * exactly a `land` whose row was re-emitted.
 */
export type LandingPort = {
  /** Announce that this ticket wants its wrap-up. */
  enqueue(delivery: Delivery): void;
  /** Start the wrap-up step behind the lease the machine granted. */
  openGate(delivery: Delivery): void;
  /** Publish this ticket's completion. */
  land(delivery: Delivery): void;
};

/**
 * Every outbound port, as one argument.
 *
 * The interpreter takes this record rather than four parameters, so adding a
 * port is a change to this type and to the dispatch that must then cover it,
 * and never a change to every call site in between.
 */
export type Ports = {
  readonly fabric: FabricPort;
  readonly desk: DeskPort;
  readonly authoring: AuthoringPort;
  readonly landing: LandingPort;
};
