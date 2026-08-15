/// THE REFINEMENT LAYER — the journaled actor as a machine that refines
/// the domain machine.
///
/// The runtime shape is one single-writer actor holding all state and
/// making every decision, over a fabric that runs things and decides
/// nothing. This module models that shape AS a machine and proves it
/// refines the domain machine it embeds.
///
/// HOW A DECISION REACHES THE WORLD. Decision events ARE journal
/// entries. Every decision appends (seq, decision-event, StepRecord) to
/// a durable journal; the EXECUTOR is a cursor (`applied`) consuming
/// that journal in order and emitting each entry's effects toward the
/// world; crash recovery replays the journal into a fresh in-memory
/// state and resumes the cursor. Decisions flow decide -> journal ->
/// cursor -> world. The seam between recording a decision and effecting
/// it is the atomicity this module proves safe in one order
/// (journal-then-effect) and demonstrates unsafe in the other
/// (effect-then-journal, which double-spends).
///
/// PLATFORM CAPTURE, the formal guard made concrete: the domain machine
/// (domain.qnt/measure.qnt) contains NO vocabulary from this file — no
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
/// model/{measure,domain}.qnt or the mc instances reads it, and no
/// earlier stage of the model gate does. Deleting refinement.qnt and its
/// tests leaves the rest of the model standing, except that domain.qnt
/// keeps its pure exports (the Core-parameterized enablement forms and
/// the installCore seam), which the witness drivers use either way.
///
/// ==========================================================================
/// THE MACHINE
/// ==========================================================================
///
/// STATE. The actor's in-memory view of the domain ("mem") is the
/// EMBEDDED DOMAIN INSTANCE's own vars — tickets/lastStep and the two
/// step-history ghosts, imported below — so every domain invariant
/// (allInvariants) is checked against the actor's memory at every step
/// of every run in this file's harness. On top of it, this module's own
/// vars:
///
///   journal      : List[Entry] — THE DURABLE DECISION LOG, the only
///                  thing that survives a crash. An Entry is the domain
///                  StepRecord plus a monotone sequence number plus the
///                  DECISION EVENT itself (`cmd`: which decider, at which
///                  named picks — the witness-driver discipline as data).
///                  The cmd is what makes replay possible (the deciders
///                  are pure; the picks must be recorded); the rec is
///                  what the executor emits and what conformance
///                  replays — journal rows are golden-trace steps
///                  (standing rule 4). An implementation may derive rec
///                  from cmd at read time; the model stores both and
///                  proves them consistent (journalLegal).
///   applied      : int — THE EXECUTOR CURSOR: how many journal entries'
///                  effects have been emitted to the world. Deliberately
///                  NOT atomic with emission: a crash may lose cursor
///                  progress (crashRecover regresses it nondet), which
///                  re-emits a suffix — at-least-once toward the world,
///                  see the composition argument below.
///   worldEffects : Set[int] — WHAT THE WORLD RECEIVED, by decision
///                  identity (journal seq). A set, deliberately: emitting
///                  seq s twice is absorbed (union) — this is the model's
///                  form of "every effect is idempotent, keyed by its
///                  decision" — the one thing the fabric is trusted to
///                  honour, given a key. Re-emission is REAL in the traces (the
///                  cursor re-covers ground); the set records that the
///                  world cannot be made to act twice on the SAME
///                  decision — only on distinct ones.
///   orphans      : List[StepRecord] — effects the world received from
///                  decisions the journal NEVER recorded: the
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
///     domain grain — the domain vars do not move (installCore), and
///     the only trace is possible re-emission, absorbed by identity.
///   effect -> journal (THE HAZARD, `rstepHazard` = rstep + effectCrash):
///     effectCrash is the one extra behavior an effect-first
///     implementation admits: decide, emit the effects, crash BEFORE the
///     journal write. Memory is lost; recovery replays a journal that
///     never saw the decision — the book says it never happened, the
///     world already acted on it (orphans). The actor then legitimately
///     re-decides, re-charges, re-emits: two Jobs for one journaled
///     charge (noDoubleSpentBudget violated), or the same candidate
///     merged twice (noDuplicateCycle violated) — while the domain
///     machine, which sees only the journaled history, stays green on
///     every invariant. The hazard is kept reproducible by
///     CONFIGURATION of the step relation (the house pattern: the
///     livelock is a RetryFree instance; the double-spend is the
///     rstepHazard relation), with the deterministic expected-violation
///     runs in tests/chuggy_refinement_test.qnt as the gate.
///
/// THE ACTOR'S DECIDE STEP IS THE DOMAIN DECIDER — structurally. Every
/// actor action draws its picks from the domain's OWN enablement sets
/// (the same vals the domain's `step` draws from), and journalStep
/// executes `execCmd` = a total dispatch onto the domain's pure
/// deciders, guarded by `cmdEnabled` = the same enablement re-stated
/// over an explicit Core (the Core-parameterized forms hoisted into
/// domain.qnt — referenced, never copied). The actor cannot journal a
/// decision the domain's deciders would not produce from its state:
/// refinement is structural. It is then ALSO stated as the checked
/// invariant journalLegal (below), so a mutant actor — or a tampered
/// journal — is caught by state predicate, not by construction argument.
///
/// ==========================================================================
/// THE FOUR THEOREMS (the PR gate), as implemented
/// ==========================================================================
///
///   1. REFINEMENT (journalLegal): every journaled history projects to a
///      legal domain-machine trace. Checked by replay: fold the journal
///      from the genesis Core; at each entry, (a) the sequence number is
///      the next in the monotone dense order, (b) the decision was
///      ENABLED at the replayed prefix state (cmdEnabled — the domain's
///      own guards), and (c) the domain decider at the recorded picks
///      reproduces the recorded StepRecord EXACTLY (execCmd(st, cmd).rec
///      == rec). With every non-actor step leaving the domain vars
///      untouched, the domain-visible trace of any disciplined run IS
///      the journal's record sequence — the projection is the identity
///      on decisions.
///   2. NO DOUBLE-SPENT BUDGET / NO DUPLICATE CYCLE ACROSS CRASHES
///      (noDoubleSpentBudget, noDuplicateCycle, journalCoversWorld;
///      journalCompletionsMatchLedger is the journal-side half): under
///      journal-then-effect, crash/recover at ANY seam never runs more
///      paid work in the world than the journal charged (per ticket:
///      distinct-decision spawn emissions <= journaled spawn decisions)
///      and never lands one ticket's diff twice (distinct-decision
///      completion emissions <= 1). Effects between the journal position
///      and the applied cursor are re-emitted — at-least-once toward the
///      world — but re-emission carries the SAME decision seq and is
///      absorbed by identity; the JOURNAL never gains a duplicate
///      decision (seqs are dense and each entry re-checks as a fresh
///      legal step; the ledger's completions ghost, capped at 1 by the
///      domain's completionExclusive, equals the journal's completion count).
///   3. RECOVERY COMPLETENESS (recoveryComplete): replay of the current
///      journal yields EXACTLY the domain state the actor holds — in
///      every reachable state, so every prefix of every run is covered
///      (each state's journal is that prefix, and the invariant holds
///      there). Determinism of replay is by PURITY: the deciders are
///      pure functions of (Core, picks), and every runtime shape reuses
///      those same deciders, which is precisely what makes the journal a
///      sufficient basis for recovery — and the incremental/batch
///      agreement (replaying n+1 entries == stepping the n-entry replay
///      once) is pinned as a unit test (replayAppendAgreesTest).
///   4. THE DEMONSTRATION WITNESS (tests/chuggy_refinement_test.qnt,
///      chuggy_refinement_hazard_test): under effect-first, a crash
///      between effect and journal double-spends on recovery —
///      deterministic machine traces pin the dispatch double-spend (two
///      world task fan-outs, one journaled gas charge), the REWORK
///      double-spend (the rework fan-out launches, the
///      charge is lost with the crash, the re-decided rework charges
///      once for two Jobs), and the duplicate cycle (the same candidate
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
/// effect is keyed by its decision's journal seq (worldEffects' set
/// semantics IS that assumption, stated as a model primitive: "every
/// effect is idempotent", given its key). Inbound (world -> actor): completions
/// and landing confirmations arrive at-least-once too, and the DOMAIN
/// machine already absorbs them — duplicate task completions no-op by
/// identity, duplicate landing deliveries no-op at the boundary
/// (decideTaskDone/decideCompleteDuplicate, proved since /) — so the
/// actor journals the absorbing no-op decisions like any others and
/// replay reproduces them. The composition: at-least-once OUT is
/// absorbed by decision identity, at-least-once IN by the domain's
/// existing duplicate tolerance; what neither can absorb is an UN-KEYED
/// effect — a decision that reached the world but never the journal —
/// and that is exactly the orphan the discipline forbids.
///
/// ==========================================================================
/// SCALE DISCIPLINE + the journal bound
/// ==========================================================================
///
/// This module embeds the domain machine, so its state space is the
/// domain's TIMES the journal — the instance is fixed TINY, at the
/// smallest consts that exercise a REWORK (a rework is where the
/// double-spend bites: it is the re-entry that charges): N_TICKETS = 2
/// (deps/grouping stay expressible), N_TASKS = 1 (singleton task sets),
/// RWBudget(1) + GAS = 3 (dispatch + one eval rework + one gate rework
/// all affordable, walls reachable), Budgeted(1), RetryCharged (the
/// default metering), MAX_STAGES = 1 / N_REPOS = 1
/// (staging and multi-repo are orthogonal to the seam —
/// each collapses to its documented degeneration; the landing's
/// invalidated draw still exercises both paths). Unlike the mc
/// instances there is no per-pricing spread: the seam model reads no
/// account, so one pricing suffices — the domain instances keep that
/// coverage.
///
/// THE JOURNAL BOUND, honestly: the journal grows by one entry per
/// decision, forever retained — the measure NEVER reads it (like
/// Ticket.record: append-only provenance, it could only climb). Its
/// length is finite under EXACTLY the conditions the per-ticket liveness
/// sketch is stated under (measure.qnt header): non-exempt decisions are
/// bounded by descent of the finite measure; AUTHORING rows by
/// the arrival cap; STUTTER rows (journaled duplicate-absorptions) by
/// the fabric's finitely-many-duplicates assumption; CHURN rows are
/// bounded under RetryCharged (this instance's metering) and unbounded
/// under RetryFree — the same conditionality, inherited, not new. An
/// implementation compacts by snapshot; snapshots are an implementation
/// concern (a snapshot is a replay prefix, sound by recoveryComplete)
/// and are not modeled.
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
///     actions — `apply` for actor steps (ghosts snapshot: a real domain
///     step), `installCore` for executor/crash steps (ghosts stale: not
///     a domain step; see its header in domain.qnt).
///   - Imports are not re-exported: downstream modules (the tests) see
///     this module's OWN defs only, so the handful of domain-instance
///     names the tests assert on are re-exposed as wrapper vals at the
///     bottom (allDomainInvariants, memCore, obs, measureNow,
///     measurePrev).
///   - Invariants live with the vars they read: the domain's inside
///     chuggy_domain, this layer's here (they read journal/applied/
///     worldEffects/orphans, declared here).
module chuggy_refinement {
  import chuggy_measure.* from "./measure"

  /// The embedded domain machine — the actor's in-memory state IS this
  /// instance's vars. Consts per the scale-discipline note above.
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 1,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 1,
    N_REPOS = 1
  ).* from "./domain"

  // ==========================================================================
  // === Vocabulary ===========================================================
  // ==========================================================================
  // One constructor namespace per module: the J prefix (Journal) marks
  // the decision-event constructors; the imported vocabulary already
  // holds P/T/TK/TS/V/R/Rs/C/RW/Land/LO/B.

  /// THE DECISION EVENT: which decider, at which named picks — one
  /// constructor per domain action, payload exactly the action's nondet
  /// draws (the witness-driver discipline as journal data). This is what
  /// a real journal row must carry for replay to work: the deciders are
  /// pure, so (Core, picks) determines everything; the picks are the
  /// only information the crash could lose.
  type Cmd =
      JArrive({ deps: Set[int], prog: List[Stage], repo: int, wrapUp: WrapUp })
    | JRelease(int)
    | JRevoke(int)
    | JDispatch(int)
    | JTaskDone({ ticket: int, tid: int, verdict: Verdict })
    | JWorkReduce(int)
    | JEvalReduce(int)
    | JDequeue({ ticket: int, moved: bool })
    | JGateResolve({ ticket: int, out: WrapUpOutcome })
    | JCompleteDuplicate(int)
    | JRevalFail(int)
    | JOpRetry(int)

  /// One journal row: monotone dense seq (entry i carries seq i+1 —
  /// journalLegal checks it), the decision event, and the StepRecord the
  /// decision produced when first decided (the executor's emission
  /// payload; golden-trace shaped, standing rule 4). rec is derivable
  /// from the cmd-replay — journalLegal proves exactly that — so an
  /// implementation may store either; the model stores both to make the
  /// consistency a checked theorem instead of a storage convention.
  type Entry = { seq: int, cmd: Cmd, rec: StepRecord }

  /// The journal's base state: the machine's init fleet — empty (domain
  /// init: tickets' = Map()). Replay starts here; entry 1's cmd must be
  /// enabled here (an arrive — nothing else is enabled on an empty
  /// fleet, which journalLegal then enforces for free).
  pure val genesis: Core = { tickets: Map() }

  // ==========================================================================
  // === Replay (pure — the deciders are pure; this is the payoff) ===========
  // ==========================================================================

  /// Total dispatch onto the domain's pure deciders — THE actor's decide
  /// step, and THE replay step: both sides of theorem 3 are this one
  /// function, so they cannot drift.
  pure def execCmd(c: Core, cmd: Cmd): Decision = match cmd {
    | JArrive(a) => decideArrive(c, a.deps, a.prog, a.repo, a.wrapUp)
    | JRelease(j) => decideRelease(c, j)
    | JRevoke(j) => decideRevoke(c, j)
    | JDispatch(j) => decideDispatch(c, j)
    | JTaskDone(a) => decideTaskDone(c, a.ticket, a.tid, a.verdict)
    | JWorkReduce(j) => decideWorkReduce(c, j)
    | JEvalReduce(j) => decideEvalStageReduce(c, j)
    | JDequeue(a) => decideDequeue(c, a.ticket, a.moved)
    | JGateResolve(a) => decideWrapUpResolve(c, a.ticket, a.out, true)
    | JCompleteDuplicate(j) => decideCompleteDuplicate(c, j)
    | JRevalFail(j) => decideRevalFail(c, j)
    | JOpRetry(j) => decideOpRetry(c, j)
  }

  /// The decision's enablement at an explicit Core — per constructor,
  /// exactly the domain action's guard + draw-set membership, each
  /// conjunct a REFERENCE to the definition the domain action reads
  /// (the Core-parameterized forms hoisted into domain.qnt; the m6
  /// audit rule: nothing here is a copied expression). Conjoined by
  /// journalStep (the actor cannot journal a refused decision) and
  /// re-checked by journalLegal at every replayed prefix.
  pure def cmdEnabled(c: Core, cmd: Cmd): bool = match cmd {
    | JArrive(a) => and {
        canArriveIn(c),
        a.deps.subseteq(dependableIn(c)),
        validPrograms.contains(a.prog),
        repos.contains(a.repo)
      }
    | JRelease(j) => draftsIn(c).contains(j)
    | JRevoke(j) => revocablesIn(c).contains(j)
    | JDispatch(j) => and { readiesIn(c).contains(j), dispatchableIn(c, j) }
    | JTaskDone(a) => and {
        taskPhaseIn(c).contains(a.ticket),
        deliverableTaskIds(c, a.ticket).contains(a.tid)
      }
    | JWorkReduce(j) => reducibleWorkIn(c).contains(j)
    | JEvalReduce(j) => reducibleEvalIn(c).contains(j)
    | JDequeue(a) => wrapUpStartablesIn(c).contains(a.ticket)
    | JGateResolve(a) => and {
        holdingIn(c).contains(a.ticket),
        wrapUpOutcomes(true).contains(a.out)
      }
    | JCompleteDuplicate(j) => doneIn(c).contains(j)
    | JRevalFail(j) => readiesIn(c).contains(j)
    | JOpRetry(j) => retryablesIn(c).contains(j)
  }

  /// RECOVERY: replay the journal into a fresh in-memory state.
  /// Deterministic by purity (execCmd is a pure function; the fold has
  /// one result) — theorem 3's mechanism.
  pure def replayCore(jl: List[Entry]): Core =
    jl.foldl(genesis, (c, e) => execCmd(c, e.cmd).post)

  /// THEOREM 1's checker: the journaled history is a legal domain trace.
  /// One fold, three checks per entry at the replayed prefix state —
  /// dense monotone seq, enablement, record reproduced — chaining the
  /// decider's post as the next prefix state. TOTAL by construction: a
  /// disabled entry short-circuits to false WITHOUT executing the
  /// decider (deciders assume their guards — running one on a state
  /// that refuses it is a lookup error, not a boolean; enablement is
  /// checked first, so a tampered journal is rejected, never crashed
  /// on).
  pure def journalLegalOn(jl: List[Entry]): bool =
    jl.foldl({ ok: true, st: genesis, n: 0 }, (acc, e) =>
      if (not(acc.ok) or e.seq != acc.n + 1 or not(cmdEnabled(acc.st, e.cmd)))
        { ok: false, st: acc.st, n: acc.n + 1 }
      else
        val d = execCmd(acc.st, e.cmd)
        { ok: d.rec == e.rec, st: d.post, n: acc.n + 1 })
    .ok

  // ==========================================================================
  // === World accounting (pure) ==============================================
  // ==========================================================================
  // What the world DOES with an emission is trusted fabric; what the
  // theorems need is arithmetic over which DECISIONS reached it. A
  // "spawn" emission runs a paid task fan-out (the SpawnWorkTasks
  // effect — dispatch, both rework arms, the RWorking resume: every one
  // rides a charged account per the domain's descent table); a "completion"
  // emission merges the ticket's diff (the ticket-done success step).
  // Attribution is transitions[0].ticket: every effect-bearing record's
  // head transition is the stepped ticket (domain.qnt move/completeTicket).

  pure def hasEffect(r: StepRecord, e: str): bool =
    r.effects.foldl(false, (b, x) => b or x == e)
  pure def stepsTicket(r: StepRecord, j: int): bool =
    r.transitions.length() >= 1 and r.transitions[0].ticket == j
  pure def isSpawnFor(r: StepRecord, j: int): bool =
    hasEffect(r, "SpawnWorkTasks") and stepsTicket(r, j)
  pure def isCompletionFor(r: StepRecord, j: int): bool =
    r.label == "ticket-done" and stepsTicket(r, j)

  /// Distinct-decision spawn emissions the world received for ticket j:
  /// journaled entries whose seq was emitted at least once (re-emission
  /// of a seq is the same decision — absorbed), plus every orphan (each
  /// orphan IS a distinct decision: it has no seq to absorb against).
  pure def worldSpawnsOn(
      jl: List[Entry], we: Set[int], orph: List[StepRecord], j: int): int =
    jl.indices().filter(i => we.contains(i + 1) and isSpawnFor(jl[i].rec, j)).size()
      + orph.indices().filter(i => isSpawnFor(orph[i], j)).size()

  pure def worldCompletionsOn(
      jl: List[Entry], we: Set[int], orph: List[StepRecord], j: int): int =
    jl.indices().filter(i => we.contains(i + 1) and isCompletionFor(jl[i].rec, j)).size()
      + orph.indices().filter(i => isCompletionFor(orph[i], j)).size()

  /// The journal-side counts: spawn/completion DECISIONS recorded (whether
  /// emitted yet or not) — the book the world must never exceed.
  pure def journalSpawnsOn(jl: List[Entry], j: int): int =
    jl.indices().filter(i => isSpawnFor(jl[i].rec, j)).size()
  pure def journalCompletionsOn(jl: List[Entry], j: int): int =
    jl.indices().filter(i => isCompletionFor(jl[i].rec, j)).size()

  // ==========================================================================
  // === State ================================================================
  // ==========================================================================

  var journal: List[Entry]
  var applied: int
  var worldEffects: Set[int]
  var orphans: List[StepRecord]
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
  /// at the named picks (execCmd), refused unless enabled (cmdEnabled —
  /// so the machine structurally cannot journal an illegal decision);
  /// `apply` installs the post-state in memory and records the step (a
  /// REAL domain step: ghosts snapshot), and the entry appends with the
  /// next dense seq. No emission here: the executor cursor lags
  /// (journal-then-effect). Doubles as the deterministic witness driver
  /// (tests pass explicit cmds; the actor* actions below are the same
  /// step with the picks drawn nondet).
  action journalStep(cmd: Cmd): bool =
    val d = execCmd(core, cmd)
    all {
      cmdEnabled(core, cmd),
      apply(d),
      journal' = journal.append({ seq: journal.length() + 1, cmd: cmd, rec: d.rec }),
      applied' = applied,
      worldEffects' = worldEffects,
      orphans' = orphans,
      rlabel' = "actor-step"
    }

  /// THE EXECUTOR: emit the next unemitted journal entry's effects to
  /// the world (cursor advance; entry at index `applied` carries seq
  /// applied + 1). The union absorbs a re-emission — same seq, same
  /// decision, the world's idempotency key (composition argument in the
  /// header). Not a domain step: installCore keeps the domain vars and
  /// ghosts exactly in place.
  action emitNext = all {
    applied < journal.length(),
    installCore(core, lastStep),
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
  /// it lost, so the domain vars do not move (installCore) — and the
  /// executor cursor regressed to any a <= applied (the cursor's own
  /// durability lags emission; the lost suffix will RE-emit, absorbed by
  /// seq). The journal is the one thing that neither moves nor lies.
  action crashRecoverTo(a: int): bool = all {
    a >= 0,
    a <= applied,
    installCore(replayCore(journal), lastStep),
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
  /// effect-then-journal ordering's crash — decide, EMIT THE EFFECTS,
  /// die before the journal write. The world keeps the emission as an
  /// un-keyed orphan; the journal never learns; recovered memory =
  /// replay(journal) = the pre-decision state (the decision was lost
  /// with memory — the domain vars, which by recoveryComplete already
  /// equal that replay, do not move). Every domain invariant keeps
  /// holding across this step — the domain machine is BLIND to the
  /// hazard, which is the whole reason this layer exists.
  action effectCrash(cmd: Cmd): bool =
    val d = execCmd(core, cmd)
    all {
      cmdEnabled(core, cmd),
      installCore(replayCore(journal), lastStep),
      journal' = journal,
      applied' = applied,
      worldEffects' = worldEffects,
      orphans' = orphans.append(d.rec),
      rlabel' = "effect-crash-recover"
    }

  // --- The actor roster: the domain's 13 actions, journaled ---------------
  // Each mirrors its domain action byte-for-byte in guard + draws (the
  // same enablement vals, the same oneOf sets) and routes through
  // journalStep. The domain's own actions are unusable as steps here —
  // they assign none of this module's vars — so the machine structurally
  // cannot bypass the actor: every domain transition in any run of this
  // module is a journaled decision. (`settle` has no counterpart: it is
  // simulator plumbing, not a decision, and crashRecover already keeps
  // runs deadlock-free.)

  action actorArrive = all {
    canArrive,
    nondet deps_ = dependableTickets.powerset().oneOf()
    nondet prog = validPrograms.oneOf()
    nondet repo_ = repos.oneOf()
    journalStep(JArrive({ deps: deps_, prog: prog, repo: repo_,
      wrapUp: WExclusive(repo_) }))
  }
  action actorRelease = all {
    draftTickets.size() > 0,
    nondet j = draftTickets.oneOf()
    journalStep(JRelease(j))
  }
  action actorRevoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    journalStep(JRevoke(j))
  }
  action actorDispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    journalStep(JDispatch(j))
  }
  action actorTaskDone = all {
    taskPhaseTickets.size() > 0,
    nondet j = taskPhaseTickets.oneOf()
    nondet tid = deliverableTaskIds(core, j).oneOf()
    nondet v = Set(VPass, VFail).oneOf()
    journalStep(JTaskDone({ ticket: j, tid: tid, verdict: v }))
  }
  action actorWorkReduce = all {
    reducibleWork.size() > 0,
    nondet j = reducibleWork.oneOf()
    journalStep(JWorkReduce(j))
  }
  action actorEvalReduce = all {
    reducibleEval.size() > 0,
    nondet j = reducibleEval.oneOf()
    journalStep(JEvalReduce(j))
  }
  action actorGateEnter = all {
    wrapUpStartable.size() > 0,
    nondet j = wrapUpStartable.oneOf()
    nondet moved = Set(true, false).oneOf()
    journalStep(JDequeue({ ticket: j, moved: moved }))
  }
  action actorGateResolve = all {
    holdingTickets.size() > 0,
    nondet j = holdingTickets.oneOf()
    nondet out = wrapUpOutcomes(true).oneOf()
    journalStep(JGateResolve({ ticket: j, out: out }))
  }
  action actorCompleteDuplicate = all {
    doneTickets.size() > 0,
    nondet j = doneTickets.oneOf()
    journalStep(JCompleteDuplicate(j))
  }
  action actorRevalFail = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    journalStep(JRevalFail(j))
  }
  action actorOpRetry = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    journalStep(JOpRetry(j))
  }

  // --- The hazard roster (rstepHazard only): the effect-first seam on ------
  // the world-effect-bearing decisions. The seam exists at EVERY
  // decision; these four are the ones whose orphaned effects the
  // theorems price — the paid spawns (dispatch, the eval-rework, the
  // gate eviction's respawn) and the landing resolutions (the dequeue's
  // fast-path squash, the gated promotion). An orphaned bookkeeping
  // effect (CreateDraft, OpenHumanTask, ...) is the same shape with
  // nothing priced riding it — journalCoversWorld still flags it; the
  // demonstration keeps to the shapes the theorems name.

  action hazardDispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    effectCrash(JDispatch(j))
  }
  action hazardEvalReduce = all {
    reducibleEval.size() > 0,
    nondet j = reducibleEval.oneOf()
    effectCrash(JEvalReduce(j))
  }
  action hazardGateEnter = all {
    wrapUpStartable.size() > 0,
    nondet j = wrapUpStartable.oneOf()
    nondet moved = Set(true, false).oneOf()
    effectCrash(JDequeue({ ticket: j, moved: moved }))
  }
  action hazardGateResolve = all {
    holdingTickets.size() > 0,
    nondet j = holdingTickets.oneOf()
    nondet out = wrapUpOutcomes(true).oneOf()
    effectCrash(JGateResolve({ ticket: j, out: out }))
  }

  /// THE DISCIPLINED MACHINE (journal-then-effect): decisions journal
  /// before anything reaches the world; crashes at any instant.
  action rstep = any {
    actorArrive, actorRelease, actorRevoke, actorDispatch,
    actorTaskDone, actorWorkReduce, actorEvalReduce, actorGateEnter,
    actorGateResolve, actorCompleteDuplicate, actorRevalFail, actorOpRetry,
    emitNext, crashRecover
  }

  /// THE HAZARD MACHINE: everything the disciplined machine does, PLUS
  /// the one seam the discipline forbids. The delta between the two
  /// relations IS the discipline — and the expected-violation runs show
  /// that single delta breaking the theorems.
  action rstepHazard = any {
    rstep,
    hazardDispatch, hazardEvalReduce, hazardGateEnter, hazardGateResolve
  }

  // ==========================================================================
  // === Invariants (this layer's — the domain's live in chuggy_domain) ======
  // ==========================================================================

  /// THEOREM 1 — REFINEMENT: the journal is a legal domain trace (dense
  /// seqs, every decision enabled at its replayed prefix, every record
  /// reproduced by the decider). See journalLegalOn.
  val journalLegal: bool = journalLegalOn(journal)

  /// THEOREM 3 — RECOVERY COMPLETENESS: replay of the current journal is
  /// exactly the actor's in-memory state, in every reachable state (so
  /// for every prefix of every run). The crash actions genuinely install
  /// the replay; this invariant is what makes that installation a no-op
  /// on the domain vars.
  val recoveryComplete: bool = replayCore(journal) == core

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

  /// THE DISCIPLINE CLAIM, coverage half: every effect the world ever
  /// received traces to a journaled decision — no orphans. Structural
  /// under rstep (only effectCrash appends); the FIRST invariant to fall
  /// under the hazard, on the very crash step.
  val journalCoversWorld: bool = orphans.length() == 0

  /// THEOREM 2, budget half — NO DOUBLE-SPENT BUDGET across crashes: the
  /// world never runs more paid work for a ticket than the journal
  /// charged (every journaled spawn decision rides a charged account —
  /// domain descent table; re-emissions are the same decision, absorbed
  /// by seq). Under the hazard, an orphaned spawn is a Job the book
  /// never charged — the flows-analysis double-spend.
  val noDoubleSpentBudget: bool = liveTickets.forall(j =>
    worldSpawns(j) <= journalSpawns(j))

  /// THEOREM 2, cycle half — NO DUPLICATE CYCLE: the world lands a
  /// ticket's diff at most once, across crashes at any seam. (A group's
  /// diff rides its lead's single completion emission — R2 — so per-lead
  /// counting covers the group.)
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
    noDoubleSpentBudget,
    noDuplicateCycle
  }

  // ==========================================================================
  // === Re-exposure wrappers (imports are not re-exported — header note) ====
  // ==========================================================================

  /// The embedded domain machine's full invariant bundle, checked
  /// against the actor's in-memory state.
  val allDomainInvariants: bool = allInvariants
  /// The actor's in-memory view (the embedded instance's Core).
  val memCore: Core = core
  /// The last DOMAIN step's record (stale across emit/crash steps —
  /// those are not domain steps; rlabel carries this layer's trace).
  val obs: StepRecord = lastStep
  val measureNow: int = currentMeasure
  val measurePrev: int = prevMeasure
}
