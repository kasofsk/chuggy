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
///   2. wrapUpLeft   the wrap-up account, non-zero only under Budgeted
///                   pricing.
///   3. reworkLeft   the eval-rework account, granted by the rework policy.
///   4. micro        within-cycle progress: phase rank, then stagesLeft,
///                   then the running-task count.
///
/// It is LEXICOGRAPHIC, flattened to one nonnegative integer by radix
/// weighting — every digit stays strictly below its radix, so the integer
/// order IS the lexicographic order. The weights are derived rather than
/// chosen, each next to its derivation, so no numeral appears twice and a
/// change to the phase ladder propagates instead of drifting.
///
/// WHAT IT DELIBERATELY DOES NOT READ. The repo, the wrap-up kind's resource
/// and the artifact are vocabulary, not digits — two tickets differing only
/// in those have equal measure, pinned by test. The retained task record is
/// append-only provenance, so reading it could only ever climb. And there is
/// no attempt digit and no per-task account: the fabric relaunches a failed
/// task, so this machine prices CYCLES, not relaunches.
///
/// THE DIGIT-ORDER ARGUMENT (why stagesLeft sits BELOW phase rank and
/// ABOVE — not beside — the running-task count):
///   - BELOW rank: entering Evaluating (work-passed, rank 3->2) makes the
///     stage digit APPEAR at its maximum (stagesLeft 0 -> L <= maxStages)
///     while the stage-0 fan-out spawns (running 0 -> <= nTasks). The one
///     rank step must dominate both at once, which forces
///     rankWeight > maxStages*stageWeight + nTasks — the rankWeight
///     definition below is exactly that bound plus one. Every EXIT from
///     Evaluating (eval-passed, rework, walls, revoke) drops rank or an
///     account, so the stage digit vanishing on exit never needs its own
///     descent argument.
///   - ABOVE the count: advancing a stage (eval-stage-passed) retires a
///     fully-resolved task set (running 0) and spawns the next stage's
///     fan-out — the running count JUMPS from 0 to <= nTasks in the same
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
/// program is immutable after arrival and enters only through stagesLeft.
///
/// WEIGHTS, re-derived (the magic-number audit: every numeral
/// here is a named value or derived from one, with its derivation adjacent;
/// no bare rank, multiplier, or radix literal appears twice):
///   radix(d) = d + 1
///     — a digit bounded by d takes d+1 distinct values, so one unit of the
///       next weight up must be worth exactly that many. Every "+ 1" in the
///       weight chain is this one derivation, named once.
///   stageWeight = radix(nTasks)
///     — one stage step dominates any running count (<= nTasks).
///   rankWeight  = radix(maxStages) * stageWeight
///     — one rank step dominates the full stage digit plus any count:
///       stagesLeft <= maxStages (programsWellFormed caps authored programs
///       at MAX_STAGES), so
///       stagesLeft*stageWeight + runningCount
///         <= maxStages*stageWeight + nTasks < radix(maxStages)*stageWeight.
///   microBound  = radix(rankCeiling) * rankWeight
///     — micro = rank*rankWeight + stagesLeft*stageWeight + runningCount
///            <= rankCeiling*rankWeight + (rankWeight - 1)
///             < radix(rankCeiling)*rankWeight.
///       Written as radix(rankCeiling) so the multiplier re-derives from
///       the ladder and can never silently drift from it: every change to
///       the rung set moves the ceiling, and the weight follows.
/// The domination chain above micro is unchanged in shape: micro <
/// microBound, so one unit of reworkLeft outweighs any within-cycle climb
/// (radix microBound), one unit of wrapUpLeft outweighs any reworkLeft refill
/// (radix reworkBudget), and one unit of gas outweighs everything below it
/// (radix wrapUpBudget). Every digit stays strictly below its radix, so the
/// flattened integer order IS the lexicographic order.
///
/// DESCENT TABLE — which transitions descend, and by which account.
/// (Deltas verified per-step by the machine's `stepDescends` invariant and
/// by tests/chuggy_test.qnt; labels are domain.qnt's StepRecord labels.
/// There is no stalled-retry label: the pre-work resume is an
/// operator-retry flavor, in the CHURN set below.)
///
///   label                               descends via
///   ----------------------------------- ---------------------------------
///   ticket-released                        rank 6->5 (authoring: release —
///                                       Draft straight into the pipeline;
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
///   task-done (a running task resolves) task count -1
///   work-passed                         rank 4->3 (dominates the stage
///                                       digit appearing at L <= maxStages
///                                       AND the stage-0 fan-out spawn —
///                                       the rankWeight bound above.
///                                       A scoped re-entry
///                                       spawns r <= fanout RUNNING tasks
///                                       — carried tasks are born settled
///                                       — so the climb is r <= nTasks,
///                                       within the same bound: fewer
///                                       spawns only tighten it)
///   eval-stage-passed (          stagesLeft -1 (dominates the next
///     a non-final stage passes;           stage's fan-out spawn:
///     Evaluating -> Evaluating,           -stageWeight + fanout <= -1;
///                                         spawns r <= fanout running, so
///                                         -stageWeight + r <= -1 a
///                                         fortiori)
///   ticket-escalated work_failed           rank 4->0 (cycle-level resolution:
///                                       the fabric already retried below
///                                       the cycle via trusted backoffLimit)
///   eval-passed (the FINAL stage        rank 3->2 AND stagesLeft 1->0 (the
///     passes)                             ticket ENQUEUES for the gate —
///                                         PWrapUp is the queued state)
///   wrapup-started (the dequeue:      rank 2->1 (the ticket
///     dequeue occupies the repo's         takes the repo's depth-1 slot;
///     depth-1 gate — drawn only when      no account moves — the gate
///     the branch MOVED; a quiet dequeue   charges nothing until it fails)
///     lands directly in the same step,
///     the fast-path ticket-done below)
///   rework-started eval_failure         gas -1 AND reworkLeft -1 (the
///     (a stage FAILS: the short-circuit   micro reset — rank 3->4, stage
///     — later stages never spawn)         digit ->0, work respawn — is
///                                         dominated by the account drop)
///   ticket-escalated rework_budget_exhausted rank 3->0 (and stage digit ->0)
///   ticket-escalated gas_exhausted         rank {3,2,1}->0
///   ticket-done                            rank {2,1}->0 (2: the quiet
///                                       completing straight off the queue;
///                                       1: completing out of the lease)
///   rework-started wrapup_failure         gas -1 (AND wrapUpLeft -1 when
///                                       Budgeted); from PWrapUpHolding since the
///                                       the eviction
///                                       frees the gate by phase (rank
///                                       1->4 climb + respawn, dominated
///                                       by the gas drop)
///   ticket-escalated wrapup_budget_exhausted rank 1->0 (Budgeted only)
///   ticket-escalated revalidation_failed   rank 5->0 (the pre-work park —
///                                       Escalated is THE parked phase now;
///                                       the wall name survives as the
///                                       reason)
///   operator-retry, whenever it charges gas -1 (dominates the rank climb
///     gas (RWorking always — standing     back to 4/3/2 + respawn — for the
///     rule 2; REvaluating/RWrapUp        REvaluating resume that includes
///     under RetryCharged)                 the stage digit reappearing at L:
///                                         the whole climb is < microBound,
///                                         which gas outweighs; RWrapUp
///                                         re-ENQUEUES — resumes to
///                                         PWrapUp, never into the gate)
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
///     operator-retry, the PRE-WORK resume (Escalated -> Pending, the
///       RPending flavor's "stalled-retry becomes an
///       operator resume flavor"): +rankPending*rankWeight. FREE under
///       BOTH meterings, deliberately: nothing was ever spent on a
///       pre-work park, and the Working boundary still meters any actual
///       re-entry — the pre-work resume's pricing, kept
///       honest here by name.
///     operator-retry into Evaluating/Landing under RetryFree
///       (+<= rankEvaluating*rankWeight + maxStages*stageWeight + nTasks —
///        the Evaluating resume respawns the LOWEST stage's fan-out with
///        the full stage digit — a fresh eval fan-out)
///   Under the DEFAULT metering (RetryCharged) the churn set is the
///   pre-work resume alone. RetryFree deliberately reproduces a known
///   operator-churn livelock as a
///   configuration, so the model can generate escalation traces under both
///   prices — the mc_chuggy_retryfree instance plus the model gate's
///   witness layer (the deterministic free-climb machine trace in
///   tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
///   keep that exemption exercised, not dead.
///
///   AUTHORING (author churn above the
///   released pipeline; each member is bounded by name):
///     ticket-arrived      (+ the fresh Draft's whole ticketMeasure: a ticket enters
///                       the fleet. Bounded by construction: ids are dense,
///                       never reused, and capped by the N_TICKETS arrival
///                       bound — at most N_TICKETS arrivals ever. The arrival
///                       also fixes the ticket's eval PROGRAM, but a Draft's
///                       stage digit is 0, so the climb bound is unchanged.)
///                       Arrival is this set's ONLY climbing member: an
///                       author's edit loop is not in the phase table at
///                       all, because content edits on a Draft are below
///                       its grain.)
///     ticket-revoked, desk-only (= 0: revoking an already-parked ticket —
///                       Escalated is rank 0, so nothing falls when no
///                       dependent gets parked by the cascade AND no member
///                       gets released by the dissolution (either makes the
///                       step strictly descend). Bounded: PRevoked is
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
/// and each AUTHORING step is bounded by the arrival cap. So, given the
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
/// which the agentic dispatcher forever prefers other tickets takes
/// `dispatch` infinitely often and still starves one. Accepted 2026-08-14
/// (davemo88): "if there is always more pressing work, that's a real
/// possibility." A ticket that stops being chosen sits FLAT — it does not
/// churn — which is the whole of what is owed.
///
/// So: CHUGGY BOUNDS WORK, NOT WAITING. Waiting on an author
/// to release a Draft, on the dispatcher to pick, and on the gate to free
/// its slot (proposed R6) are all unbounded BY DECISION. The unconditional
/// system-quiescence theorem is a strictly stronger claim and is NOT
/// made here.
module chuggy_measure {

  // === Vocabulary ==========================================================
  // Sum-type constructors share one namespace per module, hence the
  // prefixes (P/T/TK/TS/V/R/Rs/C/RW/Land). The two-branch parameter types
  // keep bare descriptive constructor names — Budgeted/DeadlineOnly
  // (WrapUpPricing) and RetryCharged/RetryFree (RetryPricing) — documented
  // here because they live in the same module-wide constructor namespace.
  // TK (TaskKind), TS (TaskState — the explicit task lifecycle), and RW
  // (ReworkPolicy).
  // adds LO (WrapUpObs — the landing-boundary attribution); the
  // B (BatchMark) was added for grouping and deleted with it.

  /// STORED ticket phases, deliberately few (standing rule 3, derive don't
  /// store). Blocked and Ready are PREDICATES over deps + record in
  /// domain.qnt, not phases — a ticket that has not started is PPending, and
  /// the waiting-room split is derived. PPending must be stored (phase is
  /// total and "never started" is not expressible as a predicate over the
  /// other fields without overloading them). PWorking/PEvaluating carry the
  /// parallel task set; PWrapUp is its own phase because its outcome is the
  /// exclusivity boundary; PDone is absorbing; PEscalated is the human desk.
  ///
  /// PDraft is the ONLY authoring phase: release goes PDraft -> PPending
  /// directly, with Ready and Blocked derived.
  ///
  /// PEscalated is THE parked phase — one parked-with-an-open-human-task
  /// phase, with the `reason` field carrying the pre-work walls
  /// (revalidation_failed, dependency_revoked).
  ///
  /// PRevoked is the other settled terminal: absorbing, runs nothing, never
  /// completes, and opens NO human task, because revocation is the author's
  /// settled choice (see hasOpenHumanTask).
  ///
  /// An eval stage advance gets NO phase — it is an Evaluating ->
  /// Evaluating edge, because within-phase progress lives in the stage
  /// digit rather than in new phases.
  ///
  /// PWrapUpHolding is the lease held; PWrapUp is ENQUEUED. An
  /// implementation may keep queue and slot in ONE state with the split
  /// living in memory; the model lifts the slot into phase so depth-1
  /// exclusivity is a predicate over stored state, while the queue's ORDER
  /// stays deliberately unmodeled. A ticket is PWrapUpHolding only when the
  /// environment invalidated its artifact at the dequeue — a quiet dequeue
  /// completes directly and never occupies the gate — so PWrapUpHolding
  /// ENCODES invalidated = true with no stored flag, derive-don't-store
  /// applied to the environment's choice.
  type Phase =
    PDraft |
    PPending | PWorking | PEvaluating | PWrapUp | PWrapUpHolding |
    PDone | PEscalated | PRevoked

  /// What a task IS for (task records are first-class — they carry the
  /// anatomy):
  ///   TKWork     — a task of the Work phase's single task set (Work stays
  ///                ONE task-set phase per kasofsk's anatomy note; the
  ///                extracted vocabulary agrees
  ///                task creation: "Job enters Work (new cycle): one work
  ///                task", i.e. Work is not staged).
  ///   TKEval(s)  — a task of eval stage s (0-based index into the ticket's
  ///                authored program
  ///                `stage:`, "default 0; non-negative; evaluators run in
  ///                ascending stage order; within a stage they fan out in
  ///                parallel"). The kind mark is what makes the CURRENT
  ///                stage derivable from the live task set (evalStage
  ///                below) instead of stored — standing rule 3.
  type TaskKind = TKWork | TKEval(int)

  /// A settled task's outcome — RESOLVED verdicts only; a running task
  /// cannot carry one (see TaskState). TFailed
  /// covers BOTH a failed verdict and evaluator-infrastructure death: "the
  /// job pays" for evaluator crashes — one account, no new machinery.
  /// TCancelled is the retirement
  /// mark for a task still RUNNING when its ticket is revoked mid-flight —
  /// revoke force-closes every pending task with a synthetic resolution
  /// recording that the revoke, not a verdict, retired it.
  /// Only revoke produces it: every other retirement happens at a reduce,
  /// when the set is fully resolved.
  type TaskOutcome = TPassed | TFailed | TCancelled

  /// THE EXPLICIT TASK LIFECYCLE (one
  /// small sum instead of implicit set-membership). A task is SPAWNED into
  /// existence running (spawnTasks below — there is no dormant pre-state:
  /// creation and start are one step at this grain), RUNS, and RESOLVES exactly
  /// once — TSResolved carries the outcome, and the type now says what the
  /// old TRunning-in-TaskOutcome only implied: a running task CANNOT carry
  /// an outcome, and a resolved task MUST. First write wins (resolveTask);
  /// resolution is final (recordMonotone makes that a theorem).

  type TaskState = TSRunning | TSResolved(TaskOutcome)

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
  type Verdict = VPass | VFail

  /// Verdict combinator over a resolved task set. Not a
  /// machine-wide parameter — each STAGE of a ticket's authored program
  /// carries its own, because eval is data. The default, unanimous
  /// pass, is the default program's combinator
  /// (domain.qnt defaultProgram). CUnanimousPass is the
  /// required-evaluator rule — every required evaluator in the stage
  /// passed — at chuggy's grain. The required/advisory split is BELOW that
  /// grain: an advisory evaluator is one the stage's combinator ignores.
  type Combinator = CUnanimousPass | CAnyPass

  /// One stage of a ticket's eval program: a task-set with its own
  /// fan-out width and its own verdict combinator: one task per evaluator
  /// in the lowest stage, fanned out in parallel — a
  /// stage's width is its evaluator count, its combinator is the
  /// required-pass rule.
  type Stage = { fanout: int, combinator: Combinator }

  /// Gate-rework pricing — a model parameter, not a constant:
  /// the model generates escalation traces under both branches and the
  /// choice is made on evidence.
  type WrapUpPricing = Budgeted(int) | DeadlineOnly

  /// Eval-rework pricing ("rework budget should be removed from
  /// core job entity and into impl / middleware") — the WrapUpPricing
  /// pattern applied to the rework bound: the machine consults an abstract
  /// policy, and RWBudget(n) grants a budget of n cycles. Deliberately the
  /// ONLY branch for now: the triage row keeps the bound in the model
  /// because removing it entirely would make per-ticket liveness conditional
  /// on middleware behavior — an unbounded (or gas-only) branch is exactly
  /// the removal that was rejected. If evidence ever argues for another
  /// pricing, it lands as a new constructor here, instantiated alongside
  /// (the WrapUpPricing method). The per-ticket ACCOUNT the policy meters
  /// (Ticket.reworkLeft) is policy state the middleware owns in the
  /// implementation — see the field's note.
  type ReworkPolicy = RWBudget(int)

  /// Operator-retry metering — configurable per deployment, default
  /// charge. RetryFree reproduces a known livelock by configuration.
  type RetryPricing = RetryCharged | RetryFree

  /// Where an operator Retry resumes a parked ticket. RNone when not parked —
  /// or parked with NO modeled resume: the dependency_revoked wall's only
  /// modeled exit is revoke (domain.qnt retryableIn), and stamping a
  /// resume point on it would be a lie to the desk. RPending is the
  /// PRE-WORK resume flavor: back to the
  /// released waiting room (PPending, where Ready/Blocked re-derive),
  /// never to a pipeline phase — a pre-work park spent nothing and
  /// resumes to exactly where it left.
  type Resume = RNone | RPending | RWorking | REvaluating | RWrapUp

  /// Why a ticket sits on the human desk. The termination requirement
  /// names no individual wall; the reason is
  /// what distinguishes the parks: RsWorkFailed / RsReworkBudgetExhausted /
  /// RsWrapUpBudgetExhausted (Budgeted pricing only) / RsGasExhausted are
  /// the pipeline walls, and the PRE-WORK walls are RsRevalidationFailed
  /// (retryable — resumes to Pending, RPending) and RsDependencyRevoked
  /// (the cascade wall, chuggy-NEW — NOT retryable, its only exit is
  /// revoke). RsGasExhausted is the rename of the deadline wall
  /// (`gas_exhausted` on the trace); RsWorkFailed is the CYCLE-level work
  /// wall (there is no retries wall: below-cycle retries are the fabric's
  /// trusted backoffLimit, §2).
  type Reason =
    RsNone | RsWorkFailed | RsReworkBudgetExhausted |
    RsWrapUpBudgetExhausted | RsGasExhausted | RsRevalidationFailed |
    RsDependencyRevoked

  /// How a wrap-up attempt resolves. ONE success, deliberately: an earlier
  /// model named two, because a merge promotes differently depending on
  /// whether it went through the gate — and *which* mechanism a merge uses
  /// is a property of the merge adapter, not of the machine. The domain
  /// knows only that the step succeeded or failed.
  ///   - WOk      the step committed the artifact.
  ///   - WFailed  it did not, and is drawable only when the environment
  ///              invalidated the artifact (domain.qnt wrapUpOutcomes).
  type WrapUpOutcome = WOk | WFailed

  /// THE LANDING-BOUNDARY OBSERVATION (the isolation gate
  /// gate's attribution half): every step that RESOLVES a landing attempt
  /// carries WOAttempt with
  ///   - `repo`: the ticket's target repo — golden traces must be
  ///     per-repo attributable, and the repo cannot ride the effect
  ///     strings (no dynamic strings at this grain), so the step record
  ///     carries it structurally;
  ///   - `invalidated`: the environment's PER-ATTEMPT choice of whether
  ///     the target repo's default branch moved under the candidate — the
  ///     ONLY reason a landing can fail. This is the
  ///     envActive standing rule honored: an explicitly NAMED nondet
  ///     event on the
  ///     trace, never a stored env flag — there is no per-repo "active"
  ///     variable anywhere, and quiet/moved is chosen fresh at every
  ///     attempt (derive-don't-store applied to the environment).
  /// Every other step — including eval-passed (which merely ENQUEUES the
  /// landing) and complete-duplicate (an absorbed re-delivery: no attempt
  /// resolves, nothing is emitted) — carries WONone. The iff is the
  /// wrapUpIsolation invariant (domain.qnt).
  type WrapUpObs = WONone | WOAttempt({ repo: int, invalidated: bool })

  /// HOW A TICKET FINISHES (design 002), authored data on the ticket exactly
  /// like the eval program — eval-is-data applied one seam later.
  ///
  ///   WNone            the effect was external and already happened during
  ///                    work; evaluation passing completes the ticket, and
  ///                    it enters neither wrap-up phase. A deploy, a report.
  ///   WExclusive(r)    the step needs a LEASE on resource r before it may
  ///                    run — a merge takes its repo, a registry push takes
  ///                    the registry, a deploy-to-env takes the environment.
  ///
  /// Mutual exclusion is the domain's business and git is not: deciding that
  /// ticket A holds r and therefore B may not READS STATE BELONGING TO
  /// ANOTHER TICKET, which is the authority split's own test for a global
  /// decision, and pushing it to an adapter would make a second writer.
  /// Which promotion mechanism a merge uses is not modelled at all.
  ///
  /// NOT a measure input; only the PHASE has a rank.
  type WrapUp = WNone | WExclusive(int)

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
  /// PDone, depsDoneIn requires every dep to be PDone, and only a completion
  /// writes PDone, so a dependency's artifact is final before any dependent
  /// can dispatch.
  ///
  /// NOT a measure input, like `repo` (measureArtifactBlindTest).
  type ArtifactMark = ANone | ASome(int)

  /// One ticket's record. The measure below is a pure function of this.
  type Ticket = {
    phase: Phase,
    // Upstream dependency ticket ids (acyclic by construction in domain.qnt).
    // Deps may CROSS repos — the dep gate is Done-ness, not
    // location (domain.qnt depsDoneIn reads phase alone; the lean reading
    // of "one orchestrator, many targets": the DAG stays
    // orchestrator-level, and forbidding cross-repo edges would be new
    // machinery nothing has asked for).
    deps: Set[int],
    // How this ticket finishes (design 002): authored, immutable after
    // arrival, and what decides whether it takes a lease or completes at
    // eval-pass.
    wrapUp: WrapUp,
    // The artifact this ticket has produced, if it has passed work (design
    // 002). Set at work-passed and superseded by each rework's product.
    artifact: ArtifactMark,
    // THE TARGET REPO — one orchestrator, many targets: a ticket targets
    // EXACTLY ONE repo, an AUTHORED field like deps and the program —
    // chosen at arrival from the bounded universe 1..N_REPOS (domain.qnt
    // repos; reposWellFormed) and immutable after. NOT a measure input:
    // no digit, weight, or account radix reads it (the repo-blindness
    // theorem — derivation in this file's multi-repo header note), and no
    // budget is per-repo, deliberately.
    repo: int,
    // THE EVAL PROGRAM — an ordered list of stages, AUTHORED: it
    // arrives with the Draft and is immutable after arrival, like
    // deps. This is "eval is data, not machinery" made
    // literal: the program is data on the ticket record; domain.qnt's
    // decideEvalStageReduce is the interpreter. Well-formedness (non-empty,
    // length <= MAX_STAGES, every fanout in 1..N_TASKS) is an ARRIVAL
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
    // by ReworkPolicy (RWBudget(n) grants n; counts down — the measure
    // wants remaining, not spent). In the IMPLEMENTATION this account
    // belongs to the middleware, not to the core ticket entity — the note's
    // demand — and it stays on the model's Ticket record for the same reason
    // the ghost fields do their tickets: the termination measure needs its
    // bounded digit (the model's concern), while ownership of the counter
    // is the implementation's (documented, like `completions`, rather than
    // modeled).
    reworkLeft: int,
    // Gate-rework budget remaining; identically 0 under DeadlineOnly.
    wrapUpLeft: int,
    // GAS remaining — the REQUIRED account (the bound is a spend meter,
    // not a clock).
    gasLeft: int,
    // Operator-resume point (RNone unless Escalated with a modeled
    // resume — the dependency_revoked wall has none; see Resume).
    resumeAt: Resume,
    // Desk reason (RsNone unless Escalated). Deliberately FIRST-CLASS
    // stored trace vocabulary, not derived from phase — and the
    // Stalled merge leans on exactly that: with one parked phase, only the
    // reason distinguishes a retryable pre-work park
    // (RsRevalidationFailed) from the cascade wall (RsDependencyRevoked,
    // not retryable) and from the pipeline walls, which no phase predicate
    // could.
    reason: Reason,
    // GHOST: landing effects ever emitted for this ticket — the counter the
    // effect-exclusivity invariant (exactly one completion) reads.
    // Not implementation state.
    completions: int
  }

  /// Standing rule 3 (derive, don't store): the open-human-task flag IS a
  /// predicate over the phase — a desk task is open exactly while the ticket
  /// is parked on the desk, and PEscalated is THE parked phase.
  /// (storing the flag would need the iff proved as an invariant; deriving
  /// it makes the invariant hold by construction.) The trace-visible
  /// artifact is the "OpenHumanTask" effect string.
  ///
  /// PRevoked is deliberately NOT here: revocation is the author's
  /// settled choice — the desk owes a revoked ticket nothing, exactly like
  /// PDone. This is precisely why the revoke cascade needs its own
  /// coverage: a dependent stuck behind a Revoked dep gets no visibility
  /// through its dep, so the cascade parks it with a task of its OWN
  /// (RsDependencyRevoked; domain.qnt `cascadeSafety`).
  pure def hasOpenHumanTask(ticket: Ticket): bool =
    ticket.phase == PEscalated

  /// The machine's observed state, as the pure deciders see it. A record
  /// (not a bare map) so the ticket-source shape stays open.  attached
  /// authoring here with no widening needed after all — tickets ARRIVE by
  /// growing the map's (dense, never-reused) id domain through the
  /// `freshTicket` seam, and no decider needed surgery. The shape that
  /// grew is the Ticket record (program, record, task kinds), not Core.
  type Core = { tickets: int -> Ticket }

  /// One observed ticket-phase transition, golden-trace shaped (standing rule
  /// 4: conformance from day one — the model emits, the implementation
  /// replays). from == to is a REAL row, not a degenerate one — the
  /// stage advance is Evaluating -> Evaluating.
  type Transition = { ticket: int, from: Phase, to: Phase }

  /// One decision's observable record, mirroring the golden-trace step
  /// schema {event, transitions, effects} — extended
  /// with the landing-boundary attribution field (`landing`, WONone on
  /// every non-landing step; see WrapUpObs): the minimal StepRecord
  /// extension that keeps golden traces per-repo attributable at the one
  /// boundary where the repo matters.
  type StepRecord = {
    label: str,
    transitions: List[Transition],
    effects: List[str],
    landing: WrapUpObs
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
    wrapUpPricing: WrapUpPricing
  }

  // === The measure =========================================================

  /// The gate account's size under a pricing: Budgeted(n) grants n,
  /// DeadlineOnly grants none (gas alone meters the gate loop — the
  /// documented-livelock shape, kept as the branch to be priced on
  /// evidence).
  pure def wrapUpBudget(gp: WrapUpPricing): int =
    match gp {
      | Budgeted(n) => n
      | DeadlineOnly => 0
    }

  /// The rework account's size under a policy (the WrapUpPricing pattern —
  /// see ReworkPolicy for why RWBudget is the only branch for now).
  pure def reworkBudget(rw: ReworkPolicy): int =
    match rw {
      | RWBudget(n) => n
    }

  // --- Named rank ladder ---------------
  // Each rank is the successor of the one it must strictly dominate — the
  // ladder IS the derivation, so no bare rank numeral is written twice
  // (phaseRank reads these; the descent table in the header cites them).

  /// The settled tier: Done, Escalated, Revoked — one member fewer since
  /// Stalled merged into Escalated. Nothing is below settled.
  pure val rankSettled: int = 0
  /// The held lease sits directly above settled: every resolution —
  /// completion, the priced failure, the walls — settles or reworks in one
  /// step.
  pure val rankHolding: int = rankSettled + 1
  /// PWrapUp — ENQUEUED for the gate: the
  /// dequeue (gate-opened) descends into the gate, the quiet fast-path
  /// descends straight to Done.
  pure val rankWrapUp: int = rankHolding + 1
  pure val rankEvaluating: int = rankWrapUp + 1
  pure val rankWorking: int = rankEvaluating + 1
  /// The released waiting room (Ready/Blocked derive from it).
  pure val rankPending: int = rankWorking + 1
  /// The ONLY authoring phase, the ladder's top; release descends 6 -> 5.
  pure val rankDraft: int = rankPending + 1
  /// The ladder's ceiling — the highest rank any phase takes (PDraft).
  /// microBound's multiplier is radix(rankCeiling): the
  /// compression (6 -> 5)'s two new rungs (5 -> 7) and
  /// the grouping removal (7 -> 6) each propagated to the multiplier
  /// (7 -> 6 -> 8 -> 7) by derivation, not by editing a literal.
  pure val rankCeiling: int = rankDraft

  /// How far from settled a ticket's lifecycle position is. The wildcard is
  /// the settled tier: PDone, PEscalated, and PRevoked all take
  /// rankSettled — revoke and every wall drop any live rank straight to
  /// settled.
  pure def phaseRank(p: Phase): int =
    match p {
      | PDraft => rankDraft
      | PPending => rankPending
      | PWorking => rankWorking
      | PEvaluating => rankEvaluating
      | PWrapUp => rankWrapUp
      | PWrapUpHolding => rankHolding
      | _ => rankSettled
    }

  pure def runningCount(tasks: Set[Task]): int =
    tasks.filter(t => t.state == TSRunning).size()

  /// The CURRENT eval stage, DERIVED from the live task set's kind marks
  /// (standing rule 3: no stored stage index) — meaningful only while the
  /// set is a stage's fan-out (PEvaluating; tasksWellFormed pins the set
  /// uniformly TKEval(s), so the fold's pick order is irrelevant). 0 on an
  /// empty or work set (the fold's base: no eval mark, no stage).
  pure def evalStage(tasks: Set[Task]): int =
    tasks.fold(0, (acc, t) => match t.kind { | TKWork => acc | TKEval(s) => s })

  /// The stage digit: how many stages of the authored program have not yet
  /// passed — L - s while Evaluating stage s (so in 1..L there), 0 in every
  /// other phase (the digit APPEARS on work-passed and VANISHES on every
  /// exit, both dominated per the header's digit-order argument).
  pure def stagesLeft(ticket: Ticket): int =
    if (ticket.phase == PEvaluating) ticket.program.length() - evalStage(ticket.tasks)
    else 0

  /// THE radix derivation, named once (the magic-number audit): a digit
  /// bounded by maxDigit takes maxDigit + 1 distinct values, so the next
  /// weight up must be worth exactly that many units of this one. Every
  /// weight and every account radix below is built from this — the "+ 1"
  /// appears here and nowhere else in the weight chain.
  pure def radix(maxDigit: int): int = maxDigit + 1

  /// Weight of one unit of stage progress: strictly dominates the
  /// running-task count (<= nTasks) — the ABOVE-the-count half of the
  /// digit-order argument.
  pure def stageWeight(b: Bounds): int = radix(b.nTasks)

  /// Weight of one unit of phase rank: strictly dominates the full stage
  /// digit plus any running count (stagesLeft <= maxStages, count <=
  /// nTasks < stageWeight) — the BELOW-rank half of the argument.
  pure def rankWeight(b: Bounds): int = radix(b.maxStages) * stageWeight(b)

  /// Strict upper bound on micro:
  ///   micro <= rankCeiling*rankWeight + (rankWeight - 1)
  ///         < radix(rankCeiling)*rankWeight.
  /// The multiplier is DERIVED from the ladder's ceiling rather than
  /// restated, so a change to the rung set cannot leave it stale.
  pure def microBound(b: Bounds): int = radix(rankCeiling) * rankWeight(b)

  /// Within-cycle progress, lexicographic (rank, stagesLeft, runningCount).
  pure def micro(b: Bounds, ticket: Ticket): int =
    phaseRank(ticket.phase) * rankWeight(b)
      + stagesLeft(ticket) * stageWeight(b)
      + runningCount(ticket.tasks)

  /// THE per-ticket termination measure: lexicographic
  /// (gasLeft, wrapUpLeft, reworkLeft, micro), radix-flattened — each
  /// account's radix is one more than its grant (radix again), so every
  /// digit stays strictly below its radix. Nonnegative whenever the
  /// accounts are (domain.qnt's accountsBounded keeps them so).
  pure def ticketMeasure(b: Bounds, ticket: Ticket): int =
    ((ticket.gasLeft * radix(wrapUpBudget(b.wrapUpPricing)) + ticket.wrapUpLeft)
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

  /// A fresh parallel task set of kind k: n tasks, all running (spawned
  /// and started in one step — see TaskState), ids start..start+n-1 — the
  /// caller passes nextTaskId so identity stays sequential within the ticket
  /// across the whole history.
  pure def spawnTasks(k: TaskKind, start: int, n: int): Set[Task] =
    start.to(start + n - 1).map(i =>
      { id: i, kind: k, state: TSRunning })

  /// The next task id this ticket would spawn: every id ever issued is either
  /// retired (record) or live (tasks), and ids are dense from firstTaskId.
  pure def nextTaskId(ticket: Ticket): int =
    firstTaskId + ticket.record.length() + ticket.tasks.size()

  /// THE spawn site: install a fresh fan-out of kind k on the ticket —
  /// ids continue the ticket's sequential history — and bump the ghost
  /// `spawned` counter by the same n, which is what keeps the idsAccounted
  /// equality (domain.qnt) checkable. Callers guarantee the previous set
  /// is already retired (tasks empty), which every spawn site satisfies:
  /// dispatch/land-rework/opRetry spawn from task-free phases, and the
  /// reduces spawn on the retireLive'd ticket.
  pure def spawnOn(ticket: Ticket, k: TaskKind, n: int): Ticket =
    { ...ticket, tasks: spawnTasks(k, nextTaskId(ticket), n), spawned: ticket.spawned + n }

  /// Retire the live task set into the retained record, in id order
  /// (tasksWellFormed keeps live ids contiguous above the record, so the
  /// appended run keeps record entry i at id firstTaskId + i). A task
  /// still RUNNING at retirement is force-closed as TSResolved(TCancelled)
  /// — only revoke retires mid-flight sets; every reduce/escalation
  /// retirement is of a
  /// fully-resolved set, so the TCancelled arm never fires there. A
  pure def retireLive(ticket: Ticket): Ticket =
    val start = firstTaskId + ticket.record.length()
    { ...ticket,
      tasks: Set(),
      record: range(start, start + ticket.tasks.size()).foldl(ticket.record, (r, i) =>
        r.append(ticket.tasks.fold(
          { id: i, kind: TKWork, state: TSResolved(TCancelled) },
          (acc, t) =>
          if (t.id == i)
            { ...t, state: if (t.state == TSRunning) TSResolved(TCancelled) else t.state }
          else acc))) }

  /// First write wins: resolve task `tid` if it is still running; the
  /// caller (decideTaskDone) treats an already-resolved task as a duplicate
  /// delivery and changes nothing — the idempotence an at-least-once
  /// fabric demands. The explicit
  /// lifecycle makes the finality structural: TSRunning -> TSResolved(out)
  /// is the only edge, and nothing maps a TSResolved back.
  /// The resolution event carries the footprint alongside
  /// the verdict, and first-write-wins covers BOTH — a duplicate delivery
  /// with a different citation changes nothing, and a carried task
  /// (born settled, no running match) absorbs deliveries the same way.
  pure def resolveTask(tasks: Set[Task], tid: int, out: TaskOutcome): Set[Task] =
    tasks.map(t =>
      if (t.id == tid and t.state == TSRunning) { ...t, state: TSResolved(out) }
      else t)

  /// What counts as a PASS to the combinator: a verdict earned this
  /// incarnation. Named rather than inlined because `combine` reads it
  /// twice and the tests pin it directly.
  pure def taskPassed(t: Task): bool = t.state == TSResolved(TPassed)

  /// The verdict combinator, interpreted per stage (the caller reads
  /// it off the ticket's program — eval is data, this is the interpreter's
  /// leaf). Callers guarantee every task is resolved.
  /// CUnanimousPass is "every required evaluator in the stage passed" at
  /// this grain; TFailed and TCancelled both fail it (taskPassed above).
  pure def combine(c: Combinator, tasks: Set[Task]): bool =
    match c {
      | CUnanimousPass => tasks.forall(t => taskPassed(t))
      | CAnyPass => tasks.exists(t => taskPassed(t))
    }
}
