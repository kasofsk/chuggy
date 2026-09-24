/// Refinement tests for the journaled actor. These tests deliberately drive
/// TicketCommand values through the same pure deciders as the live actor,
/// and replay the events they journal through evolve, including the sparse
/// native ticket id and materialized ticket policy TicketCreated carries.

/// THE RELEASED RECORD these suites drive with, at the scale the refinement
/// instance is bound to: one stage listing one evaluator, and a distinct
/// small positive reference per slot so a reader can see which one travelled.
/// Stated here rather than drawn from domain.qnt's release action, because
/// these suites drive the journal directly and the domain instance they
/// check is the refinement module's own.
module chuggy_refinement_fixture {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"

  pure def defOf(slot: int): TaskDefinition = {
    workload: 4 * slot - 3, inputs: 4 * slot - 2,
    executionRequirements: 4 * slot - 1, resultContract: 4 * slot }
  pure val planFlat: List[StageDefinition] =
    [{ key: 1, evaluators: [{ key: 1, task: defOf(1) }] }]
  pure def released(id: int): ReleasedTicket = {
    id: id, content: 1, dependencies: Set(),
    workConfiguration: defOf(2), evaluationPlan: { stages: planFlat },
    finalizationConfiguration: 2 }

  /// One member of each of domain.qnt's two source draw sets. Which one an
  /// environment observes is no suite's subject; that they come from
  /// disjoint sets is what makes a dispatch's source tell itself from an
  /// acceptance's in a journal.
  pure val aDispatchSource: int = 9
  pure val anAcceptedSource: int = 11
  pure val aFinalizationEvidence: int = 15

  /// WHAT THE SUITES READ OFF A TICKET'S STATE, by name: the state's own
  /// constructor, the wall a parked ticket names ("" unparked), and the
  /// instance it holds open (read only where it holds one).
  pure def stateName(jb: Ticket): str = match jb.state {
    | Pending => "Pending"
    | Work(_) => "Work"
    | Evaluation(_) => "Evaluation"
    | Finalization(_) => "Finalization"
    | Escalated(_) => "Escalated"
    | Done => "Done"
    | Revoked => "Revoked"
  }
  pure def wallName(jb: Ticket): str = match jb.state {
    | Escalated(escalation) => match escalation {
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
  pure def openInstance(jb: Ticket): EvaluationInstance =
    heldInstances(jb.state)[0]
}

module chuggy_refinement_unit_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*
  /// The refinement's own instance, for the ledger fold it does not
  /// re-expose.
  import chuggy_domain(
    N_TICKETS = 2, N_TASKS = 1, MAX_STAGES = 1
  ) as D from "../domain"

  /// Decide at a graph, under the rework edge a passing report never asks.
  /// Every command decided here is one the graph accepts; a refused one
  /// would come back as a placeholder no journal check accepts.
  pure def acceptedAt(c: TicketGraph, command: TicketCommand): SuccessfulTicketDecision =
    match decideAt(c, command, ReworkEvaluationFailure) {
      | TicketDecided(d) => d
      | TicketRefused(_) => { event: TicketRevoked(0), obligations: [] }
    }

  pure val release10: TicketCommand = CreateTicket(released(2))
  pure val d1 = acceptedAt(genesis, release10)
  pure val g1 = evolveGraph(genesis, d1.event)
  pure val e1: Entry = { seq: 1, event: d1.event }
  pure val dispatch10: TicketCommand =
    DispatchTicket({ ticket: 2, source: aDispatchSource })
  pure val d2 = acceptedAt(g1, dispatch10)
  pure val g2 = evolveGraph(g1, d2.event)
  pure val e2: Entry = { seq: 2, event: d2.event }
  pure val goodJ: List[Entry] = [e1, e2]

  /// A completion at the obligation the graph says the ticket owes the task.
  pure def workDone(c: TicketGraph, ticket: int,
      task: TaskIdentity): TicketCommand =
    ReportTaskTerminal(WorkResultReport({ ticket: ticket,
      result: producedResult(c.tickets.get(ticket), task),
      acceptedSourceRef: anAcceptedSource }))
  pure def wallDone(ticket: int, task: TaskIdentity): TicketCommand =
    ReportTaskTerminal(TerminalFailureReport({ ticket: ticket,
      failure: { task: task, evidence: taskRefOf(task) },
      kind: ExecutionUnavailableFailure }))

  run genesisReplayTest = assert(and {
    journalLegalOn([]), replayGraph([]) == genesis
  })

  run sparseReleaseReplayTest = assert(and {
    answerAt(genesis, release10) == "TicketCreated",
    d1.event == TicketCreated(released(2)),
    journalLegalOn(goodJ),
    replayGraph(goodJ) == g2,
    replayGraph(goodJ).tickets.keys() == Set(2),
    stateName(replayGraph(goodJ).tickets.get(2)) == "Work",
    liveTasks(replayGraph(goodJ).tickets.get(2)) == Set(workTaskIdentity(2, 1))
  })

  run replayAppendAgreesTest = assert(and {
    replayGraph(goodJ) == evolveGraph(replayGraph([e1]), d2.event),
    replayGraph([e1]) == g1
  })

  /// THE JOURNAL IS REFUSED WHERE A ROW COULD NOT HAVE BEEN DECIDED: a seq
  /// out of the dense order; an event whose ticket does not stand (a
  /// release of one that exists, or anything about one that does not); and
  /// an event that no longer moves the state it lands on — a replayed row,
  /// or one a later row has made stale. Nothing here restates evolve's
  /// guards: "moved" is the whole check, and eventsNeverIdentity is what
  /// keeps it from refusing a decided row.
  pure val accepted2 = acceptedAt(g2, workDone(g2, 2, workTaskIdentity(2, 1)))
  pure val e3: Entry = { seq: 3, event: accepted2.event }
  run journalRefusesWhatCouldNotHaveBeenDecidedTest = assert(and {
    not(journalLegalOn([{ ...e1, seq: 2 }])),
    not(journalLegalOn([e1, { ...e2, seq: 3 }])),
    not(journalLegalOn([e1, { ...e2, seq: 1 }])),
    // a ticket that does not stand
    not(journalLegalOn([{ ...e2, seq: 1 }])),
    not(journalLegalOn([e1, { ...e1, seq: 2 }])),
    // an event that does not move its prefix
    not(journalLegalOn([e1, e2, { ...e2, seq: 3 }])),
    journalLegalOn([e1, e2, e3]),
    not(journalLegalOn([e1, e2, e3, { ...e3, seq: 4 }])),
    not(journalLegalOn([e1, e2, e3, { seq: 4,
      event: TicketWorkProcessFailed({ ticket: 2, task: workTaskIdentity(2, 1),
        evidence: 1 }) }]))
  })

  /// A COMMAND ABOUT A TICKET THAT DOES NOT EXIST is refused, whichever
  /// command it is.
  run commandsForAbsentTicketsAreRefusedTest = assert(and {
    answerAt(genesis, dispatch10) == "TicketNotFound",
    answerAt(genesis, workDone(g2, 2, workTaskIdentity(2, 1))) == "TicketNotFound",
    answerAt(genesis, wallDone(2, workTaskIdentity(2, 1))) == "TicketNotFound",
    answerAt(genesis, ReportFinalizationResult({ ticket: 2, workCycle: 1,
      generation: 1, result: FinalizationSucceeded(aFinalizationEvidence) }))
      == "TicketNotFound",
    answerAt(genesis, RevokeTicket(2)) == "TicketNotFound",
    answerAt(genesis, ResumeTicket(2)) == "TicketNotFound"
  })

  /// A REPORT IS ACCEPTED ONLY FOR A TASK THE TICKET OWES, AT THE OBLIGATION
  /// IT OWES IT, and each way to miss is one no fabric playing by the rules
  /// produces. A reference at zero is not a report the actor takes at all
  /// (commandTaken: the wire integers are positive, so zero is a hole where
  /// a result should be), and neither is a failure with no evidence. A
  /// verdict carried by a WORK task, which judges nothing, a failure naming
  /// a task the ticket does not owe, and — the exact-obligation rule — a
  /// result whose obligation is not the one this ticket owes for the task,
  /// which is a result for a spawn it never made, are refused TaskNotCurrent.
  pure val owed2 = producedResult(g2.tickets.get(2), workTaskIdentity(2, 1))
  run reportAdmissibilityRequiredTest = assert(and {
    answerAt(g2, ReportTaskTerminal(WorkResultReport({ ticket: 2,
      result: { ...owed2, resultRef: 0 },
      acceptedSourceRef: anAcceptedSource }))) == "",
    answerAt(g2, ReportTaskTerminal(TerminalFailureReport({ ticket: 2,
      failure: { task: workTaskIdentity(2, 1), evidence: 0 },
      kind: ProcessFailure }))) == "",
    answerAt(g2, ReportTaskTerminal(EvaluationResultReport({ ticket: 2,
      result: owed2, verdict: EvaluatorPass }))) == "TaskNotCurrent",
    answerAt(g2, ReportTaskTerminal(TerminalFailureReport({ ticket: 2,
      failure: { task: workTaskIdentity(2, 2), evidence: 1 },
      kind: ProcessFailure }))) == "TaskNotCurrent",
    answerAt(g2, ReportTaskTerminal(WorkResultReport({ ticket: 2,
      result: { ...owed2, obligation: { ...owed2.obligation,
        contextRef: owed2.obligation.contextRef + 1 } },
      acceptedSourceRef: anAcceptedSource }))) == "TaskNotCurrent",
    answerAt(g2, workDone(g2, 2, workTaskIdentity(2, 1))) == "TicketWorkResultAccepted",
    answerAt(g2, wallDone(2, workTaskIdentity(2, 1))) == "TicketWorkExecutionUnavailable"
  })

  /// THE RELEASE'S SHAPE RULE, CONJUNCT BY CONJUNCT. The released record is
  /// authored input and commandTaken is the only place its shape is
  /// weighed, so every conjunct of releasedTicketValid a payload can refute
  /// is refuted here: one a case does not reach is one the actor would go on
  /// taking if it were deleted. A dependency that does not exist is not a
  /// shape: the record is taken and the release refused.
  run journalRefusesInvalidReleasePayloadTest =
    val missingDep: TicketCommand =                     // no such ticket
      CreateTicket({ ...released(2), dependencies: Set(99) })
    val badId: TicketCommand =                          // id at zero
      CreateTicket({ ...released(2), id: 0 })
    val badDeps: TicketCommand =                        // dependency at zero
      CreateTicket({ ...released(2), dependencies: Set(0) })
    val badPlan: TicketCommand =                        // empty plan
      CreateTicket({ ...released(2), evaluationPlan: { stages: [] } })
    val badContent: TicketCommand =                     // content ref
      CreateTicket({ ...released(2), content: 0 })
    val badFinalization: TicketCommand =                // finalization ref
      CreateTicket({ ...released(2), finalizationConfiguration: 0 })
    val badWork: TicketCommand =                        // work definition ref
      CreateTicket({ ...released(2),
        workConfiguration: { ...defOf(2), resultContract: 0 } })
    val badEvaluatorTask: TicketCommand =               // evaluator's own ref
      CreateTicket({ ...released(2), evaluationPlan: { stages:
        [{ key: 1,
           evaluators: [{ key: 1, task: { ...defOf(1), workload: 0 } }] }] } })
    val badEvaluatorTwice: TicketCommand =              // repeated key
      CreateTicket({ ...released(2), evaluationPlan: { stages:
        [{ key: 1, evaluators: [{ key: 1, task: defOf(1) },
                                { key: 1, task: defOf(1) }] }] } })
    val badStageKey: TicketCommand =                    // key off its position
      CreateTicket({ ...released(2), evaluationPlan: { stages:
        [{ key: 2, evaluators: [{ key: 1, task: defOf(1) }] }] } })
    val badEvaluatorKey: TicketCommand =                // key past N_TASKS = 1
      CreateTicket({ ...released(2), evaluationPlan: { stages:
        [{ key: 1, evaluators: [{ key: 2, task: defOf(1) }] }] } })
    val badStageCount: TicketCommand =                  // past MAX_STAGES = 1
      CreateTicket({ ...released(2), evaluationPlan: { stages:
        [{ key: 1, evaluators: [{ key: 1, task: defOf(1) }] },
         { key: 2, evaluators: [{ key: 1, task: defOf(1) }] }] } })
    assert(and {
      answerAt(genesis, release10) == "TicketCreated",
      answerAt(genesis, missingDep) == "DependenciesNotFound",
      answerAt(genesis, badId) == "",
      answerAt(genesis, badDeps) == "",
      answerAt(genesis, badPlan) == "",
      answerAt(genesis, badContent) == "",
      answerAt(genesis, badFinalization) == "",
      answerAt(genesis, badWork) == "",
      answerAt(genesis, badEvaluatorTask) == "",
      answerAt(genesis, badEvaluatorTwice) == "",
      answerAt(genesis, badStageKey) == "",
      answerAt(genesis, badEvaluatorKey) == "",
      answerAt(genesis, badStageCount) == ""
    })

  /// A DISPATCH NAMES A SOURCE SOMETHING OBSERVED. The ticket is ready and
  /// the payload is otherwise the one goodJ carries, so the refusal is the
  /// source conjunct's alone. Nothing playing by the rules offers a zero —
  /// the writer mints the command from its own observation — which makes
  /// this the guard's proof rather than its behaviour, and the guard is what
  /// stands between a client's dispatch and a source nobody read.
  run journalRefusesUnobservedDispatchSourceTest = assert(and {
    answerAt(g1, dispatch10) == "TicketDispatched",
    answerAt(g1, DispatchTicket({ ticket: 2, source: 0 })) == ""
  })

  run worldArithmeticTest = assert(and {
    journalSpawnsOn(goodJ, 2) == 1,
    worldSpawnsOn(goodJ, Set(), [], 2) == 0,
    worldSpawnsOn(goodJ, Set(1, 2), [], 2) == 1,
    worldSpawnsOn(goodJ, Set(1, 2), [d2.event], 2) == 2,
    journalCompletionsOn(goodJ, 2) == 0,
    // an acceptance owes evaluators, not a work cycle: it spends no work
    journalSpawnsOn([e1, e2, e3], 2) == 1
  })

  /// THE EVENT CARRIES THE RESULT REFERENCE, AND REPLAY READS IT. Two
  /// completions differing only in their reference are admitted alike —
  /// the admission weighs the whole obligation and never the reference — and
  /// replay to DIFFERENT states, because the reference the report carried is
  /// what the judgement of that result is opened over, and so the ticket's
  /// artifact. A machine deriving it from the work identity would replay
  /// both to the same state, and the journal would then not be the
  /// authority on what the cycle produced.
  run taskCompletionPinsItsResultReferenceTest =
    val realCommand = workDone(g2, 2, workTaskIdentity(2, 1))
    val otherRef = ReportTaskTerminal(WorkResultReport({ ticket: 2,
      result: { ...owed2, resultRef: 99 },
      acceptedSourceRef: anAcceptedSource }))
    val realEvent = acceptedAt(g2, realCommand).event
    val otherEvent = acceptedAt(g2, otherRef).event
    val real = evolveGraph(g2, realEvent)
    val other = evolveGraph(g2, otherEvent)
    val realLedger = D::evolveLedgers(g2, replayLedgers(goodJ), realEvent).get(2)
    val otherLedger = D::evolveLedgers(g2, replayLedgers(goodJ), otherEvent).get(2)
    assert(and {
      answerAt(g2, realCommand) == "TicketWorkResultAccepted",
      answerAt(g2, otherRef) == "TicketWorkResultAccepted",
      realCommand != otherRef,
      real != other,
      artifactOf(real.tickets.get(2), realLedger) ==
        ProducedArtifact(owed2.resultRef),
      artifactOf(other.tickets.get(2), otherLedger) == ProducedArtifact(99),
      stateName(real.tickets.get(2)) == "Evaluation"
    })

  /// A REWORKED TICKET, journaled: accepted work whose one evaluator fails
  /// under the rework edge, so the ticket is in Work on its second cycle and
  /// the first cycle's task is settled.
  pure val g3 = evolveGraph(g2, accepted2.event)
  pure val reworked3 = acceptedAt(g3, ReportTaskTerminal(EvaluationResultReport({
    ticket: 2,
    result: producedResult(g3.tickets.get(2), evaluatorTaskIdentity(2, 1, 1, 1, 1)),
    verdict: EvaluatorFail })))
  pure val e4: Entry = { seq: 4, event: reworked3.event }
  pure val reworkJ: List[Entry] = [e1, e2, e3, e4]
  pure val g4 = replayGraph(reworkJ)
  pure def processFailedRow(cycle: int): Entry = { seq: 5,
    event: TicketWorkProcessFailed({ ticket: 2,
      task: workTaskIdentity(2, cycle), evidence: 1 }) }
  pure def unavailableRow(cycle: int): Entry = { seq: 5,
    event: TicketWorkExecutionUnavailable({ ticket: 2,
      task: workTaskIdentity(2, cycle), evidence: 1 }) }

  run reworkJournalReplaysToSecondCycleTest = assert(and {
    eventNameOf(reworked3.event) == "TicketEvaluationReworkStarted",
    journalLegalOn(reworkJ),
    stateName(g4.tickets.get(2)) == "Work",
    g4.tickets.get(2).workCyclesStarted == 2
  })

  /// A FORGED STALE WORK FAILURE IS REFUSED. evolve parks a ticket in Work
  /// on any work failure without asking which task failed, so a row naming
  /// the settled cycle's task moves the state like the current one's would;
  /// only journalLegalOn's current-task check tells them apart.
  run forgedStaleProcessFailureRowTest = assert(and {
    evolveGraph(g4, processFailedRow(1).event) != g4,
    not(journalLegalOn(reworkJ.append(processFailedRow(1)))),
    not(journalLegalOn(reworkJ.append(processFailedRow(3)))),
    journalLegalOn(reworkJ.append(processFailedRow(2)))
  })

  run forgedStaleExecutionUnavailableRowTest = assert(and {
    evolveGraph(g4, unavailableRow(1).event) != g4,
    not(journalLegalOn(reworkJ.append(unavailableRow(1)))),
    not(journalLegalOn(reworkJ.append(unavailableRow(3)))),
    journalLegalOn(reworkJ.append(unavailableRow(2)))
  })

  /// A WORK FAILURE NAMING ANOTHER TICKET'S RUNNING TASK IS REFUSED, though
  /// both tickets run the same cycle, so only the task's ticket tells the
  /// forged row from an honest one.
  pure val d3b = acceptedAt(g2, CreateTicket(released(1)))
  pure val g3b = evolveGraph(g2, d3b.event)
  pure val d4b = acceptedAt(g3b, DispatchTicket({ ticket: 1, source: aDispatchSource }))
  pure val bothJ: List[Entry] =
    [e1, e2, { seq: 3, event: d3b.event }, { seq: 4, event: d4b.event }]
  pure val g4b = replayGraph(bothJ)
  pure def failureOfFirstNaming(owner: int): Entry = { seq: 5,
    event: TicketWorkProcessFailed({ ticket: 1,
      task: workTaskIdentity(owner, 1), evidence: 1 }) }
  pure def unavailableOfFirstNaming(owner: int): Entry = { seq: 5,
    event: TicketWorkExecutionUnavailable({ ticket: 1,
      task: workTaskIdentity(owner, 1), evidence: 1 }) }

  run forgedOtherTicketFailureRowTest = assert(and {
    journalLegalOn(bothJ),
    g4b.tickets.get(1).workCyclesStarted == 1,
    g4b.tickets.get(2).workCyclesStarted == 1,
    evolveGraph(g4b, failureOfFirstNaming(2).event) != g4b,
    not(journalLegalOn(bothJ.append(failureOfFirstNaming(2)))),
    journalLegalOn(bothJ.append(failureOfFirstNaming(1))),
    not(journalLegalOn(bothJ.append(unavailableOfFirstNaming(2)))),
    journalLegalOn(bothJ.append(unavailableOfFirstNaming(1)))
  })

  /// RECOVERY REBUILDS THE LEDGERS: replaying the journal is the ledger fold
  /// taken one row at a time beside the graph, and the rebuilt ledger holds
  /// the instance the rework closed.
  run replayRebuildsLedgersTest =
    val l1 = D::evolveLedgers(genesis, Map(), e1.event)
    val l2 = D::evolveLedgers(g1, l1, e2.event)
    val l3 = D::evolveLedgers(g2, l2, e3.event)
    val l4 = D::evolveLedgers(g3, l3, e4.event)
    assert(and {
      replayLedgers([]) == Map(),
      replayLedgers([e1]) == l1,
      replayLedgers(goodJ) == l2,
      replayLedgers([e1, e2, e3]) == l3,
      replayLedgers(reworkJ) == l4,
      l1.get(2) == emptyLedger,
      l3.get(2).closedEvaluations == [],
      l4.get(2).closedEvaluations.length() == 1,
      l4.get(2).closedEvaluations[0].workCycle == 1,
      match l4.get(2).closedEvaluations[0].state {
        | EvaluationFailed(_) => true
        | _ => false
      },
      l4.get(2).spawned == g4.tickets.get(2).workCyclesStarted +
        evaluationSpawnTotal(ledgerInstances(g4.tickets.get(2), l4.get(2))),
      l4.get(2).completions == 0
    })

  /// THE LEDGER'S COMPLETIONS GHOST IS WHAT journalCompletionsMatchLedger
  /// HOLDS THE JOURNAL TO: before the finalizer's success both sides are
  /// zero, and after it the journal's one completion is the ledger's.
  pure val finalizationSucceeded2: TicketCommand =
    ReportFinalizationResult({ ticket: 2, workCycle: 1, generation: 1,
      result: FinalizationSucceeded(aFinalizationEvidence) })
  run journalCompletionsMatchLedgerReadsTheLedgerTest =
    rinit
      .then(journalStep(release10, ReworkEvaluationFailure))
      .then(journalStep(dispatch10, ReworkEvaluationFailure))
      .then(journalStep(workDone(memGraph, 2, workTaskIdentity(2, 1)),
        ReworkEvaluationFailure))
      .then(journalStep(ReportTaskTerminal(EvaluationResultReport({ ticket: 2,
        result: producedResult(memGraph.tickets.get(2),
          evaluatorTaskIdentity(2, 1, 1, 1, 1)),
        verdict: EvaluatorPass })), ReworkEvaluationFailure))
      .expect(and {
        memLedgers.get(2).completions == 0, journalCompletions(2) == 0,
        journalCompletionsMatchLedger
      })
      .then(journalStep(finalizationSucceeded2, ReworkEvaluationFailure))
      .expect(and {
        memGraph.tickets.get(2).state == Done,
        memLedgers.get(2).completions == 1, journalCompletions(2) == 1,
        journalCompletionsMatchLedger,
        replayLedgers(journal) == memLedgers
      })
}

module chuggy_refinement_witness_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*

  pure def release(ticket: int): TicketCommand = CreateTicket(released(ticket))
  pure val dispatch2: TicketCommand =
    DispatchTicket({ ticket: 2, source: aDispatchSource })

  /// The produced reports, at the obligation the actor's memory says the
  /// ticket owes: a report carrying any other is one `decide` refuses.
  def workDone(ticket: int, task: TaskIdentity): TicketCommand =
    ReportTaskTerminal(WorkResultReport({ ticket: ticket,
      result: producedResult(memGraph.tickets.get(ticket), task),
      acceptedSourceRef: anAcceptedSource }))
  /// Every judgement below walks a PASSING stage, where the disposition is
  /// not consulted; it is named once here so the walks stay about recovery.
  def judged(ticket: int, task: TaskIdentity,
      v: EvaluationVerdict): TicketCommand =
    ReportTaskTerminal(EvaluationResultReport({ ticket: ticket,
      result: producedResult(memGraph.tickets.get(ticket), task),
      verdict: v }))
  pure def walled(ticket: int, task: TaskIdentity): TicketCommand =
    ReportTaskTerminal(TerminalFailureReport({ ticket: ticket,
      failure: { task: task, evidence: taskRefOf(task) },
      kind: ExecutionUnavailableFailure }))
  pure def evalTask(ticket: int, cycle: int, generation: int): TaskIdentity =
    evaluatorTaskIdentity(ticket, cycle, 1, generation, 1)
  pure def finalizationOf(cycle: int,
      result: FinalizationResult): TicketCommand =
    ReportFinalizationResult({ ticket: 2, workCycle: cycle, generation: 1,
      result: result })
  pure val succeeded: TicketCommand =
    finalizationOf(1, FinalizationSucceeded(aFinalizationEvidence))

  /// The event a step journaled, by its constructor's name.
  val lastName: str = match obs {
    | Decided(d) => eventNameOf(d.event)
    | _ => ""
  }

  action stepEmit(command: TicketCommand, name: str): bool =
    journalStep(command, ReworkEvaluationFailure)
      .expect(and { lastName == name, allDomainInvariants, refinementInvariants })
      .then(emitNext)
      .expect(and { allDomainInvariants, refinementInvariants })

  /// A wall against WORK retires the cycle's task, survives recovery, and
  /// resumes by spawning a fresh one under the ticket's pinned policy.
  run executionBlockedResumeRecoversTest =
    rinit
      .then(stepEmit(release(2), "TicketCreated"))
      .then(stepEmit(dispatch2, "TicketDispatched"))
      .then(journalStep(walled(2, workTaskIdentity(2, 1)), ReworkEvaluationFailure))
      .expect(and {
        wallName(memGraph.tickets.get(2)) == "WorkExecutionUnavailableEscalated",
        liveTasks(memGraph.tickets.get(2)) == Set(),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(2))
      .expect(and {
        isEscalated(memGraph.tickets.get(2).state),
        worldSpawns(2) == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(emitNext)
      .then(stepEmit(ResumeTicket(2), "TicketWorkResumed"))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Work",
        journalSpawns(2) == 2,
        worldSpawns(2) == 2,
        allDomainInvariants, refinementInvariants
      })

  /// A WALL AGAINST AN EVALUATOR SURVIVES RECOVERY AS A PARTLY-ANSWERED
  /// STAGE, and its resume re-asks that evaluator at the next generation.
  /// The instance is the only place that state lives, so a recovery that
  /// replayed the events without rebuilding it would come back owing the
  /// wrong task — or none.
  run evaluationBlockedResumeRecoversTest =
    rinit
      .then(stepEmit(release(2), "TicketCreated"))
      .then(stepEmit(dispatch2, "TicketDispatched"))
      .then(stepEmit(workDone(2, workTaskIdentity(2, 1)), "TicketWorkResultAccepted"))
      .then(journalStep(walled(2, evalTask(2, 1, 1)), ReworkEvaluationFailure))
      .expect(and {
        wallName(memGraph.tickets.get(2)) == "EvaluationBlockedEscalated",
        instanceBlocked(openInstance(memGraph.tickets.get(2))),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        wallName(memGraph.tickets.get(2)) == "EvaluationBlockedEscalated",
        ledgerInstances(memGraph.tickets.get(2), memLedgers.get(2)).length() == 1,
        instanceBlocked(openInstance(memGraph.tickets.get(2))),
        allDomainInvariants, refinementInvariants
      })
      .then(4.reps(_ => emitNext))
      .then(stepEmit(ResumeTicket(2), "TicketEvaluationResumed"))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Evaluation",
        liveTasks(memGraph.tickets.get(2)) == Set(evalTask(2, 1, 2)),
        allDomainInvariants, refinementInvariants
      })
      .then(stepEmit(judged(2, evalTask(2, 1, 2), EvaluatorPass), "TicketEvaluationPassed"))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Finalization",
        allDomainInvariants, refinementInvariants
      })

  /// The finalization completion is one durable decision. A cursor reset
  /// re-emits effects by journal identity and cannot duplicate the
  /// completion.
  run finalizationCompletionCrashRecoveryTest =
    rinit
      .then(stepEmit(release(2), "TicketCreated"))
      .then(stepEmit(dispatch2, "TicketDispatched"))
      .then(stepEmit(workDone(2, workTaskIdentity(2, 1)), "TicketWorkResultAccepted"))
      .then(stepEmit(judged(2, evalTask(2, 1, 1), EvaluatorPass), "TicketEvaluationPassed"))
      .then(journalStep(succeeded, ReworkEvaluationFailure))
      .expect(and {
        memGraph.tickets.get(2).state == Done,
        journalCompletions(2) == 1,
        worldCompletions(2) == 0,
        answerAt(memGraph, succeeded) == "FinalizationNotCurrent",
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        memGraph.tickets.get(2).state == Done,
        memLedgers.get(2).completions == 1,
        worldCompletions(2) == 0,
        allDomainInvariants, refinementInvariants
      })
      .then(5.reps(_ => emitNext))
      .expect(and {
        worldCompletions(2) == 1,
        journalCompletions(2) == 1,
        allDomainInvariants, refinementInvariants
      })

  run finalizationFailureEntersReworkTest =
    rinit
      .then(stepEmit(release(2), "TicketCreated"))
      .then(stepEmit(dispatch2, "TicketDispatched"))
      .then(stepEmit(workDone(2, workTaskIdentity(2, 1)), "TicketWorkResultAccepted"))
      .then(stepEmit(judged(2, evalTask(2, 1, 1), EvaluatorPass), "TicketEvaluationPassed"))
      .then(stepEmit(finalizationOf(1,
        FinalizationNeedsWork(aFinalizationEvidence)),
        "TicketFinalizationNeedsWork"))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Work",
        liveTasks(memGraph.tickets.get(2)) == Set(workTaskIdentity(2, 2)),
        memLedgers.get(2).completions == 0,
        allDomainInvariants, refinementInvariants
      })

  /// A REFUSED COMMAND IS ANSWERED AND JOURNALS NOTHING: the step records
  /// the refusal, the memory and the journal stand, and a recovery replays
  /// to the same state because there was nothing of it to replay.
  run refusedCommandJournalsNothingTest =
    rinit
      .then(stepEmit(release(2), "TicketCreated"))
      .then(journalStep(release(2), ReworkEvaluationFailure))
      .expect(and {
        obs == Refused(TicketAlreadyExists(2)),
        rlabel == "actor-refused",
        journal.length() == 1,
        memGraph.tickets.keys() == Set(2),
        allDomainInvariants, refinementInvariants
      })
      .then(journalStep(succeeded, ReworkEvaluationFailure))
      .expect(and {
        obs == Refused(FinalizationNotCurrent({ ticket: 2, workCycle: 1,
          generation: 1 })),
        journal.length() == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Pending",
        allDomainInvariants, refinementInvariants
      })
}

module chuggy_refinement_hazard_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*

  pure val release10: TicketCommand = CreateTicket(released(2))
  pure val dispatch2: TicketCommand =
    DispatchTicket({ ticket: 2, source: aDispatchSource })

  def workDone(ticket: int, task: TaskIdentity): TicketCommand =
    ReportTaskTerminal(WorkResultReport({ ticket: ticket,
      result: producedResult(memGraph.tickets.get(ticket), task),
      acceptedSourceRef: anAcceptedSource }))
  /// The hazard walks reach a judgement on a PASSING stage once and on a
  /// FAILING one once.
  def judged(ticket: int, task: TaskIdentity,
      v: EvaluationVerdict): TicketCommand =
    ReportTaskTerminal(EvaluationResultReport({ ticket: ticket,
      result: producedResult(memGraph.tickets.get(ticket), task),
      verdict: v }))
  pure def evalTask(ticket: int, cycle: int): TaskIdentity =
    evaluatorTaskIdentity(ticket, cycle, 1, 1, 1)
  pure val succeeded: TicketCommand = ReportFinalizationResult({ ticket: 2,
    workCycle: 1, generation: 1,
    result: FinalizationSucceeded(aFinalizationEvidence) })

  /// Every step below is journaled under the rework edge: the failing walk
  /// asks for it, which is the disposition that spawns — and a spawn is what
  /// a double spend is made of.
  action step(command: TicketCommand): bool =
    journalStep(command, ReworkEvaluationFailure)
  action crash(command: TicketCommand): bool =
    effectCrash(command, ReworkEvaluationFailure)

  run dispatchEffectFirstDoubleSpendTest =
    rinit
      .then(step(release10)).then(emitNext)
      .then(crash(dispatch2))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Pending",
        worldSpawns(2) == 1, journalSpawns(2) == 0,
        not(journalCoversWorld), not(noDoubleSpentWork),
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(step(dispatch2)).then(emitNext)
      .expect(and {
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentWork), refinementCore, allDomainInvariants
      })

  /// Losing the finalization decision after its effect makes the recovered
  /// actor complete again. The domain history remains legal while the world
  /// observes two completions, pinning why completion must be
  /// journal-before-effect.
  run finalizationEffectFirstDuplicatesIrreversibleCompletionTest =
    rinit
      .then(step(release10)).then(emitNext)
      .then(step(dispatch2)).then(emitNext)
      .then(step(workDone(2, workTaskIdentity(2, 1)))).then(emitNext)
            .then(step(judged(2, evalTask(2, 1), EvaluatorPass))).then(emitNext)
      .then(crash(succeeded))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Finalization",
        worldCompletions(2) == 1, journalCompletions(2) == 0,
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(step(succeeded))
      .then(emitNext)
      .expect(and {
        memGraph.tickets.get(2).state == Done,
        worldCompletions(2) == 2, journalCompletions(2) == 1,
        not(noDuplicateCycle), refinementCore, allDomainInvariants
      })

  /// A FAILING JUDGEMENT IS THE SPAWNING DECISION: the completion that
  /// concludes the stage is what re-enters Work, so the effect-first crash
  /// that double-spends a rework happens on a completion. Losing it after the
  /// effect leaves the world holding a work task the journal never bought.
  run reworkEffectFirstDoubleSpendTest =
    rinit
      .then(step(release10)).then(emitNext)
      .then(step(dispatch2)).then(emitNext)
      .then(step(workDone(2, workTaskIdentity(2, 1)))).then(emitNext)
            .then(crash(judged(2, evalTask(2, 1), EvaluatorFail)))
      .expect(and {
        stateName(memGraph.tickets.get(2)) == "Evaluation",
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentWork), journalLegal, recoveryComplete,
        allDomainInvariants
      })
      .then(step(judged(2, evalTask(2, 1), EvaluatorFail))).then(emitNext)
      .expect(and {
        worldSpawns(2) == 3, journalSpawns(2) == 2,
        not(noDoubleSpentWork), refinementCore, allDomainInvariants
      })
}
