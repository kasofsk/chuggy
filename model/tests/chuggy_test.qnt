/// Pure decider and evolve tests for direct ticket release, sparse
/// project-local identity, immutable ticket policy, the evaluation instance,
/// revoke, evaluator walls and their resume, the finalization protocol, and
/// the events a state no longer owes.
module chuggy_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"

  // The reference instance. Plans up to 2 stages, so the
  // plan-as-data tests below get a staged plan and a flat one out of
  // ONE instance (which is the point).
  import chuggy_domain(
    N_TICKETS = 2, N_TASKS = 2, MAX_STAGES = 2
  ) as D from "../domain"

  // Task literals for TICKET 1, which every task-carrying fixture below is.
  // An eval literal names the work cycle it judges, the 0-based stage INDEX
  // — the key the identity carries is its position — and the evaluator's
  // authored key; the one taking a GENERATION is for the edge that asks a
  // stage twice in a cycle (the blocked resume).

  pure def workOf(cycle: int): TaskIdentity = workTaskOf(1, cycle)
  pure def evalOfRun(cycle: int, s: int, generation: int, e: int): TaskIdentity =
    evaluatorTaskIdentity(1, cycle, s + 1, generation, e)
  pure def evalOf(cycle: int, s: int, e: int): TaskIdentity =
    evalOfRun(cycle, s, 1, e)

  // THE TWO SOURCES a fixture uses: one the dispatch observes, one a work
  // result is accepted at. Their sets are disjoint by construction
  // (domain.qnt), so which of the two a ticket carries says whether it has
  // been told a work result's source or has only ever been dispatched.
  pure val srcDispatch: int = D::aDispatchSource
  pure val srcAccepted: int = D::anAcceptedSource
  pure val evidence: int = D::aFinalizationEvidence

  /// ONE DECISION, TAKEN: the event and the obligations the decider
  /// returned, and the state evolve takes the graph it was decided at to —
  /// or, for a refused command, the refusal's name and the graph unmoved.
  /// A refused step's event is a placeholder nothing reads: `named` answers
  /// with the refusal instead.
  type Stepped = {
    event: TicketEvent,
    obligations: List[Obligation],
    post: TicketGraph,
    refusal: str
  }
  pure def stepped(c: TicketGraph, d: TicketDecision): Stepped = match d {
    | TicketDecided(s) => { event: s.event, obligations: s.obligations,
        post: D::evolve(c, s.event), refusal: "" }
    | TicketRefused(reason) => { event: TicketRevoked(0), obligations: [],
        post: c, refusal: D::refusalName(reason) }
  }
  pure def named(s: Stepped): str =
    if (s.refusal != "") s.refusal else D::eventName(s.event)

  /// What a step owes, read back: the tasks it asks the fabric to run and
  /// the kind of every obligation, in order.
  pure def executed(s: Stepped): Set[TaskIdentity] =
    s.obligations.foldl(Set(), (found, o) => match o {
      | ExecuteTask(execution) => found.union(Set(execution.task.task))
      | _ => found })
  pure def kinds(s: Stepped): List[str] =
    s.obligations.foldl([], (found, o) => found.append(match o {
      | ExecuteTask(_) => "ExecuteTask"
      | FinalizeTicket(_) => "FinalizeTicket"
      | CancelTask(_) => "CancelTask" }))

  // WHAT A COMPLETION CAN CARRY. A produced report carries the obligation
  // the ticket owes for the task (ticket.qnt producedResult) — the only one
  // the completion accepts — under a result reference the machine derives
  // from the task's own identity. Every report names the task's own ticket.
  pure def died(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ ticket: taskOwner(task),
      failure: { task: task, evidence: taskRefOf(task) }, kind: ProcessFailure })
  pure def walled(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ ticket: taskOwner(task),
      failure: { task: task, evidence: taskRefOf(task) },
      kind: ExecutionUnavailableFailure })

  /// A completion at a named disposition — the failing stage's choice is an
  /// input to the decision, so every call site says which edge it is asking
  /// for. `done` asks for the rework edge, which every completion that does
  /// not conclude a failing stage ignores. The ticket and the task are the
  /// report's own; a call site names them so it reads as the delivery it is.
  pure def doneAt(c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport, d: EvaluationFailureDisposition): Stepped =
    stepped(c, D::decide(c, ReportTaskTerminal(report), _ => d))
  pure def done(c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport): Stepped =
    doneAt(c, j, task, report, ReworkEvaluationFailure)

  /// A WORK COMPLETION that produced, at the obligation the ticket owes and
  /// the source the application accepted it at.
  pure def doneProduced(c: TicketGraph, j: int, task: TaskIdentity): Stepped =
    done(c, j, task, WorkResultReport({ ticket: j,
      result: producedResult(c.tickets.get(j), task),
      acceptedSourceRef: srcAccepted }))

  /// AN EVALUATOR'S VERDICT, at the obligation the running stage owes it.
  pure def judgedReport(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict): TaskTerminalReport =
    EvaluationResultReport({ ticket: j,
      result: producedResult(c.tickets.get(j), task), verdict: v })
  pure def doneJudgedAt(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict, d: EvaluationFailureDisposition): Stepped =
    doneAt(c, j, task, judgedReport(c, j, task, v), d)
  pure def doneJudged(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict): Stepped =
    doneJudgedAt(c, j, task, v, ReworkEvaluationFailure)

  /// A VERDICT NOTHING IS OWED — the stale and duplicate deliveries. The
  /// ticket has no obligation for the task to read, so the builder states
  /// the one the task was spawned under.
  pure def staleVerdict(task: TaskIdentity, v: EvaluationVerdict): TaskTerminalReport =
    EvaluationResultReport({ ticket: taskOwner(task),
      result: { obligation: { task: task, definition: D::evaluatorTaskOf(1),
                              contextRef: 101 },
                resultRef: taskRefOf(task) },
      verdict: v })

  /// The finalizer's result for the attempt ticket j is on.
  pure def finalized(c: TicketGraph, j: int, result: FinalizationResult): Stepped =
    stepped(c, D::decideFinalizationResult(c, { ticket: j,
      workCycle: c.tickets.get(j).workCyclesStarted,
      generation: c.tickets.get(j).finalizationGeneration, result: result }))
  pure def resumed(c: TicketGraph, j: int): Stepped =
    stepped(c, D::decideResume(c, j))
  pure def dispatched(c: TicketGraph, j: int): Stepped =
    stepped(c, D::decideDispatch(c, { ticket: j, source: srcDispatch }))

  // Reading an instance back: the run a ticket's judgement stands at, and
  // the status one evaluator holds in it.
  pure def currentRun(j: Ticket): StageRun =
    match currentInstance(j).state {
      | Running(progress) => progress.stage
      | EvaluationBlocked(progress) => progress.stage
      | EvaluationPassed(stages) => stages[stages.length() - 1]
      | EvaluationFailed(stages) => stages[stages.length() - 1]
    }
  pure def statusOf(j: Ticket, evaluator: int): EvaluatorStatus =
    currentRun(j).evaluators.get(evaluator)
  pure def passedWith(ref: int): EvaluatorStatus = Produced(EvaluatorPassed(ref))
  pure def failedWith(ref: int): EvaluatorStatus = Produced(EvaluatorFailed(ref))

  // A HAND-BUILT FIXTURE STATES ITS OWN `spawned`. The mint counter
  // (ticket.qnt Ticket.spawned) is bumped only by a spawn site, so a fixture
  // that hands itself a work cycle and leaves freshTicket's 0 in place
  // breaks domain.qnt's idsAccounted, which makes it a state the machine
  // cannot reach. Every fixture below that gives itself history carries
  // the matching count, and handBuiltFixturesAccountedTest (bottom of this
  // file) is what keeps the next one honest. Every EVALUATION and
  // FINALIZATION fixture is built by the deciders instead, which is also the
  // only honest way to get a well-formed instance.

  // Plans used throughout. planU2 is exactly D::defaultPlan — the
  // unanimous single-stage default, which is the compatibility shape: a
  // ticket whose evaluators all share one stage judges in one roster.
  pure val planU2: List[StageDefinition] =
    [{ key: 1, evaluators: [D::evaluatorOf(1), D::evaluatorOf(2)] }]
  pure val planStaged: List[StageDefinition] =
    [{ key: 1, evaluators: [D::evaluatorOf(1)] },
     { key: 2, evaluators: [D::evaluatorOf(1), D::evaluatorOf(2)] }]

  // A SPARSE STAGE: one evaluator, authored under key 2, with no key 1 in
  // the roster. Every site that once counted a width from one would drop
  // this stage's only task.
  pure val planSparse: List[StageDefinition] =
    [{ key: 1, evaluators: [D::evaluatorOf(2)] }]

  // Test constructors mirror released ticket contracts while keeping
  // fixtures readable.
  pure def fresh(j: int, dependencies: Set[int], stages: List[StageDefinition]): Ticket =
    D::freshTicket(D::releasedTicketOf(j, dependencies, stages))

  pure def release(c: TicketGraph, j: int, dependencies: Set[int], stages: List[StageDefinition]): Stepped =
    stepped(c, D::decideCreate(c, D::releasedTicketOf(j, dependencies, stages)))

  run defaultPlanIsUnanimousSingleStageTest = assert(and {
    D::defaultPlan == planU2,
    D::validPlans.contains(D::defaultPlan)
  })

  /// validPlans IS the plan half of the release-refusal rule (a definition
  /// carrying any other plan is refused): the ill-formed shapes are simply
  /// not authorable. A stage is a ROSTER of keys, so the reference instance
  /// offers one stage choice per non-empty roster and every plan of at
  /// most MAX_STAGES of them, each stage keyed by its position.
  run validPlansRefusalTest = assert(and {
    D::validPlans.contains(planU2),
    D::validPlans.contains(planStaged),
    D::validPlans.contains(planSparse),
    not(D::validPlans.contains([])),                          // empty plan
    not(D::validPlans.contains(                               // empty roster
      [{ key: 1, evaluators: [] }])),
    not(D::validPlans.contains(                               // key > N_TASKS
      [{ key: 1, evaluators: [D::evaluatorOf(3)] }])),
    not(D::validPlans.contains(                               // repeated key
      [{ key: 1, evaluators: [D::evaluatorOf(1), D::evaluatorOf(1)] }])),
    not(D::validPlans.contains(                               // stage key off its position
      [{ key: 2, evaluators: [D::evaluatorOf(1)] }])),
    not(D::validPlans.contains([                              // length > MAX_STAGES
      { key: 1, evaluators: [D::evaluatorOf(1)] },
      { key: 2, evaluators: [D::evaluatorOf(1)] },
      { key: 3, evaluators: [D::evaluatorOf(1)] }])),
    D::validPlans.size() ==
      D::stageChoices.size() + D::stageChoices.size() * D::stageChoices.size()
  })

  /// EVERY AUTHORABLE PLAN IS ONE THE PROTOCOL ACCEPTS: chuggy's release
  /// rule is the package's planValid plus chuggy's bounds, so an authorable
  /// plan can never open an instance the protocol's own invariant refuses.
  run validPlansAreProtocolPlansTest = assert(
    D::validPlans.forall(stages => planValid({ stages: stages })))

  /// A SPARSE STAGE SURVIVES ITS OWN LIFECYCLE. The stage lists key 2 alone:
  /// the accepted work owes that key and no other, the completion settles
  /// it, and the stage concludes — the sites that once walked 1..width would
  /// have asked key 1, matched nothing, and concluded nothing.
  pure val cSparse0: TicketGraph =
    release(cEmpty, 1, Set(), planSparse).post
  pure val cSparse1: TicketGraph = dispatched(cSparse0, 1).post
  pure val dSparseAccepted = doneProduced(cSparse1, 1, workOf(1))
  pure val cSparse3: TicketGraph = dSparseAccepted.post
  pure val dSparseJudged =
    doneJudged(cSparse3, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cSparse4: TicketGraph = dSparseJudged.post

  run sparseStageAskedSettledAndConcludedTest = assert(and {
    executed(dSparseAccepted) == Set(evalOf(1, 0, 2)),
    liveTasks(cSparse3.tickets.get(1)) == Set(evalOf(1, 0, 2)),
    currentRun(cSparse3.tickets.get(1)).evaluators.keys() == Set(2),
    named(dSparseJudged) == "TicketEvaluationPassed",
    statusOf(cSparse4.tickets.get(1), 2) == passedWith(2),
    liveTasks(cSparse4.tickets.get(1)) == Set(),
    cSparse4.tickets.get(1).phase == Finalization,
    cSparse4.tickets.get(1).spawned == 2
  })

  // === The happy path, decision by decision ================================
  // The path STARTS at authoring — the fleet is empty, ticket 1 is released
  // as a Pending (freshTicket seam); ticket 3 is released as a Pending
  // depending on 1 and stays unreleased throughout. ticket 1 carries
  // the DEFAULT plan, so its history is one work cycle and that cycle's
  // stage-0 roster of two evaluators.

  pure val cEmpty: TicketGraph = { tickets: Map() }
  pure val dRelease = release(cEmpty, 1, Set(), D::defaultPlan)
  pure val cA1 = dRelease.post
  pure val dReleaseDependent = release(cA1, 3, Set(1), D::defaultPlan)
  pure val cA2 = dReleaseDependent.post

  pure val c0: TicketGraph = cA2
  pure val dDispatch = dispatched(c0, 1)   // owes cycle 1's work task
  pure val c1 = dDispatch.post
  // the work is ACCEPTED: the instance opens and stage 0's roster is owed,
  // in the one decision the completion is
  pure val dWork1 = doneProduced(c1, 1, workOf(1))
  pure val c3 = dWork1.post
  pure val dEval1 = doneJudged(c3, 1, evalOf(1, 0, 1), EvaluatorPass)
  pure val c4 = dEval1.post
  // the second evaluator's pass CONCLUDES the only stage, so the plan
  // passed and the ticket finalizes in this same decision
  pure val dEval2 = doneJudged(c4, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val c5 = dEval2.post
  /// The finalizer succeeds and the ticket completes from Finalization.
  pure val dComplete = finalized(c5, 1, FinalizationSucceeded(evidence))
  pure val c6 = dComplete.post

  /// The events are the ones the anatomy says, and each owes exactly what
  /// the phase it lands in runs. A completion that leaves its stage still
  /// owing evaluators owes nothing new; the one that concludes it owes the
  /// finalizer.
  run happyPathEventsTest = assert(and {
    named(dRelease) == "TicketCreated",
    dRelease.obligations == [],
    named(dDispatch) == "TicketDispatched",
    dDispatch.event == TicketDispatched({ ticket: 1, source: srcDispatch }),
    dDispatch.obligations == [executeWork(c0.tickets.get(1), 1)],
    named(dWork1) == "TicketWorkResultAccepted",
    dWork1.obligations ==
      executeEvaluationTasks(1, currentInstance(c3.tickets.get(1))),
    executed(dWork1) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    named(dEval1) == "TicketEvaluationProgressed",
    dEval1.obligations == [],
    named(dEval2) == "TicketEvaluationPassed",
    dEval2.obligations == [FinalizeTicket({ ticket: 1,
      finalization: { workCycle: 1, generation: 1, input: 101,
        source: srcAccepted },
      configuration: c0.tickets.get(1).definition.finalizationConfiguration })],
    named(dComplete) == "TicketFinalizationSucceeded",
    dComplete.event == TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 1, evidence: evidence }),
    dComplete.obligations == [],
    // the phases each event lands in
    c1.tickets.get(1).phase == Work,
    c3.tickets.get(1).phase == Evaluation,
    c4.tickets.get(1).phase == Evaluation,
    c5.tickets.get(1).phase == Finalization,
    c6.tickets.get(1).phase == Done
  })

  /// EVERY DECISION ON THE PATH IS VALID where it was taken, and its event
  /// moves the state it was decided at (domain.qnt decisionsValid,
  /// eventsNeverIdentity) — pinned here on the exact decisions, where the
  /// machine checks them on every reachable one.
  run happyPathDecisionsValidTest = assert(and {
    D::decisionValid(cEmpty, D::decideCreate(cEmpty,
      D::releasedTicketOf(1, Set(), D::defaultPlan))),
    D::decisionValid(c0, D::decideDispatch(c0, { ticket: 1, source: srcDispatch })),
    c1 != c0, c3 != c1, c4 != c3, c5 != c4, c6 != c5,
    D::decisionValid(c1, TicketDecided({ event: dWork1.event, obligations: dWork1.obligations })),
    D::decisionValid(c3, TicketDecided({ event: dEval1.event, obligations: dEval1.obligations })),
    D::decisionValid(c4, TicketDecided({ event: dEval2.event, obligations: dEval2.obligations })),
    D::decisionValid(c5, TicketDecided({ event: dComplete.event,
      obligations: dComplete.obligations }))
  })

  /// A PASSING STAGE IGNORES THE DISPOSITION: it is consulted only where a
  /// completion concludes a FAILING stage, so the passing path is the same
  /// decision either way.
  run passingStageIgnoresDispositionTest = assert(
    doneJudgedAt(c4, 1, evalOf(1, 0, 2), EvaluatorPass, EscalateEvaluationFailure) == dEval2)

  /// THE INSTANCE IS THE PROVENANCE: at Done ticket 1 holds one instance,
  /// for the cycle that produced the artifact it judged, with its whole
  /// stage history and every evaluator's own outcome.
  run happyPathInstanceTest = assert(and {
    c6.tickets.get(1).evaluations.length() == 1,
    currentInstance(c6.tickets.get(1)).workCycle == 1,
    currentInstance(c6.tickets.get(1)).input ==
      { ticket: 1, workResult: 101, acceptedSourceRef: srcAccepted },
    currentInstance(c6.tickets.get(1)).plan == { stages: planU2 },
    currentInstance(c6.tickets.get(1)).state ==
      EvaluationPassed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> passedWith(1), 2 -> passedWith(2)) }]),
    liveTasks(c6.tickets.get(1)) == Set(),
    // Intermediate shape: the instance opens with the whole roster awaiting
    // and the work task no longer owed.
    liveTasks(c3.tickets.get(1)) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    // and one evaluator settling leaves the other owed.
    liveTasks(c4.tickets.get(1)) == Set(evalOf(1, 0, 2)),
    statusOf(c4.tickets.get(1), 1) == passedWith(1)
  })

  /// domain.qnt's idsAccounted, one ticket at a time — the same equality
  /// the machine invariant quantifies over liveTickets, usable on a fixture
  /// the machine never produced: the mint counter is one slot per work cycle
  /// plus what every run of every instance claimed.
  pure def accountedTicket(j: Ticket): bool =
    j.spawned == j.workCyclesStarted + evaluationSpawnTotal(j)

  /// The same, over a whole graph — every ticket, not just ticket 1: a
  /// multi-ticket fixture accounts for all of its ids or none of them.
  pure def accounted(c: TicketGraph): bool =
    c.tickets.keys().forall(j => accountedTicket(c.tickets.get(j)))

  /// IDENTITY ACCOUNTING along the fully decider-built happy path: the mint
  /// counter tracks every spawn and always equals what the ticket's own
  /// history claims. (The machine invariant checks it on every reachable
  /// state; this pins the counter's exact values.)
  run happyPathIdsAccountedTest = assert(and {
    cA1.tickets.get(1).spawned == 0,          // a Pending has claimed nothing
    c1.tickets.get(1).spawned == 1,           // the work task
    accounted(c1),
    c3.tickets.get(1).spawned == 3,           // + stage 0's roster of two
    accounted(c3),
    c6.tickets.get(1).spawned == 3,           // Done: nothing claimed since
    accounted(c6)
  })

  /// COMPLETION EXCLUSIVITY, happy path: exactly one completion, exactly at
  /// Done, and the success owes the world nothing.
  run completionExclusivityHappyPathTest = assert(and {
    c6.tickets.get(1).phase == Done,
    c6.tickets.get(1).completions == 1,
    dComplete.obligations == []
  })

  // === Events a state no longer owes fall through evolve ===================

  /// AN EVENT APPLIED TO A STATE THAT NO LONGER OWES IT IS THE IDENTITY
  /// (domain.qnt evolve). The machine never decides one — `decide` refuses
  /// the command first — so no trace carries it, and this is where it is
  /// pinned: a duplicate for a settled task, whatever it reports; a stale
  /// evaluator after the ticket left evaluation or after a resume moved the
  /// generation on; a finalization result for an attempt a resume
  /// superseded; a dispatch, an acceptance and a release a state has already
  /// moved past; and a work acceptance under an obligation the cycle never
  /// owed.
  pure def workFailedFact(task: TaskIdentity): TicketEvent =
    TicketWorkProcessFailed({ ticket: 1, task: task, evidence: 1 })
  pure def progressedFact(report: TaskTerminalReport): TicketEvent =
    TicketEvaluationProgressed({ ticket: 1, report: report })

  run eventsNotOwedAreIdentityTest = assert(and {
    // c3: the instance is open; cycle 1's work task is long settled.
    D::evolve(c3, workFailedFact(workOf(1))) == c3,
    D::evolve(c3, dWork1.event) == c3,
    // c4: evaluator 1 already judged — a contradicting verdict falls through
    D::evolve(c4, progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorFail))) == c4,
    D::evolve(c4, TicketEvaluationReworkStarted({ ticket: 1,
      report: staleVerdict(evalOf(1, 0, 1), EvaluatorFail),
      evidence: [{ evaluator: 1, resultRef: 1 }] })) == c4,
    // c5: Finalization; a late evaluator falls through
    D::evolve(c5, progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorFail))) == c5,
    D::evolve(c5, TicketEvaluationPassed({ ticket: 1,
      report: staleVerdict(evalOf(1, 0, 2), EvaluatorPass) })) == c5,
    // a finalization result for an attempt this ticket is not on
    D::evolve(c5, TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 2, evidence: evidence })) == c5,
    D::evolve(c5, TicketFinalizationNeedsWork({ ticket: 1, workCycle: 2,
      generation: 1, evidence: evidence })) == c5,
    // events whose phase the ticket has left
    D::evolve(c3, TicketDispatched({ ticket: 1, source: srcDispatch })) == c3,
    D::evolve(c6, TicketRevoked(1)) == c6,
    D::evolve(c1, TicketWorkResumed(1)) == c1,
    D::evolve(c1, TicketEvaluationResumed(1)) == c1,
    D::evolve(c1, TicketFinalizationResumed(1)) == c1,
    D::evolve(c1, TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 1, evidence: evidence })) == c1,
    // a release of a ticket that exists, and an event for one that does not
    D::evolve(c1, dRelease.event) == c1,
    D::evolve(c1, TicketRevoked(2)) == c1,
    // an acceptance under the wrong obligation: the right task, another
    // context
    D::evolve(c1, TicketWorkResultAccepted({ ticket: 1,
      result: { obligation: { ...workTaskObligation(c1.tickets.get(1), 1),
        contextRef: 2 }, resultRef: 101 },
      acceptedSourceRef: srcAccepted })) == c1
  })

  /// THE SAME, OVER EVERY TASK THE TICKET'S HISTORY NAMES: on every state
  /// this file walks, an event about any task the ticket has been owed and
  /// no longer is falls through.
  pure def notOwedFallsThrough(c: TicketGraph, j: int): bool =
    D::deliverableTasksIn(c, j).exclude(liveTasks(c.tickets.get(j)))
      .forall(task => and {
        D::evolve(c, TicketEvaluationProgressed({ ticket: j,
          report: died(task) })) == c,
        D::evolve(c, TicketEvaluationBlocked({ ticket: j,
          report: walled(task) })) == c,
        D::evolve(c, TicketWorkProcessFailed({ ticket: j, task: task,
          evidence: 1 })) == c
      })

  run everySettledTaskFallsThroughTest = assert(and {
    notOwedFallsThrough(c3, 1), notOwedFallsThrough(c4, 1),
    notOwedFallsThrough(c5, 1), notOwedFallsThrough(c6, 1),
    notOwedFallsThrough(cS1, 1), notOwedFallsThrough(cAfterShort, 1),
    notOwedFallsThrough(cBlockedResume, 1),
    notOwedFallsThrough(cReworkEval, 1)
  })

  // === The work walls: cycle-level, no below-cycle retries =================

  /// A work task that DIED parks the ticket at cycle level in the
  /// completion itself — there is no same-cycle retry branch to take:
  /// below-cycle retries are the fabric's trusted relaunch limit, and
  /// modeling them is a standing non-goal.
  pure val dWorkFail = done(c1, 1, workOf(1), died(workOf(1)))

  run workFailedWallTest = assert(and {
    named(dWorkFail) == "TicketWorkProcessFailed",
    dWorkFail.event == TicketWorkProcessFailed({ ticket: 1, task: workOf(1),
      evidence: 1 }),
    dWorkFail.obligations == [],
    dWorkFail.post.tickets.get(1).phase == Escalated,
    dWorkFail.post.tickets.get(1).escalation == WorkFailureEscalated,
    hasOpenHumanTask(dWorkFail.post.tickets.get(1)),
    liveTasks(dWorkFail.post.tickets.get(1)) == Set()
  })

  /// A WORK TASK'S WALL PARKS AT ONCE, in the completion itself: a work
  /// cycle is one task, so there is no sibling left to wait for. It is the
  /// OTHER wall from the failed cycle above, because an interruption is not
  /// a verdict.
  pure val dWorkWall = done(c1, 1, workOf(1), walled(workOf(1)))

  run workExecutionUnavailableWallTest = assert(and {
    named(dWorkWall) == "TicketWorkExecutionUnavailable",
    dWorkWall.obligations == [],
    dWorkWall.post.tickets.get(1).phase == Escalated,
    dWorkWall.post.tickets.get(1).escalation == WorkExecutionUnavailableEscalated,
    liveTasks(dWorkWall.post.tickets.get(1)) == Set(),
    // and its resume buys a new cycle, because a wall against work leaves
    // nothing judged to preserve.
    named(resumed(dWorkWall.post, 1)) == "TicketWorkResumed",
    executed(resumed(dWorkWall.post, 1)) == Set(workOf(2)),
    resumed(dWorkWall.post, 1).post.tickets.get(1).phase == Work,
    liveTasks(resumed(dWorkWall.post, 1).post.tickets.get(1)) == Set(workOf(2))
  })

  // === The failing evaluation's two edges ==================================

  /// ONE failing state, TWO decisions — which one is taken is the
  /// disposition and nothing else, and the event names it. Rework re-enters
  /// Work owing a fresh work task; Escalate parks the ticket at the
  /// evaluation-failure wall, whose resume re-enters Work later. Both carry
  /// the same evidence and keep the instance that failed.
  pure val cEvalFail: TicketGraph =
    doneJudged(c3, 1, evalOf(1, 0, 1), EvaluatorFail).post
  pure val dEvalRework = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, ReworkEvaluationFailure)
  pure val dEvalEscalate = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, EscalateEvaluationFailure)

  run evalFailureDispositionTest = assert(and {
    // one dissenter fails the stage even though the other evaluator passed
    named(dEvalRework) == "TicketEvaluationReworkStarted",
    dEvalRework.event == TicketEvaluationReworkStarted({ ticket: 1,
      report: judgedReport(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass),
      evidence: [{ evaluator: 1, resultRef: 1 }] }),
    dEvalRework.obligations == [executeWork(c0.tickets.get(1), 2)],
    dEvalRework.post.tickets.get(1).phase == Work,
    liveTasks(dEvalRework.post.tickets.get(1)) == Set(workOf(2)),
    // the failed instance is kept, whole, and a rework opens no second one
    // until its own cycle passes
    dEvalRework.post.tickets.get(1).evaluations.length() == 1,
    currentInstance(dEvalRework.post.tickets.get(1)).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1), 2 -> passedWith(2)) }]),

    named(dEvalEscalate) == "TicketEvaluationFailureEscalated",
    dEvalEscalate.event == TicketEvaluationFailureEscalated({ ticket: 1,
      report: judgedReport(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass),
      evidence: [{ evaluator: 1, resultRef: 1 }] }),
    dEvalEscalate.obligations == [],
    dEvalEscalate.post.tickets.get(1).phase == Escalated,
    dEvalEscalate.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    D::retryableIn(dEvalEscalate.post, 1),
    liveTasks(dEvalEscalate.post.tickets.get(1)) == Set(),
    currentInstance(dEvalEscalate.post.tickets.get(1)).state ==
      currentInstance(dEvalRework.post.tickets.get(1)).state
  })

  /// A SECOND CYCLE GETS A SECOND INSTANCE, and the first stays as it was:
  /// the instances are the ticket's judgement history, one per cycle that
  /// reached judgement.
  pure val cReworkEval: TicketGraph =
    doneProduced(dEvalRework.post, 1, workOf(2)).post

  run secondCycleOpensSecondInstanceTest = assert(and {
    cReworkEval.tickets.get(1).evaluations.length() == 2,
    cReworkEval.tickets.get(1).evaluations[0] ==
      dEvalRework.post.tickets.get(1).evaluations[0],
    currentInstance(cReworkEval.tickets.get(1)).workCycle == 2,
    liveTasks(cReworkEval.tickets.get(1)) ==
      Set(evalOf(2, 0, 1), evalOf(2, 0, 2)),
    accounted(cReworkEval)
  })

  // === THE STAGED PLAN, walked stage by stage ===========================
  // planStaged lists one evaluator at stage 0 and two at stage 1 on the
  // reference instance. The walk mirrors staged progression edge by edge;
  // the short-circuit mirrors the staged-eval short-circuit golden.

  pure val cStagedPend: TicketGraph = release(cEmpty, 1, Set(), planStaged).post
  pure val cStagedWork: TicketGraph = dispatched(cStagedPend, 1).post
  // Work is accepted -> open the instance and ask the LOWEST stage, which
  // lists one evaluator.
  pure val dToEval = doneProduced(cStagedWork, 1, workOf(1))
  pure val cS0 = dToEval.post
  // THE ADVANCE: stage 0's one evaluator passes, stage 1 remains -> the
  // ticket stays in Evaluation and the next roster is owed.
  pure val dAdvance = doneJudged(cS0, 1, evalOf(1, 0, 1), EvaluatorPass)
  pure val cS1 = dAdvance.post
  // Stage 1 lists two evaluators: both pass -> the final stage passes.
  pure val dS1a = doneJudged(cS1, 1, evalOf(1, 1, 1), EvaluatorPass)
  pure val dStagedFinal = doneJudged(dS1a.post, 1, evalOf(1, 1, 2), EvaluatorPass)

  /// The advance edge, exactly: a Progressed event that owes the next
  /// stage's roster under its own identities, the passed stage kept as a
  /// completed run.
  run stageAdvanceTest = assert(and {
    named(dAdvance) == "TicketEvaluationProgressed",
    executed(dAdvance) == Set(evalOf(1, 1, 1), evalOf(1, 1, 2)),
    kinds(dAdvance) == ["ExecuteTask", "ExecuteTask"],
    cS1.tickets.get(1).phase == Evaluation,
    liveTasks(cS1.tickets.get(1)) == Set(evalOf(1, 1, 1), evalOf(1, 1, 2)),
    currentRun(cS1.tickets.get(1)).stageIndex == 1,
    instanceRuns(currentInstance(cS1.tickets.get(1))).length() == 2,
    instanceRuns(currentInstance(cS1.tickets.get(1)))[0] ==
      { stageIndex: 0, generation: 1, evaluators: Map(1 -> passedWith(1)) },
    accounted(cS1),
    // and a Progressed event that settles one of the new stage's two owes
    // nothing
    named(dS1a) == "TicketEvaluationProgressed",
    dS1a.obligations == []
  })

  /// The FINAL stage passing lands the plan: the finalizer is owed, nothing
  /// else is, and both stages are in the instance's history at the rosters
  /// the plan declared for them.
  run stagedPlanPassesTest = assert(and {
    named(dStagedFinal) == "TicketEvaluationPassed",
    kinds(dStagedFinal) == ["FinalizeTicket"],
    dStagedFinal.post.tickets.get(1).phase == Finalization,
    liveTasks(dStagedFinal.post.tickets.get(1)) == Set(),
    currentInstance(dStagedFinal.post.tickets.get(1)).state ==
      EvaluationPassed([
        { stageIndex: 0, generation: 1, evaluators: Map(1 -> passedWith(1)) },
        { stageIndex: 1, generation: 1,
          evaluators: Map(1 -> passedWith(1), 2 -> passedWith(2)) }])
  })

  // --- The short-circuit: stage 0 fails, stage 1 is never asked ------------

  pure val dShort = doneJudged(cS0, 1, evalOf(1, 0, 1), EvaluatorFail)
  pure val cAfterShort = dShort.post
  pure val dStagedWall = doneJudgedAt(cS0, 1, evalOf(1, 0, 1), EvaluatorFail, EscalateEvaluationFailure)

  /// SHORT-CIRCUIT ROUTES TO THE FAILING EDGE: the later stages are not
  /// created — they are skipped, not failed, so no run exists for them —
  /// and the completion takes the edge the disposition names immediately.
  /// The instance's history holds NO stage-1 run, ever.
  run shortCircuitRoutesToReworkTest = assert(and {
    named(dShort) == "TicketEvaluationReworkStarted",
    cAfterShort.tickets.get(1).phase == Work,
    currentInstance(cAfterShort.tickets.get(1)).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1)) }]),
    liveTasks(cAfterShort.tickets.get(1)) == Set(workOf(2)),
    // the golden fixture's other half: the same short-circuit under an
    // Escalate disposition parks the ticket with stage 1 still unasked.
    named(dStagedWall) == "TicketEvaluationFailureEscalated",
    dStagedWall.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    currentInstance(dStagedWall.post.tickets.get(1)).state ==
      currentInstance(cAfterShort.tickets.get(1)).state
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — a new cycle's
  /// judgement is a new instance, which begins at stage 0 by construction,
  /// never mid-sequence.
  pure val dBackToEval = doneProduced(cAfterShort, 1, workOf(2))

  run reworkRestartsLowestStageTest = assert(and {
    named(dBackToEval) == "TicketWorkResultAccepted",
    executed(dBackToEval) == Set(evalOf(2, 0, 1)),
    liveTasks(dBackToEval.post.tickets.get(1)) == Set(evalOf(2, 0, 1)),
    currentRun(dBackToEval.post.tickets.get(1)).stageIndex == 0,
    dBackToEval.post.tickets.get(1).evaluations.length() == 2
  })

  // === PLAN-AS-DATA at machine level ====================================
  // ONE machine instance, two tickets identical but for the plan on
  // their record: different decisions. The plan makes eval what it is
  // meant to be — data, and the plan the instance runs under is that data.

  run planAsDataStructureTest = assert(and {
    liveTasks(c3.tickets.get(1)) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    liveTasks(cS0.tickets.get(1)) == Set(evalOf(1, 0, 1)),
    currentInstance(c3.tickets.get(1)).plan == { stages: planU2 },
    currentInstance(cS0.tickets.get(1)).plan == { stages: planStaged }
  })

  /// THE STAGE VERDICT at the pure grain: a stage passes when every
  /// evaluator in it passed, and one dissenter — of either kind — is enough
  /// to stop it. A stopped evaluator is not a failing one: it stops the
  /// stage without failing it, which is what makes the blocked park a
  /// different edge from the rework.
  pure def runOf(statuses: int -> EvaluatorStatus): StageRun =
    { stageIndex: 0, generation: 1, evaluators: statuses }

  run stageVerdictIsUnanimousTest = assert(and {
    stagePassed(runOf(Map(1 -> passedWith(1), 2 -> passedWith(2)))),
    not(stagePassed(runOf(Map(1 -> passedWith(1), 2 -> failedWith(2))))),
    not(stagePassed(runOf(Map(1 -> failedWith(1), 2 -> failedWith(2))))),
    not(stagePassed(runOf(Map(1 -> passedWith(1), 2 -> Awaiting)))),
    not(stagePassed(runOf(Map(1 -> passedWith(1),
      2 -> EvaluatorExecutionUnavailable(2))))),
    stageHasFailed(runOf(Map(1 -> passedWith(1), 2 -> failedWith(2)))),
    not(stageHasFailed(runOf(Map(1 -> passedWith(1),
      2 -> EvaluatorExecutionUnavailable(2))))),
    stageHasBlocked(runOf(Map(1 -> passedWith(1),
      2 -> EvaluatorExecutionUnavailable(2)))),
    // A DIED EVALUATOR READS AS BLOCKED TOO, and that is the protocol's
    // choice, not a synonym: an exhausted relaunch budget is not a verdict
    // on the artifact either, so it parks at the same wall and is re-asked.
    not(stageHasFailed(runOf(Map(1 -> passedWith(1),
      2 -> EvaluatorProcessFailed(2))))),
    stageHasBlocked(runOf(Map(1 -> passedWith(1),
      2 -> EvaluatorProcessFailed(2))))
  })

  // === The finalizer's failure edge ========================================

  /// A finalization failure re-enters Work as a new cycle, owing a fresh
  /// work task — and it does so EVERY time: there is no wall on this edge,
  /// so a finalizer that keeps reporting failure keeps buying cycles, which
  /// is the finalizer's problem and not the machine's.
  pure val dFinalizationRework = finalized(c5, 1, FinalizationNeedsWork(evidence))

  run finalizationFailureReworksTest = assert(and {
    named(dFinalizationRework) == "TicketFinalizationNeedsWork",
    dFinalizationRework.event == TicketFinalizationNeedsWork({ ticket: 1,
      workCycle: 1, generation: 1, evidence: evidence }),
    dFinalizationRework.obligations == [executeWork(c0.tickets.get(1), 2)],
    dFinalizationRework.post.tickets.get(1).phase == Work,
    liveTasks(dFinalizationRework.post.tickets.get(1)) == Set(workOf(2)),
    // the cycle's finalization is behind it
    dFinalizationRework.post.tickets.get(1).finalizationGeneration == 0,
    dFinalizationRework.post.tickets.get(1).evaluations.length() == 1,
    accounted(dFinalizationRework.post)
  })

  /// A finalizer that reaches NO result parks the ticket instead, at the
  /// resume that re-runs the finalizer: the artifact is intact and untried,
  /// so new work would change nothing.
  pure val dFinalizationUnavailable =
    finalized(c5, 1, FinalizationResultUnavailable(evidence))

  run finalizationUnavailableEscalatesTest = assert(and {
    named(dFinalizationUnavailable) == "TicketFinalizationUnavailable",
    dFinalizationUnavailable.obligations == [],
    dFinalizationUnavailable.post.tickets.get(1).phase == Escalated,
    dFinalizationUnavailable.post.tickets.get(1).escalation ==
      FinalizationUnavailableEscalated,
    // The wall owes nothing and keeps the attempt it stood in front of, and
    // the artifact the finalizer could not commit stays.
    liveTasks(dFinalizationUnavailable.post.tickets.get(1)) == Set(),
    dFinalizationUnavailable.post.tickets.get(1).finalizationGeneration == 1,
    artifactOf(dFinalizationUnavailable.post.tickets.get(1)) ==
      artifactOf(c5.tickets.get(1))
  })

  // === The evaluator wall, and the resume that re-asks only it =============

  /// A WALL AGAINST ONE EVALUATOR MARKS IT AND THE STAGE RUNS ON. Its
  /// siblings are still judging; whether the ticket parks is the stage's
  /// decision once they finish, not this completion's.
  pure val dOneWalled = done(c3, 1, evalOf(1, 0, 1), walled(evalOf(1, 0, 1)))
  pure val cOneWalled = dOneWalled.post

  run evaluatorWallLeavesTheStageRunningTest = assert(and {
    named(dOneWalled) == "TicketEvaluationProgressed",
    dOneWalled.obligations == [],
    cOneWalled.tickets.get(1).phase == Evaluation,
    statusOf(cOneWalled.tickets.get(1), 1) == EvaluatorExecutionUnavailable(1),
    liveTasks(cOneWalled.tickets.get(1)) == Set(evalOf(1, 0, 2))
  })

  /// THE STAGE CONCLUDES BLOCKED once its last evaluator answers: an
  /// interruption is not a verdict, so the judgement is intact and unmade
  /// and the ticket parks at its own wall rather than reworking.
  pure val dBlockedPark = doneJudged(cOneWalled, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cBlockedPark = dBlockedPark.post
  pure val dBlockedResume = resumed(cBlockedPark, 1)
  pure val cBlockedResume = dBlockedResume.post

  run blockedStageParksAndResumesTheBlockedAloneTest = assert(and {
    named(dBlockedPark) == "TicketEvaluationBlocked",
    dBlockedPark.obligations == [],
    cBlockedPark.tickets.get(1).phase == Escalated,
    cBlockedPark.tickets.get(1).escalation == EvaluationBlockedEscalated,
    instanceBlocked(currentInstance(cBlockedPark.tickets.get(1))),
    liveTasks(cBlockedPark.tickets.get(1)) == Set(),

    // THE RESUME: the blocked run comes back at generation 2, and the only
    // task owed is the evaluator the wall stopped — the one that judged
    // keeps exactly what it said.
    named(dBlockedResume) == "TicketEvaluationResumed",
    executed(dBlockedResume) == Set(evalOfRun(1, 0, 2, 1)),
    cBlockedResume.tickets.get(1).phase == Evaluation,
    cBlockedResume.tickets.get(1).escalation == NoEscalation,
    currentRun(cBlockedResume.tickets.get(1)).generation == 2,
    liveTasks(cBlockedResume.tickets.get(1)) == Set(evalOfRun(1, 0, 2, 1)),
    statusOf(cBlockedResume.tickets.get(1), 2) == passedWith(2),
    statusOf(cBlockedResume.tickets.get(1), 1) == Awaiting,
    accounted(cBlockedResume),

    // and the re-asked evaluator's second-generation completion lands the
    // stage, which is what makes the new generation a new identity.
    named(doneJudged(cBlockedResume, 1, evalOfRun(1, 0, 2, 1), EvaluatorPass))
      == "TicketEvaluationPassed",
    // while an event from the interrupted attempt falls through.
    D::evolve(cBlockedResume,
      progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorPass)))
      == cBlockedResume
  })

  /// A STAGE THAT BOTH FAILED AND WAS WALLED FAILS: a verdict is an answer
  /// and a wall is not, so the answer decides. Nothing is left to re-ask
  /// that a new artifact would not replace.
  pure val dFailAndWall =
    doneJudged(cOneWalled, 1, evalOf(1, 0, 2), EvaluatorFail)

  run failureBeatsAWallTest = assert(and {
    named(dFailAndWall) == "TicketEvaluationReworkStarted",
    currentInstance(dFailAndWall.post.tickets.get(1)).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> EvaluatorExecutionUnavailable(1),
          2 -> failedWith(2)) }])
  })

  /// AN EVALUATOR THAT DIED PARKS LIKE A WALL and is re-asked. The
  /// protocol reads both terminals the same way at the stage grain: neither
  /// is an answer, so neither makes a judgement, and what the desk can offer
  /// is the same re-ask. The two are still told apart in the run, because
  /// what stopped the evaluator is what the desk has to act on.
  pure val cOneDied: TicketGraph =
    done(c3, 1, evalOf(1, 0, 1), died(evalOf(1, 0, 1))).post
  pure val dEvaluatorDied =
    doneJudged(cOneDied, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cDiedResume = resumed(dEvaluatorDied.post, 1).post

  run evaluatorProcessFailureParksTest = assert(and {
    named(dEvaluatorDied) == "TicketEvaluationBlocked",
    currentInstance(dEvaluatorDied.post.tickets.get(1)).state ==
      EvaluationBlocked({ completedStages: [],
        stage: { stageIndex: 0, generation: 1,
          evaluators: Map(1 -> EvaluatorProcessFailed(1),
            2 -> passedWith(2)) } }),
    // and the re-ask names the evaluator that died and no other
    liveTasks(cDiedResume.tickets.get(1)) == Set(evalOfRun(1, 0, 2, 1)),
    statusOf(cDiedResume.tickets.get(1), 2) == passedWith(2)
  })

  // === The human desk: parks and resumes ===================================

  /// THE RESUME IS THE WALL'S, and nothing else's: resumeOf is total on the
  /// sum, so every state the record can hold offers the desk exactly one
  /// way on, and the unparked ticket offers none. This is what lets
  /// retryableIn ask only whether the desk holds a task.
  run resumeDerivedFromTheWallTest = assert(and {
    resumeOf(NoEscalation) == NoResume,
    resumeOf(WorkFailureEscalated) == ResumeWork,
    resumeOf(WorkExecutionUnavailableEscalated) == ResumeWork,
    resumeOf(EvaluationFailureEscalated) == ResumeRework,
    resumeOf(EvaluationBlockedEscalated) == ResumeEvaluation,
    resumeOf(FinalizationUnavailableEscalated) == ResumeFinalization,
    not(D::retryableIn(c1, 1)),
    D::retryableIn(dWorkWall.post, 1)
  })

  /// EVERY PARK IS RETRYABLE, and the resume returns the ticket to the phase
  /// its wall implies, the event naming which. The finalization resume owes
  /// the NEXT generation of the cycle's finalization, which is what makes a
  /// late result from the attempt it interrupted one nothing owes.
  pure val cEscFinalizer: TicketGraph = dFinalizationUnavailable.post
  pure val dResumeFinalizer = resumed(cEscFinalizer, 1)

  pure val escWorking: Ticket = { ...spawnWork(fresh(1, Set(), planU2)),
    phase: Escalated, source: srcDispatch, escalation: WorkFailureEscalated }
  pure val cEscWorking: TicketGraph = { tickets: Map(1 -> escWorking) }
  pure val dResumeWorking = resumed(cEscWorking, 1)

  run resumeReturnsToTheWallsPhaseTest = assert(and {
    named(dResumeFinalizer) == "TicketFinalizationResumed",
    dResumeFinalizer.post.tickets.get(1).phase == Finalization,
    dResumeFinalizer.post.tickets.get(1).finalizationGeneration == 2,
    dResumeFinalizer.obligations == [FinalizeTicket({ ticket: 1,
      finalization: { workCycle: 1, generation: 2, input: 101,
        source: srcAccepted },
      configuration: c0.tickets.get(1).definition.finalizationConfiguration })],
    not(hasOpenHumanTask(dResumeFinalizer.post.tickets.get(1))),
    D::retryableIn(cEscFinalizer, 1),
    // the superseded attempt's success is one nothing owes
    D::evolve(dResumeFinalizer.post, dComplete.event) == dResumeFinalizer.post,
    named(dResumeWorking) == "TicketWorkResumed",
    dResumeWorking.post.tickets.get(1).phase == Work,
    executed(dResumeWorking) == Set(workOf(2)),
    D::retryableIn(cEscWorking, 1)
  })

  /// THE EVALUATION-FAILURE WALL'S RESUME: work, again. That wall is
  /// reached by a verdict, which has no re-judge to offer, so it buys a new
  /// artifact instead of a second opinion on the old one; the re-ask a
  /// BLOCKED park gives is pinned above, where an interruption and not a
  /// verdict did the parking.
  pure val cEscRework: TicketGraph = dStagedWall.post
  pure val dResumeRework = resumed(cEscRework, 1)

  run resumeReworkRespawnsWorkTest = assert(and {
    named(dResumeRework) == "TicketWorkResumed",
    executed(dResumeRework) == Set(workOf(2)),
    dResumeRework.post.tickets.get(1).phase == Work,
    dResumeRework.post.tickets.get(1).escalation == NoEscalation,
    // A fresh work cycle above an INTACT instance: the failed judgement
    // stays exactly as it was recorded.
    liveTasks(dResumeRework.post.tickets.get(1)) == Set(workOf(2)),
    dResumeRework.post.tickets.get(1).evaluations ==
      cEscRework.tickets.get(1).evaluations,
    accounted(dResumeRework.post)
  })

  // === Direct release, sparse identity, and ticket-local policy ============

  pure val sparseBase = release(cEmpty, 4, Set(), planU2).post
  pure val sparseCore = release(sparseBase, 1, Set(4), planStaged).post

  run releaseSparseIdentityTest = assert(and {
    sparseCore.tickets.keys() == Set(1, 4),
    sparseCore.tickets.get(1).definition.dependencies == Set(4),
    sparseCore.tickets.get(1).phase == Pending,
    D::isBlockedIn(sparseCore, 1),
    not(D::canReleaseIn(sparseCore, 2)), // count bound reached despite sparse gaps
    not(D::canReleaseIn(sparseCore, 4))
  })

  pure val localPolicy =
    release(cEmpty, 2, Set(), planStaged).post.tickets.get(2)

  run releaseMaterializesTicketPolicyTest = assert(and {
    localPolicy.definition.evaluationPlan.stages == planStaged,
    localPolicy.definition.dependencies == Set(),
    localPolicy.evaluations == []
  })

  // === Revoke, from every live phase =======================================
  // Every non-terminal may be revoked. Single-ticket fixtures: one per live
  // phase (Pending, Work, Evaluation), and the one parked phase twice under
  // different walls — the pair is there to show a revoke does not read the
  // wall that parked the ticket, not to enumerate the walls.

  pure def revokedShape(j: Ticket): bool = and {
    j.phase == Revoked,
    liveTasks(j) == Set(),          // Revoked RUNS nothing...
    j.escalation == NoEscalation,   // ...and opens NO human task:
    not(hasOpenHumanTask(j))        // revocation is the author's settled choice
  }

  pure val jBase: Ticket = fresh(1, Set(), planU2)
  pure val jPend: Ticket = { ...jBase, phase: Pending }
  pure val jWork: Ticket = { ...spawnWork(jBase), phase: Work, source: srcDispatch }
  // the one Evaluation fixture the deciders built: a mid-stage instance
  pure val jEval: Ticket = cOneWalled.tickets.get(1)
  pure val jFinalizer: Ticket = c5.tickets.get(1)
  pure val jEsc: Ticket = { ...spawnWork(jBase), phase: Escalated,
    source: srcDispatch, escalation: WorkFailureEscalated }
  pure val jParkPre: Ticket = { ...spawnWork(jBase), phase: Escalated,
    source: srcDispatch, escalation: WorkExecutionUnavailableEscalated }

  pure def revokeOne(j: Ticket): Stepped =
    stepped({ tickets: Map(1 -> j) }, D::decideRevoke({ tickets: Map(1 -> j) }, 1))

  /// A revoke owes one CancelTask per task the fabric was running for the
  /// ticket, and nothing else — no desk task for the revoked ticket.
  pure def revokeOneOk(j: Ticket): bool = and {
    named(revokeOne(j)) == "TicketRevoked",
    revokeOne(j).obligations == cancelLiveTasks(j),
    revokedShape(revokeOne(j).post.tickets.get(1)),
    revokeOne(j).post.tickets.get(1).completions == 0
  }

  run revokeFromEachPhaseTest = assert(and {
    revokeOneOk(jBase), revokeOneOk(jPend),
    revokeOneOk(jWork), revokeOneOk(jEval),
    revokeOneOk(jEsc), revokeOneOk(jParkPre),
    // Finalization begins the non-revocable boundary.
    not(D::revocableIn({ tickets: Map(1 -> jFinalizer) }, 1))
  })

  /// WHAT A REVOKE CANCELS is exactly what was running: the work cycle's
  /// one task, or the evaluators the run still owed — and nothing for a
  /// ticket that was running nothing.
  run revokeCancelsWhatWasRunningTest = assert(and {
    revokeOne(jWork).obligations ==
      [CancelTask({ ticket: 1, task: workOf(1) })],
    revokeOne(jEval).obligations ==
      [CancelTask({ ticket: 1, task: evalOf(1, 0, 2) })],
    revokeOne(jPend).obligations == [],
    revokeOne(jEsc).obligations == [],
    D::decisionValid({ tickets: Map(1 -> jEval) },
      D::decideRevoke({ tickets: Map(1 -> jEval) }, 1))
  })

  /// Revoke RETAINS the judgement history — "Revoked runs nothing" is about
  /// what is live, not about what was decided. The instance is kept exactly
  /// as it stood, half-answered evaluators and all, and leaving the phase is
  /// already enough to stop its obligations being owed. Provenance survives
  /// the author's settlement.
  run revokeRetainsTheInstanceTest = assert(and {
    revokeOne(jWork).post.tickets.get(1).evaluations == [],
    revokeOne(jEval).post.tickets.get(1).evaluations == jEval.evaluations,
    revokeOne(jBase).post.tickets.get(1).evaluations == []   // never ran
  })

  /// The absorbing terminals are exactly the unrevocable phases.
  run revocableExactlyNonTerminalTest = assert(and {
    D::revocableIn({ tickets: Map(1 -> jBase) }, 1),
    D::revocableIn({ tickets: Map(1 -> jEsc) }, 1),
    not(D::revocableIn(c6, 1)),                                  // Done
    not(D::revocableIn(revokeOne(jBase).post, 1))               // Revoked
  })

  /// REVOKED NEVER COMPLETES: revoking leaves the completion counter at
  /// zero — contrast with the completed ticket (c6), whose counter is 1 and
  /// which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    revokeOne(jEsc).post.tickets.get(1).completions == 0,
    c6.tickets.get(1).completions == 1
  })

  // === REVOKE TOUCHES ONE TICKET, on a 3-ticket chain ======================
  // 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 a
  // Pending behind 2. Revoking 1 settles 1 and moves nothing else: the two
  // dependents stay where their own authors left them.

  pure val cChain: TicketGraph = { tickets: Map(
    1 -> { ...fresh(1, Set(), planU2), phase: Pending },
    2 -> { ...fresh(2, Set(1), planU2), phase: Pending },
    3 -> fresh(3, Set(2), planU2)
  ) }
  pure val dChainRevoke = stepped(cChain, D::decideRevoke(cChain, 1))
  pure val cStranded = dChainRevoke.post

  run revokeMovesOnlyItsOwnTicketTest = assert(and {
    named(dChainRevoke) == "TicketRevoked",
    // no dependent moved, so nothing is owed for one
    dChainRevoke.obligations == [],
    revokedShape(cStranded.tickets.get(1)),
    cStranded.tickets.get(2) == cChain.tickets.get(2),
    cStranded.tickets.get(3) == cChain.tickets.get(3),
    not(hasOpenHumanTask(cStranded.tickets.get(2))),
    not(hasOpenHumanTask(cStranded.tickets.get(3)))
  })

  /// A ticket behind a revoked dependency STAYS PENDING and stays its
  /// author's: it is never Ready (a dep that is not Done blocks, and
  /// Revoked never becomes Done), revoke is still offered on it, and no
  /// release may point a new ticket at the tombstone.
  run strandedDependentWaitsForItsAuthorTest = assert(and {
    cStranded.tickets.get(2).phase == Pending,
    D::isBlockedIn(cStranded, 2),
    not(D::isReadyIn(cStranded, 2)),
    D::revocableIn(cStranded, 2),
    D::revocableIn(cStranded, 3),
    not(D::dependableIn(cStranded).contains(1)),
    D::dependableIn(cStranded).contains(2)
  })

  // === Finalization is not a TicketGraph lease protocol ===================

  run finalizationBoundaryTest = assert(and {
    not(D::revocableIn(c5, 1)),
    not(D::revocableIn(dStagedFinal.post, 1))
  })

  /// A finalizer may report any of the three results, at any evidence it
  /// may return, and every one is a well-formed result.
  run finalizationResultsDrawRuleTest = assert(and {
    D::finalizationResults == D::finalizationEvidences.map(e =>
      Set(FinalizationSucceeded(e), FinalizationNeedsWork(e),
        FinalizationResultUnavailable(e))).flatten(),
    D::finalizationResults.forall(r => finalizationResultValid(r))
  })

  /// THE ARTIFACT IS THE ACCEPTED RESULT, and a rework SUPERSEDES it. The
  /// second half is what makes the mark an identity rather than a flag: two
  /// cycles of the same ticket produced different things and the model can
  /// say so. The instance judging each cycle names the same number as its
  /// input, so a judgement can never be about the wrong artifact.
  ///
  /// AND THE NUMBER IS THE REPORT'S. The report carried 101 and the cycle is
  /// 1, so an instance that derived the reference from the work identity
  /// would read back as the cycle and fail here.
  run artifactAcceptedAndSupersededTest = assert(and {
    artifactOf(c1.tickets.get(1)) == NoArtifact,
    artifactOf(c3.tickets.get(1)) == ProducedArtifact(101),
    currentInstance(c3.tickets.get(1)).input.workResult == 101,
    currentInstance(c3.tickets.get(1)).input.workResult !=
      currentInstance(c3.tickets.get(1)).workCycle,
    // The rework fixture walks a second cycle; its product differs from the
    // first, which a stamp-once mutant would fail.
    artifactOf(dBackToEval.post.tickets.get(1)) != NoArtifact,
    artifactOf(dBackToEval.post.tickets.get(1)) !=
      artifactOf(dToEval.post.tickets.get(1)),
    D::depArtifacts({ tickets: c6.tickets.put(2, fresh(2, Set(1), planU2)) }, 2)
      == Set(ProducedArtifact(101))
  })

  /// A dependency gate depends only on the released predecessor's state.
  pure val cXDepPre: TicketGraph = { tickets: Map(
    1 -> c5.tickets.get(1),
    2 -> { ...fresh(2, Set(1), planU2), phase: Pending }
  ) }
  pure val cXDepDone: TicketGraph = { tickets: Map(
    1 -> c6.tickets.get(1),
    2 -> { ...fresh(2, Set(1), planU2), phase: Pending }
  ) }

  run dependencyGateTest = assert(and {
    D::isBlockedIn(cXDepPre, 2),
    not(D::isReadyIn(cXDepPre, 2)),
    D::isReadyIn(cXDepDone, 2),
    not(D::isBlockedIn(cXDepDone, 2))
  })

  /// EVERY HAND-BUILT FIXTURE IN THIS FILE IS A SHAPE THE MACHINE COULD HAVE
  /// REACHED. idsAccounted is a machine invariant, so the randomized runs and
  /// the witness suites check it after every step the machine takes — and on
  /// nothing this file writes by hand. A fixture that gives itself a work
  /// cycle and leaves freshTicket's spawned at 0 is not a state any trace
  /// reaches, and nothing recomputes the counter, so the equality has to be
  /// asserted where the state is written. This is that assertion, and the
  /// reason a new fixture cannot repeat the mistake quietly.
  run handBuiltFixturesAccountedTest = assert(and {
    accounted(cChain), accounted(cXDepPre), accounted(cXDepDone),
    accountedTicket(escWorking),
    accountedTicket(jBase), accountedTicket(jPend), accountedTicket(jWork),
    accountedTicket(jEval), accountedTicket(jFinalizer),
    accountedTicket(jEsc), accountedTicket(jParkPre)
  })

  /// AND EVERY INSTANCE THIS FILE REACHES SATISFIES THE PROTOCOL'S OWN
  /// INVARIANT. The machine invariant quantifies over reachable states;
  /// this pins it on the states the deciders here walked to, which is where
  /// a decider that advanced an instance wrongly would show up first.
  pure def instancesValid(c: TicketGraph): bool =
    c.tickets.keys().forall(j =>
      c.tickets.get(j).evaluations.indices().forall(i =>
        invariant(c.tickets.get(j).evaluations[i])))

  run walkedInstancesValidTest = assert(and {
    instancesValid(c3), instancesValid(c4), instancesValid(c6),
    instancesValid(cSparse4),
    instancesValid(cS0), instancesValid(cS1),
    instancesValid(dStagedFinal.post),
    instancesValid(cAfterShort), instancesValid(dBackToEval.post),
    instancesValid(cOneWalled), instancesValid(cBlockedPark),
    instancesValid(cBlockedResume),
    instancesValid(dFailAndWall.post), instancesValid(dEvaluatorDied.post),
    instancesValid(cDiedResume),
    instancesValid(cReworkEval),
    instancesValid(dEvalRework.post), instancesValid(dEvalEscalate.post)
  })
}
