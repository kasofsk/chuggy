/// Pure decider and evolve tests for direct ticket release, sparse
/// project-local identity, ticket policy and its update, the evaluation instance,
/// revoke, evaluator walls and their resume, the finalization protocol, the
/// events a state no longer owes, and the ledger folded beside each ticket.
module chuggy_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
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

  pure def workOf(cycle: int): TaskIdentity = workTaskIdentity(1, cycle)
  pure def evalOfRun(cycle: int, s: int, generation: int, e: int): TaskIdentity =
    evaluatorTaskIdentity(1, cycle, s + 1, generation, e)
  pure def evalOf(cycle: int, s: int, e: int): TaskIdentity =
    evalOfRun(cycle, s, 1, e)

  // THE TWO SOURCES a fixture uses: one the dispatch observes, one a work
  // result is accepted at. Their sets are disjoint by construction
  // (domain.qnt), so which of the two a state carries says whether the
  // ticket has been told a work result's source or has only ever been
  // dispatched.
  pure val srcDispatch: int = D::aDispatchSource
  pure val srcAccepted: int = D::anAcceptedSource
  pure val evidence: int = D::aFinalizationEvidence

  /// A GRAPH AND ITS LEDGERS, stepped together the way the machine steps
  /// them (domain.qnt take). The tickets field keeps every `c.tickets` read
  /// below a read of the graph, and equality of two worlds is equality of
  /// both halves.
  type World = { tickets: int -> Ticket, ledgers: int -> TicketLedger }
  pure def graphOf(w: World): TicketGraph = { tickets: w.tickets }
  pure def evolveBoth(w: World, e: TicketEvent): World =
    { tickets: evolve(graphOf(w), e).tickets,
      ledgers: D::evolveLedgers(graphOf(w), w.ledgers, e) }
  pure def ledgerOf(w: World, j: int): TicketLedger = w.ledgers.get(j)
  /// Ticket j alone, with its ledger.
  pure def alone(t: Ticket, l: TicketLedger): World =
    { tickets: Map(t.definition.id -> t), ledgers: Map(t.definition.id -> l) }
  pure def only(w: World, j: int): World =
    alone(w.tickets.get(j), w.ledgers.get(j))

  /// ONE DECISION, TAKEN: the event and the obligations the decider
  /// returned, and the world evolve takes the one it was decided at to —
  /// or, for a refused command, the refusal's name and the world unmoved.
  /// A refused step's event is a placeholder nothing reads: `named` answers
  /// with the refusal instead.
  type Stepped = {
    event: TicketEvent,
    obligations: List[Obligation],
    post: World,
    refusal: str
  }
  pure def stepped(c: World, d: TicketDecision): Stepped = match d {
    | TicketDecided(s) => { event: s.event, obligations: s.obligations,
        post: evolveBoth(c, s.event), refusal: "" }
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

  /// A ticket's state by its constructor's name, and a parked one's wall.
  pure def tagOf(t: Ticket): str = match t.state {
    | Pending => "Pending"
    | Work(_) => "Work"
    | Evaluation(_) => "Evaluation"
    | Finalization(_) => "Finalization"
    | Escalated(_) => "Escalated"
    | Done => "Done"
    | Revoked => "Revoked"
  }
  pure def wallOf(t: Ticket): str = match t.state {
    | Escalated(wall) => match wall {
        | WorkFailureEscalated(_) => "WorkFailureEscalated"
        | WorkExecutionUnavailableEscalated(_) =>
          "WorkExecutionUnavailableEscalated"
        | EvaluationFailureEscalated(_) => "EvaluationFailureEscalated"
        | EvaluationBlockedEscalated(_) => "EvaluationBlockedEscalated"
        | FinalizationUnavailableEscalated(_) =>
          "FinalizationUnavailableEscalated"
      }
    | _ => ""
  }

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
  pure def doneAt(c: World, j: int, task: TaskIdentity,
      report: TaskTerminalReport, d: EvaluationFailureDisposition): Stepped =
    stepped(c, decide(graphOf(c), ReportTaskTerminal(report), _ => d))
  pure def done(c: World, j: int, task: TaskIdentity,
      report: TaskTerminalReport): Stepped =
    doneAt(c, j, task, report, ReworkEvaluationFailure)

  /// A WORK COMPLETION that produced, at the obligation the ticket owes and
  /// the source the application accepted it at.
  pure def doneProduced(c: World, j: int, task: TaskIdentity): Stepped =
    done(c, j, task, WorkResultReport({ ticket: j,
      result: producedResult(c.tickets.get(j), task),
      acceptedSourceRef: srcAccepted }))

  /// AN EVALUATOR'S VERDICT, at the obligation the running stage owes it.
  pure def judgedReport(c: World, j: int, task: TaskIdentity,
      v: EvaluationVerdict): TaskTerminalReport =
    EvaluationResultReport({ ticket: j,
      result: producedResult(c.tickets.get(j), task), verdict: v })
  pure def doneJudgedAt(c: World, j: int, task: TaskIdentity,
      v: EvaluationVerdict, d: EvaluationFailureDisposition): Stepped =
    doneAt(c, j, task, judgedReport(c, j, task, v), d)
  pure def doneJudged(c: World, j: int, task: TaskIdentity,
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
  pure def finalized(c: World, j: int, result: FinalizationResult): Stepped =
    stepped(c, decideFinalizationResult(graphOf(c), { ticket: j,
      workCycle: c.tickets.get(j).workCyclesStarted,
      generation: D::attemptGeneration(c.tickets.get(j)), result: result }))
  pure def resumed(c: World, j: int): Stepped =
    stepped(c, decideResume(graphOf(c), j))
  pure def dispatched(c: World, j: int): Stepped =
    stepped(c, decideDispatch(graphOf(c), { ticket: j, source: srcDispatch }))

  // Reading an instance back: every instance ticket j has opened, the latest
  // of them, the run its judgement stands at, and the status one evaluator
  // holds in it.
  pure def instancesOf(w: World, j: int): List[EvaluationInstance] =
    ledgerInstances(w.tickets.get(j), w.ledgers.get(j))
  pure def latestInstance(w: World, j: int): EvaluationInstance =
    val instances = instancesOf(w, j)
    instances[instances.length() - 1]
  pure def currentRun(w: World, j: int): StageRun =
    match latestInstance(w, j).state {
      | Running(running) => running.stage
      | EvaluationBlocked(blocked) => blocked.stage
      | EvaluationPassed(stages) => stages[stages.length() - 1]
      | EvaluationFailed(stages) => stages[stages.length() - 1]
    }
  pure def statusOf(w: World, j: int, e: int): EvaluatorStatus =
    currentRun(w, j).evaluators.get(e)
  pure def artifactIn(w: World, j: int): ArtifactMark =
    artifactOf(w.tickets.get(j), w.ledgers.get(j))
  pure def passedWith(ref: int): EvaluatorStatus = Produced(EvaluatorPassed(ref))
  pure def failedWith(ref: int): EvaluatorStatus = Produced(EvaluatorFailed(ref))

  // A HAND-BUILT FIXTURE STATES ITS OWN LEDGER. The mint counter
  // (ticket.qnt TicketLedger) moves only by the fold, so a fixture written
  // by hand is a state the machine reaches only if its ledger matches its
  // history, which handBuiltFixturesAccountedTest (bottom of this file)
  // holds. Every fixture that has left Pending is built by the deciders
  // instead, which is also the only honest way to get a well-formed
  // instance.

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

  /// A released ticket, as the package's evolve lands one.
  pure def fresh(j: int, dependencies: Set[int], stages: List[StageDefinition]): Ticket =
    { definition: D::releasedTicketOf(j, dependencies, stages), revision: 1,
      workCyclesStarted: 0, state: Pending }

  pure def release(c: World, j: int, dependencies: Set[int], stages: List[StageDefinition]): Stepped =
    stepped(c, decideCreate(graphOf(c), D::releasedTicketOf(j, dependencies, stages)))

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
  pure val cSparse0: World =
    release(cEmpty, 1, Set(), planSparse).post
  pure val cSparse1: World = dispatched(cSparse0, 1).post
  pure val dSparseAccepted = doneProduced(cSparse1, 1, workOf(1))
  pure val cSparse3: World = dSparseAccepted.post
  pure val dSparseJudged =
    doneJudged(cSparse3, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cSparse4: World = dSparseJudged.post

  run sparseStageAskedSettledAndConcludedTest = assert(and {
    executed(dSparseAccepted) == Set(evalOf(1, 0, 2)),
    liveTasks(cSparse3.tickets.get(1)) == Set(evalOf(1, 0, 2)),
    currentRun(cSparse3, 1).evaluators.keys() == Set(2),
    named(dSparseJudged) == "TicketEvaluationPassed",
    statusOf(cSparse4, 1, 2) == passedWith(2),
    liveTasks(cSparse4.tickets.get(1)) == Set(),
    tagOf(cSparse4.tickets.get(1)) == "Finalization",
    ledgerOf(cSparse4, 1).spawned == 2
  })

  // === The happy path, decision by decision ================================
  // The path STARTS at authoring — the fleet is empty, ticket 1 is released
  // as a Pending; ticket 3 is released as a Pending depending on 1 and stays
  // undispatched throughout. ticket 1 carries the DEFAULT plan, so its
  // history is one work cycle and that cycle's stage-0 roster of two
  // evaluators.

  pure val cEmpty: World = { tickets: Map(), ledgers: Map() }
  pure val dRelease = release(cEmpty, 1, Set(), D::defaultPlan)
  pure val cA1 = dRelease.post
  pure val dReleaseDependent = release(cA1, 3, Set(1), D::defaultPlan)
  pure val cA2 = dReleaseDependent.post

  pure val c0: World = cA2
  pure val def1: ReleasedTicket = c0.tickets.get(1).definition
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
  /// the state it lands in runs. A completion that leaves its stage still
  /// owing evaluators owes nothing new; the one that concludes it owes the
  /// finalizer.
  run happyPathEventsTest = assert(and {
    named(dRelease) == "TicketCreated",
    dRelease.obligations == [],
    named(dDispatch) == "TicketDispatched",
    dDispatch.event == TicketDispatched({ ticket: 1, source: srcDispatch }),
    dDispatch.obligations == [executeWork(c0.tickets.get(1), 1, srcDispatch,
      initialWorkInput(def1))],
    named(dWork1) == "TicketWorkResultAccepted",
    dWork1.obligations == executeEvaluationTasks(1, latestInstance(c3, 1)),
    executed(dWork1) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    named(dEval1) == "TicketEvaluationProgressed",
    dEval1.obligations == [],
    named(dEval2) == "TicketEvaluationPassed",
    dEval2.obligations == [FinalizeTicket({ ticket: 1,
      finalization: { workCycle: 1, generation: 1, input: 101,
        source: srcAccepted },
      configuration: def1.finalizationConfiguration })],
    named(dComplete) == "TicketFinalizationSucceeded",
    dComplete.event == TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 1, evidence: evidence }),
    dComplete.obligations == [],
    // the states each event lands in, and the source each carries: the
    // dispatch's until a work result is accepted, then the acceptance's
    c1.tickets.get(1).state ==
      Work({ input: initialWorkInput(def1), source: srcDispatch }),
    tagOf(c3.tickets.get(1)) == "Evaluation",
    tagOf(c4.tickets.get(1)) == "Evaluation",
    c5.tickets.get(1).state == Finalization({ workCycle: 1, generation: 1,
      input: 101, source: srcAccepted }),
    c6.tickets.get(1).state == Done
  })

  /// EVERY DECISION ON THE PATH IS VALID where it was taken, and its event
  /// moves the state it was decided at (domain.qnt decisionsValid,
  /// eventsNeverIdentity) — pinned here on the exact decisions, where the
  /// machine checks them on every reachable one.
  run happyPathDecisionsValidTest = assert(and {
    decisionValid(graphOf(cEmpty), decideCreate(graphOf(cEmpty),
      D::releasedTicketOf(1, Set(), D::defaultPlan))),
    decisionValid(graphOf(c0),
      decideDispatch(graphOf(c0), { ticket: 1, source: srcDispatch })),
    c1 != c0, c3 != c1, c4 != c3, c5 != c4, c6 != c5,
    decisionValid(graphOf(c1),
      TicketDecided({ event: dWork1.event, obligations: dWork1.obligations })),
    decisionValid(graphOf(c3),
      TicketDecided({ event: dEval1.event, obligations: dEval1.obligations })),
    decisionValid(graphOf(c4),
      TicketDecided({ event: dEval2.event, obligations: dEval2.obligations })),
    decisionValid(graphOf(c5), TicketDecided({ event: dComplete.event,
      obligations: dComplete.obligations }))
  })

  // === Update while Pending ================================================

  /// AN UPDATE REPLACES A PENDING TICKET'S DEFINITION AS ITS NEXT REVISION,
  /// owes nothing, and the dispatch after it runs the definition it
  /// replaced the release's with.
  pure val defRevised: ReleasedTicket =
    D::revisedTicketOf(1, 2, Set(), D::defaultPlan)
  pure def updateAt(
      c: World, j: int, expected: int,
      definition: ReleasedTicket): Stepped =
    stepped(c, decideUpdate(graphOf(c),
      { ticket: j, expectedRevision: expected, definition: definition }))
  pure val dUpdate = updateAt(c0, 1, 1, defRevised)

  run updateLandsNextRevisionTest = assert(and {
    c0.tickets.get(1).revision == 1,
    dUpdate.event == TicketUpdated({ ticket: 1, revision: 2,
      definition: defRevised }),
    dUpdate.obligations == [],
    dUpdate.post.tickets.get(1).definition == defRevised,
    dUpdate.post.tickets.get(1).revision == 2,
    dUpdate.post.tickets.get(3) == c0.tickets.get(3),
    dUpdate.post.ledgers == c0.ledgers,
    decisionValid(graphOf(c0), decideUpdate(graphOf(c0),
      { ticket: 1, expectedRevision: 1, definition: defRevised })),
    dispatched(dUpdate.post, 1).obligations == [ExecuteTask({ ticket: 1,
      task: { task: workOf(1), definition: defRevised.workConfiguration,
        contextRef: 1 } })],
    updateAt(dUpdate.post, 1, 2,
      D::revisedTicketOf(1, 3, Set(), D::defaultPlan)).post
      .tickets.get(1).revision == 3
  })

  /// THE UPDATE'S REFUSALS, in the package's order: each command below
  /// fails every check after the one it is named for as well, so the first
  /// failing check is what names it.
  pure val badDefinition: ReleasedTicket =
    D::revisedTicketOf(2, 2, Set(3), D::defaultPlan)
  run updateRefusalOrderTest = assert(and {
    named(updateAt(c0, 2, 1, D::releasedTicketOf(2, Set(), D::defaultPlan)))
      == "TicketNotFound",
    named(updateAt(c1, 1, 1, defRevised)) == "TicketNotPending",
    named(updateAt(c0, 1, 5, badDefinition)) == "TicketIdentityMismatch",
    decideUpdate(graphOf(c0), { ticket: 1, expectedRevision: 5,
      definition: D::revisedTicketOf(1, 2, Set(3), D::defaultPlan) })
      == TicketRefused(TicketRevisionStale({ ticket: 1, expected: 5,
        current: 1 })),
    named(updateAt(c0, 1, 1, D::revisedTicketOf(1, 2, Set(3),
      D::defaultPlan))) == "TicketDependenciesChanged",
    named(updateAt(c0, 3, 1, D::revisedTicketOf(3, 2, Set(), D::defaultPlan)))
      == "TicketDependenciesChanged"
  })

  /// AN UPDATE A STATE DOES NOT OWE IS THE IDENTITY: one landing on a
  /// dispatched ticket, and one whose revision is not the next.
  run updateNotOwedIsIdentityTest = assert(and {
    evolveBoth(c1, dUpdate.event) == c1,
    evolveBoth(dUpdate.post, dUpdate.event) == dUpdate.post,
    evolveBoth(c0, TicketUpdated({ ticket: 1, revision: 3,
      definition: defRevised })) == c0
  })

  /// A PASSING STAGE IGNORES THE DISPOSITION: it is consulted only where a
  /// completion concludes a FAILING stage, so the passing path is the same
  /// decision either way.
  run passingStageIgnoresDispositionTest = assert(
    doneJudgedAt(c4, 1, evalOf(1, 0, 2), EvaluatorPass, EscalateEvaluationFailure) == dEval2)

  /// THE INSTANCE IS THE PROVENANCE: at Done ticket 1 has opened one
  /// instance, for the cycle that produced the artifact it judged, with its
  /// whole stage history and every evaluator's own outcome.
  run happyPathInstanceTest = assert(and {
    instancesOf(c6, 1).length() == 1,
    latestInstance(c6, 1).workCycle == 1,
    latestInstance(c6, 1).input ==
      { ticket: 1, workResult: 101, acceptedSourceRef: srcAccepted },
    latestInstance(c6, 1).plan == { stages: planU2 },
    latestInstance(c6, 1).state ==
      EvaluationPassed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> passedWith(1), 2 -> passedWith(2)) }]),
    liveTasks(c6.tickets.get(1)) == Set(),
    // Intermediate shape: the instance opens with the whole roster awaiting
    // and the work task no longer owed.
    liveTasks(c3.tickets.get(1)) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    // and one evaluator settling leaves the other owed.
    liveTasks(c4.tickets.get(1)) == Set(evalOf(1, 0, 2)),
    statusOf(c4, 1, 1) == passedWith(1)
  })

  /// domain.qnt's idsAccounted, one ticket at a time — the same equality
  /// the machine invariant quantifies over liveTickets, usable on a fixture
  /// the machine never produced: the mint counter is one slot per work cycle
  /// plus what every run of every instance claimed.
  pure def accountedTicket(t: Ticket, l: TicketLedger): bool =
    l.spawned == t.workCyclesStarted + evaluationSpawnTotal(ledgerInstances(t, l))

  /// The same, over a whole world — every ticket, not just ticket 1: a
  /// multi-ticket fixture accounts for all of its ids or none of them.
  pure def accounted(c: World): bool =
    c.tickets.keys().forall(j =>
      accountedTicket(c.tickets.get(j), c.ledgers.get(j)))

  /// IDENTITY ACCOUNTING along the fully decider-built happy path: the mint
  /// counter tracks every spawn and always equals what the ticket's own
  /// history claims. (The machine invariant checks it on every reachable
  /// state; this pins the counter's exact values.)
  run happyPathIdsAccountedTest = assert(and {
    ledgerOf(cA1, 1).spawned == 0,          // a Pending has claimed nothing
    ledgerOf(c1, 1).spawned == 1,           // the work task
    accounted(c1),
    ledgerOf(c3, 1).spawned == 3,           // + stage 0's roster of two
    accounted(c3),
    ledgerOf(c6, 1).spawned == 3,           // Done: nothing claimed since
    accounted(c6)
  })

  /// COMPLETION EXCLUSIVITY, happy path: exactly one completion, exactly at
  /// Done, and the success owes the world nothing.
  run completionExclusivityHappyPathTest = assert(and {
    c6.tickets.get(1).state == Done,
    ledgerOf(c6, 1).completions == 1,
    dComplete.obligations == []
  })

  // === Events a state no longer owes fall through evolve ===================

  /// AN EVENT APPLIED TO A STATE THAT NO LONGER OWES IT IS THE IDENTITY
  /// (domain.qnt evolve), on the graph and on the ledgers alike. The machine
  /// never decides one — `decide` refuses the command first — so no trace
  /// carries it, and this is where it is pinned: a duplicate for a settled
  /// task, whatever it reports; a stale evaluator after the ticket left
  /// evaluation or after a resume moved the generation on; a finalization
  /// result for an attempt a resume superseded; a dispatch, an acceptance
  /// and a release a state has already moved past; and a work acceptance
  /// under an obligation the cycle never owed.
  pure def workFailedFact(task: TaskIdentity): TicketEvent =
    TicketWorkProcessFailed({ ticket: 1, task: task, evidence: 1 })
  pure def progressedFact(report: TaskTerminalReport): TicketEvent =
    TicketEvaluationProgressed({ ticket: 1, report: report })

  run eventsNotOwedAreIdentityTest = assert(and {
    // c3: the instance is open; cycle 1's work task is long settled.
    evolveBoth(c3, workFailedFact(workOf(1))) == c3,
    evolveBoth(c3, dWork1.event) == c3,
    // c4: evaluator 1 already judged — a contradicting verdict falls through
    evolveBoth(c4, progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorFail))) == c4,
    evolveBoth(c4, TicketEvaluationReworkStarted({ ticket: 1,
      report: staleVerdict(evalOf(1, 0, 1), EvaluatorFail),
      evidence: [{ evaluator: 1, resultRef: 1 }] })) == c4,
    // c5: Finalization; a late evaluator falls through
    evolveBoth(c5, progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorFail))) == c5,
    evolveBoth(c5, TicketEvaluationPassed({ ticket: 1,
      report: staleVerdict(evalOf(1, 0, 2), EvaluatorPass) })) == c5,
    // a finalization result for an attempt this ticket is not on
    evolveBoth(c5, TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 2, evidence: evidence })) == c5,
    evolveBoth(c5, TicketFinalizationNeedsWork({ ticket: 1, workCycle: 2,
      generation: 1, evidence: evidence })) == c5,
    // events whose state the ticket has left
    evolveBoth(c3, TicketDispatched({ ticket: 1, source: srcDispatch })) == c3,
    evolveBoth(c6, TicketRevoked(1)) == c6,
    evolveBoth(c1, TicketWorkResumed(1)) == c1,
    evolveBoth(c1, TicketEvaluationResumed(1)) == c1,
    evolveBoth(c1, TicketFinalizationResumed(1)) == c1,
    evolveBoth(c1, TicketFinalizationSucceeded({ ticket: 1, workCycle: 1,
      generation: 1, evidence: evidence })) == c1,
    // a release of a ticket that exists; and, for one that does not, the
    // ledgers stand (the package's evolve reads the ticket an event names
    // without asking whether it exists, so only the fold is asked here)
    evolveBoth(c1, dRelease.event) == c1,
    D::evolveLedgers(graphOf(c1), c1.ledgers, TicketRevoked(2)) == c1.ledgers,
    // an acceptance under the wrong obligation: the right task, another
    // context
    evolveBoth(c1, TicketWorkResultAccepted({ ticket: 1,
      result: { obligation: { ...workTaskObligation(c1.tickets.get(1), 1,
          srcDispatch, initialWorkInput(def1)),
        contextRef: 2 }, resultRef: 101 },
      acceptedSourceRef: srcAccepted })) == c1
  })

  /// THE SAME, OVER EVERY TASK THE TICKET'S HISTORY NAMES: on every state
  /// this file walks, an evaluation event about any task the ticket has been
  /// owed and no longer is falls through, and so does a work failure
  /// wherever the ticket is not in Work (workFailureNamesNoTaskTest below).
  pure def notOwedFallsThrough(c: World, j: int): bool =
    D::deliverableTasksIn(graphOf(c), c.ledgers, j)
      .exclude(liveTasks(c.tickets.get(j)))
      .forall(task => and {
        evolveBoth(c, TicketEvaluationProgressed({ ticket: j,
          report: died(task) })) == c,
        evolveBoth(c, TicketEvaluationBlocked({ ticket: j,
          report: walled(task) })) == c,
        match c.tickets.get(j).state {
          | Work(_) => true
          | _ => evolveBoth(c, TicketWorkProcessFailed({ ticket: j,
              task: task, evidence: 1 })) == c
        }
      })

  run everySettledTaskFallsThroughTest = assert(and {
    notOwedFallsThrough(c3, 1), notOwedFallsThrough(c4, 1),
    notOwedFallsThrough(c5, 1), notOwedFallsThrough(c6, 1),
    notOwedFallsThrough(cS1, 1), notOwedFallsThrough(cAfterShort, 1),
    notOwedFallsThrough(cBlockedResume, 1),
    notOwedFallsThrough(cReworkEval, 1)
  })

  /// A WORK FAILURE EVENT NAMES NO TASK THE PACKAGE'S EVOLVE READS: a ticket
  /// in Work parks under it whichever task it names. What keeps a settled
  /// task's failure out of the journal is `decide`, which refuses the report.
  run workFailureNamesNoTaskTest = assert(and {
    named(done(cAfterShort, 1, workOf(1), died(workOf(1)))) == "TaskNotCurrent",
    wallOf(evolveBoth(cAfterShort, workFailedFact(workOf(1)))
      .tickets.get(1)) == "WorkFailureEscalated"
  })

  // === The work walls: cycle-level, no below-cycle retries =================

  /// A work task that DIED parks the ticket at cycle level in the
  /// completion itself — there is no same-cycle retry branch to take:
  /// below-cycle retries are the fabric's trusted relaunch limit, and
  /// modeling them is a standing non-goal. The wall keeps the input the
  /// retry will run, with the failure's evidence, and the source it ran at.
  pure val dWorkFail = done(c1, 1, workOf(1), died(workOf(1)))

  run workFailedWallTest = assert(and {
    named(dWorkFail) == "TicketWorkProcessFailed",
    dWorkFail.event == TicketWorkProcessFailed({ ticket: 1, task: workOf(1),
      evidence: 1 }),
    dWorkFail.obligations == [],
    dWorkFail.post.tickets.get(1).state == Escalated(WorkFailureEscalated({
      resumeInput: retryWorkInput(initialWorkInput(def1), 1),
      source: srcDispatch, evidence: 1 })),
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
    wallOf(dWorkWall.post.tickets.get(1)) == "WorkExecutionUnavailableEscalated",
    liveTasks(dWorkWall.post.tickets.get(1)) == Set(),
    // and its resume buys a new cycle, because a wall against work leaves
    // nothing judged to preserve.
    named(resumed(dWorkWall.post, 1)) == "TicketWorkResumed",
    executed(resumed(dWorkWall.post, 1)) == Set(workOf(2)),
    tagOf(resumed(dWorkWall.post, 1).post.tickets.get(1)) == "Work",
    liveTasks(resumed(dWorkWall.post, 1).post.tickets.get(1)) == Set(workOf(2))
  })

  // === The failing evaluation's two edges ==================================

  /// ONE failing state, TWO decisions — which one is taken is the
  /// disposition and nothing else, and the event names it. Rework re-enters
  /// Work owing a fresh work task; Escalate parks the ticket at the
  /// evaluation-failure wall, whose resume re-enters Work later. Both carry
  /// the same evidence and close the instance that failed.
  pure val cEvalFail: World =
    doneJudged(c3, 1, evalOf(1, 0, 1), EvaluatorFail).post
  pure val dEvalRework = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, ReworkEvaluationFailure)
  pure val dEvalEscalate = doneJudgedAt(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass, EscalateEvaluationFailure)

  run evalFailureDispositionTest = assert(and {
    // one dissenter fails the stage even though the other evaluator passed
    named(dEvalRework) == "TicketEvaluationReworkStarted",
    dEvalRework.event == TicketEvaluationReworkStarted({ ticket: 1,
      report: judgedReport(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass),
      evidence: [{ evaluator: 1, resultRef: 1 }] }),
    dEvalRework.obligations == [executeWork(c0.tickets.get(1), 2, srcAccepted,
      evaluationReworkInput(def1, [{ evaluator: 1, resultRef: 1 }]))],
    dEvalRework.post.tickets.get(1).state == Work({
      input: evaluationReworkInput(def1, [{ evaluator: 1, resultRef: 1 }]),
      source: srcAccepted }),
    liveTasks(dEvalRework.post.tickets.get(1)) == Set(workOf(2)),
    // the failed instance is kept, whole, and a rework opens no second one
    // until its own cycle passes
    instancesOf(dEvalRework.post, 1).length() == 1,
    latestInstance(dEvalRework.post, 1).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1), 2 -> passedWith(2)) }]),

    named(dEvalEscalate) == "TicketEvaluationFailureEscalated",
    dEvalEscalate.event == TicketEvaluationFailureEscalated({ ticket: 1,
      report: judgedReport(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass),
      evidence: [{ evaluator: 1, resultRef: 1 }] }),
    dEvalEscalate.obligations == [],
    dEvalEscalate.post.tickets.get(1).state ==
      Escalated(EvaluationFailureEscalated({
        evidence: [{ evaluator: 1, resultRef: 1 }], source: srcAccepted })),
    D::retryableIn(graphOf(dEvalEscalate.post), 1),
    liveTasks(dEvalEscalate.post.tickets.get(1)) == Set(),
    latestInstance(dEvalEscalate.post, 1).state ==
      latestInstance(dEvalRework.post, 1).state
  })

  /// A SECOND CYCLE GETS A SECOND INSTANCE, and the first stays as it was:
  /// the instances are the ticket's judgement history, one per cycle that
  /// reached judgement.
  pure val cReworkEval: World =
    doneProduced(dEvalRework.post, 1, workOf(2)).post

  run secondCycleOpensSecondInstanceTest = assert(and {
    instancesOf(cReworkEval, 1).length() == 2,
    instancesOf(cReworkEval, 1)[0] == instancesOf(dEvalRework.post, 1)[0],
    latestInstance(cReworkEval, 1).workCycle == 2,
    liveTasks(cReworkEval.tickets.get(1)) ==
      Set(evalOf(2, 0, 1), evalOf(2, 0, 2)),
    accounted(cReworkEval)
  })

  // === THE STAGED PLAN, walked stage by stage ===========================
  // planStaged lists one evaluator at stage 0 and two at stage 1 on the
  // reference instance. The walk mirrors staged progression edge by edge;
  // the short-circuit mirrors the staged-eval short-circuit golden.

  pure val cStagedPend: World = release(cEmpty, 1, Set(), planStaged).post
  pure val cStagedWork: World = dispatched(cStagedPend, 1).post
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
    tagOf(cS1.tickets.get(1)) == "Evaluation",
    liveTasks(cS1.tickets.get(1)) == Set(evalOf(1, 1, 1), evalOf(1, 1, 2)),
    currentRun(cS1, 1).stageIndex == 1,
    instanceRuns(latestInstance(cS1, 1)).length() == 2,
    instanceRuns(latestInstance(cS1, 1))[0] ==
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
    tagOf(dStagedFinal.post.tickets.get(1)) == "Finalization",
    liveTasks(dStagedFinal.post.tickets.get(1)) == Set(),
    latestInstance(dStagedFinal.post, 1).state ==
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
    tagOf(cAfterShort.tickets.get(1)) == "Work",
    latestInstance(cAfterShort, 1).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> failedWith(1)) }]),
    liveTasks(cAfterShort.tickets.get(1)) == Set(workOf(2)),
    // the golden fixture's other half: the same short-circuit under an
    // Escalate disposition parks the ticket with stage 1 still unasked.
    named(dStagedWall) == "TicketEvaluationFailureEscalated",
    wallOf(dStagedWall.post.tickets.get(1)) == "EvaluationFailureEscalated",
    latestInstance(dStagedWall.post, 1).state ==
      latestInstance(cAfterShort, 1).state
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — a new cycle's
  /// judgement is a new instance, which begins at stage 0 by construction,
  /// never mid-sequence.
  pure val dBackToEval = doneProduced(cAfterShort, 1, workOf(2))

  run reworkRestartsLowestStageTest = assert(and {
    named(dBackToEval) == "TicketWorkResultAccepted",
    executed(dBackToEval) == Set(evalOf(2, 0, 1)),
    liveTasks(dBackToEval.post.tickets.get(1)) == Set(evalOf(2, 0, 1)),
    currentRun(dBackToEval.post, 1).stageIndex == 0,
    instancesOf(dBackToEval.post, 1).length() == 2
  })

  // === PLAN-AS-DATA at machine level ====================================
  // ONE machine instance, two tickets identical but for the plan on
  // their record: different decisions. The plan makes eval what it is
  // meant to be — data, and the plan the instance runs under is that data.

  run planAsDataStructureTest = assert(and {
    liveTasks(c3.tickets.get(1)) == Set(evalOf(1, 0, 1), evalOf(1, 0, 2)),
    liveTasks(cS0.tickets.get(1)) == Set(evalOf(1, 0, 1)),
    latestInstance(c3, 1).plan == { stages: planU2 },
    latestInstance(cS0, 1).plan == { stages: planStaged }
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
    dFinalizationRework.obligations == [executeWork(c0.tickets.get(1), 2,
      srcAccepted, finalizationReworkInput(def1, evidence))],
    dFinalizationRework.post.tickets.get(1).state == Work({
      input: finalizationReworkInput(def1, evidence), source: srcAccepted }),
    liveTasks(dFinalizationRework.post.tickets.get(1)) == Set(workOf(2)),
    // the cycle's finalization is behind it
    D::attemptGeneration(dFinalizationRework.post.tickets.get(1)) == 0,
    instancesOf(dFinalizationRework.post, 1).length() == 1,
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
    // The wall owes nothing and keeps the attempt it stood in front of, and
    // the artifact the finalizer could not commit stays.
    dFinalizationUnavailable.post.tickets.get(1).state ==
      Escalated(FinalizationUnavailableEscalated({
        finalization: { workCycle: 1, generation: 1, input: 101,
          source: srcAccepted },
        evidence: evidence })),
    liveTasks(dFinalizationUnavailable.post.tickets.get(1)) == Set(),
    D::attemptGeneration(dFinalizationUnavailable.post.tickets.get(1)) == 1,
    artifactIn(dFinalizationUnavailable.post, 1) == artifactIn(c5, 1)
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
    tagOf(cOneWalled.tickets.get(1)) == "Evaluation",
    statusOf(cOneWalled, 1, 1) == EvaluatorExecutionUnavailable(1),
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
    wallOf(cBlockedPark.tickets.get(1)) == "EvaluationBlockedEscalated",
    instanceBlocked(latestInstance(cBlockedPark, 1)),
    liveTasks(cBlockedPark.tickets.get(1)) == Set(),
    // the wall holds the instance open: nothing has closed
    ledgerOf(cBlockedPark, 1).closedEvaluations == [],

    // THE RESUME: the blocked run comes back at generation 2, and the only
    // task owed is the evaluator the wall stopped — the one that judged
    // keeps exactly what it said.
    named(dBlockedResume) == "TicketEvaluationResumed",
    executed(dBlockedResume) == Set(evalOfRun(1, 0, 2, 1)),
    tagOf(cBlockedResume.tickets.get(1)) == "Evaluation",
    not(isEscalated(cBlockedResume.tickets.get(1).state)),
    currentRun(cBlockedResume, 1).generation == 2,
    liveTasks(cBlockedResume.tickets.get(1)) == Set(evalOfRun(1, 0, 2, 1)),
    statusOf(cBlockedResume, 1, 2) == passedWith(2),
    statusOf(cBlockedResume, 1, 1) == Awaiting,
    accounted(cBlockedResume),

    // and the re-asked evaluator's second-generation completion lands the
    // stage, which is what makes the new generation a new identity.
    named(doneJudged(cBlockedResume, 1, evalOfRun(1, 0, 2, 1), EvaluatorPass))
      == "TicketEvaluationPassed",
    // while an event from the interrupted attempt falls through.
    evolveBoth(cBlockedResume,
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
    latestInstance(dFailAndWall.post, 1).state ==
      EvaluationFailed([{ stageIndex: 0, generation: 1,
        evaluators: Map(1 -> EvaluatorExecutionUnavailable(1),
          2 -> failedWith(2)) }])
  })

  /// AN EVALUATOR THAT DIED PARKS LIKE A WALL and is re-asked. The
  /// protocol reads both terminals the same way at the stage grain: neither
  /// is an answer, so neither makes a judgement, and what the desk can offer
  /// is the same re-ask. The two are still told apart in the run, because
  /// what stopped the evaluator is what the desk has to act on.
  pure val cOneDied: World =
    done(c3, 1, evalOf(1, 0, 1), died(evalOf(1, 0, 1))).post
  pure val dEvaluatorDied =
    doneJudged(cOneDied, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val cDiedResume = resumed(dEvaluatorDied.post, 1).post

  run evaluatorProcessFailureParksTest = assert(and {
    named(dEvaluatorDied) == "TicketEvaluationBlocked",
    latestInstance(dEvaluatorDied.post, 1).state ==
      EvaluationBlocked({ completedStages: [],
        stage: { stageIndex: 0, generation: 1,
          evaluators: Map(1 -> EvaluatorProcessFailed(1),
            2 -> passedWith(2)) } }),
    // and the re-ask names the evaluator that died and no other
    liveTasks(cDiedResume.tickets.get(1)) == Set(evalOfRun(1, 0, 2, 1)),
    statusOf(cDiedResume, 1, 2) == passedWith(2)
  })

  // === The human desk: parks and resumes ===================================

  /// THE RESUME IS THE WALL'S, and nothing else's: resumeOf is total on the
  /// state, so every wall offers the desk exactly one way on, and the
  /// unparked ticket offers none. This is what lets retryableIn ask only
  /// whether the desk holds a task.
  run resumeDerivedFromTheWallTest = assert(and {
    resumeOf(Pending) == NoResume,
    resumeOf(c1.tickets.get(1).state) == NoResume,
    resumeOf(c3.tickets.get(1).state) == NoResume,
    resumeOf(c5.tickets.get(1).state) == NoResume,
    resumeOf(Done) == NoResume,
    resumeOf(Revoked) == NoResume,
    resumeOf(dWorkFail.post.tickets.get(1).state) == ResumeWork,
    resumeOf(dWorkWall.post.tickets.get(1).state) == ResumeWork,
    resumeOf(dEvalEscalate.post.tickets.get(1).state) == ResumeRework,
    resumeOf(cBlockedPark.tickets.get(1).state) == ResumeEvaluation,
    resumeOf(dFinalizationUnavailable.post.tickets.get(1).state)
      == ResumeFinalization,
    not(D::retryableIn(graphOf(c1), 1)),
    D::retryableIn(graphOf(dWorkWall.post), 1)
  })

  /// EVERY PARK IS RETRYABLE, and the resume returns the ticket to the state
  /// its wall implies, the event naming which. The finalization resume owes
  /// the NEXT generation of the cycle's finalization, which is what makes a
  /// late result from the attempt it interrupted one nothing owes.
  pure val cEscFinalizer: World = dFinalizationUnavailable.post
  pure val dResumeFinalizer = resumed(cEscFinalizer, 1)

  pure val cEscWorking: World = only(dWorkFail.post, 1)
  pure val dResumeWorking = resumed(cEscWorking, 1)

  run resumeReturnsToTheWallsStateTest = assert(and {
    named(dResumeFinalizer) == "TicketFinalizationResumed",
    tagOf(dResumeFinalizer.post.tickets.get(1)) == "Finalization",
    D::attemptGeneration(dResumeFinalizer.post.tickets.get(1)) == 2,
    dResumeFinalizer.obligations == [FinalizeTicket({ ticket: 1,
      finalization: { workCycle: 1, generation: 2, input: 101,
        source: srcAccepted },
      configuration: def1.finalizationConfiguration })],
    not(hasOpenHumanTask(dResumeFinalizer.post.tickets.get(1))),
    D::retryableIn(graphOf(cEscFinalizer), 1),
    // the superseded attempt's success is one nothing owes
    evolveBoth(dResumeFinalizer.post, dComplete.event) == dResumeFinalizer.post,
    named(dResumeWorking) == "TicketWorkResumed",
    // the retry runs the input the wall kept, at the source it kept
    dResumeWorking.post.tickets.get(1).state == Work({
      input: retryWorkInput(initialWorkInput(def1), 1), source: srcDispatch }),
    executed(dResumeWorking) == Set(workOf(2)),
    D::retryableIn(graphOf(cEscWorking), 1)
  })

  /// THE EVALUATION-FAILURE WALL'S RESUME: work, again. That wall is
  /// reached by a verdict, which has no re-judge to offer, so it buys a new
  /// artifact instead of a second opinion on the old one; the re-ask a
  /// BLOCKED park gives is pinned above, where an interruption and not a
  /// verdict did the parking.
  pure val cEscRework: World = dStagedWall.post
  pure val dResumeRework = resumed(cEscRework, 1)

  run resumeReworkRespawnsWorkTest = assert(and {
    named(dResumeRework) == "TicketWorkResumed",
    executed(dResumeRework) == Set(workOf(2)),
    tagOf(dResumeRework.post.tickets.get(1)) == "Work",
    not(isEscalated(dResumeRework.post.tickets.get(1).state)),
    // A fresh work cycle above an INTACT instance: the failed judgement
    // stays exactly as it was recorded.
    liveTasks(dResumeRework.post.tickets.get(1)) == Set(workOf(2)),
    instancesOf(dResumeRework.post, 1) == instancesOf(cEscRework, 1),
    accounted(dResumeRework.post)
  })

  // === Direct release, sparse identity, and ticket-local policy ============

  pure val sparseBase = release(cEmpty, 4, Set(), planU2).post
  pure val sparseCore = release(sparseBase, 1, Set(4), planStaged).post

  run releaseSparseIdentityTest = assert(and {
    sparseCore.tickets.keys() == Set(1, 4),
    sparseCore.ledgers.keys() == Set(1, 4),
    sparseCore.tickets.get(1).definition.dependencies == Set(4),
    sparseCore.tickets.get(1).state == Pending,
    D::isBlockedIn(graphOf(sparseCore), 1),
    not(D::canReleaseIn(graphOf(sparseCore), 2)), // count bound reached despite sparse gaps
    not(D::canReleaseIn(graphOf(sparseCore), 4))
  })

  pure val localPolicy: World = release(cEmpty, 2, Set(), planStaged).post

  run releaseMaterializesTicketPolicyTest = assert(and {
    localPolicy.tickets.get(2).definition.evaluationPlan.stages == planStaged,
    localPolicy.tickets.get(2).definition.dependencies == Set(),
    instancesOf(localPolicy, 2) == []
  })

  // === Revoke, from every live state =======================================
  // Every non-terminal may be revoked. Single-ticket fixtures: one per live
  // state (Pending, Work, Evaluation), and the one parked state twice under
  // different walls — the pair is there to show a revoke does not read the
  // wall that parked the ticket, not to enumerate the walls.

  pure def revokedShape(t: Ticket): bool = and {
    t.state == Revoked,
    liveTasks(t) == Set(),          // Revoked RUNS nothing...
    not(hasOpenHumanTask(t))        // ...and opens NO human task: revocation
                                    // is the author's settled choice
  }

  pure val wPend: World = alone(fresh(1, Set(), planU2), emptyLedger)
  pure val wWork: World = only(c1, 1)
  // the one Evaluation fixture: a mid-stage instance
  pure val wEval: World = only(cOneWalled, 1)
  pure val wFinalizer: World = only(c5, 1)
  pure val wEsc: World = only(dWorkFail.post, 1)
  pure val wParkPre: World = only(dWorkWall.post, 1)

  pure def revokeOne(w: World): Stepped =
    stepped(w, decideRevoke(graphOf(w), 1))

  /// A revoke owes one CancelTask per task the fabric was running for the
  /// ticket, and nothing else — no desk task for the revoked ticket.
  pure def revokeOneOk(w: World): bool = and {
    named(revokeOne(w)) == "TicketRevoked",
    revokeOne(w).obligations == cancelLiveTasks(w.tickets.get(1)),
    revokedShape(revokeOne(w).post.tickets.get(1)),
    ledgerOf(revokeOne(w).post, 1).completions == 0
  }

  run revokeFromEachStateTest = assert(and {
    revokeOneOk(wPend), revokeOneOk(wWork), revokeOneOk(wEval),
    revokeOneOk(wEsc), revokeOneOk(wParkPre),
    // Finalization begins the non-revocable boundary.
    not(D::revocableIn(graphOf(wFinalizer), 1))
  })

  /// WHAT A REVOKE CANCELS is exactly what was running: the work cycle's
  /// one task, or the evaluators the run still owed — and nothing for a
  /// ticket that was running nothing.
  run revokeCancelsWhatWasRunningTest = assert(and {
    revokeOne(wWork).obligations ==
      [CancelTask({ ticket: 1, task: workOf(1) })],
    revokeOne(wEval).obligations ==
      [CancelTask({ ticket: 1, task: evalOf(1, 0, 2) })],
    revokeOne(wPend).obligations == [],
    revokeOne(wEsc).obligations == [],
    decisionValid(graphOf(wEval), decideRevoke(graphOf(wEval), 1))
  })

  /// Revoke RETAINS the judgement history — "Revoked runs nothing" is about
  /// what is live, not about what was decided. The instance is closed
  /// exactly as it stood, half-answered evaluators and all, and leaving the
  /// state is already enough to stop its obligations being owed. Provenance
  /// survives the author's settlement.
  run revokeRetainsTheInstanceTest = assert(and {
    instancesOf(revokeOne(wWork).post, 1) == [],
    instancesOf(revokeOne(wEval).post, 1) == instancesOf(wEval, 1),
    instancesOf(revokeOne(wPend).post, 1) == []   // never ran
  })

  /// The absorbing terminals are exactly the unrevocable states.
  run revocableExactlyNonTerminalTest = assert(and {
    D::revocableIn(graphOf(wPend), 1),
    D::revocableIn(graphOf(wEsc), 1),
    not(D::revocableIn(graphOf(c6), 1)),                          // Done
    not(D::revocableIn(graphOf(revokeOne(wPend).post), 1))       // Revoked
  })

  /// REVOKED NEVER COMPLETES: revoking leaves the completion counter at
  /// zero — contrast with the completed ticket (c6), whose counter is 1 and
  /// which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    ledgerOf(revokeOne(wEsc).post, 1).completions == 0,
    ledgerOf(c6, 1).completions == 1
  })

  // === REVOKE TOUCHES ONE TICKET, on a 3-ticket chain ======================
  // 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 a
  // Pending behind 2. Revoking 1 settles 1 and moves nothing else: the two
  // dependents stay where their own authors left them.

  pure val cChain: World = {
    tickets: Map(
      1 -> fresh(1, Set(), planU2),
      2 -> fresh(2, Set(1), planU2),
      3 -> fresh(3, Set(2), planU2)),
    ledgers: Map(1 -> emptyLedger, 2 -> emptyLedger, 3 -> emptyLedger)
  }
  pure val dChainRevoke = stepped(cChain, decideRevoke(graphOf(cChain), 1))
  pure val cStranded = dChainRevoke.post

  run revokeMovesOnlyItsOwnTicketTest = assert(and {
    named(dChainRevoke) == "TicketRevoked",
    // no dependent moved, so nothing is owed for one
    dChainRevoke.obligations == [],
    revokedShape(cStranded.tickets.get(1)),
    cStranded.tickets.get(2) == cChain.tickets.get(2),
    cStranded.tickets.get(3) == cChain.tickets.get(3),
    cStranded.ledgers == cChain.ledgers,
    not(hasOpenHumanTask(cStranded.tickets.get(2))),
    not(hasOpenHumanTask(cStranded.tickets.get(3)))
  })

  /// A ticket behind a revoked dependency STAYS PENDING and stays its
  /// author's: it is never Ready (a dep that is not Done blocks, and
  /// Revoked never becomes Done), revoke is still offered on it, and no
  /// release may point a new ticket at the tombstone.
  run strandedDependentWaitsForItsAuthorTest = assert(and {
    cStranded.tickets.get(2).state == Pending,
    D::isBlockedIn(graphOf(cStranded), 2),
    not(isReady(graphOf(cStranded), 2)),
    D::revocableIn(graphOf(cStranded), 2),
    D::revocableIn(graphOf(cStranded), 3),
    not(D::dependableIn(graphOf(cStranded)).contains(1)),
    D::dependableIn(graphOf(cStranded)).contains(2)
  })

  // === Finalization is not a TicketGraph lease protocol ===================

  run finalizationBoundaryTest = assert(and {
    not(D::revocableIn(graphOf(c5), 1)),
    not(D::revocableIn(graphOf(dStagedFinal.post), 1))
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
    artifactIn(c1, 1) == NoArtifact,
    artifactIn(c3, 1) == ProducedArtifact(101),
    latestInstance(c3, 1).input.workResult == 101,
    latestInstance(c3, 1).input.workResult != latestInstance(c3, 1).workCycle,
    // The rework fixture walks a second cycle; its product differs from the
    // first, which a stamp-once mutant would fail.
    artifactIn(dBackToEval.post, 1) != NoArtifact,
    artifactIn(dBackToEval.post, 1) != artifactIn(dToEval.post, 1),
    // and a Done ticket's artifact, read from its closed instance, is what
    // a dependent names
    artifactIn(c6, 1) == ProducedArtifact(101),
    D::depArtifacts({ tickets: c6.tickets.put(2, fresh(2, Set(1), planU2)) },
      c6.ledgers.put(2, emptyLedger), 2) == Set(ProducedArtifact(101))
  })

  /// A dependency gate depends only on the released predecessor's state.
  pure val cXDepPre: World = {
    tickets: Map(1 -> c5.tickets.get(1), 2 -> fresh(2, Set(1), planU2)),
    ledgers: Map(1 -> ledgerOf(c5, 1), 2 -> emptyLedger)
  }
  pure val cXDepDone: World = {
    tickets: Map(1 -> c6.tickets.get(1), 2 -> fresh(2, Set(1), planU2)),
    ledgers: Map(1 -> ledgerOf(c6, 1), 2 -> emptyLedger)
  }

  run dependencyGateTest = assert(and {
    D::isBlockedIn(graphOf(cXDepPre), 2),
    not(isReady(graphOf(cXDepPre), 2)),
    isReady(graphOf(cXDepDone), 2),
    not(D::isBlockedIn(graphOf(cXDepDone), 2))
  })

  // === The ledger's fold ===================================================
  // Each claim below is one arm of domain.qnt ledgerStep, pinned on the
  // decisions the walks above took.

  /// A RELEASE OPENS AN EMPTY LEDGER, and a release of a ticket that exists
  /// opens none.
  run ledgerCreatedOpensEmptyTest = assert(and {
    ledgerOf(cA1, 1) == emptyLedger,
    ledgerOf(cA2, 3) == emptyLedger,
    cA2.ledgers.keys() == cA2.tickets.keys(),
    D::evolveLedgers(graphOf(cA2), cA2.ledgers, dRelease.event) == cA2.ledgers
  })

  /// A DISPATCH CLAIMS ONE SLOT, for the work cycle it starts.
  run ledgerDispatchClaimsOneTest = assert(and {
    ledgerOf(c0, 1).spawned == 0,
    ledgerOf(c1, 1).spawned == 1,
    ledgerOf(c1, 1).closedEvaluations == []
  })

  /// AN ACCEPTED WORK RESULT CLAIMS THE FIRST STAGE'S ROSTER: two on the
  /// default plan, one on the staged plan, one on the sparse stage.
  run ledgerAcceptClaimsFirstRosterTest = assert(and {
    ledgerOf(c3, 1).spawned == ledgerOf(c1, 1).spawned + 2,
    ledgerOf(cS0, 1).spawned == ledgerOf(cStagedWork, 1).spawned + 1,
    ledgerOf(cSparse3, 1).spawned == ledgerOf(cSparse1, 1).spawned + 1
  })

  /// A REPORT THAT LEAVES ITS STAGE RUNNING CLAIMS NOTHING: a verdict, a
  /// wall against one evaluator, and the first of the next stage's two.
  run ledgerProgressWithinStageClaimsNothingTest = assert(and {
    ledgerOf(c4, 1) == ledgerOf(c3, 1),
    ledgerOf(cOneWalled, 1) == ledgerOf(c3, 1),
    ledgerOf(dS1a.post, 1) == ledgerOf(cS1, 1)
  })

  /// A STAGE ADVANCE CLAIMS THE NEXT STAGE'S ROSTER.
  run ledgerStageAdvanceClaimsNextRosterTest = assert(and {
    ledgerOf(cS1, 1).spawned == ledgerOf(cS0, 1).spawned + 2,
    ledgerOf(cS1, 1).closedEvaluations == []
  })

  /// A BLOCKED-WALL RESUME CLAIMS THE ROSTER AGAIN, though it asks only the
  /// evaluator the wall stopped: the slot left unasked is a gap.
  run ledgerBlockedResumeClaimsRosterAgainTest = assert(and {
    ledgerOf(cBlockedPark, 1) == ledgerOf(cOneWalled, 1),
    ledgerOf(cBlockedResume, 1).spawned == ledgerOf(cBlockedPark, 1).spawned + 2,
    executed(dBlockedResume).size() == 1
  })

  /// A PASS CLOSES THE OPEN INSTANCE with the concluding report applied, and
  /// the state it lands in holds none.
  run ledgerPassClosesInstanceTest = assert(and {
    ledgerOf(c4, 1).closedEvaluations == [],
    ledgerOf(c5, 1).closedEvaluations == [applyEvaluationReport(
      latestInstance(c4, 1), judgedReport(c4, 1, evalOf(1, 0, 2), EvaluatorPass))],
    heldInstances(c5.tickets.get(1).state) == [],
    ledgerOf(c5, 1).spawned == ledgerOf(c4, 1).spawned,
    // and finalization moves no instance
    ledgerOf(c6, 1).closedEvaluations == ledgerOf(c5, 1).closedEvaluations
  })

  /// AN EVALUATION FAILURE CLOSES THE INSTANCE LIKEWISE, on either edge; the
  /// rework's closed instance judged a cycle the ticket has since moved past.
  pure val failingReport: TaskTerminalReport =
    judgedReport(cEvalFail, 1, evalOf(1, 0, 2), EvaluatorPass)
  pure val failedInstance: EvaluationInstance =
    applyEvaluationReport(latestInstance(cEvalFail, 1), failingReport)

  run ledgerEvaluationFailureClosesInstanceTest = assert(and {
    ledgerOf(dEvalRework.post, 1).closedEvaluations == [failedInstance],
    ledgerOf(dEvalEscalate.post, 1).closedEvaluations == [failedInstance],
    match failedInstance.state {
      | EvaluationFailed(_) => true
      | _ => false
    },
    failedInstance.workCycle <
      dEvalRework.post.tickets.get(1).workCyclesStarted,
    // the rework claims one slot for its cycle; the escalation claims none
    ledgerOf(dEvalRework.post, 1).spawned == ledgerOf(cEvalFail, 1).spawned + 1,
    ledgerOf(dEvalEscalate.post, 1).spawned == ledgerOf(cEvalFail, 1).spawned
  })

  /// A REVOKE FROM EVALUATION CLOSES THE INSTANCE AS IT STOOD, still
  /// running and with the evaluator it still owed unanswered.
  run ledgerRevokeClosesAsItStoodTest = assert(and {
    ledgerOf(revokeOne(wEval).post, 1).closedEvaluations ==
      [latestInstance(wEval, 1)],
    match latestInstance(wEval, 1).state {
      | Running(_) => true
      | _ => false
    },
    ledgerOf(revokeOne(wEval).post, 1).spawned == ledgerOf(wEval, 1).spawned
  })

  /// COMPLETIONS COUNTS THE ARRIVAL AT DONE, once.
  run ledgerCompletionCountsDoneTest = assert(and {
    ledgerOf(c5, 1).completions == 0,
    ledgerOf(c6, 1).completions == 1,
    ledgerOf(dFinalizationRework.post, 1).completions == 0,
    ledgerOf(dFinalizationUnavailable.post, 1).completions == 0,
    D::evolveLedgers(graphOf(c6), c6.ledgers, dComplete.event) == c6.ledgers
  })

  /// AN EVENT THAT LEAVES ITS TICKET ALONE LEAVES ITS LEDGER ALONE, whatever
  /// that ledger holds: the fold reads the move and nothing else.
  pure val someLedger: TicketLedger =
    { closedEvaluations: [latestInstance(c3, 1)], spawned: 7, completions: 0 }

  run ledgerStillWhereTicketStillTest = assert(and {
    D::ledgerStep(c3.tickets.get(1), workFailedFact(workOf(1)), someLedger)
      == someLedger,
    D::ledgerStep(c4.tickets.get(1),
      progressedFact(staleVerdict(evalOf(1, 0, 1), EvaluatorFail)), someLedger)
      == someLedger,
    D::ledgerStep(c6.tickets.get(1), TicketRevoked(1), someLedger)
      == someLedger,
    D::ledgerStep(c5.tickets.get(1), TicketFinalizationSucceeded({ ticket: 1,
      workCycle: 1, generation: 2, evidence: evidence }), someLedger)
      == someLedger
  })

  /// EVERY HAND-BUILT FIXTURE IN THIS FILE IS A SHAPE THE MACHINE COULD HAVE
  /// REACHED. idsAccounted is a machine invariant, so the randomized runs and
  /// the witness suites check it after every step the machine takes — and on
  /// nothing this file writes by hand. A fixture whose ledger disagrees with
  /// its ticket is not a state any trace reaches, so the equality has to be
  /// asserted where the state is written. This is that assertion, and the
  /// reason a new fixture cannot repeat the mistake quietly.
  run handBuiltFixturesAccountedTest = assert(and {
    accounted(cChain), accounted(cXDepPre), accounted(cXDepDone),
    accounted(wPend)
  })

  /// AND EVERY INSTANCE THIS FILE REACHES SATISFIES THE PROTOCOL'S OWN
  /// INVARIANT. The machine invariant quantifies over reachable states;
  /// this pins it on the states the deciders here walked to, closed
  /// instances and open ones alike, which is where a decider that advanced
  /// an instance wrongly would show up first.
  pure def instancesValid(c: World): bool =
    c.tickets.keys().forall(j =>
      instancesOf(c, j).indices().forall(i =>
        invariant(instancesOf(c, j)[i])))

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
    instancesValid(dEvalRework.post), instancesValid(dEvalEscalate.post),
    instancesValid(revokeOne(wEval).post)
  })
}
