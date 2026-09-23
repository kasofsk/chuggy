/// THE REFINEMENT LAYER — the journaled actor as a machine that refines
/// the domain machine.
///
/// The runtime shape is one single-writer actor holding all state and
/// making every decision, over a fabric that runs things and decides
/// nothing. This module models that shape AS a machine and proves it
/// refines the domain machine it embeds.
///
/// HOW A DECISION REACHES THE WORLD. Events ARE journal entries. Every
/// decision appends (seq, event) to a durable journal; the EXECUTOR is a
/// cursor (`applied`) consuming that journal in order and emitting each
/// entry's obligations toward the world; crash recovery replays the journal
/// into a fresh in-memory state by folding evolve over it and resumes the
/// cursor. Decisions flow decide -> journal -> cursor -> world. The seam
/// between recording a decision and effecting it is the atomicity this
/// module proves safe in one order (journal-then-effect) and demonstrates
/// unsafe in the other (effect-then-journal, which double-spends).
///
/// PLATFORM CAPTURE, the formal guard made concrete: the domain machine
/// (domain.qnt/ticket.qnt) contains NO vocabulary from this file — no
/// journal, no cursor, no crash, and no fabric. Every runtime shape must
/// refine the SAME machine: a controller/CRD shape, or a second fabric,
/// writes a SIBLING of this module — its own state, its own seams — and
/// re-proves these same obligations (its history projects to legal
/// domain traces; no double-spend across its crash seams) against the
/// byte-identical domain machine. The domain machine does not move; only
/// the refinement module is replaced. That is what lets the fabric be a
/// deployment choice rather than a core one.
///
/// SEVERABILITY: this file is layered ON the domain — nothing in
/// model/{ticket,domain}.qnt or the mc instances reads it, and no
/// earlier stage of the model gate does. Deleting refinement.qnt and its
/// tests leaves the rest of the model standing, except that domain.qnt
/// keeps its pure exports (the TicketGraph-parameterized enablement forms and
/// the installGraph seam), which the witness drivers use either way.
///
/// ==========================================================================
/// THE MACHINE
/// ==========================================================================
///
/// STATE. The actor's in-memory view of the domain ("mem") is the
/// EMBEDDED DOMAIN INSTANCE's own vars — tickets, lastStep and the
/// step-history ghost, imported below — so every domain invariant
/// (allInvariants) is checked against the actor's memory at every step
/// of every run in this file's harness. On top of it, this module's own
/// vars:
///
///   journal      : List[Entry] — THE DURABLE DECISION LOG, the only
///                  thing that survives a crash. An Entry is the EVENT the
///                  decision took plus a monotone sequence number. The
///                  event is what makes replay possible — evolve is pure and
///                  reads nothing else, so a replay re-decides nothing and
///                  consults no policy — and it is what conformance replays:
///                  journal rows are golden-trace steps (standing rule 4).
///   applied      : int — THE EXECUTOR CURSOR: how many journal entries'
///                  obligations have been emitted to the world. Deliberately
///                  NOT atomic with emission: a crash may lose cursor
///                  progress (crashRecover regresses it nondet), which
///                  re-emits a suffix — at-least-once toward the world,
///                  see the composition argument below.
///   worldEffects : Set[int] — WHAT THE WORLD RECEIVED, by decision
///                  identity (journal seq). A set, deliberately: emitting
///                  seq s twice is absorbed (union) — this is the model's
///                  form of "every obligation is idempotent, keyed by its
///                  decision" — the one thing the fabric is trusted to
///                  honour, given a key. Re-emission is REAL in the traces (the
///                  cursor re-covers ground); the set records that the
///                  world cannot be made to act twice on the SAME
///                  decision — only on distinct ones.
///   orphans      : List[TicketEvent] — decisions whose obligations the
///                  world received but the journal NEVER recorded: the
///                  effect-then-journal hazard's residue. Structurally
///                  empty under the disciplined step relation (only
///                  effectCrash appends). An orphan is un-keyed — no seq
///                  exists to dedupe it against the re-decided twin,
///                  which is exactly why it cannot be absorbed and why
///                  the discipline is load-bearing.
///   rlabel       : str — the refinement-layer step label ("actor-step" /
///                  "emit" / "crash-recover" / "effect-crash-recover"),
///                  trace visibility only (no invariant reads it).
///
/// THE SEAM MODEL. A decision passes through three points — (1) decided,
/// (2) journaled, (3) effected — and the actor may crash between any
/// two. The model collapses (1)-(2) into one atomic action
/// (journalStep) because the decide<->journal seam is UNOBSERVABLE: a
/// pure decision that dies before the journal has no footprint anywhere
/// — memory is lost, nothing was emitted — so the crashed run is
/// indistinguishable from the run where the actor never decided, and
/// the machine's nondeterminism already contains that run. The two
/// observable seams are modeled explicitly:
///
///   journal -> effect (THE CORRECT DISCIPLINE, step relation `rstep`):
///     crashRecover may fire AT ANY INSTANT — between journal and
///     emission (the entry survives, unemitted), mid-emission (the
///     cursor regresses; the suffix re-emits), or at rest. Recovery
///     replays the journal into fresh memory; recoveryComplete proves
///     the replay IS the lost memory, so a crash is invisible at the
///     domain grain — the domain vars do not move (installGraph), and
///     the only trace is possible re-emission, absorbed by identity.
///   effect -> journal (THE HAZARD, `rstepHazard` = rstep + effectCrash):
///     effectCrash is the one extra behavior an effect-first
///     implementation admits: decide, emit the obligations, crash BEFORE
///     the journal write. Memory is lost; recovery replays a journal that
///     never saw the decision — the book says it never happened, the
///     world already acted on it (orphans). The actor then legitimately
///     re-decides, re-emits: two task fan-outs for one journaled
///     decision (noDoubleSpentWork violated), or the same candidate
///     merged twice (noDuplicateCycle violated) — while the domain
///     machine, which sees only the journaled history, stays green on
///     every invariant. The hazard is kept reproducible by
///     CONFIGURATION of the step relation (rstepHazard), with the
///     deterministic expected-violation runs in
///     tests/chuggy_refinement_test.qnt as the gate.
///
/// THE ACTOR'S DECIDE STEP IS THE DOMAIN DECIDER — structurally. Every
/// actor action draws its picks from the domain's OWN enablement sets
/// (the same vals the domain's `step` draws from), and journalStep
/// executes `decide` = a total dispatch onto the domain's pure deciders,
/// guarded by `decisionEventEnabled` = the same enablement re-stated over an
/// explicit TicketGraph (the TicketGraph-parameterized forms hoisted into
/// domain.qnt — referenced, never copied), and then evolve. The actor cannot
/// journal an event the domain's deciders would not produce from its state:
/// refinement is structural. It is then ALSO stated as the checked
/// invariant journalLegal (below), so a mutant actor — or a tampered
/// journal — is caught by state predicate, not by construction argument.
///
/// ==========================================================================
/// THE THEOREMS (the PR gate), as implemented
/// ==========================================================================
///
///   1. REFINEMENT (journalLegal): every journaled history is one the
///      domain machine could have decided. Checked by replay: fold the
///      journal from the genesis TicketGraph; at each entry, (a) the
///      sequence number is the next in the monotone dense order, (b) the
///      ticket the event names stands at the replayed prefix state (a
///      TicketCreated's does not), and (c) the event MOVES that state —
///      evolve(prefix, event) != prefix. (c) is sound because the domain
///      proves a decided event is never the identity
///      (domain.qnt eventsNeverIdentity) and evolve is the identity on
///      every state that no longer owes an event, so "moved" is exactly
///      "owed" and nothing here restates evolve's guards. With every
///      non-actor step leaving the domain vars untouched, the domain-visible
///      trace of any disciplined run IS the journal's event sequence.
///   2. NO DOUBLE-SPENT WORK / NO DUPLICATE CYCLE ACROSS CRASHES
///      (noDoubleSpentWork, noDuplicateCycle, journalCoversWorld;
///      journalCompletionsMatchLedger is the journal-side half): under
///      journal-then-effect, crash/recover at ANY seam never runs more
///      work in the world than the journal recorded (per ticket:
///      distinct-decision work spawns emitted <= journaled work spawns)
///      and never lands one ticket's diff twice (distinct-decision
///      completion emissions <= 1). Obligations between the journal
///      position and the applied cursor are re-emitted — at-least-once
///      toward the world — but re-emission carries the SAME decision seq and
///      is absorbed by identity; the JOURNAL never gains a duplicate
///      decision (seqs are dense and each entry re-checks as a fresh
///      legal step; the ledger's completions ghost, capped at 1 by the
///      domain's completionExclusive, equals the journal's completion count).
///   3. RECOVERY COMPLETENESS (recoveryComplete): replay of the current
///      journal yields EXACTLY the domain state the actor holds — in
///      every reachable state, so every prefix of every run is covered
///      (each state's journal is that prefix, and the invariant holds
///      there). Determinism of replay is by PURITY: evolve is a pure
///      function of (TicketGraph, event), and every runtime shape reuses
///      it, which is precisely what makes the journal a sufficient basis for
///      recovery — and the incremental/batch agreement (replaying n+1
///      entries == evolving the n-entry replay once) is pinned as a unit
///      test (replayAppendAgreesTest).
///   4. THE DEMONSTRATION WITNESS (tests/chuggy_refinement_test.qnt,
///      chuggy_refinement_hazard_test): under effect-first, a crash
///      between effect and journal double-spends on recovery —
///      deterministic machine traces pin the dispatch double-spend (two
///      world task fan-outs, one journaled decision), the REWORK
///      double-spend (the rework fan-out launches, the decision is lost
///      with the crash, and the re-decided rework launches it again),
///      and the duplicate cycle (the same candidate
///      squash-merged twice, the journal showing one clean completion) —
///      each expected-violation step asserted alongside allInvariants,
///      because the domain machine CANNOT see the hazard: that blindness
///      is the argument that the refinement layer, not the domain, owns
///      this obligation.
///
/// ==========================================================================
/// THE COMPOSITION ARGUMENT (with the fabric's at-least-once)
/// ==========================================================================
///
/// Outbound (journal -> world): the fabric may deliver an emission more
/// than once and the executor may re-emit after cursor loss — both are
/// the SAME at-least-once, and both are absorbed because every emitted
/// obligation is keyed by its decision's journal seq (worldEffects' set
/// semantics IS that assumption, stated as a model primitive: "every
/// obligation is idempotent", given its key). Inbound completion and wrap-up
/// redelivery is absorbed by durable request identity before a decision
/// input is constructed. The composition absorbs at-least-once delivery on
/// both sides below TicketGraph; what neither can absorb is an UN-KEYED
/// obligation — a decision that reached the world but never the journal —
/// and that is exactly the orphan the discipline forbids.
///
/// ==========================================================================
/// SCALE DISCIPLINE + the journal bound
/// ==========================================================================
///
/// This module embeds the domain machine, so its state space is the
/// domain's TIMES the journal — the instance is fixed TINY, at the
/// smallest consts that exercise a REWORK (a rework is where the
/// double-spend bites: it is the re-entry that launches work again):
/// N_TICKETS = 2 (dependencies stay expressible), N_TASKS = 1 (singleton
/// rosters), MAX_STAGES = 1 (one stage is enough to fail; the stage advance
/// is the domain instance's coverage, not the seam's). The wrap-up's
/// invalidated draw still exercises both paths.
///
/// THE JOURNAL BOUND, honestly: the journal grows by one entry per
/// decision, forever retained, and nothing reads it but replay (like a
/// ticket's evaluation instances: append-only provenance). Its length is
/// bounded by
/// nothing in this model: a run's decisions are bounded by the authors
/// who release and the operators who resume, which is where this machine
/// deliberately stops. An implementation compacts by snapshot; snapshots
/// are an implementation concern (a snapshot is a replay prefix, sound by
/// recoveryComplete) and are not modeled.
///
/// ==========================================================================
/// Quint 0.32 notes (hard-won; do not "simplify" these away)
/// ==========================================================================
///   - This module is CONCRETE (no consts): nested const-forwarding
///     through a stateful instance breaks at evaluation (exported
///     instance defs lose their var bindings), so the domain instance is
///     instantiated here directly, mc-module style, and the two
///     disciplines are STEP RELATIONS (rstep / rstepHazard) rather than
///     a const — `quint run --init=rinit --step=<relation>` selects one.
///   - The importing module cannot assign the instance's vars from its
///     own expressions (evaluator: "Variable not set"); every write to
///     the domain vars below therefore routes through the domain's own
///     actions — `apply` for actor steps (ghost snapshots: a real domain
///     step), `installGraph` for executor/crash steps (ghost stale: not
///     a domain step; see its header in domain.qnt).
///   - Imports are not re-exported: downstream modules (the tests) see
///     this module's OWN defs only, so the handful of domain-instance
///     names the tests assert on are re-exposed as wrapper vals at the
///     bottom (allDomainInvariants, memGraph, obs).
///   - Invariants live with the vars they read: the domain's inside
///     chuggy_domain, this layer's here (they read journal/applied/
///     worldEffects/orphans, declared here).
module chuggy_refinement {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "./ticket"

  /// The embedded domain machine — the actor's in-memory state IS this
  /// instance's vars. Consts per the scale-discipline note above.
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 1,
    MAX_STAGES = 1
  ).* from "./domain"

  // ==========================================================================
  // === Vocabulary ===========================================================
  // ==========================================================================

  /// THE DECISION EVENT — the decider's INPUT: which decider, at which
  /// named picks, one constructor per domain action and its payload exactly
  /// the action's nondet draws but the policy (the witness-driver discipline
  /// as data). The inbox holds these; the journal holds what `decide` makes
  /// of them, so none of these is ever replayed.
  type DecisionEvent =
      CreateTicket(ReleasedTicket)
    | Revoke(int)
    | Dispatch({ ticket: int, source: int })
    | TaskDone({ ticket: int, task: TaskIdentity, report: TaskTerminalReport })
    | FinalizationResult({ ticket: int, out: FinalizationOutcome,
        evidence: int })
    | ResumeTicket(int)

  /// One journal row: monotone dense seq (entry i carries seq i+1 —
  /// journalLegal checks it) and the event the decision took.
  type Entry = { seq: int, event: TicketEvent }

  /// The journal's base state: the machine's init fleet — empty (domain
  /// init: tickets' = Map()). Replay starts here; entry 1's event must name
  /// a ticket that is not here yet (a release — nothing else can move an
  /// empty fleet, which journalLegal then enforces for free).
  pure val genesis: TicketGraph = { tickets: Map() }

  // ==========================================================================
  // === Decide and replay (pure — this is the payoff) =======================
  // ==========================================================================

  /// Total dispatch onto the domain's pure deciders — THE actor's decide
  /// step. The policy is asked only by a completion that concludes a failing
  /// stage, and the event it returns names the edge taken, so nothing after
  /// this ever asks it again.
  pure def decide(
      c: TicketGraph, event: DecisionEvent,
      failurePolicy: EvaluationFailurePolicy): SuccessfulTicketDecision =
    match event {
      | CreateTicket(definition) => decideReleaseTicket(c, definition)
      | Revoke(j) => decideRevoke(c, j)
      | Dispatch(a) => decideDispatch(c, a.ticket, a.source)
      | TaskDone(a) =>
        decideTaskDone(c, a.ticket, a.task, a.report, failurePolicy)
      | FinalizationResult(a) =>
        decideFinalizationResult(c, a.ticket, a.out, a.evidence)
      | ResumeTicket(j) => decideResumeTicket(c, j)
    }

  /// The decision's enablement at an explicit TicketGraph — per constructor,
  /// exactly the domain action's guard + draw-set membership, each
  /// conjunct a REFERENCE to the definition the domain action reads
  /// (the TicketGraph-parameterized forms hoisted into domain.qnt; the m6
  /// audit rule: nothing here is a copied expression). Conjoined by
  /// journalStep: the actor cannot journal a refused decision.
  pure def decisionEventEnabled(
      c: TicketGraph, event: DecisionEvent): bool = match event {
    | CreateTicket(definition) => and {
        canReleaseIn(c, definition.id),
        definition.dependencies.subseteq(dependableIn(c)),
        releasedTicketValid(definition)
      }
    | Revoke(j) => revocablesIn(c).contains(j)
    | Dispatch(a) => readiesIn(c).contains(a.ticket) and
        dispatchSources.contains(a.source)
    | TaskDone(a) => and {
        completableIn(c).contains(a.ticket),
        liveTasks(c.tickets.get(a.ticket)).contains(a.task),
        reportMatchesTask(c.tickets.get(a.ticket), a.task, a.report),
        reportValid(a.report)
      }
    | FinalizationResult(a) => c.tickets.keys().contains(a.ticket) and
        finalizationOutcomes.contains(a.out) and
        finalizationEvidences.contains(a.evidence) and
        finalizationOutcomeEnabled(c, a.ticket, a.out)
    | ResumeTicket(j) => retryablesIn(c).contains(j)
  }

  /// RECOVERY: replay the journal into a fresh in-memory state by folding
  /// evolve over its events. Deterministic by purity (evolve is a pure
  /// function; the fold has one result) — theorem 3's mechanism.
  pure def replayGraph(jl: List[Entry]): TicketGraph =
    jl.foldl(genesis, (c, e) => evolve(c, e.event))

  /// Does the ticket an event names stand where the event would apply? A
  /// release names one that must not exist yet; every other event names one
  /// that must.
  pure def eventTicketStands(c: TicketGraph, fact: TicketEvent): bool =
    match fact {
      | TicketCreated(definition) => not(c.tickets.keys().contains(definition.id))
      | _ => c.tickets.keys().contains(eventTicket(fact))
    }

  /// THEOREM 1's checker: the journaled history is one the machine could
  /// have decided. One fold, three checks per entry at the replayed prefix
  /// state — dense monotone seq, the event's ticket standing, and the event
  /// moving the state — chaining the evolved state as the next prefix.
  pure def journalLegalOn(jl: List[Entry]): bool =
    jl.foldl({ ok: true, st: genesis, n: 0 }, (acc, e) =>
      if (not(acc.ok) or e.seq != acc.n + 1 or
          not(eventTicketStands(acc.st, e.event)))
        { ok: false, st: acc.st, n: acc.n + 1 }
      else
        val evolved = evolve(acc.st, e.event)
        { ok: evolved != acc.st, st: evolved, n: acc.n + 1 })
    .ok

  // ==========================================================================
  // === World accounting (pure) ==============================================
  // ==========================================================================
  // What the world DOES with an emission is trusted fabric; what the
  // theorems need is arithmetic over which DECISIONS reached it. A work
  // spawn is a decision whose event starts a work cycle — and so owes the
  // cycle's ExecuteTask (dispatch, both reworks, the work resume); a
  // completion lands the ticket's diff (the finalization success). Each is
  // attributed to the ticket its event names.

  /// Does this event start a work cycle for ticket j?
  pure def isSpawnFor(fact: TicketEvent, j: int): bool =
    eventTicket(fact) == j and match fact {
      | TicketDispatched(_) => true
      | TicketWorkResumed(_) => true
      | TicketEvaluationReworkStarted(_) => true
      | TicketFinalizationNeedsWork(_) => true
      | _ => false
    }

  /// Does this event land ticket j's diff?
  pure def isCompletionFor(fact: TicketEvent, j: int): bool =
    eventTicket(fact) == j and match fact {
      | TicketFinalizationSucceeded(_) => true
      | _ => false
    }

  /// Distinct-decision spawn emissions the world received for ticket j:
  /// journaled entries whose seq was emitted at least once (re-emission
  /// of a seq is the same decision — absorbed), plus every orphan (each
  /// orphan IS a distinct decision: it has no seq to absorb against).
  pure def worldSpawnsOn(
      jl: List[Entry], we: Set[int], orph: List[TicketEvent], j: int): int =
    jl.indices().filter(i => we.contains(i + 1) and isSpawnFor(jl[i].event, j)).size()
      + orph.indices().filter(i => isSpawnFor(orph[i], j)).size()

  pure def worldCompletionsOn(
      jl: List[Entry], we: Set[int], orph: List[TicketEvent], j: int): int =
    jl.indices().filter(i => we.contains(i + 1) and isCompletionFor(jl[i].event, j)).size()
      + orph.indices().filter(i => isCompletionFor(orph[i], j)).size()

  /// The journal-side counts: spawn/completion DECISIONS recorded (whether
  /// emitted yet or not) — the book the world must never exceed.
  pure def journalSpawnsOn(jl: List[Entry], j: int): int =
    jl.indices().filter(i => isSpawnFor(jl[i].event, j)).size()
  pure def journalCompletionsOn(jl: List[Entry], j: int): int =
    jl.indices().filter(i => isCompletionFor(jl[i].event, j)).size()

  // ==========================================================================
  // === State ================================================================
  // ==========================================================================

  var journal: List[Entry]
  var applied: int
  var worldEffects: Set[int]
  var orphans: List[TicketEvent]
  var rlabel: str

  // Per-ticket world/journal counts over the live vars (test-visible).
  def worldSpawns(j: int): int = worldSpawnsOn(journal, worldEffects, orphans, j)
  def worldCompletions(j: int): int = worldCompletionsOn(journal, worldEffects, orphans, j)
  def journalSpawns(j: int): int = journalSpawnsOn(journal, j)
  def journalCompletions(j: int): int = journalCompletionsOn(journal, j)

  // ==========================================================================
  // === Actions ==============================================================
  // ==========================================================================

  action rinit = all {
    init,
    journal' = [],
    applied' = 0,
    worldEffects' = Set(),
    orphans' = [],
    rlabel' = "init"
  }

  /// THE ACTOR'S STEP: decide + journal, atomically (the decide<->journal
  /// seam is unobservable — header). The decision is the domain decider
  /// at the named picks (decide), refused unless enabled
  /// (decisionEventEnabled — so the machine structurally cannot journal an
  /// illegal decision), with the failing stage's edge the one `onFailure`
  /// names; `apply` evolves memory by the event and records the decision (a
  /// REAL domain step: the ghost snapshots), and the entry appends with the
  /// next dense seq. No emission here: the executor cursor lags
  /// (journal-then-effect). Doubles as the deterministic witness driver
  /// (tests pass explicit commands; the actor* actions below are the same
  /// step with the picks drawn nondet).
  action journalStep(
      event: DecisionEvent, onFailure: EvaluationFailureDisposition): bool =
    val d = decide(graph, event, _ => onFailure)
    all {
      decisionEventEnabled(graph, event),
      apply(d),
      journal' = journal.append({ seq: journal.length() + 1, event: d.event }),
      applied' = applied,
      worldEffects' = worldEffects,
      orphans' = orphans,
      rlabel' = "actor-step"
    }

  /// THE EXECUTOR: emit the next unemitted journal entry's obligations to
  /// the world (cursor advance; entry at index `applied` carries seq
  /// applied + 1). The union absorbs a re-emission — same seq, same
  /// decision, the world's idempotency key (composition argument in the
  /// header). Not a domain step: installGraph keeps the domain vars and
  /// ghost exactly in place.
  action emitNext = all {
    applied < journal.length(),
    installGraph(graph),
    journal' = journal,
    applied' = applied + 1,
    worldEffects' = worldEffects.union(Set(applied + 1)),
    orphans' = orphans,
    rlabel' = "emit"
  }

  /// CRASH + RECOVERY at a pinned cursor point (the deterministic
  /// driver; crashRecover below draws the point nondet). The actor dies
  /// AT ANY INSTANT and comes back with: memory = replay(journal) — the
  /// genuine reconstruction; by recoveryComplete this equals the state
  /// it lost, so the domain vars do not move (installGraph) — and the
  /// executor cursor regressed to any a <= applied (the cursor's own
  /// durability lags emission; the lost suffix will RE-emit, absorbed by
  /// seq). The journal is the one thing that neither moves nor lies.
  action crashRecoverTo(a: int): bool = all {
    a >= 0,
    a <= applied,
    installGraph(replayGraph(journal)),
    journal' = journal,
    applied' = a,
    worldEffects' = worldEffects,
    orphans' = orphans,
    rlabel' = "crash-recover"
  }

  /// The crash at any seam: cursor regression drawn nondet (0 = the
  /// checkpoint was never written; applied = the checkpoint was current).
  /// Always enabled — a crash needs no permission — which also keeps
  /// every run deadlock-free without a settle stutter.
  action crashRecover = all {
    nondet a = 0.to(applied).oneOf()
    crashRecoverTo(a)
  }

  /// THE HAZARD SEAM (theorem 4; step relation rstepHazard only): the
  /// effect-then-journal ordering's crash — decide, EMIT THE OBLIGATIONS,
  /// die before the journal write. The world keeps the decision as an
  /// un-keyed orphan; the journal never learns; recovered memory =
  /// replay(journal) = the pre-decision state (the decision was lost
  /// with memory — the domain vars, which by recoveryComplete already
  /// equal that replay, do not move). Every domain invariant keeps
  /// holding across this step — the domain machine is BLIND to the
  /// hazard, which is the whole reason this layer exists.
  action effectCrash(
      event: DecisionEvent, onFailure: EvaluationFailureDisposition): bool =
    val d = decide(graph, event, _ => onFailure)
    all {
      decisionEventEnabled(graph, event),
      installGraph(replayGraph(journal)),
      journal' = journal,
      applied' = applied,
      worldEffects' = worldEffects,
      orphans' = orphans.append(d.event),
      rlabel' = "effect-crash-recover"
    }

  // --- The actor roster: the domain actions, journaled ----------------------
  // Each mirrors its domain action byte-for-byte in guard + draws (the
  // same enablement vals, the same oneOf sets) and routes through
  // journalStep. The domain's own actions are unusable as steps here —
  // they assign none of this module's vars — so the machine structurally
  // cannot bypass the actor: every domain step in any run of this
  // module is a journaled decision. (`settle` has no counterpart: it is
  // simulator plumbing, not a decision, and crashRecover already keeps
  // runs deadlock-free.)

  action actorReleaseTicket = all {
    releasableIds.size() > 0,
    nondet j = releasableIds.oneOf()
    nondet dependencies_ = dependableTickets.powerset().oneOf()
    nondet stages = validPlans.oneOf()
    journalStep(CreateTicket(releasedTicketOf(j, dependencies_, stages)),
      ReworkEvaluationFailure)
  }
  action actorRevoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    journalStep(Revoke(j), ReworkEvaluationFailure)
  }
  action actorDispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    nondet source = dispatchSources.oneOf()
    journalStep(Dispatch({ ticket: j, source: source }),
      ReworkEvaluationFailure)
  }
  action actorTaskDone = all {
    completableTickets.size() > 0,
    nondet j = completableTickets.oneOf()
    nondet task = liveTasks(graph.tickets.get(j)).oneOf()
    nondet report = reportChoices(graph.tickets.get(j), task).oneOf()
    nondet onFailure = dispositionChoices.oneOf()
    journalStep(TaskDone({ ticket: j, task: task, report: report }),
      onFailure)
  }
  action actorFinalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet out = finalizationOutcomes.oneOf()
    nondet evidence = finalizationEvidences.oneOf()
    journalStep(FinalizationResult({ ticket: j, out: out,
      evidence: evidence }), ReworkEvaluationFailure)
  }

  action actorResumeTicket = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    journalStep(ResumeTicket(j), ReworkEvaluationFailure)
  }

  // --- The hazard roster (rstepHazard only): the effect-first seam on ------
  // the world-effect-bearing decisions. The seam exists at EVERY
  // decision; these are the ones whose orphaned obligations the
  // theorems count — the spawns (dispatch, the completion that reworks a
  // failed stage, the finalization failure's respawn) and the wrap-up
  // resolutions. An orphaned decision that owes nothing counted is the same
  // shape with nothing counted riding it — journalCoversWorld still flags
  // it; the demonstration keeps to the shapes the theorems name.

  action hazardDispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    nondet source = dispatchSources.oneOf()
    effectCrash(Dispatch({ ticket: j, source: source }),
      ReworkEvaluationFailure)
  }
  action hazardTaskDone = all {
    completableTickets.size() > 0,
    nondet j = completableTickets.oneOf()
    nondet task = liveTasks(graph.tickets.get(j)).oneOf()
    nondet report = reportChoices(graph.tickets.get(j), task).oneOf()
    nondet onFailure = dispositionChoices.oneOf()
    effectCrash(TaskDone({ ticket: j, task: task, report: report }),
      onFailure)
  }
  action hazardFinalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet out = finalizationOutcomes.oneOf()
    nondet evidence = finalizationEvidences.oneOf()
    effectCrash(FinalizationResult({ ticket: j, out: out,
      evidence: evidence }), ReworkEvaluationFailure)
  }

  /// THE DISCIPLINED MACHINE (journal-then-effect): decisions journal
  /// before anything reaches the world; crashes at any instant.
  action rstep = any {
    actorReleaseTicket, actorRevoke, actorDispatch,
    actorTaskDone, actorFinalizationResult,
    actorResumeTicket,
    emitNext, crashRecover
  }

  /// THE HAZARD MACHINE: everything the disciplined machine does, PLUS
  /// the one seam the discipline forbids. The delta between the two
  /// relations IS the discipline — and the expected-violation runs show
  /// that single delta breaking the theorems.
  action rstepHazard = any {
    rstep,
    hazardDispatch, hazardTaskDone, hazardFinalizationResult
  }

  // ==========================================================================
  // === Invariants (this layer's — the domain's live in chuggy_domain) ======
  // ==========================================================================

  /// THEOREM 1 — REFINEMENT: the journal is a legal domain history (dense
  /// seqs, every event's ticket standing at its replayed prefix, every
  /// event moving it). See journalLegalOn.
  val journalLegal: bool = journalLegalOn(journal)

  /// THEOREM 3 — RECOVERY COMPLETENESS: replay of the current journal is
  /// exactly the actor's in-memory state, in every reachable state (so
  /// for every prefix of every run). The crash actions genuinely install
  /// the replay; this invariant is what makes that installation a no-op
  /// on the domain vars.
  val recoveryComplete: bool = replayGraph(journal) == graph

  /// The executor's bookkeeping is sound: the cursor stays inside the
  /// journal, and the world's received-seq set is exactly the emitted
  /// prefix 1..high-water-mark (emission is in journal order; regression
  /// re-covers, never skips) and never names an unjournaled seq.
  val executorSound: bool = and {
    applied >= 0,
    applied <= journal.length(),
    worldEffects == 1.to(worldEffects.size()),
    worldEffects.size() <= journal.length()
  }

  /// THE DISCIPLINE CLAIM, coverage half: every obligation the world ever
  /// received traces to a journaled decision — no orphans. Structural
  /// under rstep (only effectCrash appends); the FIRST invariant to fall
  /// under the hazard, on the very crash step.
  val journalCoversWorld: bool = orphans.length() == 0

  /// THEOREM 2, work half — NO DOUBLE-SPENT WORK across crashes: the
  /// world never runs more work for a ticket than the journal recorded
  /// (re-emissions are the same decision, absorbed by seq). Under the
  /// hazard, an orphaned spawn is a task fan-out the book never recorded
  /// — the flows-analysis double-spend.
  val noDoubleSpentWork: bool = liveTickets.forall(j =>
    worldSpawns(j) <= journalSpawns(j))

  /// THEOREM 2, cycle half — NO DUPLICATE CYCLE: the world lands a
  /// ticket's diff at most once, across crashes at any seam.
  val noDuplicateCycle: bool = liveTickets.forall(j =>
    worldCompletions(j) <= 1)

  /// Theorem 2's journal half, stated as the ledger bridge: the
  /// journal's completion count per ticket IS the domain's completions ghost —
  /// which the domain's completionExclusive (checked live on the embedded
  /// instance) caps at one. The journal cannot gain a duplicate completion
  /// decision without the ledger disagreeing. (State-wise a corollary of
  /// journalLegal + recoveryComplete — the same stated-corollary
  /// treatment as revokedNeverCompletes.)
  val journalCompletionsMatchLedger: bool = liveTickets.forall(j =>
    journalCompletions(j) == tickets.get(j).completions)

  /// The discipline-INDEPENDENT core: holds under rstep AND rstepHazard
  /// (the hazard corrupts the world, never the journal or the replay).
  val refinementCore: bool = and {
    journalLegal,
    recoveryComplete,
    executorSound,
    journalCompletionsMatchLedger
  }

  /// The full journal-then-effect gate: the core plus the three
  /// world-facing theorems. Green under rstep; the expected violations
  /// under rstepHazard (tests/chuggy_refinement_test.qnt, deterministic;
  /// the model gate's pinned-seed probe is the trace-space side).
  val refinementInvariants: bool = and {
    refinementCore,
    journalCoversWorld,
    noDoubleSpentWork,
    noDuplicateCycle
  }

  // ==========================================================================
  // === Re-exposure wrappers (imports are not re-exported — header note) ====
  // ==========================================================================

  /// The embedded domain machine's full invariant bundle, checked
  /// against the actor's in-memory state.
  val allDomainInvariants: bool = allInvariants
  /// The actor's in-memory view (the embedded instance's TicketGraph).
  val memGraph: TicketGraph = graph
  /// The embedded machine's evolve, for the suites that replay by hand.
  pure def evolveGraph(c: TicketGraph, event: TicketEvent): TicketGraph =
    evolve(c, event)
  /// The embedded machine's name for an event's constructor.
  pure def eventNameOf(event: TicketEvent): str = eventName(event)
  /// The last DOMAIN decision (stale across emit/crash steps — those are
  /// not domain steps; rlabel carries this layer's trace).
  val obs: LastDecision = lastStep
}
