/// THE CHUGGY DOMAIN MACHINE — the deciders, the state and actions layer,
/// and every safety invariant.
///
/// A decider is a PURE FUNCTION of an observed `Core` and an event, returning
/// transitions and a list of effects. It never performs one. That is what
/// lets the same functions serve any runtime shape, and what lets a golden
/// trace be replayed through them with no world to stub.
///
/// READS ARE NOT EFFECTS. Anything a decision needs is gathered into the view
/// before the decider runs. Getting this backwards is the commonest way a
/// decider/effects split stops being testable: the decider acquires an await,
/// then a mock, and then it is no longer a function.
///
/// THE SHAPE OF A TICKET'S LIFE. It is released as a Pending, is released into the
/// pipeline, and the selector picks it out of the derived Ready set — which
/// pick is the selector's own agency, not scheduler noise, so any policy
/// refines unrestricted choice. Work runs one task set per cycle. Evaluation
/// runs the ticket's authored program, stage by stage, short-circuiting on a
/// failure into the rework economy. Then the ticket finishes according to its
/// authored wrap-up kind: a NoFinalizer ticket's effect already happened during
/// work, so passing evaluation completes it outright; a ManagedFinalizer ticket
/// queues for a lease on its named resource, holds it while its step runs,
/// and releases it by leaving the phase.
///
/// THE ACCOUNTS. Gas meters every entry to Working. The rework account meters
/// eval failures, the wrap-up account meters wrap-up failures, and every wall
/// is a park on the human desk with a name. Nothing refunds. These are what
/// make the termination measure descend, and measure.qnt is written first and
/// reworked first whenever this file changes.
///
/// DERIVE, DON'T STORE. Ready and Blocked are predicates over deps, not
/// phases, so no unblock cascade exists to get wrong. Lease occupancy is a
/// predicate over phase, so nothing cleans up. The open-desk-task flag, the
/// current eval stage and a ticket's dependency artifacts are all derived.
///
/// WHAT THIS FILE DELIBERATELY DOES NOT KNOW:
///   - Any INTERNAL structure to a wrap-up step — staging, failure classes, a
///     fix-and-retry path with its own budget. A step is one abstract verdict;
///     what a merge, a registry push or a deploy does inside it belongs to
///     that adapter.
///   - WHY a resource needs serializing. The domain owns mutual exclusion,
///     because deciding that one ticket holds a resource and another may not
///     reads state belonging to another ticket — the authority split's test
///     for a global decision, and a second writer if an adapter did it. It
///     does not own git.
///   - Scheduling and capacity. No slot count, no queue order, no fairness:
///     the fabric owns placement and quota, and waiting is unbounded by
///     decision.
///   - Retry below the cycle. No attempt counter, no per-task budget. The
///     fabric relaunches a failed task; this machine prices cycles.
///   - The runtime shape. No journal, no cursor, no crash, no fabric
///     vocabulary at all — that is model/refinement.qnt, layered on this
///     machine and severable. Every shape must refine THIS machine, and this
///     file never learns which one runs it.
///   - Ticket batching in any form, and atomic changes across project partitions. Both
///     are deliberately absent, and nothing here can express either.
///
/// This header describes the machine; it does not narrate how the machine
/// came to be.
module chuggy_domain {
  import chuggy_measure.* from "./measure"

  /// Maximum number of released tickets. Ticket identities come from the
  /// wider finite universe below and may be sparse or numerically reversed.
  const N_TICKETS: int
  /// Task fan-out ceiling: the Work phase's single task-set width, AND the
  /// per-stage fan-out cap an authored eval program may declare, since a
  /// ticket carries a SET of possibly-parallel tasks. Stage widths are
  /// per-stage data, so this const is their bound — the measure's
  /// stageWeight radix needs exactly this cap.
  const N_TASKS: int
  /// Eval-rework pricing (the bound is a POLICY PARAMETER on the
  /// FinalizationPricing pattern, not a core-entity constant — BudgetedRework(n) is the
  /// only branch for now, argued at the type in measure.qnt; the account
  /// it grants is middleware-owned policy state, documented at
  /// Ticket.reworkLeft).
  const REWORK_POLICY: ReworkPolicy
  /// Gas per ticket — the REQUIRED account, a spend meter rather than a
  /// clock. It must be >= 1: a gasless graph is invalid, and init admits no
  /// state otherwise.
  const GAS: int
  /// Gate-rework pricing (a parameter, not a constant; both
  /// branches instantiated in mc/mc_chuggy.qnt).
  const FINALIZATION_PRICING: FinalizationPricing
  /// Operator-retry metering (configurable per deployment,
  /// default charge — mc instantiates RetryCharged, plus a RetryFree
  /// instance so the free-resume churn path stays exercised).
  /// Authored-program length cap — the measure's stage radix
  /// (Bounds.maxStages) and release's validity ceiling. Real programs are
  /// short by construction (stages are declared per evaluator) — the cap exists for the radix argument,
  /// not as domain vocabulary.
  const MAX_STAGES: int
  /// Finite external-id universe for model checking. It is deliberately wider
  /// than the ticket-count bound so traces can contain gaps and reverse
  /// numeric dependency edges. Production ids are opaque and unbounded.
  pure val ticketIdUniverse: Set[int] = 1.to(N_TICKETS * 2)

  pure val finalizerChoices: Set[Finalizer] = Set(NoFinalizer, ManagedFinalizer)
  pure val workFanoutChoices: Set[int] = 1.to(N_TASKS)
  pure val reworkPolicyChoices: Set[ReworkPolicy] =
    0.to(reworkBudget(REWORK_POLICY)).map(n => BudgetedRework(n))
  pure val finalizationPricingChoices: Set[FinalizationPricing] =
    Set(DeadlineOnly).union(
      0.to(finalizationBudget(FINALIZATION_PRICING)).map(n => Budgeted(n)))
  pure val resumePricingChoices: Set[RetryPricing] = Set(RetryCharged, RetryFree)

  /// The measure's bounds, from this instance's consts.
  pure val bounds: Bounds = {
    reworkPolicy: REWORK_POLICY,
    nTasks: N_TASKS,
    maxStages: MAX_STAGES,
    finalizationPricing: FINALIZATION_PRICING
  }

  /// The stage vocabulary an author may draw from: any fan-out 1..N_TASKS,
  /// either combinator (both branches stay exercisable — the model).
  pure val stageChoices: Set[Stage] =
    tuples(1.to(N_TASKS), Set(UnanimousPass, AnyPass))
      .map(t => { fanout: t._1, combinator: t._2 })

  /// Every WELL-FORMED authorable program: non-empty, at most MAX_STAGES
  /// stages, each stage from stageChoices. This set IS the release-refusal
  /// rule (programsWellFormed): the empty program, an oversized fan-out,
  /// and an overlong program are not in it, so no release can carry one —
  /// the same structural-refusal shape as dependableTickets for deps
  /// draws from exactly this set).
  pure val validPrograms: Set[List[Stage]] =
    1.to(MAX_STAGES).fold(Set([]), (acc, _) =>
      acc.union(acc.map(p => stageChoices.map(s => p.append(s))).flatten()))
      .filter(p => p.length() >= 1)

  /// THE DEFAULT PROGRAM: ONE stage, full fan-out, unanimous pass. Every
  /// evaluator defaults to stage 0, so a ticket whose evaluators all share
  /// one stage behaves exactly like a single fan-out — pinned in
  /// tests/chuggy_test.qnt. There is deliberately no machine-wide
  /// combinator const: the combinator is data on the ticket record, and a
  /// const would be exactly the machinery that eval-is-data rules out.
  pure val defaultProgram: List[Stage] =
    [{ fanout: N_TASKS, combinator: UnanimousPass }]

  /// The ticket-source seam, now CLOSED:
  /// every ticket the machine ever holds is built here, and the only caller is
  /// reaches the released pipeline only through decideRelease. The author's
  /// eval PROGRAM is released with the Pending (eval is data; authoring came
  /// first precisely so programs would have an release to ride).
  /// The TARGET PROJECT is released the same way — authored data
  /// riding the release, immutable after, like deps and the program.
  pure def freshTicket(
      deps_: Set[int], prog: List[Stage], workFanout_: int,
      reworkPolicy_: ReworkPolicy, finalizationPricing_: FinalizationPricing,
      resumePricing_: RetryPricing, finalizer_: Finalizer): Ticket = {
    phase: Pending,
    deps: deps_,
    program: prog,
    finalizer: finalizer_,
    artifact: NoArtifact,
    workFanout: workFanout_,
    reworkPolicy: reworkPolicy_,
    finalizationPricing: finalizationPricing_,
    resumePricing: resumePricing_,
    tasks: Set(),
    record: [],
    spawned: 0,
    reworkLeft: reworkBudget(reworkPolicy_),
    finalizationLeft: finalizationBudget(finalizationPricing_),
    gasLeft: GAS,
    resumeAt: NoResume,
    reason: NoReason,
    completions: 0
  }

  // ==========================================================================
  // === Pure deciders ========================================================
  // ==========================================================================
  // decide(view, event) -> Decision, never an effect. Every runtime shape
  // reuses these unchanged.

  pure def withTicket(c: Core, j: int, jb: Ticket): Core =
    { ...c, tickets: c.tickets.set(j, jb) }

  /// The one funnel every phase flip goes through, recording exactly one
  /// transition (golden-trace shaped, standing rule 4). from == to is
  /// a real row now — the stage advance records
  /// Evaluating -> Evaluating.
  pure def move(c: Core, j: int, to_: Phase, label: str, effects_: List[str]): Decision =
    { rec: {
        label: label,
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: to_ }],
        effects: effects_},
      post: withTicket(c, j, { ...c.tickets.get(j), phase: to_ }) }

  // --- Release and revoke ---------------------------------------------------
  // --------------------------------------------------------------------

  /// A ticket IS RELEASED as a Pending — the environment (an author) creates it.
  /// A ticket does not exist in Core before this decision. Its externally
  /// allocated id may be sparse. Dependencies may point only at already
  /// released tickets, but never at a tombstone: not a Revoked ticket, and
  /// not a ticket the cascade already parked behind one (Escalated with
  /// dependency_revoked — by cascadeSafety those two cases are EXACTLY the
  /// transitively-doomed tickets). The author cannot depend on either
  /// (authoring-time validation; admitting one would create a ticket doomed
  /// at birth, which cascadeSafety forbids anyone to hold un-parked — the
  /// first random invariant run caught precisely this). Callers guarantee
  /// deps_ ⊆ dependable ids (see `dependableTickets`).
  ///
  /// The release also carries the ticket's EVAL PROGRAM, validated the
  /// same structural way — callers guarantee prog ∈ validPrograms, so an
  /// empty program, a zero/oversized fan-out, or an overlong program is
  /// REFUSED at authoring time: no reachable state holds one
  /// (programsWellFormed), rather than the interpreter defending against
  /// one mid-flight. The program is immutable after release, like deps.
  ///
  /// Dynamic-DAG boundary: releases are author actions — only
  /// the environment action `release` calls this decider, and no ticket-event
  /// decider creates tickets, so the ticket set grows only by authoring, never by
  /// tickets spawning tickets. Author commands (release/revoke) are also guarded
  /// by enablement, not absorbed as duplicates: authors are command
  /// sources, not the at-least-once fabric — only fabric events get
  /// idempotent stutter deciders.
  ///
  /// The release carries the ticket's WRAP-UP CHOICE last — whether
  /// completion needs a lease, and on which resource. Callers guarantee
  /// finalizer_ ∈ finalizerChoices (the `release` action draws from exactly that
  /// set), so a lease on a resource outside the universe is refused at
  /// authoring time like an out-of-universe target (finalizerWellFormed makes
  /// the refusal durable). It is the draw that decides whether the ticket
  /// ever reaches a wrap-up phase at all: NoFinalizer completes on its passing
  /// evaluation and takes no lease (noLeaseWithoutAKind). Immutable after
  /// release, like deps and the program.
  /// The first domain decision for a ticket. The id is allocated by native
  /// release candidate authoring, may be sparse, and is never minted or ordered by Core.
  pure def decideReleaseTicket(
      c: Core, j: int, deps_: Set[int], prog: List[Stage], workFanout_: int,
      reworkPolicy_: ReworkPolicy, finalizationPricing_: FinalizationPricing,
      resumePricing_: RetryPricing, finalizer_: Finalizer): Decision =
    { rec: { label: "ticket-released", transitions: [], effects: []},
      post: { ...c, tickets: c.tickets.put(j,
        freshTicket(deps_, prog, workFanout_, reworkPolicy_, finalizationPricing_,
          resumePricing_, finalizer_)) } }

  /// Revoke + THE CASCADE. Table provenance for the revoke
  /// edge itself: lines 47-48 `(_, Revoked) => true` — every non-terminal
  /// phase may be revoked (the caller's guard, revocableIn) — and lines
  /// 45-46 `(Done | Revoked, Revoked) => false` — the terminals are
  /// absorbing, so no decider ever moves a ticket OUT of Revoked (invariant
  /// terminalsAbsorbing). The revoked ticket settles: rank -> 0, live task set
  /// RETIRED into the record (still-outstanding tasks force-closed as
  /// Cancelled; the
  /// record itself is KEPT: provenance survives the author's settlement,
  /// "Revoked runs nothing" ≠ "Revoked remembers nothing"), accounts
  /// UNTOUCHED — revoke charges no gas and spends no budget in either
  /// direction — and reason/resumeAt cleared: Revoked opens NO human task
  /// (hasOpenHumanTask excludes it; revocation is the author's settled
  /// choice, like Done).
  ///
  /// THE CASCADE: a ticket whose dep chain
  /// contains a revoked ticket can never unblock (a dep that is not Done
  /// blocks, and Revoked never becomes Done). Of the two candidate
  /// semantics —
  ///   (a) transitive cascade-REVOKE: dependents are revoked too;
  ///   (b) PARK: dependents wait on the desk behind a named wall —
  /// chuggy picks (b), ATOMICALLY in this decision, for two reasons.
  /// First, revocation is a per-ticket authorial choice: (a) would
  /// let one author's revocation silently destroy OTHER tickets with no human
  /// decision and no desk trace (a cascade-revoked ticket opens no task — the
  /// exact invisibility the §2 visibility row forbids). Second, parking
  /// preserves desk coverage structurally: every doomed dependent gets its
  /// OWN open task (DependencyRevoked) telling a human "your dependency
  /// was revoked; settle me" — and the human settles it by revoking it (its
  /// desk revoke is the AUTHORING flat member in measure.qnt). The park is
  /// atomic with the revoke — same decision, one StepRecord — so
  /// cascadeSafety holds in EVERY reachable state, never just eventually.
  ///
  /// Why parking only Pending/Pending dependents is exhaustive: a
  /// transitive dependent of a revocable (hence non-Done) ticket can never
  /// have dispatched — dispatch needs all deps Done, Done is absorbing, and
  /// the revoked ancestor is not Done — so every dependent is still
  /// pre-flight: Pending, Pending, or already settled by an earlier cascade
  /// (Escalated DependencyRevoked) or by its own author (Revoked). The
  /// filter parks exactly the first two and leaves the already-settled
  /// alone (no duplicate transitions). Pre-flight tickets hold
  /// no live tasks, so the cascade retires nothing on the parked side.
  /// The parked wall stamps NO resume point (resumeAt stays NoResume): deps
  /// are immutable, so no modeled resume exists — the wall's only exit is
  /// revoke (retryableIn; the deliberate table-line-44 deviation).
  pure def decideRevoke(c: Core, j: int): Decision =
    val doomedByJ = range(1, N_TICKETS + 1).foldl(Set(j), (dset, _) =>
      dset.union(c.tickets.keys().filter(k =>
        c.tickets.get(k).deps.exists(d => dset.contains(d)))))
      .filter(k => k != j)
    val parked = doomedByJ.filter(k =>
      val p = c.tickets.get(k).phase
      p == Pending)
    // Ascending, deterministic order for the golden-trace record.
    val parkedList = range(1, N_TICKETS * 2 + 1).foldl([], (l, k) =>
      if (parked.contains(k)) l.append(k) else l)
    { rec: {
        label: "ticket-revoked",
        transitions:
          [{ ticket: j, from: c.tickets.get(j).phase, to: Revoked }]
            .concat(parkedList.foldl([], (l, k) =>
              l.append({ ticket: k, from: c.tickets.get(k).phase, to: Escalated }))),
        // "CancelTicketWork" for the revoked ticket; one OpenHumanTask per parked
        // dependent — and NONE for the revoked ticket itself.
        effects: ["CancelTicketWork"]
          .concat(parkedList.foldl([], (l, k) => l.append("OpenHumanTask")))},
      post: { ...c, tickets: c.tickets.keys().mapBy(k =>
        if (k == j)
          { ...retireLive(c.tickets.get(k)), phase: Revoked,
            resumeAt: NoResume, reason: NoReason }
        else if (parked.contains(k))
          { ...c.tickets.get(k), phase: Escalated, reason: DependencyRevoked }
        else c.tickets.get(k)) } }

  // --- Pure guard predicates ------

  /// Revocation stops before finalization and cannot rewrite a terminal outcome.
  pure def revocableIn(c: Core, j: int): bool =
    c.tickets.get(j).phase != Done and
      c.tickets.get(j).phase != Abandoned and
      c.tickets.get(j).phase != Revoked and
      c.tickets.get(j).phase != Finalizing and
      c.tickets.get(j).phase != PublishingHandoff and
      c.tickets.get(j).phase != HandoffBlocked

  /// What one operator resume costs by flavor. One decider —
  /// decideResumeTicket — carries every resume and this table prices it:
  ///   ResumeWorking    — 1 always: entry to Working always meters (standing
  ///                 rule 2), even under RetryFree.
  ///   ResumeEvaluating/ResumeFinalizing — per ticket-local resumePricing (default
  ///                 charge); RetryFree makes these the reproducible
  ///                 livelock.
  /// NoResume falls through the wildcard but is unreachable: retryableIn
  /// refuses it and decideResumeTicket's NoResume arm is unreachable.
  pure def resumeCharge(ticket: Ticket, at: Resume): int =
    match at {
      | ResumeWorking => 1
      | _ => match ticket.resumePricing { | RetryCharged => 1 | RetryFree => 0 }
    }

  /// May the operator retry this ticket's open human action? A resume must
  /// EXIST (resumeAt != NoResume) and be
  /// AFFORDABLE (a charging resume needs gas). The one wall with no
  /// modeled resume is dependency_revoked (resumeAt NoResume) — a DELIBERATE
  /// RESTRICTION: deps are immutable in this model (no re-authoring
  /// machinery yet), so a retry
  /// could only re-enter Pending still doomed behind the same revoked dep
  /// — a lie to the desk and an immediate cascadeSafety hole. That wall's
  /// only modeled exit is revoke; dep re-authoring is future work (README,
  /// deliberately-absent table).
  pure def retryableIn(c: Core, j: int): bool = and {
    c.tickets.get(j).phase == Escalated or c.tickets.get(j).phase == HandoffBlocked,
    c.tickets.get(j).resumeAt != NoResume,
    resumeCharge(c.tickets.get(j), c.tickets.get(j).resumeAt) <= c.tickets.get(j).gasLeft
  }

  /// WHAT A TICKET WAITS ON before it may run — the single definition, read
  /// by the readiness check (depsDoneIn), the structural-deadlock check
  /// (canFinishSet) and the cross-ticket artifact read alike. Named for
  /// what it is rather than for the dispatch gate it feeds, because the
  /// merge gate that shared that word is gone.
  ///
  /// One definition on purpose: the grouping defect was a DERIVED waiting
  /// relation diverging from the stored field depsAcyclic watched, so a
  /// future derived relation moves both checks or neither.
  pure def waitsOn(c: Core, j: int): Set[int] = c.tickets.get(j).deps

  /// WHAT THIS TICKET'S DEPENDENCIES PRODUCED (design 002) — the read that
  /// makes a release ticket expressible at all. Derived, never stored, and
  /// stable: every dep is Done before a dependent can dispatch, and Done
  /// is absorbing, so nothing here can change under a reader.
  pure def depArtifacts(c: Core, j: int): Set[ArtifactMark] =
    waitsOn(c, j).map(d => c.tickets.get(d).artifact)

  pure def depsDoneIn(c: Core, j: int): bool =
    waitsOn(c, j).forall(k => c.tickets.get(k).phase == Done)

  // --- Core-parameterized enablement (the refinement layer — the
  // m6 hoist discipline one level up, applied to the enablement SETS):
  // the journaled actor's replay checker (model/refinement.qnt,
  // journalLegalOn) must re-check each journaled decision's enablement at
  // the REPLAYED prefix state — a Core, not this module's live vars — and
  // a copied guard drifts exactly like the witness-driver copies m6
  // killed. So each enablement val below (the state section) is now a
  // one-line reference to its pure Core form here; the machine's actions
  // and the replay checker consume the SAME definition. No semantic
  // change: each val's body moved verbatim into its pure def (liveTickets
  // becomes the explicit c.tickets.keys()).

  /// Room for one more release (the N_TICKETS release bound).
  pure def canReleaseIn(c: Core, j: int): bool = and {
    c.tickets.keys().size() < N_TICKETS,
    ticketIdUniverse.contains(j),
    not(c.tickets.keys().contains(j))
  }

  /// doc has the cascadeSafety argument).
  pure def dependableIn(c: Core): Set[int] = c.tickets.keys().filter(k => and {
    c.tickets.get(k).phase != Revoked,
    not(c.tickets.get(k).phase == Escalated and c.tickets.get(k).reason == DependencyRevoked)
  })

  /// The only authoring phase, hence the only releasable set.
  /// Every non-terminal may be revoked.
  pure def revocablesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => revocableIn(c, j))

  /// The derived Ready room (isReadyIn per ticket).
  pure def readiesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => isReadyIn(c, j))

  /// Tickets whose task set can receive completion events.
  pure def taskPhaseIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == Working or c.tickets.get(j).phase == Evaluating)

  pure def reducibleWorkIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == Working and outstandingCount(c.tickets.get(j).tasks) == 0)

  pure def reducibleEvalIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == Evaluating and outstandingCount(c.tickets.get(j).tasks) == 0)

  pure def doneIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == Done)

  /// Parked tickets the operator may Retry (retryableIn per ticket).
  pure def retryablesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => retryableIn(c, j))

  /// The derived waiting room (standing rule 3), as pure predicates over a
  /// Core so tests can pin them: any dependency not yet Done blocks.
  pure def isReadyIn(c: Core, j: int): bool =
    c.tickets.get(j).phase == Pending and depsDoneIn(c, j)

  pure def isBlockedIn(c: Core, j: int): bool =
    c.tickets.get(j).phase == Pending and not(depsDoneIn(c, j))

  /// May the ticket writer dispatch ticket j? Ready (the derived waiting room)
  /// with gas to charge — entry to Working always meters (standing rule
  /// 2). Pending tickets have never spent gas (release grants the full
  /// GAS and authoring charges nothing), so the gas conjunct is
  /// structurally implied whenever init accepted the configuration; it is
  /// stated so the enablement is ONE predicate. HOISTED by the
  /// Hoisted (review finding m6): a guard that lives
  /// inline in the `dispatch` action, and the witness drivers carried a
  /// copied expression of it — a copied guard drifts silently
  /// (strengthen the machine's and the stale copy keeps the drivers'
  /// "machine trace" claim alive while the machine refuses the step).
  /// Both the `dispatch` action and tests/chuggy_witness_test.qnt's
  /// doDispatch drivers now REFERENCE this definition; neither copies it.
  pure def dispatchableIn(c: Core, j: int): bool = and {
    isReadyIn(c, j),
    c.tickets.get(j).gasLeft > 0
  }

  /// Every task id ticket j has EVER issued — the delivery range the
  /// firstTaskId, so this is exactly firstTaskId..nextTaskId-1). Shared,
  /// like dispatchableIn, by the `taskDone` action's nondet draw and the
  /// witness drivers' guards (tests/chuggy_witness_test.qnt), so the
  /// range is referenced on both sides, never copied.
  pure def deliverableTaskIds(c: Core, j: int): Set[int] =
    firstTaskId.to(nextTaskId(c.tickets.get(j)) - 1)

  /// Park a ticket on the human desk, naming the wall (the termination
  /// requirement commits the terminal, not the names) and where Retry
  /// resumes. The open desk task
  /// is DERIVED from
  /// the phase (hasOpenHumanTask, standing rule 3); "OpenHumanTask" is its
  /// trace-visible effect. This is THE park. The live task set is retired
  /// into the retained record rather than dropped; execution-blocked tasks
  /// are recorded as Cancelled.
  pure def escalate(c: Core, j: int, at: Resume, why: Reason, label: str): Decision =
    move(
      withTicket(c, j, { ...retireLive(c.tickets.get(j)), resumeAt: at, reason: why }),
      j, Escalated, label, ["OpenHumanTask"])

  /// Ready -> Working: launch a cycle for the ticket THE SELECTOR PROPOSED.
  /// Charges one gas — EVERY entry to Working does (standing rule 2: no
  /// free re-entry; gas is the account that makes the graph valid at all).
  /// Work is ONE task-set phase (one work task per cycle; Work is not staged), width
  /// N_TASKS, ids sequential within the ticket.
  ///
  /// THE AGENTIC SELECTOR: this decider makes the accepted dispatch
  /// proposal first-class — j
  /// is the CHOICE, and the chooser is the `dispatch` action's nondet pick
  /// among readyTickets. That pick is not incidental scheduler noise to be
  /// refined away: the selector is itself agentic rather than a FIFO pop,
  /// so its choice is a genuine nondet outcome and ANY
  /// Ready ticket may be chosen next, and the `dispatch` StepRecord in the
  /// trace IS the ticket writer's decision event — an implementation
  /// conforms with any policy (LLM-driven, priority, whatever) because
  /// every policy refines unrestricted choice among Ready tickets. No
  /// policy-hook parameter is introduced: with exactly one honest default
  /// (unrestricted nondet) a FinalizationPricing-style const would have one
  /// branch and nothing to compare — it enters only when a real competing
  /// policy needs modeling. No queue, no fairness — standing non-goals.
  pure def decideDispatch(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    move(
      withTicket(c, j, { ...spawnOn(jb, Work, jb.workFanout),
        gasLeft: jb.gasLeft - 1 }),
      j, Working, "dispatch", ["SpawnWorkTasks"])

  /// A task-completion event for task `tid` of ticket j (Working or
  /// Evaluating — one decider for both phases' task sets). First write
  /// wins: if the task is not OUTSTANDING IN THE LIVE SET, this is a duplicate
  /// or stale delivery and the decision is a state-identical no-op
  /// (STUTTER set in measure.qnt). the model the stale arm structural:
  /// task ids are unique across the ticket's whole history, so a completion
  /// for a task of an earlier stage or incarnation names an id that is
  /// already RETIRED into the record — no live match, no-op BY IDENTITY
  /// (had to absorb cross-incarnation staleness into the nondet
  /// verdict of a respawned same-id task; that argument is now needed for
  /// nothing). No phase transition either way — task records resolve
  /// inside the phase.
  pure def decideTaskDone(c: Core, j: int, tid: int, v: Verdict): Decision =
    { rec: { label: "task-done", transitions: [], effects: []},
      post: withTicket(c, j, { ...c.tickets.get(j),
        tasks: resolveTask(c.tickets.get(j).tasks, tid,
          match v { | Pass => Passed | Fail => Failed }) }) }

  /// The Working task set fully resolved: reduce the phase, at CYCLE level
  /// only. Work's phase-outcome combinator is UNANIMOUS PASS — not a
  /// placeholder: Work runs ONE task per cycle whose success is the
  /// phase's success — unanimous over a singleton; under the
  /// parallel task-set generalization, the
  /// faithful reading stays "every work task passed"). A pass RETIRES the
  /// work set into the record and spawns the eval program's LOWEST stage
  /// — one task per evaluator in the lowest stage, fanned out in
  /// parallel. Every entry spawns the stage in
  /// full — an evaluator is never skipped on the grounds that its subject
  /// did not change, because deciding that soundly needs the evaluator to
  /// declare its own footprint honestly, which is a property of the
  /// evaluator and not of this machine. A
  /// failed task set is a failed CYCLE and escalates directly: the fabric
  /// has already retried each task below the cycle (trusted
  /// relaunch limit), and modeling attempts of our own is a standing
  /// non-goal.
  pure def decideWorkReduce(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    val retired = retireLive(jb)
    if (jb.tasks.forall(t => t.state == Resolved(Passed)))
      val fan = retired.program[0].fanout
      move(
        withTicket(c, j,
          { ...spawnOn(retired, Evaluation(0), fan), artifact: ProducedArtifact(retired.spawned) }),
        j, Evaluating, "work-passed", ["SpawnEvalTasks"])
    else
      escalate(c, j, ResumeWorking, WorkFailed, "ticket-escalated work_failed")

  /// THE EVAL-PROGRAM INTERPRETER (the machinery; the program is
  /// data on the ticket). Fires when the CURRENT stage's task set is fully
  /// resolved — a stage completes when all its tasks reach a terminal
  /// state — reads the stage's own combinator off
  /// the program, and takes exactly one of three edges:
  ///
  ///   - stage PASSES, later stage remains -> ADVANCE: retire the stage
  ///     into the record, spawn the next stage's fan-out. The
  ///     Evaluating -> Evaluating transition is a real row ("a stage completes with every required
  ///     evaluator passing and a later stage remains: create the next
  ///     stage's evaluator tasks"). Descends: stagesLeft -1 dominates the
  ///     spawn (measure.qnt, the stage digit).
  ///   - the FINAL stage passes -> the program passed: Finalizing.
  ///   - stage FAILS -> SHORT-CIRCUIT: the later stages are not created —
  ///     they are skipped, not failed, so no task records exist for them —
  ///     and the eval reduce proceeds immediately (the
  ///     golden fixture staged_eval_short_circuit.yaml pins exactly this:
  ///     stage-0 fails, stage 1 never launched): straight into the SAME
  ///     rework/escalation economy as any other stage failure — a
  ///     budgeted rework cycle
  ///     costs 1 reworkLeft + 1 gas and re-enters Work, and the next
  ///     Evaluation RESTARTS FROM THE LOWEST STAGE ("stages are recomputed
  ///     per cycle, never resumed mid-sequence"); an empty account parks
  ///     the ticket behind the existing wall (budget wall checked before the
  ///     gas wall). No new wall, no new account.
  ///
  /// Evaluator-infrastructure death is a Failed INSIDE the stage — THE
  /// TICKET PAYS from the same accounts, no new machinery. Deliberate
  /// abstraction from the extracted vocabulary, which escalates required
  /// INFRA failures immediately (skipping rework) and distinguishes abort
  /// verdicts; chuggy folds all three into Failed-fails-the-stage because
  /// they are priced identically — flagged as an open question rather
  /// than silently adopted.
  pure def decideEvalStageReduce(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    val s = evalStage(jb.tasks)
    val retired = retireLive(jb)
    if (combine(jb.program[s].combinator, jb.tasks))
      if (s + 1 < jb.program.length())
        val fan = retired.program[s + 1].fanout
        move(
          withTicket(c, j, spawnOn(retired, Evaluation(s + 1), fan)),
          j, Evaluating, "eval-stage-passed", ["SpawnEvalTasks"])
      else
        // THE WRAP-UP ROUTE (design 002). A NoFinalizer ticket's effect already
        // happened during work, so evaluation passing IS its completion and
        // it enters neither wrap-up phase — it never queues for a lease it
        // does not need, and never records a wrap-up it did not perform.
        match jb.finalizer {
          // On the RETIRED ticket, not the live one: completeTicket does not
          // retire a task set, because on the lease path the set was already
          // retired when the ticket enqueued. Skipping the wrap-up phases
          // skips that retirement too, and a Done ticket holding live eval
          // tasks breaks tasksWellFormed. Caught by the random layer.
          | NoFinalizer => completeTicket(withTicket(c, j, retired), j)
          | ManagedFinalizer =>
            move(
              withTicket(c, j, retired),
              j, Finalizing, "eval-passed", ["RunFinalizer"])
        }
    else if (jb.reworkLeft > 0 and jb.gasLeft > 0)
      move(
        withTicket(c, j, { ...spawnOn(retired, Work, retired.workFanout),
          reworkLeft: jb.reworkLeft - 1,
          gasLeft: jb.gasLeft - 1 }),
        j, Working, "rework-started eval_failure", ["SpawnWorkTasks"])
    else if (jb.reworkLeft == 0)
      escalate(c, j, ResumeEvaluating, ReworkBudgetExhausted,
        "ticket-escalated rework_budget_exhausted")
    else
      escalate(c, j, ResumeEvaluating, GasExhausted,
        "ticket-escalated gas_exhausted")

  /// A finalizer reports only a conclusive domain outcome. Queueing,
  /// preparation, approval, permits and reconciliation are focused durable
  /// operational records; Core does not learn a finalizer implementation.
  pure def finalizationOutcomes: Set[FinalizationOutcome] =
    Set(FinalizationSucceeded, FinalizationFailed, PromotionAccepted,
      HandoffPublicationUnproven)

  pure def finalizationOutcomeEnabled(c: Core, j: int, out: FinalizationOutcome): bool =
    match out {
      | FinalizationSucceeded =>
        Set(Finalizing, PublishingHandoff).contains(c.tickets.get(j).phase)
      | FinalizationFailed => c.tickets.get(j).phase == Finalizing
      | PromotionAccepted => c.tickets.get(j).phase == Finalizing
      | HandoffPublicationUnproven => c.tickets.get(j).phase == PublishingHandoff
    }

  pure def finalizerFailure(c: Core, j: int, label: str): Decision =
    val jb = c.tickets.get(j)
    match jb.finalizationPricing {
      | Budgeted(_) =>
        if (jb.finalizationLeft > 0 and jb.gasLeft > 0)
          move(withTicket(c, j, { ...spawnOn(jb, Work, jb.workFanout),
              finalizationLeft: jb.finalizationLeft - 1, gasLeft: jb.gasLeft - 1 }),
            j, Working, label, ["SpawnWorkTasks"])
        else if (jb.finalizationLeft == 0)
          escalate(c, j, ResumeFinalizing, FinalizationBudgetExhausted,
            "ticket-escalated finalization_budget_exhausted")
        else escalate(c, j, ResumeFinalizing, GasExhausted,
          "ticket-escalated gas_exhausted")
      | DeadlineOnly =>
        if (jb.gasLeft > 0)
          move(withTicket(c, j, { ...spawnOn(jb, Work, jb.workFanout),
              gasLeft: jb.gasLeft - 1 }), j, Working, label, ["SpawnWorkTasks"])
        else escalate(c, j, ResumeFinalizing, GasExhausted,
          "ticket-escalated gas_exhausted")
    }

  /// THE COMPLETION: the ticket reaches Done. Native desk state is updated
  /// transactionally with the journal, so no external completion effect is
  /// emitted.
  pure def completeTicket(c: Core, j: int): Decision =
    { rec: {
        label: "ticket-done",
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: Done }],
        effects: []},
      post: withTicket(c, j,
        { ...c.tickets.get(j), phase: Done,
          completions: c.tickets.get(j).completions + 1 }) }

  pure def completeHandoffTicket(c: Core, j: int): Decision =
    { rec: {
        label: "ticket-done handoff_succeeded",
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: Done }],
        effects: []},
      post: withTicket(c, j,
        { ...c.tickets.get(j), phase: Done,
          completions: c.tickets.get(j).completions + 1 }) }

  /// A conclusive result resolves only from Finalizing. A success is
  /// the ticket's single completion
  /// (completeTicket: ghost `completions` counts it, one per ticket). A
  /// finalization failure re-enters work priced per FINALIZATION_PRICING.
  /// A finalizer's internals and recovery protocol stay below this grain: it
  /// reports one abstract, conclusive verdict.
  pure def decideFinalizationResult(c: Core, j: int, out: FinalizationOutcome): Decision =
    match out {
      | FinalizationSucceeded =>
        if (c.tickets.get(j).phase == PublishingHandoff)
          completeHandoffTicket(c, j)
        else completeTicket(c, j)
      | FinalizationFailed => finalizerFailure(c, j, "rework-started finalization_failed")
      | PromotionAccepted =>
        move(c, j, PublishingHandoff, "promotion-accepted", ["PublishHandoff"])
      | HandoffPublicationUnproven =>
        move(withTicket(c, j, { ...c.tickets.get(j),
          resumeAt: ResumePublishingHandoff }),
          j, HandoffBlocked, "handoff-blocked", ["OpenHumanTask"])
    }

  pure def decideAbandonHandoff(c: Core, j: int): Decision =
    val doomedByJ = range(1, N_TICKETS + 1).foldl(Set(j), (dset, _) =>
      dset.union(c.tickets.keys().filter(k =>
        c.tickets.get(k).deps.exists(d => dset.contains(d)))))
    val abandoned = doomedByJ.filter(k => or {
      k == j,
      c.tickets.get(k).phase == Pending
    })
    val abandonedList = range(1, N_TICKETS * 2 + 1).foldl([], (l, k) =>
      if (abandoned.contains(k)) l.append(k) else l)
    { rec: {
        label: "handoff-abandoned",
        transitions: abandonedList.foldl([], (l, k) =>
          l.append({ ticket: k, from: c.tickets.get(k).phase, to: Abandoned })),
        effects: []},
      post: { ...c, tickets: c.tickets.keys().mapBy(k =>
        if (abandoned.contains(k))
          { ...c.tickets.get(k), phase: Abandoned,
            resumeAt: NoResume, reason: NoReason }
        else c.tickets.get(k)) } }

  /// Infrastructure cannot execute the current logical task set. Retire its
  /// outstanding tasks as Cancelled, preserve the source phase as the resume
  /// target, and open the native human action without claiming failed work.
  pure def decideExecutionBlocked(c: Core, j: int, why: Reason): Decision =
    val at = match c.tickets.get(j).phase {
      | Working => ResumeWorking
      | Evaluating => ResumeEvaluating
      | _ => NoResume
    }
    escalate(c, j, at, why, "ticket-escalated execution_blocked")

  /// Operator Retry on a parked ticket: resume at the point the wall stamped,
  /// metered by resumeCharge (configurable, default charge). This is THE
  /// operator resume — one decider, a flavor per resume point,
  /// one trace label ("ticket-resumed"; the flavor is visible in the
  /// transition's target):
  ///   ResumeWorking: respawn the work set; always pays gas.
  ///   ResumeEvaluating: A FRESH FAN-OUT OF THE LOWEST STAGE — re-enter
  ///     evaluation against the intact artifact with a fresh eval fan-out;
  ///     stages are never resumed mid-sequence. New ids: the retried tasks
  ///     are NEW records, the failed ones stay retired in the log.
  ///   ResumeFinalizing: request a fresh finalization attempt.
  /// Under RetryFree the Evaluating/Finalizing resumes join the CHURN set —
  /// a known livelock kept reproducible by configuration.
  pure def decideResumeTicket(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    val resumed = { ...jb,
      reason: NoReason, resumeAt: NoResume,
      gasLeft: jb.gasLeft - resumeCharge(jb, jb.resumeAt) }
    match jb.resumeAt {
      | ResumeWorking =>
        move(withTicket(c, j, spawnOn(resumed, Work, resumed.workFanout)),
          j, Working, "ticket-resumed", ["SpawnWorkTasks"])
      | ResumeEvaluating =>
        move(withTicket(c, j, spawnOn(resumed, Evaluation(0), jb.program[0].fanout)),
          j, Evaluating, "ticket-resumed", ["SpawnEvalTasks"])
      | ResumeFinalizing =>
        move(withTicket(c, j, resumed), j, Finalizing, "ticket-resumed", ["RunFinalizer"])
      | ResumePublishingHandoff =>
        move(withTicket(c, j, resumed), j, PublishingHandoff,
          "ticket-resumed", ["PublishHandoff"])
      | NoResume =>
        // Unreachable: retryableIn refuses a ticket with no modeled resume
        // (the dependency_revoked wall — its only exit is revoke).
        { rec: { label: "ticket-resume-refused", transitions: [], effects: []}, post: c }
    }

  // ==========================================================================
  // === State + actions ======================================================
  // ==========================================================================

  var tickets: int -> Ticket
  /// The last decision's StepRecord — the golden-trace-shaped observation
  /// (standing rule 4: the model emits golden traces from day one).
  var lastStep: StepRecord
  /// GHOST: sysMeasure of the PREVIOUS state, written by every action, read
  /// only by stepDescends.
  var prevMeasure: int
  /// GHOST: the PREVIOUS state's retained task records, per ticket —
  /// written by every action, read only by recordMonotone (the
  /// retained-record monotonicity invariant needs one step of history,
  /// exactly like stepDescends needs prevMeasure).
  var prevRecords: int -> List[Task]

  val core: Core = { tickets: tickets }
  val currentMeasure: int = sysMeasure(bounds, tickets)
  /// The current records snapshot the ghost carries forward each step.
  val currentRecords: int -> List[Task] =
    tickets.keys().mapBy(j => tickets.get(j).record)

  /// Released ticket identities. Ordering has no semantic meaning.
  val liveTickets: Set[int] = tickets.keys()

  action apply(d: Decision): bool = all {
    tickets' = d.post.tickets,
    lastStep' = d.rec,
    prevMeasure' = currentMeasure,
    prevRecords' = currentRecords
  }

  /// REFINEMENT-LAYER SEAM (the refinement layer — the state-shaped counterpart
  /// of the Core-parameterized enablement exports above): install an
  /// externally reconstructed Core WITHOUT taking a domain step. The
  /// refinement module's executor/crash actions (refinement.qnt emitNext /
  /// crashRecover / effectCrash) are NOT domain steps — the domain trace
  /// has no row for them — so both step-history ghosts stay STALE (they
  /// keep describing the last real decision, which keeps every
  /// lastStep/ghost invariant's verdict byte-identical across the
  /// refinement-layer step; `apply` would re-snapshot them and falsely
  /// present the crash as a flat domain step). NOT in `step`'s any{}
  /// roster: the domain machine cannot reach this — only the refinement
  /// layer calls it, and only with a replay of its own journal (under the
  /// journal-then-effect discipline that replay equals the live state —
  /// refinement.qnt recoveryComplete — so the domain vars do not move).
  /// Exported as an action rather than left to the refinement module
  /// because Quint 0.32's instance flattening rejects a primed assignment
  /// of an instance's var from the importing module's own expressions
  /// ("Variable not set" at evaluation) — the assignment must live in the
  /// module that declares the var, exactly like the invariants.
  action installCore(c: Core, rec: StepRecord): bool = all {
    tickets' = c.tickets,
    lastStep' = rec,
    prevMeasure' = prevMeasure,
    prevRecords' = prevRecords
  }

  // --- Derived waiting room (standing rule 3: derive, don't store) ---------
  // Blocked and Ready are PREDICATES over deps + record, not phases.
  // Storing them is what forces an unblock cascade; chuggy stores only
  // Pending and derives the split, so the
  // unblock cascade disappears entirely — there is no Blocked->Ready edge
  // to model or to get wrong. (The open-human-task flag is derived too:
  // measure.qnt hasOpenHumanTask; the eval-stage index is derived from
  // the live set's kind marks: measure.qnt evalStage.) The model extends them
  // for free: a Pending dependency is simply not Done and blocks with no
  // new machinery; the pure bodies live with
  // the deciders (isReadyIn/isBlockedIn) so unit tests can pin exactly
  // that.

  def isReady(j: int): bool = isReadyIn(core, j)

  def isBlocked(j: int): bool = isBlockedIn(core, j)

  // --- Enablement sets ------------------------------------------------------

  // Each enablement val below REFERENCES its pure Core form (the
  // refinement PR's hoist — see the Core-parameterized enablement section
  // with the deciders): one definition, consumed by the machine's
  // actions, the witness drivers, and the journal replay checker alike.

  /// Room for one more release (the N_TICKETS release bound keeps the state
  val releasableIds: Set[int] = ticketIdUniverse.filter(j => canReleaseIn(core, j))
  /// Tickets a new release may depend on: no tombstones — neither Revoked nor
  /// cascade-parked (which, by cascadeSafety, is exactly the
  val dependableTickets: Set[int] = dependableIn(core)
  /// The only authoring phase, hence the only
  /// releasable set: a ticket is released from Pending and nowhere else.
  /// Every non-terminal may be revoked.
  val revocableTickets: Set[int] = revocablesIn(core)
  val readyTickets: Set[int] = readiesIn(core)
  /// Tickets whose task set can receive completion events (real or duplicate).
  val taskPhaseTickets: Set[int] = taskPhaseIn(core)
  val reducibleWork: Set[int] = reducibleWorkIn(core)
  val reducibleEval: Set[int] = reducibleEvalIn(core)
  val finalizerTickets: Set[int] = liveTickets.filter(j =>
    Set(Finalizing, PublishingHandoff).contains(tickets.get(j).phase))
  val doneTickets: Set[int] = doneIn(core)
  /// Parked tickets the operator may Retry (retryableIn: a modeled resume
  /// exists and is affordable). Under RetryCharged a charging resume with
  /// zero gas parks the ticket permanently. The dependency_revoked wall
  /// never is retryable (resumeAt
  /// NoResume — its only exit is revoke).
  val retryableEscalated: Set[int] = retryablesIn(core)

  /// No machine, operator, or author action can move anything.  shrank
  /// this dramatically: revoke is enabled on EVERY non-terminal (table
  /// lines 47-48), so unretryable parks and doomed Pending chains are
  /// all still actionable — the only true dead end is a
  /// fully-released fleet in which every ticket is settled in a terminal
  /// (Done or Revoked). The `settled` stutter covers exactly that state so
  /// runs never deadlock.
  val quiet: bool = and {
    releasableIds.size() == 0,
    liveTickets.forall(j => Set(Done, Abandoned, Revoked).contains(tickets.get(j).phase))
  }

  // --- init -----------------------------------------------------------------

  /// The fleet starts EMPTY: authoring is the ticket source now —
  /// the static nondet DAG is fully replaced by `release`, which grows
  /// the fleet one Pending at a time through the freshTicket seam (deps still
  /// acyclic by construction: they may only point at already-released,
  /// strictly smaller ids).
  /// The `GAS >= 1` conjunct is the required-account rule as a
  /// validity condition: a gasless instantiation has NO initial state —
  /// the graph is invalid, not merely unmetered (every release funds a
  /// ticket from this grant, so checking it here still gates every ticket ever
  /// created). the model `MAX_STAGES >= 1`: a machine that admits no
  /// well-formed eval program admits no tickets either.
  action init = all {
    GAS >= 1,            // the required account
    N_TASKS >= 1,        // well-formedness: a phase carries a real task set
    N_TICKETS >= 1,         // the release bound must admit at least one ticket
    MAX_STAGES >= 1,     // at least one authorable program must exist
    reworkBudget(REWORK_POLICY) >= 0,
    finalizationBudget(FINALIZATION_PRICING) >= 0,
    tickets' = Map(),
    lastStep' = { label: "init", transitions: [], effects: []},
    prevMeasure' = 0,
    prevRecords' = Map()
  }

  // --- actions --------------------------------------------------------------

  /// A new ticket is released as Pending with a nondeterministic subset of
  /// dependable existing tickets, a well-formed evaluation program and an
  /// immutable ticket-local policy. The final draw is the wrap-up choice,
  /// which decides whether this
  /// ticket ever reaches a wrap-up phase — a NoFinalizer release completes on
  /// its passing evaluation and takes no lease. AUTHORING
  /// set in the measure: climbs by the fresh Pending's whole ticketMeasure,
  /// bounded by N_TICKETS.
  action releaseTicket = all {
    releasableIds.size() > 0,
    nondet j = releasableIds.oneOf()
    nondet deps_ = dependableTickets.powerset().oneOf()
    nondet prog = validPrograms.oneOf()
    nondet workFanout_ = workFanoutChoices.oneOf()
    nondet reworkPolicy_ = reworkPolicyChoices.oneOf()
    nondet finalizationPricing_ = finalizationPricingChoices.oneOf()
    nondet resumePricing_ = resumePricingChoices.oneOf()
    nondet finalizer_ = finalizerChoices.oneOf()
    apply(decideReleaseTicket(core, j, deps_, prog, workFanout_, reworkPolicy_,
      finalizationPricing_, resumePricing_, finalizer_))
  }

  /// Author revokes any non-terminal ticket; the atomic
  /// cascade parks every pre-flight transitive dependent with its own desk
  /// task (decideRevoke — the model).
  action revoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    apply(decideRevoke(core, j))
  }

  /// Ready -> Working: THE AGENTIC SELECTOR'S PICK. The
  /// nondet choice below IS the selector — an agentic component whose
  /// selection among Ready tickets is a real decision, not scheduler noise
  /// (see decideDispatch's header for the full agency note); the recorded
  /// `dispatch` step is its decision event in the golden trace.
  /// Scheduling/quota below the pick stays trusted fabric (no bespoke
  /// scheduler) — no slot count, no queue order, no
  /// fairness. Pending tickets have never spent gas (release grants the full
  /// GAS and authoring charges nothing), so gas >= 1 here whenever init
  /// accepted the configuration; the guard keeps it structural — stated
  /// once, in dispatchableIn, which the witness drivers reference too
  /// (guards are shared, never copied — see dispatchableIn's header).
  action dispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    all {
      dispatchableIn(core, j),
      apply(decideDispatch(core, j))
    }
  }

  /// A task-completion event is released for ANY task the ticket EVER SPAWNED —
  /// live (real resolution or duplicate of a resolved one) or already
  /// retired to the record (a stale delivery from an earlier stage or
  /// incarnation). One action models all of it because the fabric is
  /// at-least-once: the machine cannot choose to not receive duplicates.
  ///
  /// Duplicate-adversary SCOPE: the tid
  /// range below (deliverableTaskIds — the shared definition the witness
  /// drivers reference too) is the ticket's ENTIRE task history — ids are sequential
  /// within the ticket and never reused, so a
  /// stale completion from an earlier STAGE or incarnation names a retired
  /// id and no-ops BY IDENTITY (decideTaskDone finds no live outstanding
  /// match). This RETIRES the weaker absorption argument (a stale
  /// same-id completion was indistinguishable from a fresh nondet verdict
  /// on the respawned set) — staleness is now absorbed structurally, and
  /// the only remaining first-write-wins case is a duplicate delivery for
  /// a LIVE resolved task. A stale TICKET COMPLETION still implies a success
  /// occurred, and Done is absorbing (completionRedelivery). The observed/actual
  /// split that would make mid-rework duplicates dangerous — a decider
  /// acting on a stale VIEW — is exactly the deferred §4 refinement layer
  /// (reconcile vs journaled-actor), not this shared domain layer. the
  /// A sharper corner: a ticket revoked
  /// OUT of Finalizing (enqueued) or Finalizing (the gate mid-validation) could
  /// race an in-flight merge in the real system — in-model
  /// revokedNeverCompletes holds structurally (a revoked ticket leaves
  /// holdingTickets/finalizerStartable, so neither wrap-up action can resolve
  /// it, and the revoke frees the slot by phase); the real revoke/merge
  /// race — the candidate already advancing when the revoke lands — is
  /// record-vs-effect atomicity, the §4 refinement layer.
  action taskDone = all {
    taskPhaseTickets.size() > 0,
    nondet j = taskPhaseTickets.oneOf()
    nondet tid = tickets.get(j).tasks.filter(t => t.state == Outstanding).map(t => t.id).oneOf()
    nondet v = Set(Pass, Fail).oneOf()
    apply(decideTaskDone(core, j, tid, v))
  }

  action workReduce = all {
    reducibleWork.size() > 0,
    nondet j = reducibleWork.oneOf()
    apply(decideWorkReduce(core, j))
  }

  /// The current eval STAGE's task set fully resolved: run the interpreter
  /// over the ticket's authored program (advance / pass / short-circuit —
  /// decideEvalStageReduce).
  action evalReduce = all {
    reducibleEval.size() > 0,
    nondet j = reducibleEval.oneOf()
    apply(decideEvalStageReduce(core, j))
  }

  /// The external finalizer returns one conclusive domain result. Queueing,
  /// approval, permits and implementation are durable operational state.
  action finalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet out = finalizationOutcomes.oneOf()
    all {
      finalizationOutcomeEnabled(core, j, out),
      apply(decideFinalizationResult(core, j, out))
    }
  }

  action abandonHandoff = all {
    liveTickets.exists(k => tickets.get(k).phase == HandoffBlocked),
    nondet j = liveTickets.filter(k => tickets.get(k).phase == HandoffBlocked).oneOf()
    apply(decideAbandonHandoff(core, j))
  }

  action executionBlocked = all {
    taskPhaseTickets.size() > 0,
    nondet j = taskPhaseTickets.oneOf()
    nondet why = Set(ExecutionPolicyDenied, TicketConfigIncompatible,
      ExecutionProfileUnavailable, RuntimeVersionUnsupported,
      RequiredCapabilityUnavailable).oneOf()
    apply(decideExecutionBlocked(core, j, why))
  }

  /// One resume action for every retryable park.
  action resumeTicket = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    apply(decideResumeTicket(core, j))
  }

  /// The dead-end stutter (STUTTER set): keeps quiet states from
  /// deadlocking the simulator.
  action settle = all {
    quiet,
    tickets' = tickets,
    lastStep' = { label: "settled", transitions: [], effects: []},
    prevMeasure' = currentMeasure,
    prevRecords' = currentRecords
  }

  action step = any {
    releaseTicket,
    revoke,
    dispatch,
    taskDone,
    workReduce,
    evalReduce,
    finalizationResult,
    abandonHandoff,
    executionBlocked,
    resumeTicket,
    settle
  }

  // ==========================================================================
  // === Invariants ===========================================================
  // ==========================================================================
  // Inside the machine module (Quint 0.32: a separate module cannot see
  // instantiated vars), re-exposed to --main
  // scope through each mc instance's wildcard import.

  /// THE headline property, effect-only: exactly one completion per
  /// cycle, proved at the completion boundary and nowhere else —
  /// any number of task executions may duplicate (at-least-once fabric),
  /// but the completion effect is emitted exactly once per ticket, exactly
  /// when it is Done. "Per cycle" collapses to "per ticket" because a
  /// completion effect ends the ticket (Done is absorbing) and failed
  /// completions emit no completion effect. DELIBERATELY UNCHANGED — per-ticket
  /// exclusivity is strictly stronger than any per-project form (exactly one
  /// completion per ticket implies at most one per ticket per project), so the
  /// A withdrawn extension covered groups — a marked Done ticket
  /// having completed via its lead's completion, emitting nothing of its own.
  /// That extension is WITHDRAWN with the grouping removal, and the
  /// invariant reverts to its plain form: Done iff exactly one completion
  /// effect, with no mark conjunct to carve out.
  val completionExclusive: bool = liveTickets.forall(j => and {
    tickets.get(j).completions <= 1,
    (tickets.get(j).completions == 1) iff (tickets.get(j).phase == Done)
  })

  /// REVOKED NEVER COMPLETES: a revoked ticket
  /// has emitted no completion effect — and never will: Revoked is absorbing
  /// (terminalsAbsorbing), no decider touches a revoked
  /// ticket's `completions`. Post-evaluation phases are deliberately not revocable. Stated as its own named
  /// invariant because it is the model's exclusivity half, though
  /// state-wise it is a corollary of completionExclusive (completions = 1 iff
  /// Done, completions <= 1, Revoked != Done ⇒ completions = 0) — same
  /// stated-corollary treatment as stuckSubsetCovered.
  val revokedNeverCompletes: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Revoked) implies (tickets.get(j).completions == 0))

  /// A NoFinalizer ticket never enters Finalizing.
  val noFinalizationWithoutAKind: bool = liveTickets.forall(j =>
    (tickets.get(j).finalizer == NoFinalizer) implies and {
      not(Set(Finalizing, PublishingHandoff, HandoffBlocked).contains(
        tickets.get(j).phase))
    })

  /// A COMPLETED TICKET PRODUCED SOMETHING (design 002). Deliberately the
  /// weak form: an artifact exists by the time a ticket is Done. The
  /// tempting stronger claim — that what was committed is what was
  /// evaluated — would be TRUE BY CONSTRUCTION, since the phase machine
  /// forbids work between eval-passed and wrap-up, and an invariant that
  /// cannot fail is the stuckSubsetCovered defect written on purpose.
  /// A Revoked ticket may hold NoArtifact: it may never have run.
  val artifactWellFormed: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Done) implies (tickets.get(j).artifact != NoArtifact))

  /// Every released ticket carries one supported wrap-up kind.
  val finalizerWellFormed: bool = liveTickets.forall(j =>
    finalizerChoices.contains(tickets.get(j).finalizer))

  /// The absorbing terminals never transition OUT.
  /// Both carry it here, because Revoked is reachable.
  val terminalsAbsorbing: bool =
    lastStep.transitions.foldl(true, (b, t) =>
      b and t.from != Done and t.from != Abandoned and t.from != Revoked)

  /// The human desk is consistent. The reason-iff-parked half is a named
  /// wall iff parked — and parked just IS Escalated. The resumeAt half is
  /// the sharper one: a resume point iff a MODELED RESUME
  /// EXISTS — every retryable wall stamps one. DependencyRevoked is the
  /// exception: its resumeAt stays NoResume because its only
  /// modeled exit is revoke (retryableIn). (The open-task flag needs no
  /// conjunct — it is DERIVED from the phase, standing rule 3.)
  /// note: Revoked passes both iffs with NoReason/NoResume — "Revoked runs
  /// nothing" is this invariant plus tasksWellFormed doing their existing
  /// tickets over the phase.
  val deskConsistent: bool = liveTickets.forall(j => and {
    (tickets.get(j).phase == Escalated) iff (tickets.get(j).reason != NoReason),
    (tickets.get(j).resumeAt != NoResume) iff
      ((tickets.get(j).phase == Escalated and
        tickets.get(j).reason != DependencyRevoked) or
       tickets.get(j).phase == HandoffBlocked)
  })

  /// The gate-budget wall exists only under Budgeted pricing (the wall
  /// vocabulary is carried; the pricing is a parameter).
  val finalizerWallNamed: bool = liveTickets.forall(j =>
    match tickets.get(j).finalizationPricing {
      | Budgeted(_) => true
      | DeadlineOnly => tickets.get(j).reason != FinalizationBudgetExhausted
    })

  /// Every account stays a resource: bounded below by 0 (nothing
  /// overdraws) and above by its grant (nothing refunds). revoke and
  /// the cascade move through here untouched — no gas charged, no budget
  /// spent, no refund (the no-budget-leakage half of the gate; the exact
  /// account-by-account equality is pinned in tests/chuggy_test.qnt).
  /// Stage advances move through here untouched too — stage progress
  /// is priced by the MEASURE's stage digit, not by any account; only a
  /// stage FAILURE (the short-circuit into rework) spends.
  val accountsBounded: bool = liveTickets.forall(j => and {
    tickets.get(j).gasLeft >= 0, tickets.get(j).gasLeft <= GAS,
    tickets.get(j).reworkLeft >= 0,
    tickets.get(j).reworkLeft <= reworkBudget(tickets.get(j).reworkPolicy),
    tickets.get(j).finalizationLeft >= 0,
    tickets.get(j).finalizationLeft <= finalizationBudget(tickets.get(j).finalizationPricing)
  })

  /// The LIVE task set is exactly the current phase's anatomy (this is
  /// also the STAGE-INDEX SANITY invariant):
  ///   - Working: the single work set — width N_TASKS, all Work;
  ///   - Evaluating: ONE stage's fan-out — uniformly Evaluation(s) for a
  ///     single s that indexes INTO the program (0 <= s < |program|), with
  ///     exactly that stage's declared width (the interpreter is running
  ///     the program as written, not improvising);
  ///   - every other phase: empty — dead live-task state is never carried
  ///     (derive-don't-store spirit; a Pending has not spawned,
  ///     Revoked runs nothing).
  /// In the task phases the live ids are the contiguous run directly above
  /// the retired record (identity is sequential within the ticket — the
  /// at-least-once-by-identity argument needs exactly this), and Cancelled
  /// never appears live (it is a retirement mark, not an outcome events
  /// can deliver).
  val tasksWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    val start = jb.record.length() + firstTaskId
    if (jb.phase == Working) and {
      jb.tasks.size() == jb.workFanout,
      jb.tasks.map(t => t.id) == start.to(start + jb.workFanout - 1),
      jb.tasks.forall(t => t.kind == Work and t.state != Resolved(Cancelled))
    } else if (jb.phase == Evaluating)
      val s = evalStage(jb.tasks)
      and {
        s >= 0,
        s < jb.program.length(),
        jb.tasks.forall(t => t.kind == Evaluation(s) and t.state != Resolved(Cancelled)),
        jb.tasks.size() == jb.program[s].fanout,
        jb.tasks.map(t => t.id) == start.to(start + jb.tasks.size() - 1)
      }
    else jb.tasks == Set())

  /// THE RETAINED RECORD is well-formed: entry i carries id i+1
  /// (the chronological log IS the identity order, 1-indexed), nothing
  /// retired is still
  /// outstanding — the record is the RESOLVED log, every entry Resolved
  /// (Passed/Failed by verdict, Cancelled by revoke; the
  /// explicit lifecycle makes this a constructor check, not an
  /// outcome-sentinel comparison) — and every retired eval task names a
  /// stage its ticket's program actually has (programs are immutable, so
  /// history never dangles).
  val recordWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    and {
      jb.record.indices().forall(i => jb.record[i].id == i + firstTaskId),
      jb.record.indices().forall(i => jb.record[i].state != Outstanding),
      jb.record.indices().forall(i =>
        match jb.record[i].kind {
          | Work => true
          | Evaluation(s) => s >= 0 and s < jb.program.length()
        })
    })

  /// RETAINED-RECORD MONOTONICITY: the task record is append-only
  /// history — against the previous state (ghost prevRecords), every ticket's
  /// record still starts with exactly what it was: nothing shrinks,
  /// nothing settled is ever rewritten (outcome, kind, or id). Checked
  /// step-wise like stepDescends; with it, "retained" is a theorem, not a
  /// convention. (Tickets are never deleted, so prevRecords' domain always
  /// survives into liveTickets.)
  val recordMonotone: bool = prevRecords.keys().forall(j => and {
    liveTickets.contains(j),
    tickets.get(j).record.length() >= prevRecords.get(j).length(),
    prevRecords.get(j).indices().forall(i =>
      tickets.get(j).record[i] == prevRecords.get(j)[i])
  })

  /// IDENTITY ACCOUNTING: every task a ticket ever
  /// spawned is STILL somewhere — retired in the record or live in the
  /// set. The ghost spawn counter (measure.qnt Ticket.spawned, bumped by
  /// every spawnOn) equals record + live exactly, which makes
  /// history-unique sequential identity a machine-checked theorem: a
  /// mutant decider that DROPPED a task set instead of retiring it (e.g.
  /// escalate clearing tasks without the retireLive) would leave spawned
  /// strictly greater in the very next state — invisible to
  /// tasksWellFormed/recordWellFormed (both look at surviving state, not
  /// at what vanished), caught here.
  val idsAccounted: bool = liveTickets.forall(j =>
    tickets.get(j).spawned ==
      tickets.get(j).record.length() + tickets.get(j).tasks.size())

  /// PROGRAM WELL-FORMEDNESS: every live ticket carries a well-formed
  /// eval program — non-empty, at most MAX_STAGES stages, every fan-out in
  /// 1..N_TASKS. Holding in EVERY reachable state is the release-refusal
  /// callers draw from validPrograms) and are never rewritten, so an
  /// ill-formed program is refused at authoring time or never exists.
  val programsWellFormed: bool = liveTickets.forall(j =>
    val p = tickets.get(j).program
    and {
      p.length() >= 1,
      p.length() <= MAX_STAGES,
      p.indices().forall(i => p[i].fanout >= 1 and p[i].fanout <= N_TASKS)
    })

  def dependencyClosure(j: int): Set[int] =
    range(1, N_TICKETS + 1).foldl(tickets.get(j).deps, (seen, _) =>
      seen.union(seen.map(d => tickets.get(d).deps).flatten()))

  val depsAcyclic: bool = liveTickets.forall(j => and {
    tickets.get(j).deps.subseteq(liveTickets),
    not(dependencyClosure(j).contains(j))
  })

  /// Identity membership and ticket count are bounded independently.
  val ticketIdsWellFormed: bool = and {
    liveTickets.subseteq(ticketIdUniverse),
    liveTickets.size() <= N_TICKETS
  }

  // --- Visibility -----------------------------------------------------------

  /// THE VISIBILITY EDGES: the walk's edge relation is the DEPENDENCY
  /// edges, and only those. A withdrawn revision added the group's
  /// The walks below are bounded monotone fixpoints over actual keys, so
  /// sparse or numerically reversed edges behave identically.
  def visEdges(j: int): Set[int] = tickets.get(j).deps

  /// Tickets whose own measure cannot descend without a human: parked on
  /// the desk, or Pending behind a dependency chain containing a parked
  /// ticket. A healthy-Blocked ticket is deliberately NOT stuck — its
  /// measure sits flat while its deps run, but it progresses VICARIOUSLY.
  ///
  /// CONTESTED DEFINITION: "non-progressing" is defined here via
  /// measure-descent, the termination measure doing double duty. The
  /// invariant is stated and checked under that reading so it is at least a
  /// theorem candidate; whether it stays a checked theorem or becomes a
  /// dashboard report is open.
  val stuckSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (st, _) =>
      liveTickets.filter(j => or {
        tickets.get(j).phase == Escalated,
        and {
          tickets.get(j).phase == Pending,
          visEdges(j).exists(d => st.contains(d))
        }
      }))

  /// Tickets reachable from an open human task by walking the visibility
  /// edges: the ticket's own desk task (derived — hasOpenHumanTask), or a
  /// desk task somewhere in its dependency chain.
  ///
  ///  note: Revoked contributes NOTHING here (hasOpenHumanTask
  /// excludes it), so a dependent of a revoked ticket can only be covered by
  /// its OWN task — which is exactly what the atomic cascade guarantees
  /// (cascadeSafety below): parked dependents are Escalated, hence in
  /// stuckSet AND covered by themselves; the folds needed no change for
  /// the authoring phase (a Pending is neither stuck — its progress is
  /// the author's, the named AUTHORING conditionality — nor covering).
  /// Coverage propagates through EVERY phase (no phase guard — as before),
  /// over the same edge superset stuckSet walks: stuck ⊆ covered stays a
  /// structural corollary, per sweep.
  val coveredSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (cov, _) =>
      liveTickets.filter(j => or {
        hasOpenHumanTask(tickets.get(j)),
        visEdges(j).exists(d => cov.contains(d))
      }))

  /// THE TWO WALKS AGREE — and that is ALL this says. Renamed from
  /// `deskVisibility` because that name claimed a visibility guarantee
  /// this predicate cannot deliver.
  ///
  /// It is a TAUTOLOGY over the definitions, not a theorem about the
  /// machine. `stuckSet`'s base case is `Escalated`; `coveredSet`'s base
  /// case is `hasOpenHumanTask`, which IS `phase == Escalated` — the same
  /// predicate. Both walk the same `visEdges`, and `stuckSet`'s inductive
  /// arm is `coveredSet`'s plus one conjunct (`Pending`), hence strictly
  /// stronger. So with S and C the two sweep operators: S(X) ⊆ C(X) for
  /// every X, C is monotone, both iterate from Set() for the same number
  /// of sweeps, and stₖ ⊆ covₖ ⟹ stₖ₊₁ = S(stₖ) ⊆ C(stₖ) ⊆ C(covₖ) =
  /// covₖ₊₁. No step of that argument mentions the transition relation:
  /// swap chuggy for any other machine and it still holds. It cannot go
  /// red for any machine, which is exactly why the deadlock absorption
  /// could build sailed past it (the grouping removal's finding).
  ///
  /// KEPT IN `allInvariants` ANYWAY, for what it does guard: the two walks
  /// against EACH OTHER. It goes red if a future edit adds a `stuckSet`
  /// base case that is not a desk phase, puts a phase guard on
  /// `coveredSet`'s inductive arm, or reintroduces an edge kind in one
  /// walk but not the other — which is precisely what the
  /// group edges were, and why that PR had to add them to both. It guards
  /// the definitions; it does not guard the machine.
  ///
  /// The machine-checked half is `noStructuralDeadlock` below. The half no
  /// state predicate can carry — unbounded WAITING — is accepted by name
  /// under bounds-work-not-waiting.
  val stuckSubsetCovered: bool = stuckSet.subseteq(coveredSet)

  // --- Cascade safety (THE  gate) ---------------------------------------

  /// Tickets transitively doomed by a revocation: a Revoked ticket somewhere in
  /// the dependency closure means this ticket can never unblock (a dep that
  /// is not Done blocks, and Revoked never becomes Done). The bounded
  /// fixpoint is independent of numeric identity order.
  val revokeDoomed: Set[int] =
    range(1, N_TICKETS + 1).foldl(
      liveTickets.filter(j => tickets.get(j).phase == Revoked), (dset, _) =>
        dset.union(liveTickets.filter(j =>
          tickets.get(j).deps.exists(d => dset.contains(d)))))
      .filter(j => tickets.get(j).phase != Revoked)

  /// Tickets with a REACHABLE route to Done — a least fixpoint UPWARD from
  /// the terminal, deliberately the opposite direction from stuckSet: Done
  /// has finished, and a non-Revoked ticket every one of whose gate deps
  /// can finish can finish too. It recurses over waitsOn, the same
  /// relation the dispatch gate reads.
  ///
  /// WHY UPWARD (the grouping lesson): stuckSet grows outward from a base
  /// case (Escalated), and a dependency CYCLE has no base case — which is
  /// structurally why no phase added to that base could ever have seen the
  /// deadlock absorption could build. A cycle's members each wait on the
  /// other, so neither's forall is ever satisfied and both simply never
  /// enter this fixpoint. Membership is over-approximate on purpose (an
  /// out-of-gas Escalated ticket is "able" here and covered by the desk
  /// disjunct below): this is a deadlock net, not a liveness oracle.
  val canFinishSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (cf, _) =>
      liveTickets.filter(j => or {
        tickets.get(j).phase == Done,
        and {
          tickets.get(j).phase != Revoked,
          tickets.get(j).phase != Abandoned,
          waitsOn(core, j).forall(d => cf.contains(d))
        }
      }))

  /// NO STRUCTURAL DEADLOCK: every live ticket can still reach Done, or was
  /// settled by its author (Revoked), or holds an open desk task a human
  /// can act on. This is the half of the visibility question that IS a
  /// state theorem — a ticket with no continuation at all is a defect in
  /// every reading, whatever anyone accepts about WAITING (an abandoned
  /// Pending, an unpicked dispatch, an unwon dequeue all still have
  /// continuations, so none of them is flagged here — see
  /// bounds-work-not-waiting).
  ///
  /// Unlike stuckSubsetCovered this is NOT definitional: canFinishSet
  /// recurses on gate deps and Done-ness, coverage recurses on
  /// escalations, so the containment is a claim about the machine. Its
  /// teeth are demonstrated against a real defect rather than argued.
  val noStructuralDeadlock: bool = liveTickets.forall(j => or {
    canFinishSet.contains(j),
    tickets.get(j).phase == Revoked,
    tickets.get(j).phase == Abandoned,
    hasOpenHumanTask(tickets.get(j))
  })

  /// CASCADE SAFETY (stuckSubsetCovered's style, revoke's content): every ticket
  /// transitively stuck behind a Revoked dep is parked with its own open
  /// human task (Escalated, wall dependency_revoked — hasOpenHumanTask
  /// derives the task) or is itself revoked (its author settled it too).
  /// "Eventually parked" strengthens to ALWAYS-parked
  /// because the cascade is atomic with the revoke (decideRevoke): there
  /// is no reachable in-between state where a doomed ticket waits invisibly.
  /// No ticket may wait invisibly forever behind a revoked dep — and since
  /// Revoked opens no task (the author's settled choice), this invariant
  /// is the coverage the walks cannot provide through the dep itself.
  /// NON-VACUITY: the model gate pins a machine trace where the
  /// cascade actually parks dependents (cascadeParkNever — deterministic
  ///, tests/chuggy_witness_test.qnt), and
  /// tests/chuggy_test.qnt walks a 3-ticket chain end-to-end.
  val cascadeSafety: bool = revokeDoomed.forall(j => or {
    tickets.get(j).phase == Revoked,
    tickets.get(j).phase == Escalated and tickets.get(j).reason == DependencyRevoked
  })

  // --- Measure descent (per-ticket liveness, sketched) -------------------------

  /// Well-foundedness half: the measure is bounded below (follows from
  /// accountsBounded, checked directly for the descent argument's own
  /// integrity).
  val measureNonNegative: bool = currentMeasure >= 0

  /// Descent half: every step strictly decreases sysMeasure EXCEPT the
  /// named STUTTER, CHURN, and AUTHORING sets (measure.qnt header) —
  /// checked by label against the ghost prevMeasure. Under the default
  /// RetryCharged pricing there is no resume churn; release descends
  /// unconditionally. There is NO
  /// exemption for the stage advance either: eval-stage-passed must
  /// strictly descend like any other progress step — that is the stage
  /// digit earning its keep.
  ///
  /// NORMATIVE CONVENTION: NO EXEMPTION ARM
  /// WITHOUT A DETERMINISTIC WITNESS RUN THAT FIRES IT. An arm below that
  /// no deterministic machine trace exercises is either dead code or an
  /// unreviewed weakening of the descent theorem — and the missing run is
  /// the review hook that makes either visible: a PR that adds or widens
  /// an arm here must add the tests/chuggy_witness_test.qnt step that
  /// fires it (asserting allInvariants on that step, so the arm is proved
  /// to exempt exactly the climb it names). Current roster:
  ///   init                  — every run's first step;
  ///   settled               — the quiet fleet's stutter;
  ///   ticket-resumed, RetryFree pipeline flavor
  ///                         — freeClimbDeterministicTest's climbing step;
  ///   ticket-released       — every run's releases;
  ///   ticket-revoked, desk-only flat
  ///                         — cascadeParkDeterministicTest's second revoke.
  val stepDescends: bool =
    val exempt = or {
      lastStep.label == "init",
      // STUTTER: the dead-end self-loop.
      lastStep.label == "settled",
      // CHURN: only RetryFree pipeline resumes are uncharged. Working
      // resumes always pay, so they must strictly descend.
      and {
        lastStep.label == "ticket-resumed",
        lastStep.transitions.foldl(false, (isFree, t) => or {
          isFree,
          and {
            Set(Evaluating, Finalizing, PublishingHandoff).contains(t.to),
            tickets.get(t.ticket).resumePricing == RetryFree
          }
        })
      },
      // AUTHORING: a ticket entering the fleet
      // climbs by its whole fresh measure (bounded by the N_TICKETS release
      // cap) — and it is the set's ONLY climbing member...
      lastStep.label == "ticket-released",
      // ...and a desk-only revoke is flat: every transition leaves a
      // settled-rank phase (Escalated -> Revoked) and the cascade parked
      // nobody (a cascade park OR a member release drags a non-settled
      // rank down, so the condition below then forces strict descent) —
      // release and every live-rank revoke get NO exemption at all.
      and {
        lastStep.label == "ticket-revoked",
        lastStep.transitions.foldl(true, (b, t) =>
          b and phaseRank(t.from) == rankSettled)
      }
    }
    exempt or currentMeasure < prevMeasure

  /// Both halves, for --invariant runs: the per-ticket termination sketch
  ///.
  val measureDescends: bool = and { measureNonNegative, stepDescends }

  /// ANTI-VACUITY WITNESS, not an invariant of the machine: "no
  /// RetryFree ticket resume into a PIPELINE phase (Evaluating/Finalizer)
  /// ever climbs
  /// the measure". EXPECTED TO BE VIOLATED on the RetryFree instance
  /// (the model gate proves it deterministically by the free-climb machine
  /// trace in tests/chuggy_witness_test.qnt, plus the demoted pinned-seed
  /// probe) — the violation is the
  /// machine-level proof that free pipeline resumes really do climb and
  /// really are exempted by stepDescends' RetryFree CHURN arm, which no
  /// green run could otherwise distinguish from dead code. Under
  /// RetryCharged it must HOLD (every pipeline resume pays gas and
  /// descends).
  val freeClimbNever: bool =
    not(and {
      lastStep.label == "ticket-resumed",
      lastStep.transitions.foldl(false, (b, t) =>
        b or and {
          Set(Evaluating, Finalizing, PublishingHandoff).contains(t.to),
          tickets.get(t.ticket).resumePricing == RetryFree
        }),
      currentMeasure > prevMeasure
    })

  /// ANTI-VACUITY WITNESS #2, not an invariant of the machine: "no
  /// revoke ever parks a dependent". EXPECTED TO BE VIOLATED (check.sh
  /// Stage 9b: deterministically by the cascade machine trace in
  /// tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
  /// — the
  /// violation trace is the machine-level proof that the cascade really
  /// fires on reachable states, so cascadeSafety's green runs are checked
  /// against traces that exercise it (a cascade that never parks would
  /// make cascadeSafety vacuously true wherever revokeDoomed stays empty).
  val cascadeParkNever: bool =
    not(lastStep.label == "ticket-revoked" and lastStep.transitions.length() > 1)

  /// ANTI-VACUITY WITNESS #3, not an invariant of the machine: "no
  /// eval stage ever advances". EXPECTED TO BE VIOLATED (the model gate
  /// shows it deterministically by the stage-advance machine trace in
  /// tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
  /// — a reachable
  /// eval-stage-passed step is the machine-level proof that multi-stage
  /// programs actually run stage-by-stage on machine traces, so the green
  /// invariant runs above are checked against traces where the stage digit
  /// and the interpreter's advance edge are exercised, not vacuous (a
  /// fleet that only ever drew single-stage programs would never take the
  /// edge). The unit tests walk the advance deterministically; this pins
  /// it as REACHABLE.
  val stageAdvanceNever: bool =
    not(lastStep.label == "eval-stage-passed")

  /// All safety invariants, for `--invariant=allInvariants`.
  val allInvariants: bool = and {
    completionExclusive,
    revokedNeverCompletes,
    noFinalizationWithoutAKind,
    artifactWellFormed,
    finalizerWellFormed,
    terminalsAbsorbing,
    deskConsistent,
    finalizerWallNamed,
    accountsBounded,
    tasksWellFormed,
    recordWellFormed,
    recordMonotone,
    idsAccounted,
    programsWellFormed,
    depsAcyclic,
    ticketIdsWellFormed,
    stuckSubsetCovered,
    cascadeSafety,
    noStructuralDeadlock,
    measureDescends
  }
}
