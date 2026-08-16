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
/// THE SHAPE OF A TICKET'S LIFE. It arrives as a Draft, is released into the
/// pipeline, and the dispatcher picks it out of the derived Ready set — which
/// pick is the dispatcher's own agency, not scheduler noise, so any policy
/// refines unrestricted choice. Work runs one task set per cycle. Evaluation
/// runs the ticket's authored program, stage by stage, short-circuiting on a
/// failure into the rework economy. Then the ticket finishes according to its
/// authored wrap-up kind: a WNone ticket's effect already happened during
/// work, so passing evaluation completes it outright; a WExclusive ticket
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
///   - Ticket batching in any form, and cross-project atomic landings. Both
///     are deliberately absent, and nothing here can express either.
///
/// This header describes the machine; it does not narrate how the machine
/// came to be.
module chuggy_domain {
  import chuggy_measure.* from "./measure"

  /// ARRIVAL BOUND: at most N_TICKETS tickets ever arrive; ids are dense
  /// 1..count and never reused, so the live fleet is tickets.keys() ⊆
  /// 1..N_TICKETS. (the model a static graph size; authoring turned
  /// the static graph into bounded arrivals — small in mc instances so the
  /// state space stays small.)
  const N_TICKETS: int
  /// Task fan-out ceiling: the Work phase's single task-set width, AND the
  /// per-stage fan-out cap an authored eval program may declare, since a
  /// ticket carries a SET of possibly-parallel tasks. Stage widths are
  /// per-stage data, so this const is their bound — the measure's
  /// stageWeight radix needs exactly this cap.
  const N_TASKS: int
  /// Eval-rework pricing (the bound is a POLICY PARAMETER on the
  /// WrapUpPricing pattern, not a core-entity constant — RWBudget(n) is the
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
  const WRAPUP_PRICING: WrapUpPricing
  /// Operator-retry metering (configurable per deployment,
  /// default charge — mc instantiates RetryCharged, plus a RetryFree
  /// instance so the free-resume churn path stays exercised).
  const OP_RETRY_PRICING: RetryPricing
  /// Authored-program length cap — the measure's stage radix
  /// (Bounds.maxStages) and arrival's validity ceiling. Real programs are
  /// short by construction (stages are declared per evaluator) — the cap exists for the radix argument,
  /// not as domain vocabulary.
  const MAX_STAGES: int
  /// The size of the bounded project universe a ticket's
  /// authored target is drawn from (small in mc instances: 2 — the
  /// smallest universe where "its OWN project's branch moved" is
  /// distinguishable from "some project's branch moved"). NOT a measure bound: no digit reads the project (measure.qnt, multi-project
  /// header note), and no account is per-project. The single-project world is
  /// N_PROJECTS = 1, under which every draw collapses and the machine is the
  /// pre-multi-project machine with a constant attribution field.
  const N_PROJECTS: int

  /// Every AUTHORABLE wrap-up kind (design 002), the structural-refusal
  /// shape validPrograms and projects already have: an arrival draws from
  /// exactly this set, so a lease on a resource outside the universe cannot
  /// enter a reachable state.
  pure val wrapUpChoices: Set[WrapUp] =
    Set(WNone).union(1.to(N_PROJECTS).map(r => WExclusive(r)))

  /// The project universe: every ticket's authored target project
  /// is a member (projectsWellFormed); arrivals draw from exactly this set.
  pure val projects: Set[int] = 1.to(N_PROJECTS)

  /// The measure's bounds, from this instance's consts.
  pure val bounds: Bounds = {
    reworkPolicy: REWORK_POLICY,
    nTasks: N_TASKS,
    maxStages: MAX_STAGES,
    wrapUpPricing: WRAPUP_PRICING
  }

  /// The stage vocabulary an author may draw from: any fan-out 1..N_TASKS,
  /// either combinator (both branches stay exercisable — the model).
  pure val stageChoices: Set[Stage] =
    tuples(1.to(N_TASKS), Set(CUnanimousPass, CAnyPass))
      .map(t => { fanout: t._1, combinator: t._2 })

  /// Every WELL-FORMED authorable program: non-empty, at most MAX_STAGES
  /// stages, each stage from stageChoices. This set IS the arrival-refusal
  /// rule (programsWellFormed): the empty program, an oversized fan-out,
  /// and an overlong program are not in it, so no arrival can carry one —
  /// the same structural-refusal shape as dependableTickets for deps
  /// (decideArrive's callers guarantee membership; the `arrive` action
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
    [{ fanout: N_TASKS, combinator: CUnanimousPass }]

  /// The ticket-source seam, now CLOSED:
  /// every ticket the machine ever holds is built here, and the only caller is
  /// decideArrive — a ticket is born a Draft, with its full accounts, and
  /// reaches the released pipeline only through decideRelease. The author's
  /// eval PROGRAM arrives with the Draft (eval is data; authoring came
  /// first precisely so programs would have an arrival to ride).
  /// The TARGET PROJECT arrives the same way — authored data
  /// riding the arrival, immutable after, like deps and the program.
  pure def freshTicket(
      deps_: Set[int], prog: List[Stage], project_: int, wrapUp_: WrapUp): Ticket = {
    phase: PDraft,
    deps: deps_,
    program: prog,
    wrapUp: wrapUp_,
    artifact: ANone,
    project: project_,
    tasks: Set(),
    record: [],
    spawned: 0,
    reworkLeft: reworkBudget(REWORK_POLICY),
    wrapUpLeft: wrapUpBudget(WRAPUP_PRICING),
    gasLeft: GAS,
    resumeAt: RNone,
    reason: RsNone,
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
  /// `attempt` is WONone here — only decideWrapUpResolve resolves a
  /// wrap-up attempt, and it stamps its own attribution over this default
  /// (withWrapUpObs).
  pure def move(c: Core, j: int, to_: Phase, label: str, effects_: List[str]): Decision =
    { rec: {
        label: label,
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: to_ }],
        effects: effects_,
        attempt: WONone },
      post: withTicket(c, j, { ...c.tickets.get(j), phase: to_ }) }

  /// A decision that changes nothing — the idempotent answer to duplicate
  /// deliveries (an at-least-once fabric, every effect idempotent). No
  /// wrap-up attempt resolves here (a
  /// duplicate completion delivery absorbs with nothing emitted), so the
  /// attribution field stays WONone.
  pure def noop(c: Core, label: str): Decision =
    { rec: { label: label, transitions: [], effects: [], attempt: WONone }, post: c }

  /// Stamp the wrap-up boundary's attribution on a decision:
  /// decideWrapUpResolve routes EVERY arm through this, so each step that resolves
  /// a wrap-up attempt — both successes, the gate rework, and both
  /// wrap-up walls — carries the target project and the environment's
  /// invalidated choice for that attempt (wrapUpIsolation checks the
  /// iff; the trace consumer gets per-project attribution at exactly the
  /// boundary where the project matters).
  pure def withWrapUpObs(d: Decision, project_: int, moved: bool): Decision =
    { rec: { ...d.rec, attempt: WOAttempt({ project: project_, invalidated: moved }) },
      post: d.post }

  // --- Authoring: arrival, release, revoke ---------------------------------
  // --------------------------------------------------------------------

  /// A ticket ARRIVES as a Draft — the environment (an author) creates it.
  /// Arrival is a real edge, forced by authoring being the ticket source:
  /// a ticket does not exist until an author creates it.
  /// Ids are dense and never reused (next id = fleet size + 1), which keeps
  /// every ascending-id fold below correct. Dependencies may point at ANY
  /// live ticket, released or not (Draft deps block exactly like
  /// not-yet-Done ones) — but never at a tombstone: not a Revoked ticket, and
  /// not a ticket the cascade already parked behind one (Escalated with
  /// dependency_revoked — by cascadeSafety those two cases are EXACTLY the
  /// transitively-doomed tickets). The author cannot depend on either
  /// (authoring-time validation; admitting one would create a ticket doomed
  /// at birth, which cascadeSafety forbids anyone to hold un-parked — the
  /// first random invariant run caught precisely this). Callers guarantee
  /// deps_ ⊆ dependable ids (see `dependableTickets`).
  ///
  /// The arrival also carries the ticket's EVAL PROGRAM, validated the
  /// same structural way — callers guarantee prog ∈ validPrograms, so an
  /// empty program, a zero/oversized fan-out, or an overlong program is
  /// REFUSED at authoring time: no reachable state holds one
  /// (programsWellFormed), rather than the interpreter defending against
  /// one mid-flight. The program is immutable after arrival, like deps.
  ///
  /// Dynamic-DAG boundary: arrivals are AUTHOR actions — only
  /// the environment action `arrive` calls this decider, and no ticket-event
  /// decider creates tickets, so the ticket set grows only by authoring, never by
  /// tickets spawning tickets. Author commands (release/revoke) are also guarded
  /// by enablement, not absorbed as duplicates: authors are command
  /// sources, not the at-least-once fabric — only fabric events get
  /// idempotent stutter deciders.
  ///
  /// The arrival also carries the ticket's TARGET PROJECT —
  /// callers guarantee project_ ∈ projects (the `arrive` action draws from
  /// exactly that set), so an out-of-universe target is refused at
  /// authoring time like an ill-formed program (projectsWellFormed makes the
  /// refusal durable). Deps are NOT constrained by project: the DAG is
  /// orchestrator-level and dependencies may cross projects — the dep gate
  /// downstream (depsDoneIn) reads Done-ness, never location.
  ///
  /// The arrival carries the ticket's WRAP-UP CHOICE last — whether
  /// completion needs a lease, and on which resource. Callers guarantee
  /// wrapUp_ ∈ wrapUpChoices (the `arrive` action draws from exactly that
  /// set), so a lease on a resource outside the universe is refused at
  /// authoring time like an out-of-universe target (wrapUpWellFormed makes
  /// the refusal durable). It is the draw that decides whether the ticket
  /// ever reaches a wrap-up phase at all: WNone completes on its passing
  /// evaluation and takes no lease (noLeaseWithoutAKind). Immutable after
  /// arrival, like deps, the program and the project.
  pure def decideArrive(
      c: Core, deps_: Set[int], prog: List[Stage], project_: int,
      wrapUp_: WrapUp): Decision =
    val id = c.tickets.keys().size() + 1
    { rec: { label: "ticket-arrived", transitions: [], effects: ["CreateDraft"],
        attempt: WONone },
      post: { ...c, tickets: c.tickets.put(id, freshTicket(deps_, prog, project_, wrapUp_)) } }

  /// Draft -> Pending: the ticket enters the released pipeline. There is
  /// one release target rather than a Ready/Blocked pair, because the split
  /// is DERIVED (standing rule 3) — it re-derives from deps the moment the
  /// phase lands. Descends (rank 6 -> 5). Charges nothing: the Working
  /// boundary still meters actual work entry (standing rule 2).
  ///
  /// Release leaves from Draft alone. Pinning a Draft's content before
  /// release is below the model's grain, an implementation concern of the
  /// authoring surface exactly as Draft content edits are, so arrival is
  /// the AUTHORING set's only climbing member (measure.qnt AUTHORING).
  pure def decideRelease(c: Core, j: int): Decision =
    move(c, j, PPending, "ticket-released", [])

  /// Revoke + THE CASCADE. Table provenance for the revoke
  /// edge itself: lines 47-48 `(_, Revoked) => true` — every non-terminal
  /// phase may be revoked (the caller's guard, revocableIn) — and lines
  /// 45-46 `(Done | Revoked, Revoked) => false` — the terminals are
  /// absorbing, so no decider ever moves a ticket OUT of PRevoked (invariant
  /// terminalsAbsorbing). The revoked ticket settles: rank -> 0, live task set
  /// RETIRED into the record (still-running tasks force-closed as
  /// TCancelled; the
  /// record itself is KEPT: provenance survives the author's settlement,
  /// "Revoked runs nothing" ≠ "Revoked remembers nothing"), accounts
  /// UNTOUCHED — revoke charges no gas and spends no budget in either
  /// direction — and reason/resumeAt cleared: PRevoked opens NO human task
  /// (hasOpenHumanTask excludes it; revocation is the author's settled
  /// choice, like PDone).
  ///
  /// THE CASCADE: a ticket whose dep chain
  /// contains a revoked ticket can never unblock (a dep that is not Done
  /// blocks, and PRevoked never becomes PDone). Of the two candidate
  /// semantics —
  ///   (a) transitive cascade-REVOKE: dependents are revoked too;
  ///   (b) PARK: dependents wait on the desk behind a named wall —
  /// chuggy picks (b), ATOMICALLY in this decision, for two reasons.
  /// First, revocation is a per-ticket authorial choice: (a) would
  /// let one author's revocation silently destroy OTHER tickets with no human
  /// decision and no desk trace (a cascade-revoked ticket opens no task — the
  /// exact invisibility the §2 visibility row forbids). Second, parking
  /// preserves desk coverage structurally: every doomed dependent gets its
  /// OWN open task (RsDependencyRevoked) telling a human "your dependency
  /// was revoked; settle me" — and the human settles it by revoking it (its
  /// desk revoke is the AUTHORING flat member in measure.qnt). The park is
  /// atomic with the revoke — same decision, one StepRecord — so
  /// cascadeSafety holds in EVERY reachable state, never just eventually.
  ///
  /// Why parking only PDraft/PPending dependents is exhaustive: a
  /// transitive dependent of a revocable (hence non-Done) ticket can never
  /// have dispatched — dispatch needs all deps Done, Done is absorbing, and
  /// the revoked ancestor is not Done — so every dependent is still
  /// pre-flight: Draft, Pending, or already settled by an earlier cascade
  /// (PEscalated RsDependencyRevoked) or by its own author (PRevoked). The
  /// filter parks exactly the first two and leaves the already-settled
  /// alone (no duplicate transitions). Pre-flight tickets hold
  /// no live tasks, so the cascade retires nothing on the parked side.
  /// The parked wall stamps NO resume point (resumeAt stays RNone): deps
  /// are immutable, so no modeled resume exists — the wall's only exit is
  /// revoke (retryableIn; the deliberate table-line-44 deviation).
  pure def decideRevoke(c: Core, j: int): Decision =
    val n = c.tickets.keys().size()
    // Transitive dependents of j: deps point strictly downward, so one
    // ascending pass decides each id after all its deps (same shape as the
    // revokeDoomed fold).
    val doomedByJ = range(1, n + 1).foldl(Set(), (dset, k) =>
      if (c.tickets.get(k).deps.contains(j) or
          c.tickets.get(k).deps.exists(d => dset.contains(d)))
        dset.union(Set(k)) else dset)
    val parked = doomedByJ.filter(k =>
      val p = c.tickets.get(k).phase
      p == PDraft or p == PPending)
    // Ascending, deterministic order for the golden-trace record.
    val parkedList = range(1, n + 1).foldl([], (l, k) =>
      if (parked.contains(k)) l.append(k) else l)
    { rec: {
        label: "ticket-revoked",
        transitions:
          [{ ticket: j, from: c.tickets.get(j).phase, to: PRevoked }]
            .concat(parkedList.foldl([], (l, k) =>
              l.append({ ticket: k, from: c.tickets.get(k).phase, to: PEscalated }))),
        // "Revoke" for the revoked ticket; one OpenHumanTask per parked
        // dependent — and NONE for the revoked ticket itself.
        effects: ["Revoke"]
          .concat(parkedList.foldl([], (l, k) => l.append("OpenHumanTask"))),
        attempt: WONone },
      post: { ...c, tickets: c.tickets.keys().mapBy(k =>
        if (k == j)
          { ...retireLive(c.tickets.get(k)), phase: PRevoked,
            resumeAt: RNone, reason: RsNone }
        else if (parked.contains(k))
          { ...c.tickets.get(k), phase: PEscalated, reason: RsDependencyRevoked }
        else c.tickets.get(k)) } }

  // --- Pure guard predicates ------

  /// Every phase but the two absorbing terminals may be revoked.
  pure def revocableIn(c: Core, j: int): bool =
    c.tickets.get(j).phase != PDone and c.tickets.get(j).phase != PRevoked

  /// What one operator resume costs, by flavor (with Stalled
  /// merged into Escalated, ONE decider — decideOpRetry — carries every
  /// resume, and this table is its pricing):
  ///   RPending    — 0 under BOTH meterings, deliberately: a pre-work park
  ///                 (revalidation_failed) spent nothing, so its resume
  ///                 charges nothing — the pre-work resume's pricing,
  ///                 kept ("still free", the triage's resume-flavor row);
  ///                 the Working boundary still meters any actual re-entry
  ///                 (standing rule 2). CHURN in the measure.
  ///   RWorking    — 1 always: entry to Working always meters (standing
  ///                 rule 2), even under RetryFree.
  ///   REvaluating/RWrapUp — per OP_RETRY_PRICING (configurable, default
  ///                 charge); RetryFree makes these the reproducible
  ///                 livelock.
  /// RNone falls through the wildcard but is unreachable: retryableIn
  /// refuses it and decideOpRetry's RNone arm is a guarded no-op.
  pure def resumeCharge(at: Resume): int =
    match at {
      | RPending => 0
      | RWorking => 1
      | _ => match OP_RETRY_PRICING { | RetryCharged => 1 | RetryFree => 0 }
    }

  /// May the operator Retry this parked ticket? Parked is PEscalated (the
  /// only desk phase now); a resume must EXIST (resumeAt != RNone) and be
  /// AFFORDABLE (a charging resume needs gas). The one wall with no
  /// modeled resume is dependency_revoked (resumeAt RNone) — a DELIBERATE
  /// RESTRICTION: deps are immutable in this model (no re-authoring
  /// machinery yet), so a retry
  /// could only re-enter Pending still doomed behind the same revoked dep
  /// — a lie to the desk and an immediate cascadeSafety hole. That wall's
  /// only modeled exit is revoke; dep re-authoring is future work (README,
  /// deliberately-absent table).
  pure def retryableIn(c: Core, j: int): bool = and {
    c.tickets.get(j).phase == PEscalated,
    c.tickets.get(j).resumeAt != RNone,
    resumeCharge(c.tickets.get(j).resumeAt) <= c.tickets.get(j).gasLeft
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
  /// stable: every dep is PDone before a dependent can dispatch, and PDone
  /// is absorbing, so nothing here can change under a reader.
  pure def depArtifacts(c: Core, j: int): Set[ArtifactMark] =
    waitsOn(c, j).map(d => c.tickets.get(d).artifact)

  pure def depsDoneIn(c: Core, j: int): bool =
    waitsOn(c, j).forall(k => c.tickets.get(k).phase == PDone)

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

  /// Room for one more arrival (the N_TICKETS arrival bound).
  pure def canArriveIn(c: Core): bool = c.tickets.keys().size() < N_TICKETS

  /// Tickets a new arrival may depend on: no tombstones (decideArrive's
  /// doc has the cascadeSafety argument).
  pure def dependableIn(c: Core): Set[int] = c.tickets.keys().filter(k => and {
    c.tickets.get(k).phase != PRevoked,
    not(c.tickets.get(k).phase == PEscalated and c.tickets.get(k).reason == RsDependencyRevoked)
  })

  /// The only authoring phase, hence the only releasable set.
  pure def draftsIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == PDraft)

  /// Every non-terminal may be revoked.
  pure def revocablesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => revocableIn(c, j))

  /// The derived Ready room (isReadyIn per ticket).
  pure def readiesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => isReadyIn(c, j))

  /// Tickets whose task set can receive completion events.
  pure def taskPhaseIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == PWorking or c.tickets.get(j).phase == PEvaluating)

  pure def reducibleWorkIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == PWorking and runningCount(c.tickets.get(j).tasks) == 0)

  pure def reducibleEvalIn(c: Core): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == PEvaluating and runningCount(c.tickets.get(j).tasks) == 0)

  /// Enqueued tickets whose project's gate is free (the depth-1 refusal).
  pure def wrapUpStartablesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => wrapUpStartableIn(c, j))

  /// The occupied gate slots.
  pure def holdingIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == PWrapUpHolding)

  pure def doneIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == PDone)

  /// Parked tickets the operator may Retry (retryableIn per ticket).
  pure def retryablesIn(c: Core): Set[int] =
    c.tickets.keys().filter(j => retryableIn(c, j))

  /// The derived waiting room (standing rule 3), as pure predicates over a
  /// Core so tests can pin them: a dep that is not Done blocks — including
  /// UNRELEASED deps (Draft, ) and, transiently impossible but
  /// definitionally covered, revoked ones. Location-blind — Done-ness,
  /// never project.
  pure def isReadyIn(c: Core, j: int): bool =
    c.tickets.get(j).phase == PPending and depsDoneIn(c, j)

  pure def isBlockedIn(c: Core, j: int): bool =
    c.tickets.get(j).phase == PPending and not(depsDoneIn(c, j))

  /// May the dispatcher launch ticket j? Ready (the derived waiting room)
  /// with gas to charge — entry to Working always meters (standing rule
  /// 2). Pending tickets have never spent gas (arrival grants the full
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
  /// at-least-once fabric may name (live or retired; ids dense from
  /// firstTaskId, so this is exactly firstTaskId..nextTaskId-1). Shared,
  /// like dispatchableIn, by the `taskDone` action's nondet draw and the
  /// witness drivers' guards (tests/chuggy_witness_test.qnt), so the
  /// range is referenced on both sides, never copied.
  pure def deliverableTaskIds(c: Core, j: int): Set[int] =
    firstTaskId.to(nextTaskId(c.tickets.get(j)) - 1)

  // --- The lease guards ----------------------------------------------------

  /// The resource this ticket's wrap-up needs a lease on. A kind that needs
  /// none answers 0, which no resource universe contains, so it can never
  /// collide with a real holder.
  pure def leaseOf(t: Ticket): int =
    match t.wrapUp { | WNone => 0 | WExclusive(r) => r }

  /// Is resource r unheld? Occupancy is a DERIVED predicate over phase
  /// (derive-don't-store — the whole point of PWrapUpHolding): no ticket
  /// currently holds r. Completion, failure, walls and revoke all release
  /// it by leaving the phase, so nothing cleans up.
  pure def leaseFreeIn(c: Core, r: int): bool =
    c.tickets.keys().forall(k =>
      not(c.tickets.get(k).phase == PWrapUpHolding and leaseOf(c.tickets.get(k)) == r))

  /// May ticket j be DEQUEUED — leave the wrap-up queue and take its
  /// project's gate slot (or fast-path out of it, if the environment draws
  /// the branch quiet)? Enqueued, and the target project's gate free. THE
  /// DEPTH-1 REFUSAL LIVES HERE: while any same-project ticket is PWrapUpHolding,
  /// this guard refuses every other dequeue for that project — pinned as a
  /// guard-refusal on a deterministic machine trace
  /// (tests/chuggy_witness_test.qnt, gate module). Shared by the
  /// `wrapUpStart` action and the witness drivers (guards are referenced,
  /// never copied — the dispatchableIn discipline).
  pure def wrapUpStartableIn(c: Core, j: int): bool = and {
    c.tickets.get(j).phase == PWrapUp,
    leaseFreeIn(c, leaseOf(c.tickets.get(j)))
  }

  /// Park a ticket on the human desk, naming the wall (the termination
  /// requirement commits the terminal, not the names) and where Retry
  /// resumes. The open desk task
  /// is DERIVED from
  /// the phase (hasOpenHumanTask, standing rule 3); "OpenHumanTask" is its
  /// trace-visible effect. this is THE park — the pre-work
  /// revalidation wall comes through here too (decideRevalFail, resume
  /// RPending), since Escalated is the one parked phase. the failed
  /// set is RETIRED into the retained record, not dropped — every pipeline
  /// escalation is reached at a reduce, so the set is fully resolved and
  /// the TCancelled arm of retireLive never fires here; a pre-work park
  /// holds no tasks, so retireLive is a no-op for it.
  pure def escalate(c: Core, j: int, at: Resume, why: Reason, label: str): Decision =
    move(
      withTicket(c, j, { ...retireLive(c.tickets.get(j)), resumeAt: at, reason: why }),
      j, PEscalated, label, ["OpenHumanTask"])

  /// Ready -> Working: launch a cycle for the ticket THE DISPATCHER CHOSE.
  /// Charges one gas — EVERY entry to Working does (standing rule 2: no
  /// free re-entry; gas is the account that makes the graph valid at all).
  /// Work is ONE task-set phase (one work task per cycle; Work is not staged), width
  /// N_TASKS, ids sequential within the ticket.
  ///
  /// THE AGENTIC DISPATCHER ("agentic dispatcher modeled (not
  /// FIFO)"): this decider is the dispatch decision made first-class — j
  /// is the CHOICE, and the chooser is the `dispatch` action's nondet pick
  /// among readyTickets. That pick is not incidental scheduler noise to be
  /// refined away: the dispatcher is itself agentic rather than a FIFO pop,
  /// so its choice is a genuine nondet outcome and ANY
  /// Ready ticket may be chosen next, and the `dispatch` StepRecord in the
  /// trace IS the dispatcher's decision event — an implementation
  /// conforms with any policy (LLM-driven, priority, whatever) because
  /// every policy refines unrestricted choice among Ready tickets. No
  /// policy-hook parameter is introduced: with exactly one honest default
  /// (unrestricted nondet) a WrapUpPricing-style const would have one
  /// branch and nothing to compare — it enters only when a real competing
  /// policy needs modeling. No queue, no fairness — standing non-goals.
  pure def decideDispatch(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    move(
      withTicket(c, j, { ...spawnOn(jb, TKWork, N_TASKS),
        gasLeft: jb.gasLeft - 1 }),
      j, PWorking, "dispatch", ["SpawnWorkTasks"])

  /// A task-completion event for task `tid` of ticket j (Working or
  /// Evaluating — one decider for both phases' task sets). First write
  /// wins: if the task is not RUNNING IN THE LIVE SET, this is a duplicate
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
    if (c.tickets.get(j).tasks.exists(t => t.id == tid and t.state == TSRunning))
      { rec: { label: "task-done", transitions: [], effects: [], attempt: WONone },
        post: withTicket(c, j, { ...c.tickets.get(j),
          tasks: resolveTask(c.tickets.get(j).tasks, tid,
            match v { | VPass => TPassed | VFail => TFailed }) }) }
    else
      noop(c, "task-done-duplicate")

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
    if (jb.tasks.forall(t => t.state == TSResolved(TPassed)))
      val fan = retired.program[0].fanout
      move(
        withTicket(c, j,
          { ...spawnOn(retired, TKEval(0), fan), artifact: ASome(retired.spawned) }),
        j, PEvaluating, "work-passed", ["SpawnEvalTasks"])
    else
      escalate(c, j, RWorking, RsWorkFailed, "ticket-escalated work_failed")

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
  ///   - the FINAL stage passes -> the program passed: PWrapUp.
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
  /// Evaluator-infrastructure death is a TFailed INSIDE the stage — THE
  /// TICKET PAYS from the same accounts, no new machinery. Deliberate
  /// abstraction from the extracted vocabulary, which escalates required
  /// INFRA failures immediately (skipping rework) and distinguishes abort
  /// verdicts; chuggy folds all three into TFailed-fails-the-stage because
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
          withTicket(c, j, spawnOn(retired, TKEval(s + 1), fan)),
          j, PEvaluating, "eval-stage-passed", ["SpawnEvalTasks"])
      else
        // THE WRAP-UP ROUTE (design 002). A WNone ticket's effect already
        // happened during work, so evaluation passing IS its completion and
        // it enters neither wrap-up phase — it never queues for a lease it
        // does not need, and never records a wrap-up it did not perform.
        match jb.wrapUp {
          // On the RETIRED ticket, not the live one: completeTicket does not
          // retire a task set, because on the lease path the set was already
          // retired when the ticket enqueued. Skipping the wrap-up phases
          // skips that retirement too, and a Done ticket holding live eval
          // tasks breaks tasksWellFormed. Caught by the random layer.
          | WNone => completeTicket(withTicket(c, j, retired), j)
          | WExclusive(_) =>
            move(
              withTicket(c, j, retired),
              j, PWrapUp, "eval-passed", ["EnqueueWrapUp"])
        }
    else if (jb.reworkLeft > 0 and jb.gasLeft > 0)
      move(
        withTicket(c, j, { ...spawnOn(retired, TKWork, N_TASKS),
          reworkLeft: jb.reworkLeft - 1,
          gasLeft: jb.gasLeft - 1 }),
        j, PWorking, "rework-started eval_failure", ["SpawnWorkTasks"])
    else if (jb.reworkLeft == 0)
      escalate(c, j, REvaluating, RsReworkBudgetExhausted,
        "ticket-escalated rework_budget_exhausted")
    else
      escalate(c, j, REvaluating, RsGasExhausted,
        "ticket-escalated gas_exhausted")

  /// The outcomes the environment may DRAW for a wrap-up attempt, given its
  /// invalidation choice for that attempt. THE DRAW RULE, and the set IS
  /// the refusal (the validPrograms/dependableTickets shape):
  ///   - VALID       -> { WOk } alone. The artifact evaluation judged is
  ///     still the artifact the step will commit, so there is nothing left
  ///     to go wrong at this boundary — the step cannot fail here.
  ///   - INVALIDATED -> { WOk, WFailed }. Something changed under the
  ///     artifact and the step must re-validate. Invalidation makes failure
  ///     POSSIBLE, never certain: re-validation may well pass.
  /// For a merge the invalidation is the default branch moving under the
  /// candidate; for a registry push, someone else claiming the version.
  /// The domain models neither cause — only that the kind admits one.
  ///
  /// Chosen PER ATTEMPT, never stored (the named-nondet discipline,
  /// stated at measure.qnt's wrap-up attempt observation). The
  /// `wrapUpStart`/`wrapUpResolve` actions draw from exactly these sets and
  /// the witness drivers reference them as guards, so wrapUpIsolation is
  /// what makes the refusal durable on every reachable step.
  pure def wrapUpOutcomes(invalidated: bool): Set[WrapUpOutcome] =
    if (invalidated) Set(WOk, WFailed)
    else Set(WOk)

  /// THE DEQUEUE, MOVED ARM: the environment chose
  /// the branch MOVED at this dequeue, so the gate must RUN — the ticket
  /// takes its project's depth-1 slot (PWrapUp -> PWrapUpHolding) while the
  /// candidate is built and validated over a duration. Charges nothing
  /// (the gate prices only its failures, R5). Callers guarantee
  /// wrapUpStartableIn — the depth-1 refusal. PWrapUpHolding encodes the moved
  /// choice: wrapUpResolve needs no stored flag to know the attempt's cause
  /// vocabulary (the named-nondet discipline, one more time).
  pure def decideWrapUpStart(c: Core, j: int): Decision =
    move(c, j, PWrapUpHolding, "wrapup-started", ["OpenGate"])

  /// THE ROUTING RULE, hoisted (adversarial review, MAJOR 1 — the
  /// dispatchableIn/m6 discipline applied one level up): how a dequeue
  /// ROUTES on the environment's invalidated choice is machine semantics,
  /// so it lives in a DECIDER, not in an action's if/else composition —
  ///   moved  -> the gate opens (decideWrapUpStart: the depth-1 slot,
  ///             validated over a duration);
  ///   quiet  -> the skip fast-path: the wrap-up resolves in this same
  ///             step as the direct squash (decideWrapUpResolve with the ONE
  ///             element of wrapUpOutcomes(false)).
  /// Both the `wrapUpStart` action and the witness drivers REFERENCE this
  /// definition; neither copies the composition. Why that matters (the p3
  /// mutant): when the routing lived inline in the action, rerouting a
  /// VALID artifact into the lease shipped green through every layer — the
  /// drivers carried a copy of the composition, and once a valid attempt
  /// holds the lease, the resolution stamps invalidated = true and every
  /// isolation conjunct is self-consistently wrong, so the direct path
  /// silently became unreachable. Hoisted, the route has ONE definition.
  pure def decideDequeue(c: Core, j: int, moved: bool): Decision =
    if (moved) decideWrapUpStart(c, j)
    else decideWrapUpResolve(c, j, WOk, false)

  /// THE COMPLETION: the ticket reaches PDone, and that is the whole of it —
  /// ONE transition, ONE effect. Both routes in — a WOk wrap-up resolution
  /// and a WNone ticket's passing evaluation — emit the same "Complete",
  /// because the domain knows only that the step succeeded and never which
  /// mechanism promoted anything (measure.qnt, WrapUpOutcome). The
  /// merge-queue PR's R2 fan-out (one decision completing a lead and its
  /// group's members) went with the grouping removal, so what was the
  /// memberless degeneration is now the only case.
  pure def completeTicket(c: Core, j: int): Decision =
    { rec: {
        label: "ticket-done",
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: PDone }],
        effects: ["Complete"],
        attempt: WONone },
      post: withTicket(c, j,
        { ...c.tickets.get(j), phase: PDone,
          completions: c.tickets.get(j).completions + 1 }) }

  /// The wrap-up resolves at the END of a concrete path (R1/R3/R5; the
  /// path rule is wrapUpOutcomes'):
  ///   - QUIET fast-path: called from PWrapUp at the dequeue with
  ///     (WOk, false) — the gate skipped, the direct squash.
  ///   - GATED: called from PWrapUpHolding with moved = true — WOk
  ///     (the validated candidate promoted by advancing the default ref)
  ///     or WFailed (the eviction).
  /// A wrap-up success is the ticket's single completion effect
  /// (completeTicket: ghost `completions` counts it, one per ticket). A
  /// wrap-up failure re-enters work priced per WRAPUP_PRICING exactly as
  /// Budgeted(n) spends the wrap-up account AND gas,
  /// DeadlineOnly spends gas alone (a documented gate-loop livelock is
  /// exactly why the pricing exists, R5); either wall parks
  /// the ticket with its own name, resumeAt RWrapUp re-ENQUEUING (the
  /// resume returns to PWrapUp — the queue — never into the gate).
  /// Failure and walls free the lease by phase. A step's internals — stages,
  /// failure classes, a fix-and-retry path — stay below this grain: the step
  /// is one abstract verdict.
  ///
  /// The attempt's cause vocabulary is per-project. The
  /// event carries `moved` — the environment's per-attempt choice of
  /// whether THIS ticket's target project's default branch moved under the
  /// candidate (callers guarantee out ∈ wrapUpOutcomes(moved), so a failure
  /// implies moved — R3, the path rule) — and EVERY arm stamps the step with
  /// the attempt's
  /// attribution (withWrapUpObs: the ticket's own project + the choice), so
  /// the golden trace attributes each wrap-up resolution, success or
  /// failure, to its project and its cause. Accounts and pricing are
  /// byte-identical to the pre-merge-queue decider: what changed is WHERE
  /// each arm fires from (the path).
  pure def decideWrapUpResolve(c: Core, j: int, out: WrapUpOutcome, moved: bool): Decision =
    withWrapUpObs(match out {
      | WOk => completeTicket(c, j)
      | WFailed =>
        match WRAPUP_PRICING {
          | Budgeted(_) =>
            if (c.tickets.get(j).wrapUpLeft > 0 and c.tickets.get(j).gasLeft > 0)
              move(
                withTicket(c, j, { ...spawnOn(c.tickets.get(j), TKWork, N_TASKS),
                  wrapUpLeft: c.tickets.get(j).wrapUpLeft - 1,
                  gasLeft: c.tickets.get(j).gasLeft - 1 }),
                j, PWorking, "rework-started wrapup_failure", ["SpawnWorkTasks"])
            else if (c.tickets.get(j).wrapUpLeft == 0)
              escalate(c, j, RWrapUp, RsWrapUpBudgetExhausted,
                "ticket-escalated wrapup_budget_exhausted")
            else
              escalate(c, j, RWrapUp, RsGasExhausted,
                "ticket-escalated gas_exhausted")
          | DeadlineOnly =>
            if (c.tickets.get(j).gasLeft > 0)
              move(
                withTicket(c, j, { ...spawnOn(c.tickets.get(j), TKWork, N_TASKS),
                  gasLeft: c.tickets.get(j).gasLeft - 1 }),
                j, PWorking, "rework-started wrapup_failure", ["SpawnWorkTasks"])
            else
              escalate(c, j, RWrapUp, RsGasExhausted,
                "ticket-escalated gas_exhausted")
        }
    }, c.tickets.get(j).project, moved)

  /// A duplicate completion event for an already-Done ticket (at-least-once: a
  /// stale executor re-delivers). NO completion effect is emitted — this
  /// no-op IS the exactly-once-at-the-completion-boundary claim; the
  /// completionExclusive invariant checks it.
  pure def decideCompleteDuplicate(c: Core, j: int): Decision =
    noop(c, "complete-duplicate")

  /// Ready -> Escalated behind the revalidation wall: the world changed
  /// under a ticket before it ever ran (static config no longer valid). Free
  /// — nothing was spent — and the desk opens. ("Stalled should
  /// be rolled into escalated"): it is
  /// now it is a PARK like any other — Escalated with a pre-work reason
  /// and the pre-work resume point (RPending: an operator retry returns
  /// the ticket to Pending, where Ready/Blocked re-derive — never to a
  /// pipeline phase, because it never entered one). The OTHER pre-work
  /// wall is the cascade's dependency_revoked (decideRevoke) — which,
  /// unlike this one, is NOT retryable (retryableIn: resumeAt RNone).
  pure def decideRevalFail(c: Core, j: int): Decision =
    escalate(c, j, RPending, RsRevalidationFailed,
      "ticket-escalated revalidation_failed")

  /// Operator Retry on a parked ticket: resume at the point the wall stamped,
  /// metered by resumeCharge (configurable, default charge). This is THE
  /// operator resume — one decider, a flavor per resume point,
  /// one trace label ("operator-retry"; the flavor is visible in the
  /// transition's target):
  ///   RPending (the pre-work resume flavor per the
  ///     triage): back to Pending — Blocked/Ready re-derive — charging
  ///     nothing under either metering (nothing was ever spent; the
  ///     Working boundary still meters actual re-entry). CHURN in the
  ///     measure, exactly as before the merge.
  ///   RWorking: respawn the work set; always pays gas.
  ///   REvaluating: A FRESH FAN-OUT OF THE LOWEST STAGE — re-enter
  ///     evaluation against the intact artifact with a fresh eval fan-out;
  ///     stages are never resumed mid-sequence. New ids: the retried tasks
  ///     are NEW records, the failed ones stay retired in the log.
  ///   RWrapUp: re-enqueue the wrap-up.
  /// Under RetryFree the Evaluating/WrapUp resumes join the CHURN set —
  /// a known livelock kept reproducible by configuration.
  pure def decideOpRetry(c: Core, j: int): Decision =
    val jb = c.tickets.get(j)
    val resumed = { ...jb,
      reason: RsNone, resumeAt: RNone,
      gasLeft: jb.gasLeft - resumeCharge(jb.resumeAt) }
    match jb.resumeAt {
      | RPending =>
        move(withTicket(c, j, resumed), j, PPending, "operator-retry", [])
      | RWorking =>
        move(withTicket(c, j, spawnOn(resumed, TKWork, N_TASKS)),
          j, PWorking, "operator-retry", ["SpawnWorkTasks"])
      | REvaluating =>
        move(withTicket(c, j, spawnOn(resumed, TKEval(0), jb.program[0].fanout)),
          j, PEvaluating, "operator-retry", ["SpawnEvalTasks"])
      | RWrapUp =>
        move(withTicket(c, j, resumed), j, PWrapUp, "operator-retry", ["EnqueueWrapUp"])
      | RNone =>
        // Unreachable: retryableIn refuses a ticket with no modeled resume
        // (the dependency_revoked wall — its only exit is revoke).
        noop(c, "operator-retry-unreachable")
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

  /// The live fleet: ids are dense 1..size and never reused
  /// (invariant idsDense), so ascending-id folds below stay correct. the
  /// static `allTickets = 1.to(N_TICKETS)` became this — N_TICKETS is now the
  /// arrival BOUND, not the fleet size.
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
  // PPending and derives the split, so the
  // unblock cascade disappears entirely — there is no Blocked->Ready edge
  // to model or to get wrong. (The open-human-task flag is derived too:
  // measure.qnt hasOpenHumanTask; the eval-stage index is derived from
  // the live set's kind marks: measure.qnt evalStage.) The model extends them
  // for free: an UNRELEASED dep (a Draft) is simply a dep that is not
  // Done, so it blocks with no new machinery; the pure bodies live with
  // the deciders (isReadyIn/isBlockedIn) so unit tests can pin exactly
  // that.

  def isReady(j: int): bool = isReadyIn(core, j)

  def isBlocked(j: int): bool = isBlockedIn(core, j)

  // --- Enablement sets ------------------------------------------------------

  // Each enablement val below REFERENCES its pure Core form (the
  // refinement PR's hoist — see the Core-parameterized enablement section
  // with the deciders): one definition, consumed by the machine's
  // actions, the witness drivers, and the journal replay checker alike.

  /// Room for one more arrival (the N_TICKETS arrival bound keeps the state
  /// space finite; ids dense, never reused).
  val canArrive: bool = canArriveIn(core)
  /// Tickets a new arrival may depend on: no tombstones — neither Revoked nor
  /// cascade-parked (which, by cascadeSafety, is exactly the
  /// transitively-doomed set; decideArrive's doc has the argument).
  val dependableTickets: Set[int] = dependableIn(core)
  /// The only authoring phase, hence the only
  /// releasable set: a ticket is released from Draft and nowhere else.
  val draftTickets: Set[int] = draftsIn(core)
  /// Every non-terminal may be revoked.
  val revocableTickets: Set[int] = revocablesIn(core)
  val readyTickets: Set[int] = readiesIn(core)
  /// Tickets whose task set can receive completion events (real or duplicate).
  val taskPhaseTickets: Set[int] = taskPhaseIn(core)
  val reducibleWork: Set[int] = reducibleWorkIn(core)
  val reducibleEval: Set[int] = reducibleEvalIn(core)
  /// The wrap-up QUEUE, derived: enqueued tickets whose
  /// dequeue the gate serializes. Deliberately unordered — see wrapUpStart.
  val wrapUpTickets: Set[int] = liveTickets.filter(j => tickets.get(j).phase == PWrapUp)
  /// Enqueued tickets whose project's gate is FREE — the dequeue-enabled set
  /// (wrapUpStartableIn is the shared guard; the depth-1 refusal).
  val wrapUpStartable: Set[int] = wrapUpStartablesIn(core)
  /// The occupied gate slots (at most one per project — leaseExclusive).
  val holdingTickets: Set[int] = holdingIn(core)
  val doneTickets: Set[int] = doneIn(core)
  /// Parked tickets the operator may Retry (retryableIn: a modeled resume
  /// exists and is affordable). Under RetryCharged a charging resume with
  /// zero gas parks the ticket permanently;
  /// the pre-work RPending flavor is free, so a revalidation park is
  /// always retryable; the dependency_revoked wall never is (resumeAt
  /// RNone — its only exit is revoke).
  val retryableEscalated: Set[int] = retryablesIn(core)

  /// No machine, operator, or author action can move anything.  shrank
  /// this dramatically: revoke is enabled on EVERY non-terminal (table
  /// lines 47-48), so unretryable parks and doomed Pending chains are
  /// all still actionable — the only true dead end is a
  /// fully-arrived fleet in which every ticket is settled in a terminal
  /// (Done or Revoked). The `settled` stutter covers exactly that state so
  /// runs never deadlock.
  val quiet: bool = and {
    not(canArrive),
    liveTickets.forall(j => tickets.get(j).phase == PDone or tickets.get(j).phase == PRevoked)
  }

  // --- init -----------------------------------------------------------------

  /// The fleet starts EMPTY: authoring is the ticket source now —
  /// the static nondet DAG is fully replaced by `arrive`, which grows
  /// the fleet one Draft at a time through the freshTicket seam (deps still
  /// acyclic by construction: they may only point at already-arrived,
  /// strictly smaller ids).
  /// The `GAS >= 1` conjunct is the required-account rule as a
  /// validity condition: a gasless instantiation has NO initial state —
  /// the graph is invalid, not merely unmetered (every arrival funds a
  /// ticket from this grant, so checking it here still gates every ticket ever
  /// created). the model `MAX_STAGES >= 1`: a machine that admits no
  /// well-formed eval program admits no tickets either.
  action init = all {
    GAS >= 1,            // the required account
    N_TASKS >= 1,        // well-formedness: a phase carries a real task set
    N_TICKETS >= 1,         // the arrival bound must admit at least one ticket
    MAX_STAGES >= 1,     // at least one authorable program must exist
    N_PROJECTS >= 1,        // a ticket needs a project to target
    reworkBudget(REWORK_POLICY) >= 0,
    wrapUpBudget(WRAPUP_PRICING) >= 0,
    tickets' = Map(),
    lastStep' = { label: "init", transitions: [], effects: [], attempt: WONone },
    prevMeasure' = 0,
    prevRecords' = Map()
  }

  // --- actions --------------------------------------------------------------

  /// A new ticket arrives as a Draft (the environment/author acts), deps a
  /// nondet subset of DEPENDABLE live tickets — released or not (unreleased
  /// deps block via the derived waiting room; tombstones are refused at
  /// authoring time, see decideArrive/dependableTickets) — and its
  /// eval PROGRAM a nondet pick among the WELL-FORMED programs: the
  /// machine explores every authorable program, and ill-formed ones are
  /// refused structurally (validPrograms is the refusal rule). Multi-project
  /// PR: the author also picks the ticket's TARGET PROJECT from the bounded
  /// universe — the third authored draw, refused structurally the same
  /// way (projects is the rule) — and deps stay UNCONSTRAINED by it: the
  /// author may depend across projects (decideArrive's doc). The FOURTH and
  /// last draw is the WRAP-UP CHOICE, from wrapUpChoices: the same
  /// refusal shape once more, and the one that decides whether this
  /// ticket ever reaches a wrap-up phase — a WNone arrival completes on
  /// its passing evaluation and takes no lease. AUTHORING
  /// set in the measure: climbs by the fresh Draft's whole ticketMeasure,
  /// bounded by N_TICKETS.
  action arrive = all {
    canArrive,
    nondet deps_ = dependableTickets.powerset().oneOf()
    nondet prog = validPrograms.oneOf()
    nondet project_ = projects.oneOf()
    nondet wrapUp_ = wrapUpChoices.oneOf()
    apply(decideArrive(core, deps_, prog, project_, wrapUp_))
  }

  /// Author releases a Draft into the pipeline; Ready/Blocked re-derive.
  /// Descends: rank 6 -> 5. Release is authoring's only phase-level act
  /// after arrival.
  action release = all {
    draftTickets.size() > 0,
    nondet j = draftTickets.oneOf()
    apply(decideRelease(core, j))
  }

  /// Author revokes any non-terminal ticket; the atomic
  /// cascade parks every pre-flight transitive dependent with its own desk
  /// task (decideRevoke — the model).
  action revoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    apply(decideRevoke(core, j))
  }

  /// Ready -> Working: THE AGENTIC DISPATCHER'S PICK. The
  /// nondet choice below IS the dispatcher — an agentic component whose
  /// selection among Ready tickets is a real decision, not scheduler noise
  /// (see decideDispatch's header for the full agency note); the recorded
  /// `dispatch` step is its decision event in the golden trace.
  /// Scheduling/quota below the pick stays trusted fabric (no bespoke
  /// scheduler) — no slot count, no queue order, no
  /// fairness. Pending tickets have never spent gas (arrival grants the full
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

  /// A task-completion event arrives for ANY task the ticket EVER SPAWNED —
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
  /// id and no-ops BY IDENTITY (decideTaskDone finds no live running
  /// match). This RETIRES the weaker absorption argument (a stale
  /// same-id completion was indistinguishable from a fresh nondet verdict
  /// on the respawned set) — staleness is now absorbed structurally, and
  /// the only remaining first-write-wins case is a duplicate delivery for
  /// a LIVE resolved task. A stale TICKET COMPLETION still implies a success
  /// occurred, and PDone is absorbing (completeDuplicate). The observed/actual
  /// split that would make mid-rework duplicates dangerous — a decider
  /// acting on a stale VIEW — is exactly the deferred §4 refinement layer
  /// (reconcile vs journaled-actor), not this shared domain layer. the
  /// A sharper corner: a ticket revoked
  /// OUT of PWrapUp (enqueued) or PWrapUpHolding (the gate mid-validation) could
  /// race an in-flight merge in the real system — in-model
  /// revokedNeverCompletes holds structurally (a revoked ticket leaves
  /// holdingTickets/wrapUpStartable, so neither wrap-up action can resolve
  /// it, and the revoke frees the slot by phase); the real revoke/merge
  /// race — the candidate already advancing when the revoke lands — is
  /// record-vs-effect atomicity, the §4 refinement layer.
  action taskDone = all {
    taskPhaseTickets.size() > 0,
    nondet j = taskPhaseTickets.oneOf()
    nondet tid = deliverableTaskIds(core, j).oneOf()
    nondet v = Set(VPass, VFail).oneOf()
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

  /// THE DEQUEUE: a ticket whose project's gate is
  /// free leaves the queue, and the environment draws — per attempt, fresh,
  /// no stored flag (the named-nondet discipline) — whether that project's
  /// default branch MOVED under the candidate since evaluation:
  ///   - quiet: the skip fast-path — the gate never opens; the one outcome
  ///     wrapUpOutcomes(false) permits (WOk, the direct squash)
  ///     resolves the wrap-up in this same step;
  ///   - moved: the gate OPENS (PWrapUpHolding) and holds its project's depth-1 slot
  ///     until wrapUpResolve.
  /// WHICH enqueued ticket dequeues is unrestricted nondet. A queue is a
  /// non-goal in any shape, and an order that does not survive a restart is
  /// not an order — so this is implementation policy refining free choice,
  /// exactly like dispatch.
  /// This action only DRAWS; the quiet/moved routing itself is
  /// decideDequeue (hoisted per the adversarial review — its header has
  /// the p3-mutant story), shared with the witness drivers.
  action wrapUpStart = all {
    wrapUpStartable.size() > 0,
    nondet j = wrapUpStartable.oneOf()
    nondet moved = Set(true, false).oneOf()
    apply(decideDequeue(core, j, moved))
  }

  /// THE GATE RESOLVES: the occupant's candidate
  /// was built against a MOVED branch (PWrapUpHolding encodes the choice — no
  /// stored flag), so the outcome draws from wrapUpOutcomes(true): the
  /// the re-validated artifact completes (WOk) or the attempt fails and
  /// the eviction prices per WRAPUP_PRICING. Either way the slot frees by
  /// phase.
  action wrapUpResolve = all {
    holdingTickets.size() > 0,
    nondet j = holdingTickets.oneOf()
    nondet out = wrapUpOutcomes(true).oneOf()
    apply(decideWrapUpResolve(core, j, out, true))
  }

  /// At-least-once: a duplicate completion event for a Done ticket. Must emit
  /// nothing (completionExclusive checks it).
  action completeDuplicate = all {
    doneTickets.size() > 0,
    nondet j = doneTickets.oneOf()
    apply(decideCompleteDuplicate(core, j))
  }

  /// Environment churn: revalidation fails at the moment a ticket would
  /// start. Same enablement as dispatch; which fires is the environment's
  /// choice.
  action revalFail = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    apply(decideRevalFail(core, j))
  }

  /// One resume action for every retryable park (the pre-work
  /// resume is a decideOpRetry flavor, not its own action).
  action opRetry = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    apply(decideOpRetry(core, j))
  }

  /// The dead-end stutter (STUTTER set): keeps quiet states from
  /// deadlocking the simulator.
  action settle = all {
    quiet,
    tickets' = tickets,
    lastStep' = { label: "settled", transitions: [], effects: [], attempt: WONone },
    prevMeasure' = currentMeasure,
    prevRecords' = currentRecords
  }

  action step = any {
    arrive,
    release,
    revoke,
    dispatch,
    taskDone,
    workReduce,
    evalReduce,
    wrapUpStart,
    wrapUpResolve,
    completeDuplicate,
    revalFail,
    opRetry,
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
  /// completion effect ends the ticket (PDone is absorbing) and failed
  /// completions emit no completion effect. DELIBERATELY UNCHANGED — per-ticket
  /// exclusivity is strictly stronger than any per-project form (exactly one
  /// completion per ticket implies at most one per ticket per project), so the
  /// multi-project gate needs nothing weaker and gets nothing weaker.
  /// A withdrawn extension covered groups — a marked Done ticket
  /// having completed via its lead's completion, emitting nothing of its own.
  /// That extension is WITHDRAWN with the grouping removal, and the
  /// invariant reverts to its plain form: Done iff exactly one completion
  /// effect, with no mark conjunct to carve out.
  val completionExclusive: bool = liveTickets.forall(j => and {
    tickets.get(j).completions <= 1,
    (tickets.get(j).completions == 1) iff (tickets.get(j).phase == PDone)
  })

  /// REVOKED NEVER COMPLETES: a revoked ticket
  /// has emitted no completion effect — and never will: PRevoked is absorbing
  /// (terminalsAbsorbing), no decider touches a revoked
  /// ticket's `completions`, and revoke from PWrapUp clears the ticket OUT of the
  /// wrap-up boundary before any effect fires. Stated as its own named
  /// invariant because it is the model's exclusivity half, though
  /// state-wise it is a corollary of completionExclusive (completions = 1 iff
  /// Done, completions <= 1, Revoked != Done ⇒ completions = 0) — same
  /// stated-corollary treatment as stuckSubsetCovered.
  val revokedNeverCompletes: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == PRevoked) implies (tickets.get(j).completions == 0))

  // --- Isolation invariants (the isolation gate) ----------------------

  /// WRAP-UP ISOLATION (the gate's attribution half) — a step-invariant
  /// over lastStep, the stepDescends pattern. Reading it as an iff:
  ///
  ///   - A step carrying a wrap-up attempt (WOAttempt) is EXACTLY a step
  ///     that resolves one: single ticket, one of the wrap-up-resolution
  ///     labels (ticket-done, the gate rework, the two wrap-up walls),
  ///     the attribution naming the stepped ticket's OWN project (project
  ///     is immutable, so reading it from the post-state is reading the
  ///     authored field) from inside the project universe.
  ///   - THE ISOLATION CLAIM: a gate-FAILURE step (any attempt that is
  ///     not the ticket-done success) carries invalidated = true — a
  ///     wrap-up can fail ONLY via its own project's branch moving. There is
  ///     no cross-project path to a failure: the attempt's attribution IS
  ///     the ticket's project (the own-project conjunct), and no other project's
  ///     choice appears anywhere in the step (the environment draws
  ///     invalidated for the target project alone — nothing else exists to
  ///     leak in).
  ///   - Completeness: a step with NO attempt (WONone) carries none of
  ///     the labels unique to wrap-up — a wrap-up is never resolved
  ///     off-record. ("ticket-escalated gas_exhausted" is shared with the
  ///     eval side, so it is legitimately WONone there — pinned in
  ///     tests/chuggy_test.qnt, nonLandingStepsCarryNoAttributionTest;
  ///     complete-duplicate absorbs with nothing emitted and is not an
  ///     attempt; wrapup-started OPENS an attempt but resolves none — the
  ///     resolution's attribution carries the choice the open encoded.)
  ///   - the PATH iff (R3/R4): a MOVED attempt resolves
  ///     out of the GATE (transitions[0].from == PWrapUpHolding — the slot the
  ///     dequeue took when it drew moved), a QUIET one straight off the
  ///     QUEUE (from == PWrapUp — the fast-path; the gate never opened).
  ///     With leaseExclusive this is depth-1 serialization on the trace:
  ///     every moved resolution names the unique slot-holder.
  ///   - EVERY attempt, success or not, touches exactly its ONE ticket.
  ///     An earlier fan-out arm (R2), under which a success
  ///     could carry extra member transitions, went with the grouping
  ///     removal — so this is one transition per attempt again.
  ///
  /// Together with wrapUpOutcomes (the draw rule the wrapUpStart/wrapUpResolve
  /// actions and the witness drivers share) this is the refusal made
  /// durable: the machine cannot DRAW a failure on an artifact the
  /// environment left valid, and this invariant checks that no reachable
  /// step RECORDS one.
  val wrapUpIsolation: bool = match lastStep.attempt {
    | WONone => and {
        // A COMPLETION IS NOT ALWAYS AN ATTEMPT (design 002). A WNone
        // ticket's effect happened during work, so evaluation passing
        // completes it having resolved no wrap-up attempt at all — the one
        // ticket-done that legitimately carries no attribution. Found by
        // the random layer when the WNone route landed: the completeness
        // arm was written when every completion WAS an attempt.
        lastStep.label == "ticket-done" implies
          (lastStep.transitions.length() == 1 and
           tickets.get(lastStep.transitions[0].ticket).wrapUp == WNone),
        lastStep.label != "rework-started wrapup_failure",
        lastStep.label != "ticket-escalated wrapup_budget_exhausted"
      }
    | WOAttempt(a) => and {
        projects.contains(a.project),
        lastStep.transitions.length() >= 1,
        tickets.get(lastStep.transitions[0].ticket).project == a.project,
        or {
          lastStep.label == "ticket-done",
          lastStep.label == "rework-started wrapup_failure",
          lastStep.label == "ticket-escalated wrapup_budget_exhausted",
          lastStep.label == "ticket-escalated gas_exhausted"
        },
        (lastStep.label != "ticket-done") implies a.invalidated,
        // The path iff: moved resolves from the gate, quiet from the queue.
        lastStep.transitions[0].from == (if (a.invalidated) PWrapUpHolding else PWrapUp),
        // One wrap-up attempt moves exactly one ticket.
        lastStep.transitions.length() == 1
      }
  }

  /// QUIET PROJECT LANDS CLEANLY (the gate's other half), stated in its
  /// STRONGEST CHECKABLE FORM — and honestly about what that form is.
  /// "Quiet" is a PER-ATTEMPT environment choice, not stored project state
  /// (the named-nondet discipline forbids the flag), so "project R is quiet"
  /// is not a predicate over any reachable state and the naive reading
  /// ("a quiet project's tickets never gate-fail") cannot be a state
  /// theorem AS QUANTIFIED OVER PROJECTS. What IS a state theorem — checked
  /// here on every reachable step — is the per-attempt form: an attempt
  /// the environment chose QUIET resolves as the ticket-done success,
  /// full stop (state-wise a corollary of wrapUpIsolation's
  /// failure-implies-moved conjunct, stated named like revokedNeverCompletes
  /// because it is the gate's claim in its own words). The TRACE-level
  /// reading — pin every draw for a project quiet and its tickets all land
  /// cleanly / pin a move and the rework is attributed — is deliberately
  /// discharged as deterministic witness traces, not an invariant:
  /// tests/chuggy_witness_test.qnt quietLandDeterministicTest (the choice
  /// pinned quiet, the wrap-up succeeds) and movedReworkAttributedTest
  /// (the choice pinned moved, the gate rework and the wall both carry
  /// the attribution).
  val quietProjectLandsCleanly: bool = match lastStep.attempt {
    | WONone => true
    | WOAttempt(a) => not(a.invalidated) implies lastStep.label == "ticket-done"
  }

  /// THE LEASE IS EXCLUSIVE: no resource is ever held by two tickets.
  /// Occupancy is the derived phase predicate, so nothing tracks it
  /// separately and nothing can disagree. The guard-refusal half — a
  /// second ticket wanting the same resource cannot even DRAW the dequeue
  /// while it is held (wrapUpStartableIn) — is pinned on a deterministic
  /// machine trace (model/tests/chuggy_witness_test.qnt, the lease module).
  /// Different resources are INDEPENDENT: a state holding one lease on each
  /// satisfies this by design, and the cross-resource dequeue staying
  /// enabled is pinned at guard grain.
  ///
  /// The resource is whatever the wrap-up kind names, never a repo by
  /// definition: a per-repo merge queue is one instance of this lease, and
  /// reading the general form off that instance is how it gets narrowed.
  val leaseExclusive: bool = projects.forall(r =>
    liveTickets.filter(j => and {
      tickets.get(j).phase == PWrapUpHolding,
      leaseOf(tickets.get(j)) == r
    }).size() <= 1)

  /// A WNone TICKET NEVER TAKES A LEASE (design 002). Structural rather than
  /// argued: it is what stops a deploy from occupying — and blocking — a
  /// resource whose serialization it has no stake in, which is the concrete
  /// cost that made merge-only wrong rather than merely narrow.
  val noLeaseWithoutAKind: bool = liveTickets.forall(j =>
    (tickets.get(j).wrapUp == WNone) implies and {
      tickets.get(j).phase != PWrapUp,
      tickets.get(j).phase != PWrapUpHolding
    })

  /// A COMPLETED TICKET PRODUCED SOMETHING (design 002). Deliberately the
  /// weak form: an artifact exists by the time a ticket is Done. The
  /// tempting stronger claim — that what was committed is what was
  /// evaluated — would be TRUE BY CONSTRUCTION, since the phase machine
  /// forbids work between eval-passed and wrap-up, and an invariant that
  /// cannot fail is the stuckSubsetCovered defect written on purpose.
  /// A Revoked ticket may hold ANone: it may never have run.
  val artifactWellFormed: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == PDone) implies (tickets.get(j).artifact != ANone))

  /// Every live ticket targets a project inside the bounded universe — the
  /// arrival-refusal claim made durable (the programsWellFormed shape):
  /// projects enter only through decideArrive, whose callers draw from
  /// `projects`, and are never rewritten.
  val projectsWellFormed: bool = liveTickets.forall(j =>
    projects.contains(tickets.get(j).project))

  /// Every live ticket's authored wrap-up choice is inside the bounded
  /// universe — the arrival-refusal claim made durable (the
  /// projectsWellFormed shape): wrap-up choices enter only through
  /// decideArrive, whose callers draw from `wrapUpChoices`, and are never
  /// rewritten (the field is written once, in freshTicket).
  ///
  /// What it catches is the resource inside WExclusive(r). leaseExclusive
  /// counts holders per member of `projects`, so a lease on a resource
  /// OUTSIDE that universe is serialized against nothing and counted by
  /// no one: two tickets could hold it at once and the depth-1 claim would
  /// stay green. The refusal is what makes leaseExclusive's quantifier
  /// cover every lease that exists.
  val wrapUpWellFormed: bool = liveTickets.forall(j =>
    wrapUpChoices.contains(tickets.get(j).wrapUp))

  /// The two absorbing terminals never transition OUT. Checked against the
  /// observed step record: no transition ever leaves PDone or PRevoked.
  /// Both carry it here, because PRevoked is reachable.
  val terminalsAbsorbing: bool =
    lastStep.transitions.foldl(true, (b, t) =>
      b and t.from != PDone and t.from != PRevoked)

  /// The human desk is consistent. The reason-iff-parked half is a named
  /// wall iff parked — and parked just IS PEscalated. The resumeAt half is
  /// the sharper one: a resume point iff a MODELED RESUME
  /// EXISTS — every wall stamps one (pipeline walls resume in-pipeline;
  /// the pre-work revalidation wall resumes to Pending, RPending) EXCEPT
  /// dependency_revoked, whose resumeAt stays RNone because its only
  /// modeled exit is revoke (retryableIn). (The open-task flag needs no
  /// conjunct — it is DERIVED from the phase, standing rule 3.)
  /// note: PRevoked passes both iffs with RsNone/RNone — "Revoked runs
  /// nothing" is this invariant plus tasksWellFormed doing their existing
  /// tickets over the phase.
  val deskConsistent: bool = liveTickets.forall(j => and {
    (tickets.get(j).phase == PEscalated) iff (tickets.get(j).reason != RsNone),
    (tickets.get(j).resumeAt != RNone) iff
      (tickets.get(j).phase == PEscalated and
       tickets.get(j).reason != RsDependencyRevoked)
  })

  /// The gate-budget wall exists only under Budgeted pricing (the wall
  /// vocabulary is carried; the pricing is a parameter).
  val wrapUpWallNamed: bool = match WRAPUP_PRICING {
    | Budgeted(_) => true
    | DeadlineOnly => liveTickets.forall(j => tickets.get(j).reason != RsWrapUpBudgetExhausted)
  }

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
    tickets.get(j).reworkLeft <= reworkBudget(REWORK_POLICY),
    tickets.get(j).wrapUpLeft >= 0, tickets.get(j).wrapUpLeft <= wrapUpBudget(WRAPUP_PRICING)
  })

  /// The LIVE task set is exactly the current phase's anatomy (this is
  /// also the STAGE-INDEX SANITY invariant):
  ///   - PWorking: the single work set — width N_TASKS, all TKWork;
  ///   - PEvaluating: ONE stage's fan-out — uniformly TKEval(s) for a
  ///     single s that indexes INTO the program (0 <= s < |program|), with
  ///     exactly that stage's declared width (the interpreter is running
  ///     the program as written, not improvising);
  ///   - every other phase: empty — dead live-task state is never carried
  ///     (derive-don't-store spirit; a Draft has not spawned,
  ///     PRevoked runs nothing).
  /// In the task phases the live ids are the contiguous run directly above
  /// the retired record (identity is sequential within the ticket — the
  /// at-least-once-by-identity argument needs exactly this), and TCancelled
  /// never appears live (it is a retirement mark, not an outcome events
  /// can deliver).
  val tasksWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    val start = jb.record.length() + firstTaskId
    if (jb.phase == PWorking) and {
      jb.tasks.size() == N_TASKS,
      jb.tasks.map(t => t.id) == start.to(start + N_TASKS - 1),
      jb.tasks.forall(t => t.kind == TKWork and t.state != TSResolved(TCancelled))
    } else if (jb.phase == PEvaluating)
      val s = evalStage(jb.tasks)
      and {
        s >= 0,
        s < jb.program.length(),
        jb.tasks.forall(t => t.kind == TKEval(s) and t.state != TSResolved(TCancelled)),
        jb.tasks.size() == jb.program[s].fanout,
        jb.tasks.map(t => t.id) == start.to(start + jb.tasks.size() - 1)
      }
    else jb.tasks == Set())

  /// THE RETAINED RECORD is well-formed: entry i carries id i+1
  /// (the chronological log IS the identity order, 1-indexed), nothing
  /// retired is still
  /// running — the record is the RESOLVED log, every entry TSResolved
  /// (TPassed/TFailed by verdict, TCancelled by revoke; the
  /// explicit lifecycle makes this a constructor check, not an
  /// outcome-sentinel comparison) — and every retired eval task names a
  /// stage its ticket's program actually has (programs are immutable, so
  /// history never dangles).
  val recordWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    and {
      jb.record.indices().forall(i => jb.record[i].id == i + firstTaskId),
      jb.record.indices().forall(i => jb.record[i].state != TSRunning),
      jb.record.indices().forall(i =>
        match jb.record[i].kind {
          | TKWork => true
          | TKEval(s) => s >= 0 and s < jb.program.length()
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
  /// 1..N_TASKS. Holding in EVERY reachable state is the arrival-refusal
  /// claim made durable: programs enter only through decideArrive (whose
  /// callers draw from validPrograms) and are never rewritten, so an
  /// ill-formed program is refused at authoring time or never exists.
  val programsWellFormed: bool = liveTickets.forall(j =>
    val p = tickets.get(j).program
    and {
      p.length() >= 1,
      p.length() <= MAX_STAGES,
      p.indices().forall(i => p[i].fanout >= 1 and p[i].fanout <= N_TASKS)
    })

  /// Arrival's DAG-by-construction survives every step (deps are never
  /// rewritten): each dep points at a known, strictly smaller id.
  val depsAcyclic: bool = liveTickets.forall(j =>
    tickets.get(j).deps.forall(d => liveTickets.contains(d) and d < j))

  ///  bookkeeping: ids are dense 1..size and never reused — what makes
  /// every ascending-id fold (stuckSet, coveredSet, revokeDoomed, the
  /// cascade's own pass) sound, and what keeps arrivals bounded by N_TICKETS.
  val idsDense: bool = and {
    liveTickets == 1.to(liveTickets.size()),
    liveTickets.size() <= N_TICKETS
  }

  // --- Visibility -----------------------------------------------------------

  /// THE VISIBILITY EDGES: the walk's edge relation is the DEPENDENCY
  /// edges, and only those. A withdrawn revision added the group's
  /// member<->lead edges in both directions, which is why the two walks
  /// below are bounded-sweep fixpoints rather than the single ascending
  /// fold they were before it; the grouping removal took those edges away,
  /// so the relation is downward-only again and one sweep already reaches
  /// the closure.
  ///
  /// The fixpoint SHAPE is kept rather than reverted — it computes the
  /// same set over a downward-only relation, at n times the cost of the
  /// fold, and keeping it means the walks do not have to be rewritten if
  /// a future edge kind points upward again. Monotone over a finite
  /// lattice, so the bound is sound either way.
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
        tickets.get(j).phase == PEscalated,
        and {
          tickets.get(j).phase == PPending,
          visEdges(j).exists(d => st.contains(d))
        }
      }))

  /// Tickets reachable from an open human task by walking the visibility
  /// edges: the ticket's own desk task (derived — hasOpenHumanTask), or a
  /// desk task somewhere in its dependency chain.
  ///
  ///  note: PRevoked contributes NOTHING here (hasOpenHumanTask
  /// excludes it), so a dependent of a revoked ticket can only be covered by
  /// its OWN task — which is exactly what the atomic cascade guarantees
  /// (cascadeSafety below): parked dependents are PEscalated, hence in
  /// stuckSet AND covered by themselves; the folds needed no change for
  /// the authoring phase (a Draft is neither stuck — its progress is
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
  /// machine. `stuckSet`'s base case is `PEscalated`; `coveredSet`'s base
  /// case is `hasOpenHumanTask`, which IS `phase == PEscalated` — the same
  /// predicate. Both walk the same `visEdges`, and `stuckSet`'s inductive
  /// arm is `coveredSet`'s plus one conjunct (`PPending`), hence strictly
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
  /// is not Done blocks, and PRevoked never becomes PDone). Same
  /// ascending-id fold as stuckSet — deps point strictly downward.
  val revokeDoomed: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (dset, j) =>
      if (tickets.get(j).deps.exists(d =>
            tickets.get(d).phase == PRevoked or dset.contains(d)))
        dset.union(Set(j)) else dset)

  /// Tickets with a REACHABLE route to Done — a least fixpoint UPWARD from
  /// the terminal, deliberately the opposite direction from stuckSet: Done
  /// has finished, and a non-Revoked ticket every one of whose gate deps
  /// can finish can finish too. It recurses over waitsOn, the same
  /// relation the dispatch gate reads.
  ///
  /// WHY UPWARD (the grouping lesson): stuckSet grows outward from a base
  /// case (PEscalated), and a dependency CYCLE has no base case — which is
  /// structurally why no phase added to that base could ever have seen the
  /// deadlock absorption could build. A cycle's members each wait on the
  /// other, so neither's forall is ever satisfied and both simply never
  /// enter this fixpoint. Membership is over-approximate on purpose (an
  /// out-of-gas Escalated ticket is "able" here and covered by the desk
  /// disjunct below): this is a deadlock net, not a liveness oracle.
  val canFinishSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (cf, _) =>
      liveTickets.filter(j => or {
        tickets.get(j).phase == PDone,
        and {
          tickets.get(j).phase != PRevoked,
          waitsOn(core, j).forall(d => cf.contains(d))
        }
      }))

  /// NO STRUCTURAL DEADLOCK: every live ticket can still reach Done, or was
  /// settled by its author (PRevoked), or holds an open desk task a human
  /// can act on. This is the half of the visibility question that IS a
  /// state theorem — a ticket with no continuation at all is a defect in
  /// every reading, whatever anyone accepts about WAITING (an abandoned
  /// Draft, an unpicked dispatch, an unwon dequeue all still have
  /// continuations, so none of them is flagged here — see
  /// bounds-work-not-waiting).
  ///
  /// Unlike stuckSubsetCovered this is NOT definitional: canFinishSet
  /// recurses on gate deps and Done-ness, coverage recurses on
  /// escalations, so the containment is a claim about the machine. Its
  /// teeth are demonstrated against a real defect rather than argued.
  val noStructuralDeadlock: bool = liveTickets.forall(j => or {
    canFinishSet.contains(j),
    tickets.get(j).phase == PRevoked,
    hasOpenHumanTask(tickets.get(j))
  })

  /// CASCADE SAFETY (stuckSubsetCovered's style, revoke's content): every ticket
  /// transitively stuck behind a Revoked dep is parked with its own open
  /// human task (PEscalated, wall dependency_revoked — hasOpenHumanTask
  /// derives the task) or is itself revoked (its author settled it too).
  /// "Eventually parked" strengthens to ALWAYS-parked
  /// because the cascade is atomic with the revoke (decideRevoke): there
  /// is no reachable in-between state where a doomed ticket waits invisibly.
  /// No ticket may wait invisibly forever behind a revoked dep — and since
  /// PRevoked opens no task (the author's settled choice), this invariant
  /// is the coverage the walks cannot provide through the dep itself.
  /// NON-VACUITY: the model gate pins a machine trace where the
  /// cascade actually parks dependents (cascadeParkNever — deterministic
  ///, tests/chuggy_witness_test.qnt), and
  /// tests/chuggy_test.qnt walks a 3-ticket chain end-to-end.
  val cascadeSafety: bool = revokeDoomed.forall(j => or {
    tickets.get(j).phase == PRevoked,
    tickets.get(j).phase == PEscalated and tickets.get(j).reason == RsDependencyRevoked
  })

  // --- Measure descent (per-ticket liveness, sketched) -------------------------

  /// Well-foundedness half: the measure is bounded below (follows from
  /// accountsBounded, checked directly for the descent argument's own
  /// integrity).
  val measureNonNegative: bool = currentMeasure >= 0

  /// Descent half: every step strictly decreases sysMeasure EXCEPT the
  /// named STUTTER, CHURN, and AUTHORING sets (measure.qnt header) —
  /// checked by label against the ghost prevMeasure. Under the default
  /// RetryCharged pricing the only churn is the pre-work resume (which
  /// never charges — the pre-work resume is an operator-retry flavor,
  /// pricing intact); release descends unconditionally. There is NO
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
  ///   task-done-duplicate   — free module (the re-delivered completion);
  ///   complete-duplicate    — stage module (the stale ticket completion);
  ///   settled               — the quiet fleet's stutter;
  ///   operator-retry, RPending flavor
  ///                         — preWorkResumeClimbDeterministicTest;
  ///   operator-retry, RetryFree pipeline flavor
  ///                         — freeClimbDeterministicTest's climbing step;
  ///   ticket-arrived        — every run's arrivals;
  ///   ticket-revoked, desk-only flat
  ///                         — cascadeParkDeterministicTest's second revoke.
  val stepDescends: bool =
    val exempt = or {
      lastStep.label == "init",
      // STUTTER: state-identical delivery noise + the dead-end self-loop.
      lastStep.label == "task-done-duplicate",
      lastStep.label == "complete-duplicate",
      lastStep.label == "settled",
      // CHURN: the uncharged operator-resume flavors (measure.qnt CHURN):
      // the PRE-WORK resume (Escalated -> Pending; free under BOTH
      // meterings — nothing was ever spent) and, under RetryFree only,
      // the Evaluating/WrapUp resumes (the Working resume always pays).
      and {
        lastStep.label == "operator-retry",
        or {
          lastStep.transitions.foldl(false, (b, t) => b or t.to == PPending),
          and {
            OP_RETRY_PRICING == RetryFree,
            lastStep.transitions.foldl(false, (b, t) => b or t.to != PWorking)
          }
        }
      },
      // AUTHORING: a ticket entering the fleet
      // climbs by its whole fresh measure (bounded by the N_TICKETS arrival
      // cap) — and it is the set's ONLY climbing member...
      lastStep.label == "ticket-arrived",
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
  /// operator-retry into a PIPELINE phase (Evaluating/WrapUp) ever climbs
  /// the measure". EXPECTED TO BE VIOLATED on the RetryFree instance
  /// (the model gate proves it deterministically by the free-climb machine
  /// trace in tests/chuggy_witness_test.qnt, plus the demoted pinned-seed
  /// probe) — the violation is the
  /// machine-level proof that free pipeline resumes really do climb and
  /// really are exempted by stepDescends' RetryFree CHURN arm, which no
  /// green run could otherwise distinguish from dead code. Under
  /// RetryCharged it must HOLD (every pipeline resume pays gas and
  /// descends). The witness deliberately EXCLUDES the pre-work RPending
  /// resume: that flavor is free and climbs under BOTH
  /// meterings — the pre-work resume churn, whose exemption arm the
  /// unit tests pin (the climb is deterministic there) — so including it
  /// would let a charged instance violate this witness without ever
  /// exercising the RetryFree arm it exists to prove alive.
  val freeClimbNever: bool =
    not(and {
      lastStep.label == "operator-retry",
      lastStep.transitions.foldl(false, (b, t) =>
        b or t.to == PEvaluating or t.to == PWrapUp),
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
    wrapUpIsolation,
    quietProjectLandsCleanly,
    leaseExclusive,
    noLeaseWithoutAKind,
    artifactWellFormed,
    projectsWellFormed,
    wrapUpWellFormed,
    terminalsAbsorbing,
    deskConsistent,
    wrapUpWallNamed,
    accountsBounded,
    tasksWellFormed,
    recordWellFormed,
    recordMonotone,
    idsAccounted,
    programsWellFormed,
    depsAcyclic,
    idsDense,
    stuckSubsetCovered,
    cascadeSafety,
    noStructuralDeadlock,
    measureDescends
  }
}
