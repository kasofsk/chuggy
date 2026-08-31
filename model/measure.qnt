/// THE MEASURE COMES FIRST — standing rule 1. This module is written before
/// the machine and reworked before it: every transition domain.qnt takes
/// either strictly descends `ticketMeasure` or belongs to one of the named
/// non-descending sets at the bottom of this header. A change to the machine
/// starts here, not afterwards and not in the same breath.
///
/// The record types live here too, because the measure is a pure function of
/// one ticket's record — so the record's shape is part of the measure's
/// definition rather than the machine's.
///
/// WHAT THE MEASURE READS, most significant digit first:
///   1. gasLeft      the required account, charged on every entry to Working
///                   and on metered operator retries. Never refunded.
///   2. finalizationLeft   the wrap-up account, non-zero only under Budgeted
///                   pricing.
///   3. reworkLeft   the eval-rework account, granted by the rework policy
///                   and refilled to that grant — never above it — by the
///                   operator's resume at its own wall, against a gas unit.
///   4. micro        within-cycle progress: phase rank, then stagesLeft,
///                   then the outstanding-task count.
///
/// It is LEXICOGRAPHIC, flattened to one nonnegative integer by radix
/// weighting — every digit stays strictly below its radix, so the integer
/// order IS the lexicographic order. The weights are derived rather than
/// chosen, each next to its derivation, so no numeral appears twice and a
/// change to the phase ladder propagates instead of drifting.
///
/// WHAT IT DELIBERATELY DOES NOT READ. The project, the wrap-up kind's resource
/// and the artifact are vocabulary, not digits — two tickets differing only
/// in those have equal measure, pinned by test. The retained task record is
/// append-only provenance, so reading it could only ever climb. And there is
/// no attempt digit and no per-task account: the fabric relaunches a failed
/// task, so this machine prices CYCLES, not relaunches.
///
/// THE DIGIT-ORDER ARGUMENT (why stagesLeft sits BELOW phase rank and
/// ABOVE — not beside — the outstanding-task count):
///   - BELOW rank: entering Evaluating (work-passed, rank 4->3) makes the
///     stage digit APPEAR at its maximum (stagesLeft 0 -> L <= maxStages)
///     while the stage-0 fan-out spawns (outstanding 0 -> <= nTasks). The one
///     rank step must dominate both at once, which forces
///     rankWeight > maxStages*stageWeight + nTasks — the rankWeight
///     definition below is exactly that bound plus one. Every EXIT from
///     Evaluating (eval-passed, rework, walls, revoke) drops rank or an
///     account, so the stage digit vanishing on exit never needs its own
///     descent argument.
///   - ABOVE the count: advancing a stage (eval-stage-passed) retires a
///     fully-resolved task set (outstanding 0) and spawns the next stage's
///     fan-out — the outstanding count JUMPS from 0 to <= nTasks in the same
///     step. stagesLeft falls by exactly 1, so one stage step must outweigh
///     the whole jump: stageWeight = radix(nTasks). Were the stage digit
///     merely BESIDE the count (equal weight), stage advance over any
///     fan-out > 1 would CLIMB the measure and the machine's cleanest
///     progress step would need an exemption — the wrong shape for the one
///     transition  exists to add.
///
/// There is deliberately NO attempt digit and no per-attempt account:
/// same-cycle retry machinery is a standing non-goal — no retry machinery
/// below the cycle — and container relaunches live in the trusted,
/// unmodeled relaunch-limit fabric axiom — the
/// model prices CYCLES, not container relaunches. Per-task attempt counters
/// and per-task retry budgets are exactly the below-cycle machinery that
/// non-goal excludes, so a task carries neither.
///
/// The retained task RECORD is NOT a measure
/// input: it is append-only provenance, so it could only ever climb — the
/// measure reads phase, live tasks, program length, and the accounts. The
/// program is immutable after release and enters only through stagesLeft.
///
/// WEIGHTS, re-derived (the magic-number audit: every numeral
/// here is a named value or derived from one, with its derivation adjacent;
/// no bare rank, multiplier, or radix literal appears twice):
///   radix(d) = d + 1
///     — a digit bounded by d takes d+1 distinct values, so one unit of the
///       next weight up must be worth exactly that many. Every "+ 1" in the
///       weight chain is this one derivation, named once.
///   stageWeight = radix(nTasks)
///     — one stage step dominates any outstanding count (<= nTasks).
///   rankWeight  = radix(maxStages) * stageWeight
///     — one rank step dominates the full stage digit plus any count:
///       stagesLeft <= maxStages (programsWellFormed caps authored programs
///       at MAX_STAGES), so
///       stagesLeft*stageWeight + outstandingCount
///         <= maxStages*stageWeight + nTasks < radix(maxStages)*stageWeight.
///   microBound  = radix(rankCeiling) * rankWeight
///     — micro = rank*rankWeight + stagesLeft*stageWeight + outstandingCount
///            <= rankCeiling*rankWeight + (rankWeight - 1)
///             < radix(rankCeiling)*rankWeight.
///       Written as radix(rankCeiling) so the multiplier re-derives from
///       the ladder and can never silently drift from it: every change to
///       the rung set moves the ceiling, and the weight follows.
/// The domination chain above micro is unchanged in shape: micro <
/// microBound, so one unit of reworkLeft outweighs any within-cycle climb
/// (radix microBound), one unit of finalizationLeft outweighs any reworkLeft refill
/// (radix reworkBudget), and one unit of gas outweighs everything below it
/// (radix finalizationBudget). Every digit stays strictly below its radix, so the
/// flattened integer order IS the lexicographic order.
///
/// DESCENT TABLE — which transitions descend, and by which account.
/// (Deltas verified per-step by the machine's `stepDescends` invariant and
/// by tests/chuggy_test.qnt; labels are domain.qnt's StepRecord labels.
/// RetryFree pipeline resumes form the explicit CHURN set below.)
///
///   label                               descends via
///   ----------------------------------- ---------------------------------
///   ticket-released                        rank 6->5 (authoring: release —
///                                       Pending straight into the pipeline;
///                                       Ready/Blocked stay derived)
///   ticket-revoked (from any rank>0 phase) rank {6,5,4,3,2,1}->0, stage
///                                       digit and live tasks cleared
///                                       (retired to the record, which the
///                                       measure does not read); every
///                                       dependent the atomic cascade parks
///                                       adds its own rank {6,5}->0 drop
///                                       (see the AUTHORING set for the
///                                       desk-only flat case)
///   dispatch                            gas -1 (micro also falls:
///                                       rank 5->4 dominates the spawn:
///                                       −rankWeight + nTasks < 0)
///   task-done (an outstanding task resolves) task count -1
///   work-passed                         rank 4->3 (dominates the stage
///                                       digit appearing at L <= maxStages
///                                       AND the stage-0 fan-out spawn —
///                                       the rankWeight bound above.
///                                       A scoped re-entry
///                                       spawns r <= fanout OUTSTANDING tasks
///                                       — carried tasks are born settled
///                                       — so the climb is r <= nTasks,
///                                       within the same bound: fewer
///                                       spawns only tighten it)
///   eval-stage-passed (          stagesLeft -1 (dominates the next
///     a non-final stage passes;           stage's fan-out spawn:
///     Evaluating -> Evaluating,           -stageWeight + fanout <= -1;
///                                         spawns r <= fanout outstanding, so
///                                         -stageWeight + r <= -1 a
///                                         fortiori)
///   ticket-escalated work_failed           rank 4->0 (cycle-level resolution:
///                                       the fabric already retried the
///                                       container below the cycle grain,
///                                       which this model trusts rather
///                                       than models)
///   eval-passed (the FINAL stage        rank 5->4 AND stagesLeft 1->0 (the
///     passes)                             ticket enters Finalizing —
///                                         Finalizing is the queued state)
///   wrapup-preparation-started          rank 4->3; the ticket takes the
///                                         project-local repository slot
///   wrapup-awaiting-approval            rank 3->2
///   wrapup-commit-permitted             rank {3,2}->1
///   rework-started eval_failure         gas -1 AND reworkLeft -1 (the
///     (a stage FAILS: the short-circuit   micro reset — rank 3->4, stage
///     — later stages never spawn)         digit ->0, work respawn — is
///                                         dominated by the account drop)
///   ticket-escalated rework_budget_exhausted rank 3->0 (and stage digit ->0)
///   ticket-escalated gas_exhausted         rank {6,5,4,3,2,1}->0
///   ticket-done                            rank {5,1}->0 (5: a NoFinalizer
///                                       ticket, whose passing evaluation IS
///                                       its completion — it enters neither
///                                       wrap-up phase; 1: a conclusive
///                                       permitted commit)
///   rework-started wrapup_*             gas -1 (AND finalizationLeft -1 when
///                                       Budgeted); failure leaves preparing,
///                                       approval, or committing (rank
///                                       {3,2,1}->6 climb + respawn, dominated
///                                       by the gas drop)
///   ticket-escalated wrapup_budget_exhausted rank {3,2,1}->0 (Budgeted only)
///   ticket-escalated execution_blocked rank {6,5}->0
///   ticket-resumed, whenever it charges gas -1 (dominates the rank climb
///     gas (ResumeWorking always — standing     back to 4/3/2 + respawn — for the
///     rule 2; ResumeEvaluating/ResumeFinalizing        ResumeEvaluating resume that includes
///     under RetryCharged)                 the stage digit reappearing at L:
///                                         the whole climb is < microBound,
///                                         which gas outweighs; ResumeFinalizing
///                                         re-ENQUEUES — resumes to
///                                         Finalizing, never into the gate)
///   ticket-resumed, ResumeReworking     gas -1 ALWAYS (a Working entry —
///     (the rework wall's resume:          standing rule 2 — under BOTH
///      refill the eval-rework account     pricings, so no CHURN arm covers
///      to the authored budget B and       it and it must strictly descend.
///      respawn work)                      With Rf = radix(finalizationBudget),
///                                         Rr = radix(reworkBudget) and
///                                         M = microBound, the wall's
///                                         pre-state has rework = 0 (the wall
///                                         fires at reworkLeft == 0) and
///                                         micro = 0 (settled rank, no live
///                                         tasks, no stage digit), so
///                                           d = -Rf*Rr*M + B*M + micro'
///                                            <= -Rf*Rr*M + (Rr-1)*M + (M-1)
///                                             = -Rf*Rr*M + Rr*M - 1 < 0,
///                                         since B <= Rr - 1 —
///                                         reworkPolicyChoices caps an
///                                         authored budget at the instance's
///                                         — and Rf >= 1. It is the
///                                         rework-started eval_failure row
///                                         with the account delta's sign
///                                         reversed, dominated by the same
///                                         gas unit. B >= 1 here: the wall
///                                         stamps this flavor only where the
///                                         author bought a budget, and a
///                                         zero-budget park is revoke-only,
///                                         so it contributes no step to
///                                         price)
///
/// NAMED NON-DESCENDING SETS — everything else, isolated by name:
///
///   STUTTER (state-identical; at-least-once delivery noise — the fabric
///   axioms do not promise exactly-once, so duplicates are
///   tolerated idempotently and change nothing):
///     task-done-duplicate (= 0), complete-duplicate (= 0), settled (= 0).
///   the model task-done-duplicate's REACH, not its effect: task ids are
///   unique across the ticket's whole history (sequential within the
///   ticket), so a stale completion from an EARLIER
///   stage or incarnation no-ops BY IDENTITY — its id is already retired
///   into the record. Finitely many by fabric assumption; they cannot
///   cycle through distinct states, so termination is modulo this
///   stuttering.
///
///   CHURN (operator/environment re-entry; measure may CLIMB; every path
///   back into active work is still metered at the Working boundary —
///   standing rule 2, with operator paths governed by the §2 op-retry
///   configurability row):
///     ticket-resumed into Evaluating/Finalizer under RetryFree
///       (+<= rankEvaluating*rankWeight + maxStages*stageWeight + nTasks —
///        the Evaluating resume respawns the LOWEST stage's fan-out with
///        the full stage digit — a fresh eval fan-out)
///   ResumeWorking and ResumeReworking are NOT members under either
///   pricing: they enter Working, which standing rule 2 meters
///   unconditionally, so the refilled rework account is bought and the step
///   descends (its row above).
///   Under the DEFAULT metering (RetryCharged) the churn set is empty.
///   RetryFree deliberately reproduces a known operator-churn livelock as a
///   configuration, so the model can generate escalation traces under both
///   prices — the mc_chuggy_retryfree instance plus the model gate's
///   witness layer (the deterministic free-climb machine trace in
///   tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
///   keep that exemption exercised, not dead.
///
///   AUTHORING (author churn above the
///   released pipeline; each member is bounded by name):
///     ticket-released      (+ the fresh Pending's whole ticketMeasure: a ticket enters
///                       never reused, and capped by the N_TICKETS release
///                       bound — at most N_TICKETS arrivals ever. The release
///                       also fixes the ticket's eval PROGRAM, but a Pending's
///                       stage digit is 0, so the climb bound is unchanged.)
///                       Release is this set's ONLY climbing member: an
///                       author's edit loop is not in the phase table at
///                       all, because content edits on a Pending are below
///                       its grain.)
///     ticket-revoked, desk-only (= 0: revoking an already-parked ticket —
///                       Escalated is rank 0, so nothing falls when no
///                       dependent gets parked by the cascade AND no member
///                       gets released by the dissolution (either makes the
///                       step strictly descend). Bounded: Revoked is
///                       absorbing, so each such step permanently settles
///                       one ticket — at most N_TICKETS ever.)
///
/// PER-TICKET WORK-BOUNDEDNESS (the refinement layer gate, extended by ;
/// changed digits changed the authoring boundary, the
/// grouping removal deleted the BATCHING set — none changed the argument.
/// RETITLED 2026-08-14 by davemo88, from "PER-TICKET LIVENESS, SKETCHED":
/// the argument is this one, and an earlier title claimed a
/// conclusion it never reached. See THE FAIRNESS GAP below.)
///
/// THE THEOREM: ticketMeasure is a nonnegative integer, and every
/// non-STUTTER non-CHURN non-AUTHORING step strictly decreases the sum of
/// ticketMeasure over all tickets. Each CHURN step requires an operator
/// acting on a ticket with an open desk task (domain.qnt `coveredSet`),
/// and each AUTHORING step is bounded by the release cap. So, given the
/// trusted fabric axioms (spawned tasks eventually resolve, under a
/// maximum runtime and a relaunch limit) and under default metering, any
/// run with finitely many stutter and churn events performs FINITELY MANY
/// ACTING STEPS PER TICKET: no ticket can be dispatched, reworked, evicted
/// and resumed forever. That is exactly the class of defect the accounts
/// exist to kill: a gate-loop livelock and a free-resume churn are both
/// perpetual WORK.
///
/// THE FAIRNESS GAP — what this does NOT say, stated because the older
/// wording did say it: descent bounds how many acting steps CAN happen; it
/// does not force an enabled step to be TAKEN, so it does not put any
/// particular ticket into a terminal. Closing that needs weak fairness in
/// its per-ticket form — "a ticket that stays continuously Ready is
/// eventually dispatched" — and chuggy does not have it: "no queue, no
/// fairness" is a standing non-goal (domain.qnt decideDispatch).
/// Note the ordinary action-level reading would not suffice either: the
/// `dispatch` action's nondet pick ranges over readyTickets, so a run in
/// which the agentic selector forever prefers other tickets takes
/// `dispatch` infinitely often and still starves one. Accepted 2026-08-14
/// (davemo88): "if there is always more pressing work, that's a real
/// possibility." A ticket that stops being chosen sits FLAT — it does not
/// churn — which is the whole of what is owed.
///
/// So: CHUGGY BOUNDS WORK, NOT WAITING. Waiting on an author
/// to release a Pending, on the selector to pick, and on the gate to free
/// its slot (proposed R6) are all unbounded BY DECISION. The unconditional
/// system-quiescence theorem is a strictly stronger claim and is NOT
/// made here.
module chuggy_measure {

  // === Vocabulary ==========================================================
  // Sum-type constructors share one namespace per module, hence the
  // prefixes (P/T/TK/TS/V/R/Rs/C/RW/W/WO/A). The two-branch parameter types
  // keep bare descriptive constructor names — Budgeted/DeadlineOnly
  // (FinalizationPricing) and RetryCharged/RetryFree (RetryPricing) — documented
  // here because they live in the same module-wide constructor namespace.
  // TK (TaskKind), TS (TaskState — the explicit task lifecycle), RW
  // (ReworkPolicy), W (FinalizationOutcome and Finalizer, which share it), WO

  /// STORED ticket phases, deliberately few (standing rule 3, derive don't
  /// store). Blocked and Ready are PREDICATES over deps + record in
  /// domain.qnt, not phases — a ticket that has not started is Pending, and
  /// the waiting-room split is derived. Pending must be stored (phase is
  /// total and "never started" is not expressible as a predicate over the
  /// other fields without overloading them). Working/Evaluating carry the
  /// parallel task set; Finalizing is its own phase because its outcome is the
  /// exclusivity boundary; Done is absorbing; Escalated is the human desk.
  ///
  /// Pending is the ONLY authoring phase: release goes Pending -> Pending
  /// directly, with Ready and Blocked derived.
  ///
  /// Escalated is THE parked phase — one parked-with-an-open-human-task
  /// phase, with the `reason` field carrying the wall classification.
  ///
  /// Revoked is the other settled terminal: absorbing, runs nothing, never
  /// completes, and opens NO human task, because revocation is the author's
  /// settled choice (see hasOpenHumanTask).
  ///
  /// An eval stage advance gets NO phase — it is an Evaluating ->
  /// Evaluating edge, because within-phase progress lives in the stage
  /// digit rather than in new phases.
  ///
  /// Finalizing precedes the accepted-promotion boundary. PublishingHandoff
  /// and HandoffBlocked make the irreversible side of that boundary explicit;
  /// queueing, approval, permits, and immutable external identities remain
  /// operational protocol rather than Core state.
  type Phase =
    Pending | Working | Evaluating | Finalizing | PublishingHandoff |
    HandoffBlocked | Done | Abandoned | Escalated | Revoked

  /// What a task IS for (task records are first-class — they carry the
  /// anatomy):
  ///   Work     — a task of the Work phase's single task set (Work stays
  ///                ONE task-set phase per kasofsk's anatomy note; the
  ///                extracted vocabulary agrees
  ///                task creation: "Job enters Work (new cycle): one work
  ///                task", i.e. Work is not staged).
  ///   Evaluation(s)  — a task of eval stage s (0-based index into the ticket's
  ///                authored program
  ///                `stage:`, "default 0; non-negative; evaluators run in
  ///                ascending stage order; within a stage they fan out in
  ///                parallel"). The kind mark is what makes the CURRENT
  ///                stage derivable from the live task set (evalStage
  ///                below) instead of stored — standing rule 3.
  type TaskKind = Work | Evaluation(int)

  /// A settled task's outcome — RESOLVED verdicts only; an outstanding task
  /// cannot carry one (see TaskState). Failed
  /// covers BOTH a failed verdict and evaluator-infrastructure death: "the
  /// job pays" for evaluator crashes — one account, no new machinery.
  /// Cancelled is the retirement
  /// mark for a task still OUTSTANDING when its ticket is revoked mid-flight —
  /// revoke force-closes every pending task with a synthetic resolution
  /// recording that the revoke, not a verdict, retired it.
  /// Only revoke produces it: every other retirement happens at a reduce,
  /// when the set is fully resolved.
  type TaskOutcome = Passed | Failed | Cancelled

  /// THE EXPLICIT TASK LIFECYCLE (one small sum instead of implicit
  /// set-membership). A task is PUBLISHED to the fabric as outstanding and
  /// RESOLVES exactly once. Assignment, launch, execution and their retries
  /// are the trusted fabric's grain, not states of this machine. Resolved
  /// carries the outcome, so an outstanding task CANNOT carry one and a
  /// resolved task MUST. First write wins (resolveTask); resolution is final
  /// (recordMonotone makes that a theorem).

  type TaskState = Outstanding | Resolved(TaskOutcome)

  /// A first-class task record: identity + kind +
  /// lifecycle state. `id` is SEQUENTIAL WITHIN THE TICKET, 1-indexed, across
  /// the ticket's entire history
  /// sequential within job, 1-indexed`) — never reused across stages,
  /// cycles, or operator retries. That uniqueness is load-bearing: it is
  /// what lets a stale completion from an earlier stage/incarnation be
  /// absorbed BY IDENTITY (see the STUTTER note in the header).
  /// Deliberately absent: `attempt` and the
  /// per-task retry budgets (below-cycle machinery, a standing non-goal),
  /// `cycle` (derivable from the record's kind sequence — work groups
  /// delimit cycles), timestamps/results (implementation accounting, not
  /// machine state).

  type Task = { id: int, kind: TaskKind, state: TaskState }

  /// A task-completion event's verdict (the event, as distinct from the
  /// stored resolution — duplicates of the event must be tolerated).
  type Verdict = Pass | Fail

  /// Verdict combinator over a resolved task set. Not a
  /// machine-wide parameter — each STAGE of a ticket's authored program
  /// carries its own, because eval is data. The default, unanimous
  /// pass, is the default program's combinator
  /// (domain.qnt defaultProgram). UnanimousPass is the
  /// required-evaluator rule — every required evaluator in the stage
  /// passed — at chuggy's grain. The required/advisory split is BELOW that
  /// grain: an advisory evaluator is one the stage's combinator ignores.
  type Combinator = UnanimousPass | AnyPass

  /// One stage of a ticket's eval program: a task-set with its own
  /// fan-out width and its own verdict combinator: one task per evaluator
  /// in the lowest stage, fanned out in parallel — a
  /// stage's width is its evaluator count, its combinator is the
  /// required-pass rule.
  type Stage = { fanout: int, combinator: Combinator }

  /// Gate-rework pricing — a model parameter, not a constant:
  /// the model generates escalation traces under both branches and the
  /// choice is made on evidence.
  type FinalizationPricing = Budgeted(int) | DeadlineOnly

  /// Eval-rework pricing ("rework budget should be removed from
  /// core job entity and into impl / middleware") — the FinalizationPricing
  /// pattern applied to the rework bound: the machine consults an abstract
  /// policy, and BudgetedRework(n) grants a budget of n cycles. Deliberately the
  /// ONLY branch for now: the triage row keeps the bound in the model
  /// because removing it entirely would make per-ticket liveness conditional
  /// on middleware behavior — an unbounded (or gas-only) branch is exactly
  /// the removal that was rejected. The rework wall's refill does not
  /// reopen it: a refill is capped at this grant and bought with a gas
  /// unit, so gas still bounds how many rework cycles a ticket ever gets —
  /// and BudgetedRework(0) buys none, so that wall offers it no resume at
  /// all (domain.qnt reworkWallResume).
  /// If evidence ever argues for another
  /// pricing, it lands as a new constructor here, instantiated alongside
  /// (the FinalizationPricing method). The per-ticket ACCOUNT the policy meters
  /// (Ticket.reworkLeft) is policy state the middleware owns in the
  /// implementation — see the field's note.
  type ReworkPolicy = BudgetedRework(int)

  /// Operator-retry metering — configurable per deployment, default
  /// charge. RetryFree reproduces a known livelock by configuration.
  type RetryPricing = RetryCharged | RetryFree

  /// Where an operator Retry resumes a parked ticket. NoResume when not parked —
  /// or parked with NO modeled resume: revoke is the only modeled exit from
  /// the dependency_revoked wall and from the rework wall on a ticket
  /// authored no budget (domain.qnt modeledResumeExists), and stamping a
  /// resume point on either would be a lie to the desk.
  ///
  /// ResumeReworking is the rework wall's, and the one flavor that moves an
  /// account: it re-enters Working with reworkLeft refilled to the ticket's
  /// authored budget. That wall is reached by a VERDICT, and a verdict has
  /// no re-judge to offer — the fabric already relaunched the container
  /// below the cycle grain — so the only honest continuation is a new
  /// artifact, which is a work cycle.
  type Resume =
    NoResume | ResumeWorking | ResumeReworking | ResumeEvaluating |
    ResumeFinalizing | ResumePublishingHandoff

  /// Why a ticket sits on the human desk. The termination requirement
  /// names no individual wall; the reason is
  /// what distinguishes the parks: WorkFailed / ReworkBudgetExhausted /
  /// FinalizationBudgetExhausted (Budgeted pricing only) / GasExhausted are
  /// the pipeline walls. DependencyRevoked is the cascade wall and is not
  /// retryable; its only exit is revoke. GasExhausted is the rename of the deadline wall
  /// (`gas_exhausted` on the trace); WorkFailed is the CYCLE-level work
  /// wall (there is no retries wall: retrying a failed container below the
  /// cycle grain is the fabric's job, trusted here rather than modeled).
  type Reason =
    NoReason | WorkFailed | ReworkBudgetExhausted |
    FinalizationBudgetExhausted | GasExhausted | DependencyRevoked |
    ExecutionPolicyDenied | TicketConfigIncompatible |
    ExecutionProfileUnavailable | RuntimeVersionUnsupported |
    RequiredCapabilityUnavailable

  /// How a finalization attempt resolves. ONE success, deliberately: an earlier
  /// model named two, because a merge promotes differently depending on
  /// whether it went through the gate — and *which* mechanism a merge uses
  /// is a property of the merge adapter, not of the machine. The domain
  /// knows only that the step succeeded or failed.
  ///   - WOk      the step committed the artifact.
  ///   - WFailed  it did not, and is drawable only when the environment
  ///              invalidated the artifact (domain.qnt finalizerOutcomes).
  type FinalizationOutcome =
    FinalizationSucceeded | FinalizationFailed | PromotionAccepted |
    HandoffPublicationUnproven

  /// HOW A TICKET FINISHES (design 002), authored data on the ticket exactly
  /// like the eval program — eval-is-data applied one seam later.
  ///
  ///   NoFinalizer            the effect was external and already happened during
  ///                    work; evaluation passing completes the ticket, and
  ///                    it enters neither wrap-up phase. A deploy, a report.
  ///   ManagedFinalizer    a constrained, platform-owned finalizer must
  ///                    conclusively succeed or fail after evaluation.
  ///
  /// Mutual exclusion, queue order, approval, and implementation belong to
  /// durable operational records. Core retains only this requirement.
  ///
  /// NOT a measure input; only the PHASE has a rank.
  type Finalizer = NoFinalizer | ManagedFinalizer

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
  ///
  /// NOT a measure input, like `project` (measureArtifactBlindTest).
  type ArtifactMark = NoArtifact | ProducedArtifact(int)

  /// One ticket's record. The measure below is a pure function of this.
  type Ticket = {
    phase: Phase,
    // Upstream dependency ticket ids (acyclic by construction in domain.qnt).
    // Core is project-scoped, so every edge is project-local by construction.
    deps: Set[int],
    // How this ticket finishes (design 002): authored, immutable after
    // release, and what decides whether it takes a lease or completes at
    // eval-pass.
    finalizer: Finalizer,
    // The artifact this ticket has produced, if it has passed work (design
    // 002). Set at work-passed and superseded by each rework's product.
    artifact: ArtifactMark,
    // Release-time semantic policy. Later decisions read these immutable
    // fields, never the importing module's ambient configuration.
    workFanout: int,
    reworkPolicy: ReworkPolicy,
    finalizationPricing: FinalizationPricing,
    resumePricing: RetryPricing,
    // THE EVAL PROGRAM — an ordered list of stages, AUTHORED: it
    // is released with the Pending and is immutable after release, like
    // deps. This is "eval is data, not machinery" made
    // literal: the program is data on the ticket record; domain.qnt's
    // decideEvalStageReduce is the interpreter. Well-formedness (non-empty,
    // length <= MAX_STAGES, every fanout in 1..N_TASKS) is an RELEASE
    // validity condition — domain.qnt programsWellFormed.
    program: List[Stage],
    // The LIVE task set of the current Working phase or Evaluating stage;
    // empty in every other phase. Task ids are sequential within the ticket
    // across its whole history (nextTaskId below).
    tasks: Set[Task],
    // THE RETAINED TASK RECORD — the ticket's chronological task log
    // — tasks form a chronological log, never referencing each other, and
    // there is no task graph. Append-only: a task moves
    // here, resolution settled, when its set retires (reduce, escalation,
    // or revoke — retireLive below), and once here it NEVER changes
    // (domain.qnt recordMonotone). This is "task records are first-class:
    // they carry the anatomy" — outcomes are retained history
    // the golden traces can carry as provenance, not overwritten scratch
    // state. Entry i has id firstTaskId + i (ids sequential, retirement in
    // id order). NOT a measure input (append-only: it could only climb).
    // GROWTH BOUND: under RetryCharged every spawn burst rides a charged
    // gas unit, so record length <= GAS * (nTasks + maxStages * nTasks);
    // under RetryFree it is unbounded across free-resume churn — the same
    // conditionality as the liveness sketch above.
    record: List[Task],
    // GHOST (accounting only — NOT a measure input, exactly like
    // record; ticketMeasure never reads it): how many tasks this ticket has EVER
    // spawned. Every spawn site bumps it by its fan-out (spawnOn below),
    // so the machine invariant `spawned == record.length + tasks.size`
    // (domain.qnt idsAccounted) makes history-unique sequential identity a
    // checked theorem rather than a test-pinned convention: a decider that
    // DROPPED a task set instead of retiring it would break the equality
    // in the very next state.
    spawned: int,
    // POLICY STATE: the eval-rework account REMAINING, granted
    // by ReworkPolicy (BudgetedRework(n) grants n; counts down at each eval
    // failure — the measure wants remaining, not spent — and is refilled to
    // the grant, never above it, by the rework wall's ResumeReworking).
    // In the IMPLEMENTATION this account
    // belongs to the middleware, not to the core ticket entity — the note's
    // demand — and it stays on the model's Ticket record for the same reason
    // the ghost fields do their tickets: the termination measure needs its
    // bounded digit (the model's concern), while ownership of the counter
    // is the implementation's (documented, like `completions`, rather than
    // modeled).
    reworkLeft: int,
    // Gate-rework budget remaining; identically 0 under DeadlineOnly.
    finalizationLeft: int,
    // GAS remaining — the REQUIRED account (the bound is a spend meter,
    // not a clock).
    gasLeft: int,
    // Operator-resume point (NoResume unless Escalated with a modeled
    // resume — the dependency_revoked wall has none; see Resume).
    resumeAt: Resume,
    // Desk reason (NoReason unless Escalated). Deliberately FIRST-CLASS
    // stored trace vocabulary, not derived from phase — and the
    // With one parked phase, the reason distinguishes the cascade wall
    // (DependencyRevoked, not retryable) from retryable pipeline walls.
    reason: Reason,
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
  /// Done. This is precisely why the revoke cascade needs its own
  /// coverage: a dependent stuck behind a Revoked dep gets no visibility
  /// through its dep, so the cascade parks it with a task of its OWN
  /// (DependencyRevoked; domain.qnt `cascadeSafety`).
  pure def hasOpenHumanTask(ticket: Ticket): bool =
    ticket.phase == Escalated or ticket.phase == HandoffBlocked

  /// The machine's observed state, as the pure deciders see it. A record
  /// (not a bare map) so the ticket-source shape stays open.  attached
  /// authoring here with no widening needed after all — tickets RELEASE by
  /// growing the map's sparse, never-reused id domain through the
  /// `freshTicket` seam, and no decider needed surgery. The shape that
  /// grew is the Ticket record (program, record, task kinds), not Core.
  type Core = { tickets: int -> Ticket }

  /// One observed ticket-phase transition, golden-trace shaped (standing rule
  /// 4: conformance from day one — the model emits, the implementation
  /// replays). from == to is a REAL row, not a degenerate one — the
  /// stage advance is Evaluating -> Evaluating.
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
  type Decision = { rec: StepRecord, post: Core }

  /// The bounds the measure is parameterized by — passed explicitly so this
  /// module needs no consts and the measure stays a pure function usable
  /// from tests with any bounds. the model maxStages (the stage digit's
  /// radix); it carries the rework POLICY, not a bare budget —
  /// the digit's radix is derived from it (reworkBudget below), same as
  /// gate pricing.
  type Bounds = {
    reworkPolicy: ReworkPolicy,
    nTasks: int,
    maxStages: int,
    finalizationPricing: FinalizationPricing
  }

  // === The measure =========================================================

  /// The gate account's size under a pricing: Budgeted(n) grants n,
  /// DeadlineOnly grants none (gas alone meters the gate loop — the
  /// documented-livelock shape, kept as the branch to be priced on
  /// evidence).
  pure def finalizationBudget(gp: FinalizationPricing): int =
    match gp {
      | Budgeted(n) => n
      | DeadlineOnly => 0
    }

  /// The rework account's size under a policy (the FinalizationPricing pattern —
  /// see ReworkPolicy for why BudgetedRework is the only branch for now).
  pure def reworkBudget(rw: ReworkPolicy): int =
    match rw {
      | BudgetedRework(n) => n
    }

  // --- Named rank ladder ---------------
  // Each rank is the successor of the one it must strictly dominate — the
  // ladder IS the derivation, so no bare rank numeral is written twice
  // (phaseRank reads these; the descent table in the header cites them).

  /// The settled tier: Done, Escalated, Revoked — one member fewer since
  /// Stalled merged into Escalated. Nothing is below settled.
  pure val rankSettled: int = 0
  /// Finalization resolves to completion, priced rework, or a wall.
  pure val rankHandoffBlocked: int = rankSettled + 1
  pure val rankPublishingHandoff: int = rankHandoffBlocked + 1
  pure val rankFinalizing: int = rankPublishingHandoff + 1
  pure val rankEvaluating: int = rankFinalizing + 1
  pure val rankWorking: int = rankEvaluating + 1
  /// The released waiting room (Ready/Blocked derive from it).
  pure val rankPending: int = rankWorking + 1
  /// The ladder's ceiling — the highest rank any phase takes (Pending).
  /// microBound's multiplier is radix(rankCeiling): the
  /// compression (6 -> 5)'s two new rungs (5 -> 7) and
  /// the grouping removal (7 -> 6) each propagated to the multiplier
  /// (7 -> 6 -> 8 -> 7) by derivation, not by editing a literal.
  pure val rankCeiling: int = rankPending

  /// How far from settled a ticket's lifecycle position is. The wildcard is
  /// the settled tier: Done, Escalated, and Revoked all take
  /// rankSettled — revoke and every wall drop any live rank straight to
  /// settled.
  pure def phaseRank(p: Phase): int =
    match p {
      | Pending => rankPending
      | Working => rankWorking
      | Evaluating => rankEvaluating
      | Finalizing => rankFinalizing
      | PublishingHandoff => rankPublishingHandoff
      | HandoffBlocked => rankHandoffBlocked
      | _ => rankSettled
    }

  pure def outstandingCount(tasks: Set[Task]): int =
    tasks.filter(t => t.state == Outstanding).size()

  /// The CURRENT eval stage, DERIVED from the live task set's kind marks
  /// (standing rule 3: no stored stage index) — meaningful only while the
  /// set is a stage's fan-out (Evaluating; tasksWellFormed pins the set
  /// uniformly Evaluation(s), so the fold's pick order is irrelevant). 0 on an
  /// empty or work set (the fold's base: no eval mark, no stage).
  pure def evalStage(tasks: Set[Task]): int =
    tasks.fold(0, (acc, t) => match t.kind { | Work => acc | Evaluation(s) => s })

  /// The stage digit: how many stages of the authored program have not yet
  /// passed — L - s while Evaluating stage s (so in 1..L there), 0 in every
  /// other phase (the digit APPEARS on work-passed and VANISHES on every
  /// exit, both dominated per the header's digit-order argument).
  pure def stagesLeft(ticket: Ticket): int =
    if (ticket.phase == Evaluating) ticket.program.length() - evalStage(ticket.tasks)
    else 0

  /// THE radix derivation, named once (the magic-number audit): a digit
  /// bounded by maxDigit takes maxDigit + 1 distinct values, so the next
  /// weight up must be worth exactly that many units of this one. Every
  /// weight and every account radix below is built from this — the "+ 1"
  /// appears here and nowhere else in the weight chain.
  pure def radix(maxDigit: int): int = maxDigit + 1

  /// Weight of one unit of stage progress: strictly dominates the
  /// outstanding-task count (<= nTasks) — the ABOVE-the-count half of the
  /// digit-order argument.
  pure def stageWeight(b: Bounds): int = radix(b.nTasks)

  /// Weight of one unit of phase rank: strictly dominates the full stage
  /// digit plus any outstanding count (stagesLeft <= maxStages, count <=
  /// nTasks < stageWeight) — the BELOW-rank half of the argument.
  pure def rankWeight(b: Bounds): int = radix(b.maxStages) * stageWeight(b)

  /// Strict upper bound on micro:
  ///   micro <= rankCeiling*rankWeight + (rankWeight - 1)
  ///         < radix(rankCeiling)*rankWeight.
  /// The multiplier is DERIVED from the ladder's ceiling rather than
  /// restated, so a change to the rung set cannot leave it stale.
  pure def microBound(b: Bounds): int = radix(rankCeiling) * rankWeight(b)

  /// Within-cycle progress, lexicographic (rank, stagesLeft, outstandingCount).
  pure def micro(b: Bounds, ticket: Ticket): int =
    phaseRank(ticket.phase) * rankWeight(b)
      + stagesLeft(ticket) * stageWeight(b)
      + outstandingCount(ticket.tasks)

  /// THE per-ticket termination measure: lexicographic
  /// (gasLeft, finalizationLeft, reworkLeft, micro), radix-flattened — each
  /// account's radix is one more than its grant (radix again), so every
  /// digit stays strictly below its radix. Nonnegative whenever the
  /// accounts are (domain.qnt's accountsBounded keeps them so).
  pure def ticketMeasure(b: Bounds, ticket: Ticket): int =
    ((ticket.gasLeft * radix(finalizationBudget(b.finalizationPricing)) + ticket.finalizationLeft)
        * radix(reworkBudget(b.reworkPolicy))
      + ticket.reworkLeft) * microBound(b)
    + micro(b, ticket)

  /// Sum over the fleet — steps touch one ticket, so per-step descent of the
  /// sum IS per-ticket descent. Order-independent fold (+ commutes).
  pure def sysMeasure(b: Bounds, tickets: int -> Ticket): int =
    tickets.keys().fold(0, (acc, j) => acc + ticketMeasure(b, tickets.get(j)))

  // === Vocabulary helpers (task plumbing shared by machine and tests) ======

  /// Task ids are 1-INDEXED and sequential within the ticket — the base is
  /// named once so the id arithmetic below carries the convention rather
  /// than a magic numeral.
  pure val firstTaskId: int = 1

  /// A fresh parallel task set of kind k: n tasks, all outstanding to the
  /// fabric in one step (see TaskState), ids start..start+n-1 — the
  /// caller passes nextTaskId so identity stays sequential within the ticket
  /// across the whole history.
  pure def spawnTasks(k: TaskKind, start: int, n: int): Set[Task] =
    start.to(start + n - 1).map(i =>
      { id: i, kind: k, state: Outstanding })

  /// The next task id this ticket would spawn: every id ever issued is either
  pure def nextTaskId(ticket: Ticket): int =
    firstTaskId + ticket.record.length() + ticket.tasks.size()

  /// THE spawn site: install a fresh fan-out of kind k on the ticket —
  /// ids continue the ticket's sequential history — and bump the ghost
  /// `spawned` counter by the same n, which is what keeps the idsAccounted
  /// equality (domain.qnt) checkable. Callers guarantee the previous set
  /// is already retired (tasks empty), which every spawn site satisfies:
  /// dispatch/wrapup-rework/resumeTicket spawn from task-free phases, and the
  /// reduces spawn on the retireLive'd ticket.
  pure def spawnOn(ticket: Ticket, k: TaskKind, n: int): Ticket =
    { ...ticket, tasks: spawnTasks(k, nextTaskId(ticket), n), spawned: ticket.spawned + n }

  /// Retire the live task set into the retained record, in id order
  /// (tasksWellFormed keeps live ids contiguous above the record, so the
  /// appended run keeps record entry i at id firstTaskId + i). A task
  /// still OUTSTANDING at retirement is force-closed as Resolved(Cancelled)
  /// — only revoke retires mid-flight sets; every reduce/escalation
  /// retirement is of a
  /// fully-resolved set, so the Cancelled arm never fires there. A
  pure def retireLive(ticket: Ticket): Ticket =
    val start = firstTaskId + ticket.record.length()
    { ...ticket,
      tasks: Set(),
      record: range(start, start + ticket.tasks.size()).foldl(ticket.record, (r, i) =>
        r.append(ticket.tasks.fold(
          { id: i, kind: Work, state: Resolved(Cancelled) },
          (acc, t) =>
          if (t.id == i)
            { ...t, state: if (t.state == Outstanding) Resolved(Cancelled) else t.state }
          else acc))) }

  /// First write wins: resolve task `tid` if it is still outstanding; the
  /// caller (decideTaskDone) treats an already-resolved task as a duplicate
  /// delivery and changes nothing — the idempotence an at-least-once
  /// fabric demands. The explicit
  /// lifecycle makes the finality structural: Outstanding -> Resolved(out)
  /// is the only edge, and nothing maps a Resolved back.
  /// The resolution event carries the footprint alongside
  /// the verdict, and first-write-wins covers BOTH — a duplicate delivery
  /// with a different citation changes nothing, and a carried task
  /// (born settled, no outstanding match) absorbs deliveries the same way.
  pure def resolveTask(tasks: Set[Task], tid: int, out: TaskOutcome): Set[Task] =
    tasks.map(t =>
      if (t.id == tid and t.state == Outstanding) { ...t, state: Resolved(out) }
      else t)

  /// What counts as a PASS to the combinator: a verdict earned this
  /// incarnation. Named rather than inlined because `combine` reads it
  /// twice and the tests pin it directly.
  pure def taskPassed(t: Task): bool = t.state == Resolved(Passed)

  /// The verdict combinator, interpreted per stage (the caller reads
  /// it off the ticket's program — eval is data, this is the interpreter's
  /// leaf). Callers guarantee every task is resolved.
  /// UnanimousPass is "every required evaluator in the stage passed" at
  /// this grain; Failed and Cancelled both fail it (taskPassed above).
  pure def combine(c: Combinator, tasks: Set[Task]): bool =
    match c {
      | UnanimousPass => tasks.forall(t => taskPassed(t))
      | AnyPass => tasks.exists(t => taskPassed(t))
    }
}
