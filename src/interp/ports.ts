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
 * `WrapUpPort` moves a ticket across the completion boundary onto its project.
 * Those are four different things to be wrong about, four different failure
 * modes and four different things a deployment substitutes independently. One
 * port carrying every method between them would have one contract paragraph
 * covering all of them — which is to say none of them.
 *
 * EVERY PORT IS A RECORD OF FUNCTIONS, SPELLED AS PROPERTIES RATHER THAN AS
 * METHODS, and the two differences both matter here. A method's parameters are
 * checked BIVARIANTLY, so a substitute port could narrow what it accepts and
 * still typecheck; a property's are not, which is the check a contract wants.
 * And a port function is routinely lifted out of its record — a test wrapping
 * one to make it fail, an adapter composing two — which method syntax makes a
 * lint finding and which is safe here because no implementation may read
 * `this`. A port has no identity; it is what it does.
 *
 * WHY THE EFFECT ARRIVES AS DATA AND NOT AS A FUNCTION ARGUMENT LIST. Every
 * port function takes one `Delivery` and returns nothing. The interpreter's whole job
 * is to route, and a routing table whose arms have different shapes is a
 * routing table that has started interpreting: the moment a port function takes a
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
 *
 * ==========================================================================
 * THE VIEW AN ADAPTER HOLDS — DECLARED, NOT IMPLIED
 * ==========================================================================
 *
 * The paragraph above says an adapter "derives the rest from the view it
 * already holds", and three port sections below lean on that sentence. It names
 * a component, so the component is declared here rather than left as a phrase.
 *
 * WHAT A `Delivery` CARRIES IS THE DECISION, NOT THE WORK. The key, the effect
 * and the record — and a `StepRecord` is `model/measure.qnt`'s: a label, a list
 * of phase transitions, the effect list and the wrap-up attempt observation. It
 * carries NO task ids, no fan-out width, no evaluator stage and no program. So
 * a real fabric adapter, told `SpawnEvalTasks` for a ticket, is not told which
 * runs to start.
 *
 * THE ANSWER IS A READ MODEL, AND IT IS THE ADAPTER'S OWN COMPONENT — not this
 * layer's, not a fifth port, and not a field on `Delivery`. The moment an effect
 * carried the width, somebody would have to derive it, and the two candidates
 * are a decider (which would then be performing) and the interpreter (which
 * would then be deciding). `model/domain.qnt` already takes this position for
 * the desk in as many words: the open desk task is DERIVED from the phase, and
 * `OpenHumanTask` is its trace-visible effect. The generalization is the shape
 * of this whole layer — AN EFFECT IS A NOTIFICATION THAT THE ANSWER CHANGED,
 * UNDER A KEY, AND NEVER THE ANSWER ITSELF.
 *
 * ITS CONSISTENCY IS BOUNDED, AND THE BOUND IS WHAT MAKES THE POSITION SAFE. A
 * read model may lag the actor's `Core` by any amount and may be read for
 * nothing but performing the delivery in hand. It is never a source of truth:
 * no adapter may decide from it, and nothing the machine owns — enablement,
 * mutual exclusion, an account, a route — may be re-derived out of it, which is
 * the refusal every port section below already states as "it decides nothing".
 * What the key buys is that a lagging read model costs correctness nothing: a
 * delivery it cannot yet serve is one the adapter refuses by throwing, the
 * cursor does not advance, and the row re-emits until it can.
 *
 * AND THE FEED IS NOT ONE OF THESE FOUR CONTRACTS, said plainly because it is
 * the honest half. This tree ships no read model and no way to build one: the
 * only implementation records what it was asked and answers nothing, so nothing
 * here has ever needed the view. A deployment that runs real work supplies that
 * feed outside these contracts, and that is where the core-does-not-move claim
 * is paid for — the pure core, the journal schema and these four types are
 * unchanged by it, and the component that lands is the adapter's.
 *
 * ONE CHANGE WOULD MOVE THE CORE, so it is named rather than discovered.
 * Putting task ids or a width INTO the record: `StepRecord` is the model's,
 * `refinement.qnt` journals it, and every committed golden trace carries its
 * current shape — so that is a model PR under rule 4 and a corpus regeneration,
 * never a widening of this file.
 *
 * ==========================================================================
 * THREE PROMISES ARE THE SAME FOR ALL FOUR, SO THEY ARE STATED ONCE
 * ==========================================================================
 *
 * A second copy of a promise is what drifts, and four copies of one paragraph
 * is four chances to correct three of them. Each port below documents what only
 * it can say; these three are the whole of what it inherits.
 *
 * A DELIVERY IS A DELIVERY. Every implementation REFUSES anything
 * `hasDeliveryShape` refuses, and that is a promise of the PORT rather than a
 * courtesy of one implementation — `journal-store.ts` says the same thing about
 * `hasEntryShape` and for the same reason: a delivery whose key is not a key,
 * or which does not describe its own record, is one an implementation cannot
 * absorb correctly, and the process that finds out is a later one. It is a
 * shape check and nothing more; the line it must not cross is the next
 * paragraph but one.
 *
 * ORDERING IS SCOPED TO ONE DRAIN, AND ACROSS DRAINS THERE IS NONE. This is the
 * scope `deliver.ts` states for its own absorber, and it is the same scope for
 * the same reason: a promise wider than the mechanism that keeps it is a
 * promise the layer is in no position to make.
 *
 *   - WITHIN ONE DRAIN, deliveries arrive in journal order, one row at a time,
 *     with every effect of a row delivered before any effect of its successor.
 *     `execute.ts` is what keeps that, and an adapter may rely on it.
 *   - ACROSS DRAINS, NOTHING IS PROMISED, because the executor's cursor is
 *     durable only up to whatever checkpoint survived. A cursor that regressed
 *     re-sends rows the world already has, so a later drain can deliver seq 1
 *     after seq 3 has been in the world for some time — and, on the wrap-up
 *     port specifically, can re-send an `enqueue` after the `land` that ended
 *     the same ticket. Nothing is out of order in the journal; the JOURNAL is
 *     the order, and a drain is a window onto a prefix of it.
 *   - WHAT HOLDS REGARDLESS IS THE KEY. Every delivery is either new or a
 *     redelivery under a key the port already holds, so the sequence in which
 *     drains hand them over carries no information an implementation may act
 *     on. An adapter that inferred anything from arrival order across drains
 *     would be inferring it from the crash history of the process above it.
 *
 * IDEMPOTENCE IS SCOPED TO THE WORLD, NOT TO A PROCESS, which is the promise
 * every port below restates and the scope none of them stated. A delivery under
 * a key the port has already accepted has NO FURTHER EFFECT, and the memory
 * that holds the key must outlive the process that received it — because the
 * thing being absorbed outlives it too. `journal-store.ts` is where the same
 * sentence is written honestly one layer down, and this is its consequence: an
 * actor's cursor is durable only up to whatever checkpoint survived, so a
 * crash-and-recover re-emits rows the world received before the crash, and
 * nothing bounds how much later that is. A dedup table in process memory
 * absorbs a re-emission WITHIN one run of the actor and nothing else; it would
 * land a ticket's diff twice across the exact crash `noDuplicateCycle` prices,
 * which is the failure the whole design exists to prevent.
 *
 *   - THE KEY SPACE IS THE JOURNAL, so the memory grows with the log and
 *     nothing in the machine ever retires an entry. An implementation may hold
 *     that memory itself, or may borrow it from a medium that is already
 *     idempotent under this key — a conditional write, a unique constraint, a
 *     content-addressed store. Both keep the promise; a set in a variable does
 *     not.
 *   - IT IS THE PORT'S PROMISE AND NOT THE STUB'S CONVENIENCE. An
 *     implementation that cannot absorb, because the medium beneath it cannot,
 *     has not implemented the port it claims — and the refinement theorems
 *     above it do not hold of the system it is in.
 *   - `src/adapters/recording-world.ts` keeps it for the lifetime it has: its
 *     ledger is a map in a closure and the world is the process. That is the
 *     honest scope of a stub, and it is exactly why the promise is stated here
 *     as the port's rather than read off the one implementation.
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
 * and third effects would absorb against its own first, and the measured cost
 * is not one desk task for two tickets but ZERO, since the cascade's own
 * `Revoke` takes the key first. A key derived from the effect keeps neither.
 * The pair keeps both, and it is not the per-effect key `actor.ts` forbids: the
 * ordinal is a POSITION IN THE ROW, not a property of the effect, so it
 * deduplicates nothing within a row and deduplicates a re-emitted row exactly.
 * Project the ordinal away and what is left is `model/refinement.qnt`'s
 * `worldEffects: Set[int]` — this is that set refined, not replaced, and
 * `harness.test.ts`'s `expectRigSteady` asserts the projection at every state of
 * every walk rather than leaving it as an argument.
 *
 * HOW MUCH OF THE MACHINE THIS IS ABOUT, stated because it bounds the risk.
 * `decideRevoke` is the ONLY decider in `model/domain.qnt` that emits a list
 * longer than one: every other effect-bearing decision goes through `move`,
 * `escalate` or `completeTicket`, each of which emits exactly one effect, and
 * `noop` emits none. So the ordinal is zero for every delivery the machine can
 * produce except a cascade's, and the cascade is the single shape the whole
 * refinement turns on. `effect.test.ts` pins that against the committed corpus
 * rather than against this paragraph.
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
 * a value. `ports.test.ts` pins the two together over every record of one walk
 * — `ticket-arrived`, `ticket-released`, `dispatch` and `ticket-revoked`, which
 * between them cover a record with no transition, a record with one, and the
 * one record with several — so the projection cannot drift from the predicate.
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

/**
 * Is this a delivery? THE PORT LAYER'S SHAPE GATE, and the promise every
 * implementation inherits from the header above.
 *
 * IT CHECKS THE KEY AND THE SELF-DESCRIPTION, and nothing else.
 *
 *   - BOTH HALVES OF THE KEY. A `seq` is a journal sequence number, which
 *     `entry.ts`'s schema makes a safe integer from one up; an `ordinal` indexes
 *     a list, so it is a count. Neither half was checked when only the ordinal
 *     was, and a fractional seq is the failure that shape has: `8.5` and `8`
 *     make different keys, so a redelivery under one would not absorb against
 *     the other and a task set would run twice.
 *   - THE DELIVERY DESCRIBES ITS OWN RECORD. The effect handed over must be the
 *     one sitting at that ordinal of the record handed over with it, which is
 *     what makes the pair a key INTO the row rather than two numbers beside it.
 *     An executor that scrambled or truncated a list is caught at the boundary
 *     instead of three assertions later in somebody's walk.
 *
 * IT ANSWERS, IT NEVER THROWS, and it is total over a well-typed `Delivery`.
 * The refusal is the implementation's to raise, because how loudly a port fails
 * is a property of the adapter and not of the shape.
 *
 * WHAT IT DOES NOT CLAIM: that the effect was one the machine would have
 * emitted, that the record is one a decider would have produced, or that the
 * decision was enabled. Those are `journalLegalOn`'s questions, two layers up,
 * and an implementation that asked them would be interpreting the decision —
 * the one thing every port here forbids by name.
 */
export function hasDeliveryShape(delivery: Delivery): boolean {
  return (
    Number.isSafeInteger(delivery.seq) &&
    delivery.seq >= 1 &&
    Number.isSafeInteger(delivery.ordinal) &&
    delivery.ordinal >= 0 &&
    delivery.rec.effects[delivery.ordinal] === delivery.effect
  );
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
 *   live set. WHICH runs those are is read from the adapter's own read model at
 *   the ticket `subjectOf` names: the width, the kind and the ids are the
 *   ticket's, the record carries none of them, and nothing about them is a
 *   choice the fabric makes.
 *
 *   IT STOPS WHAT IT IS TOLD TO STOP. `cancel` withdraws the ticket's
 *   outstanding runs — read from the same view, at the same ticket, for the
 *   same reason: `Revoke` names a decision and never a run, so the set to
 *   withdraw is the adapter's answer and not the effect's. Cancelling a ticket
 *   that has nothing running SUCCEEDS and does nothing: the revoke cascade
 *   reaches Drafts and Pendings that never ran a task, and a port that treated
 *   that as an error would make the commonest revocation a failure.
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
 *     downstream breaks, and the absorber is the DOOR rather than the decider.
 *     The ticket is `PRevoked` in the actor's memory before the effect is ever
 *     emitted, and `cmdEnabled`'s `JTaskDone` arm asks `taskPhaseIn` first —
 *     which holds for `PWorking` and `PEvaluating` and for nothing else — so a
 *     completion arriving later for one of that ticket's task ids is REFUSED at
 *     enablement and never journaled. It is not `decideTaskDone`'s
 *     first-write-wins arm that absorbs it: that arm is for a ticket still in a
 *     task phase, and the decider's own `taskPhaseIn` assertion would reject a
 *     revoked ticket rather than answer for it. `events.test.ts` pins which of
 *     the two answers. A cancel is a request to stop paying for a run, not a
 *     precondition of correctness.
 *   - A run may end and its report never arrive. The machine waits; waiting is
 *     unbounded by decision, and the way out is the human desk.
 *
 * ==========================================================================
 * ORDERING
 * ==========================================================================
 *
 * The senses are `model/refinement.qnt`'s, which fixes them once: effects go
 * TOWARD THE WORLD, and what the world received comes back. Naming them from
 * the adapter's end instead would invert both halfway down a file.
 *
 * TOWARD THE WORLD, the port is promised the header's drain-scoped ordering and
 * promises nothing in return.
 *
 * BACK FROM THE WORLD, the port promises nothing at all. Completions may arrive
 * in any order, more than once, or for runs the machine has already retired.
 * That is at-least-once stated as a contract rather than as a caveat, and the
 * machine is built for it in two places: `cmdEnabled` refuses to journal a
 * report the state does not enable, and `decideTaskDone` absorbs by task
 * identity the duplicates that ARE enabled.
 *
 * ==========================================================================
 * IDEMPOTENCE
 * ==========================================================================
 *
 * The header's, at the header's scope — outliving the process, not the drain.
 * The key is `Delivery`'s pair, and what this port adds is the price of getting
 * it wrong: re-running a task set for a decision already run is the double-spend
 * `noDoubleSpentBudget` prices, so an unabsorbed redelivery here is a theorem
 * falsified rather than a request repeated.
 */
export type FabricPort = {
  /** Start the ticket's live task set for this decision. */
  readonly spawn: (delivery: Delivery) => void;
  /** Stop whatever the ticket has running. Succeeds when there is nothing. */
  readonly cancel: (delivery: Delivery) => void;
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
 * IT IS THE ONE PORT `subjectOf` DOES NOT ANSWER FOR, and the exception is
 * stated here because the fabric section states the formula. A cascade row's
 * first transition is the ticket the decision REVOKED, while its
 * `OpenHumanTask`s are that ticket's parked DEPENDENTS — so `subjectOf` on this
 * delivery names a ticket no desk task is being opened for. The tickets to open
 * for are read from the adapter's own view of what is newly parked, exactly as
 * the header's derived-view paragraph says and for its reason: pairing effects
 * with transitions by position would be a fact about how `decideRevoke` happens
 * to build two lists rather than anything the machine promises.
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
 * ORDERING. The header's, and this is the port the row-scoped half is about:
 * the revoke cascade is the one decision in the machine whose list is longer
 * than one, and its `OpenHumanTask`s — one per parked dependent — arrive within
 * that one drain in the order the cascade parked them, which is ascending
 * ticket id. They are distinct tasks for distinct tickets and nothing may merge
 * them. Across drains the cascade row may arrive again in full, which is the
 * header's second half and the reason the next paragraph is not optional.
 *
 * IDEMPOTENCE. Keyed exactly as `FabricPort` is, by `Delivery`'s pair, which is
 * what keeps the cascade's two identical effects two tasks while a re-emitted
 * cascade row stays two.
 */
export type DeskPort = {
  /** Open a desk task for the ticket this decision parked. */
  readonly openTask: (delivery: Delivery) => void;
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
 * ORDERING. The header's. Within a drain, arrivals reach this port in journal
 * order, which is arrival order, which is the order `decideArrive` minted the
 * ids in — so an adapter numbering drafts as they appear numbers them the way
 * the fleet did. Across drains that correspondence does not hold, and an
 * adapter that inferred an id from position rather than from the fleet would be
 * inferring it from how many times the process above it has crashed.
 *
 * IDEMPOTENCE. Keyed as the others are. A re-emitted arrival row shows the
 * author one draft, not two.
 */
export type AuthoringPort = {
  /** Show the author the draft this arrival created. */
  readonly createDraft: (delivery: Delivery) => void;
};

// ==========================================================================
// === Wrap-up ==============================================================
// ==========================================================================

/**
 * THE WRAP-UP PORT — the completion boundary a ticket's work crosses onto its
 * project.
 *
 * IT IS NAMED FOR THE ROUTE THE MODEL NAMES. Its three methods are the three
 * effects of `model/domain.qnt`'s wrap-up route, in the order that route takes
 * them — `EnqueueWrapUp`, `OpenGate`, `Complete` — and there is no Landing
 * phase, queue, route or boundary in the model for a port to be named after.
 * What the model has is `PWrapUp`, `PWrapUpHolding` and the completion
 * boundary `decideCompleteDuplicate` states, so those are the two words this
 * whole section is written in.
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
 *   decide whether a wrap-up is wanted. The machine owns mutual exclusion — it
 *   is the one thing it owns about a project — and it does not own git.
 *
 * WHERE IT MAY FAIL. All three may fail and signal by throwing, and the row
 * re-emits. `land` is the one where the difference between a throw and a denial
 * is expensive: a completion that succeeded and lost its acknowledgement will
 * be re-delivered, and only the idempotence promise below keeps the diff from
 * being applied twice. An implementation whose medium cannot absorb a
 * re-delivered completion under its key must make itself absorbable — by the
 * key this port already carries — before it can claim to implement this port.
 *
 * ORDERING, AND THIS PORT IS WHERE THE HEADER'S SECOND HALF BITES HARDEST.
 * Within a drain, `enqueue` precedes the `openGate` of the same ticket's
 * attempt and `land` follows whichever of them the route went through. ACROSS
 * DRAINS IT DOES NOT: a cursor that regressed past a completion re-sends that
 * ticket's `enqueue` and `openGate` AFTER its `land`, so the sequence a real
 * adapter sees can end with a ticket being queued for a wrap-up it has already
 * completed. Nothing is wrong when that happens — the journal's order never
 * moved, the drain is a window onto a prefix of it, and every one of those
 * deliveries is a redelivery under a key this port already holds. An
 * implementation that read a lifecycle out of arrival order would be reading
 * the crash history of the process above it, and would land a ticket twice the
 * first time one crashed. What IS true at any instant is that the three are
 * never concurrent for one ticket: there is one writer.
 *
 * IDEMPOTENCE. Keyed as the others are, and here the promise is load-bearing
 * rather than tidy: `noDuplicateCycle` says the world lands a ticket's diff at
 * most once across crashes at any seam, and the crash seam it survives is
 * exactly a `land` whose row was re-emitted.
 */
export type WrapUpPort = {
  /** Announce that this ticket wants its wrap-up. */
  readonly enqueue: (delivery: Delivery) => void;
  /** Start the wrap-up step behind the lease the machine granted. */
  readonly openGate: (delivery: Delivery) => void;
  /**
   * Publish this ticket's completion.
   *
   * THE ONE METHOD NOT SPELLED FROM ITS EFFECT — `enqueue` and `openGate` are
   * `EnqueueWrapUp` and `OpenGate` with this port's own name factored out; this
   * one answers `Complete` and is called `land`. The name is the model's rather
   * than this file's: `model/refinement.qnt` states `noDuplicateCycle` as "the
   * world LANDS a ticket's diff at most once, across crashes at any seam", and
   * this method is the act that theorem quantifies over. What the model retired
   * is `landing` as the name of a THING; the VERB it kept, and a reader who
   * greps the model for this one arrives at the theorem it has to keep.
   *
   * THE RETIREMENT WENT FURTHER AND THIS NAME STILL STANDS. Upstream PR #57
   * then renamed the model's own land-family IDENTIFIERS — its fixtures and
   * its witness runs — so `model/` no longer spells `land` in a name at all
   * except inside `quietProjectLandsCleanly`, which is this same verb. Every
   * other occurrence left in `model/` is prose about the act. That makes the
   * grep test above sharper rather than weaker: it now lands on the theorem
   * and on nothing else, and `noDuplicateCycle`'s sentence is unchanged by
   * #57. Re-check it there, not here, before renaming this method.
   */
  readonly land: (delivery: Delivery) => void;
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
  readonly wrapUp: WrapUpPort;
};

/**
 * Which port method the world was asked through — DERIVED from `Ports`, never
 * written beside it.
 *
 * `effect.ts`'s argument for a compiler-maintained copy, applied to the other
 * vocabulary this slice has: a method added to a port, a method removed, or a
 * fifth port added is a change to this union with no second edit, and a hand
 * roster that fell behind would leave a ledger unable to name what it recorded.
 * It names the METHODS rather than the effects, because an adapter is told what
 * to do and not what decision led to it.
 */
export type PortCall = {
  [P in keyof Ports]: keyof Ports[P] & string;
}[keyof Ports];
