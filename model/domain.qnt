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
/// ticket leaves the state by that report — including when the report is that
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
/// states, so no unblock cascade exists to get wrong. Lease occupancy is a
/// predicate over state, so nothing cleans up. The open-desk-task flag, the
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
/// THE DECIDERS AND EVOLVE ARE THE PACKAGE'S, imported from its vendored
/// `ticket-domain/ticket.qnt` (model/AGENTS.md). What this file adds is the
/// ledger's fold beside `evolve`, this instance's bounds, the draws, the
/// machine and its invariants.
///
/// This header describes the machine; it does not narrate how the machine
/// came to be.
module chuggy_domain {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "./ticket-domain/ticket"
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

  /// The disposition a command that concludes no stage is taken under.
  /// `decide` never asks it, so which one it is decides nothing.
  pure val unaskedDisposition: EvaluationFailureDisposition =
    ReworkEvaluationFailure

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

  /// WHAT A FINALIZER MAY REPORT: any of the three results, at any evidence
  /// it may return. Queueing, preparation, approval, permits and
  /// reconciliation are durable operational records the machine never
  /// learns, and which conditions a finalizer calls unreachable is the same
  /// kind of detail: the machine draws the result, never the cause.
  pure val finalizationResults: Set[FinalizationResult] =
    finalizationEvidences.map(evidence => FinalizationSucceeded(evidence))
      .union(finalizationEvidences.map(evidence =>
        FinalizationNeedsWork(evidence)))
      .union(finalizationEvidences.map(evidence =>
        FinalizationResultUnavailable(evidence)))

  /// WHAT A TASK CAN COME BACK WITH, as the environment may produce it: a
  /// work task produced its artifact at a source the application accepted,
  /// or reached no result at all; an evaluator judged either way or reached
  /// no result. A produced report carries the obligation the ticket owes for
  /// the task (ticket.qnt producedResult), which is the only obligation the
  /// completion accepts; callers draw the task from liveTasks.
  pure def reportChoices(
      jb: Ticket, task: TaskIdentity): Set[TaskTerminalReport] =
    val j = jb.definition.id
    val failures = Set(ProcessFailure, ExecutionUnavailableFailure)
      .map(kind => TerminalFailureReport({ ticket: j,
        failure: { task: task, evidence: taskRefOf(task) }, kind: kind }))
    match task {
      | WorkTask(_) => failures.union(acceptedSources.map(accepted =>
          WorkResultReport({ ticket: j, result: producedResult(jb, task),
            acceptedSourceRef: accepted })))
      | EvaluationTask(_) => failures.union(
          Set(EvaluatorPass, EvaluatorFail).map(verdict =>
            EvaluationResultReport({ ticket: j,
              result: producedResult(jb, task), verdict: verdict })))
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

  /// The band each revision's references are shifted by, so a number read
  /// off a golden says which revision of which ticket it pinned.
  pure val revisionBand: int = 1000

  /// THE REFERENCES AN UPDATE TO REVISION r PINS: the release's, shifted
  /// into revision r's band, so every revision of a ticket carries a
  /// definition distinct from every other's.
  pure def revisionRef(j: int, revision: int, slot: int): int =
    releaseRef(j, slot) + revisionBand * (revision - 1)

  /// THE DEFINITION REVISION r OF TICKET j CARRIES, over the dependencies
  /// and the plan the author drew. The id is the definition's own: a release
  /// names the ticket inside the record it releases, so the graph's key and
  /// the definition cannot disagree (definitionsWellFormed).
  pure def revisedTicketOf(
      j: int, revision: int, dependencies_: Set[int],
      stages: List[StageDefinition]): ReleasedTicket = {
    id: j,
    content: revisionRef(j, revision, 1),
    dependencies: dependencies_,
    workConfiguration: {
      workload: revisionRef(j, revision, 2),
      inputs: revisionRef(j, revision, 3),
      executionRequirements: revisionRef(j, revision, 4),
      resultContract: revisionRef(j, revision, 5)
    },
    evaluationPlan: { stages: stages },
    finalizationConfiguration: revisionRef(j, revision, 6)
  }

  /// THE DEFINITION A RELEASE OF TICKET j CARRIES: its first revision.
  pure def releasedTicketOf(
      j: int, dependencies_: Set[int],
      stages: List[StageDefinition]): ReleasedTicket =
    revisedTicketOf(j, 1, dependencies_, stages)

  /// THE BOUNDS THIS INSTANCE IS CHECKED UNDER, beside the package's
  /// releasedTicketValid (ticket.qnt): at most MAX_STAGES stages, each keyed
  /// by its own POSITION, and every evaluator key inside 1..N_TASKS.
  ///
  /// The positional stage key is CHUGGY'S rule and not the contract's, which
  /// asks only that stage keys be distinct: a layer holding an identity but
  /// no plan reads the index back out of the key. Evaluator keys are NOT
  /// positional.
  ///
  /// With the package's rule it is the release's shape rule — a definition
  /// outside either is not a command the machine takes (commandBounded
  /// below), which is what makes definitionsWellFormed hold in every
  /// reachable state.
  pure def releasedTicketBounded(definition: ReleasedTicket): bool = and {
    definition.evaluationPlan.stages.length() <= MAX_STAGES,
    definition.evaluationPlan.stages.indices().forall(i =>
      val stage = definition.evaluationPlan.stages[i]
      and {
        stage.key == i + 1,
        evaluatorKeys(stage).forall(k => k >= 1 and k <= N_TASKS)
      })
  }

  /// A COMMAND IS INSIDE THIS INSTANCE'S BOUNDS: every definition it carries
  /// is. Beside the package's commandValid it is the machine's SHAPE guard
  /// and not a refusal: it reads no ticket, a command outside it is not one
  /// the machine takes at all, and every command the machine draws is inside
  /// it by construction.
  pure def commandBounded(command: TicketCommand): bool = match command {
    | CreateTicket(definition) => releasedTicketBounded(definition)
    | UpdateTicket(update) => releasedTicketBounded(update.definition)
    | _ => true
  }

  /// A COMMAND THE MACHINE TAKES: the package's shape rule and this
  /// instance's bounds.
  pure def commandTaken(command: TicketCommand): bool =
    commandValid(command) and commandBounded(command)

  // decide(graph, command, policy) -> a refusal, or { event, obligations };
  // never an effect. evolve(graph, event) is the only thing that moves a
  // graph. Both are the package's, imported above. The package's
  // decisionValid includes graphInvariant(evolved), so every decision this
  // machine takes is held to the package's ticket and graph invariants on the
  // state it lands in.

  // ==========================================================================
  // === Events by name =======================================================
  // ==========================================================================

  /// THE TICKET AN EVENT IS ABOUT, whichever arm it is.
  pure def eventTicket(fact: TicketEvent): int = match fact {
    | TicketCreated(definition) => definition.id
    | TicketUpdated(update) => update.ticket
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
    | TicketUpdated(_) => "TicketUpdated"
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

  /// THE REFUSAL'S NAME, for the golden aims (lastRefusal) and the suites.
  pure def refusalName(reason: TicketRefusal): str = match reason {
    | TicketAlreadyExists(_) => "TicketAlreadyExists"
    | DependenciesNotFound(_) => "DependenciesNotFound"
    | SelfDependency(_) => "SelfDependency"
    | TicketNotFound(_) => "TicketNotFound"
    | TicketNotPending(_) => "TicketNotPending"
    | TicketIdentityMismatch(_) => "TicketIdentityMismatch"
    | TicketRevisionStale(_) => "TicketRevisionStale"
    | TicketDependenciesChanged(_) => "TicketDependenciesChanged"
    | DependenciesIncomplete(_) => "DependenciesIncomplete"
    | TicketNotRevocable(_) => "TicketNotRevocable"
    | TicketNotResumable(_) => "TicketNotResumable"
    | TaskNotCurrent(_) => "TaskNotCurrent"
    | FinalizationNotCurrent(_) => "FinalizationNotCurrent"
  }

  // ==========================================================================
  // === The ledger's fold ====================================================
  // ==========================================================================

  /// ONE TICKET UNDER ONE EVENT, as the package's evolve moves it. The
  /// ledger reads the ticket after an event through this and nothing else,
  /// so it restates none of evolve's guards: an event evolve leaves a ticket
  /// alone under moves its ledger nowhere either.
  pure def ticketAfter(before: Ticket, fact: TicketEvent): Ticket =
    evolve({ tickets: Map(before.definition.id -> before) }, fact)
      .tickets.get(before.definition.id)

  /// THE RUN A STATE IS ASKING, as its stage index and generation: the one
  /// running, and none in every other state.
  pure def runningRun(
      state: TicketState): List[{ stage: int, generation: int }] =
    match state {
      | Evaluation(evaluation) => match evaluation.state {
          | Running(progress) => [{ stage: progress.stage.stageIndex,
              generation: progress.stage.generation }]
          | _ => []
        }
      | _ => []
    }

  /// THE SLOTS A STEP CLAIMS: one for a work cycle it started, and the
  /// released roster of a run it started asking — an accepted result's first
  /// stage, a passed stage's successor, a blocked stage's next generation.
  /// The roster rather than the subset asked, which keeps the count
  /// derivable from the instance (idsAccounted); the slots a resume leaves
  /// unused are gaps, and a gap costs a monotone mint nothing.
  pure def slotsClaimed(before: Ticket, after: Ticket): int =
    val asked = runningRun(after.state)
    (if (after.workCyclesStarted > before.workCyclesStarted) 1 else 0)
      + (if (asked == [] or asked == runningRun(before.state)) 0
        else after.definition.evaluationPlan.stages[asked[0].stage]
          .evaluators.length())

  /// THE INSTANCE A STEP CLOSES: the one the ticket held before and holds no
  /// longer, as the event left it — a pass or a failure applies its report
  /// first, and a revoke closes it as it stood.
  pure def closedBy(
      before: Ticket, after: Ticket,
      fact: TicketEvent): List[EvaluationInstance] =
    if (heldInstances(after.state) != []) []
    else heldInstances(before.state).foldl([], (closed, held) =>
      closed.append(match fact {
        | TicketEvaluationPassed(progress) =>
          applyEvaluationReport(held, progress.report)
        | TicketEvaluationReworkStarted(rework) =>
          applyEvaluationReport(held, rework.report)
        | TicketEvaluationFailureEscalated(failure) =>
          applyEvaluationReport(held, failure.report)
        | _ => held
      }))

  /// THE LEDGER AFTER AN EVENT, from the ticket before it, the event and the
  /// ledger before it (ticket.qnt TicketLedger). A closed instance is
  /// appended, the mint counter claims the step's slots, and the ghost counts
  /// a ticket's arrival at Done.
  pure def ledgerStep(
      before: Ticket, fact: TicketEvent,
      ledger: TicketLedger): TicketLedger =
    val after = ticketAfter(before, fact)
    { closedEvaluations:
        ledger.closedEvaluations.concat(closedBy(before, after, fact)),
      spawned: ledger.spawned + slotsClaimed(before, after),
      completions: ledger.completions +
        (if (after.state == Done and before.state != Done) 1 else 0) }

  /// EVERY TICKET'S LEDGER AFTER AN EVENT: a release opens an empty one, and
  /// any other event folds the ledger of the ticket it names.
  pure def evolveLedgers(
      c: TicketGraph, ledgers_: int -> TicketLedger,
      fact: TicketEvent): int -> TicketLedger =
    match fact {
      | TicketCreated(definition) =>
        if (c.tickets.keys().contains(definition.id)) ledgers_
        else ledgers_.put(definition.id, emptyLedger)
      | _ =>
        val j = eventTicket(fact)
        if (not(c.tickets.keys().contains(j))) ledgers_
        else ledgers_.set(j,
          ledgerStep(c.tickets.get(j), fact, ledgers_.get(j)))
    }

  // ==========================================================================
  // === Pure predicates the draws share ======================================
  // ==========================================================================

  pure def revocableIn(c: TicketGraph, j: int): bool =
    revocationAllowed(c.tickets.get(j).state)

  /// May the operator retry this ticket's open human action? Exactly while
  /// the desk holds a task for it — every resume is free, and every wall
  /// resumes somewhere (resumeOf is total).
  pure def retryableIn(c: TicketGraph, j: int): bool =
    hasOpenHumanTask(c.tickets.get(j))

  /// WHAT A TICKET WAITS ON before it may run — the single definition, read
  /// by the walks and the cross-ticket artifact read alike.
  pure def waitsOn(c: TicketGraph, j: int): Set[int] =
    c.tickets.get(j).definition.dependencies

  /// WHAT THIS TICKET'S DEPENDENCIES PRODUCED (design 002). Derived, never
  /// stored, and stable: every dep is Done before a dependent can dispatch,
  /// and Done is absorbing.
  pure def depArtifacts(
      c: TicketGraph, ledgers_: int -> TicketLedger,
      j: int): Set[ArtifactMark] =
    waitsOn(c, j).map(d => artifactOf(c.tickets.get(d), ledgers_.get(d)))

  pure def depsDoneIn(c: TicketGraph, j: int): bool =
    dependenciesComplete(c, c.tickets.get(j))

  // --- The draw sets, over a TicketGraph: which commands the environment
  // sends. `decide` is what accepts or refuses one; these say only where the
  // machine's actions, the refinement's actors and the witness drivers draw
  // from. The release room is the one bound among them that `decide` does
  // not refuse over: it is this instance's N_TICKETS, not the package's, and
  // an implementation's boundary refuses a release outside it before
  // `decide` is asked.

  /// Room for one more release (the N_TICKETS release bound).
  pure def canReleaseIn(c: TicketGraph, j: int): bool = and {
    c.tickets.keys().size() < N_TICKETS,
    ticketIdUniverse.contains(j),
    not(c.tickets.keys().contains(j))
  }

  /// Tickets a release draws its dependencies from: anything but a tombstone.
  /// decideCreate refuses no dependency that exists, but a Revoked ticket
  /// never becomes Done, so the author the machine models never writes a
  /// ticket that can never run.
  pure def dependableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(k => c.tickets.get(k).state != Revoked)

  /// Tickets an update may be drawn for: the Pending ones (decideUpdate).
  pure def revisablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => isPending(c.tickets.get(j).state))

  /// THE UPDATE AN AUTHOR SENDS for a ticket: its next revision, written
  /// against the revision it holds, keeping its dependencies, over the plan
  /// the author drew.
  pure def updateOf(jb: Ticket, stages: List[StageDefinition]): TicketCommand =
    val j = jb.definition.id
    UpdateTicket({ ticket: j, expectedRevision: jb.revision,
      definition: revisedTicketOf(j, jb.revision + 1,
        jb.definition.dependencies, stages) })

  /// Every non-terminal short of Finalization may be revoked.
  pure def revocablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => revocableIn(c, j))

  /// The derived Ready room (the package's isReady per ticket).
  pure def readiesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => isReady(c, j))

  /// Tickets the fabric is currently running a task for, which is who a
  /// completion can be delivered to.
  pure def completableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => liveTasks(c.tickets.get(j)) != Set())

  pure def doneIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).state == Done)

  /// Parked tickets the operator may Retry (retryableIn per ticket).
  pure def retryablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => retryableIn(c, j))

  /// The derived waiting room (standing rule 3), as a pure predicate over a
  /// TicketGraph so tests can pin it: a Pending ticket with any dependency
  /// not yet Done. Its Ready half is the package's isReady.
  pure def isBlockedIn(c: TicketGraph, j: int): bool =
    isPending(c.tickets.get(j).state) and not(depsDoneIn(c, j))

  /// THE GENERATION OF THE FINALIZATION ATTEMPT A TICKET IS ON: the one it
  /// runs, or the one its wall stopped; 0 in every other state.
  pure def attemptGeneration(ticket: Ticket): int = match ticket.state {
    | Finalization(finalization) => finalization.generation
    | Escalated(escalation) => match escalation {
        | FinalizationUnavailableEscalated(failure) =>
          failure.finalization.generation
        | _ => 0
      }
    | _ => 0
  }

  /// Every task identity ticket j has ever been owed: one work task per
  /// cycle it has started, and every evaluator of every run its instances
  /// hold, at the generation those runs now stand at. DERIVED — the ticket
  /// keeps no task log — and a superset of the live set, which is the point:
  /// the suites build an event about a SETTLED task from here to show it is
  /// refused.
  pure def deliverableTasksIn(
      c: TicketGraph, ledgers_: int -> TicketLedger,
      j: int): Set[TaskIdentity] =
    val jb = c.tickets.get(j)
    range(1, jb.workCyclesStarted + 1)
      .foldl(Set(), (found, cycle) =>
        found.union(Set(workTaskIdentity(j, cycle))))
      .union(ledgerInstances(jb, ledgers_.get(j)).foldl(Set(),
        (found, evaluation) => found.union(instanceTasks(evaluation))))

  // ==========================================================================
  // === Refusals the environment may send ====================================
  // ==========================================================================

  /// A failure report for a task of ticket j, at the evidence the suites
  /// derive for it.
  pure def failureReportOf(j: int, task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ ticket: j,
      failure: { task: task, evidence: taskRefOf(task) },
      kind: ProcessFailure })

  /// A success report for ticket j's finalization attempt (cycle, gen).
  pure def finalizationReportOf(
      j: int, cycle: int, gen: int): TicketCommand =
    ReportFinalizationResult({ ticket: j, workCycle: cycle, generation: gen,
      result: FinalizationSucceeded(aFinalizationEvidence) })

  /// An id the instance can name that is not j: the universe holds 1 and 2
  /// whenever it holds a ticket at all (init's N_TICKETS >= 1).
  pure def otherIdOf(j: int): int = if (j == 1) 2 else 1

  /// THE UPDATES AN ENVIRONMENT MAY SEND OUT OF TURN for ticket j: one at a
  /// revision the ticket is not at (the one before it where there is one),
  /// one whose definition names another ticket, and one that changes the
  /// dependencies — each wrong in that one way only, so a Pending ticket
  /// refuses each for its own reason — and, for an id not released, the
  /// first revision.
  pure def updateProbesIn(c: TicketGraph, j: int): Set[TicketCommand] =
    if (not(c.tickets.keys().contains(j)))
      Set(UpdateTicket({ ticket: j, expectedRevision: 1,
        definition: releasedTicketOf(j, Set(), defaultPlan) }))
    else {
      val jb = c.tickets.get(j)
      val dependencies_ = jb.definition.dependencies
      val nextRevision = jb.revision + 1
      val stale = if (jb.revision > 1) jb.revision - 1 else nextRevision
      Set(
        UpdateTicket({ ticket: j, expectedRevision: stale,
          definition: revisedTicketOf(j, nextRevision, dependencies_, defaultPlan) }),
        UpdateTicket({ ticket: j, expectedRevision: jb.revision,
          definition: revisedTicketOf(otherIdOf(j), nextRevision, dependencies_,
            defaultPlan) }),
        UpdateTicket({ ticket: j, expectedRevision: jb.revision,
          definition: revisedTicketOf(j, nextRevision,
            if (dependencies_ == Set()) Set(otherIdOf(j)) else Set(),
            defaultPlan) }))
    }

  /// THE COMMANDS AN ENVIRONMENT MAY SEND OUT OF TURN, over a TicketGraph
  /// and its ledgers: for every id the instance can name, a create that
  /// collides, names itself or names what does not exist, the updates
  /// updateProbesIn names, and a dispatch, a revoke and a resume; a failure
  /// for every task a ticket has ever been owed, and for the first work task
  /// of an id not released; and a finalizer's result for the attempt a
  /// ticket is on, the generation before it and the cycle before it. Every
  /// one is a command the machine takes (commandTaken), so which of them
  /// `decide` refuses is the ticket's state and nothing else.
  pure def commandProbesIn(
      c: TicketGraph, ledgers_: int -> TicketLedger): Set[TicketCommand] =
    val live = c.tickets.keys()
    val absent = ticketIdUniverse.exclude(live)
    val perId = ticketIdUniverse.map(j => Set(
      CreateTicket(releasedTicketOf(j, Set(), defaultPlan)),
      CreateTicket(releasedTicketOf(j, Set(j), defaultPlan)),
      CreateTicket(releasedTicketOf(j, absent.exclude(Set(j)), defaultPlan)),
      DispatchTicket({ ticket: j, source: aDispatchSource }),
      RevokeTicket(j),
      ResumeTicket(j)).union(updateProbesIn(c, j))).flatten()
    val reports = live.map(j => deliverableTasksIn(c, ledgers_, j).map(task =>
        ReportTaskTerminal(failureReportOf(j, task)))).flatten()
      .union(absent.map(j =>
        ReportTaskTerminal(failureReportOf(j, workTaskIdentity(j, 1)))))
    val finalizations = live.map(j => {
        val jb = c.tickets.get(j)
        val cycle = if (jb.workCyclesStarted > 1) jb.workCyclesStarted else 1
        val gen =
          if (attemptGeneration(jb) > 1) attemptGeneration(jb) else 1
        Set(finalizationReportOf(j, cycle, gen))
          .union(if (gen > 1) Set(finalizationReportOf(j, cycle, gen - 1))
            else Set())
          .union(if (cycle > 1) Set(finalizationReportOf(j, cycle - 1, gen))
            else Set())
      }).flatten()
      .union(absent.map(j => finalizationReportOf(j, 1, 1)))
    perId.union(reports).union(finalizations)

  /// The probes `decide` refuses in this graph. No refusal asks the policy,
  /// so any one will do.
  pure def refusedCommandsIn(
      c: TicketGraph, ledgers_: int -> TicketLedger): Set[TicketCommand] =
    commandProbesIn(c, ledgers_).filter(command =>
      match decide(c, command, _ => unaskedDisposition) {
        | TicketRefused(_) => true
        | TicketDecided(_) => false
      })

  // ==========================================================================
  // === State + actions ======================================================
  // ==========================================================================

  var tickets: int -> Ticket
  /// Each ticket's ledger (ticket.qnt TicketLedger), beside the graph and
  /// folded from the same events.
  var ledgers: int -> TicketLedger
  /// The last decision — the golden-trace-shaped observation (standing rule
  /// 4: the model emits golden traces from day one).
  var lastStep: LastDecision
  /// GHOSTS: the tickets and their ledgers as the last decision found them —
  /// written by every decision, read only by the invariants that need one
  /// step of history.
  var prevTickets: int -> Ticket
  var prevLedgers: int -> TicketLedger

  val graph: TicketGraph = { tickets: tickets }
  val prevGraph: TicketGraph = { tickets: prevTickets }

  /// Released ticket identities. Ordering has no semantic meaning.
  val liveTickets: Set[int] = tickets.keys()

  /// THE MACHINE'S STEP: decide, then evolve, and the ledgers folded from
  /// the same event. An accepted command's state is what its event evolves
  /// the graph to; a refused one leaves the graph and the ledgers as they
  /// were and records only its refusal, which is what the runtime does with
  /// it — answers it, and journals nothing. Either way the decision is what
  /// the trace records. A command outside commandTaken is not one the
  /// machine takes at all.
  action take(
      command: TicketCommand, onFailure: EvaluationFailureDisposition): bool =
    all {
      commandTaken(command),
      match decide(graph, command, _ => onFailure) {
        | TicketDecided(d) => all {
          tickets' = evolve(graph, d.event).tickets,
          ledgers' = evolveLedgers(graph, ledgers, d.event),
          lastStep' = Decided(d),
          prevTickets' = tickets,
          prevLedgers' = ledgers
        }
        | TicketRefused(reason) => all {
          tickets' = tickets,
          ledgers' = ledgers,
          lastStep' = Refused(reason),
          prevTickets' = tickets,
          prevLedgers' = ledgers
        }
      }
    }

  /// REFINEMENT-LAYER SEAM (the state-shaped counterpart of the
  /// TicketGraph-parameterized draw sets above): install an externally
  /// reconstructed graph and its ledgers WITHOUT taking a domain step. The
  /// refinement module's executor/crash actions (refinement.qnt emitNext /
  /// crashRecover / effectCrash) are NOT domain steps — the domain trace
  /// has no row for them — so the step-history ghosts stay STALE (they
  /// keep describing the last real decision, which keeps every
  /// lastStep/ghost invariant's verdict byte-identical across the
  /// refinement-layer step). NOT in `step`'s any{} roster: only the
  /// refinement layer calls it, and only with a replay of its own journal
  /// (under the journal-then-effect discipline that replay equals the live
  /// state — refinement.qnt recoveryComplete — so the domain vars do not
  /// move). Exported as an action rather than left to the refinement module
  /// because Quint 0.32's instance flattening rejects a primed assignment
  /// of an instance's var from the importing module's own expressions
  /// ("Variable not set" at evaluation) — the assignment must live in the
  /// module that declares the var, exactly like the invariants.
  action installGraph(
      c: TicketGraph, ledgers_: int -> TicketLedger): bool = all {
    tickets' = c.tickets,
    ledgers' = ledgers_,
    lastStep' = lastStep,
    prevTickets' = prevTickets,
    prevLedgers' = prevLedgers
  }

  // --- Derived waiting room (standing rule 3: derive, don't store) ---------
  // Blocked and Ready are PREDICATES over dependencies, not states. Storing
  // them is what forces an unblock cascade; chuggy stores only Pending and
  // derives the split, so there is no Blocked->Ready edge to model or to get
  // wrong.

  def isBlocked(j: int): bool = isBlockedIn(graph, j)

  // --- Draw sets ------------------------------------------------------------

  // Each draw set below REFERENCES its pure TicketGraph form: one
  // definition, drawn from by the machine's actions, the witness drivers, and
  // the refinement's actors alike.

  /// Room for one more release (the N_TICKETS release bound).
  val releasableIds: Set[int] = ticketIdUniverse.filter(j => canReleaseIn(graph, j))
  /// Tickets a new release may depend on: no tombstones (dependableIn).
  val dependableTickets: Set[int] = dependableIn(graph)
  /// Tickets an update may be drawn for (revisablesIn).
  val revisableTickets: Set[int] = revisablesIn(graph)
  /// Every non-terminal short of Finalization may be revoked.
  val revocableTickets: Set[int] = revocablesIn(graph)
  val readyTickets: Set[int] = readiesIn(graph)
  /// Tickets a completion can be delivered to.
  val completableTickets: Set[int] = completableIn(graph)
  val finalizerTickets: Set[int] = liveTickets.filter(j =>
    match tickets.get(j).state {
      | Finalization(_) => true
      | _ => false
    })
  val doneTickets: Set[int] = doneIn(graph)
  /// Parked tickets the operator may Retry (retryableIn).
  val retryableEscalated: Set[int] = retryablesIn(graph)
  /// Commands `decide` refuses here (refusedCommandsIn).
  val refusedCommands: Set[TicketCommand] = refusedCommandsIn(graph, ledgers)

  /// No machine, operator, or author action can move anything. Revoke is
  /// drawn for EVERY non-terminal short of Finalization, so a Pending chain
  /// stranded behind a revoked dep is still actionable by its author — the
  /// only true dead end is a fully-released fleet in which every ticket is
  /// settled in a terminal (Done or Revoked). The `settle` stutter covers
  /// exactly that state so runs never deadlock.
  val quiet: bool = and {
    releasableIds.size() == 0,
    liveTickets.forall(j => isTerminal(tickets.get(j).state))
  }

  /// THE LAST EVENT'S NAME, ITS TICKET AND ITS OBLIGATIONS, and the last
  /// refusal's name — what the golden aims (test/golden/manifest.json) read,
  /// and nothing else. Empty where the last step was not of that kind.
  val lastEvent: str = match lastStep {
    | Decided(d) => eventName(d.event)
    | _ => ""
  }
  val lastEventTicket: int = match lastStep {
    | Decided(d) => eventTicket(d.event)
    | _ => 0
  }
  val lastObligations: List[Obligation] = match lastStep {
    | Decided(d) => d.obligations
    | _ => []
  }
  val lastRefusal: str = match lastStep {
    | Refused(reason) => refusalName(reason)
    | _ => ""
  }

  // --- init -----------------------------------------------------------------

  /// The fleet starts EMPTY: authoring is the ticket source, and `release`
  /// grows the fleet one Pending at a time (dependencies acyclic by
  /// construction: they may only point at already-released tickets).
  /// The conjuncts are validity conditions on the instantiation: an
  /// instance that admits no well-formed evaluation plan, or no task set, or
  /// no ticket, has NO initial state rather than a degenerate one.
  action init = all {
    N_TASKS >= 1,        // well-formedness: a stage lists a real roster
    N_TICKETS >= 1,         // the release bound must admit at least one ticket
    MAX_STAGES >= 1,     // at least one authorable plan must exist
    tickets' = Map(),
    ledgers' = Map(),
    lastStep' = NoDecision,
    prevTickets' = Map(),
    prevLedgers' = Map()
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
    take(CreateTicket(releasedTicketOf(j, dependencies_, stages)),
      unaskedDisposition)
  }

  /// The author replaces a Pending ticket's definition with its next
  /// revision, over any well-formed plan (decideUpdate).
  action updateDefinition = all {
    revisableTickets.size() > 0,
    nondet j = revisableTickets.oneOf()
    nondet stages = validPlans.oneOf()
    take(updateOf(tickets.get(j), stages), unaskedDisposition)
  }

  /// Author revokes any non-terminal ticket, and that ticket alone
  /// (decideRevoke).
  action revoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    take(RevokeTicket(j), unaskedDisposition)
  }

  /// Ready -> Work: THE AGENTIC SELECTOR'S PICK. The nondet choice below IS
  /// the selector — an agentic component whose selection among Ready
  /// tickets is a real decision, not scheduler noise, so any policy
  /// (LLM-driven, priority, whatever) refines unrestricted choice among
  /// Ready tickets — and the recorded TicketDispatched is its decision in the
  /// golden trace. The source it observes is drawn beside it. Scheduling and
  /// quota below the pick stay trusted fabric — no slot count, no queue
  /// order, no fairness.
  action dispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    nondet source = dispatchSources.oneOf()
    take(DispatchTicket({ ticket: j, source: source }),
      unaskedDisposition)
  }

  /// A task-completion is delivered for a task the ticket is currently
  /// running, and the report it carries is drawn: produced, judged either
  /// way, or reached no result. One action models all of it, and the
  /// DISPOSITION is drawn here too, because the completion that concludes a
  /// failing stage is where the policy is consulted (decideTaskTerminal).
  ///
  /// Duplicate-adversary SCOPE: this action draws from what is live; a
  /// completion for anything else is one `decide` refuses, and `refuse`
  /// sends it. Identities are unique within the ticket and never reused, so
  /// a report about an earlier stage, generation or cycle names one nothing
  /// owes. A ticket revoked OUT of Finalization could race an in-flight
  /// merge in the real system; in-model revokedNeverCompletes holds
  /// structurally (Finalization is not revocable), and the real race is
  /// record-vs-effect atomicity, the refinement layer's.
  action taskDone = all {
    completableTickets.size() > 0,
    nondet j = completableTickets.oneOf()
    nondet task = liveTasks(tickets.get(j)).oneOf()
    nondet report = reportChoices(tickets.get(j), task).oneOf()
    nondet onFailure = dispositionChoices.oneOf()
    take(ReportTaskTerminal(report), onFailure)
  }

  /// The external finalizer returns one domain result, with its evidence,
  /// for the attempt the ticket is on. Queueing, approval, permits and
  /// implementation are durable operational state.
  action finalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet result = finalizationResults.oneOf()
    take(ReportFinalizationResult({ ticket: j,
        workCycle: tickets.get(j).workCyclesStarted,
        generation: attemptGeneration(tickets.get(j)),
        result: result }),
      unaskedDisposition)
  }

  /// One resume action for every retryable park.
  action resumeTicket = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    take(ResumeTicket(j), unaskedDisposition)
  }

  /// THE ENVIRONMENT OUT OF TURN: a command `decide` refuses, drawn from the
  /// probes (commandProbesIn). The machine answers it and moves nothing, so
  /// the step records the refusal and the tickets stand.
  action refuse = all {
    refusedCommands.size() > 0,
    nondet command = refusedCommands.oneOf()
    take(command, unaskedDisposition)
  }

  /// The dead-end stutter (STUTTER set): keeps quiet states from
  /// deadlocking the simulator. It decides nothing, so the last decision
  /// and its ghosts stand.
  action settle = all {
    quiet,
    tickets' = tickets,
    ledgers' = ledgers,
    lastStep' = lastStep,
    prevTickets' = prevTickets,
    prevLedgers' = prevLedgers
  }

  action step = any {
    releaseTicket,
    updateDefinition,
    revoke,
    dispatch,
    taskDone,
    finalizationResult,
    resumeTicket,
    refuse,
    settle
  }

  // ==========================================================================
  // === Invariants ===========================================================
  // ==========================================================================
  // Inside the machine module (Quint 0.32: a separate module cannot see
  // instantiated vars), re-exposed to --main scope through each mc
  // instance's wildcard import.
  //
  // What the ticket's own state carries is the package's to hold
  // (graphWellFormed, below, is its graphInvariant): the wall a parked ticket
  // names, the source a dispatched one runs at and the generation a
  // finalization attempt is on are inside the state that has them, and
  // ticketInvariant holds each positive there. What follows is chuggy's:
  // the ledger, the history between two states, and this instance's bounds.

  /// THE PACKAGE'S OWN INVARIANT over the whole graph: every ticket keyed by
  /// its own id and satisfying ticketInvariant, no ticket naming itself or a
  /// ticket that does not exist, and the dependencies acyclic.
  val graphWellFormed: bool = graphInvariant(graph)

  /// THE headline property: exactly one completion per cycle, proved at the
  /// completion boundary and nowhere else — any number of task executions
  /// may duplicate (at-least-once fabric), but a finalization success is
  /// applied exactly once per ticket, exactly when it is Done. "Per cycle"
  /// collapses to "per ticket" because a completion ends the ticket (Done is
  /// absorbing) and a failed finalization completes nothing.
  val completionExclusive: bool = liveTickets.forall(j => and {
    ledgers.get(j).completions <= 1,
    (ledgers.get(j).completions == 1) iff (tickets.get(j).state == Done)
  })

  /// REVOKED NEVER COMPLETES: a revoked ticket has applied no completion —
  /// and never will: Revoked is absorbing (terminalsAbsorbing). Stated as its
  /// own named invariant because it is the model's exclusivity half, though
  /// state-wise it is a corollary of completionExclusive.
  val revokedNeverCompletes: bool = liveTickets.forall(j =>
    (tickets.get(j).state == Revoked) implies (ledgers.get(j).completions == 0))

  /// A COMPLETED TICKET PRODUCED SOMETHING (design 002). Deliberately the
  /// weak form: an artifact exists by the time a ticket is Done. The
  /// stronger claim — that what was committed is what was evaluated — would
  /// be TRUE BY CONSTRUCTION, and an invariant that cannot fail guards
  /// nothing. A Revoked ticket may hold NoArtifact: it may never have run.
  val artifactWellFormed: bool = liveTickets.forall(j =>
    (tickets.get(j).state == Done) implies
      (artifactOf(tickets.get(j), ledgers.get(j)) != NoArtifact))

  /// The absorbing terminals never move OUT: a ticket the last decision
  /// found Done or Revoked is still there.
  val terminalsAbsorbing: bool = prevTickets.keys().forall(j =>
    isTerminal(prevTickets.get(j).state) implies
      (tickets.keys().contains(j) and
        tickets.get(j).state == prevTickets.get(j).state))

  /// EVERY INSTANCE IS WELL-FORMED by the protocol's own invariant, and
  /// agrees with the ticket carrying it: it judges THIS ticket, under the
  /// plan the ticket was released with (so no plan can drift from the
  /// authored data), for a work cycle the ticket has actually started, and
  /// the instances — closed, then the open one — stand in the order those
  /// cycles ran, strictly ascending, so no cycle has two. The open one's
  /// agreement with the state holding it is the package's (ticketInvariant).
  val evaluationsWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    val instances = ledgerInstances(jb, ledgers.get(j))
    instances.indices().forall(i =>
      val ev = instances[i]
      and {
        invariant(ev),
        ev.input.ticket == j,
        ev.plan == jb.definition.evaluationPlan,
        ev.workCycle <= jb.workCyclesStarted,
        i == 0 or instances[i - 1].workCycle < ev.workCycle
      }))

  /// HISTORY IS APPEND-ONLY: against the ledgers the last decision found
  /// (ghost prevLedgers), every instance a ticket had closed is still closed
  /// and still says what it said, at the same place. So a rewritten
  /// judgement, a dropped instance and a reordered history are each caught
  /// in the step that did it. (Tickets are never deleted, so the ghost's
  /// domain always survives.)
  val evaluationsMonotone: bool = prevLedgers.keys().forall(j =>
    val before = prevLedgers.get(j).closedEvaluations
    and {
      ledgers.keys().contains(j),
      ledgers.get(j).closedEvaluations.length() >= before.length(),
      before.indices().forall(i =>
        ledgers.get(j).closedEvaluations[i] == before[i])
    })

  /// IDENTITY ACCOUNTING: the mint counter is exactly what the ticket's own
  /// history says it must be — one slot per work cycle started, plus, for
  /// every run of every instance it has opened, its roster once per
  /// generation it reached (ticket.qnt evaluationSpawnTotal). The fold
  /// claims from the RELEASED plan while this sum reads the INSTANCES, so
  /// the two sides come from different places: a spawn that claimed the
  /// wrong stage's roster, a resume that claimed nothing, or a cycle counted
  /// twice breaks the equality in the very state that did it.
  val idsAccounted: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    ledgers.get(j).spawned == jb.workCyclesStarted +
      evaluationSpawnTotal(ledgerInstances(jb, ledgers.get(j))))

  /// THE CONTRACT'S OWN PREDICATE over every task this machine is currently
  /// waiting on (task-contract/task.qnt taskIdentityValid): a spawn that
  /// drew a cycle, stage, generation or evaluator from zero would be caught
  /// in the state that spawned it.
  val taskIdentitiesValid: bool = liveTickets.forall(j =>
    liveTasks(tickets.get(j)).forall(task => taskIdentityValid(task)))

  /// THE RELEASED DEFINITION IS INSIDE THIS INSTANCE'S BOUNDS, in every
  /// reachable state (releasedTicketBounded); the package's graphInvariant
  /// holds the rest of it. Holding everywhere is what makes the bound a
  /// REFUSAL — a definition outside it is turned away at authoring time, by
  /// the release and by every update alike.
  val definitionsWellFormed: bool = liveTickets.forall(j =>
    releasedTicketBounded(tickets.get(j).definition))

  /// A DEFINITION MOVES ONLY WITH ITS REVISION: against the tickets the last
  /// decision found (ghost prevTickets), a ticket holds the definition and
  /// the revision it held, or it was Pending, still is, and holds the next
  /// revision under the same dependencies; a ticket the decision released
  /// is at the first.
  val revisionsAccounted: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    if (not(prevTickets.keys().contains(j))) jb.revision == 1
    else {
      val before = prevTickets.get(j)
      or {
        jb.definition == before.definition and jb.revision == before.revision,
        and {
          isPending(before.state),
          isPending(jb.state),
          jb.revision == before.revision + 1,
          jb.definition.dependencies == before.definition.dependencies
        }
      }
    })

  /// EVERY DECISION IS VALID where it was taken (the package's
  /// decisionValid): an accepted command's obligations are well-formed, owed
  /// once, and agree with the state its event evolved the one it found into,
  /// that state satisfies the package's graphInvariant, and a refused one
  /// left the tickets as it found them.
  val decisionsValid: bool = match lastStep {
    | Decided(d) => decisionValid(prevGraph, TicketDecided(d))
    | Refused(reason) =>
      decisionValid(prevGraph, TicketRefused(reason)) and graph == prevGraph
    | NoDecision => true
  }

  /// A DECIDED EVENT IS NEVER THE IDENTITY: the event the machine decides at
  /// a state moves that state. It is what lets a replay hold a journal row
  /// to "the event moved the state" (refinement.qnt journalLegalOn) without
  /// refusing a row the machine decided.
  val eventsNeverIdentity: bool = match lastStep {
    | Decided(d) => evolve(prevGraph, d.event) != prevGraph
    | _ => true
  }

  /// No ticket waits on itself through any chain, and every dependency names
  /// a released ticket (the package's dependencyGraphAcyclic, which walks
  /// the same closure).
  val depsAcyclic: bool = and {
    dependencyGraphAcyclic(graph),
    liveTickets.forall(j => waitsOn(graph, j).subseteq(liveTickets))
  }

  /// Identity membership and ticket count are bounded independently, and
  /// every released ticket has exactly one ledger.
  val ticketIdsWellFormed: bool = and {
    liveTickets.subseteq(ticketIdUniverse),
    liveTickets.size() <= N_TICKETS,
    ledgers.keys() == liveTickets
  }

  // --- Visibility -----------------------------------------------------------

  /// THE VISIBILITY EDGES: the walk's edge relation is the DEPENDENCY
  /// edges, and only those. The walks below are bounded monotone fixpoints
  /// over actual keys, so sparse or numerically reversed edges behave
  /// identically.
  def visEdges(j: int): Set[int] = waitsOn(graph, j)

  /// Tickets that cannot move without a human: parked on the desk, or
  /// Pending behind a dependency chain containing a parked ticket. A
  /// healthy-Blocked ticket is deliberately NOT stuck — it sits flat while
  /// its dependencies run, and progresses VICARIOUSLY.
  val stuckSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (st, _) =>
      liveTickets.filter(j => or {
        isEscalated(tickets.get(j).state),
        and {
          isPending(tickets.get(j).state),
          visEdges(j).exists(d => st.contains(d))
        }
      }))

  /// Tickets reachable from an open human task by walking the visibility
  /// edges: the ticket's own desk task (derived — hasOpenHumanTask), or a
  /// desk task somewhere in its dependency chain. Revoked contributes
  /// nothing here (hasOpenHumanTask excludes it), and neither does a
  /// Pending: its progress is its author's. Coverage propagates through
  /// EVERY state, over the same edges stuckSet walks: stuck ⊆ covered stays
  /// a structural corollary, per sweep.
  val coveredSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (cov, _) =>
      liveTickets.filter(j => or {
        hasOpenHumanTask(tickets.get(j)),
        visEdges(j).exists(d => cov.contains(d))
      }))

  /// THE TWO WALKS AGREE — and that is ALL this says. It is a TAUTOLOGY over
  /// the definitions, not a theorem about the machine: stuckSet's base case
  /// is Escalated, coveredSet's is hasOpenHumanTask, which IS Escalated; both
  /// walk the same visEdges, and stuckSet's inductive arm is coveredSet's
  /// plus one conjunct (Pending), hence strictly stronger, sweep for sweep.
  /// It cannot go red for any machine.
  ///
  /// KEPT IN `allInvariants` ANYWAY, for what it does guard: the two walks
  /// against EACH OTHER. It goes red if a future edit adds a stuckSet base
  /// case that is not a desk state, puts a state guard on coveredSet's
  /// inductive arm, or introduces an edge kind in one walk but not the
  /// other. It guards the definitions; it does not guard the machine. The
  /// half no state predicate can carry — unbounded WAITING — is accepted by
  /// name under bounds-work-not-waiting.
  val stuckSubsetCovered: bool = stuckSet.subseteq(coveredSet)

  /// THE ANTI-VACUITY WITNESS, not an invariant of the machine: "no
  /// eval stage ever advances". EXPECTED TO BE VIOLATED (the model gate
  /// shows it deterministically by the stage-advance machine trace in
  /// tests/chuggy_witness_test.qnt) — a reachable stage advance (an
  /// evaluation that progressed AND owes a new stage's evaluators) is the
  /// machine-level proof that multi-stage plans actually run stage-by-stage
  /// on machine traces, so the green invariant runs are checked against
  /// traces where the stage advance edge is exercised, not vacuous.
  val stageAdvanceNever: bool =
    not(lastEvent == "TicketEvaluationProgressed" and lastObligations.length() > 0)

  /// All safety invariants, for `--invariant=allInvariants`.
  val allInvariants: bool = and {
    graphWellFormed,
    completionExclusive,
    revokedNeverCompletes,
    artifactWellFormed,
    terminalsAbsorbing,
    evaluationsWellFormed,
    evaluationsMonotone,
    idsAccounted,
    taskIdentitiesValid,
    definitionsWellFormed,
    revisionsAccounted,
    decisionsValid,
    eventsNeverIdentity,
    depsAcyclic,
    ticketIdsWellFormed,
    stuckSubsetCovered
  }
}
