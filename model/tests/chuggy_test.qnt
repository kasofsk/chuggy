/// Pure decider tests for direct ticket release, sparse project-local
/// identity, immutable ticket policy, task history, revoke, execution
/// blocking/resume and the finalization protocol.
module chuggy_test {
  import chuggy_ticket.* from "../ticket"

  // The reference instance. Programs up to 2 stages, so the
  // program-as-data tests below get a staged program and a flat one out of
  // ONE instance (which is the point).
  import chuggy_domain(
    N_TICKETS = 2, N_TASKS = 2, MAX_STAGES = 2
  ) as D from "../domain"

  // Task-record literals, kept terse: wt/et build RESOLVED work and
  // eval-stage tasks (the record's vocabulary — Resolved carries the
  // outcome), wr/er build OUTSTANDING ones (the live set's). The split IS the
  // the explicit lifecycle showing up in the test vocabulary.
  pure def wt(i: int, o: TaskOutcome): Task =
    { id: i, kind: WorkTask, state: Resolved(o) }
  pure def et(i: int, s: int, o: TaskOutcome): Task =
    { id: i, kind: EvaluationTask(s), state: Resolved(o) }
  pure def wr(i: int): Task =
    { id: i, kind: WorkTask, state: Outstanding }
  pure def er(i: int, s: int): Task =
    { id: i, kind: EvaluationTask(s), state: Outstanding }

  // A HAND-BUILT FIXTURE STATES ITS OWN `spawned`. The ghost counter
  // (ticket.qnt Ticket.spawned) is bumped ONLY by spawnOn, and the literals
  // above build live sets and records directly — so a fixture that hands
  // itself a task set or a record and leaves freshTicket's 0 in place breaks
  // domain.qnt's idsAccounted (spawned == record.length + tasks.size), which
  // makes it a state the machine cannot reach. That is not cosmetic: the
  // work-passed decider READS the counter, stamping ProducedArtifact(retired.spawned) as
  // the artifact identity, so a short counter answers a question the machine
  // would answer differently. freshTicket's 0 is right for a fixture with no
  // history; every fixture below that gives itself one carries the matching
  // count, and handBuiltFixturesAccountedTest (bottom of this file) is what
  // keeps the next one honest.

  // Programs used throughout. progU2 is exactly D::defaultProgram — the
  // unanimous single-stage default, which is the compatibility shape: a
  // ticket whose evaluators all share one stage behaves byte-for-byte like
  // a single fan-out.
  pure val progU2: List[StageDefinition] = [{ fanout: 2 }]
  pure val progStaged: List[StageDefinition] = [{ fanout: 1 }, { fanout: 2 }]

  // Test constructors mirror released ticket contracts while keeping
  // fixtures readable.
  pure def fresh(deps: Set[int], prog: List[StageDefinition]): Ticket =
    D::freshTicket(deps, prog)

  pure def release(c: TicketGraph, j: int, deps: Set[int], prog: List[StageDefinition]): Decision =
    D::decideReleaseTicket(c, j, deps, prog)

  /// The eval reduce at a named disposition — the failing edge's choice is
  /// an input, so every call site says which edge it is asking for.
  pure def reduceEval(c: TicketGraph, j: int, d: EvaluationFailureDisposition): Decision =
    D::decideEvalStageReduce(c, j, d)

  run defaultProgramIsUnanimousSingleStageTest = assert(and {
    D::defaultProgram == progU2,
    D::validPrograms.contains(D::defaultProgram)
  })

  /// validPrograms IS the release-refusal rule (programs must be non-empty
  /// and valid or release refuses): the ill-formed shapes are simply not
  /// authorable. A stage is its fan-out, so the reference instance offers
  /// one stage choice per width and every program of at most MAX_STAGES of
  /// them.
  run validProgramsRefusalTest = assert(and {
    D::validPrograms.contains(progU2),
    D::validPrograms.contains(progStaged),
    not(D::validPrograms.contains([])),                          // empty program
    not(D::validPrograms.contains([{ fanout: 0 }])),             // zero fan-out
    not(D::validPrograms.contains([{ fanout: 3 }])),             // fan-out > N_TASKS
    not(D::validPrograms.contains(                               // length > MAX_STAGES
      [{ fanout: 1 }, { fanout: 1 }, { fanout: 1 }])),
    D::validPrograms.size() ==
      D::stageChoices.size() + D::stageChoices.size() * D::stageChoices.size()
  })

  // === The happy path, decision by decision ================================
  // The path STARTS at authoring — the fleet is empty, ticket 1 is released
  // as a Pending (freshTicket seam); ticket 3 is released as a Pending
  // depending on 1 and stays unreleased throughout. ticket 1 carries
  // the DEFAULT program, and its task ids run 1..3 across the whole
  // history (work 1 then eval-stage-0 2,3 — sequential within the
  // ticket).

  pure val cEmpty: TicketGraph = { tickets: Map() }
  pure val dRelease = release(cEmpty, 1, Set(), D::defaultProgram)
  pure val cA1 = dRelease.post
  pure val dReleaseDependent = release(cA1, 3, Set(1), D::defaultProgram)
  pure val cA2 = dReleaseDependent.post

  pure val c0: TicketGraph = cA2
  pure val dDispatch = D::decideDispatch(c0, 1)   // spawns WorkTask id 1
  pure val c1 = dDispatch.post
  pure val dWork1 = D::decideTaskDone(c1, 1, 1, Pass)
  pure val c2 = dWork1.post
  pure val dWorkReduce = D::decideWorkReduce(c2, 1)  // retires 1; spawns EvaluationTask(0) 2,3
  pure val c3 = dWorkReduce.post
  pure val dEval1 = D::decideTaskDone(c3, 1, 2, Pass)
  pure val c4 = dEval1.post
  pure val dEval2 = D::decideTaskDone(c4, 1, 3, Pass)
  pure val c5 = dEval2.post
  pure val dEvalReduce = reduceEval(c5, 1, ReworkEvaluationFailure)  // final (only) stage passes
  pure val c6 = dEvalReduce.post
  /// The finalizer succeeds and the ticket completes from Finalization.
  pure val dComplete = D::decideFinalizationResult(c6, 1, FinalizationSucceeded)
  pure val c7 = dComplete.post

  /// The records are golden-trace shaped with the phase flips where — and
  /// only where — the anatomy says (task completions flip no phase).
  run happyPathRecordsTest = assert(and {
    dDispatch.rec.label == "dispatch",
    dDispatch.rec.transitions == [{ ticket: 1, from: Pending, to: Work }],
    dWork1.rec.label == "task-done",
    dWork1.rec.transitions == [],
    dWorkReduce.rec.label == "work-passed",
    dWorkReduce.rec.transitions == [{ ticket: 1, from: Work, to: Evaluation }],
    dEvalReduce.rec.label == "eval-passed",
    dEvalReduce.rec.transitions == [{ ticket: 1, from: Evaluation, to: Finalization }],
    dComplete.rec.label == "ticket-done",
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }],
    // THE SPAWN EFFECTS, pinned here because nothing else pins them. A
    // spawn emitting no effect is a fan-out the world never hears about —
    // a hole an all-green test set cannot show you. Found by mutation:
    // dropping SpawnEvalTasks from work-passed left all 54 cases passing.
    dDispatch.rec.effects == ["SpawnWorkTasks"],
    dWorkReduce.rec.effects == ["SpawnEvalTasks"],
    dEvalReduce.rec.effects == ["RunFinalizer"]
  })

  /// A PASSING STAGE IGNORES THE DISPOSITION: it is consulted only on the
  /// failing edge, so the passing path is the same decision either way.
  run passingStageIgnoresDispositionTest = assert(
    reduceEval(c5, 1, EscalateEvaluationFailure) == dEvalReduce)

  /// RETAINED TASK RECORDS: at Done, ticket 1's chronological log holds
  /// its WHOLE anatomy — the work set then the eval stage, ids sequential,
  /// outcomes settled and never overwritten — tasks form a chronological
  /// log.
  run happyPathRetainedRecordTest = assert(and {
    c7.tickets.get(1).record ==
      [wt(1, Passed), et(2, 0, Passed), et(3, 0, Passed)],
    c7.tickets.get(1).tasks == Set(),
    // Intermediate shape: after the work reduce the work task is already
    // retired and the eval stage is live above it.
    c3.tickets.get(1).record == [wt(1, Passed)],
    c3.tickets.get(1).tasks == Set(er(2, 0), er(3, 0))
  })

  /// domain.qnt's idsAccounted, one ticket at a time — the same equality the
  /// machine invariant quantifies over liveTickets, usable on a fixture the
  /// machine never produced.
  pure def accountedTicket(j: Ticket): bool =
    j.spawned == j.record.length() + j.tasks.size()

  /// The same, over a whole graph — every ticket, not just ticket 1: a
  /// multi-ticket fixture accounts for all of its ids or none of them.
  pure def accounted(c: TicketGraph): bool =
    c.tickets.keys().forall(j => accountedTicket(c.tickets.get(j)))

  /// IDENTITY ACCOUNTING:
  /// along the fully decider-built happy path the ghost spawn counter
  /// tracks every spawn and always equals retired + live — the equality
  /// a retirement-dropping mutant would break. (The machine invariant
  /// checks it on every reachable state; this pins the counter's exact
  /// values.)
  run happyPathIdsAccountedTest = assert(and {
    cA1.tickets.get(1).spawned == 0,          // a Pending has spawned nothing
    c1.tickets.get(1).spawned == 1,           // the work task
    accounted(c1),
    c3.tickets.get(1).spawned == 3,           // + eval stage 0's fan-out
    accounted(c3),
    c7.tickets.get(1).spawned == 3,           // Done: all retired, none lost
    accounted(c7)
  })

  /// EFFECT EXCLUSIVITY, happy path (effect-only):
  /// exactly one completion effect, exactly at Done.
  run effectExclusivityHappyPathTest = assert(and {
    c7.tickets.get(1).phase == Done,
    c7.tickets.get(1).completions == 1,
    dComplete.rec.effects == []
  })

  run finalizationSuccessTest = assert(and {
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }],
    dComplete.rec.effects == [],
    dComplete.post.tickets.get(1).completions == 1
  })

  run finalizerProtocolDirectCommitTest = assert(and {
    dEvalReduce.rec.effects == ["RunFinalizer"],
    dComplete.rec.transitions == [{ ticket: 1, from: Finalization, to: Done }]
  })

  // === At-least-once: duplicates are idempotent stutters ===================

  /// A duplicate completion for an already-resolved LIVE task (even with a
  /// CONTRADICTING verdict — first write wins) changes nothing: no state,
  /// no effects — an at-least-once delivery honored idempotently.
  run duplicateTaskDoneIdempotentTest = assert(and {
    D::decideTaskDone(c2, 1, 1, Fail).post == c2,
    D::decideTaskDone(c2, 1, 1, Fail).rec.label == "task-done",
    D::decideTaskDone(c2, 1, 1, Fail).rec.effects == []
  })

  /// STALE-STAGE / STALE-INCARNATION completions no-op BY IDENTITY:
  /// ids are sequential within the ticket and never reused, so a completion
  /// for a task retired into the record — here work task 1 (an earlier
  /// incarnation) and eval task 2 delivered AFTER the eval stage retired —
  /// finds no live outstanding match and absorbs as the duplicate stutter,
  /// whatever verdict it carries.
  run staleStageCompletionNoopsTest = assert(and {
    // c3: eval stage 0 live (ids 2,3); work id 1 retired.
    D::decideTaskDone(c3, 1, 1, Fail).post == c3,
    D::decideTaskDone(c3, 1, 1, Fail).rec.label == "task-done",
    // c6: Finalization, everything retired; a stale eval completion no-ops.
    D::decideTaskDone(c6, 1, 2, Fail).post == c6,
    D::decideTaskDone(c6, 1, 2, Fail).rec.label == "task-done"
  })

  // === The work wall: cycle-level, no below-cycle retries ==================

  pure def failedW: Set[Task] = Set(wt(1, Failed))

  /// A failed Work task set escalates DIRECTLY at cycle level — there is
  /// no same-cycle retry branch to take: below-cycle retries are the
  /// fabric's trusted relaunch limit, and modeling them is a standing
  /// non-goal — no retry machinery below the cycle.
  /// The failed task is RETIRED, its outcome intact — the record shows the
  /// failure, provenance the desk can read.
  pure val cWorkFail: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progU2),
    phase: Work, tasks: failedW, spawned: 1 }) }
  pure val dWorkFail = D::decideWorkReduce(cWorkFail, 1)

  run workFailedWallTest = assert(and {
    dWorkFail.rec.label == "ticket-escalated work_failure_escalated",
    dWorkFail.post.tickets.get(1).phase == Escalated,
    dWorkFail.post.tickets.get(1).escalation == WorkFailureEscalated,
    hasOpenHumanTask(dWorkFail.post.tickets.get(1)),
    dWorkFail.rec.effects == ["OpenHumanTask"],
    dWorkFail.post.tickets.get(1).record == [wt(1, Failed)],
    dWorkFail.post.tickets.get(1).tasks == Set()
  })

  // === The failing evaluation's two edges ==================================

  pure def oneFailedE0: Set[Task] = Set(et(1, 0, Failed), et(2, 0, Passed))

  /// ONE failing state, TWO decisions — which one is taken is the
  /// disposition and nothing else. Rework re-enters Work with a fresh
  /// work set above the retired stage; Escalate parks the ticket at the
  /// evaluation-failure wall with the resume that re-enters Work later.
  /// Failed here also covers evaluator-infrastructure death: the same edge,
  /// no new machinery.
  pure val cEvalFail: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progU2),
    phase: Evaluation, tasks: oneFailedE0, spawned: 2 }) }
  pure val dEvalRework = reduceEval(cEvalFail, 1, ReworkEvaluationFailure)
  pure val dEvalEscalate = reduceEval(cEvalFail, 1, EscalateEvaluationFailure)

  run evalFailureDispositionTest = assert(and {
    dEvalRework.rec.label == "rework-started eval_failure",
    dEvalRework.rec.transitions == [{ ticket: 1, from: Evaluation, to: Work }],
    dEvalRework.rec.effects == ["SpawnWorkTasks"],
    dEvalRework.post.tickets.get(1).phase == Work,
    // The failed stage is retired; the rework cycle's work task spawns at
    // the NEXT id (3) — a new record, not an overwrite.
    dEvalRework.post.tickets.get(1).record == [et(1, 0, Failed), et(2, 0, Passed)],
    dEvalRework.post.tickets.get(1).tasks == Set(wr(3)),

    dEvalEscalate.rec.label == "ticket-escalated evaluation_failure_escalated",
    dEvalEscalate.rec.effects == ["OpenHumanTask"],
    dEvalEscalate.post.tickets.get(1).phase == Escalated,
    dEvalEscalate.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    D::retryableIn(dEvalEscalate.post, 1),
    dEvalEscalate.post.tickets.get(1).record == [et(1, 0, Failed), et(2, 0, Passed)],
    dEvalEscalate.post.tickets.get(1).tasks == Set()
  })

  // === THE STAGED PROGRAM, walked stage by stage ===========================
  // progStaged = [{fan-out 1}, {fan-out 2}] on the reference instance. The
  // walk mirrors staged progression edge by edge; the short-circuit
  // mirrors the staged-eval short-circuit fixture (replayed by
  // tests/conformance/conformance_staged_eval_short_circuit_test.qnt,
  // whose header gates the staged content on exactly this model).

  pure def passedW: Set[Task] = Set(wt(1, Passed))

  pure val cStagedWork: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progStaged),
    phase: Work, tasks: passedW, spawned: 1 }) }
  // Work passes -> spawn the LOWEST stage: fan-out 1, id 2.
  pure val dToEval = D::decideWorkReduce(cStagedWork, 1)
  pure val cS0 = dToEval.post
  // Stage 0's one task passes.
  pure val dS0Done = D::decideTaskDone(cS0, 1, 2, Pass)
  // THE ADVANCE: stage 0 passed, stage 1 remains -> Evaluation ->
  // Evaluation, next fan-out spawns.
  pure val dAdvance = reduceEval(dS0Done.post, 1, ReworkEvaluationFailure)
  pure val cS1 = dAdvance.post
  // Stage 1 (fan-out 2): both pass -> the final stage passes.
  pure val dS1a = D::decideTaskDone(cS1, 1, 3, Pass)
  pure val dS1b = D::decideTaskDone(dS1a.post, 1, 4, Pass)
  pure val dStagedFinal = reduceEval(dS1b.post, 1, ReworkEvaluationFailure)

  /// The advance edge, exactly: label eval-stage-passed, an Evaluation ->
  /// Evaluation transition, the next stage's fan-out spawned at fresh ids,
  /// the passed stage retired.
  run stageAdvanceTest = assert(and {
    dAdvance.rec.label == "eval-stage-passed",
    dAdvance.rec.transitions == [{ ticket: 1, from: Evaluation, to: Evaluation }],
    dAdvance.rec.effects == ["SpawnEvalTasks"],
    cS1.tickets.get(1).phase == Evaluation,
    cS1.tickets.get(1).tasks == Set(er(3, 1), er(4, 1)),
    cS1.tickets.get(1).record == [wt(1, Passed), et(2, 0, Passed)]
  })

  /// The FINAL stage passing lands the program: eval-passed, everything
  /// retired, the full anatomy in the log — both stages, at the widths the
  /// program declared for them.
  run stagedProgramPassesTest = assert(and {
    dStagedFinal.rec.label == "eval-passed",
    dStagedFinal.rec.transitions == [{ ticket: 1, from: Evaluation, to: Finalization }],
    dStagedFinal.post.tickets.get(1).tasks == Set(),
    dStagedFinal.post.tickets.get(1).record ==
      [wt(1, Passed), et(2, 0, Passed), et(3, 1, Passed), et(4, 1, Passed)]
  })

  // --- The short-circuit: stage 0 fails, stage 1 is never created ----------

  pure val dS0Fail = D::decideTaskDone(cS0, 1, 2, Fail)
  pure val dShort = reduceEval(dS0Fail.post, 1, ReworkEvaluationFailure)
  pure val cAfterShort = dShort.post

  /// SHORT-CIRCUIT ROUTES TO THE FAILING EDGE: the later stages are not
  /// created — they are skipped, not failed, so no task records exist for
  /// them, and the eval reduce proceeds immediately. The record holds NO
  /// stage-1 task, ever.
  run shortCircuitRoutesToReworkTest = assert(and {
    dShort.rec.label == "rework-started eval_failure",
    dShort.rec.transitions == [{ ticket: 1, from: Evaluation, to: Work }],
    // "no task records exist for them": stage 1 never spawned.
    cAfterShort.tickets.get(1).record == [wt(1, Passed), et(2, 0, Failed)],
    cAfterShort.tickets.get(1).record.indices().forall(i =>
      cAfterShort.tickets.get(1).record[i].kind != EvaluationTask(1)),
    cAfterShort.tickets.get(1).tasks == Set(wr(3))
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — stages are
  /// recomputed per cycle, never resumed mid-sequence. After
  /// the rework's work task passes, the next Evaluation spawns stage 0
  /// again — never stage 1.
  pure val dReworkW1 = D::decideTaskDone(cAfterShort, 1, 3, Pass)
  pure val dBackToEval = D::decideWorkReduce(dReworkW1.post, 1)

  run reworkRestartsLowestStageTest = assert(and {
    dBackToEval.rec.label == "work-passed",
    dBackToEval.post.tickets.get(1).tasks == Set(er(4, 0)),
    dBackToEval.post.tickets.get(1).record ==
      [wt(1, Passed), et(2, 0, Failed), wt(3, Passed)]
  })

  /// The golden fixture's exact shape (staged_eval_short_circuit.yaml:
  /// "staged eval: stage-0 fails -> stage 1 never launched -> escalate"):
  /// the same short-circuit under an Escalate disposition parks the ticket
  /// with stage 1 still unlaunched.
  pure val cStagedPark: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progStaged),
    phase: Evaluation,
    record: [wt(1, Passed)],
    tasks: Set(et(2, 0, Failed)), spawned: 2 }) }
  pure val dStagedWall = reduceEval(cStagedPark, 1, EscalateEvaluationFailure)

  run stagedShortCircuitEscalatesTest = assert(and {
    dStagedWall.rec.label == "ticket-escalated evaluation_failure_escalated",
    dStagedWall.post.tickets.get(1).phase == Escalated,
    dStagedWall.post.tickets.get(1).escalation == EvaluationFailureEscalated,
    dStagedWall.post.tickets.get(1).record == [wt(1, Passed), et(2, 0, Failed)],
    dStagedWall.post.tickets.get(1).record.indices().forall(i =>
      dStagedWall.post.tickets.get(1).record[i].kind != EvaluationTask(1))
  })

  /// Duplicate stale-stage completion, staged edition: while stage 1 is
  /// live (ids 3,4), a re-delivered completion for RETIRED stage-0 task 2
  /// — even with a contradicting verdict — no-ops by identity.
  run staleStageDuplicateNoopsTest = assert(and {
    D::decideTaskDone(cS1, 1, 2, Fail).post == cS1,
    D::decideTaskDone(cS1, 1, 2, Fail).rec.label == "task-done"
  })

  // === PROGRAM-AS-DATA at machine level ====================================
  // ONE machine instance, two tickets identical but for the program on
  // their record: different decisions. The program makes eval what it is
  // meant to be — data.

  pure val mixedE0: Set[Task] = Set(et(1, 0, Passed), et(2, 0, Failed))
  pure val allFailedE0: Set[Task] = Set(et(1, 0, Failed), et(2, 0, Failed))

  /// Program STRUCTURE is the data: the same passed work task spawns a
  /// 2-wide flat fan-out under the default program but a 1-wide stage-0
  /// under the staged program — the machine's very next task anatomy is
  /// decided by the program on the record.
  pure val cFlatWork: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progU2),
    phase: Work, tasks: passedW, spawned: 1 }) }

  run programAsDataStructureTest = assert(and {
    D::decideWorkReduce(cFlatWork, 1).post.tickets.get(1).tasks ==
      Set(er(2, 0), er(3, 0)),
    D::decideWorkReduce(cStagedWork, 1).post.tickets.get(1).tasks ==
      Set(er(2, 0))
  })

  /// THE STAGE VERDICT at the pure grain: a stage passes when every
  /// evaluator in it passed, and one dissenter is enough to fail it.
  run stageVerdictIsUnanimousTest = assert(and {
    combine(Set(et(1, 0, Passed), et(2, 0, Passed))),
    not(combine(mixedE0)),
    not(combine(allFailedE0))
  })

  // === The finalizer's failure edge ========================================

  /// A finalization failure re-enters Work as a new cycle, with a fresh
  /// work task — and it does so EVERY time: there is no wall on this edge,
  /// so a finalizer that keeps reporting failure keeps buying cycles, which
  /// is the finalizer's problem and not the machine's.
  pure val cFinalizing: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progU2),
    phase: Finalization }) }
  pure val dFinalizationRework = D::decideFinalizationResult(cFinalizing, 1, FinalizationNeedsWork)

  pure val cFinalizingAgain: TicketGraph = { tickets: Map(1 -> { ...fresh(Set(), progU2),
    phase: Finalization,
    record: [wt(1, Passed), et(2, 0, Passed), et(3, 0, Passed)],
    spawned: 3 }) }
  pure val dFinalizationReworkAgain =
    D::decideFinalizationResult(cFinalizingAgain, 1, FinalizationNeedsWork)

  run finalizationFailureReworksTest = assert(and {
    dFinalizationRework.rec.label == "rework-started finalization_needs_work",
    dFinalizationRework.rec.transitions == [{ ticket: 1, from: Finalization, to: Work }],
    dFinalizationRework.rec.effects == ["SpawnWorkTasks"],
    dFinalizationRework.post.tickets.get(1).phase == Work,
    // The wrap-up rework's work task is a fresh incarnation at a fresh id.
    dFinalizationRework.post.tickets.get(1).tasks == Set(wr(1)),
    // A ticket that has already been round the loop takes the same edge,
    // with its id continuing above the retained record.
    dFinalizationReworkAgain.post.tickets.get(1).phase == Work,
    dFinalizationReworkAgain.post.tickets.get(1).tasks == Set(wr(4))
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
    // The wall spawns nothing and retires nothing: Finalization holds no
    // live task set, and the artifact the finalizer could not commit stays.
    dFinalizationUnavailable.post.tickets.get(1).tasks == Set(),
    dFinalizationUnavailable.post.tickets.get(1).artifact ==
      cFinalizing.tickets.get(1).artifact
  })

  // === The human desk: parks and resumes ===================================

  pure val dPark = D::decideExecutionBlocked(c1, 1)
  pure val dParkResume = D::decideResumeTicket(dPark.post, 1)

  run executionBlockedAndResumeClassifiedTest = assert(and {
    dPark.rec.label == "ticket-escalated work_execution_unavailable_escalated",
    dPark.rec.effects == ["OpenHumanTask"],
    dPark.post.tickets.get(1).phase == Escalated,
    dPark.post.tickets.get(1).escalation == WorkExecutionUnavailableEscalated,
    dPark.post.tickets.get(1).record == [wt(1, Cancelled)],
    dPark.post.tickets.get(1).tasks == Set(),
    dParkResume.post.tickets.get(1).phase == Work,
    dParkResume.post.tickets.get(1).escalation == NoEscalation,
    dParkResume.post.tickets.get(1).tasks == Set(wr(2))
  })

  /// An infrastructure block during EVALUATION is its own wall, and that is
  /// what keeps the source boundary: resume retires the interrupted fan-out
  /// and creates a fresh lowest-stage fan-out, never silently restarting
  /// work. The same decider on the same ticket in Work names the other wall
  /// (above), which is the whole of what the phase decides here.
  pure val dEvalPark = D::decideExecutionBlocked(c3, 1)
  pure val dEvalParkResume = D::decideResumeTicket(dEvalPark.post, 1)

  run executionBlockedEvaluationResumeFreshTest = assert(and {
    dEvalPark.rec.label == "ticket-escalated evaluation_blocked_escalated",
    dEvalPark.post.tickets.get(1).phase == Escalated,
    dEvalPark.post.tickets.get(1).escalation == EvaluationBlockedEscalated,
    dEvalPark.post.tickets.get(1).record ==
      [wt(1, Passed), et(2, 0, Cancelled), et(3, 0, Cancelled)],
    dEvalPark.post.tickets.get(1).tasks == Set(),
    dEvalParkResume.post.tickets.get(1).phase == Evaluation,
    dEvalParkResume.post.tickets.get(1).tasks == Set(er(4, 0), er(5, 0)),
    dEvalParkResume.post.tickets.get(1).record ==
      [wt(1, Passed), et(2, 0, Cancelled), et(3, 0, Cancelled)]
  })

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
    D::retryableIn(dPark.post, 1)
  })

  /// EVERY PARK IS RETRYABLE, and the resume returns the ticket to the phase
  /// its wall implies. The finalization park is the state its own wall wrote
  /// rather than one built here — a hand-built park was once able to stamp a
  /// resume no decider pairs with that wall, which is what the sum removes.
  pure val cEscFinalizer: TicketGraph = dFinalizationUnavailable.post
  pure val dResumeFinalizer = D::decideResumeTicket(cEscFinalizer, 1)

  pure val escWorking: Ticket = { ...fresh(Set(), progU2),
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
  /// artifact instead of a second opinion on the old one; the lowest-stage
  /// fresh fan-out an Evaluation resume gives is pinned from the
  /// execution-blocked park above, where an interruption and not a verdict
  /// did the parking.
  pure val escRework: Ticket = { ...fresh(Set(), progStaged),
    phase: Escalated, escalation: EvaluationFailureEscalated,
    record: [wt(1, Passed), et(2, 0, Failed)], spawned: 2 }
  pure val cEscRework: TicketGraph = { tickets: Map(1 -> escRework) }
  pure val dResumeRework = D::decideResumeTicket(cEscRework, 1)

  run resumeReworkRespawnsWorkTest = assert(and {
    dResumeRework.rec.label == "ticket-resumed",
    dResumeRework.rec.effects == ["SpawnWorkTasks"],
    dResumeRework.rec.transitions == [{ ticket: 1, from: Escalated, to: Work }],
    dResumeRework.post.tickets.get(1).escalation == NoEscalation,
    // A fresh work id above an INTACT record: the failed stage stays retired.
    dResumeRework.post.tickets.get(1).tasks == Set(wr(3)),
    dResumeRework.post.tickets.get(1).record == [wt(1, Passed), et(2, 0, Failed)]
  })

  // === Direct release, sparse identity, and ticket-local policy ============

  pure val sparseBase = release(cEmpty, 4, Set(), progU2).post
  pure val sparseCore = release(sparseBase, 1, Set(4), progStaged).post

  run releaseSparseIdentityTest = assert(and {
    sparseCore.tickets.keys() == Set(1, 4),
    sparseCore.tickets.get(1).deps == Set(4),
    sparseCore.tickets.get(1).phase == Pending,
    D::isBlockedIn(sparseCore, 1),
    not(D::canReleaseIn(sparseCore, 2)), // count bound reached despite sparse gaps
    not(D::canReleaseIn(sparseCore, 4))
  })

  pure val localPolicy = D::decideReleaseTicket(cEmpty, 2, Set(),
    progStaged).post.tickets.get(2)

  run releaseMaterializesTicketPolicyTest = assert(and {
    localPolicy.program == progStaged,
    localPolicy.deps == Set()
  })

  // === Revoke, from every live phase =======================================
  // Every non-terminal may be revoked. Single-ticket fixtures: one per live
  // phase (Pending, Work, Evaluation, Finalization), and the one parked phase
  // twice under different walls — the pair is there to show a revoke does
  // not read the wall that parked the ticket, not to enumerate the walls.

  pure def revokedShape(j: Ticket): bool = and {
    j.phase == Revoked,
    j.tasks == Set(),               // Revoked RUNS nothing (live set retired)...
    j.escalation == NoEscalation,   // ...and opens NO human task:
    not(hasOpenHumanTask(j))        // revocation is the author's settled choice
  }

  pure val jBase: Ticket = fresh(Set(), progU2)
  pure val jPend: Ticket = { ...jBase, phase: Pending }
  pure val jWork: Ticket = { ...jBase, phase: Work,
    tasks: spawnTasks(WorkTask, 1, 1), spawned: 1 }
  pure val jEval: Ticket = { ...jBase, phase: Evaluation, tasks: mixedE0, spawned: 2 }
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

  /// Revoke RETAINS the task record — "Revoked runs nothing" is
  /// about the live set, not the log. A mid-flight revoke force-closes the
  /// still-outstanding work task as Cancelled — a synthetic resolution
  /// recording that the revoke, not a verdict, retired them;
  /// already-resolved outcomes are
  /// preserved unchanged (jEval's mixed stage). Provenance survives the
  /// author's settlement.
  run revokeRetainsRecordTest = assert(and {
    revokeOne(jWork).post.tickets.get(1).record == [wt(1, Cancelled)],
    revokeOne(jEval).post.tickets.get(1).record ==
      [et(1, 0, Passed), et(2, 0, Failed)],
    revokeOne(jBase).post.tickets.get(1).record == []   // never ran: no history
  })

  /// The absorbing terminals are exactly the unrevocable phases.
  run revocableExactlyNonTerminalTest = assert(and {
    D::revocableIn({ tickets: Map(1 -> jBase) }, 1),
    D::revocableIn({ tickets: Map(1 -> jEsc) }, 1),
    not(D::revocableIn(c7, 1)),                                  // Done
    not(D::revocableIn(revokeOne(jBase).post, 1))               // Revoked
  })

  /// REVOKED NEVER COMPLETES (the exclusivity extension): revoking a ticket
  /// parked IN the wrap-up queue emits no completion effect and leaves the
  /// completion counter at zero — contrast with the completed ticket (c7),
  /// whose counter is 1 and which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    revokeOne(jFinalizer).post.tickets.get(1).completions == 0,
    revokeOne(jFinalizer).rec.effects == ["CancelTicketWork"],
    c7.tickets.get(1).completions == 1
  })

  // === REVOKE TOUCHES ONE TICKET, on a 3-ticket chain ======================
  // 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 a
  // Pending behind 2. Revoking 1 settles 1 and moves nothing else: the two
  // dependents stay where their own authors left them.

  pure val cChain: TicketGraph = { tickets: Map(
    1 -> { ...fresh(Set(), progU2), phase: Pending },
    2 -> { ...fresh(Set(1), progU2), phase: Pending },
    3 -> fresh(Set(2), progU2)
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
    1 -> { ...fresh(Set(), progU2), phase: Finalization },
    2 -> { ...fresh(Set(), progU2), phase: Finalization }
  ) }

  run finalizationBoundaryTest = assert(and {
    not(D::revocableIn({ tickets: Map(1 -> { ...fresh(Set(), progU2), phase: Finalization }) }, 1)),
    not(D::revocableIn(cGateOcc, 1)),
    not(D::revocableIn(cGateOcc, 2))
  })

  run finalizationOutcomesDrawRuleTest = assert(
    D::finalizationOutcomes == Set(FinalizationSucceeded, FinalizationNeedsWork,
      FinalizationResultUnavailable))

  /// WORK-PASSED STAMPS AN ARTIFACT, and a rework SUPERSEDES it. The second
  /// half is what makes the mark an identity rather than a flag: two cycles
  /// of the same ticket produced different things and the model can say so.
  run artifactStampedAndSupersededTest = assert(and {
    dDispatch.post.tickets.get(1).artifact == NoArtifact,
    dWorkReduce.post.tickets.get(1).artifact != NoArtifact,
    // The rework fixture walks a second cycle; its product differs from the
    // first, which a stamp-once mutant would fail.
    dBackToEval.post.tickets.get(1).artifact != NoArtifact,
    dBackToEval.post.tickets.get(1).artifact != dWorkReduce.post.tickets.get(1).artifact
  })

  /// A dependency gate depends only on the released predecessor's state.
  pure val cXDepPre: TicketGraph = { tickets: Map(
    1 -> { ...fresh(Set(), progU2), phase: Finalization },
    2 -> { ...fresh(Set(1), progU2), phase: Pending }
  ) }
  pure val cXDepDone: TicketGraph = { tickets: Map(
    1 -> { ...fresh(Set(), progU2), phase: Done, completions: 1 },
    2 -> { ...fresh(Set(1), progU2), phase: Pending }
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
  /// into: some of them carried a live task set or a record while leaving
  /// freshTicket's spawned at 0, which is not a state any trace reaches, and
  /// work-passed's ProducedArtifact(retired.spawned) stamp read the short counter. The
  /// deciders below cannot repair it — nothing recomputes `spawned` from the
  /// record — so the equality has to be asserted where the state is written.
  /// This is that assertion, and the reason a new fixture cannot
  /// repeat the mistake quietly.
  run handBuiltFixturesAccountedTest = assert(and {
    accounted(cWorkFail), accounted(cEvalFail),
    accounted(cStagedWork), accounted(cStagedPark),
    accounted(cFlatWork),
    accounted(cFinalizing), accounted(cFinalizingAgain),
    accounted(cChain), accounted(cGateOcc),
    accounted(cXDepPre), accounted(cXDepDone),
    accountedTicket(escWorking),
    accountedTicket(escRework),
    accountedTicket(jBase), accountedTicket(jPend), accountedTicket(jWork),
    accountedTicket(jEval), accountedTicket(jFinalizer),
    accountedTicket(jEsc), accountedTicket(jParkPre)
  })
}
