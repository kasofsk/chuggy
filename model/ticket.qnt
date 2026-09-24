/// THE TICKET RECORD — what a ticket IS, the vocabulary every layer speaks
/// about one, and the task plumbing the machine and its tests share.
///
/// Nothing here decides and nothing here reads a const: domain.qnt is the
/// machine, refinement.qnt is one runtime shape for it, and both are pure
/// functions of the `TicketGraph` this file declares.
///
/// DERIVE, DON'T STORE (standing rule 3) is what gives the record its shape.
/// The waiting room (Ready/Blocked), the open desk task, the tasks the fabric
/// is running and a ticket's artifact are all PREDICATES over what is stored,
/// so what is stored is what no predicate can reach: the phase, the data the
/// author released, the counters identities are drawn from, and the
/// evaluation instance of every work cycle that reached judgement.
///
/// WHAT A TICKET DELIBERATELY DOES NOT CARRY. No attempt counter and no
/// per-task budget: the fabric relaunches a failed container below the cycle
/// grain, so this machine's grain is the CYCLE and same-cycle retry
/// machinery is a standing non-goal. No live task set (Work runs the cycle's
/// one task and the instance's current run owes the evaluators, and
/// liveObligations names both), no readiness flag, and no timestamps —
/// implementation accounting, not machine state.
///
/// Sum-type constructors share one namespace per module, which is what the
/// prefixed names below are avoiding.
module chuggy_ticket {
  /// The task contract, copied verbatim into this tree (model/AGENTS.md says
  /// why). It brings the task identity and the predicates over it, the task
  /// DEFINITION a released ticket pins, the OBLIGATION a spawn owes, the
  /// VALIDATED RESULT a produced report carries back and the FAILURE a report
  /// that reached no result carries instead.
  import task_contract.* from "./task-contract/task"

  /// THE EVALUATION PROTOCOL, copied in at the package's own path
  /// (model/AGENTS.md lists the divergences). It brings the authored plan,
  /// the instance a work cycle's judgement runs in, and every function that
  /// moves one. Chuggy re-states none of them: the deciders in domain.qnt
  /// call begin, applyProduced, applyFailure, concludeStage, resumeBlocked
  /// and currentTaskObligations.
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"

  // === Vocabulary ==========================================================

  /// STORED ticket phases, deliberately few (standing rule 3, derive don't
  /// store). Blocked and Ready are PREDICATES over dependencies in
  /// domain.qnt, not phases — a ticket that has not started is Pending, and
  /// the waiting-room split is derived. Pending must be stored (phase is
  /// total and "never started" is not expressible as a predicate over the
  /// other fields without overloading them). Work/Evaluation run tasks;
  /// Finalization is its own phase because its outcome is the exclusivity
  /// boundary; Done is absorbing; Escalated is the human desk.
  ///
  /// Pending is the ONLY authoring phase: release goes Pending -> Pending
  /// directly, with Ready and Blocked derived.
  ///
  /// Escalated is THE parked phase — one parked-with-an-open-human-task
  /// phase, with the `escalation` field carrying the wall classification.
  ///
  /// Revoked is the other settled terminal: absorbing, runs nothing, never
  /// completes, and opens NO human task, because revocation is the author's
  /// settled choice (see hasOpenHumanTask).
  ///
  /// An eval stage advance gets NO phase — within-phase progress lives in the
  /// evaluation instance's current run rather than in new phases.
  type Phase =
    Pending | Work | Evaluation | Finalization | Done | Escalated | Revoked

  /// WHAT A TASK IS FOR is the contract's `TaskIdentity`:
  ///   WorkTask{ticket, cycle}
  ///              — the one task a work cycle runs (Work stays ONE task
  ///                phase per kasofsk's anatomy note; the extracted
  ///                vocabulary agrees task creation: "Job enters Work (new
  ///                cycle): one work task", i.e. Work is not staged).
  ///   EvaluationTask{ticket, workCycle, stage, generation, evaluator}
  ///              — one evaluator of one run of one stage, judging one work
  ///                cycle ("evaluators run in ascending stage order; within
  ///                a stage they fan out in parallel").
  /// Both of the identity's keys are AUTHORED: `stage` is the stage's own key
  /// and `evaluator` is the evaluator's, and the instance's own run supplies
  /// both — taskIdentityFor reads the stage's key out of the plan at the run's
  /// stored index, so no layer here counts a stage or an evaluator at a spawn.
  ///
  /// Every identity is DERIVED rather than stored: the work task is the
  /// cycle the ticket is on, and the run holds one status per evaluator, of
  /// which currentTaskObligations names exactly those still Awaiting. An
  /// identity is UNIQUE WITHIN THE TICKET across its entire history — never
  /// reused across stages, cycles, or operator resumes, because a work cycle
  /// is numbered and each run of a stage carries its own generation — which
  /// is what lets an event about a task nothing owes any more fall through
  /// evolve untouched (domain.qnt).

  /// WHY A TASK REACHED NO RESULT, which is NOT a verdict: the job died
  /// (ProcessFailure — the fabric already relaunched it below the cycle
  /// grain, so an exhausted budget arrives here) or infrastructure could not
  /// run it at all (ExecutionUnavailableFailure — the definitive walls). The
  /// two are told apart because they park an evaluator differently: the
  /// second is the only one whose judgement is intact and unmade, so it is
  /// the only one a resume can re-ask.
  type FailureKind = ProcessFailure | ExecutionUnavailableFailure

  /// WHAT COMES BACK FOR ONE TASK — the completion's payload, in the
  /// package's three arms. Each names the ticket it reports for, which is
  /// what lets the command be decided and the event carrying the report be
  /// applied with nothing beside it. Each produced arm carries the contract's
  /// VALIDATED RESULT: the full obligation the task was spawned under and the
  /// reference it produced under it. A work result also carries the source
  /// the application accepted it at; an evaluator's carries its verdict
  /// instead; a task that reached no result reports the contract's FAILURE —
  /// the task and the evidence — and its kind.
  type TaskTerminalReport =
      WorkResultReport({ ticket: int, result: ValidatedTaskResult,
        acceptedSourceRef: int })
    | EvaluationResultReport({ ticket: int, result: ValidatedTaskResult,
        verdict: EvaluationVerdict })
    | TerminalFailureReport({ ticket: int, failure: TaskFailure,
        kind: FailureKind })

  /// THE TICKET A REPORT IS FOR, whichever arm it is (the package's
  /// reportTicket).
  pure def reportTicket(report: TaskTerminalReport): int = match report {
    | WorkResultReport(work) => work.ticket
    | EvaluationResultReport(evaluation) => evaluation.ticket
    | TerminalFailureReport(failure) => failure.ticket
  }

  /// THE TASK A REPORT IS ABOUT, whichever arm it is (the package's
  /// reportTask).
  pure def reportTask(report: TaskTerminalReport): TaskIdentity = match report {
    | WorkResultReport(produced) => produced.result.obligation.task
    | EvaluationResultReport(produced) => produced.result.obligation.task
    | TerminalFailureReport(failed) => failed.failure.task
  }

  /// A REPORT IS WELL-FORMED when it names a ticket and every reference it
  /// carries is a real one (the package's reportValid). The instance holds
  /// the same line on its own side (evaluation.qnt stageRunInvariant demands
  /// a positive reference in every settled status), so a report admitted
  /// here cannot make a run ill-formed.
  pure def reportValid(report: TaskTerminalReport): bool = match report {
    | WorkResultReport(work) => work.ticket > 0 and work.acceptedSourceRef > 0
        and terminalValid(TaskResultProduced(work.result))
    | EvaluationResultReport(evaluation) => evaluation.ticket > 0
        and terminalValid(TaskResultProduced(evaluation.result))
    | TerminalFailureReport(failure) => failure.ticket > 0
        and failure.failure.evidence > 0
        and taskIdentityValid(failure.failure.task)
  }

  /// THE REPORT APPLIED TO AN INSTANCE — the package's applyEvaluationReport
  /// at chuggy's spelling of a report: a produced result goes to applyProduced
  /// whole, which is what lets the protocol hold it against the obligation it
  /// owes; a failure becomes the contract's terminal for its kind. Nothing
  /// here decides; applyProduced and applyFailure conclude the stage
  /// themselves.
  pure def applyEvaluationReport(
      evaluation: EvaluationInstance,
      report: TaskTerminalReport): EvaluationInstance =
    match report {
      | EvaluationResultReport(produced) => applyProduced(
          evaluation, produced.result.obligation.task, produced.result,
          produced.verdict)
      | TerminalFailureReport(failed) => applyFailure(evaluation,
          failed.failure.task,
          match failed.kind {
            | ProcessFailure => TaskProcessFailed(failed.failure)
            | ExecutionUnavailableFailure =>
              TaskExecutionUnavailable(failed.failure)
          })
      | WorkResultReport(_) => evaluation
    }

  /// An evaluation event may only be applied to the evaluation that still
  /// owes its reported task; the phase alone does not make the pairing legal
  /// (the package's reportAdmissible).
  pure def reportAdmissible(
      evaluation: EvaluationInstance, report: TaskTerminalReport): bool =
    taskCurrent(evaluation, reportTask(report))

  /// WHAT AN EVALUATION FAILURE DOES. The machine consults this at every
  /// failing stage (domain.qnt decideEvaluationTerminal) and takes exactly one of
  /// two edges: Rework re-enters Work as a new cycle; Escalate parks the
  /// ticket on the desk, where the operator's resume re-enters Work the same
  /// way. The machine does not choose between them — the policy is an INPUT
  /// to the decision, drawn nondeterministically by the `taskDone` action,
  /// and the event records which edge it took, so any policy an
  /// implementation runs over a ticket's history refines this machine and no
  /// replay ever consults one.
  type EvaluationFailureDisposition =
    ReworkEvaluationFailure
    | EscalateEvaluationFailure

  /// The package's policy: a function of the failed instance.
  type EvaluationFailurePolicy =
    EvaluationInstance => EvaluationFailureDisposition

  /// Where an operator Retry resumes a parked ticket. DERIVED from the wall
  /// (resumeOf below), never stored: a resume point beside the wall that
  /// implies it is a stored duplicate of a derivable fact (standing rule 3),
  /// and the pair could disagree. NoResume belongs to the unparked ticket,
  /// which has nothing to offer the desk.
  ///
  /// ResumeRework is the evaluation-failure wall's: it re-enters Work
  /// as a new cycle. That wall is reached by a VERDICT, and a verdict has no
  /// re-judge to offer — the fabric already relaunched the container below
  /// the cycle grain — so the only honest way on is a new artifact, which is
  /// a work cycle. ResumeEvaluation is the blocked wall's, and it is the one
  /// resume that re-asks rather than re-works.
  type Resume =
    NoResume | ResumeWork | ResumeRework | ResumeEvaluation |
    ResumeFinalization

  /// WHY A TICKET SITS ON THE HUMAN DESK — one sum, NoEscalation for the
  /// ticket that is not parked. The wall is what distinguishes the parks,
  /// and it is the whole of what the desk reads.
  /// WorkFailureEscalated is the CYCLE-level work wall (there is
  /// no retries wall: retrying a failed container below the cycle grain is
  /// the fabric's job, trusted here rather than modeled).
  /// WorkExecutionUnavailableEscalated is the wall infrastructure hits when
  /// it could not run an intact WORK task; WHICH refusal it was is evidence
  /// an adapter records beside the execution, never a distinction a decider
  /// reads — every refusal takes the same edge to the same desk with the same
  /// resume.
  /// EvaluationFailureEscalated is the evaluation-failure wall, reached when
  /// the failure's disposition is Escalate.
  /// EvaluationBlockedEscalated is the same infrastructure refusal against an
  /// EVALUATOR. It is its own wall rather than the execution one because
  /// an interruption is not a verdict: the judgement is intact and unmade, so
  /// it is the only wall whose resume re-enters evaluation — and it re-asks
  /// only the evaluators the wall stopped, because the rest of the stage
  /// already judged (evaluation.qnt resumeBlocked).
  /// FinalizationUnavailableEscalated is the wall a finalizer hits when it
  /// reaches no result at all; like the execution wall, WHICH unreachability
  /// it was is evidence an adapter records beside the finalization request,
  /// and every one of them takes the same edge to the same desk with the
  /// same resume.
  ///
  /// Nullary, deliberately: what each wall stood in front of is evidence an
  /// adapter records, and a payload here would be a second home for it. The
  /// package's EvaluationBlockedEscalated carries the saved instance; here
  /// the instance is on the ticket for every phase that has one, so carrying
  /// it at the wall as well would be that second home. The divergence is
  /// PR 9's (model/AGENTS.md).
  type Escalation =
    NoEscalation | WorkFailureEscalated | WorkExecutionUnavailableEscalated |
    EvaluationFailureEscalated | EvaluationBlockedEscalated |
    FinalizationUnavailableEscalated

  /// WHERE EACH WALL RESUMES — the derivation that lets the resume point
  /// leave the record (standing rule 3). Total on the sum, so every park the
  /// machine can reach offers the desk exactly one way on and the unparked
  /// ticket offers none.
  ///
  /// The two work walls share ResumeWork and the evaluation-failure wall
  /// takes ResumeRework: all three buy a new artifact, and only the names of
  /// the walls they answer differ.
  pure def resumeOf(escalation: Escalation): Resume =
    match escalation {
      | NoEscalation => NoResume
      | WorkFailureEscalated => ResumeWork
      | WorkExecutionUnavailableEscalated => ResumeWork
      | EvaluationFailureEscalated => ResumeRework
      | EvaluationBlockedEscalated => ResumeEvaluation
      | FinalizationUnavailableEscalated => ResumeFinalization
    }

  /// How a finalization attempt resolves, each carrying the evidence the
  /// finalizer returned. ONE success, deliberately: *which* mechanism a
  /// merge uses is a property of the merge adapter, not of the machine. The
  /// domain knows only that the step succeeded, failed, or could not be
  /// taken.
  ///   - FinalizationSucceeded  the step committed the artifact.
  ///   - FinalizationNeedsWork  it did not, and new work is the way on.
  ///   - FinalizationResultUnavailable
  ///                            it reached no result: the artifact is intact
  ///                            and untried, and what stood in the way is
  ///                            outside the ticket. Distinct from NeedsWork
  ///                            because new work would change nothing.
  type FinalizationResult =
    FinalizationSucceeded(int)
    | FinalizationNeedsWork(int)
    | FinalizationResultUnavailable(int)

  pure def finalizationResultValid(result: FinalizationResult): bool =
    match result {
      | FinalizationSucceeded(evidence) => evidence > 0
      | FinalizationNeedsWork(evidence) => evidence > 0
      | FinalizationResultUnavailable(evidence) => evidence > 0
    }

  /// A FINALIZER'S REPORT, as the attempt it answers: the ticket, the work
  /// cycle and the generation it was asked under, and what came back. The
  /// attempt is the report's own, so a result for one a resume superseded is
  /// told apart from the current one (domain.qnt decideFinalizationResult).
  type FinalizationResultReport = {
    ticket: int,
    workCycle: int,
    generation: int,
    result: FinalizationResult
  }

  /// WHAT A TICKET PRODUCED (design 002): an opaque identity for the thing
  /// work built, that evaluation judged, and that wrap-up commits. Its only
  /// modelled property is DISTINCTNESS — never content. A diff, a build
  /// output and an evaluator's prose are all equally none of the machine's
  /// business, and a content-shaped abstraction here would repeat the
  /// citation-scoping mistake of depending on something outside the model.
  ///
  /// It exists chiefly so a dependent can NAME what its dependency produced,
  /// which is unexpressible today: a dep is only a phase check. Reads across
  /// tickets are safe by construction — terminalsAbsorbing forbids leaving
  /// Done, depsDoneIn requires every dep to be Done, and only a completion
  /// writes Done, so a dependency's artifact is final before any dependent
  /// can dispatch. DERIVED (artifactOf), never stored.
  type ArtifactMark = NoArtifact | ProducedArtifact(int)

  /// WHAT THE AUTHOR RELEASED, as the one opaque reference the brief became.
  /// The machine never reads it for content; the application interprets it
  /// when it prepares a task's context.
  type ReleasedContent = int

  pure def releasedContentValid(content: ReleasedContent): bool = content > 0

  /// THE RELEASED TICKET — everything the release froze, in one record, and
  /// the only thing a decider reads about what a ticket IS. Every reference
  /// is opaque and positive: `content` is the brief, `workConfiguration` is
  /// the definition every work cycle runs under, `evaluationPlan` is the
  /// stages judgement runs, and `finalizationConfiguration` is what the
  /// finalizer is handed. The id is the ticket's own — the release names it
  /// here rather than beside it, so the graph's key and the definition are
  /// one fact (domain.qnt definitionsWellFormed holds them equal).
  ///
  /// It is STORED rather than re-resolved per request: a cycle that
  /// re-resolved its configuration would run a revision the release never
  /// pinned, and two cycles of one ticket could then run different ones. An
  /// update replaces it whole, and only while the ticket is Pending, so every
  /// cycle a ticket runs runs the definition it was dispatched under.
  type ReleasedTicket = {
    id: int,
    content: ReleasedContent,
    dependencies: Set[int],
    workConfiguration: TaskDefinition,
    evaluationPlan: EvaluationPlan,
    finalizationConfiguration: int
  }

  /// ONE FINALIZATION ATTEMPT, as the package spells it: the work cycle it
  /// finalizes, its generation within that cycle, the accepted work result it
  /// commits and the source that result was accepted at. Chuggy stores the
  /// generation alone (Ticket.finalizationGeneration) and derives the rest
  /// (finalizationOperationOf), because the cycle, the result and the source
  /// are already on the ticket.
  type FinalizationOperation = {
    workCycle: int,
    generation: int,
    input: int,
    source: int
  }

  /// One ticket's record.
  type Ticket = {
    phase: Phase,
    // WHAT THE RELEASE FROZE (above), read by every decider that asks what
    // this ticket IS, where the package carries the same record on its own
    // ReleasedTicket. An update replaces it while the ticket is Pending and
    // nothing else touches it.
    // The dependencies are acyclic by construction (domain.qnt depsAcyclic)
    // and project-local, because TicketGraph is project-scoped; an update
    // keeps them.
    definition: ReleasedTicket,
    // THE DEFINITION'S REVISION, as the package holds it: 1 at the release,
    // and one more for each update. An update names the revision it was
    // written against, so one written against a definition another update
    // has since replaced is refused rather than landed on it.
    revision: int,
    // THE SOURCE THIS TICKET'S WORK RUNS AT — opaque, positive once the
    // ticket has been dispatched and 0 before (domain.qnt sourcePinned),
    // where the package hangs the same value off WorkExecution, its three
    // escalations, FinalizationOperation and EvaluationInput.
    // The dispatch observes one and an accepted work result replaces it with
    // the source that result was accepted at; a rework, a resume and the
    // finalizer run at what the ticket already carries, because a spawn
    // that observed a source of its own could run against one nobody
    // accepted.
    source: int,
    // THE EVALUATION INSTANCES — one per work cycle that reached judgement,
    // in the order those cycles ran, each holding the plan it ran under, the
    // artifact it judged, its completed stage runs and the run it stopped
    // at. Appended when work is accepted (domain.qnt evolve) and advanced in
    // place while the ticket judges; the LAST one is the current one exactly
    // while the ticket is in Evaluation or parked at the blocked wall, and an
    // earlier one never changes again (domain.qnt evaluationsMonotone).
    evaluations: List[EvaluationInstance],
    // How many work cycles this ticket has STARTED — the counter a work
    // identity's `cycle` is drawn from, and the `workCycle` every evaluation
    // identity of that cycle names. Held rather than recounted at each spawn
    // site, and pinned by the identity-accounting invariant (domain.qnt
    // idsAccounted), which is the same treatment the mint counter gets one
    // field below.
    workCyclesStarted: int,
    // THE MINT COUNTER: how many task slots this ticket has ever claimed.
    // A work spawn claims one; an evaluation spawn claims one per evaluator
    // the run LISTS, whether this generation asks all of them or only the
    // ones a resume reopened (spawnEvalRun below). It is monotone and never
    // reused, which is what an implementation mints an external task number
    // from. It is an identity ledger and no result reference is drawn from
    // it. Held against what the instances themselves say by the
    // identity-accounting invariant (domain.qnt idsAccounted).
    spawned: int,
    // THE GENERATION OF THIS CYCLE'S FINALIZATION: 0 until the cycle's
    // judgement passes, 1 for the first attempt, and one more for each
    // resume from the finalization wall — the one part of the package's
    // FinalizationOperation no other field holds, and what makes a result for
    // an attempt a resume superseded one nothing owes (domain.qnt
    // finalizationCurrent). Every work spawn clears it.
    finalizationGeneration: int,
    // The wall this ticket is parked at (NoEscalation unless Escalated).
    // Deliberately FIRST-CLASS stored trace vocabulary, not derived from
    // phase: with one parked phase, the wall is what tells the desk what it
    // is looking at. Where a retry resumes is derived from it (resumeOf).
    escalation: Escalation,
    // GHOST: finalization successes ever applied to this ticket — the
    // counter the exactly-one-completion invariant reads. Not implementation
    // state.
    completions: int
  }

  /// Standing rule 3 (derive, don't store): the open-human-task flag IS a
  /// predicate over the phase — a desk task is open exactly while the ticket
  /// is parked on the desk, and Escalated is THE parked phase.
  /// (storing the flag would need the iff proved as an invariant; deriving
  /// it makes the invariant hold by construction.) The desk is implied by
  /// the park itself: no obligation opens it.
  ///
  /// Revoked is deliberately NOT here: revocation is the author's
  /// settled choice — the desk owes a revoked ticket nothing, exactly like
  /// Done. A dependent behind a Revoked dep gets no desk task through that
  /// dep either: it stays Pending, waiting on a dependency that will never
  /// be Done, and its author settles it by revoking it too.
  pure def hasOpenHumanTask(ticket: Ticket): bool = ticket.phase == Escalated

  /// The machine's observed state, as the pure deciders see it. A record
  /// (not a bare map) so the ticket-source shape stays open: tickets RELEASE
  /// by growing the map's sparse, never-reused id domain through the
  /// `freshTicket` seam, and no decider needed surgery. The shape that grew
  /// is the Ticket record (the plan, the instances), not TicketGraph.
  type TicketGraph = { tickets: int -> Ticket }

  // === Events, obligations and decisions (the package's, verbatim) =========

  /// A report as an event carries it: the ticket, and what came back.
  type TaskTerminalFact = {
    ticket: int,
    report: TaskTerminalReport
  }

  /// A failing stage's report, and the failed entries the rework or the
  /// escalation carries.
  type EvaluationReworkFact = {
    ticket: int,
    report: TaskTerminalReport,
    evidence: List[EvaluationReworkEntry]
  }

  type WorkResultAcceptedEvent = {
    ticket: int,
    result: ValidatedTaskResult,
    acceptedSourceRef: int
  }

  type WorkFailureEvent = {
    ticket: int,
    task: TaskIdentity,
    evidence: int
  }

  /// A finalizer's report, as the attempt it answers: the work cycle and the
  /// generation, and the evidence the finalizer returned.
  type FinalizationFact = {
    ticket: int,
    workCycle: int,
    generation: int,
    evidence: int
  }

  /// An accepted update: the ticket, the revision it lands as, and the
  /// definition that replaces the one before it.
  type TicketUpdate = {
    ticket: int,
    revision: int,
    definition: ReleasedTicket
  }

  /// WHAT HAPPENED — the journal's row, and the only thing evolve reads. One
  /// arm per fact the package names. A fact carries what a replay needs and
  /// no more: which edge a failing stage took is its arm, so the policy that
  /// chose it is never consulted again.
  type TicketEvent =
    TicketCreated(ReleasedTicket)
    | TicketUpdated(TicketUpdate)
    | TicketDispatched({ ticket: int, source: int })
    | TicketRevoked(int)
    | TicketWorkResumed(int)
    | TicketEvaluationResumed(int)
    | TicketFinalizationResumed(int)
    | TicketWorkResultAccepted(WorkResultAcceptedEvent)
    | TicketWorkProcessFailed(WorkFailureEvent)
    | TicketWorkExecutionUnavailable(WorkFailureEvent)
    | TicketEvaluationProgressed(TaskTerminalFact)
    | TicketEvaluationPassed(TaskTerminalFact)
    | TicketEvaluationReworkStarted(EvaluationReworkFact)
    | TicketEvaluationFailureEscalated(EvaluationReworkFact)
    | TicketEvaluationBlocked(TaskTerminalFact)
    | TicketFinalizationSucceeded(FinalizationFact)
    | TicketFinalizationNeedsWork(FinalizationFact)
    | TicketFinalizationUnavailable(FinalizationFact)

  type TicketTaskObligation = {
    ticket: int,
    task: TaskObligation
  }

  type FinalizationObligation = {
    ticket: int,
    finalization: FinalizationOperation,
    configuration: int
  }

  type TaskCancellation = {
    ticket: int,
    task: TaskIdentity
  }

  /// WHAT A DECISION OWES THE WORLD, each naming its own ticket: a task to
  /// run under its full obligation, a finalization to attempt, a task to
  /// stop. The desk is not one — it is implied by the park.
  type Obligation =
    ExecuteTask(TicketTaskObligation)
    | FinalizeTicket(FinalizationObligation)
    | CancelTask(TaskCancellation)

  /// What a decider returns when it accepts: the event, and what it owes.
  type SuccessfulTicketDecision = {
    event: TicketEvent,
    obligations: List[Obligation]
  }

  // === Commands, refusals and the decision (the package's, verbatim) =======

  /// WHAT THE MACHINE IS ASKED — the decider's input, one arm per thing a
  /// principal or the fabric can ask of a ticket: release one, replace its
  /// definition at the revision the author read, dispatch it at the source
  /// the application observed, revoke or resume it, report what a task came
  /// back with, report what a finalizer did. A command is never journaled:
  /// `decide` turns it into the event the journal keeps, or into a refusal
  /// nothing keeps.
  type TicketCommand =
    CreateTicket(ReleasedTicket)
    | UpdateTicket({
        ticket: int,
        expectedRevision: int,
        definition: ReleasedTicket
      })
    | DispatchTicket({ ticket: int, source: int })
    | RevokeTicket(int)
    | ResumeTicket(int)
    | ReportTaskTerminal(TaskTerminalReport)
    | ReportFinalizationResult(FinalizationResultReport)

  /// Which dependencies a refusal is about: the ones a release named that do
  /// not exist, or the ones a dispatch found not Done.
  type IncompleteDependencies = {
    ticket: int,
    dependencies: Set[int]
  }

  /// The task a report named that its ticket does not owe.
  type CurrentTaskRefusal = {
    ticket: int,
    task: TaskIdentity
  }

  /// The finalization attempt a report named that its ticket is not on.
  type CurrentFinalizationRefusal = {
    ticket: int,
    workCycle: int,
    generation: int
  }

  /// The revision an update expected, beside the one the ticket holds.
  type StaleRevision = {
    ticket: int,
    expected: int,
    current: int
  }

  /// WHY THE MACHINE WOULD NOT — one arm per check a decider makes, each
  /// carrying the numbers it found. The first check that fails names the
  /// refusal, so each decider's order is the package's.
  type TicketRefusal =
    TicketAlreadyExists(int)
    | DependenciesNotFound(IncompleteDependencies)
    | SelfDependency(int)
    | TicketNotFound(int)
    | TicketNotPending(int)
    | TicketIdentityMismatch(int)
    | TicketRevisionStale(StaleRevision)
    | TicketDependenciesChanged(int)
    | DependenciesIncomplete(IncompleteDependencies)
    | TicketNotRevocable(int)
    | TicketNotResumable(int)
    | TaskNotCurrent(CurrentTaskRefusal)
    | FinalizationNotCurrent(CurrentFinalizationRefusal)

  /// WHAT `decide` RETURNS: a refusal, or the event and what it owes. A
  /// refusal changes nothing and is journaled nowhere.
  type TicketDecision =
    TicketRefused(TicketRefusal)
    | TicketDecided(SuccessfulTicketDecision)

  /// THE MACHINE'S LAST DECISION, as the golden traces record it: none before
  /// the first, and after it the last one taken — an accepted command's
  /// event and obligations, or a refused command's refusal.
  type LastDecision =
    NoDecision
    | Decided(SuccessfulTicketDecision)
    | Refused(TicketRefusal)

  // === Vocabulary helpers (task plumbing shared by machine and tests) ======

  /// THE TWO IDENTITY CONSTRUCTORS. The work one is chuggy's, because the
  /// package declares it beside its own ticket; the evaluation one is the
  /// protocol's `evaluatorTaskIdentity`, and the instance's own
  /// `taskIdentityFor` is what every spawn here goes through.
  pure def workTaskOf(ticket: int, cycle: int): TaskIdentity =
    WorkTask({ ticket: ticket, cycle: cycle })

  /// THE WORK OBLIGATION — chuggy's twin of the package's workTaskObligation:
  /// the cycle's own identity, the definition the release pinned for work,
  /// and the work CYCLE as the context reference, which is the scope the
  /// application commits the cycle's input bundle under. Every work spawn
  /// owes exactly this, and a produced work report is accepted only when it
  /// carries the same record (domain.qnt decideTaskTerminal).
  pure def workTaskObligation(ticket: Ticket, cycleNumber: int): TaskObligation = {
    task: workTaskOf(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    contextRef: cycleNumber
  }

  /// AN OPAQUE POSITIVE REFERENCE derived from a task's own identity, where
  /// the real system has a stored row — a piece of failure evidence. The
  /// machine's only claim on such a reference is that it exists and is
  /// distinct per evaluator within a run, which is the discrimination a
  /// run's statuses need.
  pure def taskRefOf(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// The band a work result's model-scope reference is drawn in.
  pure val workResultBand: int = 100

  /// WHAT A PRODUCED RESULT'S REFERENCE IS AT MODEL SCOPE (producedResult's
  /// helper), where the real system folds the digest of the manifest the task
  /// attested. A WORK result takes a band of its own, clear of the cycle that
  /// produced it: the reference a report carries is a fact the completion is
  /// TOLD, and one that read back as the cycle would let a reader — and a
  /// golden — mistake a derivation for the number that travelled. An
  /// evaluator's is its own key, which is what tells one evaluator's result
  /// from another's within a run.
  pure def producedResultRef(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => workResultBand * work.ticket + work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// THE WORK SPAWN: a work cycle is one task, always — work is not staged
  /// and lists no evaluators, so the only parallelism in this machine is an
  /// evaluation stage's roster. Named once here because every work spawn site
  /// (dispatch, both reworks, the work resume) is this call, and starting the
  /// cycle is the only thing that moves the counter its identity is drawn
  /// from. The mint counter claims the one slot the task takes, and the
  /// cycle has no finalization yet.
  pure def spawnWork(ticket: Ticket): Ticket =
    { ...ticket,
      workCyclesStarted: ticket.workCyclesStarted + 1,
      spawned: ticket.spawned + 1,
      finalizationGeneration: 0 }

  // === The evaluation instance (the protocol, driven from the ticket) =====

  /// THE CURRENT INSTANCE: the last one, which is the open one exactly while
  /// the ticket is in Evaluation or parked at the blocked wall (domain.qnt
  /// evaluationsWellFormed). Callers guarantee the list is non-empty, which
  /// every phase that has one does.
  pure def currentInstance(ticket: Ticket): EvaluationInstance =
    ticket.evaluations[ticket.evaluations.length() - 1]

  /// Install an advanced instance in place of the current one. Only the last
  /// instance is ever rewritten; evaluationsMonotone is what holds that.
  pure def withInstance(ticket: Ticket, evaluation: EvaluationInstance): Ticket =
    { ...ticket,
      evaluations: ticket.evaluations
        .replaceAt(ticket.evaluations.length() - 1, evaluation) }

  /// WHICH STAGE AN INSTANCE IS RUNNING, as the index its run stores; -1
  /// when it is not running one. The package's own read, spelled here
  /// because the package declares it beside its ticket rather than in the
  /// protocol.
  pure def runningStageIndex(evaluation: EvaluationInstance): int =
    match evaluation.state {
      | Running(progress) => progress.stage.stageIndex
      | _ => -1
    }

  /// EVERY RUN AN INSTANCE HOLDS, completed and current — the whole of what
  /// it has asked for. A terminal state's list already holds the run that
  /// ended it (evaluation.qnt concludeStage appends before it decides), so
  /// only the two open states add their current run.
  pure def instanceRuns(evaluation: EvaluationInstance): List[StageRun] =
    match evaluation.state {
      | Running(progress) => progress.completedStages.append(progress.stage)
      | EvaluationBlocked(progress) =>
        progress.completedStages.append(progress.stage)
      | EvaluationPassed(completedStages) => completedStages
      | EvaluationFailed(completedStages) => completedStages
    }

  /// EVERY TASK IDENTITY AN INSTANCE HAS NAMED at the generation its runs
  /// now stand at. The generations a resume left behind are not recoverable
  /// and are deliberately not named: an event about an earlier generation's
  /// task is one nothing owes, and evolve lets it fall through by identity
  /// without the machine having to enumerate it.
  pure def instanceTasks(evaluation: EvaluationInstance): Set[TaskIdentity] =
    instanceRuns(evaluation).foldl(Set(), (found, progress) =>
      found.union(progress.evaluators.keys().map(evaluator =>
        taskIdentityFor(evaluation, progress, evaluator))))

  /// THE SLOTS A RUN CLAIMED: its roster once per generation it has reached.
  /// A resume re-asks only the evaluators it reopened but claims the roster
  /// again, which is what makes the count a function of the run alone.
  pure def runSpawnTotal(progress: StageRun): int =
    progress.generation * progress.evaluators.keys().size()

  /// THE SLOTS EVERY INSTANCE OF THIS TICKET CLAIMED — the evaluation half
  /// of the mint counter, derived from the instances rather than stored
  /// beside them (domain.qnt idsAccounted holds the two equal).
  pure def evaluationSpawnTotal(ticket: Ticket): int =
    ticket.evaluations.foldl(0, (total, evaluation) =>
      total + instanceRuns(evaluation).foldl(0, (n, progress) => n + runSpawnTotal(progress)))

  /// THE EVALUATION SPAWN: the current run's obligations go to the fabric
  /// (currentTaskObligations names them) and the mint counter claims one
  /// slot per evaluator the run's stage LISTS. Claiming the roster rather
  /// than the subset asked keeps the counter derivable from the instance;
  /// the slots a resume leaves unused are gaps, and a gap costs a monotone
  /// mint nothing.
  pure def spawnEvalRun(ticket: Ticket): Ticket =
    val index = runningStageIndex(currentInstance(ticket))
    { ...ticket,
      spawned: ticket.spawned +
        ticket.definition.evaluationPlan.stages[index].evaluators.length() }

  /// THE INSTANCE AN ACCEPTED WORK RESULT OPENS: the instance is begun over
  /// `workResult`, the reference the accepted report carried, with the
  /// released plan and the source that result was accepted at. One instance
  /// per work cycle that gets this far.
  ///
  /// The artifact the dependents read is that same reference (artifactOf),
  /// and so is every evaluator obligation's contextRef (evaluation.qnt
  /// currentTaskObligations builds it from input.workResult): a judgement is
  /// OF a result, so the number the work reported is the number the
  /// judgement is asked under. The mint counter is an identity ledger and
  /// never stands in for it, and neither does the cycle.
  pure def begunInstance(
      ticket: Ticket, workResult: int,
      acceptedSourceRef: int): EvaluationInstance =
    begin(
      ticket.workCyclesStarted,
      { ticket: ticket.definition.id, workResult: workResult,
        acceptedSourceRef: acceptedSourceRef },
      ticket.definition.evaluationPlan)

  /// IS THE INSTANCE PARKED ON A WALL? The blocked state is the one the
  /// desk reads, and the desk's own wall is held equal to it (domain.qnt
  /// evaluationsWellFormed).
  pure def instanceBlocked(evaluation: EvaluationInstance): bool =
    match evaluation.state {
      | EvaluationBlocked(_) => true
      | _ => false
    }

  /// WHAT THIS TICKET PRODUCED, derived: the accepted work result the latest
  /// instance judges, and nothing before any work was accepted. Each
  /// accepted result opens an instance over itself, so the last instance's
  /// input is the latest product and a rework's supersedes the one before it.
  pure def artifactOf(ticket: Ticket): ArtifactMark =
    if (ticket.evaluations.length() == 0) NoArtifact
    else ProducedArtifact(currentInstance(ticket).input.workResult)

  /// THE FINALIZATION ATTEMPT THIS TICKET IS ON: the cycle it is on, the
  /// stored generation, and the accepted result and source that cycle's
  /// judgement passed. Read only in Finalization and at the finalization
  /// wall, where the current instance is the passed one.
  pure def finalizationOperationOf(ticket: Ticket): FinalizationOperation = {
    workCycle: ticket.workCyclesStarted,
    generation: ticket.finalizationGeneration,
    input: currentInstance(ticket).input.workResult,
    source: ticket.source
  }

  /// WHAT THE FABRIC IS RUNNING FOR THIS TICKET, as the OBLIGATIONS it owes:
  /// the work cycle's one obligation while the ticket is in Work, or the ones
  /// the current run still owes (evaluation.qnt currentTaskObligations).
  /// Empty in every other phase, which is what makes leaving a phase enough
  /// to stop owing them.
  ///
  /// The whole obligation and not the identity alone, because that is what a
  /// produced report is held against: a report carrying the right task under
  /// the wrong definition or the wrong context is a report for a spawn this
  /// ticket never made.
  pure def liveObligations(ticket: Ticket): List[TaskObligation] =
    if (ticket.phase == Work)
      [workTaskObligation(ticket, ticket.workCyclesStarted)]
    else if (ticket.phase == Evaluation)
      currentTaskObligations(currentInstance(ticket))
    else []

  /// THE TASKS THE FABRIC IS RUNNING FOR THIS TICKET, in the obligations'
  /// order (the package's liveTaskList).
  pure def liveTaskList(ticket: Ticket): List[TaskIdentity] =
    liveObligations(ticket).foldl([], (tasks, owed) => tasks.append(owed.task))

  /// The same identities as a set, which is what the actions draw from.
  pure def liveTasks(ticket: Ticket): Set[TaskIdentity] =
    liveObligations(ticket).foldl(Set(), (found, owed) =>
      found.union(Set(owed.task)))

  /// Whether a list names this task (the package's listHasTask).
  pure def listHasTask(tasks: List[TaskIdentity], task: TaskIdentity): bool =
    tasks.indices().exists(index => tasks[index] == task)

  /// WHAT A LIVE TASK'S RESULT LOOKS LIKE TO THE MACHINE: the obligation this
  /// ticket owes for it, and the reference producedResultRef derives where
  /// the real system folds a stored manifest's digest. Callers draw the task
  /// from liveTasks, which is what makes the obligation there to find. This
  /// is the CORPUS's constructor — the walk needs a report it can hold the
  /// machine to — and the only place a result reference is derived at all:
  /// every decider takes the one its report carried.
  pure def producedResult(
      ticket: Ticket, task: TaskIdentity): ValidatedTaskResult =
    { obligation: liveObligations(ticket).select(owed => owed.task == task)[0],
      resultRef: producedResultRef(task) }

  // === Obligations (the package's constructors, at chuggy's record) ========

  /// Run a work cycle's task, under the obligation the cycle owes.
  pure def executeWork(ticket: Ticket, cycleNumber: int): Obligation =
    ExecuteTask({ ticket: ticket.definition.id,
      task: workTaskObligation(ticket, cycleNumber) })

  /// Run every evaluator an instance's current run still owes, in the
  /// roster's order.
  pure def executeEvaluationTasks(
      ticket: int, evaluation: EvaluationInstance): List[Obligation] =
    currentTaskObligations(evaluation).foldl([], (obligations, task) =>
      obligations.append(ExecuteTask({ ticket: ticket, task: task })))

  /// Attempt a finalization, under the configuration the release pinned.
  pure def finalize(
      ticket: Ticket, operation: FinalizationOperation): Obligation =
    FinalizeTicket({ ticket: ticket.definition.id, finalization: operation,
      configuration: ticket.definition.finalizationConfiguration })

  /// Stop every task the fabric is running for this ticket.
  pure def cancelLiveTasks(ticket: Ticket): List[Obligation] =
    liveTaskList(ticket).foldl([], (obligations, task) =>
      obligations.append(CancelTask({ ticket: ticket.definition.id,
        task: task })))
}
