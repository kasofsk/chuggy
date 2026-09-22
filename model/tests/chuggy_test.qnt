/// Pure decider tests for direct ticket release, sparse project-local
/// identity, immutable ticket policy, the evaluation instance, revoke,
/// evaluator walls and their resume, and the finalization protocol.
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

  // wr/wt build the OUTSTANDING and RESOLVED work task; only work has a
  // task set to build, because an evaluation's tasks are derived from its
  // instance (ticket.qnt liveTasks).
  pure def wr(cycle: int): Task =
    { identity: workOf(cycle), state: Outstanding }
  pure def wt(cycle: int, o: TaskOutcome): Task =
    { identity: workOf(cycle), state: Resolved(o) }

  // THE TWO SOURCES a fixture uses: one the dispatch observes, one a work
  // result is accepted at. Their sets are disjoint by construction
  // (domain.qnt), so which of the two a ticket carries says whether it has
  // been told a work result's source or has only ever been dispatched.
  pure val srcDispatch: int = D::aDispatchSource
  pure val srcAccepted: int = D::anAcceptedSource

  // WHAT A COMPLETION CAN CARRY. A produced report carries the obligation
  // the ticket owes for the task (ticket.qnt producedResult) — the only one
  // the completion's enablement admits — under a result reference the
  // machine derives from the task's own identity.
  pure def died(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ evidence: taskRefOf(task), kind: ProcessFailure })
  pure def walled(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ evidence: taskRefOf(task),
      kind: ExecutionUnavailableFailure })

  /// A completion at a named disposition — the failing stage's choice is an
  /// input to the decision, so every call site says which edge it is asking
  /// for. `done` asks for the rework edge, which every completion that does
  /// not conclude a failing stage ignores.
  pure def doneAt(c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport, d: EvaluationFailureDisposition): Decision =
    D::decideTaskDone(c, j, task, report, d)
  pure def done(c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport): Decision =
    doneAt(c, j, task, report, ReworkEvaluationFailure)

  /// A WORK COMPLETION that produced, at the obligation the ticket owes and
  /// the source the application accepted it at.
  pure def doneProduced(c: TicketGraph, j: int, task: TaskIdentity): Decision =
    done(c, j, task, WorkResultReport({
      result: producedResult(c.tickets.get(j), task),
      acceptedSourceRef: srcAccepted }))

  /// AN EVALUATOR'S VERDICT, at the obligation the running stage owes it.
  pure def doneJudgedAt(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict, d: EvaluationFailureDisposition): Decision =
    doneAt(c, j, task, EvaluationResultReport({
      result: producedResult(c.tickets.get(j), task), verdict: v }), d)
  pure def doneJudged(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict): Decision =
    doneJudgedAt(c, j, task, v, ReworkEvaluationFailure)

  /// A VERDICT NOTHING IS OWED — the stale and duplicate deliveries. The
  /// ticket has no obligation for the task to read, so the builder states
  /// one; the decider settles by identity and never opens the report, which
  /// is the whole of what these call sites assert.
  pure def doneJudgedStale(c: TicketGraph, j: int, task: TaskIdentity,
      v: EvaluationVerdict): Decision =
    done(c, j, task, EvaluationResultReport({
      result: { obligation: { task: task, definition: D::evaluatorTaskOf(1),
                              contextRef: 1 },
                resultRef: taskRefOf(task) },
      verdict: v }))

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
  // (ticket.qnt Ticket.spawned) is bumped only by a spawn site, and the
  // literals above build a live work task directly — so a fixture that
  // hands itself one and leaves freshTicket's 0 in place breaks domain.qnt's
  // idsAccounted, which makes it a state the machine cannot reach. That is
  // not cosmetic: the work-passed decider READS the counter, stamping the
  // artifact from it. Every fixture below that gives itself history carries
  // the matching count, and handBuiltFixturesAccountedTest (bottom of this
  // file) is what keeps the next one honest. Every EVALUATION fixture is
  // built by the deciders instead, which is also the only honest way to get
  // a well-formed instance.

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

  pure def release(c: TicketGraph, j: int, dependencies: Set[int], stages: List[StageDefinition]): Decision =
    D::decideReleaseTicket(c, D::releasedTicketOf(j, dependencies, stages))

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
  /// the spawn owes that key and no other, the completion settles it, and
  /// the stage concludes — the sites that once walked 1..width would have
  /// asked key 1, matched nothing, and concluded nothing.
  pure val cSparse0: TicketGraph =
    release(cEmpty, 1, Set(), planSparse).post
  pure val cSparse1: TicketGraph = D::decideDispatch(cSparse0, 1, srcDispatch).post
  pure val cSparse2: TicketGraph =
    doneProduced(cSparse1, 1, workOf(1)).post
  pure val cSparse3: TicketGraph = D::decideWorkReduce(cSparse2, 1).post
  pure val dSparseJudged =
    doneJudged(cSparse3, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cSparse4: TicketGraph = dSparseJudged.post

  run sparseStageAskedSettledAndConcludedTest = assert(and {
    liveTasks(cSparse3.tickets.get(1)) == Set(evalOf(1, 0, 2)),
    currentRun(cSparse3.tickets.get(1)).evaluators.keys() == Set(2),
    dSparseJudged.rec.label == "eval-passed",
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
  pure val dDispatch = D::decideDispatch(c0, 1, srcDispatch)   // spawns cycle 1's work task
  pure val c1 = dDispatch.post
  pure val dWork1 = doneProduced(c1, 1, workOf(1))
  pure val c2 = dWork1.post
  // retires the work task; opens the instance and asks stage 0's roster
  pure val dWorkReduce = D::decideWorkReduce(c2, 1)
  pure val c3 = dWorkReduce.post
  pure val dEval1 = doneJudged(c3, 1, evalOf(1, 0, 1), EvaluatorPass)
  pure val c4 = dEval1.post
  // the second evaluator's pass CONCLUDES the only stage, so the plan
  // passed and the ticket finalizes in this same decision
  pure val dEval2 = doneJudged(c4, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val c5 = dEval2.post
  /// The finalizer succeeds and the ticket completes from Finalization.
  pure val dComplete = D::decideFinalizationResult(c5, 1, FinalizationSucceeded)
  pure val c6 = dComplete.post

  /// The records are golden-trace shaped with the phase flips where — and
  /// only where — the anatomy says. A completion that leaves its stage
  /// still owing evaluators flips no phase; the one that concludes it does.
  run happyPathRecordsTest = assert(and {
    dDispatch.rec.label == "dispatch",
    dDispatch.rec.transitions == [{ ticket: 1, from: Pending, to: Work }],
    dWork1.rec.label == "task-done",
    dWork1.rec.transitions == [],
    dWorkReduce.rec.label == "work-passed",
    dWorkReduce.rec.transitions == [{ ticket: 1, from: Work, to: Evaluation }],
    dEval1.rec.label == "task-done",
    dEval1.rec.transitions == [],
    dEval2.rec.label == "eval-passed",
    dEval2.rec.transitions == [{ ticket: 1, from: Evaluation, to: Finalization }],
    dComplete.rec.label == "ticket-done",
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }],
    // THE SPAWN EFFECTS, pinned here because nothing else pins them. A
    // spawn emitting no effect is a fan-out the world never hears about —
    // a hole an all-green test set cannot show you. Found by mutation:
    // dropping SpawnEvalTasks from work-passed left all 54 cases passing.
    dDispatch.rec.effects == ["SpawnWorkTasks"],
    dWorkReduce.rec.effects == ["SpawnEvalTasks"],
    dEval1.rec.effects == [],
    dEval2.rec.effects == ["RunFinalizer"]
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
    // and the work task already retired.
    c3.tickets.get(1).tasks == Set(),
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

  /// EFFECT EXCLUSIVITY, happy path (effect-only):
  /// exactly one completion effect, exactly at Done.
  run effectExclusivityHappyPathTest = assert(and {
    c6.tickets.get(1).phase == Done,
    c6.tickets.get(1).completions == 1,
    dComplete.rec.effects == []
  })

  run finalizationSuccessTest = assert(and {
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }],
    dComplete.rec.effects == [],
    dComplete.post.tickets.get(1).completions == 1
  })

  run finalizerProtocolDirectCommitTest = assert(and {
    dEval2.rec.effects == ["RunFinalizer"],
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }]
  })

  // === At-least-once: duplicates are idempotent stutters ===================

  /// A duplicate completion for an already-settled task (even with a
  /// CONTRADICTING report — first write wins) changes nothing: no state,
  /// no effects — an at-least-once delivery honored idempotently.
  run duplicateTaskDoneIdempotentTest = assert(and {
    done(c2, 1, workOf(1), died(workOf(1))).post == c2,
    done(c2, 1, workOf(1), died(workOf(1))).rec.label == "task-done",
    done(c2, 1, workOf(1), died(workOf(1))).rec.effects == [],
    // the same for an evaluator that has already judged
    doneJudgedStale(c4, 1, evalOf(1, 0, 1), EvaluatorFail).post == c4
  })

  /// STALE completions no-op BY IDENTITY: identities are unique within the
  /// ticket and never reused, so a completion for cycle 1's work task after
  /// the instance opened, or for an evaluator after the ticket left
  /// evaluation, names a task nothing is waiting on — whatever report it
  /// carries.
  run staleCompletionNoopsTest = assert(and {
    // c3: the instance is open; the work task is long settled.
    done(c3, 1, workOf(1), died(workOf(1))).post == c3,
    done(c3, 1, workOf(1), died(workOf(1))).rec.label == "task-done",
    // c5: Finalization; a late evaluator completion no-ops.
    doneJudgedStale(c5, 1, evalOf(1, 0, 1), EvaluatorFail).post == c5,
    doneJudgedStale(c5, 1, evalOf(1, 0, 1), EvaluatorFail).rec.label == "task-done"
  })

  // === The work walls: cycle-level, no below-cycle retries =================

  /// A work task that DIED escalates at cycle level through its reduce —
  /// there is no same-cycle retry branch to take: below-cycle retries are
  /// the fabric's trusted relaunch limit, and modeling them is a standing
  /// non-goal.
  pure val dWorkDied = done(c1, 1, workOf(1), died(workOf(1)))
  pure val dWorkFail = D::decideWorkReduce(dWorkDied.post, 1)

  run workFailedWallTest = assert(and {
    dWorkDied.rec.label == "task-done",
    dWorkDied.post.tickets.get(1).tasks == Set(wt(1, Failed)),
    dWorkFail.rec.label == "ticket-escalated work_failure_escalated",
    dWorkFail.post.tickets.get(1).phase == Escalated,
    dWorkFail.post.tickets.get(1).escalation == WorkFailureEscalated,
    hasOpenHumanTask(dWorkFail.post.tickets.get(1)),
    dWorkFail.rec.effects == ["OpenHumanTask"],
    dWorkFail.post.tickets.get(1).tasks == Set()
  })

  /// A WORK TASK'S WALL PARKS AT ONCE, in the completion itself: a work
  /// cycle is one task, so there is no sibling left to wait for and nothing
  /// to reduce. It is the OTHER wall from the failed cycle above, because
  /// an interruption is not a verdict.
  pure val dWorkWall = done(c1, 1, workOf(1), walled(workOf(1)))

  run workExecutionUnavailableWallTest = assert(and {
    dWorkWall.rec.label == "ticket-escalated work_execution_unavailable_escalated",
    dWorkWall.rec.transitions == [{ ticket: 1, from: Work, to: Escalated }],
    dWorkWall.rec.effects == ["OpenHumanTask"],
    dWorkWall.post.tickets.get(1).escalation == WorkExecutionUnavailableEscalated,
    dWorkWall.post.tickets.get(1).tasks == Set(),
    // and its resume buys a new cycle, because a wall against work leaves
    // nothing judged to preserve.
    D::decideResumeTicket(dWorkWall.post, 1).post.tickets.get(1).phase == Work,
    D::decideResumeTicket(dWorkWall.post, 1).post.tickets.get(1).tasks == Set(wr(2))
  })

  // === The failing evaluation's two edges ==================================

  /// ONE failing state, TWO decisions — which one is taken is the
  /// disposition and nothing else. Rework re-enters Work with a fresh work
  /// task; Escalate parks the ticket at the evaluation-failure wall, whose
  /// resume re-enters Work later. Both keep the instance that failed.
  pure val cEvalFail: TicketGraph =
    doneJudged(c3, 1, evalOf(1, 0, 1), EvaluatorFail).post
  pure val dEvalRework = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, ReworkEvaluationFailure)
  pure val dEvalEscalate = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, EscalateEvaluationFailure)

  run evalFailureDispositionTest = assert(and {
    // one dissenter fails the stage even though the other evaluator passed
    dEvalRework.rec.label == "rework-started eval_failure",
    dEvalRework.rec.transitions == [{ ticket: 1, from: Evaluation, to: Work }],
    dEvalRework.rec.effects == ["SpawnWorkTasks"],
    dEvalRework.post.tickets.get(1).phase == Work,
    dEvalRework.post.tickets.get(1).tasks == Set(wr(2)),
    // the failed instance is kept, whole, and a rework opens no second one
    // until its own cycle passes
    dEvalRework.post.tickets.get(1).evaluations.length() == 1,
    currentInstance(dEvalRework.post.tickets.get(1)).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1), 2 -> passedWith(2)) }]),

    dEvalEscalate.rec.label == "ticket-escalated evaluation_failure_escalated",
    dEvalEscalate.rec.effects == ["OpenHumanTask"],
    dEvalEscalate.post.tickets.get(1).phase == Escalated,
    dEvalEscalate.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    D::retryableIn(dEvalEscalate.post, 1),
    dEvalEscalate.post.tickets.get(1).tasks == Set(),
    currentInstance(dEvalEscalate.post.tickets.get(1)).state ==
      currentInstance(dEvalRework.post.tickets.get(1)).state
  })

  /// THE EVIDENCE A REWORK CARRIES is the failing evaluators and what they
  /// produced, which is the protocol's own read of the instance — the
  /// rework cause an implementation hands to the next work cycle.
  run reworkEntriesNameTheDissenterTest = assert(
    reworkEntries(currentInstance(dEvalRework.post.tickets.get(1)),
      [currentRun(dEvalRework.post.tickets.get(1))]) ==
      [{ evaluator: 1, resultRef: 1 }])

  /// A SECOND CYCLE GETS A SECOND INSTANCE, and the first stays as it was:
  /// the instances are the ticket's judgement history, one per cycle that
  /// reached judgement.
  pure val cReworkWork: TicketGraph =
    doneProduced(dEvalRework.post, 1, workOf(2)).post
  pure val cReworkEval: TicketGraph = D::decideWorkReduce(cReworkWork, 1).post

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
  pure val cStagedWork: TicketGraph = D::decideDispatch(cStagedPend, 1, srcDispatch).post
  pure val cStagedWorkDone: TicketGraph =
    doneProduced(cStagedWork, 1, workOf(1)).post
  // Work passes -> open the instance and ask the LOWEST stage, which lists
  // one evaluator.
  pure val dToEval = D::decideWorkReduce(cStagedWorkDone, 1)
  pure val cS0 = dToEval.post
  // THE ADVANCE: stage 0's one evaluator passes, stage 1 remains ->
  // Evaluation -> Evaluation, the next roster is asked.
  pure val dAdvance = doneJudged(cS0, 1, evalOf(1, 0, 1), EvaluatorPass)
  pure val cS1 = dAdvance.post
  // Stage 1 lists two evaluators: both pass -> the final stage passes.
  pure val dS1a = doneJudged(cS1, 1, evalOf(1, 1, 1), EvaluatorPass)
  pure val dStagedFinal = doneJudged(dS1a.post, 1, evalOf(1, 1, 2), EvaluatorPass)

  /// The advance edge, exactly: label eval-stage-passed, an Evaluation ->
  /// Evaluation transition, the next stage's roster owed under its own
  /// identities, the passed stage kept as a completed run.
  run stageAdvanceTest = assert(and {
    dAdvance.rec.label == "eval-stage-passed",
    dAdvance.rec.transitions == [{ ticket: 1, from: Evaluation, to: Evaluation }],
    dAdvance.rec.effects == ["SpawnEvalTasks"],
    cS1.tickets.get(1).phase == Evaluation,
    liveTasks(cS1.tickets.get(1)) == Set(evalOf(1, 1, 1), evalOf(1, 1, 2)),
    currentRun(cS1.tickets.get(1)).stageIndex == 1,
    instanceRuns(currentInstance(cS1.tickets.get(1))).length() == 2,
    instanceRuns(currentInstance(cS1.tickets.get(1)))[0] ==
      { stageIndex: 0, generation: 1, evaluators: Map(1 -> passedWith(1)) },
    accounted(cS1)
  })

  /// The FINAL stage passing lands the plan: eval-passed, nothing owed,
  /// both stages in the instance's history at the rosters the plan
  /// declared for them.
  run stagedPlanPassesTest = assert(and {
    dStagedFinal.rec.label == "eval-passed",
    dStagedFinal.rec.transitions == [{ ticket: 1, from: Evaluation, to: Finalization }],
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
    dShort.rec.label == "rework-started eval_failure",
    dShort.rec.transitions == [{ ticket: 1, from: Evaluation, to: Work }],
    currentInstance(cAfterShort.tickets.get(1)).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1)) }]),
    cAfterShort.tickets.get(1).tasks == Set(wr(2)),
    // the golden fixture's other half: the same short-circuit under an
    // Escalate disposition parks the ticket with stage 1 still unasked.
    dStagedWall.rec.label == "ticket-escalated evaluation_failure_escalated",
    dStagedWall.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    currentInstance(dStagedWall.post.tickets.get(1)).state ==
      currentInstance(cAfterShort.tickets.get(1)).state
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — a new cycle's
  /// judgement is a new instance, which begins at stage 0 by construction,
  /// never mid-sequence.
  pure val dReworkW1 = doneProduced(cAfterShort, 1, workOf(2))
  pure val dBackToEval = D::decideWorkReduce(dReworkW1.post, 1)

  run reworkRestartsLowestStageTest = assert(and {
    dBackToEval.rec.label == "work-passed",
    liveTasks(dBackToEval.post.tickets.get(1)) == Set(evalOf(2, 0, 1)),
    currentRun(dBackToEval.post.tickets.get(1)).stageIndex == 0,
    dBackToEval.post.tickets.get(1).evaluations.length() == 2
  })

  /// Duplicate stale completion, staged edition: while stage 1 is owed, a
  /// re-delivered completion for the settled stage-0 evaluator — even with
  /// a contradicting verdict — no-ops by identity.
  run staleStageDuplicateNoopsTest = assert(and {
    doneJudgedStale(cS1, 1, evalOf(1, 0, 1), EvaluatorFail).post == cS1,
    doneJudgedStale(cS1, 1, evalOf(1, 0, 1), EvaluatorFail).rec.label == "task-done"
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

  /// A finalization failure re-enters Work as a new cycle, with a fresh
  /// work task — and it does so EVERY time: there is no wall on this edge,
  /// so a finalizer that keeps reporting failure keeps buying cycles, which
  /// is the finalizer's problem and not the machine's.
  pure val cFinalizing: TicketGraph = { tickets: Map(1 -> { ...fresh(1, Set(), planU2),
    phase: Finalization }) }
  pure val dFinalizationRework = D::decideFinalizationResult(cFinalizing, 1, FinalizationNeedsWork)
  pure val dFinalizationReworkAgain =
    D::decideFinalizationResult(c5, 1, FinalizationNeedsWork)

  run finalizationFailureReworksTest = assert(and {
    dFinalizationRework.rec.label == "rework-started finalization_needs_work",
    dFinalizationRework.rec.transitions == [{ ticket: 1, from: Finalization, to: Work }],
    dFinalizationRework.rec.effects == ["SpawnWorkTasks"],
    dFinalizationRework.post.tickets.get(1).phase == Work,
    // The wrap-up rework's work task is a fresh incarnation: a new cycle.
    dFinalizationRework.post.tickets.get(1).tasks == Set(wr(1)),
    // A ticket that has already been round the loop takes the same edge,
    // its cycle counting on above the instance it already judged.
    dFinalizationReworkAgain.post.tickets.get(1).phase == Work,
    dFinalizationReworkAgain.post.tickets.get(1).tasks == Set(wr(2)),
    dFinalizationReworkAgain.post.tickets.get(1).evaluations.length() == 1,
    accounted(dFinalizationReworkAgain.post)
  })

  /// A finalizer that reaches NO result parks the ticket instead, at the
  /// resume that re-runs the finalizer: the artifact is intact and untried,
  /// so new work would change nothing.
  pure val dFinalizationUnavailable =
    D::decideFinalizationResult(cFinalizing, 1, FinalizationResultUnavailable)

  run finalizationUnavailableEscalatesTest = assert(and {
    dFinalizationUnavailable.rec.label ==
      "ticket-escalated finalization_unavailable_escalated",
    dFinalizationUnavailable.rec.transitions ==
      [{ ticket: 1, from: Finalization, to: Escalated }],
    dFinalizationUnavailable.rec.effects == ["OpenHumanTask"],
    dFinalizationUnavailable.post.tickets.get(1).escalation ==
      FinalizationUnavailableEscalated,
    // The wall claims nothing and retires nothing: Finalization holds no
    // live task, and the artifact the finalizer could not commit stays.
    dFinalizationUnavailable.post.tickets.get(1).tasks == Set(),
    dFinalizationUnavailable.post.tickets.get(1).artifact ==
      cFinalizing.tickets.get(1).artifact
  })

  // === The evaluator wall, and the resume that re-asks only it =============

  /// A WALL AGAINST ONE EVALUATOR MARKS IT AND THE STAGE RUNS ON. Its
  /// siblings are still judging; whether the ticket parks is the stage's
  /// decision once they finish, not this completion's. This is the edge the
  /// retired ticket-level block could not express: it parked the ticket and
  /// left the siblings draining.
  pure val dOneWalled = done(c3, 1, evalOf(1, 0, 1), walled(evalOf(1, 0, 1)))
  pure val cOneWalled = dOneWalled.post

  run evaluatorWallLeavesTheStageRunningTest = assert(and {
    dOneWalled.rec.label == "task-done",
    dOneWalled.rec.transitions == [],
    dOneWalled.rec.effects == [],
    cOneWalled.tickets.get(1).phase == Evaluation,
    statusOf(cOneWalled.tickets.get(1), 1) == EvaluatorExecutionUnavailable(1),
    liveTasks(cOneWalled.tickets.get(1)) == Set(evalOf(1, 0, 2))
  })

  /// THE STAGE CONCLUDES BLOCKED once its last evaluator answers: an
  /// interruption is not a verdict, so the judgement is intact and unmade
  /// and the ticket parks at its own wall rather than reworking.
  pure val dBlockedPark = doneJudged(cOneWalled, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cBlockedPark = dBlockedPark.post
  pure val dBlockedResume = D::decideResumeTicket(cBlockedPark, 1)
  pure val cBlockedResume = dBlockedResume.post

  run blockedStageParksAndResumesTheBlockedAloneTest = assert(and {
    dBlockedPark.rec.label == "ticket-escalated evaluation_blocked_escalated",
    dBlockedPark.rec.transitions == [{ ticket: 1, from: Evaluation, to: Escalated }],
    dBlockedPark.rec.effects == ["OpenHumanTask"],
    cBlockedPark.tickets.get(1).escalation == EvaluationBlockedEscalated,
    instanceBlocked(currentInstance(cBlockedPark.tickets.get(1))),
    liveTasks(cBlockedPark.tickets.get(1)) == Set(),

    // THE RESUME: the blocked run comes back at generation 2, and the only
    // task owed is the evaluator the wall stopped — the one that judged
    // keeps exactly what it said.
    dBlockedResume.rec.label == "ticket-resumed",
    dBlockedResume.rec.transitions == [{ ticket: 1, from: Escalated, to: Evaluation }],
    dBlockedResume.rec.effects == ["SpawnEvalTasks"],
    cBlockedResume.tickets.get(1).phase == Evaluation,
    cBlockedResume.tickets.get(1).escalation == NoEscalation,
    currentRun(cBlockedResume.tickets.get(1)).generation == 2,
    liveTasks(cBlockedResume.tickets.get(1)) == Set(evalOfRun(1, 0, 2, 1)),
    statusOf(cBlockedResume.tickets.get(1), 2) == passedWith(2),
    statusOf(cBlockedResume.tickets.get(1), 1) == Awaiting,
    accounted(cBlockedResume),

    // and the re-asked evaluator's second-generation completion lands the
    // stage, which is what makes the new generation a new identity.
    doneJudged(cBlockedResume, 1, evalOfRun(1, 0, 2, 1), EvaluatorPass).rec.label == "eval-passed",
    // while a late completion from the interrupted attempt no-ops.
    doneJudgedStale(cBlockedResume, 1, evalOf(1, 0, 1), EvaluatorPass).post == cBlockedResume
  })

  /// A STAGE THAT BOTH FAILED AND WAS WALLED FAILS: a verdict is an answer
  /// and a wall is not, so the answer decides. Nothing is left to re-ask
  /// that a new artifact would not replace.
  pure val cOneWalledThenFail: TicketGraph =
    done(c3, 1, evalOf(1, 0, 1), walled(evalOf(1, 0, 1))).post
  pure val dFailAndWall =
    doneJudged(cOneWalledThenFail, 1, evalOf(1, 0, 2), EvaluatorFail)

  run failureBeatsAWallTest = assert(and {
    dFailAndWall.rec.label == "rework-started eval_failure",
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
  pure val cDiedResume = D::decideResumeTicket(dEvaluatorDied.post, 1).post

  run evaluatorProcessFailureParksTest = assert(and {
    dEvaluatorDied.rec.label == "ticket-escalated evaluation_blocked_escalated",
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
  /// continuation, and the unparked ticket offers none. This is what lets
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
  /// its wall implies. The finalization park is the state its own wall wrote
  /// rather than one built here — a hand-built park was once able to stamp a
  /// resume no decider pairs with that wall, which is what the sum removes.
  pure val cEscFinalizer: TicketGraph = dFinalizationUnavailable.post
  pure val dResumeFinalizer = D::decideResumeTicket(cEscFinalizer, 1)

  pure val escWorking: Ticket = { ...fresh(1, Set(), planU2),
    phase: Escalated, escalation: WorkFailureEscalated }
  pure val cEscWorking: TicketGraph = { tickets: Map(1 -> escWorking) }
  pure val dResumeWorking = D::decideResumeTicket(cEscWorking, 1)

  run resumeReturnsToTheWallsPhaseTest = assert(and {
    dResumeFinalizer.rec.label == "ticket-resumed",
    dResumeFinalizer.post.tickets.get(1).phase == Finalization,
    dResumeFinalizer.rec.effects == ["RunFinalizer"],
    not(hasOpenHumanTask(dResumeFinalizer.post.tickets.get(1))),
    D::retryableIn(cEscFinalizer, 1),
    dResumeWorking.post.tickets.get(1).phase == Work,
    dResumeWorking.rec.effects == ["SpawnWorkTasks"],
    D::retryableIn(cEscWorking, 1)
  })

  /// THE EVALUATION-FAILURE WALL'S RESUME: respawn WORK. That wall is
  /// reached by a verdict, which has no re-judge to offer, so it buys a new
  /// artifact instead of a second opinion on the old one; the re-ask a
  /// BLOCKED park gives is pinned above, where an interruption and not a
  /// verdict did the parking.
  pure val cEscRework: TicketGraph = dStagedWall.post
  pure val dResumeRework = D::decideResumeTicket(cEscRework, 1)

  run resumeReworkRespawnsWorkTest = assert(and {
    dResumeRework.rec.label == "ticket-resumed",
    dResumeRework.rec.effects == ["SpawnWorkTasks"],
    dResumeRework.rec.transitions == [{ ticket: 1, from: Escalated, to: Work }],
    dResumeRework.post.tickets.get(1).escalation == NoEscalation,
    // A fresh work cycle above an INTACT instance: the failed judgement
    // stays exactly as it was recorded.
    dResumeRework.post.tickets.get(1).tasks == Set(wr(2)),
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
  // phase (Pending, Work, Evaluation, Finalization), and the one parked phase
  // twice under different walls — the pair is there to show a revoke does
  // not read the wall that parked the ticket, not to enumerate the walls.

  pure def revokedShape(j: Ticket): bool = and {
    j.phase == Revoked,
    j.tasks == Set(),               // Revoked RUNS nothing (live task retired)...
    liveTasks(j) == Set(),          // ...and owes no evaluator either,
    j.escalation == NoEscalation,   // ...and opens NO human task:
    not(hasOpenHumanTask(j))        // revocation is the author's settled choice
  }

  pure val jBase: Ticket = fresh(1, Set(), planU2)
  pure val jPend: Ticket = { ...jBase, phase: Pending }
  pure val jWork: Ticket = { ...spawnWork(jBase), phase: Work }
  // the one Evaluation fixture the deciders built: a mid-stage instance
  pure val jEval: Ticket = cOneWalled.tickets.get(1)
  pure val jFinalizer: Ticket = { ...jBase, phase: Finalization }
  pure val jEsc: Ticket = { ...jBase, phase: Escalated,
    escalation: EvaluationFailureEscalated }
  pure val jParkPre: Ticket = { ...jBase, phase: Escalated,
    escalation: WorkExecutionUnavailableEscalated }

  pure def revokeOne(j: Ticket): Decision =
    D::decideRevoke({ tickets: Map(1 -> j) }, 1)

  pure def revokeOneOk(j: Ticket): bool = and {
    revokeOne(j).rec.label == "ticket-revoked",
    revokeOne(j).rec.transitions == [{ ticket: 1, from: j.phase, to: Revoked }],
    revokeOne(j).rec.effects == ["CancelTicketWork"],   // no OpenHumanTask for the revoked ticket
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

  /// REVOKED NEVER COMPLETES (the exclusivity extension): revoking a ticket
  /// parked IN the wrap-up queue emits no completion effect and leaves the
  /// completion counter at zero — contrast with the completed ticket (c6),
  /// whose counter is 1 and which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    revokeOne(jFinalizer).post.tickets.get(1).completions == 0,
    revokeOne(jFinalizer).rec.effects == ["CancelTicketWork"],
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
  pure val dChainRevoke = D::decideRevoke(cChain, 1)
  pure val cStranded = dChainRevoke.post

  run revokeTransitionsOnlyItsOwnTicketTest = assert(and {
    dChainRevoke.rec.label == "ticket-revoked",
    // ONE transition and ONE effect: no dependent moved, so no desk task
    // opened for a decision its author has not taken.
    dChainRevoke.rec.transitions == [{ ticket: 1, from: Pending, to: Revoked }],
    dChainRevoke.rec.effects == ["CancelTicketWork"],
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

  pure val cGateOcc: TicketGraph = { tickets: Map(
    1 -> { ...fresh(1, Set(), planU2), phase: Finalization },
    2 -> { ...fresh(2, Set(), planU2), phase: Finalization }
  ) }

  run finalizationBoundaryTest = assert(and {
    not(D::revocableIn({ tickets: Map(1 -> { ...fresh(1, Set(), planU2), phase: Finalization }) }, 1)),
    not(D::revocableIn(cGateOcc, 1)),
    not(D::revocableIn(cGateOcc, 2))
  })

  run finalizationOutcomesDrawRuleTest = assert(
    D::finalizationOutcomes == Set(FinalizationSucceeded, FinalizationNeedsWork,
      FinalizationResultUnavailable))

  /// THE COMPLETION STAMPS AN ARTIFACT, and a rework SUPERSEDES it. The
  /// second half is what makes the mark an identity rather than a flag: two
  /// cycles of the same ticket produced different things and the model can
  /// say so. The instance judging each cycle names the same number as its
  /// input, so a judgement can never be about the wrong artifact.
  ///
  /// AND THE NUMBER IS THE REPORT'S. The report carried 101 and the cycle is
  /// 1, so a stamp or an instance that derived the reference from the work
  /// identity would read back as the cycle and fail here.
  run artifactStampedAndSupersededTest = assert(and {
    dDispatch.post.tickets.get(1).artifact == NoArtifact,
    dWork1.post.tickets.get(1).artifact == ProducedArtifact(101),
    dWorkReduce.post.tickets.get(1).artifact == ProducedArtifact(101),
    currentInstance(c3.tickets.get(1)).input.workResult == 101,
    currentInstance(c3.tickets.get(1)).input.workResult !=
      currentInstance(c3.tickets.get(1)).workCycle,
    // The rework fixture walks a second cycle; its product differs from the
    // first, which a stamp-once mutant would fail.
    dBackToEval.post.tickets.get(1).artifact != NoArtifact,
    dBackToEval.post.tickets.get(1).artifact !=
      dToEval.post.tickets.get(1).artifact,
    currentInstance(dBackToEval.post.tickets.get(1)).input.workResult !=
      currentInstance(dToEval.post.tickets.get(1)).input.workResult
  })

  /// A dependency gate depends only on the released predecessor's state.
  pure val cXDepPre: TicketGraph = { tickets: Map(
    1 -> { ...fresh(1, Set(), planU2), phase: Finalization },
    2 -> { ...fresh(2, Set(1), planU2), phase: Pending }
  ) }
  pure val cXDepDone: TicketGraph = { tickets: Map(
    1 -> { ...fresh(1, Set(), planU2), phase: Done, completions: 1 },
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
  /// nothing this file writes by hand. That gap is the one the fixtures fell
  /// into: some of them carried a live task set while leaving freshTicket's
  /// spawned at 0, which is not a state any trace reaches, and work-passed's
  /// artifact stamp read the short counter. The deciders below cannot repair
  /// it — nothing recomputes the counter — so the equality has to be
  /// asserted where the state is written. This is that assertion, and the
  /// reason a new fixture cannot repeat the mistake quietly.
  run handBuiltFixturesAccountedTest = assert(and {
    accounted(cFinalizing), accounted(cChain), accounted(cGateOcc),
    accounted(cXDepPre), accounted(cXDepDone),
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
