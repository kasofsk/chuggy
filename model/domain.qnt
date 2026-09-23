/// THE CHUGGY DOMAIN MACHINE — the deciders, the state and actions layer,
/// and every safety invariant.
///
/// A decider is a PURE FUNCTION of an observed `TicketGraph` and a command,
/// returning the EVENT it decided and the OBLIGATIONS that event owes the
/// world. It never performs one. `evolve` is the other half: a pure function
/// of a `TicketGraph` and an event, and the only thing that moves the state.
/// The machine's step is the two in order, which is what lets the same
/// functions serve any runtime shape, and what lets a golden trace be
/// replayed through them with no world to stub.
///
/// READS ARE NOT EFFECTS. Anything a decision needs is gathered into the view
/// before the decider runs. Getting this backwards is the commonest way a
/// decider/effects split stops being testable: the decider acquires an await,
/// then a mock, and then it is no longer a function.
///
/// THE SHAPE OF A TICKET'S LIFE. It is released as a Pending, and the
/// selector picks it out of the derived Ready set — which pick is the
/// selector's own agency, not scheduler noise, so any policy refines
/// unrestricted choice. Work runs one task set per cycle. Evaluation runs the
/// ticket's authored plan, stage by stage, short-circuiting on a failure.
/// Then the ticket finalizes: a passing final stage moves it into Finalization,
/// where a platform-owned finalizer runs and reports one outcome, and the
/// ticket leaves the phase by that report — including when the report is that
/// no result was reachable, which parks it at the desk.
///
/// THE EVALUATION-FAILURE POLICY. A failing stage has two ways on and this
/// machine chooses neither of them: it CONSULTS an `EvaluationFailurePolicy`
/// (ticket.qnt) handed to the decision. Rework re-enters Work as a new cycle;
/// Escalate parks the ticket on the desk, where the operator's resume
/// re-enters Work the same way. Here the policy answers a nondet draw of
/// `taskDone` — the completion that concludes a failing stage is where it is
/// consulted — and the event names the edge taken, so an implementation that
/// computes it from a ticket's history — a cap on work cycles, a human's
/// call — refines this machine rather than changing it, and a replay never
/// asks it again. A finalization failure has no such fork: it always
/// re-enters Work, and bounding a finalizer's own failure loop is the
/// finalizer's business, below this grain.
///
/// DERIVE, DON'T STORE. Ready and Blocked are predicates over dependencies, not
/// phases, so no unblock cascade exists to get wrong. Lease occupancy is a
/// predicate over phase, so nothing cleans up. The open-desk-task flag, the
/// evaluation tasks the fabric is running and a ticket's dependency
/// artifacts are all derived.
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
///     fabric relaunches a failed task; this machine's grain is the cycle.
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
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "./ticket"

  /// Maximum number of released tickets. Ticket identities come from the
  /// wider finite universe below and may be sparse or numerically reversed.
  const N_TICKETS: int
  /// THE EVALUATOR-KEY BOUND: the finite vocabulary a stage's roster is
  /// drawn from, so an authored evaluator key runs 1..N_TASKS and a stage
  /// carries at most that many possibly-parallel tasks. Work is not fanned
  /// out (ticket.qnt spawnWork) and names no evaluator.
  const N_TASKS: int
  /// Authored-plan length cap — release's validity ceiling. Real plans
  /// are short by construction (stages are declared per evaluator), so the
  /// cap is a model-checking bound rather than domain vocabulary.
  const MAX_STAGES: int
  /// Finite external-id universe for model checking. It is deliberately wider
  /// than the ticket-count bound so traces can contain gaps and reverse
  /// numeric dependency edges. Production ids are opaque and unbounded.
  pure val ticketIdUniverse: Set[int] = 1.to(N_TICKETS * 2)

  /// What an evaluation failure may do. Both edges are always available: the
  /// machine holds no policy over the choice (ticket.qnt
  /// EvaluationFailureDisposition), so every completion may take either, and
  /// any implementation policy is a restriction of this draw.
  pure val dispositionChoices: Set[EvaluationFailureDisposition] =
    Set(ReworkEvaluationFailure, EscalateEvaluationFailure)

  /// THE SOURCE REFERENCES the application may observe, at model scope.
  /// Opaque and positive: what the machine claims about one is that a
  /// dispatched ticket has it and that what the ticket carries afterwards is
  /// what it was last TOLD, never what it could observe again. Two DISJOINT
  /// pairs — a dispatch observes one of the first, a work result is accepted
  /// at one of the second — so a spawn that re-observed a source where it
  /// should have carried one names a number from the wrong pair, and the
  /// goldens show which it carried.
  ///
  /// DRAWN rather than derived, unlike every other opaque reference here: a
  /// source is an observation made outside the machine, and one derived from
  /// the ticket would make the stored field a duplicate of a derivable fact
  /// (standing rule 3) that nothing could ever disagree with.
  ///
  /// Their own BAND, clear of the release references, of the work results
  /// (ticket.qnt producedResultRef) and of the finalization evidence below,
  /// so a number read off a golden belongs to one of those families and the
  /// travel is legible. The evaluator
  /// definitions below are not held clear of it — a wide enough roster reaches
  /// these numbers — and a reader tells the two apart by where a number sits,
  /// a definition only ever inside a plan. The named members are what a
  /// hand-written fixture carries when which one it is is not its subject.
  pure val aDispatchSource: int = 9
  pure val anAcceptedSource: int = 11
  pure val dispatchSources: Set[int] =
    Set(aDispatchSource, aDispatchSource + 1)
  pure val acceptedSources: Set[int] =
    Set(anAcceptedSource, anAcceptedSource + 1)

  /// THE EVIDENCE a finalizer may return, at model scope: DRAWN for the
  /// reason a source is — it is an observation the finalizer makes outside
  /// the machine — in a pair of its own beside the sources.
  pure val aFinalizationEvidence: int = 15
  pure val finalizationEvidences: Set[int] =
    Set(aFinalizationEvidence, aFinalizationEvidence + 1)

  /// WHAT A TASK CAN COME BACK WITH, as the environment may produce it: a
  /// work task produced its artifact at a source the application accepted,
  /// or reached no result at all; an evaluator judged either way or reached
  /// no result. A produced report carries the obligation the ticket owes for
  /// the task (ticket.qnt producedResult), which is the only obligation the
  /// completion's enablement admits; callers draw the task from liveTasks.
  pure def reportChoices(
      jb: Ticket, task: TaskIdentity): Set[TaskTerminalReport] =
    val failures = Set(ProcessFailure, ExecutionUnavailableFailure)
      .map(kind => TerminalFailureReport({
        failure: { task: task, evidence: taskRefOf(task) }, kind: kind }))
    match task {
      | WorkTask(_) => failures.union(acceptedSources.map(accepted =>
          WorkResultReport({ result: producedResult(jb, task),
            acceptedSourceRef: accepted })))
      | EvaluationTask(_) => failures.union(
          Set(EvaluatorPass, EvaluatorFail).map(verdict =>
            EvaluationResultReport({ result: producedResult(jb, task),
              verdict: verdict })))
    }

  /// THE DEFINITION AN EVALUATOR RUNS UNDER, at model scope: a distinct
  /// positive reference per slot, derived from the evaluator's own key,
  /// where the release resolves that stage's configuration and folds the
  /// digests it stores. Distinct per slot so a reader can see which one
  /// travelled. That a stage's evaluators share one definition is the
  /// release's rule rather than the machine's, so nothing here holds them
  /// equal.
  pure def evaluatorTaskOf(key: int): TaskDefinition = {
    workload: 4 * key - 3,
    inputs: 4 * key - 2,
    executionRequirements: 4 * key - 1,
    resultContract: 4 * key
  }

  /// ONE AUTHORED EVALUATOR: a key and the definition it runs under. Named
  /// so a hand-written roster states a key and nothing else — the
  /// definition is the release's to fold, never a fixture's to invent.
  pure def evaluatorOf(key: int): EvaluatorDefinition = {
    key: key, task: evaluatorTaskOf(key) }

  /// THE FULL ROSTER: every evaluator key the bound allows, ascending. The
  /// default plan's stage, and the longest roster a stage can list.
  pure val everyEvaluator: List[EvaluatorDefinition] =
    range(1, N_TASKS + 1).foldl([], (roster, k) => roster.append(evaluatorOf(k)))

  /// The stage rosters an author may draw from: every NON-EMPTY ascending
  /// list of distinct keys from 1..N_TASKS, grown one key at a time. Keys
  /// are authored names rather than positions (ticket.qnt StageDefinition),
  /// so a sparse roster — 1 and 3, skipping 2 — is a choice like any other
  /// and the walk draws it.
  pure val stageChoices: Set[List[EvaluatorDefinition]] =
    everyEvaluator.foldl(Set([]), (acc, entry) =>
      acc.union(acc.map(roster => roster.append(entry))))
      .filter(roster => roster.length() >= 1)

  /// Every WELL-FORMED authorable plan: non-empty, at most MAX_STAGES
  /// stages, each stage a roster from stageChoices under its POSITIONAL key.
  /// This set is the plan half of the release-refusal rule
  /// (releasedTicketValid): the empty plan, the empty roster, a key past the
  /// bound and an overlong plan are not in it, so no release can carry one —
  /// the same structural-refusal shape as dependableTickets for
  /// dependencies.
  pure val validPlans: Set[List[StageDefinition]] =
    1.to(MAX_STAGES).fold(Set([]), (acc, _) =>
      acc.union(acc.map(p => stageChoices.map(roster =>
        p.append({ key: p.length() + 1, evaluators: roster }))).flatten()))
      .filter(p => p.length() >= 1)

  /// THE DEFAULT PLAN: ONE stage listing every evaluator the bound
  /// allows. Every evaluator defaults to stage 0, so a ticket whose
  /// evaluators all share one stage judges in one parallel roster —
  /// pinned in tests/chuggy_test.qnt.
  pure val defaultPlan: List[StageDefinition] =
    [{ key: 1, evaluators: everyEvaluator }]

  /// THE REFERENCES A RELEASE PINS for ticket j, at model scope: one distinct
  /// small positive int per slot, where the real release folds the digest of
  /// the material each one names. Derived rather than drawn for the same
  /// reason a task's result reference is (ticket.qnt producedResult) — the
  /// machine's only claim on one is that it is positive and is the same
  /// number everywhere it travels, and a draw per slot would buy a state
  /// space and no refutation. What is STORED is still the definition the
  /// release carried: it is authored input, and nothing in a reachable state
  /// recomputes it.
  pure def releaseRef(j: int, slot: int): int = 20 * j + slot

  /// THE DEFINITION A RELEASE OF TICKET j CARRIES, over the dependencies and
  /// the plan the author drew. The id is the definition's own: a release
  /// names the ticket inside the record it releases, so the graph's key and
  /// the definition cannot disagree (definitionsWellFormed).
  pure def releasedTicketOf(
      j: int, dependencies_: Set[int],
      stages: List[StageDefinition]): ReleasedTicket = {
    id: j,
    content: releaseRef(j, 1),
    dependencies: dependencies_,
    workConfiguration: {
      workload: releaseRef(j, 2),
      inputs: releaseRef(j, 3),
      executionRequirements: releaseRef(j, 4),
      resultContract: releaseRef(j, 5)
    },
    evaluationPlan: { stages: stages },
    finalizationConfiguration: releaseRef(j, 6)
  }

  /// THE RELEASE'S VALIDITY RULE — the package's releasedTicketValid, plus
  /// the bounds this instantiation is checked under. Positive wherever the
  /// package asks, a plan the protocol will run (evaluation.qnt planValid,
  /// which is also what holds each evaluator's own definition valid), and
  /// then chuggy's own: at most MAX_STAGES stages, each keyed by its own
  /// POSITION, and every evaluator key inside 1..N_TASKS.
  ///
  /// The positional stage key is CHUGGY'S rule and not the contract's, which
  /// asks only that stage keys be distinct: a layer holding an identity but
  /// no plan reads the index back out of the key. Evaluator keys are NOT
  /// positional.
  ///
  /// This IS the release-refusal rule — a definition outside it is refused at
  /// authoring time (refinement.qnt decisionEventEnabled) rather than
  /// defended against mid-flight, which is what makes definitionsWellFormed
  /// hold in every reachable state.
  pure def releasedTicketValid(definition: ReleasedTicket): bool = and {
    definition.id > 0,
    releasedContentValid(definition.content),
    definition.dependencies.forall(dependency => dependency > 0),
    taskDefinitionValid(definition.workConfiguration),
    planValid(definition.evaluationPlan),
    definition.finalizationConfiguration > 0,
    definition.evaluationPlan.stages.length() <= MAX_STAGES,
    definition.evaluationPlan.stages.indices().forall(i =>
      val stage = definition.evaluationPlan.stages[i]
      and {
        stage.key == i + 1,
        evaluatorKeys(stage).forall(k => k >= 1 and k <= N_TASKS)
      })
  }

  /// The ticket-construction seam, now CLOSED: every ticket the machine holds
  /// is built here, and the released pipeline is reached only through
  /// TicketCreated. Everything that will affect the ticket's behaviour rides
  /// the release inside one record and is immutable after it; the source is
  /// the one field a release cannot fill, because nothing has been dispatched
  /// yet.
  pure def freshTicket(definition: ReleasedTicket): Ticket = {
    phase: Pending,
    definition: definition,
    source: 0,
    evaluations: [],
    workCyclesStarted: 0,
    spawned: 0,
    finalizationGeneration: 0,
    escalation: NoEscalation,
    completions: 0
  }

  // ==========================================================================
  // === Pure deciders ========================================================
  // ==========================================================================
  // decide(view, command) -> { event, obligations }, never an effect; every
  // runtime shape reuses these unchanged, and evolve (below) is the only
  // thing that moves a view.

  pure def withTicket(c: TicketGraph, j: int, jb: Ticket): TicketGraph =
    { ...c, tickets: c.tickets.set(j, jb) }

  /// A decision: the event, and what it owes (the package's `decided`).
  pure def decided(
      event: TicketEvent,
      obligations: List[Obligation]): SuccessfulTicketDecision =
    { event: event, obligations: obligations }

  // --- Release and revoke ---------------------------------------------------

  /// A ticket IS RELEASED as a Pending — the environment (an author) creates it.
  /// A ticket does not exist in TicketGraph before this decision. Its
  /// externally allocated id may be sparse. Dependencies may point only at
  /// already released tickets, and never at a tombstone: a Revoked ticket never
  /// becomes Done, so an edge to one is an edge that blocks its dependent
  /// for good, and refusing it at authoring time is what keeps an author
  /// from writing that ticket rather than discovering it afterwards.
  /// Callers guarantee dependencies_ ⊆ dependable ids (see `dependableTickets`).
  ///
  /// The release carries the whole DEFINITION, validated the same structural
  /// way — callers guarantee it satisfies releasedTicketValid, so an empty
  /// plan, an empty roster, a key past N_TASKS or named twice, an
  /// off-position stage key, an overlong plan or a reference at zero is
  /// REFUSED at authoring time: no reachable state holds one
  /// (definitionsWellFormed), rather than the interpreter defending against
  /// one mid-flight. The definition is immutable after release.
  ///
  /// Dynamic-DAG boundary: releases are author actions — only
  /// the environment action `release` calls this decider, and no ticket-event
  /// decider creates tickets, so the ticket set grows only by authoring, never by
  /// tickets spawning tickets. Author commands (release/revoke) are also guarded
  /// by enablement: authors are command sources, not the at-least-once fabric.
  ///
  /// The first domain decision for a ticket. The id is allocated by native
  /// release candidate authoring, may be sparse, and is never minted or
  /// ordered by TicketGraph.
  pure def decideReleaseTicket(
      c: TicketGraph, definition: ReleasedTicket): SuccessfulTicketDecision =
    decided(TicketCreated(definition), [])

  /// REVOKE — the author settles one ticket. Every non-terminal phase short
  /// of Finalization may be revoked (the caller's guard, revocableIn), and
  /// the terminals are absorbing, so nothing ever moves a ticket OUT of
  /// Revoked (invariant terminalsAbsorbing). The world is told to cancel
  /// every task the fabric is running for it, while the evaluation instances
  /// are KEPT exactly as they stood — provenance survives the author's
  /// settlement, "Revoked runs nothing" is not "Revoked remembers nothing",
  /// and leaving the phase is already enough to stop a run's obligations
  /// being owed (ticket.qnt liveObligations) — and the escalation is
  /// cleared: Revoked opens NO human task (hasOpenHumanTask excludes it;
  /// revocation is the author's settled choice, like Done).
  ///
  /// ONE TICKET MOVES, the one the author named. A dependent behind it is
  /// left where it is: it stays Pending, depsDoneIn never admits it (a dep
  /// that is not Done blocks, and Revoked never becomes Done), and revoke
  /// stays offered on it (revocablesIn admits Pending), so its own author
  /// settles it the same way this one was settled. Revoking it here would
  /// destroy another author's ticket with no human deciding it, and parking
  /// it here would open a desk task for a decision only its author can take.
  pure def decideRevoke(c: TicketGraph, j: int): SuccessfulTicketDecision =
    decided(TicketRevoked(j), cancelLiveTasks(c.tickets.get(j)))

  // --- Pure guard predicates ------

  /// Revocation stops before finalization and cannot rewrite a terminal
  /// outcome (the package's revocationAllowed, over chuggy's phase).
  pure def revocationAllowed(phase: Phase): bool =
    phase != Done and phase != Revoked and phase != Finalization

  pure def revocableIn(c: TicketGraph, j: int): bool =
    revocationAllowed(c.tickets.get(j).phase)

  /// May the operator retry this ticket's open human action? Exactly while
  /// the desk holds a task for it — every resume is free, so nothing else is
  /// asked, and every wall the sum can hold resumes somewhere (resumeOf is
  /// total), so there is no stamp left to check against the phase.
  pure def retryableIn(c: TicketGraph, j: int): bool =
    hasOpenHumanTask(c.tickets.get(j))

  /// WHAT A TICKET WAITS ON before it may run — the single definition, read
  /// by the readiness check (depsDoneIn) and the cross-ticket artifact
  /// read alike. Named for
  /// what it is rather than for the dispatch gate it feeds, because the
  /// merge gate that shared that word is gone.
  ///
  /// One definition on purpose: the grouping defect was a DERIVED waiting
  /// relation diverging from the stored field depsAcyclic watched, so a
  /// future derived relation moves both checks or neither.
  pure def waitsOn(c: TicketGraph, j: int): Set[int] =
    c.tickets.get(j).definition.dependencies

  /// WHAT THIS TICKET'S DEPENDENCIES PRODUCED (design 002) — the read that
  /// makes a release ticket expressible at all. Derived, never stored, and
  /// stable: every dep is Done before a dependent can dispatch, and Done
  /// is absorbing, so nothing here can change under a reader.
  pure def depArtifacts(c: TicketGraph, j: int): Set[ArtifactMark] =
    waitsOn(c, j).map(d => artifactOf(c.tickets.get(d)))

  pure def depsDoneIn(c: TicketGraph, j: int): bool =
    waitsOn(c, j).forall(k => c.tickets.get(k).phase == Done)

  // --- TicketGraph-parameterized enablement: the machine's actions and the
  // refinement's decide step (model/refinement.qnt, decisionEventEnabled)
  // read the SAME definitions, because a copied guard drifts. Each
  // enablement val below (the state section) is a one-line reference to its
  // pure TicketGraph form here.

  /// Room for one more release (the N_TICKETS release bound).
  pure def canReleaseIn(c: TicketGraph, j: int): bool = and {
    c.tickets.keys().size() < N_TICKETS,
    ticketIdUniverse.contains(j),
    not(c.tickets.keys().contains(j))
  }

  /// Tickets a release may depend on: anything but a tombstone, because a
  /// Revoked ticket never becomes Done (decideReleaseTicket).
  pure def dependableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(k => c.tickets.get(k).phase != Revoked)

  /// Every non-terminal may be revoked.
  pure def revocablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => revocableIn(c, j))

  /// The derived Ready room (isReadyIn per ticket).
  pure def readiesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => isReadyIn(c, j))

  /// Tickets the fabric is currently running a task for, which is who a
  /// completion can be delivered to.
  pure def completableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => liveTasks(c.tickets.get(j)) != Set())

  pure def doneIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == Done)

  /// Parked tickets the operator may Retry (retryableIn per ticket).
  pure def retryablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => retryableIn(c, j))

  /// The derived waiting room (standing rule 3), as pure predicates over a
  /// TicketGraph so tests can pin them: any dependency not yet Done blocks.
  pure def isReadyIn(c: TicketGraph, j: int): bool =
    c.tickets.get(j).phase == Pending and depsDoneIn(c, j)

  pure def isBlockedIn(c: TicketGraph, j: int): bool =
    c.tickets.get(j).phase == Pending and not(depsDoneIn(c, j))

  /// Every task identity ticket j has ever been owed: one work task per
  /// cycle it has started, and every evaluator of every run its instances
  /// hold, at the generation those runs now stand at. DERIVED — the ticket
  /// keeps no task log — and a superset of the live set, which is the point:
  /// the suites build an event about a SETTLED task from here to show evolve
  /// lets it fall through.
  pure def deliverableTasksIn(c: TicketGraph, j: int): Set[TaskIdentity] =
    val jb = c.tickets.get(j)
    range(1, jb.workCyclesStarted + 1)
      .foldl(Set(), (found, cycle) => found.union(Set(workTaskOf(j, cycle))))
      .union(jb.evaluations.foldl(Set(), (found, evaluation) =>
        found.union(instanceTasks(evaluation))))

  // --- Work, judgement and the finalizer -----------------------------------

  /// Ready -> Work: launch a cycle for the ticket THE SELECTOR PROPOSED.
  /// Work is ONE task phase (one work task per cycle; Work is not
  /// staged), and the cycle counter — with the run's own generation for an
  /// evaluation — is what makes each identity a ticket names one no earlier
  /// task of it ever carried.
  ///
  /// THE AGENTIC SELECTOR: this decider makes the accepted dispatch
  /// proposal first-class — j
  /// is the CHOICE, and the chooser is the `dispatch` action's nondet pick
  /// among readyTickets. That pick is not incidental scheduler noise to be
  /// refined away: the selector is itself agentic rather than a FIFO pop,
  /// so its choice is a genuine nondet outcome and ANY
  /// Ready ticket may be chosen next, and the TicketDispatched event in the
  /// trace IS the ticket writer's decision — an implementation
  /// conforms with any policy (LLM-driven, priority, whatever) because
  /// every policy refines unrestricted choice among Ready tickets. No
  /// policy-hook parameter is introduced: with exactly one honest default
  /// (unrestricted nondet) a const would have one branch and nothing to
  /// compare — it enters only when a real competing policy needs modeling.
  /// No queue, no fairness — standing non-goals.
  ///
  /// THE SOURCE IS OBSERVED HERE AND NOWHERE ELSE (ticket.qnt Ticket.source):
  /// the dispatch is the one edge that looks at what the ticket's repository
  /// is at, so it is an argument to this decider and to no other.
  pure def decideDispatch(
      c: TicketGraph, j: int, source_: int): SuccessfulTicketDecision =
    val jb = c.tickets.get(j)
    decided(TicketDispatched({ ticket: j, source: source_ }),
      [executeWork(jb, jb.workCyclesStarted + 1)])

  /// THE COMPLETION — one decider for every task this machine ever asks
  /// for, in either phase, carrying what came back (ticket.qnt
  /// TaskTerminalReport). There is no second decision behind it: a work
  /// completion that produced opens the judgement in the same step, and a
  /// completion that concludes a stage decides the stage, which is why the
  /// evaluation-failure policy is an argument here.
  ///
  /// It is guarded by enablement (refinement.qnt decisionEventEnabled): the
  /// task is one the ticket owes and the report is one it can carry. A
  /// completion for a task nothing owes is refused before it is decided;
  /// the event it would have been falls through evolve by identity, which
  /// is what a duplicate that slipped past the door would meet.
  ///
  /// A WALL IS NOT A VERDICT, and the two phases answer it differently. An
  /// evaluator that infrastructure could not run marks that evaluator and
  /// the stage RUNS ON: its siblings are still judging, and whether the
  /// ticket parks is the stage's decision once they finish (evaluation.qnt
  /// concludeStage). A work task's wall parks the ticket at once, because a
  /// work cycle is one task and there is nothing left of it to wait for.
  pure def decideTaskDone(
      c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport,
      failurePolicy: EvaluationFailurePolicy): SuccessfulTicketDecision =
    val jb = c.tickets.get(j)
    if (jb.phase == Work) decideWorkTaskDone(jb, j, report)
    else decideEvalTaskDone(jb, j, report, failurePolicy)

  /// A WORK completion. The cycle's one task has come back: a produced
  /// result is ACCEPTED, which opens the instance that judges it and asks
  /// its first stage — one task per evaluator that stage lists, fanned out
  /// in parallel. Every entry spawns the stage in full — an evaluator is
  /// never skipped on the grounds that its subject did not change, because
  /// deciding that soundly needs the evaluator to declare its own footprint
  /// honestly, which is a property of the evaluator and not of this machine.
  ///
  /// A task that died is a failed CYCLE and parks: the fabric has already
  /// retried it below the cycle (trusted relaunch limit), and modeling
  /// attempts of our own is a standing non-goal. Infrastructure that could
  /// not run it at all parks it at its own wall: there is no sibling to wait
  /// for and no judgement to preserve.
  pure def decideWorkTaskDone(
      jb: Ticket, j: int, report: TaskTerminalReport): SuccessfulTicketDecision =
    match report {
      | WorkResultReport(produced) =>
        decided(TicketWorkResultAccepted({ ticket: j, result: produced.result,
            acceptedSourceRef: produced.acceptedSourceRef }),
          executeEvaluationTasks(j, begunInstance(jb, produced.result.resultRef,
            produced.acceptedSourceRef)))
      | TerminalFailureReport(failed) => {
        val fact = { ticket: j, task: failed.failure.task,
          evidence: failed.failure.evidence }
        match failed.kind {
          | ProcessFailure => decided(TicketWorkProcessFailed(fact), [])
          | ExecutionUnavailableFailure =>
            decided(TicketWorkExecutionUnavailable(fact), [])
        }
      }
      // Unreachable: a work task takes no evaluator's verdict
      // (ticket.qnt reportMatchesTask is the completion's enablement), and
      // evolve lets this event fall through a ticket in Work.
      | EvaluationResultReport(_) =>
        decided(TicketEvaluationProgressed({ ticket: j, report: report }), [])
    }

  /// AN EVALUATION completion, which is also THE EVALUATION-PLAN INTERPRETER:
  /// the report goes to the instance (ticket.qnt applyEvaluationReport, which
  /// is the protocol's own applyProduced/applyFailure and their
  /// concludeStage), and the state that comes back says which event this is:
  ///
  ///   - still RUNNING the same stage -> Progressed: a status settled and the
  ///     stage owes its remaining evaluators, so nothing new is owed.
  ///   - RUNNING a later stage -> Progressed: the stage passed and the next
  ///     one is asked, one ExecuteTask per evaluator it lists.
  ///   - PASSED -> the plan passed, so the ticket finalizes: the first
  ///     attempt of this cycle's finalization is owed. WHAT its finalizer
  ///     commits, and whether that is anything at all, is the finalizer's
  ///     own configuration below this grain.
  ///   - FAILED -> the later stages are not created: they are skipped, not
  ///     failed, and no run exists for them. The policy picks the edge and
  ///     the event names it — ReworkStarted re-enters Work as a new cycle,
  ///     whose judgement is a new instance; FailureEscalated parks at the
  ///     evaluation-failure wall, whose resume re-enters Work the same way.
  ///   - BLOCKED -> every evaluator has answered and at least one of them
  ///     was a wall, so the judgement is intact and unmade: park at the
  ///     blocked wall, whose resume re-asks exactly those evaluators at the
  ///     next generation (decideResumeTicket).
  pure def decideEvalTaskDone(
      jb: Ticket, j: int, report: TaskTerminalReport,
      failurePolicy: EvaluationFailurePolicy): SuccessfulTicketDecision =
    val before = currentInstance(jb)
    val advanced = applyEvaluationReport(before, report)
    val fact = { ticket: j, report: report }
    match advanced.state {
      | Running(progress) =>
        decided(TicketEvaluationProgressed(fact),
          if (progress.stage.stageIndex == runningStageIndex(before)) []
          else executeEvaluationTasks(j, advanced))
      | EvaluationPassed(_) =>
        decided(TicketEvaluationPassed(fact), [finalize(jb, {
          workCycle: advanced.workCycle,
          generation: 1,
          input: advanced.input.workResult,
          source: advanced.input.acceptedSourceRef })])
      | EvaluationFailed(completedStages) => {
        val rework = { ticket: j, report: report,
          evidence: reworkEntries(advanced, completedStages) }
        match failurePolicy(advanced) {
          | ReworkEvaluationFailure =>
            decided(TicketEvaluationReworkStarted(rework),
              [executeWork(jb, jb.workCyclesStarted + 1)])
          | EscalateEvaluationFailure =>
            decided(TicketEvaluationFailureEscalated(rework), [])
        }
      }
      | EvaluationBlocked(_) => decided(TicketEvaluationBlocked(fact), [])
    }

  /// A finalizer reports only a domain outcome. Queueing,
  /// preparation, approval, permits and reconciliation are focused durable
  /// operational records; TicketGraph does not learn a finalizer
  /// implementation. Which conditions a finalizer calls unreachable is the
  /// same kind of detail: the machine draws the outcome, never the cause.
  pure def finalizationOutcomes: Set[FinalizationOutcome] =
    Set(FinalizationSucceeded, FinalizationNeedsWork,
      FinalizationResultUnavailable)

  pure def finalizationOutcomeEnabled(
      c: TicketGraph, j: int, out: FinalizationOutcome): bool =
    match out {
      | FinalizationSucceeded => c.tickets.get(j).phase == Finalization
      | FinalizationNeedsWork => c.tickets.get(j).phase == Finalization
      | FinalizationResultUnavailable => c.tickets.get(j).phase == Finalization
    }

  /// Is this the attempt the ticket is on? (the package's
  /// finalizationCurrent) A result for an attempt a resume superseded names
  /// one nothing owes.
  pure def finalizationCurrent(
      operation: FinalizationOperation, workCycle: int,
      generation: int): bool =
    operation.workCycle == workCycle and operation.generation == generation

  /// A result resolves only from Finalization, and answers the attempt the
  /// ticket is on — the command names the ticket and the finalizer's
  /// evidence, and the decider names the attempt. A success is the ticket's
  /// single completion (ghost `completions` counts it, one per ticket). A
  /// failure re-enters Work as a new cycle: it did not commit the artifact,
  /// and the only way on for a failed commit is new work — there is no wall
  /// here, because how many times a finalizer may report failure is the
  /// finalizer's own business, below this grain. No result at all parks the
  /// ticket at ResumeFinalization, which is the only wall whose resume
  /// re-runs the very step it interrupted — nothing about the ticket has to
  /// change for the next attempt to differ, because what stood in the way
  /// was never the ticket. Without this edge a finalizer that cannot reach a
  /// result leaves the ticket in Finalization, which is neither revocable
  /// (revocableIn) nor retryable (retryableIn), until the environment changes
  /// under it.
  pure def decideFinalizationResult(
      c: TicketGraph, j: int, out: FinalizationOutcome,
      evidence: int): SuccessfulTicketDecision =
    val jb = c.tickets.get(j)
    val fact = { ticket: j, workCycle: jb.workCyclesStarted,
      generation: jb.finalizationGeneration, evidence: evidence }
    match out {
      | FinalizationSucceeded => decided(TicketFinalizationSucceeded(fact), [])
      | FinalizationNeedsWork => decided(TicketFinalizationNeedsWork(fact),
          [executeWork(jb, jb.workCyclesStarted + 1)])
      | FinalizationResultUnavailable =>
        decided(TicketFinalizationUnavailable(fact), [])
    }

  /// Operator Retry on a parked ticket: resume at the point its wall implies
  /// (resumeOf), the event naming which. Resuming is free — a resume is a
  /// human act, and this machine bounds no human:
  ///   ResumeWork and ResumeRework: THE SAME WAY ON, TicketWorkResumed —
  ///     spawn the work task as a new cycle. The two walls they answer differ
  ///     (failed work, a failed evaluation) but a verdict has no re-judge to
  ///     offer, so both are honest only as new work.
  ///   ResumeEvaluation: TicketEvaluationResumed — RE-ASK THE EVALUATORS THE
  ///     WALL STOPPED, and only those: the instance's blocked run is reopened
  ///     at the next generation and the evaluators that already judged keep
  ///     what they said (evaluation.qnt resumeBlocked). The generation is
  ///     what makes the re-asked tasks new identities, so a late completion
  ///     from the interrupted attempt names one nothing is waiting on.
  ///   ResumeFinalization: TicketFinalizationResumed — the next generation of
  ///     the cycle's finalization is owed.
  pure def decideResumeTicket(c: TicketGraph, j: int): SuccessfulTicketDecision =
    val jb = c.tickets.get(j)
    val workResume =
      decided(TicketWorkResumed(j), [executeWork(jb, jb.workCyclesStarted + 1)])
    match resumeOf(jb.escalation) {
      | ResumeWork => workResume
      | ResumeRework => workResume
      | ResumeEvaluation =>
        decided(TicketEvaluationResumed(j),
          executeEvaluationTasks(j, resumeBlocked(currentInstance(jb))))
      | ResumeFinalization => {
        val operation = finalizationOperationOf(jb)
        decided(TicketFinalizationResumed(j),
          [finalize(jb, { ...operation, generation: operation.generation + 1 })])
      }
      // Unreachable: retryableIn refuses an unparked ticket, and
      // deskConsistent holds that an unparked ticket is at NoEscalation,
      // which is the only escalation resumeOf answers NoResume for; evolve
      // lets this event fall through a ticket that is not parked.
      | NoResume => decided(TicketWorkResumed(j), [])
    }

  // ==========================================================================
  // === evolve ===============================================================
  // ==========================================================================

  /// THE TICKET AN EVENT IS ABOUT, whichever arm it is.
  pure def eventTicket(fact: TicketEvent): int = match fact {
    | TicketCreated(definition) => definition.id
    | TicketDispatched(dispatch) => dispatch.ticket
    | TicketRevoked(ticket) => ticket
    | TicketWorkResumed(ticket) => ticket
    | TicketEvaluationResumed(ticket) => ticket
    | TicketFinalizationResumed(ticket) => ticket
    | TicketWorkResultAccepted(accepted) => accepted.ticket
    | TicketWorkProcessFailed(failure) => failure.ticket
    | TicketWorkExecutionUnavailable(failure) => failure.ticket
    | TicketEvaluationProgressed(progress) => progress.ticket
    | TicketEvaluationPassed(progress) => progress.ticket
    | TicketEvaluationReworkStarted(rework) => rework.ticket
    | TicketEvaluationFailureEscalated(rework) => rework.ticket
    | TicketEvaluationBlocked(progress) => progress.ticket
    | TicketFinalizationSucceeded(result) => result.ticket
    | TicketFinalizationNeedsWork(result) => result.ticket
    | TicketFinalizationUnavailable(result) => result.ticket
  }

  /// THE CONSTRUCTOR'S OWN NAME, which is how the golden aims (and nothing
  /// else) read an event.
  pure def eventName(fact: TicketEvent): str = match fact {
    | TicketCreated(_) => "TicketCreated"
    | TicketDispatched(_) => "TicketDispatched"
    | TicketRevoked(_) => "TicketRevoked"
    | TicketWorkResumed(_) => "TicketWorkResumed"
    | TicketEvaluationResumed(_) => "TicketEvaluationResumed"
    | TicketFinalizationResumed(_) => "TicketFinalizationResumed"
    | TicketWorkResultAccepted(_) => "TicketWorkResultAccepted"
    | TicketWorkProcessFailed(_) => "TicketWorkProcessFailed"
    | TicketWorkExecutionUnavailable(_) => "TicketWorkExecutionUnavailable"
    | TicketEvaluationProgressed(_) => "TicketEvaluationProgressed"
    | TicketEvaluationPassed(_) => "TicketEvaluationPassed"
    | TicketEvaluationReworkStarted(_) => "TicketEvaluationReworkStarted"
    | TicketEvaluationFailureEscalated(_) => "TicketEvaluationFailureEscalated"
    | TicketEvaluationBlocked(_) => "TicketEvaluationBlocked"
    | TicketFinalizationSucceeded(_) => "TicketFinalizationSucceeded"
    | TicketFinalizationNeedsWork(_) => "TicketFinalizationNeedsWork"
    | TicketFinalizationUnavailable(_) => "TicketFinalizationUnavailable"
  }

  /// Park a ticket on the human desk, naming the wall (the termination
  /// requirement commits the terminal, not the names); where Retry resumes
  /// is the wall's own (resumeOf). The open desk task is DERIVED from the
  /// phase (hasOpenHumanTask, standing rule 3). This is THE park. An
  /// evaluation park keeps its instance, which is what its resume re-asks
  /// from.
  pure def park(jb: Ticket, wall: Escalation): Ticket =
    { ...jb, phase: Escalated, escalation: wall }

  /// Enter a new work cycle, from wherever the event says the ticket was.
  pure def enterWork(jb: Ticket): Ticket =
    { ...spawnWork(jb), phase: Work, escalation: NoEscalation }

  /// THE EVALUATION EVENTS' SHARED SHAPE: the report goes to the current
  /// instance, and the event moves the ticket only while the instance still
  /// owes the reported task and concludes as the event says it did.
  pure def evolveEvaluation(
      jb: Ticket, report: TaskTerminalReport,
      concluded: EvaluationInstance => bool,
      moved: EvaluationInstance => Ticket): Ticket =
    if (jb.phase != Evaluation) jb
    else if (not(reportAdmissible(currentInstance(jb), report))) jb
    else {
      val advanced = applyEvaluationReport(currentInstance(jb), report)
      if (concluded(advanced)) moved(advanced) else jb
    }

  /// ONE TICKET UNDER ONE EVENT, arm for arm the package's evolve over
  /// chuggy's record: each arm applies its event only to a ticket that still
  /// owes it — the phase the event leaves, the work task the cycle is on
  /// (package workTaskObligation's match), the evaluator the run still awaits
  /// (reportAdmissible), the finalization attempt the ticket is on
  /// (finalizationCurrent) — and leaves any other ticket exactly as it is.
  pure def evolveTicket(jb: Ticket, fact: TicketEvent): Ticket = match fact {
    | TicketCreated(_) => jb
    | TicketDispatched(dispatch) =>
      if (jb.phase == Pending) { ...enterWork(jb), source: dispatch.source }
      else jb
    | TicketRevoked(_) =>
      if (revocationAllowed(jb.phase))
        { ...jb, phase: Revoked, escalation: NoEscalation }
      else jb
    | TicketWorkResumed(_) =>
      if (jb.phase == Escalated and Set(WorkFailureEscalated,
          WorkExecutionUnavailableEscalated, EvaluationFailureEscalated)
          .contains(jb.escalation)) enterWork(jb)
      else jb
    | TicketEvaluationResumed(_) =>
      if (jb.phase == Escalated and jb.escalation == EvaluationBlockedEscalated)
        spawnEvalRun({ ...withInstance(jb, resumeBlocked(currentInstance(jb))),
          phase: Evaluation, escalation: NoEscalation })
      else jb
    | TicketFinalizationResumed(_) =>
      if (jb.phase == Escalated and
          jb.escalation == FinalizationUnavailableEscalated)
        { ...jb, phase: Finalization, escalation: NoEscalation,
          finalizationGeneration: jb.finalizationGeneration + 1 }
      else jb
    | TicketWorkResultAccepted(accepted) =>
      if (jb.phase == Work and accepted.result.obligation ==
          workTaskObligation(jb, jb.workCyclesStarted))
        spawnEvalRun({ ...jb, phase: Evaluation,
          source: accepted.acceptedSourceRef,
          evaluations: jb.evaluations.append(begunInstance(jb,
            accepted.result.resultRef, accepted.acceptedSourceRef)) })
      else jb
    | TicketWorkProcessFailed(failure) =>
      if (jb.phase == Work and
          failure.task == workTaskOf(jb.definition.id, jb.workCyclesStarted))
        park(jb, WorkFailureEscalated)
      else jb
    | TicketWorkExecutionUnavailable(failure) =>
      if (jb.phase == Work and
          failure.task == workTaskOf(jb.definition.id, jb.workCyclesStarted))
        park(jb, WorkExecutionUnavailableEscalated)
      else jb
    | TicketEvaluationProgressed(progress) =>
      evolveEvaluation(jb, progress.report,
        advanced => runningStageIndex(advanced) >= 0,
        advanced =>
          if (runningStageIndex(advanced) ==
              runningStageIndex(currentInstance(jb)))
            withInstance(jb, advanced)
          else spawnEvalRun(withInstance(jb, advanced)))
    | TicketEvaluationPassed(progress) =>
      evolveEvaluation(jb, progress.report,
        advanced => match advanced.state {
          | EvaluationPassed(_) => true
          | _ => false },
        advanced => { ...withInstance(jb, advanced), phase: Finalization,
          finalizationGeneration: 1 })
    | TicketEvaluationReworkStarted(rework) =>
      evolveEvaluation(jb, rework.report,
        advanced => match advanced.state {
          | EvaluationFailed(_) => true
          | _ => false },
        advanced => enterWork(withInstance(jb, advanced)))
    | TicketEvaluationFailureEscalated(failure) =>
      evolveEvaluation(jb, failure.report,
        advanced => match advanced.state {
          | EvaluationFailed(_) => true
          | _ => false },
        advanced => park(withInstance(jb, advanced),
          EvaluationFailureEscalated))
    | TicketEvaluationBlocked(unavailable) =>
      evolveEvaluation(jb, unavailable.report,
        advanced => instanceBlocked(advanced),
        advanced => park(withInstance(jb, advanced),
          EvaluationBlockedEscalated))
    | TicketFinalizationSucceeded(result) =>
      if (jb.phase == Finalization and finalizationCurrent(
          finalizationOperationOf(jb), result.workCycle, result.generation))
        { ...jb, phase: Done, completions: jb.completions + 1 }
      else jb
    | TicketFinalizationNeedsWork(rework) =>
      if (jb.phase == Finalization and finalizationCurrent(
          finalizationOperationOf(jb), rework.workCycle, rework.generation))
        enterWork(jb)
      else jb
    | TicketFinalizationUnavailable(unavailable) =>
      if (jb.phase == Finalization and finalizationCurrent(
          finalizationOperationOf(jb), unavailable.workCycle,
          unavailable.generation))
        park(jb, FinalizationUnavailableEscalated)
      else jb
  }

  /// THE STATE AFTER AN EVENT — the package's evolve. It applies an event
  /// only to a state that still owes it and is the identity on every other,
  /// which is what the package's `evolve` states at its reportAdmissible and
  /// finalizationCurrent guards.
  pure def evolve(c: TicketGraph, fact: TicketEvent): TicketGraph =
    match fact {
      | TicketCreated(definition) =>
        if (c.tickets.keys().contains(definition.id)) c
        else { ...c,
          tickets: c.tickets.put(definition.id, freshTicket(definition)) }
      | _ =>
        if (not(c.tickets.keys().contains(eventTicket(fact)))) c
        else withTicket(c, eventTicket(fact),
          evolveTicket(c.tickets.get(eventTicket(fact)), fact))
    }

  // ==========================================================================
  // === The decision's own validity (the package's decisionValid) ===========
  // ==========================================================================

  /// Every obligation names its own ticket, and every reference in it is a
  /// real one.
  pure def obligationValid(obligation: Obligation): bool = match obligation {
    | ExecuteTask(execution) =>
      execution.ticket == taskOwner(execution.task.task)
        and taskObligationValid(execution.task)
    | FinalizeTicket(finalization) =>
      finalization.ticket > 0
        and finalization.finalization.workCycle > 0
        and finalization.finalization.generation > 0
        and finalization.configuration > 0
        and finalization.finalization.input > 0
        and finalization.finalization.source > 0
    | CancelTask(cancellation) =>
      cancellation.ticket == taskOwner(cancellation.task)
        and taskIdentityValid(cancellation.task)
  }

  pure def obligationsUnique(obligations: List[Obligation]): bool =
    obligations.indices().forall(left =>
      obligations.indices().forall(right =>
        left == right or obligations[left] != obligations[right]))

  pure def ticketLiveTasks(c: TicketGraph, j: int): List[TaskIdentity] =
    if (c.tickets.keys().contains(j)) liveTaskList(c.tickets.get(j)) else []

  /// AN OBLIGATION AGREES WITH THE EVENT BESIDE IT: a task to run is one the
  /// evolved ticket owes, a task to stop is one the prior ticket owed and the
  /// evolved one does not, and a finalization to attempt is the one the
  /// evolved ticket is on.
  pure def obligationAgrees(
      prior: TicketGraph, evolved: TicketGraph, obligation: Obligation): bool =
    match obligation {
      | ExecuteTask(execution) =>
        listHasTask(ticketLiveTasks(evolved, execution.ticket),
          execution.task.task)
      | CancelTask(cancellation) =>
        listHasTask(ticketLiveTasks(prior, cancellation.ticket),
          cancellation.task)
          and not(listHasTask(ticketLiveTasks(evolved, cancellation.ticket),
            cancellation.task))
      | FinalizeTicket(finalization) =>
        evolved.tickets.keys().contains(finalization.ticket)
          and evolved.tickets.get(finalization.ticket).phase == Finalization
          and finalizationOperationOf(evolved.tickets.get(finalization.ticket))
            == finalization.finalization
    }

  /// A DECISION IS VALID at the state it was taken in when every obligation
  /// is well-formed and agrees with the state its event evolves to, and no
  /// obligation is owed twice. The evolved state's own invariants are the
  /// machine's (allInvariants), checked on the state the step lands in.
  pure def decisionValid(
      c: TicketGraph, decision: SuccessfulTicketDecision): bool =
    val evolved = evolve(c, decision.event)
    and {
      decision.obligations.indices().forall(index =>
        obligationValid(decision.obligations[index])
          and obligationAgrees(c, evolved, decision.obligations[index])),
      obligationsUnique(decision.obligations)
    }

  // ==========================================================================
  // === State + actions ======================================================
  // ==========================================================================

  var tickets: int -> Ticket
  /// The last decision — the golden-trace-shaped observation (standing rule
  /// 4: the model emits golden traces from day one).
  var lastStep: LastDecision
  /// GHOST: the tickets as the last decision found them — written by every
  /// decision, read only by the invariants that need one step of history.
  var prevTickets: int -> Ticket

  val graph: TicketGraph = { tickets: tickets }
  val prevGraph: TicketGraph = { tickets: prevTickets }

  /// Released ticket identities. Ordering has no semantic meaning.
  val liveTickets: Set[int] = tickets.keys()

  /// THE MACHINE'S STEP: decide, then evolve. The state is what the event
  /// evolves it to, and the decision is what the trace records.
  action apply(d: SuccessfulTicketDecision): bool = all {
    tickets' = evolve(graph, d.event).tickets,
    lastStep' = Decided(d),
    prevTickets' = tickets
  }

  /// REFINEMENT-LAYER SEAM (the state-shaped counterpart of the
  /// TicketGraph-parameterized enablement exports above): install an
  /// externally reconstructed TicketGraph WITHOUT taking a domain step. The
  /// refinement module's executor/crash actions (refinement.qnt emitNext /
  /// crashRecover / effectCrash) are NOT domain steps — the domain trace
  /// has no row for them — so the step-history ghosts stay STALE (they
  /// keep describing the last real decision, which keeps every
  /// lastStep/ghost invariant's verdict byte-identical across the
  /// refinement-layer step; `apply` would re-snapshot them and falsely
  /// present the crash as a domain step). NOT in `step`'s any{}
  /// roster: the domain machine cannot reach this — only the refinement
  /// layer calls it, and only with a replay of its own journal (under the
  /// journal-then-effect discipline that replay equals the live state —
  /// refinement.qnt recoveryComplete — so the domain vars do not move).
  /// Exported as an action rather than left to the refinement module
  /// because Quint 0.32's instance flattening rejects a primed assignment
  /// of an instance's var from the importing module's own expressions
  /// ("Variable not set" at evaluation) — the assignment must live in the
  /// module that declares the var, exactly like the invariants.
  action installGraph(c: TicketGraph): bool = all {
    tickets' = c.tickets,
    lastStep' = lastStep,
    prevTickets' = prevTickets
  }

  // --- Derived waiting room (standing rule 3: derive, don't store) ---------
  // Blocked and Ready are PREDICATES over dependencies, not phases.
  // Storing them is what forces an unblock cascade; chuggy stores only
  // Pending and derives the split, so the
  // unblock cascade disappears entirely — there is no Blocked->Ready edge
  // to model or to get wrong. (The open-human-task flag is derived too:
  // ticket.qnt hasOpenHumanTask; the tasks are derived from the phase and
  // the current run: ticket.qnt liveObligations.) The model extends them
  // for free: a Pending dependency is simply not Done and blocks with no
  // new machinery; the pure bodies live with
  // the deciders (isReadyIn/isBlockedIn) so unit tests can pin exactly
  // that.

  def isReady(j: int): bool = isReadyIn(graph, j)

  def isBlocked(j: int): bool = isBlockedIn(graph, j)

  // --- Enablement sets ------------------------------------------------------

  // Each enablement val below REFERENCES its pure TicketGraph form: one
  // definition, consumed by the machine's actions, the witness drivers, and
  // the refinement's decide step alike.

  /// Room for one more release (the N_TICKETS release bound keeps the state
  val releasableIds: Set[int] = ticketIdUniverse.filter(j => canReleaseIn(graph, j))
  /// Tickets a new release may depend on: no tombstones (dependableIn).
  val dependableTickets: Set[int] = dependableIn(graph)
  /// Every non-terminal may be revoked.
  val revocableTickets: Set[int] = revocablesIn(graph)
  val readyTickets: Set[int] = readiesIn(graph)
  /// Tickets a completion can be delivered to.
  val completableTickets: Set[int] = completableIn(graph)
  val finalizerTickets: Set[int] = liveTickets.filter(j =>
    tickets.get(j).phase == Finalization)
  val doneTickets: Set[int] = doneIn(graph)
  /// Parked tickets the operator may Retry (retryableIn).
  val retryableEscalated: Set[int] = retryablesIn(graph)

  /// No machine, operator, or author action can move anything. Revoke is
  /// enabled on EVERY non-terminal short of Finalization, so a Pending chain
  /// stranded behind a revoked dep is still actionable by its author — the
  /// only true dead end is a
  /// fully-released fleet in which every ticket is settled in a terminal
  /// (Done or Revoked). The `settle` stutter covers exactly that state so
  /// runs never deadlock.
  val quiet: bool = and {
    releasableIds.size() == 0,
    liveTickets.forall(j => Set(Done, Revoked).contains(tickets.get(j).phase))
  }

  /// THE LAST EVENT'S NAME, ITS TICKET AND ITS OBLIGATIONS — what the golden
  /// aims (test/golden/manifest.json) read, and nothing else. Empty before
  /// the first decision.
  val lastEvent: str = match lastStep {
    | Decided(d) => eventName(d.event)
    | NoDecision => ""
  }
  val lastEventTicket: int = match lastStep {
    | Decided(d) => eventTicket(d.event)
    | NoDecision => 0
  }
  val lastObligations: List[Obligation] = match lastStep {
    | Decided(d) => d.obligations
    | NoDecision => []
  }

  // --- init -----------------------------------------------------------------

  /// The fleet starts EMPTY: authoring is the ticket source now —
  /// the static nondet DAG is fully replaced by `release`, which grows
  /// the fleet one Pending at a time through the freshTicket seam (dependencies still
  /// acyclic by construction: they may only point at already-released,
  /// strictly smaller ids).
  /// The conjuncts are validity conditions on the instantiation: an
  /// instance that admits no well-formed evaluation plan, or no task set, or
  /// no ticket, has NO initial state rather than a degenerate one.
  action init = all {
    N_TASKS >= 1,        // well-formedness: a stage lists a real roster
    N_TICKETS >= 1,         // the release bound must admit at least one ticket
    MAX_STAGES >= 1,     // at least one authorable plan must exist
    tickets' = Map(),
    lastStep' = NoDecision,
    prevTickets' = Map()
  }

  // --- actions --------------------------------------------------------------

  /// A new ticket is released as Pending with a nondeterministic subset of
  /// dependable existing tickets and a well-formed evaluation plan. At
  /// most N_TICKETS releases ever happen, which is the only bound on how
  /// many tickets a run holds.
  action releaseTicket = all {
    releasableIds.size() > 0,
    nondet j = releasableIds.oneOf()
    nondet dependencies_ = dependableTickets.powerset().oneOf()
    nondet stages = validPlans.oneOf()
    apply(decideReleaseTicket(graph, releasedTicketOf(j, dependencies_, stages)))
  }

  /// Author revokes any non-terminal ticket, and that ticket alone
  /// (decideRevoke).
  action revoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    apply(decideRevoke(graph, j))
  }

  /// Ready -> Work: THE AGENTIC SELECTOR'S PICK. The
  /// nondet choice below IS the selector — an agentic component whose
  /// selection among Ready tickets is a real decision, not scheduler noise
  /// (see decideDispatch's header for the full agency note); the recorded
  /// TicketDispatched is its decision in the golden trace.
  /// Scheduling/quota below the pick stays trusted fabric (no bespoke
  /// scheduler) — no slot count, no queue order, no
  /// fairness.
  action dispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    nondet source = dispatchSources.oneOf()
    apply(decideDispatch(graph, j, source))
  }

  /// A task-completion is delivered for a task the ticket is currently
  /// running, and the report it carries is drawn: produced, judged either
  /// way, or reached no result. One action models all of it, and the
  /// DISPOSITION is drawn here too, because the completion that concludes a
  /// failing stage is where the policy is consulted (decideTaskDone).
  ///
  /// Duplicate-adversary SCOPE: this action draws from what is live, because
  /// a completion for anything else is refused by enablement before it is
  /// decided. What such a completion's event would do to the state is
  /// evolve's, and the suites build it from deliverableTasksIn — every
  /// identity the ticket's history names — and show it falls through.
  /// Identities are unique within the ticket and never reused, so an event
  /// about an earlier stage, generation or cycle names one nothing owes. A
  /// stale TICKET COMPLETION still implies a success occurred, and Done is
  /// absorbing. A sharper corner: a ticket revoked OUT of Finalization could
  /// race an in-flight merge in the real system — in-model
  /// revokedNeverCompletes holds structurally (a revoked ticket leaves
  /// finalizerTickets, so no wrap-up action can resolve it, and the revoke
  /// frees the slot by phase); the real revoke/merge race — the candidate
  /// already advancing when the revoke lands — is record-vs-effect
  /// atomicity, the §4 refinement layer.
  action taskDone = all {
    completableTickets.size() > 0,
    nondet j = completableTickets.oneOf()
    nondet task = liveTasks(tickets.get(j)).oneOf()
    nondet report = reportChoices(tickets.get(j), task).oneOf()
    nondet onFailure = dispositionChoices.oneOf()
    apply(decideTaskDone(graph, j, task, report, _ => onFailure))
  }

  /// The external finalizer returns one domain result and its evidence.
  /// Queueing, approval, permits and implementation are durable operational
  /// state.
  action finalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet out = finalizationOutcomes.oneOf()
    nondet evidence = finalizationEvidences.oneOf()
    all {
      finalizationOutcomeEnabled(graph, j, out),
      apply(decideFinalizationResult(graph, j, out, evidence))
    }
  }

  /// One resume action for every retryable park.
  action resumeTicket = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    apply(decideResumeTicket(graph, j))
  }

  /// The dead-end stutter (STUTTER set): keeps quiet states from
  /// deadlocking the simulator. It decides nothing, so the last decision
  /// and its ghost stand.
  action settle = all {
    quiet,
    tickets' = tickets,
    lastStep' = lastStep,
    prevTickets' = prevTickets
  }

  action step = any {
    releaseTicket,
    revoke,
    dispatch,
    taskDone,
    finalizationResult,
    resumeTicket,
    settle
  }

  // ==========================================================================
  // === Invariants ===========================================================
  // ==========================================================================
  // Inside the machine module (Quint 0.32: a separate module cannot see
  // instantiated vars), re-exposed to --main
  // scope through each mc instance's wildcard import.

  /// THE headline property: exactly one completion per cycle, proved at the
  /// completion boundary and nowhere else — any number of task executions
  /// may duplicate (at-least-once fabric), but a finalization success is
  /// applied exactly once per ticket, exactly when it is Done. "Per cycle"
  /// collapses to "per ticket" because a completion ends the ticket (Done is
  /// absorbing) and a failed finalization completes nothing. Per-ticket
  /// exclusivity is strictly stronger than any per-project form (exactly one
  /// completion per ticket implies at most one per ticket per project).
  val completionExclusive: bool = liveTickets.forall(j => and {
    tickets.get(j).completions <= 1,
    (tickets.get(j).completions == 1) iff (tickets.get(j).phase == Done)
  })

  /// REVOKED NEVER COMPLETES: a revoked ticket
  /// has applied no completion — and never will: Revoked is absorbing
  /// (terminalsAbsorbing), no event touches a revoked
  /// ticket's `completions`. Post-evaluation phases are deliberately not
  /// revocable. Stated as its own named invariant because it is the model's
  /// exclusivity half, though state-wise it is a corollary of
  /// completionExclusive (completions = 1 iff Done, completions <= 1,
  /// Revoked != Done ⇒ completions = 0) — same stated-corollary treatment as
  /// stuckSubsetCovered.
  val revokedNeverCompletes: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Revoked) implies (tickets.get(j).completions == 0))

  /// A COMPLETED TICKET PRODUCED SOMETHING (design 002). Deliberately the
  /// weak form: an artifact exists by the time a ticket is Done. The
  /// tempting stronger claim — that what was committed is what was
  /// evaluated — would be TRUE BY CONSTRUCTION, since the phase machine
  /// forbids work between a passed judgement and finalization, and an invariant that
  /// cannot fail is the stuckSubsetCovered defect written on purpose.
  /// A Revoked ticket may hold NoArtifact: it may never have run.
  val artifactWellFormed: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Done) implies
      (artifactOf(tickets.get(j)) != NoArtifact))

  /// The absorbing terminals never move OUT: a ticket the last decision
  /// found Done or Revoked is still in that phase.
  /// Both carry it here, because Revoked is reachable.
  val terminalsAbsorbing: bool = prevTickets.keys().forall(j =>
    Set(Done, Revoked).contains(prevTickets.get(j).phase) implies
      (tickets.keys().contains(j) and
        tickets.get(j).phase == prevTickets.get(j).phase))

  /// The human desk is consistent: a named wall iff parked. ONE
  /// equivalence: the resume point is derived (resumeOf, total on the sum),
  /// so a wall the desk can read is a way on the deciders will take, and
  /// there is no second field left to disagree with the first. (The open-task
  /// flag needs no conjunct either — it is DERIVED from the phase, standing
  /// rule 3.) Revoked passes at NoEscalation.
  val deskConsistent: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Escalated) iff
      (tickets.get(j).escalation != NoEscalation))

  /// EVERY INSTANCE IS WELL-FORMED by the protocol's own invariant, which is
  /// the whole of what an evaluation's state has to satisfy — chuggy
  /// re-states none of it. What chuggy adds is the AGREEMENT between an
  /// instance and the ticket carrying it: it judges THIS ticket, under the
  /// plan the ticket was released with (so no plan can drift from the
  /// authored data), for a work cycle the ticket has actually started, and
  /// the instances stand in the order those cycles ran — strictly
  /// ascending, so no cycle has two.
  ///
  /// THE PHASE SAYS WHICH INSTANCE IS OPEN: a ticket in Evaluation is
  /// running the last one, at the cycle it is on, and a ticket parked at the
  /// blocked wall has the last one blocked. Those two are what let
  /// currentInstance be read without a search, and what make the desk's wall
  /// and the instance's state one fact instead of two that can disagree.
  /// A ticket that left evaluation keeps the instance as it stood: it is
  /// provenance.
  val evaluationsWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    and {
      jb.evaluations.indices().forall(i =>
        val ev = jb.evaluations[i]
        and {
          invariant(ev),
          ev.input.ticket == j,
          ev.plan == jb.definition.evaluationPlan,
          ev.workCycle <= jb.workCyclesStarted,
          i == 0 or jb.evaluations[i - 1].workCycle < ev.workCycle
        }),
      (jb.phase == Evaluation) implies and {
        jb.evaluations.length() > 0,
        runningStageIndex(currentInstance(jb)) >= 0,
        currentInstance(jb).workCycle == jb.workCyclesStarted,
        currentInstance(jb).input.acceptedSourceRef == jb.source
      },
      (jb.escalation == EvaluationBlockedEscalated) implies and {
        jb.evaluations.length() > 0,
        instanceBlocked(currentInstance(jb))
      }
    })

  /// HISTORY IS APPEND-ONLY: against the tickets the last decision found
  /// (ghost prevTickets), every instance a ticket held is still there and
  /// still says what it said — with one exception, and exactly one: the LAST
  /// instance, while it is still the last, is the open one and advances.
  /// Once a newer instance sits behind it, it is frozen too. So a rewritten
  /// judgement, a dropped instance and a reordered history are each caught
  /// in the step that did it, and "the instances are the ticket's
  /// provenance" is a theorem rather than a convention. (Tickets are never
  /// deleted, so the ghost's domain always survives into liveTickets.)
  val evaluationsMonotone: bool = prevTickets.keys().forall(j =>
    val before = prevTickets.get(j).evaluations
    and {
      liveTickets.contains(j),
      tickets.get(j).evaluations.length() >= before.length(),
      before.indices().forall(i => or {
        tickets.get(j).evaluations[i] == before[i],
        and {
          i + 1 == before.length(),
          tickets.get(j).evaluations.length() == before.length()
        }
      })
    })

  /// IDENTITY ACCOUNTING: the mint counter is exactly what the ticket's own
  /// history says it must be — one slot per work cycle started, plus, for
  /// every run of every instance, its roster once per generation it reached
  /// (ticket.qnt evaluationSpawnTotal). Every spawn site bumps the counter
  /// from the AUTHORED plan while this sum reads the INSTANCES, so the
  /// two sides come from different places: a spawn that claimed the wrong
  /// stage's roster, a resume that claimed nothing, or a cycle counted twice
  /// breaks the equality in the very state that did it.
  ///
  /// It is a SLOT count, not a task count. A resume re-asks only the
  /// evaluators it reopened and still claims the roster, which is what keeps
  /// the counter derivable at all — the subset a resume asked is not
  /// recoverable from the run once those evaluators have answered. The
  /// slots nothing used are gaps, and a gap costs a monotone mint nothing.
  val idsAccounted: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    jb.spawned == jb.workCyclesStarted + evaluationSpawnTotal(jb))

  /// THE CONTRACT'S OWN PREDICATE over every task this machine is currently
  /// waiting on (task-contract/task.qnt taskIdentityValid). It is the one
  /// claim the contract makes about an identity, so the machine is held to
  /// it where the identities are owed rather than where they are read: a
  /// spawn that drew a cycle, stage, generation or evaluator from zero would
  /// be caught in the state that spawned it.
  val taskIdentitiesValid: bool = liveTickets.forall(j =>
    liveTasks(tickets.get(j)).forall(task => taskIdentityValid(task)))

  /// THE RELEASED DEFINITION IS WELL-FORMED, in every reachable state: the
  /// ticket is the one its definition names, and the definition satisfies
  /// the release's own rule (releasedTicketValid). Holding everywhere is
  /// what makes that rule a REFUSAL — a definition outside it is turned away
  /// at authoring time, and the definition is never rewritten, so no decider
  /// defends against an ill-formed one mid-flight.
  val definitionsWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    jb.definition.id == j and releasedTicketValid(jb.definition))

  /// THE SOURCE IS PINNED BY THE DISPATCH AND BY NOTHING ELSE: a ticket
  /// carries a source exactly once it has started a work cycle, which is
  /// exactly what a dispatch does. It goes red on a dispatch that filled no
  /// source, on a rework or resume that cleared one, and on a release that
  /// invented one before anything was observed.
  val sourcePinned: bool = liveTickets.forall(j =>
    (tickets.get(j).source > 0) iff (tickets.get(j).workCyclesStarted > 0))

  /// THE FINALIZATION GENERATION IS HELD WHERE AN ATTEMPT IS: positive
  /// while the ticket finalizes or is parked at the finalization wall, and 0
  /// while it has not reached one this cycle. It goes red on a pass that
  /// opened no attempt, on a resume that did not move it, and on a rework
  /// that carried the last cycle's into the next.
  val finalizationGenerationHeld: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    and {
      (jb.phase == Finalization or
        jb.escalation == FinalizationUnavailableEscalated) implies
        jb.finalizationGeneration > 0,
      Set(Pending, Work, Evaluation).contains(jb.phase) implies
        jb.finalizationGeneration == 0
    })

  /// EVERY DECISION IS VALID where it was taken (decisionValid): its
  /// obligations are well-formed, owed once, and agree with the state its
  /// event evolved the one it found into.
  val decisionsValid: bool = match lastStep {
    | Decided(d) => decisionValid(prevGraph, d)
    | NoDecision => true
  }

  /// A DECIDED EVENT IS NEVER THE IDENTITY: the event the machine decides at
  /// a state moves that state. It is what lets a replay hold a journal row
  /// to "the event moved the state" (refinement.qnt journalLegalOn) and
  /// accept exactly the events the machine could have decided there.
  val eventsNeverIdentity: bool = match lastStep {
    | Decided(d) => evolve(prevGraph, d.event) != prevGraph
    | NoDecision => true
  }

  def dependencyClosure(j: int): Set[int] =
    range(1, N_TICKETS + 1).foldl(waitsOn(graph, j), (seen, _) =>
      seen.union(seen.map(d => waitsOn(graph, d)).flatten()))

  val depsAcyclic: bool = liveTickets.forall(j => and {
    waitsOn(graph, j).subseteq(liveTickets),
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
  def visEdges(j: int): Set[int] = waitsOn(graph, j)

  /// Tickets that cannot move without a human: parked on the desk, or
  /// Pending behind a dependency chain containing a parked ticket. A
  /// healthy-Blocked ticket is deliberately NOT stuck — it sits flat while
  /// its dependencies run, and progresses VICARIOUSLY.
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
  ///  note: Revoked contributes NOTHING here (hasOpenHumanTask excludes
  /// it), and neither does a Pending — its progress is its author's, the
  /// named AUTHORING conditionality. So a ticket left Pending behind a
  /// revoked dep is neither walked here nor walked by stuckSet, and what
  /// moves it is the author who released it.
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
  /// covₖ₊₁. No step of that argument mentions the machine's steps:
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
  /// The half no state predicate can carry — unbounded WAITING — is
  /// accepted by name under bounds-work-not-waiting.
  val stuckSubsetCovered: bool = stuckSet.subseteq(coveredSet)

  /// THE ANTI-VACUITY WITNESS, not an invariant of the machine: "no
  /// eval stage ever advances". EXPECTED TO BE VIOLATED (the model gate
  /// shows it deterministically by the stage-advance machine trace in
  /// tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
  /// — a reachable stage advance (an evaluation that progressed AND owes a
  /// new stage's evaluators) is the machine-level proof that multi-stage
  /// plans actually run stage-by-stage on machine traces, so the green
  /// invariant runs above are checked against traces where the stage
  /// advance edge is exercised, not vacuous (a
  /// fleet that only ever drew single-stage plans would never take the
  /// edge). The unit tests walk the advance deterministically; this pins
  /// it as REACHABLE.
  val stageAdvanceNever: bool =
    not(lastEvent == "TicketEvaluationProgressed" and lastObligations.length() > 0)

  /// All safety invariants, for `--invariant=allInvariants`.
  val allInvariants: bool = and {
    completionExclusive,
    revokedNeverCompletes,
    artifactWellFormed,
    terminalsAbsorbing,
    deskConsistent,
    evaluationsWellFormed,
    evaluationsMonotone,
    idsAccounted,
    taskIdentitiesValid,
    definitionsWellFormed,
    sourcePinned,
    finalizationGenerationHeld,
    decisionsValid,
    eventsNeverIdentity,
    depsAcyclic,
    ticketIdsWellFormed,
    stuckSubsetCovered
  }
}
