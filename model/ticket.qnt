/// WHAT CHUGGY KEEPS ABOUT A TICKET beside the package's record, and the
/// task plumbing the machine and its tests share.
///
/// Nothing here reads a const: domain.qnt is the machine, refinement.qnt is
/// one runtime shape for it, and both are pure functions of the package's
/// `TicketGraph`.
///
/// THE TICKET ITSELF IS THE PACKAGE'S, imported from its vendored
/// `ticket-domain/ticket.qnt` (model/AGENTS.md). Chuggy states no definition
/// of its own under a name the package defines.
///
/// WHAT CHUGGY ADDS is what the package's ticket forgets and chuggy still
/// reads: the LEDGER beside each ticket (the instances that have closed, the
/// mint counter, the completion ghost), the resume point the desk offers, the
/// artifact a dependent reads, and the model-scope references the walks draw
/// from. None of it is read by `decide` or moved by `evolve`.
///
/// Sum-type constructors share one namespace per module, which is what the
/// prefixed names below are avoiding.
module chuggy_ticket {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "./ticket-domain/ticket"

  // === The desk and the projection ========================================

  /// Where an operator Retry resumes a parked ticket. DERIVED from the wall
  /// (resumeOf below), never stored: a resume point beside the wall that
  /// implies it is a stored duplicate of a derivable fact (standing rule 3).
  /// NoResume belongs to the unparked ticket, which has nothing to offer the
  /// desk.
  ///
  /// ResumeRework is the evaluation-failure wall's: that wall is reached by a
  /// VERDICT, and a verdict has no re-judge to offer, so the only honest way
  /// on is a new artifact, which is a work cycle. ResumeEvaluation is the
  /// blocked wall's, and it is the one resume that re-asks rather than
  /// re-works.
  type Resume =
    NoResume | ResumeWork | ResumeRework | ResumeEvaluation |
    ResumeFinalization

  /// WHERE EACH WALL RESUMES, total on the state, so every park offers the
  /// desk exactly one way on and every other state offers none. The two work
  /// walls share ResumeWork and the evaluation-failure wall takes
  /// ResumeRework: all three buy a new artifact, and only the names of the
  /// walls they answer differ.
  pure def resumeOf(state: TicketState): Resume = match state {
    | Escalated(escalation) => match escalation {
        | WorkFailureEscalated(_) => ResumeWork
        | WorkExecutionUnavailableEscalated(_) => ResumeWork
        | EvaluationFailureEscalated(_) => ResumeRework
        | EvaluationBlockedEscalated(_) => ResumeEvaluation
        | FinalizationUnavailableEscalated(_) => ResumeFinalization
      }
    | _ => NoResume
  }

  /// Standing rule 3 (derive, don't store): a desk task is open exactly while
  /// the ticket is parked, and Escalated is THE parked state. Revoked is
  /// deliberately not here: revocation is the author's settled choice, and
  /// the desk owes a revoked ticket nothing, exactly like Done.
  pure def hasOpenHumanTask(ticket: Ticket): bool = isEscalated(ticket.state)

  /// WHAT A TICKET PRODUCED (design 002): an opaque identity for the thing
  /// work built, that evaluation judged, and that wrap-up commits. Its only
  /// modelled property is DISTINCTNESS — never content. It exists so a
  /// dependent can NAME what its dependency produced. DERIVED (artifactOf),
  /// never stored.
  type ArtifactMark = NoArtifact | ProducedArtifact(int)

  /// THE MACHINE'S LAST DECISION, as the golden traces record it: none before
  /// the first, and after it the last one taken — an accepted command's
  /// event and obligations, or a refused command's refusal.
  type LastDecision =
    NoDecision
    | Decided(SuccessfulTicketDecision)
    | Refused(TicketRefusal)

  // === The ledger ==========================================================

  /// WHAT THE PACKAGE'S TICKET FORGETS AND CHUGGY STILL READS, one per ticket
  /// beside the graph. `decide` never reads it and `evolve` never moves it:
  /// domain.qnt ledgerStep folds it from the ticket before an event, the
  /// event, and the ledger before, so a replay folds graph and ledger from the
  /// same rows and nothing is derived from a journal at read time.
  ///
  /// It keeps the instances that have CLOSED and not the open one, because
  /// the open one is already on the ticket's state (Evaluation, or the
  /// blocked wall), and a second copy of it here would be a stored duplicate
  /// (standing rule 3). An instance closes when the ticket leaves it: on a
  /// pass, on a failure either way, and on a revoke, and it never changes
  /// again. What reads the closed ones: the rework cap (a failed judgement
  /// that bought a later cycle), the artifact a Done ticket committed, and
  /// the identity accounting.
  ///
  /// `spawned` is THE MINT COUNTER: how many task slots this ticket has ever
  /// claimed. A work spawn claims one; an evaluation spawn claims one per
  /// evaluator the run LISTS, whether this generation asks all of them or
  /// only the ones a resume reopened. It is monotone and never reused, which
  /// is what an implementation mints an external task number from, and it is
  /// held against the instances by the identity-accounting invariant
  /// (domain.qnt idsAccounted).
  ///
  /// `completions` is a GHOST: finalization successes ever applied to this
  /// ticket, the counter the exactly-one-completion invariant reads. Not
  /// implementation state.
  type TicketLedger = {
    closedEvaluations: List[EvaluationInstance],
    spawned: int,
    completions: int
  }

  /// A released ticket's ledger: nothing judged, nothing claimed.
  pure val emptyLedger: TicketLedger =
    { closedEvaluations: [], spawned: 0, completions: 0 }

  /// THE INSTANCE A STATE HOLDS OPEN: the one judging, or the one the
  /// blocked wall saved. At most one; every other state holds none.
  pure def heldInstances(state: TicketState): List[EvaluationInstance] =
    match state {
      | Evaluation(evaluation) => [evaluation]
      | Escalated(escalation) => match escalation {
          | EvaluationBlockedEscalated(saved) => [saved]
          | _ => []
        }
      | _ => []
    }

  /// EVERY INSTANCE THIS TICKET HAS OPENED, in the order its cycles ran: the
  /// closed ones, then the open one if there is one.
  pure def ledgerInstances(
      ticket: Ticket, ledger: TicketLedger): List[EvaluationInstance] =
    ledger.closedEvaluations.concat(heldInstances(ticket.state))

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
  /// now stand at. The generations a resume left behind are deliberately not
  /// named: an event about an earlier generation's task is one nothing owes.
  pure def instanceTasks(evaluation: EvaluationInstance): Set[TaskIdentity] =
    instanceRuns(evaluation).foldl(Set(), (found, progress) =>
      found.union(progress.evaluators.keys().map(evaluator =>
        taskIdentityFor(evaluation, progress, evaluator))))

  /// THE SLOTS A RUN CLAIMED: its roster once per generation it has reached.
  /// A resume re-asks only the evaluators it reopened but claims the roster
  /// again, which is what makes the count a function of the run alone.
  pure def runSpawnTotal(progress: StageRun): int =
    progress.generation * progress.evaluators.keys().size()

  /// THE SLOTS A LIST OF INSTANCES CLAIMED — the evaluation half of the mint
  /// counter, derived from the instances (domain.qnt idsAccounted holds the
  /// two equal).
  pure def evaluationSpawnTotal(instances: List[EvaluationInstance]): int =
    instances.foldl(0, (total, evaluation) =>
      total + instanceRuns(evaluation).foldl(0, (n, progress) =>
        n + runSpawnTotal(progress)))

  /// IS THE INSTANCE PARKED ON A WALL?
  pure def instanceBlocked(evaluation: EvaluationInstance): bool =
    match evaluation.state {
      | EvaluationBlocked(_) => true
      | _ => false
    }

  /// WHAT THIS TICKET PRODUCED, derived: the accepted work result the latest
  /// instance judges, and nothing before any work was accepted. Each
  /// accepted result opens an instance over itself, so a rework's
  /// supersedes the one before it, and a Done ticket's is the one its
  /// finalization committed.
  pure def artifactOf(ticket: Ticket, ledger: TicketLedger): ArtifactMark =
    val instances = ledgerInstances(ticket, ledger)
    if (instances.length() == 0) NoArtifact
    else ProducedArtifact(instances[instances.length() - 1].input.workResult)

  // === Model-scope references and the corpus's constructors ===============

  /// AN OPAQUE POSITIVE REFERENCE derived from a task's own identity, where
  /// the real system has a stored row — a piece of failure evidence. The
  /// machine's only claim on such a reference is that it exists and is
  /// distinct per evaluator within a run.
  pure def taskRefOf(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// The band a work result's model-scope reference is drawn in.
  pure val workResultBand: int = 100

  /// WHAT A PRODUCED RESULT'S REFERENCE IS AT MODEL SCOPE, where the real
  /// system folds the digest of the manifest the task attested. A WORK
  /// result takes a band of its own, clear of the cycle that produced it, so
  /// no reader mistakes a derivation for the number that travelled. An
  /// evaluator's is its own key.
  pure def producedResultRef(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => workResultBand * work.ticket + work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// WHAT THE FABRIC IS RUNNING FOR THIS TICKET, as the OBLIGATIONS it owes:
  /// the work cycle's one obligation while the ticket is in Work, or the ones
  /// the current run still owes. Empty in every other state. The whole
  /// obligation and not the identity alone, because that is what a produced
  /// report is held against.
  pure def liveObligations(ticket: Ticket): List[TaskObligation] =
    match ticket.state {
      | Work(work) => [workTaskObligation(ticket, ticket.workCyclesStarted,
          work.source, work.input)]
      | Evaluation(evaluation) => currentTaskObligations(evaluation)
      | _ => []
    }

  /// The same identities as a set, which is what the actions draw from.
  pure def liveTasks(ticket: Ticket): Set[TaskIdentity] =
    liveObligations(ticket).foldl(Set(), (found, owed) =>
      found.union(Set(owed.task)))

  /// WHAT A LIVE TASK'S RESULT LOOKS LIKE TO THE MACHINE: the obligation this
  /// ticket owes for it, and the reference producedResultRef derives. This
  /// is the CORPUS's constructor — callers draw the task from liveTasks —
  /// and the only place a result reference is derived at all: every decider
  /// takes the one its report carried.
  pure def producedResult(
      ticket: Ticket, task: TaskIdentity): ValidatedTaskResult =
    { obligation: liveObligations(ticket).select(owed => owed.task == task)[0],
      resultRef: producedResultRef(task) }
}
