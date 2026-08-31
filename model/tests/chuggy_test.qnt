/// Pure decider and measure tests for direct ticket release, sparse project-local
/// identity, immutable ticket policy, task history, dependency cascades,
/// execution blocking/resume and the prepare/approve/commit wrap-up protocol.
module chuggy_test {
  import chuggy_measure.* from "../measure"

  // Reference instance: Budgeted(1) gate pricing, charged retries — the
  // defaults. Programs up
  // to 2 stages — combinators are data on each ticket's program, so the
  // program-as-data tests below get both combinators from ONE instance
  // (which is the point).
  import chuggy_domain(
    N_TICKETS = 2, N_TASKS = 2, REWORK_POLICY = BudgetedRework(1), GAS = 3,
    FINALIZATION_PRICING = Budgeted(1),     MAX_STAGES = 2
  ) as DB from "../domain"

  // DeadlineOnly gate pricing (the other §2 branch).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = BudgetedRework(1), GAS = 3,
    FINALIZATION_PRICING = DeadlineOnly,     MAX_STAGES = 2
  ) as DD from "../domain"

  // Free retry metering — a documented churn, kept reproducible
  // by configuration (machine-level coverage: mc_chuggy_retryfree).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = BudgetedRework(1), GAS = 3,
    FINALIZATION_PRICING = Budgeted(1),     MAX_STAGES = 2
  ) as DF from "../domain"

  // to {1}, every release draw / stamp / attribution is project 1, and the
  // draw rule and pricing are project-independent — the single-project machine
  // with a constant field (README's degeneration claim, pinned here).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = BudgetedRework(1), GAS = 3,
    FINALIZATION_PRICING = Budgeted(1),     MAX_STAGES = 2
  ) as DO from "../domain"

  // A GASLESS graph — invalid: the gas account is required.
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = BudgetedRework(1), GAS = 0,
    FINALIZATION_PRICING = Budgeted(1),     MAX_STAGES = 2
  ) as DZ from "../domain"

  /// The required-account rule: a gasless graph is INVALID — the model
  /// admits no initial state for it at all.
  run gasRequiredTest = DZ::init.fail()

  // The same bounds the instances above carry, for measure recomputation.
  pure val bB: Bounds =
    { reworkPolicy: BudgetedRework(1), nTasks: 2, maxStages: 2, finalizationPricing: Budgeted(1) }
  pure val bD: Bounds =
    { reworkPolicy: BudgetedRework(1), nTasks: 2, maxStages: 2, finalizationPricing: DeadlineOnly }

  pure def mB(c: Core): int = sysMeasure(bB, c.tickets)
  pure def mD(c: Core): int = sysMeasure(bD, c.tickets)

  // Task-record literals, kept terse: wt/et build RESOLVED work and
  // eval-stage tasks (the record's vocabulary — Resolved carries the
  // outcome), wr/er build OUTSTANDING ones (the live set's). The split IS the
  // the explicit lifecycle showing up in the test vocabulary; every
  // pre-existing test needed only this mechanical rewrap.
  pure def wt(i: int, o: TaskOutcome): Task =
    { id: i, kind: Work, state: Resolved(o) }
  pure def et(i: int, s: int, o: TaskOutcome): Task =
    { id: i, kind: Evaluation(s), state: Resolved(o) }
  pure def wr(i: int): Task =
    { id: i, kind: Work, state: Outstanding }
  pure def er(i: int, s: int): Task =
    { id: i, kind: Evaluation(s), state: Outstanding }

  // A HAND-BUILT FIXTURE STATES ITS OWN `spawned`. The ghost counter
  // (measure.qnt Ticket.spawned) is bumped ONLY by spawnOn, and the literals
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

  // Programs used throughout. progU2 is exactly DB::defaultProgram — the
  // unanimous single-stage default, which is the compatibility shape: a
  // ticket whose evaluators all share one stage behaves byte-for-byte like
  // a single fan-out.
  pure val progU2: List[Stage] = [{ fanout: 2, combinator: UnanimousPass }]
  pure val progA2: List[Stage] = [{ fanout: 2, combinator: AnyPass }]
  pure val progStaged: List[Stage] =
    [{ fanout: 1, combinator: UnanimousPass },
     { fanout: 2, combinator: AnyPass }]

  // Test constructors mirror released ticket contracts for each pricing
  // instance while keeping fixtures readable.
  pure def freshB(deps: Set[int], prog: List[Stage], finalizer: Finalizer): Ticket =
    DB::freshTicket(deps, prog, 2, BudgetedRework(1), Budgeted(1), RetryCharged, finalizer)
  pure def freshD(deps: Set[int], prog: List[Stage], finalizer: Finalizer): Ticket =
    DD::freshTicket(deps, prog, 2, BudgetedRework(1), DeadlineOnly, RetryCharged, finalizer)
  pure def freshF(deps: Set[int], prog: List[Stage], finalizer: Finalizer): Ticket =
    DF::freshTicket(deps, prog, 2, BudgetedRework(1), Budgeted(1), RetryFree, finalizer)

  pure def releaseB(c: Core, j: int, deps: Set[int], prog: List[Stage], finalizer: Finalizer): Decision =
    DB::decideReleaseTicket(c, j, deps, prog, 2, BudgetedRework(1), Budgeted(1), RetryCharged, finalizer)

  run defaultProgramIsUnanimousSingleStageTest = assert(and {
    DB::defaultProgram == progU2,
    DB::validPrograms.contains(DB::defaultProgram)
  })

  /// validPrograms IS the release-refusal rule (programs must be non-empty
  /// and valid or release refuses): the ill-formed shapes are simply not
  /// authorable. At N_TASKS = 2, MAX_STAGES = 2 there are exactly 4 stage
  /// choices, hence 4 + 16 = 20 programs.
  run validProgramsRefusalTest = assert(and {
    DB::validPrograms.contains(progU2),
    DB::validPrograms.contains(progStaged),
    not(DB::validPrograms.contains([])),                                    // empty program
    not(DB::validPrograms.contains([{ fanout: 0, combinator: UnanimousPass }])), // zero fan-out
    not(DB::validPrograms.contains([{ fanout: 3, combinator: UnanimousPass }])), // fan-out > N_TASKS
    not(DB::validPrograms.contains(                                          // length > MAX_STAGES
      [{ fanout: 1, combinator: UnanimousPass },
       { fanout: 1, combinator: UnanimousPass },
       { fanout: 1, combinator: UnanimousPass }])),
    DB::validPrograms.size() == 20
  })

  // === The happy path, decision by decision ================================
  // The path STARTS at authoring — the fleet is empty, ticket 1 is released
  // as a Pending (freshTicket seam) and is released straight into Pending;
  // ticket 2 is released as a Pending
  // depending on 1 and stays unreleased throughout. ticket 1 carries
  // the DEFAULT program, and its task ids run 1..4 across the whole
  // history (work 1,2 then eval-stage-0 3,4 — sequential within the
  // ticket).

  pure val cEmpty: Core = { tickets: Map() }
  pure val dRelease = releaseB(cEmpty, 1, Set(), DB::defaultProgram, ManagedFinalizer)
  pure val cA1 = dRelease.post
  pure val dReleaseDependent = releaseB(cA1, 3, Set(1), DB::defaultProgram, ManagedFinalizer)
  pure val cA2 = dReleaseDependent.post

  pure val c0: Core = cA2
  pure val dDispatch = DB::decideDispatch(c0, 1)   // spawns Work ids 1,2
  pure val c1 = dDispatch.post
  pure val dWork1 = DB::decideTaskDone(c1, 1, 1, Pass)
  pure val c2 = dWork1.post
  pure val dWork2 = DB::decideTaskDone(c2, 1, 2, Pass)
  pure val c3 = dWork2.post
  pure val dWorkReduce = DB::decideWorkReduce(c3, 1)  // retires 1,2; spawns Evaluation(0) 3,4
  pure val c4 = dWorkReduce.post
  pure val dEval1 = DB::decideTaskDone(c4, 1, 3, Pass)
  pure val c5 = dEval1.post
  pure val dEval2 = DB::decideTaskDone(c5, 1, 4, Pass)
  pure val c6 = dEval2.post
  pure val dEvalReduce = DB::decideEvalStageReduce(c6, 1)  // final (only) stage passes
  pure val c7 = dEvalReduce.post
  /// A direct finalizer still completes from Finalizing; the post-promotion
  /// route below takes the separately modeled handoff boundary.
  pure val dComplete = DB::decideFinalizationResult(c7, 1, FinalizationSucceeded)
  pure val c8 = dComplete.post

  /// Every decision on the happy path strictly descends the measure —
  /// dispatch (gas), task completions (task count), both phase reductions
  /// (rank), the wrap-up (rank).
  run happyPathMeasureDescendsTest = assert(and {
    mB(c1) < mB(c0),
    mB(c2) < mB(c1),
    mB(c3) < mB(c2),
    mB(c4) < mB(c3),
    mB(c5) < mB(c4),
    mB(c6) < mB(c5),
    mB(c7) < mB(c6),
    mB(c8) < mB(c7)
  })

  /// The records are golden-trace shaped with the phase flips where — and
  /// only where — the anatomy says (task completions flip no phase).
  run happyPathRecordsTest = assert(and {
    dDispatch.rec.label == "dispatch",
    dDispatch.rec.transitions == [{ ticket: 1, from: Pending, to: Working }],
    dWork1.rec.label == "task-done",
    dWork1.rec.transitions == [],
    dWorkReduce.rec.label == "work-passed",
    dWorkReduce.rec.transitions == [{ ticket: 1, from: Working, to: Evaluating }],
    dEvalReduce.rec.label == "eval-passed",
    dEvalReduce.rec.transitions == [{ ticket: 1, from: Evaluating, to: Finalizing }],
    dComplete.rec.label == "ticket-done",
    dComplete.rec.transitions == [{ ticket: 1, from: Finalizing, to: Done }],
    // THE SPAWN EFFECTS, pinned here because nothing else pins them. The
    // citation-scoping removal took out the suite that used to, and a
    // spawn emitting no effect is a fan-out the world never hears about —
    // a hole an all-green test set cannot show you. Found by mutation:
    // dropping SpawnEvalTasks from work-passed left all 54 cases passing.
    dDispatch.rec.effects == ["SpawnWorkTasks"],
    dWorkReduce.rec.effects == ["SpawnEvalTasks"],
    dEvalReduce.rec.effects == ["RunFinalizer"]
  })

  /// RETAINED TASK RECORDS: at Done, ticket 1's chronological log holds
  /// its WHOLE anatomy — the work set then the eval stage, ids sequential,
  /// outcomes settled and never overwritten — tasks form a chronological
  /// log. The single-stage default program's
  /// history is byte-for-byte what the model would have produced
  /// had it retained anything — the compatibility story, now with
  /// provenance the golden traces can carry.
  run happyPathRetainedRecordTest = assert(and {
    c8.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Passed), et(4, 0, Passed)],
    c8.tickets.get(1).tasks == Set(),
    // Intermediate shape: after the work reduce the work set is already
    // retired and the eval stage is live above it.
    c4.tickets.get(1).record == [wt(1, Passed), wt(2, Passed)],
    c4.tickets.get(1).tasks == Set(er(3, 0), er(4, 0))
  })

  /// domain.qnt's idsAccounted, one ticket at a time — the same equality the
  /// machine invariant quantifies over liveTickets, usable on a fixture the
  /// machine never produced.
  pure def accountedTicket(j: Ticket): bool =
    j.spawned == j.record.length() + j.tasks.size()

  /// The same, over a whole core — every ticket, not just ticket 1: a
  /// multi-ticket fixture accounts for all of its ids or none of them.
  pure def accounted(c: Core): bool =
    c.tickets.keys().forall(j => accountedTicket(c.tickets.get(j)))

  /// IDENTITY ACCOUNTING:
  /// along the fully decider-built happy path the ghost spawn counter
  /// tracks every fan-out and always equals retired + live — the equality
  /// a retirement-dropping mutant would break. (The machine invariant
  /// checks it on every reachable state; this pins the counter's exact
  /// values.)
  run happyPathIdsAccountedTest = assert(and {
    cA1.tickets.get(1).spawned == 0,          // a Pending has spawned nothing
    c1.tickets.get(1).spawned == 2,           // the work fan-out
    accounted(c1),
    c4.tickets.get(1).spawned == 4,           // + eval stage 0's fan-out
    accounted(c4),
    c8.tickets.get(1).spawned == 4,           // Done: all retired, none lost
    accounted(c8)
  })

  /// EFFECT EXCLUSIVITY, happy path (effect-only):
  /// exactly one completion effect, exactly at Done — the quiet fast-path's
  /// direct squash (the path rule: FinalizationSucceeded is the one outcome a quiet draw
  /// permits).
  run effectExclusivityHappyPathTest = assert(and {
    c8.tickets.get(1).phase == Done,
    c8.tickets.get(1).completions == 1,
    dComplete.rec.effects == []
  })

  pure val dCompleteGated = DB::decideFinalizationResult(c7, 1, FinalizationSucceeded)

  run finalizationSuccessTest = assert(and {
    dCompleteGated.rec.transitions == [{ ticket: 1, from: Finalizing, to: Done }],
    dCompleteGated.rec.effects == [],
    dCompleteGated.post.tickets.get(1).completions == 1
  })

  run finalizerProtocolDirectCommitTest = assert(and {
    dEvalReduce.rec.effects == ["RunFinalizer"],
    dComplete.rec.transitions == [{ ticket: 1, from: Finalizing, to: Done }]
  })

  // === At-least-once: duplicates are idempotent stutters ===================

  /// A duplicate completion for an already-resolved LIVE task (even with a
  /// CONTRADICTING verdict — first write wins) changes nothing: no state,
  /// no effects, no measure movement — an at-least-once delivery
  /// honored idempotently.
  run duplicateTaskDoneIdempotentTest = assert(and {
    DB::decideTaskDone(c2, 1, 1, Fail).post == c2,
    DB::decideTaskDone(c2, 1, 1, Fail).rec.label == "task-done",
    DB::decideTaskDone(c2, 1, 1, Fail).rec.effects == [],
    mB(DB::decideTaskDone(c2, 1, 1, Fail).post) == mB(c2)
  })

  /// STALE-STAGE / STALE-INCARNATION completions no-op BY IDENTITY:
  /// ids are sequential within the ticket and never reused, so a completion
  /// for a task retired into the record — here work task 1 (an earlier
  /// incarnation) and eval task 3 delivered AFTER the eval stage retired —
  /// finds no live outstanding match and absorbs as the duplicate stutter,
  /// whatever verdict it carries. (had to absorb the same-id case
  /// into the respawned set's nondet verdict; identity retired that
  /// argument — the honest extension of the duplicate-adversary scope.)
  run staleStageCompletionNoopsTest = assert(and {
    // c4: eval stage 0 live (ids 3,4); work ids 1,2 retired.
    DB::decideTaskDone(c4, 1, 1, Fail).post == c4,
    DB::decideTaskDone(c4, 1, 1, Fail).rec.label == "task-done",
    // c7: Finalizer, everything retired; a stale eval completion no-ops.
    DB::decideTaskDone(c7, 1, 3, Fail).post == c7,
    DB::decideTaskDone(c7, 1, 3, Fail).rec.label == "task-done",
    mB(DB::decideTaskDone(c4, 1, 1, Fail).post) == mB(c4)
  })


  // === The work wall: cycle-level, no below-cycle retries ==================

  pure def oneFailedW: Set[Task] = Set(wt(1, Failed), wt(2, Passed))

  /// A failed Work task set escalates DIRECTLY at cycle level — there is
  /// no same-cycle retry branch to take: below-cycle retries are the
  /// fabric's trusted relaunch limit, and modeling them is a standing
  /// non-goal — no retry machinery below the cycle.
  /// The failed set is RETIRED, outcomes intact — the record shows
  /// WHICH task failed, provenance the desk can read.
  pure val cWorkFail: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Working, gasLeft: 2, tasks: oneFailedW, spawned: 2 }) }
  pure val dWorkFail = DB::decideWorkReduce(cWorkFail, 1)

  run workFailedWallTest = assert(and {
    dWorkFail.rec.label == "ticket-escalated work_failed",
    dWorkFail.post.tickets.get(1).phase == Escalated,
    dWorkFail.post.tickets.get(1).reason == WorkFailed,
    dWorkFail.post.tickets.get(1).resumeAt == ResumeWorking,
    hasOpenHumanTask(dWorkFail.post.tickets.get(1)),
    dWorkFail.rec.effects == ["OpenHumanTask"],
    dWorkFail.post.tickets.get(1).record == [wt(1, Failed), wt(2, Passed)],
    dWorkFail.post.tickets.get(1).tasks == Set(),
    mB(dWorkFail.post) < mB(cWorkFail)
  })

  // === The middle loop (budgeted eval rework) and its two walls ============

  pure def oneFailedE0: Set[Task] = Set(et(1, 0, Failed), et(2, 0, Passed))

  /// Eval rework — the SHORT-CIRCUIT priced (single-stage program, so the
  /// short-circuit and the reduce coincide; the staged case is below):
  /// 1 rework budget + 1 gas buy a new cycle; both accounts (and the
  /// measure) descend. Failed here also covers evaluator-infra death —
  /// the ticket pays, one account.
  pure val cEvalFail: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Evaluating, reworkLeft: 1, gasLeft: 2, tasks: oneFailedE0, spawned: 2 }) }
  pure val dEvalRework = DB::decideEvalStageReduce(cEvalFail, 1)

  run evalReworkDescendsTest = assert(and {
    dEvalRework.rec.label == "rework-started eval_failure",
    dEvalRework.post.tickets.get(1).phase == Working,
    dEvalRework.post.tickets.get(1).reworkLeft == 0,
    dEvalRework.post.tickets.get(1).gasLeft == 1,
    // The failed stage is retired; the rework cycle's work set spawns at
    // the NEXT ids (3,4) — new records, not overwrites.
    dEvalRework.post.tickets.get(1).record == [et(1, 0, Failed), et(2, 0, Passed)],
    dEvalRework.post.tickets.get(1).tasks == Set(wr(3), wr(4)),
    mB(dEvalRework.post) < mB(cEvalFail)
  })

  /// Budget wall, checked before the gas wall.
  pure val cReworkWall: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Evaluating, reworkLeft: 0, gasLeft: 2, tasks: oneFailedE0, spawned: 2 }) }
  pure val dReworkWall = DB::decideEvalStageReduce(cReworkWall, 1)

  /// The same wall on a ticket authored NO rework budget: it declined the
  /// rework economy, so the park offers no resume at all and revoke is its
  /// only exit — the cascade wall's arrangement, reached by authoring.
  pure val cReworkWallNoBudget: Core = { tickets: Map(1 ->
    { ...freshB(Set(), progU2, ManagedFinalizer), reworkPolicy: BudgetedRework(0),
      phase: Evaluating, reworkLeft: 0, gasLeft: 2, tasks: oneFailedE0, spawned: 2 }) }
  pure val dReworkWallNoBudget = DB::decideEvalStageReduce(cReworkWallNoBudget, 1)

  /// Deadline wall: budget remains but the gas is gone.
  pure val cEvalGasWall: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Evaluating, reworkLeft: 1, gasLeft: 0, tasks: oneFailedE0, spawned: 2 }) }
  pure val dEvalGasWall = DB::decideEvalStageReduce(cEvalGasWall, 1)

  run evalWallsNamedTest = assert(and {
    dReworkWall.rec.label == "ticket-escalated rework_budget_exhausted",
    dReworkWall.post.tickets.get(1).reason == ReworkBudgetExhausted,
    dReworkWall.post.tickets.get(1).resumeAt == ResumeReworking,
    mB(dReworkWall.post) < mB(cReworkWall),
    // Same wall, no authored budget: no resume, and the desk may only revoke.
    dReworkWallNoBudget.rec.label == "ticket-escalated rework_budget_exhausted",
    dReworkWallNoBudget.post.tickets.get(1).reason == ReworkBudgetExhausted,
    dReworkWallNoBudget.post.tickets.get(1).resumeAt == NoResume,
    not(DB::retryableIn(dReworkWallNoBudget.post, 1)),
    DB::revocableIn(dReworkWallNoBudget.post, 1),
    mB(dReworkWallNoBudget.post) < mB(cReworkWallNoBudget),
    dEvalGasWall.rec.label == "ticket-escalated gas_exhausted",
    dEvalGasWall.post.tickets.get(1).reason == GasExhausted,
    mB(dEvalGasWall.post) < mB(cEvalGasWall)
  })

  // === : THE STAGED PROGRAM, walked stage by stage =====================
  // progStaged = [{1, unanimous}, {2, any}] on the reference instance. The
  // walk mirrors staged progression edge by edge; the short-circuit
  // mirrors the staged-eval short-circuit fixture (replayed by
  // tests/conformance/conformance_staged_eval_short_circuit_test.qnt,
  // whose header gates the staged content on exactly this model).

  pure def allPassedW: Set[Task] = Set(wt(1, Passed), wt(2, Passed))

  pure val cStagedWork: Core = { tickets: Map(1 -> { ...freshB(Set(), progStaged, ManagedFinalizer),
    phase: Working, gasLeft: 2, tasks: allPassedW, spawned: 2 }) }
  // Work passes -> spawn the LOWEST stage: fan-out 1, id 3.
  pure val dToEval = DB::decideWorkReduce(cStagedWork, 1)
  pure val cS0 = dToEval.post
  // Stage 0's one task passes.
  pure val dS0Done = DB::decideTaskDone(cS0, 1, 3, Pass)
  // THE ADVANCE: stage 0 passed, stage 1 remains -> Evaluating ->
  // Evaluating, next fan-out spawns.
  pure val dAdvance = DB::decideEvalStageReduce(dS0Done.post, 1)
  pure val cS1 = dAdvance.post
  // Stage 1 (AnyPass, fan-out 2): one pass, one fail -> stage passes.
  pure val dS1a = DB::decideTaskDone(cS1, 1, 4, Pass)
  pure val dS1b = DB::decideTaskDone(dS1a.post, 1, 5, Fail)
  pure val dStagedFinal = DB::decideEvalStageReduce(dS1b.post, 1)

  /// The advance edge, exactly: label eval-stage-passed, an Evaluating ->
  /// Evaluating transition, the next stage's fan-out spawned at fresh ids,
  /// the passed stage retired — and STRICT DESCENT (the stage digit
  /// dominates the fresh fan-out: measure.qnt's  digit-order argument,
  /// machine-checked here).
  run stageAdvanceDescendsTest = assert(and {
    dAdvance.rec.label == "eval-stage-passed",
    dAdvance.rec.transitions == [{ ticket: 1, from: Evaluating, to: Evaluating }],
    dAdvance.rec.effects == ["SpawnEvalTasks"],
    cS1.tickets.get(1).phase == Evaluating,
    cS1.tickets.get(1).tasks == Set(er(4, 1), er(5, 1)),
    cS1.tickets.get(1).record == [wt(1, Passed), wt(2, Passed), et(3, 0, Passed)],
    // No account moved: stage progress is priced by the measure digit, not
    // by gas or budget.
    cS1.tickets.get(1).gasLeft == 2,
    cS1.tickets.get(1).reworkLeft == 1,
    mB(cS1) < mB(dS0Done.post)
  })

  /// The FINAL stage passing lands the program: eval-passed, everything
  /// retired, the full anatomy in the log (per-stage combinators applied —
  /// stage 1's AnyPass passed on a mixed set).
  run stagedProgramPassesTest = assert(and {
    dStagedFinal.rec.label == "eval-passed",
    dStagedFinal.rec.transitions == [{ ticket: 1, from: Evaluating, to: Finalizing }],
    dStagedFinal.post.tickets.get(1).tasks == Set(),
    dStagedFinal.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Passed),
       et(4, 1, Passed), et(5, 1, Failed)],
    mB(dStagedFinal.post) < mB(dS1b.post)
  })

  // --- The short-circuit: stage 0 fails, stage 1 is never created ----------

  pure val dS0Fail = DB::decideTaskDone(cS0, 1, 3, Fail)
  pure val dShort = DB::decideEvalStageReduce(dS0Fail.post, 1)
  pure val cAfterShort = dShort.post

  /// SHORT-CIRCUIT ROUTES TO REWORK AND PAYS CORRECTLY: the later stages
  /// are not created — they are skipped, not failed, so no task records
  /// exist for them, and the eval reduce proceeds immediately. The failing
  /// stage buys a rework cycle at the
  /// SAME price as the flat case — exactly 1 rework + 1 gas, nothing else
  /// — and the record holds NO stage-1 task, ever.
  run shortCircuitRoutesToReworkTest = assert(and {
    dShort.rec.label == "rework-started eval_failure",
    dShort.rec.transitions == [{ ticket: 1, from: Evaluating, to: Working }],
    cAfterShort.tickets.get(1).reworkLeft == 0,       // paid 1 rework
    cAfterShort.tickets.get(1).gasLeft == 1,     // paid 1 gas
    cAfterShort.tickets.get(1).finalizationLeft == 1,         // gate untouched
    // "no task records exist for them": stage 1 never spawned.
    cAfterShort.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Failed)],
    cAfterShort.tickets.get(1).record.indices().forall(i =>
      cAfterShort.tickets.get(1).record[i].kind != Evaluation(1)),
    cAfterShort.tickets.get(1).tasks == Set(wr(4), wr(5)),
    mB(cAfterShort) < mB(dS0Fail.post)
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — stages are
  /// recomputed per cycle, never resumed mid-sequence. After
  /// the rework's work set passes, the next Evaluation spawns stage 0
  /// again — never stage 1.
  pure val dReworkW1 = DB::decideTaskDone(cAfterShort, 1, 4, Pass)
  pure val dReworkW2 = DB::decideTaskDone(dReworkW1.post, 1, 5, Pass)
  pure val dBackToEval = DB::decideWorkReduce(dReworkW2.post, 1)

  run reworkRestartsLowestStageTest = assert(and {
    dBackToEval.rec.label == "work-passed",
    dBackToEval.post.tickets.get(1).tasks == Set(er(6, 0)),
    dBackToEval.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Failed),
       wt(4, Passed), wt(5, Passed)]
  })

  /// The golden fixture's exact shape (staged_eval_short_circuit.yaml:
  /// "staged eval: stage-0 fails -> stage 1 never launched -> escalate",
  /// REWORK_POLICY = BudgetedRework(0) there): the same short-circuit against an empty
  /// rework account hits the EXISTING wall — stage 1 remains unlaunched,
  /// no new wall, no new account.
  pure val cStagedNoBudget: Core = { tickets: Map(1 -> { ...freshB(Set(), progStaged, ManagedFinalizer),
    phase: Evaluating, reworkLeft: 0, gasLeft: 2,
    record: [wt(1, Passed), wt(2, Passed)],
    tasks: Set(et(3, 0, Failed)), spawned: 3 }) }
  pure val dStagedWall = DB::decideEvalStageReduce(cStagedNoBudget, 1)

  run stagedShortCircuitEscalatesTest = assert(and {
    dStagedWall.rec.label == "ticket-escalated rework_budget_exhausted",
    dStagedWall.post.tickets.get(1).phase == Escalated,
    dStagedWall.post.tickets.get(1).resumeAt == ResumeReworking,
    dStagedWall.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Failed)],
    dStagedWall.post.tickets.get(1).record.indices().forall(i =>
      dStagedWall.post.tickets.get(1).record[i].kind != Evaluation(1)),
    mB(dStagedWall.post) < mB(cStagedNoBudget)
  })

  /// EVALUATOR CRASH IN A STAGE = THE TICKET PAYS:
  /// evaluator-infrastructure death is a Failed
  /// INSIDE the stage — indistinguishable at the machine's grain from a
  /// failed verdict, deliberately (one account, no new machinery; the
  /// distinction — infra failures escalating immediately —
  /// is a README-noted question for the intake confirmation, not silently
  /// adopted). The stage short-circuits and the TICKET's accounts drain:
  /// exactly 1 rework + 1 gas, same as any product failure.
  run evaluatorCrashTicketPaysTest = assert(and {
    // dShort IS the crash case read as infra death: same Failed, same
    // decision. Pin the account deltas as the claim.
    cStagedWork.tickets.get(1).reworkLeft - cAfterShort.tickets.get(1).reworkLeft == 1,
    cStagedWork.tickets.get(1).gasLeft - cAfterShort.tickets.get(1).gasLeft == 1,
    cStagedWork.tickets.get(1).finalizationLeft == cAfterShort.tickets.get(1).finalizationLeft
  })

  /// Duplicate stale-stage completion, staged edition: while stage 1 is
  /// live (ids 4,5), a re-delivered completion for RETIRED stage-0 task 3
  /// — even with a contradicting verdict — no-ops by identity.
  run staleStageDuplicateNoopsTest = assert(and {
    DB::decideTaskDone(cS1, 1, 3, Fail).post == cS1,
    DB::decideTaskDone(cS1, 1, 3, Fail).rec.label == "task-done",
    mB(DB::decideTaskDone(cS1, 1, 3, Fail).post) == mB(cS1)
  })

  // === PROGRAM-AS-DATA at machine level ======
  // ONE machine instance (DB), two tickets identical but for the program on
  // their record: different decisions.  needed a separate machine
  // instantiation (a machine-wide combinator parameter) to show this; the
  // program makes eval what it is meant to be — data.

  pure val mixedE0: Set[Task] = Set(et(1, 0, Passed), et(2, 0, Failed))
  pure val allFailedE0: Set[Task] = Set(et(1, 0, Failed), et(2, 0, Failed))

  pure val cMixedAny: Core = { tickets: Map(1 -> { ...freshB(Set(), progA2, ManagedFinalizer),
    phase: Evaluating, tasks: mixedE0, gasLeft: 2, spawned: 2 }) }
  pure val cMixedUna: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Evaluating, tasks: mixedE0, gasLeft: 2, spawned: 2 }) }

  run programAsDataCombinatorTest = assert(and {
    DB::decideEvalStageReduce(cMixedAny, 1).rec.label == "eval-passed",
    DB::decideEvalStageReduce(cMixedAny, 1).post.tickets.get(1).phase == Finalizing,
    DB::decideEvalStageReduce(cMixedUna, 1).rec.label == "rework-started eval_failure",
    DB::decideEvalStageReduce(cMixedUna, 1).post.tickets.get(1).phase == Working,
    DB::decideEvalStageReduce(cMixedUna, 1).post.tickets.get(1).gasLeft == 1
  })

  /// Program STRUCTURE is data too: the same passed work set spawns a
  /// 2-wide flat fan-out under the default program but a 1-wide stage-0
  /// under the staged program — the machine's very next task anatomy is
  /// decided by the program on the record.
  pure val cFlatWork: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Working, gasLeft: 2, tasks: allPassedW, spawned: 2 }) }

  run programAsDataStructureTest = assert(and {
    DB::decideWorkReduce(cFlatWork, 1).post.tickets.get(1).tasks ==
      Set(er(3, 0), er(4, 0)),
    DB::decideWorkReduce(cStagedWork, 1).post.tickets.get(1).tasks ==
      Set(er(3, 0))
  })

  /// Both branches of the combinator vocabulary are semantically distinct
  /// (unanimous pass is only the DEFAULT), at the pure grain.
  run combinatorBranchesTest = assert(and {
    combine(UnanimousPass, Set(et(1, 0, Passed), et(2, 0, Passed))),
    not(combine(UnanimousPass, mixedE0)),
    combine(AnyPass, mixedE0),
    not(combine(AnyPass, allFailedE0))
  })

  /// All-failed still walls under AnyPass (a program is not "always
  /// pass"): the rework path is taken.
  pure val cFailAny: Core = { tickets: Map(1 -> { ...freshB(Set(), progA2, ManagedFinalizer),
    phase: Evaluating, tasks: allFailedE0, gasLeft: 2, spawned: 2 }) }

  run anyPassNotAlwaysPassTest = assert(
    DB::decideEvalStageReduce(cFailAny, 1).rec.label == "rework-started eval_failure")

  // === The outer loop, priced per FinalizationPricing ==============================
  // R5: failures fire from the held lease (Finalizing — the
  // only phase a moved attempt resolves out of), so these fixtures sit in
  // the occupied slot; every account delta below is byte-identical to the
  // the earlier pricing (the eviction changed from-phase, never price).

  /// Budgeted branch: a wrap-up failure spends 1 gate budget AND 1 gas.
  pure val cGateB: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Finalizing, finalizationLeft: 1, gasLeft: 2 }) }
  pure val dGateRework = DB::decideFinalizationResult(cGateB, 1, FinalizationFailed)

  run gateReworkBudgetedDescendsTest = assert(and {
    dGateRework.rec.label == "rework-started finalization_failed",
    dGateRework.post.tickets.get(1).phase == Working,
    dGateRework.post.tickets.get(1).finalizationLeft == 0,
    dGateRework.post.tickets.get(1).gasLeft == 1,
    // The wrap-up rework's work set is a fresh incarnation at fresh ids.
    dGateRework.post.tickets.get(1).tasks == Set(wr(1), wr(2)),
    mB(dGateRework.post) < mB(cGateB)
  })

  /// The gate-budget wall — a reason that EXISTS ONLY under Budgeted.
  pure val cGateWall: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Finalizing, finalizationLeft: 0, gasLeft: 2 }) }
  pure val dGateWall = DB::decideFinalizationResult(cGateWall, 1, FinalizationFailed)

  /// Budgeted branch, gas wall: gate budget remains, gas is gone.
  pure val cGateGasWall: Core = { tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Finalizing, finalizationLeft: 1, gasLeft: 0 }) }
  pure val dGateGasWall = DB::decideFinalizationResult(cGateGasWall, 1, FinalizationFailed)

  run gateWallsNamedTest = assert(and {
    dGateWall.rec.label == "ticket-escalated finalization_budget_exhausted",
    dGateWall.post.tickets.get(1).reason == FinalizationBudgetExhausted,
    dGateWall.post.tickets.get(1).resumeAt == ResumeFinalizing,
    mB(dGateWall.post) < mB(cGateWall),
    dGateGasWall.rec.label == "ticket-escalated gas_exhausted",
    dGateGasWall.post.tickets.get(1).reason == GasExhausted,
    mB(dGateGasWall.post) < mB(cGateGasWall)
  })

  /// DeadlineOnly branch: a wrap-up failure spends gas alone (the required
  /// gas account is the only meter), and the gate-budget wall
  /// can never be the reason.
  pure val cGateD: Core = { tickets: Map(1 -> { ...freshD(Set(), progU2, ManagedFinalizer),
    phase: Finalizing, gasLeft: 2 }) }
  pure val dGateD = DD::decideFinalizationResult(cGateD, 1, FinalizationFailed)

  pure val cGateDWall: Core = { tickets: Map(1 -> { ...freshD(Set(), progU2, ManagedFinalizer),
    phase: Finalizing, gasLeft: 0 }) }
  pure val dGateDWall = DD::decideFinalizationResult(cGateDWall, 1, FinalizationFailed)

  run gateReworkDeadlineOnlyTest = assert(and {
    dGateD.rec.label == "rework-started finalization_failed",
    dGateD.post.tickets.get(1).phase == Working,
    dGateD.post.tickets.get(1).finalizationLeft == 0,      // no gate account to spend
    dGateD.post.tickets.get(1).gasLeft == 1,
    mD(dGateD.post) < mD(cGateD),
    dGateDWall.rec.label == "ticket-escalated gas_exhausted",
    dGateDWall.post.tickets.get(1).reason == GasExhausted,
    mD(dGateDWall.post) < mD(cGateDWall)
  })

  // === The human desk: parks, retries, and the metering parameter ==========

  pure val dPark = DB::decideExecutionBlocked(c1, 1, TicketConfigIncompatible)
  pure val dParkResume = DB::decideResumeTicket(dPark.post, 1)

  run executionBlockedAndResumeClassifiedTest = assert(and {
    dPark.rec.label == "ticket-escalated execution_blocked",
    dPark.rec.effects == ["OpenHumanTask"],
    dPark.post.tickets.get(1).phase == Escalated,
    dPark.post.tickets.get(1).reason == TicketConfigIncompatible,
    dPark.post.tickets.get(1).resumeAt == ResumeWorking,
    dPark.post.tickets.get(1).record == [wt(1, Cancelled), wt(2, Cancelled)],
    dPark.post.tickets.get(1).tasks == Set(),
    dParkResume.post.tickets.get(1).phase == Working,
    dParkResume.post.tickets.get(1).reason == NoReason,
    dParkResume.post.tickets.get(1).tasks == Set(wr(3), wr(4))
  })

  /// An infrastructure block during evaluation preserves that source
  /// boundary. Resume retires the interrupted fan-out and creates a fresh
  /// lowest-stage fan-out; it never silently restarts work.
  pure val dEvalPark = DB::decideExecutionBlocked(c4, 1, TicketConfigIncompatible)
  pure val dEvalParkResume = DB::decideResumeTicket(dEvalPark.post, 1)

  run executionBlockedEvaluationResumeFreshTest = assert(and {
    dEvalPark.post.tickets.get(1).phase == Escalated,
    dEvalPark.post.tickets.get(1).resumeAt == ResumeEvaluating,
    dEvalPark.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Cancelled), et(4, 0, Cancelled)],
    dEvalPark.post.tickets.get(1).tasks == Set(),
    dEvalParkResume.post.tickets.get(1).phase == Evaluating,
    dEvalParkResume.post.tickets.get(1).tasks == Set(er(5, 0), er(6, 0)),
    dEvalParkResume.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Cancelled), et(4, 0, Cancelled)]
  })

  /// Charged retry metering, the default: every PIPELINE resume
  /// pays 1 gas, so those retries descend the measure — the free-resume
  /// livelock priced away.
  pure val escFinalizer: Ticket = { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Escalated, resumeAt: ResumeFinalizing, reason: GasExhausted,
    gasLeft: 2 }
  pure val cEscB: Core = { tickets: Map(1 -> escFinalizer) }
  pure val dRetryCharged = DB::decideResumeTicket(cEscB, 1)

  pure val escWorking: Ticket = { ...freshB(Set(), progU2, ManagedFinalizer),
    phase: Escalated, resumeAt: ResumeWorking, reason: WorkFailed,
    gasLeft: 2 }
  pure val dRetryChargedWork = DB::decideResumeTicket({ tickets: Map(1 -> escWorking) }, 1)

  run resumeTicketChargedDescendsTest = assert(and {
    dRetryCharged.rec.label == "ticket-resumed",
    dRetryCharged.post.tickets.get(1).phase == Finalizing,
    dRetryCharged.post.tickets.get(1).gasLeft == 1,   // charged
    not(hasOpenHumanTask(dRetryCharged.post.tickets.get(1))),
    mB(dRetryCharged.post) < mB(cEscB),
    dRetryChargedWork.post.tickets.get(1).phase == Working,
    dRetryChargedWork.post.tickets.get(1).gasLeft == 1,
    mB(dRetryChargedWork.post) < mB({ tickets: Map(1 -> escWorking) })
  })

  /// THE REWORK WALL'S RESUME: refill the eval-rework account to the
  /// AUTHORED budget and respawn WORK. That wall is reached by a verdict,
  /// which has no re-judge to offer, so it buys a new artifact instead of
  /// a second opinion on the old one; the lowest-stage fresh fan-out an
  /// Evaluating resume gives is pinned from the execution-blocked park
  /// above, where an interruption and not a verdict did the parking.
  pure val escRework: Ticket = { ...freshB(Set(), progStaged, ManagedFinalizer),
    phase: Escalated, resumeAt: ResumeReworking, reason: ReworkBudgetExhausted,
    gasLeft: 2, reworkLeft: 0,
    record: [wt(1, Passed), wt(2, Passed), et(3, 0, Failed)], spawned: 3 }
  pure val cEscRework: Core = { tickets: Map(1 -> escRework) }
  pure val dRetryRework = DB::decideResumeTicket(cEscRework, 1)

  /// The same wall on a ticket priced FREE: it still pays, because it
  /// enters Working (standing rule 2), so it descends and joins no CHURN.
  pure val escReworkFree: Ticket = { ...escRework, resumePricing: RetryFree }
  pure val cEscReworkFree: Core = { tickets: Map(1 -> escReworkFree) }
  pure val dRetryReworkFree = DF::decideResumeTicket(cEscReworkFree, 1)

  run resumeTicketReworkRefillsTest = assert(and {
    dRetryRework.rec.label == "ticket-resumed",
    dRetryRework.rec.effects == ["SpawnWorkTasks"],
    dRetryRework.rec.transitions == [{ ticket: 1, from: Escalated, to: Working }],
    dRetryRework.post.tickets.get(1).reworkLeft == 1,  // refilled to the authored budget
    dRetryRework.post.tickets.get(1).gasLeft == 1,     // charged
    dRetryRework.post.tickets.get(1).reason == NoReason,
    dRetryRework.post.tickets.get(1).resumeAt == NoResume,
    // Fresh work ids above an INTACT record: the failed stage stays retired.
    dRetryRework.post.tickets.get(1).tasks == Set(wr(4), wr(5)),
    dRetryRework.post.tickets.get(1).record ==
      [wt(1, Passed), wt(2, Passed), et(3, 0, Failed)],
    mB(dRetryRework.post) < mB(cEscRework),
    // RetryFree changes nothing at this wall.
    dRetryReworkFree.post.tickets.get(1).phase == Working,
    dRetryReworkFree.post.tickets.get(1).gasLeft == 1,
    dRetryReworkFree.post.tickets.get(1).reworkLeft == 1,
    mB(dRetryReworkFree.post) < mB(cEscReworkFree),
    // Gas is what the desk needs here, under BOTH pricings: a ticket that
    // reached this wall with both accounts empty is parked for good.
    DB::retryableIn(cEscRework, 1), DF::retryableIn(cEscReworkFree, 1),
    not(DB::retryableIn({ tickets: Map(1 -> { ...escRework, gasLeft: 0 }) }, 1)),
    not(DF::retryableIn({ tickets: Map(1 -> { ...escReworkFree, gasLeft: 0 }) }, 1))
  })

  /// Free retry metering: a resume into Finalizer charges nothing and the
  /// measure CLIMBS — the CHURN set's other member, a documented churn
  /// kept reproducible by configuration; the Working resume still pays
  /// (entry to Working always meters — standing rule 2).
  pure val cEscF: Core = { tickets: Map(1 -> { ...escFinalizer, resumePricing: RetryFree }) }
  pure val dRetryFree = DF::decideResumeTicket(cEscF, 1)
  pure val dRetryFreeWork = DF::decideResumeTicket({ tickets: Map(1 -> { ...escWorking, resumePricing: RetryFree }) }, 1)

  run resumeTicketFreeClassifiedTest = assert(and {
    dRetryFree.post.tickets.get(1).phase == Finalizing,
    dRetryFree.post.tickets.get(1).gasLeft == 2,      // NOT charged
    mB(dRetryFree.post) > mB(cEscF),                    // CHURN: climbs
    dRetryFreeWork.post.tickets.get(1).gasLeft == 1,  // Working resume pays
    mB(dRetryFreeWork.post) < mB({ tickets: Map(1 -> escWorking) })
  })

  // === Direct release, sparse identity, and ticket-local policy ============

  pure val sparseBase = releaseB(cEmpty, 4, Set(), progU2, ManagedFinalizer).post
  pure val sparseCore = releaseB(sparseBase, 1, Set(4), progStaged, NoFinalizer).post

  run releaseSparseIdentityTest = assert(and {
    sparseCore.tickets.keys() == Set(1, 4),
    sparseCore.tickets.get(1).deps == Set(4),
    sparseCore.tickets.get(1).phase == Pending,
    DB::isBlockedIn(sparseCore, 1),
    not(DB::canReleaseIn(sparseCore, 2)), // count bound reached despite sparse gaps
    not(DB::canReleaseIn(sparseCore, 4))
  })

  pure val localPolicy = DB::decideReleaseTicket(cEmpty, 2, Set(), progStaged,
    1, BudgetedRework(0), DeadlineOnly, RetryFree, NoFinalizer).post.tickets.get(2)

  run releaseMaterializesTicketPolicyTest = assert(and {
    localPolicy.workFanout == 1,
    localPolicy.program == progStaged,
    localPolicy.reworkPolicy == BudgetedRework(0),
    localPolicy.finalizationPricing == DeadlineOnly,
    localPolicy.resumePricing == RetryFree,
    localPolicy.finalizer == NoFinalizer
  })

  // === Revoke, from every live phase =======================================
  // Every non-terminal may be revoked. Single-ticket
  // fixtures: one per live phase (Pending, Pending, Working,
  // Evaluating, Finalizer) and all
  // THREE desk-reason flavors of the one parked phase (post-work wall,
  // pipeline and cascade walls) — the desk fixtures are the
  // measure-FLAT cases (AUTHORING set), every live-rank phase must
  // strictly descend. Accounts are deliberately part-spent so the
  // no-leakage equality below is not vacuously "full grant == full grant".

  pure def revokedShape(j: Ticket): bool = and {
    j.phase == Revoked,
    j.tasks == Set(),          // Revoked RUNS nothing (live set retired)...
    j.resumeAt == NoResume,
    j.reason == NoReason,        // ...and opens NO human task:
    not(hasOpenHumanTask(j))   // revocation is the author's settled choice
  }

  /// Revoke charges no gas and spends (or refunds) no budget: every
  /// account unchanged, account by account.
  pure def accountsUntouched(pre: Ticket, post: Ticket): bool = and {
    post.gasLeft == pre.gasLeft,
    post.reworkLeft == pre.reworkLeft,
    post.finalizationLeft == pre.finalizationLeft
  }

  pure def spent(j: Ticket): Ticket =
    { ...j, gasLeft: 2, reworkLeft: 0, finalizationLeft: 1 }

  pure val jBase: Ticket = spent(freshB(Set(), progU2, ManagedFinalizer))
  pure val jPend: Ticket = { ...jBase, phase: Pending }
  pure val jWork: Ticket = { ...jBase, phase: Working,
    tasks: spawnTasks(Work, 1, 2), spawned: 2 }
  pure val jEval: Ticket = { ...jBase, phase: Evaluating, tasks: mixedE0, spawned: 2 }
  pure val jFinalizer: Ticket = { ...jBase, phase: Finalizing }
  /// Revoke from the OCCUPIED GATE — the slot frees by
  /// phase (derive-don't-store: leaseFreeIn is true of the post-state with
  /// no cleanup step anywhere).
  pure val jGated: Ticket = { ...jBase, phase: Finalizing }
  pure val jEsc: Ticket = { ...jBase, phase: Escalated,
    resumeAt: ResumeReworking, reason: ReworkBudgetExhausted }
  pure val jParkPre: Ticket = { ...jBase, phase: Escalated,
    resumeAt: ResumeWorking, reason: TicketConfigIncompatible }
  pure val jParkDep: Ticket = { ...jBase, phase: Escalated,
    reason: DependencyRevoked }        // resumeAt NoResume: no modeled resume

  pure def revokeOne(j: Ticket): Decision =
    DB::decideRevoke({ tickets: Map(1 -> j) }, 1)

  pure def revokeOneOk(j: Ticket): bool = and {
    revokeOne(j).rec.label == "ticket-revoked",
    revokeOne(j).rec.transitions == [{ ticket: 1, from: j.phase, to: Revoked }],
    revokeOne(j).rec.effects == ["CancelTicketWork"],   // no OpenHumanTask for the revoked ticket
    revokedShape(revokeOne(j).post.tickets.get(1)),
    accountsUntouched(j, revokeOne(j).post.tickets.get(1)),
    revokeOne(j).post.tickets.get(1).completions == 0
  }

  run revokeFromEachPhaseTest = assert(and {
    revokeOneOk(jBase), revokeOneOk(jPend),
    revokeOneOk(jWork), revokeOneOk(jEval),
    revokeOneOk(jEsc), revokeOneOk(jParkPre), revokeOneOk(jParkDep),
    // Finalization begins the non-revocable boundary.
    not(DB::revocableIn({ tickets: Map(1 -> jFinalizer) }, 1))
  })

  /// Revoke RETAINS the task record — "Revoked runs nothing" is
  /// about the live set, not the log. A mid-flight revoke force-closes the
  /// still-outstanding work tasks as Cancelled — a synthetic resolution
  /// recording that the revoke, not a verdict, retired them;
  /// already-resolved outcomes are
  /// preserved unchanged (jEval's mixed stage). Provenance survives the
  /// author's settlement.
  run revokeRetainsRecordTest = assert(and {
    revokeOne(jWork).post.tickets.get(1).record ==
      [wt(1, Cancelled), wt(2, Cancelled)],
    revokeOne(jEval).post.tickets.get(1).record ==
      [et(1, 0, Passed), et(2, 0, Failed)],
    revokeOne(jBase).post.tickets.get(1).record == []   // never ran: no history
  })

  /// Measure classification of revoke, pinned: strict descent from every
  /// live-rank phase (the settled tier swallows rank, stage digit AND
  /// outstanding tasks); exactly FLAT from every desk flavor with nobody to
  /// park — the AUTHORING set's bounded desk-settle member.
  pure def mOne(j: Ticket): int = mB({ tickets: Map(1 -> j) })
  pure def mOneAfter(j: Ticket): int = mB(revokeOne(j).post)

  run revokeMeasureClassifiedTest = assert(and {
    mOneAfter(jBase) < mOne(jBase),
    mOneAfter(jPend) < mOne(jPend),
    mOneAfter(jWork) < mOne(jWork),
    mOneAfter(jEval) < mOne(jEval),
    mOneAfter(jFinalizer) < mOne(jFinalizer),
    mOneAfter(jGated) < mOne(jGated),   // the occupied gate is rank 1: strict
    mOneAfter(jEsc) == mOne(jEsc),      // desk revoke: flat, by design
    mOneAfter(jParkPre) == mOne(jParkPre),
    mOneAfter(jParkDep) == mOne(jParkDep)
  })

  /// The absorbing terminals are exactly the unrevocable phases.
  run revocableExactlyNonTerminalTest = assert(and {
    DB::revocableIn({ tickets: Map(1 -> jBase) }, 1),
    DB::revocableIn({ tickets: Map(1 -> jEsc) }, 1),
    not(DB::revocableIn(c8, 1)),                                  // Done
    not(DB::revocableIn(revokeOne(jBase).post, 1))               // Revoked
  })

  /// REVOKED NEVER COMPLETES (the exclusivity extension): revoking a ticket
  /// parked IN the wrap-up queue emits no completion effect and leaves the
  /// completion counter at zero — contrast with the completed ticket (c8),
  /// whose counter is 1 and which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    revokeOne(jFinalizer).post.tickets.get(1).completions == 0,
    revokeOne(jFinalizer).rec.effects == ["CancelTicketWork"],
    c8.tickets.get(1).completions == 1
  })

  // === THE CASCADE, end-to-end on a 3-ticket chain ============
  // 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 still a
  // Pending behind 2. Revoking 1 must — in ONE atomic decision — settle 1
  // (no task) and park BOTH transitive dependents with their own
  // dependency_revoked desk task, spending nothing anywhere.

  pure val cChain: Core = { tickets: Map(
    1 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Pending },
    2 -> { ...freshB(Set(1), progU2, ManagedFinalizer), phase: Pending },
    3 -> freshB(Set(2), progU2, ManagedFinalizer)
  ) }
  pure val dCascade = DB::decideRevoke(cChain, 1)
  pure val cParked = dCascade.post

  run cascadeEndToEndTest = assert(and {
    dCascade.rec.label == "ticket-revoked",
    // One StepRecord, ascending: the revoke then both parks — atomic.
    // The parks land on Escalated, the one parked phase.
    dCascade.rec.transitions == [
      { ticket: 1, from: Pending, to: Revoked },
      { ticket: 2, from: Pending, to: Escalated },
      { ticket: 3, from: Pending, to: Escalated }
    ],
    // A desk task per parked dependent; NONE for the revoked ticket.
    dCascade.rec.effects == ["CancelTicketWork", "OpenHumanTask", "OpenHumanTask"],
    revokedShape(cParked.tickets.get(1)),
    cParked.tickets.get(2).phase == Escalated,
    cParked.tickets.get(2).reason == DependencyRevoked,
    cParked.tickets.get(2).resumeAt == NoResume,   // no modeled resume: exit is revoke
    hasOpenHumanTask(cParked.tickets.get(2)),
    cParked.tickets.get(3).phase == Escalated,
    cParked.tickets.get(3).reason == DependencyRevoked,
    cParked.tickets.get(3).resumeAt == NoResume,
    hasOpenHumanTask(cParked.tickets.get(3)),
    // The cascade spends nothing on anyone.
    accountsUntouched(cChain.tickets.get(2), cParked.tickets.get(2)),
    accountsUntouched(cChain.tickets.get(3), cParked.tickets.get(3)),
    // And the whole step strictly descends (three ranks fall to 0).
    mB(cParked) < mB(cChain)
  })

  /// The parked dependents' walls resolve by REVOKE, not retry: the
  /// dependency_revoked wall is not retryable (deps are immutable, no
  /// modeled resume exists — the deliberate table-line-44 deviation
  /// documented at retryableIn), while the revalidation wall stays
  /// retryable. A human revoking parked ticket 2 settles it from the desk:
  /// flat measure (AUTHORING member), no re-park of already-parked 3, and
  /// ticket 3's task stays open.
  pure val dSettle2 = DB::decideRevoke(cParked, 2)

  run cascadeSettleByRevokeTest = assert(and {
    not(DB::retryableIn(cParked, 2)),              // dependency_revoked: no retry
    not(DB::retryableIn(cParked, 3)),
    dSettle2.rec.transitions == [{ ticket: 2, from: Escalated, to: Revoked }],
    dSettle2.rec.effects == ["CancelTicketWork"],
    mB(dSettle2.post) == mB(cParked),              // desk revoke: flat, pinned
    dSettle2.post.tickets.get(3).phase == Escalated, // 3 untouched, still covered
    hasOpenHumanTask(dSettle2.post.tickets.get(3))
  })

  // === Finalization is not a Core lease protocol ===========================

  pure val cGateOcc: Core = { tickets: Map(
    1 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Finalizing },
    2 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Finalizing }
  ) }

  run finalizationBoundaryTest = assert(and {
    not(DB::revocableIn({ tickets: Map(1 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Finalizing }) }, 1)),
    not(DB::revocableIn(cGateOcc, 1)),
    not(DB::revocableIn(cGateOcc, 2))
  })

  run finalizationOutcomesDrawRuleTest = assert(
    DB::finalizationOutcomes == Set(FinalizationSucceeded, FinalizationFailed,
      PromotionAccepted, HandoffPublicationUnproven))

  pure val dPromotionAccepted =
    DB::decideFinalizationResult(c7, 1, PromotionAccepted)
  pure val dHandoffBlocked = DB::decideFinalizationResult(
    dPromotionAccepted.post, 1, HandoffPublicationUnproven)
  pure val dHandoffRetried = DB::decideResumeTicket(dHandoffBlocked.post, 1)
  pure val dHandoffSucceeded = DB::decideFinalizationResult(
    dHandoffRetried.post, 1, FinalizationSucceeded)
  pure val dHandoffAbandoned =
    DB::decideAbandonHandoff(dHandoffBlocked.post, 1)
  pure val cHandoffDependents: Core = { tickets: Map(
    1 -> dHandoffBlocked.post.tickets.get(1),
    2 -> freshB(Set(1), progU2, NoFinalizer),
    3 -> freshB(Set(2), progU2, NoFinalizer)
  ) }
  pure val dHandoffCascade = DB::decideAbandonHandoff(cHandoffDependents, 1)

  run postPromotionHandoffTest = assert(and {
    dPromotionAccepted.post.tickets.get(1).phase == PublishingHandoff,
    dPromotionAccepted.rec.effects == ["PublishHandoff"],
    mB(dPromotionAccepted.post) < mB(c7),
    dHandoffBlocked.post.tickets.get(1).phase == HandoffBlocked,
    dHandoffBlocked.post.tickets.get(1).resumeAt == ResumePublishingHandoff,
    hasOpenHumanTask(dHandoffBlocked.post.tickets.get(1)),
    mB(dHandoffBlocked.post) < mB(dPromotionAccepted.post),
    dHandoffRetried.post.tickets.get(1).phase == PublishingHandoff,
    dHandoffRetried.rec.effects == ["PublishHandoff"],
    mB(dHandoffRetried.post) < mB(dHandoffBlocked.post),
    dHandoffSucceeded.post.tickets.get(1).phase == Done,
    dHandoffAbandoned.post.tickets.get(1).phase == Abandoned,
    dHandoffAbandoned.post.tickets.get(1).completions == 0,
    mB(dHandoffAbandoned.post) < mB(dHandoffBlocked.post),
    dHandoffCascade.post.tickets.get(1).phase == Abandoned,
    dHandoffCascade.post.tickets.get(2).phase == Abandoned,
    dHandoffCascade.post.tickets.get(3).phase == Abandoned,
    dHandoffCascade.rec.transitions.length() == 3,
    mB(dHandoffCascade.post) < mB(cHandoffDependents),
    not(DB::revocableIn(dHandoffBlocked.post, 1)),
    not(DB::finalizationOutcomeEnabled(dHandoffBlocked.post, 1,
      FinalizationFailed))
  })

  /// ARTIFACT-BLINDNESS: no digit,
  /// weight or account radix reads the mark, so tickets identical but for it
  /// have EQUAL ticketMeasure. Pinned rather than argued, because a measure
  /// that quietly read the artifact would make the descent table wrong in a
  /// way only a mutation would show.
  run measureArtifactBlindTest = assert(and {
    ticketMeasure(bB, jPend) == ticketMeasure(bB, { ...jPend, artifact: ProducedArtifact(3) }),
    ticketMeasure(bB, jWork) == ticketMeasure(bB, { ...jWork, artifact: ProducedArtifact(9) }),
    ticketMeasure(bB, jEval) == ticketMeasure(bB, { ...jEval, artifact: ProducedArtifact(1) }),
    ticketMeasure(bB, jFinalizer) == ticketMeasure(bB, { ...jFinalizer, artifact: ProducedArtifact(4) }),
    ticketMeasure(bD, jWork) == ticketMeasure(bD, { ...jWork, artifact: ProducedArtifact(2) }),
    ticketMeasure(bB, { ...jEval, artifact: ProducedArtifact(1) })
      == ticketMeasure(bB, { ...jEval, artifact: ProducedArtifact(99) })
  })

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
  pure val cXDepPre: Core = { tickets: Map(
    1 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Finalizing },
    2 -> { ...freshB(Set(1), progU2, ManagedFinalizer), phase: Pending }
  ) }
  pure val cXDepDone: Core = { tickets: Map(
    1 -> { ...freshB(Set(), progU2, ManagedFinalizer), phase: Done, completions: 1 },
    2 -> { ...freshB(Set(1), progU2, ManagedFinalizer), phase: Pending }
  ) }

  run dependencyGateTest = assert(and {
    DB::isBlockedIn(cXDepPre, 2),
    not(DB::isReadyIn(cXDepPre, 2)),
    DB::isReadyIn(cXDepDone, 2),
    not(DB::isBlockedIn(cXDepDone, 2))
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
    accounted(cReworkWall), accounted(cReworkWallNoBudget), accounted(cEvalGasWall),
    accounted(cStagedWork), accounted(cStagedNoBudget),
    accounted(cMixedAny), accounted(cMixedUna),
    accounted(cFlatWork), accounted(cFailAny),
    accounted(cGateB), accounted(cGateWall), accounted(cGateGasWall),
    accounted(cGateD), accounted(cGateDWall),
    accounted(cChain), accounted(cGateOcc),
    accounted(cXDepPre), accounted(cXDepDone),
    accountedTicket(escFinalizer), accountedTicket(escWorking),
    accountedTicket(escRework), accountedTicket(escReworkFree),
    accountedTicket(jBase), accountedTicket(jPend), accountedTicket(jWork),
    accountedTicket(jEval), accountedTicket(jFinalizer), accountedTicket(jGated),
    accountedTicket(jEsc), accountedTicket(jParkPre), accountedTicket(jParkDep)
  })
}
