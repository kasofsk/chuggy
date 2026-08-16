/// Unit tests over the chuggy deciders and the termination measure
/// Everything here is PURE: cores are
/// built by hand, deciders are applied as functions, and the measure is
/// recomputed with explicit Bounds — no init/step machinery, so the tests
/// pin decider behavior independently of the machine's nondet choices.
///
/// What is checked, per the  test brief:
///   - the measure STRICTLY DECREASES on every transition the descent
///     table (measure.qnt header) claims descends;
///   - the STUTTER-set transitions (duplicate deliveries) leave it exactly
///     unchanged, and the CHURN-set transitions are pinned as the only
///     climbers;
///   - effect-exclusivity at the landing boundary on a happy path AND a
///     task-done-duplicate / complete-duplicate path;
///   - every escalation wall carries its name, on
///     both WrapUpPricing branches;
///   - both retry-metering branches.
///
///  additions (authoring lifecycle; gate: revoke cascades proved safe):
///   - arrival/release strictly descend where the descent table says, and
///     the AUTHORING climber (arrival) is pinned as a climber;
///   - revoke from EVERY live phase, with the desk-only flat cases
///     pinned, and revocableIn false exactly on the absorbing terminals;
///   - the cascade end-to-end on a 3-ticket chain; unreleased deps block;
///     revoked never completes; revoke/cascade spend NOTHING.
///
///  additions (task-records depth; gate: phase-outcome combinators
/// pinned by the eval vocabulary
/// staged evaluation, §1.2 task records, and the golden fixture
/// staged_eval_short_circuit.yaml; standing in until the intake
/// `eval/vocabulary` answer confirms or overrides it):
///   - a two-stage program walks stage-by-stage: the advance is an
///     Evaluating -> Evaluating step that STRICTLY
///     DESCENDS (the new stage digit dominates the next fan-out);
///   - a failing stage SHORT-CIRCUITS into the existing rework economy —
///     pays exactly 1 rework + 1 gas, the later stage's tasks are NEVER
///     created ("skipped, not failed, so no task records exist for them"),
///     and the next cycle restarts from the LOWEST stage;
///   - the same short-circuit against empty accounts hits the existing
///     walls (the golden fixture's exact shape: stage-0 fails, stage 1
///     never launched, escalate);
///   - evaluator crash = a TFailed inside the stage = THE TICKET PAYS, exact
///     account deltas;
///   - stale completions from an earlier stage/incarnation NO-OP BY
///     IDENTITY (task ids are sequential within the ticket, never reused);
///   - task records are RETAINED: the per-ticket chronological log survives
///     reduces, escalations, and revoke (running tasks force-closed as
///     TCancelled, because a revoke closes tasks);
///   - PROGRAM-AS-DATA at machine level: two tickets in the SAME machine
///     instance, identical but
///     for their programs, decide differently — combinator and structure
///     both;
///   - validPrograms IS the arrival-refusal rule: the ill-formed programs
///     are not in it.
///
/// Authoring-lifecycle coverage:
///   - release goes Draft -> Pending directly;
///   - the revalidation park lands on PEscalated with reason + RPending
///     resume, and its operator resume — a
///     decideOpRetry flavor — is pinned FREE (both meterings) and CHURN;
///   - the dependency_revoked wall is pinned resume-less (retryableIn
///     false at any gas) — its only exit is revoke;
///   - the revoke suite covers all THREE desk-reason flavors of the one
///     parked phase (post-work wall, pre-work revalidation, cascade wall);
///   - gas rename throughout (gasLeft, gas_exhausted, RsGasExhausted,
///     GAS; gasRequiredTest pins the required account);
///   - REWORK_POLICY = RWBudget(n) instantiates the rework policy;
///   - the task lifecycle is the explicit TaskState sum: wt/et build
///     resolved states, wr/er build running ones.
///
/// PROJECT ISOLATION (gate: the isolation invariants —
/// design at domain.qnt's header):
///   - the wrapUpOutcomes draw rule pinned: a QUIET branch refuses
///     WFailed (the structural refusal — a valid, uninvalidated artifact
///     always commits cleanly, expressed as the outcome set itself);
///   - landing-boundary ATTRIBUTION pinned at decider grain, on a
///     project-2 ticket so own-project attribution is distinguishable from
///     project-constant stamping: both successes, the wrap-up rework, and both
///     landing walls each carry WOAttempt with the ticket's OWN project and
///     the attempt's invalidated choice — and the effect vocabulary is
///     untouched by the new field;
///   - every NON-landing step carries WONone — including the shared
///     "ticket-escalated gas_exhausted" label from the EVAL side (the
///     attribution, not the label string, marks the landing boundary),
///     eval-passed (which merely enqueues), and the absorbed
///     complete-duplicate;
///   - PROJECT-BLINDNESS as a machine check, not just a comment theorem:
///     tickets identical but for `project` have EQUAL ticketMeasure, phase
///     by phase, under both pricings (the measure.qnt derivation pinned);
///   - the dep gate is LOCATION-BLIND at decider grain: a project-2 ticket
///     blocked behind a project-1 dep derives Ready the moment the dep is
///     Done — Done-ness, never location (the machine-trace version is
///     the crossProjectDepDeterministicTest witness);
///   - arrival carries the authored project (and every pre-multi-project test
///     updated mechanically: fixtures author project 1, successes draw
///     quiet, failures draw moved — the only combinations the machine
///     can draw).
///
/// WRAP-UP additions (the refinement layer — design, PROPOSED
/// requirements R1-R7, and the severability map at domain.qnt's header):
///   - THE PATH RULE pinned (R3, at decider grain):
///     wrapUpOutcomes(false) is the WOk singleton (the skip
///     fast-path), wrapUpOutcomes(true) is {WOk, WFailed} (the
///     gate ran) — quiet refuses failure AND the held promotion, moved
///     refuses the direct squash; both success paths emit the ONE
///     completion effect;
///   - THE DEPTH-1 GUARD pinned (R4): an occupied gate refuses every
///     same-project dequeue (wrapUpStartableIn false) while another project's
///     dequeue stays enabled — serialization is per-project; wrapup-started
///     is rank descent, WONone, charges nothing;
///   - THE EVICTION unchanged in pricing (R5): the existing gate-rework/
///     wall fixtures moved from PWrapUp to PWrapUpHolding (where failures now
///     fire from) with account deltas byte-identical;
///   - THE GROUP (R7) is GONE — the grouping removal deleted PBatched, the
///     marks, absorption, the dep union, the fan-out and the dissolution,
///     so this suite's group section went with it.
module chuggy_test {
  import chuggy_measure.* from "../measure"

  // Reference instance: Budgeted(1) gate pricing, charged retries — the
  // defaults. Programs up
  // to 2 stages — combinators are data on each ticket's program, so the
  // program-as-data tests below get both combinators from ONE instance
  // (which is the point).
  import chuggy_domain(
    N_TICKETS = 2, N_TASKS = 2, REWORK_POLICY = RWBudget(1), GAS = 3,
    WRAPUP_PRICING = Budgeted(1), OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2, N_PROJECTS = 2
  ) as DB from "../domain"

  // DeadlineOnly gate pricing (the other §2 branch).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = RWBudget(1), GAS = 3,
    WRAPUP_PRICING = DeadlineOnly, OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2, N_PROJECTS = 2
  ) as DD from "../domain"

  // Free retry metering — a documented churn, kept reproducible
  // by configuration (machine-level coverage: mc_chuggy_retryfree).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = RWBudget(1), GAS = 3,
    WRAPUP_PRICING = Budgeted(1), OP_RETRY_PRICING = RetryFree,
    MAX_STAGES = 2, N_PROJECTS = 2
  ) as DF from "../domain"

  // N_PROJECTS = 1 — the degeneration instance: the project universe collapses
  // to {1}, every arrival draw / stamp / attribution is project 1, and the
  // draw rule and pricing are project-independent — the single-project machine
  // with a constant field (README's degeneration claim, pinned here).
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = RWBudget(1), GAS = 3,
    WRAPUP_PRICING = Budgeted(1), OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2, N_PROJECTS = 1
  ) as DO from "../domain"

  // A GASLESS graph — invalid: the gas account is required.
  import chuggy_domain(
    N_TICKETS = 1, N_TASKS = 2, REWORK_POLICY = RWBudget(1), GAS = 0,
    WRAPUP_PRICING = Budgeted(1), OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2, N_PROJECTS = 2
  ) as DZ from "../domain"

  /// The required-account rule: a gasless graph is INVALID — the model
  /// admits no initial state for it at all.
  run gasRequiredTest = DZ::init.fail()

  // The same bounds the instances above carry, for measure recomputation.
  pure val bB: Bounds =
    { reworkPolicy: RWBudget(1), nTasks: 2, maxStages: 2, wrapUpPricing: Budgeted(1) }
  pure val bD: Bounds =
    { reworkPolicy: RWBudget(1), nTasks: 2, maxStages: 2, wrapUpPricing: DeadlineOnly }

  pure def mB(c: Core): int = sysMeasure(bB, c.tickets)
  pure def mD(c: Core): int = sysMeasure(bD, c.tickets)

  // Task-record literals, kept terse: wt/et build RESOLVED work and
  // eval-stage tasks (the record's vocabulary — TSResolved carries the
  // outcome), wr/er build RUNNING ones (the live set's). The split IS the
  // the explicit lifecycle showing up in the test vocabulary; every
  // pre-existing test needed only this mechanical rewrap.
  pure def wt(i: int, o: TaskOutcome): Task =
    { id: i, kind: TKWork, state: TSResolved(o) }
  pure def et(i: int, s: int, o: TaskOutcome): Task =
    { id: i, kind: TKEval(s), state: TSResolved(o) }
  pure def wr(i: int): Task =
    { id: i, kind: TKWork, state: TSRunning }
  pure def er(i: int, s: int): Task =
    { id: i, kind: TKEval(s), state: TSRunning }

  // A HAND-BUILT FIXTURE STATES ITS OWN `spawned`. The ghost counter
  // (measure.qnt Ticket.spawned) is bumped ONLY by spawnOn, and the literals
  // above build live sets and records directly — so a fixture that hands
  // itself a task set or a record and leaves freshTicket's 0 in place breaks
  // domain.qnt's idsAccounted (spawned == record.length + tasks.size), which
  // makes it a state the machine cannot reach. That is not cosmetic: the
  // work-passed decider READS the counter, stamping ASome(retired.spawned) as
  // the artifact identity, so a short counter answers a question the machine
  // would answer differently. freshTicket's 0 is right for a fixture with no
  // history; every fixture below that gives itself one carries the matching
  // count, and handBuiltFixturesAccountedTest (bottom of this file) is what
  // keeps the next one honest.

  // Programs used throughout. progU2 is exactly DB::defaultProgram — the
  // unanimous single-stage default, which is the compatibility shape: a
  // ticket whose evaluators all share one stage behaves byte-for-byte like
  // a single fan-out.
  pure val progU2: List[Stage] = [{ fanout: 2, combinator: CUnanimousPass }]
  pure val progA2: List[Stage] = [{ fanout: 2, combinator: CAnyPass }]
  pure val progStaged: List[Stage] =
    [{ fanout: 1, combinator: CUnanimousPass },
     { fanout: 2, combinator: CAnyPass }]

  run defaultProgramIsUnanimousSingleStageTest = assert(and {
    DB::defaultProgram == progU2,
    DB::validPrograms.contains(DB::defaultProgram)
  })

  /// validPrograms IS the arrival-refusal rule (programs must be non-empty
  /// and valid or arrival refuses): the ill-formed shapes are simply not
  /// authorable. At N_TASKS = 2, MAX_STAGES = 2 there are exactly 4 stage
  /// choices, hence 4 + 16 = 20 programs.
  run validProgramsRefusalTest = assert(and {
    DB::validPrograms.contains(progU2),
    DB::validPrograms.contains(progStaged),
    not(DB::validPrograms.contains([])),                                    // empty program
    not(DB::validPrograms.contains([{ fanout: 0, combinator: CUnanimousPass }])), // zero fan-out
    not(DB::validPrograms.contains([{ fanout: 3, combinator: CUnanimousPass }])), // fan-out > N_TASKS
    not(DB::validPrograms.contains(                                          // length > MAX_STAGES
      [{ fanout: 1, combinator: CUnanimousPass },
       { fanout: 1, combinator: CUnanimousPass },
       { fanout: 1, combinator: CUnanimousPass }])),
    DB::validPrograms.size() == 20
  })

  // === The happy path, decision by decision ================================
  // The path STARTS at authoring — the fleet is empty, ticket 1 arrives
  // as a Draft (freshTicket seam) and is released straight into Pending;
  // ticket 2 arrives as a Draft
  // depending on 1 and stays unreleased throughout. ticket 1 carries
  // the DEFAULT program, and its task ids run 1..4 across the whole
  // history (work 1,2 then eval-stage-0 3,4 — sequential within the
  // ticket).

  pure val cEmpty: Core = { tickets: Map() }
  pure val dArr1 = DB::decideArrive(cEmpty, Set(), DB::defaultProgram, 1, WExclusive(1))
  pure val cA1 = dArr1.post                        // ticket 1: Draft
  pure val dArr2 = DB::decideArrive(cA1, Set(1), DB::defaultProgram, 1, WExclusive(1))
  pure val cA2 = dArr2.post                        // ticket 2: Draft, dep {1}
  pure val dRelease = DB::decideRelease(cA2, 1)

  pure val c0: Core = dRelease.post                // ticket 1: Pending, ticket 2: Draft
  pure val dDispatch = DB::decideDispatch(c0, 1)   // spawns TKWork ids 1,2
  pure val c1 = dDispatch.post
  pure val dWork1 = DB::decideTaskDone(c1, 1, 1, VPass)
  pure val c2 = dWork1.post
  pure val dWork2 = DB::decideTaskDone(c2, 1, 2, VPass)
  pure val c3 = dWork2.post
  pure val dWorkReduce = DB::decideWorkReduce(c3, 1)  // retires 1,2; spawns TKEval(0) 3,4
  pure val c4 = dWorkReduce.post
  pure val dEval1 = DB::decideTaskDone(c4, 1, 3, VPass)
  pure val c5 = dEval1.post
  pure val dEval2 = DB::decideTaskDone(c5, 1, 4, VPass)
  pure val c6 = dEval2.post
  pure val dEvalReduce = DB::decideEvalStageReduce(c6, 1)  // final (only) stage passes
  pure val c7 = dEvalReduce.post
  // The happy path lands QUIET: the solo ticket's branch
  // never moved, so the dequeue takes the skip fast-path — gate skipped,
  // direct completion, one step off the queue (wrapUpOutcomes(false)'s one
  // element; the held-lease completion path is walked in the lease suite
  // below and in the witness gate module).
  pure val dComplete = DB::decideWrapUpResolve(c7, 1, WOk, false)
  pure val c8 = dComplete.post

  /// Every decision on the happy path strictly descends the measure —
  /// dispatch (gas), task completions (task count), both phase reductions
  /// (rank), the landing (rank).
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
    dDispatch.rec.transitions == [{ ticket: 1, from: PPending, to: PWorking }],
    dWork1.rec.label == "task-done",
    dWork1.rec.transitions == [],
    dWorkReduce.rec.label == "work-passed",
    dWorkReduce.rec.transitions == [{ ticket: 1, from: PWorking, to: PEvaluating }],
    dEvalReduce.rec.label == "eval-passed",
    dEvalReduce.rec.transitions == [{ ticket: 1, from: PEvaluating, to: PWrapUp }],
    dComplete.rec.label == "ticket-done",
    dComplete.rec.transitions == [{ ticket: 1, from: PWrapUp, to: PDone }],
    // THE SPAWN EFFECTS, pinned here because nothing else pins them. The
    // citation-scoping removal took out the suite that used to, and a
    // spawn emitting no effect is a fan-out the world never hears about —
    // a hole an all-green test set cannot show you. Found by mutation:
    // dropping SpawnEvalTasks from work-passed left all 54 cases passing.
    dDispatch.rec.effects == ["SpawnWorkTasks"],
    dWorkReduce.rec.effects == ["SpawnEvalTasks"],
    dEvalReduce.rec.effects == ["EnqueueWrapUp"]
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
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TPassed), et(4, 0, TPassed)],
    c8.tickets.get(1).tasks == Set(),
    // Intermediate shape: after the work reduce the work set is already
    // retired and the eval stage is live above it.
    c4.tickets.get(1).record == [wt(1, TPassed), wt(2, TPassed)],
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
    cA1.tickets.get(1).spawned == 0,          // a Draft has spawned nothing
    c1.tickets.get(1).spawned == 2,           // the work fan-out
    accounted(c1),
    c4.tickets.get(1).spawned == 4,           // + eval stage 0's fan-out
    accounted(c4),
    c8.tickets.get(1).spawned == 4,           // Done: all retired, none lost
    accounted(c8)
  })

  /// EFFECT EXCLUSIVITY, happy path (effect-only):
  /// exactly one completion effect, exactly at Done — the quiet fast-path's
  /// direct squash (the path rule: WOk is the one outcome a quiet draw
  /// permits).
  run effectExclusivityHappyPathTest = assert(and {
    c8.tickets.get(1).phase == PDone,
    c8.tickets.get(1).completions == 1,
    dComplete.rec.effects == ["Complete"]
  })

  /// The held twin of c7's landing: the dequeue drew MOVED, the gate
  /// opened, and the resolution promotes by ADVANCING the default ref.
  pure val dGateOpen7 = DB::decideWrapUpStart(c7, 1)
  pure val cGated7 = dGateOpen7.post
  pure val dCompleteGated = DB::decideWrapUpResolve(cGated7, 1, WOk, true)

  /// BOTH WRAP-UP SUCCESS PATHS EMIT THE ONE EFFECT: the held promotion
  /// advances the default ref onto the validated candidate, the quiet
  /// fast-path squash-merges directly, and each emits exactly "Complete".
  /// What tells them apart is the phase each resolves from (R3, at decider
  /// grain) — never the effect, because which mechanism promoted the
  /// artifact is the adapter's and the domain does not know it. Same
  /// terminal, same exclusivity counter.
  run wrapUpSuccessPathsEmitOneEffectTest = assert(and {
    dCompleteGated.rec.effects == ["Complete"],
    dCompleteGated.rec.transitions == [{ ticket: 1, from: PWrapUpHolding, to: PDone }],
    dCompleteGated.post.tickets.get(1).phase == PDone,
    dCompleteGated.post.tickets.get(1).completions == 1,
    dComplete.rec.effects == ["Complete"],
    dComplete.rec.transitions == [{ ticket: 1, from: PWrapUp, to: PDone }]
  })

  /// The gate OPENS as its own recorded step (the dequeue's moved arm):
  /// rank descent, no account moved, no attempt resolved (WONone — the
  /// attribution rides the RESOLUTION, whose PWrapUpHolding from-phase carries the
  /// choice this open encoded).
  run gateOpenClassifiedTest = assert(and {
    dGateOpen7.rec.label == "wrapup-started",
    dGateOpen7.rec.transitions == [{ ticket: 1, from: PWrapUp, to: PWrapUpHolding }],
    dGateOpen7.rec.effects == ["OpenGate"],
    dGateOpen7.rec.landing == WONone,
    cGated7.tickets.get(1).gasLeft == c7.tickets.get(1).gasLeft,
    cGated7.tickets.get(1).wrapUpLeft == c7.tickets.get(1).wrapUpLeft,
    mB(cGated7) < mB(c7),
    mB(dCompleteGated.post) < mB(cGated7)
  })

  /// THE ROUTING DECIDER, both branches pinned (adversarial review,
  /// MAJOR 1): decideDequeue IS the quiet/moved route — moved into the
  /// gate (equal, decision for decision, to decideWrapUpStart), quiet into
  /// the same-step direct squash (equal to the fast-path decideWrapUpResolve call)
  /// — pinned as decision EQUALITIES plus the semantic content of each
  /// branch, so a re-routed branch cannot hide behind self-consistent
  /// downstream checks (the review's p3 mutant: quiet routed into the
  /// gate made WOk unreachable while every trace-level check
  /// stayed green against the mutated route).
  run dequeueRoutesBothBranchesTest = assert(and {
    DB::decideDequeue(c7, 1, true) == DB::decideWrapUpStart(c7, 1),
    DB::decideDequeue(c7, 1, false)
      == DB::decideWrapUpResolve(c7, 1, WOk, false),
    DB::decideDequeue(c7, 1, true).post.tickets.get(1).phase == PWrapUpHolding,
    DB::decideDequeue(c7, 1, true).rec.label == "wrapup-started",
    DB::decideDequeue(c7, 1, false).post.tickets.get(1).phase == PDone,
    DB::decideDequeue(c7, 1, false).rec.label == "ticket-done",
    DB::decideDequeue(c7, 1, false).rec.effects == ["Complete"],
    DB::decideDequeue(c7, 1, false).rec.landing
      == WOAttempt({ project: 1, invalidated: false }),
    DB::decideDequeue(c7, 1, false).post.tickets.get(1).completions == 1
  })

  // === At-least-once: duplicates are idempotent stutters ===================

  /// A duplicate completion for an already-resolved LIVE task (even with a
  /// CONTRADICTING verdict — first write wins) changes nothing: no state,
  /// no effects, no measure movement — an at-least-once delivery
  /// honored idempotently.
  run duplicateTaskDoneIdempotentTest = assert(and {
    DB::decideTaskDone(c2, 1, 1, VFail).post == c2,
    DB::decideTaskDone(c2, 1, 1, VFail).rec.label == "task-done-duplicate",
    DB::decideTaskDone(c2, 1, 1, VFail).rec.effects == [],
    mB(DB::decideTaskDone(c2, 1, 1, VFail).post) == mB(c2)
  })

  /// STALE-STAGE / STALE-INCARNATION completions no-op BY IDENTITY:
  /// ids are sequential within the ticket and never reused, so a completion
  /// for a task retired into the record — here work task 1 (an earlier
  /// incarnation) and eval task 3 delivered AFTER the eval stage retired —
  /// finds no live running match and absorbs as the duplicate stutter,
  /// whatever verdict it carries. (had to absorb the same-id case
  /// into the respawned set's nondet verdict; identity retired that
  /// argument — the honest extension of the duplicate-adversary scope.)
  run staleStageCompletionNoopsTest = assert(and {
    // c4: eval stage 0 live (ids 3,4); work ids 1,2 retired.
    DB::decideTaskDone(c4, 1, 1, VFail).post == c4,
    DB::decideTaskDone(c4, 1, 1, VFail).rec.label == "task-done-duplicate",
    // c7: Landing, everything retired; a stale eval completion no-ops.
    DB::decideTaskDone(c7, 1, 3, VFail).post == c7,
    DB::decideTaskDone(c7, 1, 3, VFail).rec.label == "task-done-duplicate",
    mB(DB::decideTaskDone(c4, 1, 1, VFail).post) == mB(c4)
  })

  /// EFFECT EXCLUSIVITY, complete-duplicate path: a re-delivered completion
  /// event for a Done ticket emits NOTHING — exactly-once is proved at the
  /// landing boundary and nowhere else.
  run completeDuplicateExclusiveTest = assert(and {
    DB::decideCompleteDuplicate(c8, 1).post == c8,
    DB::decideCompleteDuplicate(c8, 1).rec.label == "complete-duplicate",
    DB::decideCompleteDuplicate(c8, 1).rec.effects == [],
    DB::decideCompleteDuplicate(c8, 1).post.tickets.get(1).completions == 1,
    mB(DB::decideCompleteDuplicate(c8, 1).post) == mB(c8)
  })

  // === The work wall: cycle-level, no below-cycle retries ==================

  pure def oneFailedW: Set[Task] = Set(wt(1, TFailed), wt(2, TPassed))

  /// A failed Work task set escalates DIRECTLY at cycle level — there is
  /// no same-cycle retry branch to take: below-cycle retries are the
  /// fabric's trusted relaunch limit, and modeling them is a standing
  /// non-goal — no retry machinery below the cycle.
  /// The failed set is RETIRED, outcomes intact — the record shows
  /// WHICH task failed, provenance the desk can read.
  pure val cWorkFail: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWorking, gasLeft: 2, tasks: oneFailedW, spawned: 2 }) }
  pure val dWorkFail = DB::decideWorkReduce(cWorkFail, 1)

  run workFailedWallTest = assert(and {
    dWorkFail.rec.label == "ticket-escalated work_failed",
    dWorkFail.post.tickets.get(1).phase == PEscalated,
    dWorkFail.post.tickets.get(1).reason == RsWorkFailed,
    dWorkFail.post.tickets.get(1).resumeAt == RWorking,
    hasOpenHumanTask(dWorkFail.post.tickets.get(1)),
    dWorkFail.rec.effects == ["OpenHumanTask"],
    dWorkFail.post.tickets.get(1).record == [wt(1, TFailed), wt(2, TPassed)],
    dWorkFail.post.tickets.get(1).tasks == Set(),
    mB(dWorkFail.post) < mB(cWorkFail)
  })

  // === The middle loop (budgeted eval rework) and its two walls ============

  pure def oneFailedE0: Set[Task] = Set(et(1, 0, TFailed), et(2, 0, TPassed))

  /// Eval rework — the SHORT-CIRCUIT priced (single-stage program, so the
  /// short-circuit and the reduce coincide; the staged case is below):
  /// 1 rework budget + 1 gas buy a new cycle; both accounts (and the
  /// measure) descend. TFailed here also covers evaluator-infra death —
  /// the ticket pays, one account.
  pure val cEvalFail: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEvaluating, reworkLeft: 1, gasLeft: 2, tasks: oneFailedE0, spawned: 2 }) }
  pure val dEvalRework = DB::decideEvalStageReduce(cEvalFail, 1)

  run evalReworkDescendsTest = assert(and {
    dEvalRework.rec.label == "rework-started eval_failure",
    dEvalRework.post.tickets.get(1).phase == PWorking,
    dEvalRework.post.tickets.get(1).reworkLeft == 0,
    dEvalRework.post.tickets.get(1).gasLeft == 1,
    // The failed stage is retired; the rework cycle's work set spawns at
    // the NEXT ids (3,4) — new records, not overwrites.
    dEvalRework.post.tickets.get(1).record == [et(1, 0, TFailed), et(2, 0, TPassed)],
    dEvalRework.post.tickets.get(1).tasks == Set(wr(3), wr(4)),
    mB(dEvalRework.post) < mB(cEvalFail)
  })

  /// Budget wall, checked before the gas wall.
  pure val cReworkWall: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEvaluating, reworkLeft: 0, gasLeft: 2, tasks: oneFailedE0, spawned: 2 }) }
  pure val dReworkWall = DB::decideEvalStageReduce(cReworkWall, 1)

  /// Deadline wall: budget remains but the gas is gone.
  pure val cEvalGasWall: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEvaluating, reworkLeft: 1, gasLeft: 0, tasks: oneFailedE0, spawned: 2 }) }
  pure val dEvalGasWall = DB::decideEvalStageReduce(cEvalGasWall, 1)

  run evalWallsNamedTest = assert(and {
    dReworkWall.rec.label == "ticket-escalated rework_budget_exhausted",
    dReworkWall.post.tickets.get(1).reason == RsReworkBudgetExhausted,
    dReworkWall.post.tickets.get(1).resumeAt == REvaluating,
    mB(dReworkWall.post) < mB(cReworkWall),
    dEvalGasWall.rec.label == "ticket-escalated gas_exhausted",
    dEvalGasWall.post.tickets.get(1).reason == RsGasExhausted,
    mB(dEvalGasWall.post) < mB(cEvalGasWall)
  })

  // === : THE STAGED PROGRAM, walked stage by stage =====================
  // progStaged = [{1, unanimous}, {2, any}] on the reference instance. The
  // walk mirrors staged progression edge by edge; the short-circuit
  // mirrors the staged-eval short-circuit fixture (replayed by
  // tests/conformance/conformance_staged_eval_short_circuit_test.qnt,
  // whose header gates the staged content on exactly this model).

  pure def allPassedW: Set[Task] = Set(wt(1, TPassed), wt(2, TPassed))

  pure val cStagedWork: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progStaged, 1, WExclusive(1)),
    phase: PWorking, gasLeft: 2, tasks: allPassedW, spawned: 2 }) }
  // Work passes -> spawn the LOWEST stage: fan-out 1, id 3.
  pure val dToEval = DB::decideWorkReduce(cStagedWork, 1)
  pure val cS0 = dToEval.post
  // Stage 0's one task passes.
  pure val dS0Done = DB::decideTaskDone(cS0, 1, 3, VPass)
  // THE ADVANCE: stage 0 passed, stage 1 remains -> Evaluating ->
  // Evaluating, next fan-out spawns.
  pure val dAdvance = DB::decideEvalStageReduce(dS0Done.post, 1)
  pure val cS1 = dAdvance.post
  // Stage 1 (CAnyPass, fan-out 2): one pass, one fail -> stage passes.
  pure val dS1a = DB::decideTaskDone(cS1, 1, 4, VPass)
  pure val dS1b = DB::decideTaskDone(dS1a.post, 1, 5, VFail)
  pure val dStagedFinal = DB::decideEvalStageReduce(dS1b.post, 1)

  /// The advance edge, exactly: label eval-stage-passed, an Evaluating ->
  /// Evaluating transition, the next stage's fan-out spawned at fresh ids,
  /// the passed stage retired — and STRICT DESCENT (the stage digit
  /// dominates the fresh fan-out: measure.qnt's  digit-order argument,
  /// machine-checked here).
  run stageAdvanceDescendsTest = assert(and {
    dAdvance.rec.label == "eval-stage-passed",
    dAdvance.rec.transitions == [{ ticket: 1, from: PEvaluating, to: PEvaluating }],
    dAdvance.rec.effects == ["SpawnEvalTasks"],
    cS1.tickets.get(1).phase == PEvaluating,
    cS1.tickets.get(1).tasks == Set(er(4, 1), er(5, 1)),
    cS1.tickets.get(1).record == [wt(1, TPassed), wt(2, TPassed), et(3, 0, TPassed)],
    // No account moved: stage progress is priced by the measure digit, not
    // by gas or budget.
    cS1.tickets.get(1).gasLeft == 2,
    cS1.tickets.get(1).reworkLeft == 1,
    mB(cS1) < mB(dS0Done.post)
  })

  /// The FINAL stage passing lands the program: eval-passed, everything
  /// retired, the full anatomy in the log (per-stage combinators applied —
  /// stage 1's CAnyPass passed on a mixed set).
  run stagedProgramPassesTest = assert(and {
    dStagedFinal.rec.label == "eval-passed",
    dStagedFinal.rec.transitions == [{ ticket: 1, from: PEvaluating, to: PWrapUp }],
    dStagedFinal.post.tickets.get(1).tasks == Set(),
    dStagedFinal.post.tickets.get(1).record ==
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TPassed),
       et(4, 1, TPassed), et(5, 1, TFailed)],
    mB(dStagedFinal.post) < mB(dS1b.post)
  })

  // --- The short-circuit: stage 0 fails, stage 1 is never created ----------

  pure val dS0Fail = DB::decideTaskDone(cS0, 1, 3, VFail)
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
    dShort.rec.transitions == [{ ticket: 1, from: PEvaluating, to: PWorking }],
    cAfterShort.tickets.get(1).reworkLeft == 0,       // paid 1 rework
    cAfterShort.tickets.get(1).gasLeft == 1,     // paid 1 gas
    cAfterShort.tickets.get(1).wrapUpLeft == 1,         // gate untouched
    // "no task records exist for them": stage 1 never spawned.
    cAfterShort.tickets.get(1).record ==
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TFailed)],
    cAfterShort.tickets.get(1).record.indices().forall(i =>
      cAfterShort.tickets.get(1).record[i].kind != TKEval(1)),
    cAfterShort.tickets.get(1).tasks == Set(wr(4), wr(5)),
    mB(cAfterShort) < mB(dS0Fail.post)
  })

  /// The rework cycle RESTARTS FROM THE LOWEST STAGE — stages are
  /// recomputed per cycle, never resumed mid-sequence. After
  /// the rework's work set passes, the next Evaluation spawns stage 0
  /// again — never stage 1.
  pure val dReworkW1 = DB::decideTaskDone(cAfterShort, 1, 4, VPass)
  pure val dReworkW2 = DB::decideTaskDone(dReworkW1.post, 1, 5, VPass)
  pure val dBackToEval = DB::decideWorkReduce(dReworkW2.post, 1)

  run reworkRestartsLowestStageTest = assert(and {
    dBackToEval.rec.label == "work-passed",
    dBackToEval.post.tickets.get(1).tasks == Set(er(6, 0)),
    dBackToEval.post.tickets.get(1).record ==
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TFailed),
       wt(4, TPassed), wt(5, TPassed)]
  })

  /// The golden fixture's exact shape (staged_eval_short_circuit.yaml:
  /// "staged eval: stage-0 fails -> stage 1 never launched -> escalate",
  /// REWORK_POLICY = RWBudget(0) there): the same short-circuit against an empty
  /// rework account hits the EXISTING wall — stage 1 remains unlaunched,
  /// no new wall, no new account.
  pure val cStagedNoBudget: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progStaged, 1, WExclusive(1)),
    phase: PEvaluating, reworkLeft: 0, gasLeft: 2,
    record: [wt(1, TPassed), wt(2, TPassed)],
    tasks: Set(et(3, 0, TFailed)), spawned: 3 }) }
  pure val dStagedWall = DB::decideEvalStageReduce(cStagedNoBudget, 1)

  run stagedShortCircuitEscalatesTest = assert(and {
    dStagedWall.rec.label == "ticket-escalated rework_budget_exhausted",
    dStagedWall.post.tickets.get(1).phase == PEscalated,
    dStagedWall.post.tickets.get(1).resumeAt == REvaluating,
    dStagedWall.post.tickets.get(1).record ==
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TFailed)],
    dStagedWall.post.tickets.get(1).record.indices().forall(i =>
      dStagedWall.post.tickets.get(1).record[i].kind != TKEval(1)),
    mB(dStagedWall.post) < mB(cStagedNoBudget)
  })

  /// EVALUATOR CRASH IN A STAGE = THE TICKET PAYS:
  /// evaluator-infrastructure death is a TFailed
  /// INSIDE the stage — indistinguishable at the machine's grain from a
  /// failed verdict, deliberately (one account, no new machinery; the
  /// distinction — infra failures escalating immediately —
  /// is a README-noted question for the intake confirmation, not silently
  /// adopted). The stage short-circuits and the TICKET's accounts drain:
  /// exactly 1 rework + 1 gas, same as any product failure.
  run evaluatorCrashTicketPaysTest = assert(and {
    // dShort IS the crash case read as infra death: same TFailed, same
    // decision. Pin the account deltas as the claim.
    cStagedWork.tickets.get(1).reworkLeft - cAfterShort.tickets.get(1).reworkLeft == 1,
    cStagedWork.tickets.get(1).gasLeft - cAfterShort.tickets.get(1).gasLeft == 1,
    cStagedWork.tickets.get(1).wrapUpLeft == cAfterShort.tickets.get(1).wrapUpLeft
  })

  /// Duplicate stale-stage completion, staged edition: while stage 1 is
  /// live (ids 4,5), a re-delivered completion for RETIRED stage-0 task 3
  /// — even with a contradicting verdict — no-ops by identity.
  run staleStageDuplicateNoopsTest = assert(and {
    DB::decideTaskDone(cS1, 1, 3, VFail).post == cS1,
    DB::decideTaskDone(cS1, 1, 3, VFail).rec.label == "task-done-duplicate",
    mB(DB::decideTaskDone(cS1, 1, 3, VFail).post) == mB(cS1)
  })

  // === PROGRAM-AS-DATA at machine level ======
  // ONE machine instance (DB), two tickets identical but for the program on
  // their record: different decisions.  needed a separate machine
  // instantiation (a machine-wide combinator parameter) to show this; the
  // program makes eval what it is meant to be — data.

  pure val mixedE0: Set[Task] = Set(et(1, 0, TPassed), et(2, 0, TFailed))
  pure val allFailedE0: Set[Task] = Set(et(1, 0, TFailed), et(2, 0, TFailed))

  pure val cMixedAny: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progA2, 1, WExclusive(1)),
    phase: PEvaluating, tasks: mixedE0, gasLeft: 2, spawned: 2 }) }
  pure val cMixedUna: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEvaluating, tasks: mixedE0, gasLeft: 2, spawned: 2 }) }

  run programAsDataCombinatorTest = assert(and {
    DB::decideEvalStageReduce(cMixedAny, 1).rec.label == "eval-passed",
    DB::decideEvalStageReduce(cMixedAny, 1).post.tickets.get(1).phase == PWrapUp,
    DB::decideEvalStageReduce(cMixedUna, 1).rec.label == "rework-started eval_failure",
    DB::decideEvalStageReduce(cMixedUna, 1).post.tickets.get(1).phase == PWorking,
    DB::decideEvalStageReduce(cMixedUna, 1).post.tickets.get(1).gasLeft == 1
  })

  /// Program STRUCTURE is data too: the same passed work set spawns a
  /// 2-wide flat fan-out under the default program but a 1-wide stage-0
  /// under the staged program — the machine's very next task anatomy is
  /// decided by the program on the record.
  pure val cFlatWork: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWorking, gasLeft: 2, tasks: allPassedW, spawned: 2 }) }

  run programAsDataStructureTest = assert(and {
    DB::decideWorkReduce(cFlatWork, 1).post.tickets.get(1).tasks ==
      Set(er(3, 0), er(4, 0)),
    DB::decideWorkReduce(cStagedWork, 1).post.tickets.get(1).tasks ==
      Set(er(3, 0))
  })

  /// Both branches of the combinator vocabulary are semantically distinct
  /// (unanimous pass is only the DEFAULT), at the pure grain.
  run combinatorBranchesTest = assert(and {
    combine(CUnanimousPass, Set(et(1, 0, TPassed), et(2, 0, TPassed))),
    not(combine(CUnanimousPass, mixedE0)),
    combine(CAnyPass, mixedE0),
    not(combine(CAnyPass, allFailedE0))
  })

  /// All-failed still walls under CAnyPass (a program is not "always
  /// pass"): the rework path is taken.
  pure val cFailAny: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progA2, 1, WExclusive(1)),
    phase: PEvaluating, tasks: allFailedE0, gasLeft: 2, spawned: 2 }) }

  run anyPassNotAlwaysPassTest = assert(
    DB::decideEvalStageReduce(cFailAny, 1).rec.label == "rework-started eval_failure")

  // === The outer loop, priced per WrapUpPricing ==============================
  // R5: failures fire from the held lease (PWrapUpHolding — the
  // only phase a moved attempt resolves out of), so these fixtures sit in
  // the occupied slot; every account delta below is byte-identical to the
  // the earlier pricing (the eviction changed from-phase, never price).

  /// Budgeted branch: a landing failure spends 1 gate budget AND 1 gas.
  pure val cGateB: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUpHolding, wrapUpLeft: 1, gasLeft: 2 }) }
  pure val dGateRework = DB::decideWrapUpResolve(cGateB, 1, WFailed, true)

  run gateReworkBudgetedDescendsTest = assert(and {
    dGateRework.rec.label == "rework-started wrapup_failure",
    dGateRework.post.tickets.get(1).phase == PWorking,
    dGateRework.post.tickets.get(1).wrapUpLeft == 0,
    dGateRework.post.tickets.get(1).gasLeft == 1,
    // The wrap-up rework's work set is a fresh incarnation at fresh ids.
    dGateRework.post.tickets.get(1).tasks == Set(wr(1), wr(2)),
    mB(dGateRework.post) < mB(cGateB)
  })

  /// The gate-budget wall — a reason that EXISTS ONLY under Budgeted.
  pure val cGateWall: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUpHolding, wrapUpLeft: 0, gasLeft: 2 }) }
  pure val dGateWall = DB::decideWrapUpResolve(cGateWall, 1, WFailed, true)

  /// Budgeted branch, gas wall: gate budget remains, gas is gone.
  pure val cGateGasWall: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUpHolding, wrapUpLeft: 1, gasLeft: 0 }) }
  pure val dGateGasWall = DB::decideWrapUpResolve(cGateGasWall, 1, WFailed, true)

  run gateWallsNamedTest = assert(and {
    dGateWall.rec.label == "ticket-escalated wrapup_budget_exhausted",
    dGateWall.post.tickets.get(1).reason == RsWrapUpBudgetExhausted,
    dGateWall.post.tickets.get(1).resumeAt == RWrapUp,
    mB(dGateWall.post) < mB(cGateWall),
    dGateGasWall.rec.label == "ticket-escalated gas_exhausted",
    dGateGasWall.post.tickets.get(1).reason == RsGasExhausted,
    mB(dGateGasWall.post) < mB(cGateGasWall)
  })

  /// DeadlineOnly branch: a landing failure spends gas alone (the required
  /// gas account is the only meter), and the gate-budget wall
  /// can never be the reason.
  pure val cGateD: Core = { tickets: Map(1 -> { ...DD::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUpHolding, gasLeft: 2 }) }
  pure val dGateD = DD::decideWrapUpResolve(cGateD, 1, WFailed, true)

  pure val cGateDWall: Core = { tickets: Map(1 -> { ...DD::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUpHolding, gasLeft: 0 }) }
  pure val dGateDWall = DD::decideWrapUpResolve(cGateDWall, 1, WFailed, true)

  run gateReworkDeadlineOnlyTest = assert(and {
    dGateD.rec.label == "rework-started wrapup_failure",
    dGateD.post.tickets.get(1).phase == PWorking,
    dGateD.post.tickets.get(1).wrapUpLeft == 0,      // no gate account to spend
    dGateD.post.tickets.get(1).gasLeft == 1,
    mD(dGateD.post) < mD(cGateD),
    dGateDWall.rec.label == "ticket-escalated gas_exhausted",
    dGateDWall.post.tickets.get(1).reason == RsGasExhausted,
    mD(dGateDWall.post) < mD(cGateDWall)
  })

  // === The human desk: parks, retries, and the metering parameter ==========

  /// Pre-work invalidation parks the ticket (rank 5 -> 0: descends, free) on
  /// PEscalated's one parked phase — with the pre-work
  /// wall's reason AND resume point (RPending: back to Pending, never to a
  /// pipeline phase, because nothing pipeline ever ran) …
  /// (freshTicket births a Draft, so the RELEASED fixture overrides
  /// the phase — revalFail is a Ready-phase edge.)
  pure val cFresh: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PPending }) }
  pure val dPark = DB::decideRevalFail(cFresh, 1)

  /// … and its operator resume — decideOpRetry's
  /// RPending flavor — is the CHURN set's canonical member: the measure
  /// CLIMBS and NOTHING is charged, because nothing was ever spent — pinned
  /// here so the descent claim's exemption list stays honest.
  pure val dParkResume = DB::decideOpRetry(dPark.post, 1)

  run preWorkParkAndResumeClassifiedTest = assert(and {
    dPark.rec.label == "ticket-escalated revalidation_failed",
    dPark.rec.effects == ["OpenHumanTask"],
    dPark.post.tickets.get(1).phase == PEscalated,
    dPark.post.tickets.get(1).reason == RsRevalidationFailed,
    dPark.post.tickets.get(1).resumeAt == RPending,
    hasOpenHumanTask(dPark.post.tickets.get(1)),     // derived, not stored
    mB(dPark.post) < mB(cFresh),
    dParkResume.rec.label == "operator-retry",
    dParkResume.rec.transitions == [{ ticket: 1, from: PEscalated, to: PPending }],
    dParkResume.post.tickets.get(1).phase == PPending,
    dParkResume.post.tickets.get(1).reason == RsNone,
    dParkResume.post.tickets.get(1).resumeAt == RNone,
    dParkResume.post.tickets.get(1).gasLeft == dPark.post.tickets.get(1).gasLeft, // FREE
    not(hasOpenHumanTask(dParkResume.post.tickets.get(1))),
    mB(dParkResume.post) > mB(dPark.post)  // CHURN: climbs, by design
  })

  /// The pre-work resume's pricing, pinned at the boundary: FREE under
  /// BOTH meterings — retryable even at ZERO gas (charged instance DB and
  /// free instance DF alike), where every charging flavor is not
  /// (opRetryChargedDescendsTest's fixtures need gas). This is the "still
  /// free?" question in the triage's resume-flavor row answered with a
  /// machine check: yes, because nothing was ever spent, and the Working
  /// boundary still meters any actual re-entry (standing rule 2).
  pure val cParkNoGas: Core =
    { tickets: Map(1 -> { ...dPark.post.tickets.get(1), gasLeft: 0 }) }
  run preWorkResumeFreeAtZeroGasTest = assert(and {
    DB::retryableIn(cParkNoGas, 1),
    DF::retryableIn(cParkNoGas, 1),
    DB::decideOpRetry(cParkNoGas, 1).post.tickets.get(1).phase == PPending,
    DB::decideOpRetry(cParkNoGas, 1).post.tickets.get(1).gasLeft == 0,
    // Contrast: a CHARGING resume at zero gas is not retryable (the
    // permanently-parked corner).
    not(DB::retryableIn({ tickets: Map(1 -> { ...escLanding, gasLeft: 0 }) }, 1))
  })

  /// Charged retry metering, the default: every PIPELINE resume
  /// pays 1 gas, so those retries descend the measure — the free-resume
  /// livelock priced away. (The pre-work RPending flavor stays free
  /// either way —
  /// pinned above.)
  pure val escLanding: Ticket = { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEscalated, resumeAt: RWrapUp, reason: RsGasExhausted,
    gasLeft: 2 }
  pure val cEscB: Core = { tickets: Map(1 -> escLanding) }
  pure val dRetryCharged = DB::decideOpRetry(cEscB, 1)

  pure val escWorking: Ticket = { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PEscalated, resumeAt: RWorking, reason: RsWorkFailed,
    gasLeft: 2 }
  pure val dRetryChargedWork = DB::decideOpRetry({ tickets: Map(1 -> escWorking) }, 1)

  run opRetryChargedDescendsTest = assert(and {
    dRetryCharged.rec.label == "operator-retry",
    dRetryCharged.post.tickets.get(1).phase == PWrapUp,
    dRetryCharged.post.tickets.get(1).gasLeft == 1,   // charged
    not(hasOpenHumanTask(dRetryCharged.post.tickets.get(1))),
    mB(dRetryCharged.post) < mB(cEscB),
    dRetryChargedWork.post.tickets.get(1).phase == PWorking,
    dRetryChargedWork.post.tickets.get(1).gasLeft == 1,
    mB(dRetryChargedWork.post) < mB({ tickets: Map(1 -> escWorking) })
  })

  /// The Evaluating resume is A FRESH FAN-OUT OF THE LOWEST STAGE
  /// — re-enter evaluation with a fresh eval fan-out, stages never resumed
  /// mid-sequence — new task ids, the failed history untouched in the
  /// record.
  pure val escEval: Ticket = { ...DB::freshTicket(Set(), progStaged, 1, WExclusive(1)),
    phase: PEscalated, resumeAt: REvaluating, reason: RsReworkBudgetExhausted,
    gasLeft: 2, reworkLeft: 0,
    record: [wt(1, TPassed), wt(2, TPassed), et(3, 0, TFailed)], spawned: 3 }
  pure val dRetryEval = DB::decideOpRetry({ tickets: Map(1 -> escEval) }, 1)

  run opRetryEvalFreshFanoutTest = assert(and {
    dRetryEval.rec.label == "operator-retry",
    dRetryEval.rec.effects == ["SpawnEvalTasks"],
    dRetryEval.post.tickets.get(1).phase == PEvaluating,
    dRetryEval.post.tickets.get(1).gasLeft == 1,   // charged
    // Lowest stage, fresh id 4; the retired stage-0 failure stays on record.
    dRetryEval.post.tickets.get(1).tasks == Set(er(4, 0)),
    dRetryEval.post.tickets.get(1).record ==
      [wt(1, TPassed), wt(2, TPassed), et(3, 0, TFailed)],
    mB(dRetryEval.post) < mB({ tickets: Map(1 -> escEval) })
  })

  /// Free retry metering: a resume into Landing charges nothing and the
  /// measure CLIMBS — the CHURN set's other member, a documented churn
  /// kept reproducible by configuration; the Working resume still pays
  /// (entry to Working always meters — standing rule 2).
  pure val cEscF: Core = { tickets: Map(1 -> escLanding) }
  pure val dRetryFree = DF::decideOpRetry(cEscF, 1)
  pure val dRetryFreeWork = DF::decideOpRetry({ tickets: Map(1 -> escWorking) }, 1)

  run opRetryFreeClassifiedTest = assert(and {
    dRetryFree.post.tickets.get(1).phase == PWrapUp,
    dRetryFree.post.tickets.get(1).gasLeft == 2,      // NOT charged
    mB(dRetryFree.post) > mB(cEscF),                    // CHURN: climbs
    dRetryFreeWork.post.tickets.get(1).gasLeft == 1,  // Working resume pays
    mB(dRetryFreeWork.post) < mB({ tickets: Map(1 -> escWorking) })
  })

  // ==========================================================================
  // === : the authoring lifecycle =======================================
  // ==========================================================================

  /// Arrival through the freshTicket seam: dense ids, born a Draft with FULL
  /// accounts, its authored PROGRAM on the record and an empty task
  /// log, CreateDraft effect, no phase transition (a birth, not an edge) —
  /// and the measure CLIMBS by the fresh Draft's whole ticketMeasure: the
  /// AUTHORING set's arrival member, pinned as a climber so the
  /// stepDescends exemption list stays honest.
  run arrivalTest = assert(and {
    dArr1.rec.label == "ticket-arrived",
    dArr1.rec.transitions == [],
    dArr1.rec.effects == ["CreateDraft"],
    cA1.tickets.keys() == Set(1),
    cA1.tickets.get(1).phase == PDraft,
    cA1.tickets.get(1).gasLeft == 3,     // full grant, nothing spent
    cA1.tickets.get(1).reworkLeft == 1,
    cA1.tickets.get(1).wrapUpLeft == 1,
    cA1.tickets.get(1).program == DB::defaultProgram,  // eval is data, authored
    cA1.tickets.get(1).record == [],                   // no history yet
    cA2.tickets.keys() == Set(1, 2),          // dense: next id = size + 1
    cA2.tickets.get(2).deps == Set(1),        // dep on an UNRELEASED ticket: legal
    mB(cA1) > mB(cEmpty),                  // AUTHORING: climbs
    mB(cA2) > mB(cA1)
  })

  /// Release strictly descends (Draft -> Pending, rank 6 -> 5), golden-trace
  /// shaped, and the derived waiting room splits it correctly on landing.
  /// Release is authoring's only phase edge after arrival, and arrival is
  /// the AUTHORING set's only climber (pinned in
  /// arrivalTest).
  run releaseDescendsTest = assert(and {
    dRelease.rec.label == "ticket-released",
    dRelease.rec.transitions == [{ ticket: 1, from: PDraft, to: PPending }],
    mB(c0) < mB(cA2),
    DB::isReadyIn(c0, 1)                 // no deps: Ready derives
  })

  /// A dependency on an UNRELEASED ticket blocks: release ticket 2 while its dep
  /// (ticket 1) is still Draft — Blocked derives. Positive control: once the
  /// dep is Done (c8), releasing ticket 2 derives Ready.
  pure val cRel2: Core = DB::decideRelease(cA2, 2).post   // 2 Pending, dep 1 Draft
  run unreleasedDepBlocksTest = assert(and {
    DB::isBlockedIn(cRel2, 2),
    not(DB::isReadyIn(cRel2, 2)),
    DB::isReadyIn(DB::decideRelease(c8, 2).post, 2)       // Done dep: Ready
  })

  // === Revoke, from every live phase =======================================
  // Every non-terminal may be revoked. Single-ticket
  // fixtures: one per live phase (Draft, Pending, Working,
  // Evaluating, Landing) and all
  // THREE desk-reason flavors of the one parked phase (post-work wall,
  // pre-work revalidation, cascade wall) — the desk fixtures are the
  // measure-FLAT cases (AUTHORING set), every live-rank phase must
  // strictly descend. Accounts are deliberately part-spent so the
  // no-leakage equality below is not vacuously "full grant == full grant".

  pure def revokedShape(j: Ticket): bool = and {
    j.phase == PRevoked,
    j.tasks == Set(),          // Revoked RUNS nothing (live set retired)...
    j.resumeAt == RNone,
    j.reason == RsNone,        // ...and opens NO human task:
    not(hasOpenHumanTask(j))   // revocation is the author's settled choice
  }

  /// Revoke charges no gas and spends (or refunds) no budget: every
  /// account unchanged, account by account.
  pure def accountsUntouched(pre: Ticket, post: Ticket): bool = and {
    post.gasLeft == pre.gasLeft,
    post.reworkLeft == pre.reworkLeft,
    post.wrapUpLeft == pre.wrapUpLeft
  }

  pure def spent(j: Ticket): Ticket =
    { ...j, gasLeft: 2, reworkLeft: 0, wrapUpLeft: 1 }

  pure val jDraft: Ticket = spent(DB::freshTicket(Set(), progU2, 1, WExclusive(1)))
  pure val jPend: Ticket = { ...jDraft, phase: PPending }
  pure val jWork: Ticket = { ...jDraft, phase: PWorking,
    tasks: spawnTasks(TKWork, 1, 2), spawned: 2 }
  pure val jEval: Ticket = { ...jDraft, phase: PEvaluating, tasks: mixedE0, spawned: 2 }
  pure val jLand: Ticket = { ...jDraft, phase: PWrapUp }
  /// Revoke from the OCCUPIED GATE — the slot frees by
  /// phase (derive-don't-store: leaseFreeIn is true of the post-state with
  /// no cleanup step anywhere).
  pure val jGated: Ticket = { ...jDraft, phase: PWrapUpHolding }
  pure val jEsc: Ticket = { ...jDraft, phase: PEscalated,
    resumeAt: REvaluating, reason: RsReworkBudgetExhausted }
  pure val jParkPre: Ticket = { ...jDraft, phase: PEscalated,
    resumeAt: RPending, reason: RsRevalidationFailed }
  pure val jParkDep: Ticket = { ...jDraft, phase: PEscalated,
    reason: RsDependencyRevoked }        // resumeAt RNone: no modeled resume

  pure def revokeOne(j: Ticket): Decision =
    DB::decideRevoke({ tickets: Map(1 -> j) }, 1)

  pure def revokeOneOk(j: Ticket): bool = and {
    revokeOne(j).rec.label == "ticket-revoked",
    revokeOne(j).rec.transitions == [{ ticket: 1, from: j.phase, to: PRevoked }],
    revokeOne(j).rec.effects == ["Revoke"],   // no OpenHumanTask for the revoked ticket
    revokedShape(revokeOne(j).post.tickets.get(1)),
    accountsUntouched(j, revokeOne(j).post.tickets.get(1)),
    revokeOne(j).post.tickets.get(1).completions == 0
  }

  run revokeFromEachPhaseTest = assert(and {
    revokeOneOk(jDraft), revokeOneOk(jPend),
    revokeOneOk(jWork), revokeOneOk(jEval), revokeOneOk(jLand),
    revokeOneOk(jGated),
    revokeOneOk(jEsc), revokeOneOk(jParkPre), revokeOneOk(jParkDep),
    // Revoking the gate's occupant frees the slot by phase alone.
    DB::leaseFreeIn(revokeOne(jGated).post, 1)
  })

  /// Revoke RETAINS the task record — "Revoked runs nothing" is
  /// about the live set, not the log. A mid-flight revoke force-closes the
  /// still-running work tasks as TCancelled — a synthetic resolution
  /// recording that the revoke, not a verdict, retired them;
  /// already-resolved outcomes are
  /// preserved unchanged (jEval's mixed stage). Provenance survives the
  /// author's settlement.
  run revokeRetainsRecordTest = assert(and {
    revokeOne(jWork).post.tickets.get(1).record ==
      [wt(1, TCancelled), wt(2, TCancelled)],
    revokeOne(jEval).post.tickets.get(1).record ==
      [et(1, 0, TPassed), et(2, 0, TFailed)],
    revokeOne(jDraft).post.tickets.get(1).record == []   // never ran: no history
  })

  /// Measure classification of revoke, pinned: strict descent from every
  /// live-rank phase (the settled tier swallows rank, stage digit AND
  /// running tasks); exactly FLAT from every desk flavor with nobody to
  /// park — the AUTHORING set's bounded desk-settle member.
  pure def mOne(j: Ticket): int = mB({ tickets: Map(1 -> j) })
  pure def mOneAfter(j: Ticket): int = mB(revokeOne(j).post)

  run revokeMeasureClassifiedTest = assert(and {
    mOneAfter(jDraft) < mOne(jDraft),
    mOneAfter(jPend) < mOne(jPend),
    mOneAfter(jWork) < mOne(jWork),
    mOneAfter(jEval) < mOne(jEval),
    mOneAfter(jLand) < mOne(jLand),
    mOneAfter(jGated) < mOne(jGated),   // the occupied gate is rank 1: strict
    mOneAfter(jEsc) == mOne(jEsc),      // desk revoke: flat, by design
    mOneAfter(jParkPre) == mOne(jParkPre),
    mOneAfter(jParkDep) == mOne(jParkDep)
  })

  /// The absorbing terminals are exactly the unrevocable phases.
  run revocableExactlyNonTerminalTest = assert(and {
    DB::revocableIn({ tickets: Map(1 -> jDraft) }, 1),
    DB::revocableIn({ tickets: Map(1 -> jEsc) }, 1),
    not(DB::revocableIn(c8, 1)),                                  // Done
    not(DB::revocableIn(revokeOne(jDraft).post, 1))               // Revoked
  })

  /// REVOKED NEVER COMPLETES (the exclusivity extension): revoking a ticket
  /// parked ON the landing strip emits no completion effect and leaves the
  /// completion counter at zero — contrast with the completed ticket (c8),
  /// whose counter is 1 and which is beyond revoke's reach (previous test).
  run revokedNeverCompletesTest = assert(and {
    revokeOne(jLand).post.tickets.get(1).completions == 0,
    revokeOne(jLand).rec.effects == ["Revoke"],
    c8.tickets.get(1).completions == 1
  })

  // === THE CASCADE, end-to-end on a 3-ticket chain ============
  // 1 <- 2 <- 3: ticket 1 released, ticket 2 released behind it, ticket 3 still a
  // Draft behind 2. Revoking 1 must — in ONE atomic decision — settle 1
  // (no task) and park BOTH transitive dependents with their own
  // dependency_revoked desk task, spending nothing anywhere.

  pure val cChain: Core = { tickets: Map(
    1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PPending },
    2 -> { ...DB::freshTicket(Set(1), progU2, 1, WExclusive(1)), phase: PPending },
    3 -> DB::freshTicket(Set(2), progU2, 1, WExclusive(1))
  ) }
  pure val dCascade = DB::decideRevoke(cChain, 1)
  pure val cParked = dCascade.post

  run cascadeEndToEndTest = assert(and {
    dCascade.rec.label == "ticket-revoked",
    // One StepRecord, ascending: the revoke then both parks — atomic.
    // The parks land on PEscalated, the one parked phase.
    dCascade.rec.transitions == [
      { ticket: 1, from: PPending, to: PRevoked },
      { ticket: 2, from: PPending, to: PEscalated },
      { ticket: 3, from: PDraft, to: PEscalated }
    ],
    // A desk task per parked dependent; NONE for the revoked ticket.
    dCascade.rec.effects == ["Revoke", "OpenHumanTask", "OpenHumanTask"],
    revokedShape(cParked.tickets.get(1)),
    cParked.tickets.get(2).phase == PEscalated,
    cParked.tickets.get(2).reason == RsDependencyRevoked,
    cParked.tickets.get(2).resumeAt == RNone,   // no modeled resume: exit is revoke
    hasOpenHumanTask(cParked.tickets.get(2)),
    cParked.tickets.get(3).phase == PEscalated,
    cParked.tickets.get(3).reason == RsDependencyRevoked,
    cParked.tickets.get(3).resumeAt == RNone,
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
    DB::retryableIn(dPark.post, 1),                // revalidation_failed: retryable
    dSettle2.rec.transitions == [{ ticket: 2, from: PEscalated, to: PRevoked }],
    dSettle2.rec.effects == ["Revoke"],
    mB(dSettle2.post) == mB(cParked),              // desk revoke: flat, pinned
    dSettle2.post.tickets.get(3).phase == PEscalated, // 3 untouched, still covered
    hasOpenHumanTask(dSettle2.post.tickets.get(3))
  })

  // ==========================================================================
  // === THE WRAP-UP: the depth-1 gate ======================
  // ==========================================================================
  // Design, PROPOSED requirements R1-R7, and provenance at domain.qnt's
  // header (landing/requirements was never answered — everything these
  // mechanics serve is derived and pending confirmation).

  /// THE DEPTH-1 GUARD (R4): with project 1's slot held, every same-project
  /// dequeue is refused — including the would-be-quiet one (quietness is
  /// only checked AT the dequeue: each dequeued job re-checks the
  /// fast-path against the then-current state) — while
  /// project 2's dequeue stays enabled: serialization is per-project, gates are
  /// independent. The occupant itself is not enqueued (PWrapUpHolding is not
  /// PWrapUp), and a free project's enqueued tickets are all dequeue-able
  /// (which one dequeues is the nondet pick — order deliberately
  /// unmodeled).
  pure val cGateOcc: Core = { tickets: Map(
    1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PWrapUpHolding },
    2 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PWrapUp },
    3 -> { ...DB::freshTicket(Set(), progU2, 2, WExclusive(2)), phase: PWrapUp }
  ) }

  run leaseExclusiveGuardTest = assert(and {
    not(DB::leaseFreeIn(cGateOcc, 1)),
    DB::leaseFreeIn(cGateOcc, 2),
    not(DB::wrapUpStartableIn(cGateOcc, 2)),   // same project: REFUSED — depth 1
    DB::wrapUpStartableIn(cGateOcc, 3),        // other project: independent
    not(DB::wrapUpStartableIn(cGateOcc, 1)),   // the occupant is not enqueued
    // Once the slot frees (here: the occupant lands, gated), the refusal
    // lifts in the same post-state — occupancy is phase, nothing cleans up.
    DB::wrapUpStartableIn(DB::decideWrapUpResolve(cGateOcc, 1, WOk, true).post, 2)
  })

  // ==========================================================================
  // === PROJECT ISOLATION at the landing boundary ============================
  // ==========================================================================
  // Design + provenance at domain.qnt's header (the refinement layer, gate:
  // isolation invariants; `domain/firstclass` "one orchestrator, many
  // targets"; the named-nondet discipline). Project universe on DB: {1, 2} —
  // N_PROJECTS = 2, the smallest universe where own-project attribution is
  // distinguishable from a constant stamp.

  /// The same single-ticket fixture, re-targeted at project 2 — the authored
  /// field is the ONLY difference, which is exactly what the attribution
  /// and blindness tests below need.
  pure def onProject2(c: Core): Core =
    { tickets: Map(1 -> { ...c.tickets.get(1), project: 2 }) }

  /// THE DRAW RULE (domain.qnt wrapUpOutcomes — the validPrograms shape: the
  /// set IS the refusal). An artifact the environment left VALID cannot
  /// fail its wrap-up; only an INVALIDATED one may. That is the general
  /// form of what was the merge path rule — the moving default branch was
  /// one way an artifact stops being the thing that was evaluated, and a
  /// registry version claimed by someone else is another.
  ///
  /// The set-equality conjuncts are THE guard for the draw sets. A widened
  /// wrapUpOutcomes — a failure readmitted on a valid artifact — is caught
  /// HERE and nowhere else: the machine actions and the witness drivers all
  /// draw FROM these sets, so every trace-level check stays
  /// self-consistently green against a widening.
  run wrapUpOutcomesDrawRuleTest = assert(and {
    DB::wrapUpOutcomes(false) == Set(WOk),
    DB::wrapUpOutcomes(true) == Set(WOk, WFailed),
    // The load-bearing refusal: a valid artifact has no failure to draw.
    not(DB::wrapUpOutcomes(false).contains(WFailed)),
    // And an invalidated one is not FORCED to fail — re-validation may pass.
    DB::wrapUpOutcomes(true).contains(WOk),
    DB::projects == Set(1, 2)
  })

  /// A quiet-dequeue fixture (PWrapUp — the queue): the fast-path
  /// resolves straight off it; the moved arms above resolve from cGateB's
  /// occupied slot.
  pure val cQueueB: Core = { tickets: Map(1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)),
    phase: PWrapUp, wrapUpLeft: 1, gasLeft: 2 }) }

  /// EVERY arm of decideWrapUpResolve stamps the attempt's attribution — the
  /// ticket's OWN project (project 2 here: a constant-stamping mutant would say
  /// 1) plus the environment's invalidated choice, while the effect
  /// vocabulary and pricing stay exactly as the gate tests above pin them.
  /// Combos are the PATH-legal ones only (wrapUpOutcomes):
  /// quiet+WOk off the queue, moved+WOk/Failed out of
  /// the lease.
  /// NOTE: the gas-wall conjuncts below are THE guard for that landing
  /// arm's stamp — wrapUpIsolation's completeness cannot forbid the
  /// shared gas_exhausted label, so a stamp-drop there is visible only
  /// here (multi-project review, observation A).
  run landingAttributionStampsOwnProjectTest = assert(and {
    // Success, quiet: the fast-path off the queue — attributed, effects
    // untouched.
    DB::decideWrapUpResolve(onProject2(cQueueB), 1, WOk, false).rec.landing
      == WOAttempt({ project: 2, invalidated: false }),
    DB::decideWrapUpResolve(onProject2(cQueueB), 1, WOk, false).rec.effects
      == ["Complete"],
    // Success under a MOVED branch is drawable and honestly attributed:
    // the move makes failure POSSIBLE, never certain — and its clean
    // landing is the GATED promotion (R3).
    DB::decideWrapUpResolve(onProject2(cGateB), 1, WOk, true).rec.landing
      == WOAttempt({ project: 2, invalidated: true }),
    DB::decideWrapUpResolve(onProject2(cGateB), 1, WOk, true).rec.effects
      == ["Complete"],
    // Failure: the wrap-up rework carries the project AND the cause.
    DB::decideWrapUpResolve(onProject2(cGateB), 1, WFailed, true).rec.label
      == "rework-started wrapup_failure",
    DB::decideWrapUpResolve(onProject2(cGateB), 1, WFailed, true).rec.landing
      == WOAttempt({ project: 2, invalidated: true }),
    // Both landing walls carry it too — the attempt that PARKED the
    // ticket is attributable like the one that reworked it.
    DB::decideWrapUpResolve(onProject2(cGateWall), 1, WFailed, true).rec.label
      == "ticket-escalated wrapup_budget_exhausted",
    DB::decideWrapUpResolve(onProject2(cGateWall), 1, WFailed, true).rec.landing
      == WOAttempt({ project: 2, invalidated: true }),
    DB::decideWrapUpResolve(onProject2(cGateGasWall), 1, WFailed, true).rec.landing
      == WOAttempt({ project: 2, invalidated: true }),
    // DeadlineOnly's landing gas wall attributes the same way.
    DD::decideWrapUpResolve(cGateDWall, 1, WFailed, true).rec.landing
      == WOAttempt({ project: 1, invalidated: true })
  })

  /// Attribution appears at the landing boundary and NOWHERE else: every
  /// non-landing decision carries WONone — most pointedly the eval-side
  /// "ticket-escalated gas_exhausted" (the SAME label string as the
  /// landing gas wall: the attribution field, not the label, marks the
  /// boundary), eval-passed (which only ENQUEUES the landing — the
  /// attempt resolves later, under a choice not yet made), and the
  /// absorbed complete-duplicate (no attempt resolves, nothing is emitted).
  run nonLandingStepsCarryNoAttributionTest = assert(and {
    dArr1.rec.landing == WONone,
    dRelease.rec.landing == WONone,
    dDispatch.rec.landing == WONone,
    dWork1.rec.landing == WONone,
    dWorkReduce.rec.landing == WONone,
    dAdvance.rec.landing == WONone,
    dEvalReduce.rec.landing == WONone,
    dCascade.rec.landing == WONone,
    dWorkFail.rec.landing == WONone,
    dEvalGasWall.rec.landing == WONone,
    // The gate OPEN resolves no attempt: the moved
    // choice it encoded surfaces on the RESOLUTION's attribution.
    dGateOpen7.rec.landing == WONone,
    DB::decideCompleteDuplicate(c8, 1).rec.landing == WONone
  })

  /// PROJECT-BLINDNESS, machine-checked (the measure.qnt multi-project header
  /// note's derivation pinned): tickets identical but for `project` have
  /// EQUAL ticketMeasure — phase by phase across the part-spent revoke
  /// fixtures, a parked ticket, and under BOTH gate pricings. The
  /// account radices derive from machine-wide consts (GAS, WRAPUP_PRICING,
  /// REWORK_POLICY — none per-project), so budgets are project-blind by type;
  /// this pins the measure function itself.
  /// ARTIFACT-BLINDNESS (design 002), the same derivation as project: no digit,
  /// weight or account radix reads the mark, so tickets identical but for it
  /// have EQUAL ticketMeasure. Pinned rather than argued, because a measure
  /// that quietly read the artifact would make the descent table wrong in a
  /// way only a mutation would show.
  run measureArtifactBlindTest = assert(and {
    ticketMeasure(bB, jPend) == ticketMeasure(bB, { ...jPend, artifact: ASome(3) }),
    ticketMeasure(bB, jWork) == ticketMeasure(bB, { ...jWork, artifact: ASome(9) }),
    ticketMeasure(bB, jEval) == ticketMeasure(bB, { ...jEval, artifact: ASome(1) }),
    ticketMeasure(bB, jLand) == ticketMeasure(bB, { ...jLand, artifact: ASome(4) }),
    ticketMeasure(bD, jWork) == ticketMeasure(bD, { ...jWork, artifact: ASome(2) }),
    ticketMeasure(bB, { ...jEval, artifact: ASome(1) })
      == ticketMeasure(bB, { ...jEval, artifact: ASome(99) })
  })

  /// WORK-PASSED STAMPS AN ARTIFACT, and a rework SUPERSEDES it. The second
  /// half is what makes the mark an identity rather than a flag: two cycles
  /// of the same ticket produced different things and the model can say so.
  run artifactStampedAndSupersededTest = assert(and {
    dDispatch.post.tickets.get(1).artifact == ANone,
    dWorkReduce.post.tickets.get(1).artifact != ANone,
    // The rework fixture walks a second cycle; its product differs from the
    // first, which a stamp-once mutant would fail.
    dBackToEval.post.tickets.get(1).artifact != ANone,
    dBackToEval.post.tickets.get(1).artifact != dWorkReduce.post.tickets.get(1).artifact
  })

  run measureProjectBlindTest = assert(and {
    ticketMeasure(bB, jDraft) == ticketMeasure(bB, { ...jDraft, project: 2 }),
    ticketMeasure(bB, jPend) == ticketMeasure(bB, { ...jPend, project: 2 }),
    ticketMeasure(bB, jWork) == ticketMeasure(bB, { ...jWork, project: 2 }),
    ticketMeasure(bB, jEval) == ticketMeasure(bB, { ...jEval, project: 2 }),
    ticketMeasure(bB, jLand) == ticketMeasure(bB, { ...jLand, project: 2 }),
    ticketMeasure(bB, jGated) == ticketMeasure(bB, { ...jGated, project: 2 }),
    ticketMeasure(bB, escLanding) == ticketMeasure(bB, { ...escLanding, project: 2 }),
    ticketMeasure(bD, jWork) == ticketMeasure(bD, { ...jWork, project: 2 })
  })

  /// THE DEP GATE IS LOCATION-BLIND (the lean reading of "one
  /// orchestrator, many targets": the DAG stays orchestrator-level and
  /// dependencies may cross projects): a project-2 ticket behind a project-1 dep
  /// is Blocked exactly while the dep is not Done — and Ready the moment
  /// it is, the projects never consulted (depsDoneIn reads phase alone).
  /// The machine-trace version — the landing in project 1 UNBLOCKING the
  /// project-2 dependent — is the crossProjectDepDeterministicTest witness.
  pure val cXDepPre: Core = { tickets: Map(
    1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PWrapUp },
    2 -> { ...DB::freshTicket(Set(1), progU2, 2, WExclusive(2)), phase: PPending }
  ) }
  pure val cXDepDone: Core = { tickets: Map(
    1 -> { ...DB::freshTicket(Set(), progU2, 1, WExclusive(1)), phase: PDone, completions: 1 },
    2 -> { ...DB::freshTicket(Set(1), progU2, 2, WExclusive(2)), phase: PPending }
  ) }

  run crossProjectDepGateLocationBlindTest = assert(and {
    DB::isBlockedIn(cXDepPre, 2),
    not(DB::isReadyIn(cXDepPre, 2)),
    DB::isReadyIn(cXDepDone, 2),
    not(DB::isBlockedIn(cXDepDone, 2))
  })

  /// Arrival carries the authored target project — the third authored field
  /// riding the same event as deps and the program, immutable after.
  run arrivalCarriesProjectTest = assert(and {
    cA1.tickets.get(1).project == 1,
    DB::decideArrive(cEmpty, Set(), DB::defaultProgram, 2, WExclusive(2)).post.tickets.get(1).project == 2,
    DB::decideArrive(cEmpty, Set(), DB::defaultProgram, 2, WExclusive(2)).rec.label == "ticket-arrived"
  })

  /// N_PROJECTS = 1 degeneration (adopted from the multi-project review's probe):
  /// the collapsed universe and the intact draw rule are the whole claim —
  /// everything else is project-blind by the measure theorem.
  /// NOTE: the two set equalities below are the SECOND guard for the
  /// draw sets (wrapUpOutcomesDrawRuleTest's note has the argument — the
  /// sets are checkable only by pinning their contents; everything
  /// downstream draws from them).
  run oneProjectDegenerationTest = assert(and {
    DO::projects == Set(1),
    DO::wrapUpOutcomes(false) == Set(WOk),
    DO::wrapUpOutcomes(true) == Set(WOk, WFailed)
  })

  /// EVERY HAND-BUILT FIXTURE IN THIS FILE IS A SHAPE THE MACHINE COULD HAVE
  /// REACHED. idsAccounted is a machine invariant, so the randomized runs and
  /// the witness suites check it after every step the machine takes — and on
  /// nothing this file writes by hand. That gap is the one the fixtures fell
  /// into: some of them carried a live task set or a record while leaving
  /// freshTicket's spawned at 0, which is not a state any trace reaches, and
  /// work-passed's ASome(retired.spawned) stamp read the short counter. The
  /// deciders below cannot repair it — nothing recomputes `spawned` from the
  /// record — so the equality has to be asserted where the state is written.
  /// This is that assertion, and the reason a new fixture cannot
  /// repeat the mistake quietly.
  run handBuiltFixturesAccountedTest = assert(and {
    accounted(cWorkFail), accounted(cEvalFail),
    accounted(cReworkWall), accounted(cEvalGasWall),
    accounted(cStagedWork), accounted(cStagedNoBudget),
    accounted(cMixedAny), accounted(cMixedUna),
    accounted(cFlatWork), accounted(cFailAny),
    accounted(cGateB), accounted(cGateWall), accounted(cGateGasWall),
    accounted(cGateD), accounted(cGateDWall),
    accounted(cFresh), accounted(cParkNoGas), accounted(cQueueB),
    accounted(cChain), accounted(cGateOcc),
    accounted(cXDepPre), accounted(cXDepDone),
    accountedTicket(escLanding), accountedTicket(escWorking),
    accountedTicket(escEval),
    accountedTicket(jDraft), accountedTicket(jPend), accountedTicket(jWork),
    accountedTicket(jEval), accountedTicket(jLand), accountedTicket(jGated),
    accountedTicket(jEsc), accountedTicket(jParkPre), accountedTicket(jParkDep)
  })
}
