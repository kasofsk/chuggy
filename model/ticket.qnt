/// THE TICKET RECORD — what a ticket IS, the vocabulary every layer speaks
/// about one, and the task plumbing the machine and its tests share.
///
/// Nothing here decides and nothing here reads a const: domain.qnt is the
/// machine, refinement.qnt is one runtime shape for it, and both are pure
/// functions of the `TicketGraph` this file declares.
///
/// DERIVE, DON'T STORE (standing rule 3) is what gives the record its shape.
/// The waiting room (Ready/Blocked), the open desk task, the evaluation
/// tasks the fabric is running and a dependency's artifact are all
/// PREDICATES over what is stored, so what is stored is what no predicate can
/// reach: the phase, the data the author released, the work task, and the
/// evaluation instance of every work cycle that reached judgement.
///
/// WHAT A TICKET DELIBERATELY DOES NOT CARRY. No attempt counter and no
/// per-task budget: the fabric relaunches a failed container below the cycle
/// grain, so this machine's grain is the CYCLE and same-cycle retry
/// machinery is a standing non-goal. No live evaluation task set (the
/// instance's current run owes them, and currentTaskObligations names them),
/// no readiness flag, and no timestamps — implementation accounting, not
/// machine state.
///
/// Sum-type constructors share one namespace per module, which is what the
/// prefixed names below are avoiding.
module chuggy_ticket {
  /// The task contract, copied verbatim into this tree (model/AGENTS.md says
  /// why). It brings the task identity and the predicates over it, the task
  /// DEFINITION a released ticket pins, the OBLIGATION a spawn owes and the
  /// VALIDATED RESULT a produced report carries back.
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
  /// other fields without overloading them). Work/Evaluation carry the
  /// parallel task set; Finalization is its own phase because its outcome is
  /// the exclusivity boundary; Done is absorbing; Escalated is the human desk.
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
  /// An eval stage advance gets NO phase — it is an Evaluation ->
  /// Evaluation edge, because within-phase progress lives in the evaluation
  /// instance's current run rather than in new phases.
  type Phase =
    Pending | Work | Evaluation | Finalization | Done | Escalated | Revoked

  /// WHAT A TASK IS FOR is the contract's `TaskIdentity`:
  ///   WorkTask{ticket, cycle}
  ///              — the one task a work cycle runs (Work stays ONE task-set
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
  /// The evaluation identities are DERIVED rather than stored: the run holds
  /// one status per evaluator, and currentTaskObligations names exactly the
  /// tasks whose status is still Awaiting.

  /// THE WORK TASK'S OUTCOME — RESOLVED outcomes only; an outstanding task
  /// cannot carry one (see TaskState). A work cycle's task either produced
  /// the artifact or it did not, and the evaluation side keeps no outcome
  /// here at all: an evaluator's is a per-evaluator status on the run
  /// (EvaluatorStatus), which is what lets infrastructure death be told from
  /// a judgement.
  type TaskOutcome = Passed | Failed

  /// THE EXPLICIT TASK LIFECYCLE (one small sum instead of implicit
  /// set-membership). A task is PUBLISHED to the fabric as outstanding and
  /// RESOLVES exactly once. Assignment, launch, execution and their retries
  /// are the trusted fabric's grain, not states of this machine. Resolved
  /// carries the outcome, so an outstanding task CANNOT carry one and a
  /// resolved task MUST. First write wins (resolveTask); resolution is final
  /// (resolveTask is the only edge, and nothing maps a Resolved back).

  type TaskState = Outstanding | Resolved(TaskOutcome)

  /// THE WORK TASK, as a record: the contract's identity + lifecycle state.
  /// An identity is UNIQUE WITHIN THE TICKET across its entire history —
  /// never reused across stages, cycles, or operator retries, because a work
  /// cycle is numbered and each run of a stage within a cycle carries its own
  /// generation. That uniqueness is load-bearing: it is what lets a stale
  /// completion from an earlier stage/incarnation be absorbed BY IDENTITY
  /// (domain.qnt decideTaskDone).
  /// Deliberately absent: `attempt` and the
  /// per-task retry budgets (below-cycle machinery, a standing non-goal),
  /// timestamps/results (implementation accounting, not machine state).

  type Task = { identity: TaskIdentity, state: TaskState }

  /// WHY A TASK REACHED NO RESULT, which is NOT a verdict: the job died
  /// (ProcessFailure — the fabric already relaunched it below the cycle
  /// grain, so an exhausted budget arrives here) or infrastructure could not
  /// run it at all (ExecutionUnavailableFailure — the definitive walls). The
  /// two are told apart because they park an evaluator differently: the
  /// second is the only one whose judgement is intact and unmade, so it is
  /// the only one a resume can re-ask.
  type FailureKind = ProcessFailure | ExecutionUnavailableFailure

  /// WHAT COMES BACK FOR ONE TASK — the completion event's payload, in the
  /// package's three arms. Each produced arm carries the contract's
  /// VALIDATED RESULT: the full obligation the task was spawned under and the
  /// reference it produced under it. A work result also carries the source
  /// the application accepted it at; an evaluator's carries its verdict
  /// instead; either task reaches no result at all and reports the failure's
  /// evidence and kind. The task is named by the event that carries the
  /// report (domain.qnt decideTaskDone), so no arm repeats it.
  type TaskTerminalReport =
      WorkResultReport({ result: ValidatedTaskResult, acceptedSourceRef: int })
    | EvaluationResultReport({ result: ValidatedTaskResult,
        verdict: EvaluationVerdict })
    | TerminalFailureReport({ evidence: int, kind: FailureKind })

  /// A REPORT IS WELL-FORMED when every reference it carries is a real one.
  /// The instance holds the same line on its own side (evaluation.qnt
  /// stageRunInvariant demands a positive reference in every settled
  /// status), so a report admitted here cannot make a run ill-formed.
  pure def reportValid(report: TaskTerminalReport): bool = match report {
    | WorkResultReport(produced) =>
      taskObligationValid(produced.result.obligation)
        and produced.result.resultRef > 0
        and produced.acceptedSourceRef > 0
    | EvaluationResultReport(produced) =>
      taskObligationValid(produced.result.obligation)
        and produced.result.resultRef > 0
    | TerminalFailureReport(failure) => failure.evidence > 0
  }

  /// THE REPORT APPLIED TO AN INSTANCE — the package's applyEvaluationReport
  /// at chuggy's spelling of a report: a produced result goes to applyProduced
  /// whole, which is what lets the protocol hold it against the obligation it
  /// owes; a failure becomes the contract's terminal for its kind. Nothing
  /// here decides; applyProduced and applyFailure conclude the stage
  /// themselves.
  pure def applyTaskReport(
      evaluation: EvaluationInstance, task: TaskIdentity,
      report: TaskTerminalReport): EvaluationInstance =
    match report {
      | EvaluationResultReport(produced) => applyProduced(
          evaluation, task, produced.result, produced.verdict)
      | TerminalFailureReport(failure) => applyFailure(evaluation, task,
          match failure.kind {
            | ProcessFailure =>
              TaskProcessFailed({ task: task, evidence: failure.evidence })
            | ExecutionUnavailableFailure =>
              TaskExecutionUnavailable({ task: task, evidence: failure.evidence })
          })
      | WorkResultReport(_) => evaluation
    }

  /// WHAT AN EVALUATION FAILURE DOES. The machine consults this at every
  /// failing stage (domain.qnt decideEvalStageReduce) and takes exactly one
  /// of two edges: Rework re-enters Work as a new cycle; Escalate parks
  /// the ticket on the desk, where the operator's resume re-enters Work
  /// the same way. The machine does not choose between them — the
  /// disposition is an INPUT to the decision, drawn nondeterministically by
  /// the `evalReduce` action and journaled with it, so any policy an
  /// implementation runs over a ticket's history refines this machine.
  type EvaluationFailureDisposition =
    ReworkEvaluationFailure
    | EscalateEvaluationFailure

  /// Where an operator Retry resumes a parked ticket. DERIVED from the wall
  /// (resumeOf below), never stored: a resume point beside the wall that
  /// implies it is a stored duplicate of a derivable fact (standing rule 3),
  /// and the pair could disagree. NoResume belongs to the unparked ticket,
  /// which has no continuation to offer the desk.
  ///
  /// ResumeRework is the evaluation-failure wall's: it re-enters Work
  /// as a new cycle. That wall is reached by a VERDICT, and a verdict has no
  /// re-judge to offer — the fabric already relaunched the container below
  /// the cycle grain — so the only honest continuation is a new artifact,
  /// which is a work cycle. ResumeEvaluation is the blocked wall's, and it
  /// is the one continuation that re-asks rather than re-works.
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
  /// it could not run an intact WORK task set; WHICH refusal it was is
  /// evidence an adapter records beside the execution, never a distinction a
  /// decider reads — every refusal takes the same edge to the same desk with
  /// the same resume.
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
  /// machine can reach offers the desk exactly one continuation and the
  /// unparked ticket offers none.
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

  /// How a finalization attempt resolves. ONE success, deliberately: an earlier
  /// model named two, because a merge promotes differently depending on
  /// whether it went through the gate — and *which* mechanism a merge uses
  /// is a property of the merge adapter, not of the machine. The domain
  /// knows only that the step succeeded, failed, or could not be taken.
  ///   - FinalizationSucceeded  the step committed the artifact.
  ///   - FinalizationNeedsWork     it did not, and is drawable only when the
  ///                            environment invalidated the artifact
  ///                            (domain.qnt finalizationOutcomes).
  ///   - FinalizationResultUnavailable
  ///                            it reached no result: the artifact is intact
  ///                            and untried, and what stood in the way is
  ///                            outside the ticket. Distinct from NeedsWork
  ///                            because new work would change nothing.
  type FinalizationOutcome =
    FinalizationSucceeded | FinalizationNeedsWork |
    FinalizationResultUnavailable

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
  /// can dispatch.
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
  /// pinned, and two cycles of one ticket could then run different ones.
  type ReleasedTicket = {
    id: int,
    content: ReleasedContent,
    dependencies: Set[int],
    workConfiguration: TaskDefinition,
    evaluationPlan: EvaluationPlan,
    finalizationConfiguration: int
  }

  /// One ticket's record.
  type Ticket = {
    phase: Phase,
    // WHAT THE RELEASE FROZE (above), immutable after it and read by every
    // decider that asks what this ticket IS, where the package carries the
    // same record on its own ReleasedTicket.
    // The dependencies are acyclic by construction (domain.qnt depsAcyclic)
    // and project-local, because TicketGraph is project-scoped.
    definition: ReleasedTicket,
    // THE SOURCE THIS TICKET'S WORK RUNS AT — opaque, positive once the
    // ticket has been dispatched and 0 before (domain.qnt sourcePinned),
    // where the package hangs the same value off WorkExecution, its three
    // escalations, FinalizationOperation and EvaluationInput.
    // The dispatch observes one and a passed work result replaces it with
    // the source that result was accepted at; a rework, a resume and the
    // finalizer run at what the ticket already carries, because a spawn
    // that observed a source of its own could run against one nobody
    // accepted.
    source: int,
    // The artifact this ticket has produced, if it has passed work (design
    // 002). Set at work-passed and superseded by each rework's product.
    artifact: ArtifactMark,
    // The LIVE WORK task, alone: one task while the ticket is in Work and
    // nothing in any other phase. Evaluation carries no set here — its
    // instance owes the tasks and currentTaskObligations names them.
    tasks: Set[Task],
    // THE EVALUATION INSTANCES — one per work cycle that reached judgement,
    // in the order those cycles ran, each holding the plan it ran under, the
    // artifact it judged, its completed stage runs and the run it stopped
    // at. Appended when work passes (domain.qnt decideWorkReduce) and
    // advanced in place while the ticket judges; the LAST one is the current
    // one exactly while the ticket is in Evaluation or parked at the blocked
    // wall, and an earlier one never changes again (domain.qnt
    // evaluationsMonotone).
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
    // from, and the artifact number is drawn from it. Held against what the
    // instances themselves say by the identity-accounting invariant
    // (domain.qnt idsAccounted).
    spawned: int,
    // The wall this ticket is parked at (NoEscalation unless Escalated).
    // Deliberately FIRST-CLASS stored trace vocabulary, not derived from
    // phase: with one parked phase, the wall is what tells the desk what it
    // is looking at. Where a retry resumes is derived from it (resumeOf).
    escalation: Escalation,
    // GHOST: completion effects ever emitted for this ticket — the counter the
    // effect-exclusivity invariant (exactly one completion) reads.
    // Not implementation state.
    completions: int
  }

  /// Standing rule 3 (derive, don't store): the open-human-task flag IS a
  /// predicate over the phase — a desk task is open exactly while the ticket
  /// is parked on the desk, and Escalated is THE parked phase.
  /// (storing the flag would need the iff proved as an invariant; deriving
  /// it makes the invariant hold by construction.) The trace-visible
  /// artifact is the "OpenHumanTask" effect string.
  ///
  /// Revoked is deliberately NOT here: revocation is the author's
  /// settled choice — the desk owes a revoked ticket nothing, exactly like
  /// Done. A dependent behind a Revoked dep gets no desk task through that
  /// dep either: it stays Pending, waiting on a dependency that will never
  /// be Done, and its author settles it by revoking it too.
  pure def hasOpenHumanTask(ticket: Ticket): bool = ticket.phase == Escalated

  /// The machine's observed state, as the pure deciders see it. A record
  /// (not a bare map) so the ticket-source shape stays open.  attached
  /// authoring here with no widening needed after all — tickets RELEASE by
  /// growing the map's sparse, never-reused id domain through the
  /// `freshTicket` seam, and no decider needed surgery. The shape that
  /// grew is the Ticket record (the plan, the instances), not TicketGraph.
  type TicketGraph = { tickets: int -> Ticket }

  /// One observed ticket-phase transition, golden-trace shaped (standing rule
  /// 4: conformance from day one — the model emits, the implementation
  /// replays). from == to is a REAL row, not a degenerate one — the
  /// stage advance is Evaluation -> Evaluation.
  type Transition = { ticket: int, from: Phase, to: Phase }

  /// One decision's observable record, mirroring the golden-trace step
  /// schema. Infrastructure request and permit identities live in the
  /// journal cause envelope rather than domain state or this record.
  type StepRecord = {
    label: str,
    transitions: List[Transition],
    effects: List[str]
  }

  /// What a pure decider returns: record performed + post-state.
  type Decision = { rec: StepRecord, post: TicketGraph }

  // === Vocabulary helpers (task plumbing shared by machine and tests) ======

  /// How much of the live set has yet to resolve. A work set with none
  /// outstanding is what makes the cycle reducible (domain.qnt
  /// reducibleWorkIn).
  pure def outstandingCount(tasks: Set[Task]): int =
    tasks.filter(t => t.state == Outstanding).size()

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
  /// owes exactly this, and a produced work report is admitted only when it
  /// carries the same record (reportMatchesTask).
  pure def workTaskObligation(ticket: Ticket, cycleNumber: int): TaskObligation = {
    task: workTaskOf(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    contextRef: cycleNumber
  }

  /// AN OPAQUE POSITIVE REFERENCE derived from a task's own identity, where
  /// the real system has a stored row — a validated result, a piece of
  /// failure evidence. The machine's only claim on such a reference is
  /// that it exists and is distinct per evaluator within a run, which is the
  /// discrimination a run's statuses need.
  pure def taskRefOf(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// THE WORK SPAWN: a work cycle is one task, always — work is not staged
  /// and lists no evaluators, so the only parallelism in this machine is an
  /// evaluation stage's roster. Named once here because every work spawn site
  /// (dispatch, both reworks, the work resume) is this call, and starting the
  /// cycle is the only thing that moves the counter its identity is drawn
  /// from. The mint counter claims the one slot the task takes.
  pure def spawnWork(ticket: Ticket): Ticket =
    val cycle = ticket.workCyclesStarted + 1
    { ...ticket,
      tasks: Set({ identity: workTaskOf(ticket.definition.id, cycle),
        state: Outstanding }),
      workCyclesStarted: cycle,
      spawned: ticket.spawned + 1 }

  /// Retire the live work task: a phase that has stopped running carries no
  /// live task, and a task still outstanding when its ticket parks or is
  /// revoked is one the world is told to cancel (domain.qnt's
  /// "CancelTicketWork"). Evaluation needs no retirement at all — its
  /// obligations are derived from the current run, so leaving the phase stops
  /// them being owed.
  pure def retireLive(ticket: Ticket): Ticket = { ...ticket, tasks: Set() }

  /// First write wins: resolve the task `task` names if it is still
  /// outstanding; the
  /// caller (decideTaskDone) treats an already-resolved task as a duplicate
  /// delivery and changes nothing — the idempotence an at-least-once
  /// fabric demands. The explicit
  /// lifecycle makes the finality structural: Outstanding -> Resolved(out)
  /// is the only edge, and nothing maps a Resolved back.
  pure def resolveTask(tasks: Set[Task], task: TaskIdentity, out: TaskOutcome): Set[Task] =
    tasks.map(t =>
      if (t.identity == task and t.state == Outstanding) { ...t, state: Resolved(out) }
      else t)

  /// DID THE WORK CYCLE PRODUCE? Work is one task, so the cycle's outcome is
  /// that task's. Named rather than inlined because the reduce and the tests
  /// read the same predicate.
  pure def workProduced(tasks: Set[Task]): bool =
    tasks.forall(t => t.state == Resolved(Passed))

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
  /// and are deliberately not named: an earlier generation's completion is
  /// stale, and staleness is absorbed by identity (domain.qnt
  /// decideTaskDone) without the machine having to enumerate it.
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

  /// WORK PASSED, SO JUDGEMENT BEGINS: the artifact the cycle produced is
  /// the mint counter's current value, the instance is opened over it with
  /// the released plan and the source the work result was accepted at, and
  /// its first stage is asked. One instance per work cycle that gets this
  /// far. The instance's acceptedSourceRef is the ticket's own — the
  /// completion that carried it put it there, and nothing observes a second.
  pure def beginEvaluation(ticket: Ticket): Ticket =
    val artifactRef = ticket.spawned
    spawnEvalRun({ ...ticket,
      artifact: ProducedArtifact(artifactRef),
      evaluations: ticket.evaluations.append(begin(
        ticket.workCyclesStarted,
        { ticket: ticket.definition.id, workResult: artifactRef,
          acceptedSourceRef: ticket.source },
        ticket.definition.evaluationPlan)) })

  /// IS THE INSTANCE PARKED ON A WALL? The blocked state is the one the
  /// desk reads, and the desk's own wall is held equal to it (domain.qnt
  /// evaluationsWellFormed).
  pure def instanceBlocked(evaluation: EvaluationInstance): bool =
    match evaluation.state {
      | EvaluationBlocked(_) => true
      | _ => false
    }

  /// WHAT THE FABRIC IS RUNNING FOR THIS TICKET, as the OBLIGATIONS it owes:
  /// the work cycle's one obligation while its task is outstanding, or the
  /// ones the current run still owes (evaluation.qnt currentTaskObligations).
  /// Empty in every other phase, which is what makes leaving a phase enough
  /// to stop owing them.
  ///
  /// The whole obligation and not the identity alone, because that is what a
  /// produced report is held against: a report carrying the right task under
  /// the wrong definition or the wrong context is a report for a spawn this
  /// ticket never made.
  pure def liveObligations(ticket: Ticket): List[TaskObligation] =
    if (ticket.phase == Work)
      if (outstandingCount(ticket.tasks) > 0)
        [workTaskObligation(ticket, ticket.workCyclesStarted)]
      else []
    else if (ticket.phase == Evaluation)
      currentTaskObligations(currentInstance(ticket))
    else []

  /// THE TASKS THE FABRIC IS RUNNING FOR THIS TICKET — the identities the
  /// obligations above name.
  pure def liveTasks(ticket: Ticket): Set[TaskIdentity] =
    liveObligations(ticket).foldl(Set(), (found, owed) =>
      found.union(Set(owed.task)))

  /// THE EXACT-OBLIGATION RULE: an obligation is current for a task when it
  /// names that task AND is, field for field, one this ticket owes right now.
  /// Naming an owed task is not enough — the definition and the context
  /// reference are what say which spawn the result answers.
  pure def obligationCurrent(
      ticket: Ticket, task: TaskIdentity, obligation: TaskObligation): bool =
    obligation.task == task and
      liveObligations(ticket).select(owed => owed == obligation).length() > 0

  /// WHICH REPORTS A TASK CAN CARRY: a work task produces a work result, an
  /// evaluator produces a verdict, and either can fail to produce anything —
  /// and a produced one is admitted only at the obligation it was spawned
  /// under. A failure matches by identity alone: it carries no result, so
  /// there is no obligation on it to compare. Stated here because it is the
  /// completion's enablement (refinement.qnt decisionEventEnabled) rather
  /// than something a decider defends against mid-flight.
  pure def reportMatchesTask(
      ticket: Ticket, task: TaskIdentity,
      report: TaskTerminalReport): bool =
    match report {
      | WorkResultReport(produced) =>
        match task {
          | WorkTask(_) =>
            obligationCurrent(ticket, task, produced.result.obligation)
          | EvaluationTask(_) => false
        }
      | EvaluationResultReport(produced) =>
        match task {
          | WorkTask(_) => false
          | EvaluationTask(_) =>
            obligationCurrent(ticket, task, produced.result.obligation)
        }
      | TerminalFailureReport(_) => true
    }

  /// WHAT A LIVE TASK'S RESULT LOOKS LIKE TO THE MACHINE: the obligation this
  /// ticket owes for it, and a reference derived from the task's own
  /// identity where the real system has a stored row. The machine's only
  /// claim on the reference is that it exists and tells one evaluator's
  /// result from another's within a run. Callers draw the task from
  /// liveTasks, which is what makes the obligation there to find.
  pure def producedResult(
      ticket: Ticket, task: TaskIdentity): ValidatedTaskResult =
    { obligation: liveObligations(ticket).select(owed => owed.task == task)[0],
      resultRef: taskRefOf(task) }
}
