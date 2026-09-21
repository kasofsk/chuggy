/// THE TICKET RECORD — what a ticket IS, the vocabulary every layer speaks
/// about one, and the task plumbing the machine and its tests share.
///
/// Nothing here decides and nothing here reads a const: domain.qnt is the
/// machine, refinement.qnt is one runtime shape for it, and both are pure
/// functions of the `Core` this file declares.
///
/// DERIVE, DON'T STORE (standing rule 3) is what gives the record its shape.
/// The waiting room (Ready/Blocked), the open desk task, the current eval
/// stage and a dependency's artifact are all PREDICATES over what is stored,
/// so what is stored is what no predicate can reach: the phase, the data the
/// author released, the live task set, and the retained record of the tasks
/// that have settled.
///
/// WHAT A TICKET DELIBERATELY DOES NOT CARRY. No attempt counter and no
/// per-task budget: the fabric relaunches a failed container below the cycle
/// grain, so this machine's grain is the CYCLE and same-cycle retry
/// machinery is a standing non-goal. No stage index (evalStage derives it
/// from the live set's kind marks), no readiness flag, and no timestamps or
/// results — implementation accounting, not machine state.
///
/// Sum-type constructors share one namespace per module, which is what the
/// prefixed names below are avoiding.
module chuggy_ticket {

  // === Vocabulary ==========================================================

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
  /// Evaluating edge, because within-phase progress lives in the live task
  /// set's stage mark rather than in new phases.
  type Phase =
    Pending | Working | Evaluating | Finalizing | Done | Escalated | Revoked

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
  /// job pays" for evaluator crashes — one edge, no new machinery.
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
  /// absorbed BY IDENTITY (domain.qnt decideTaskDone).
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

  /// WHAT AN EVALUATION FAILURE DOES. The machine consults this at every
  /// failing stage (domain.qnt decideEvalStageReduce) and takes exactly one
  /// of two edges: Rework re-enters Working as a new cycle; Escalate parks
  /// the ticket on the desk, where the operator's resume re-enters Working
  /// the same way. The machine does not choose between them — the
  /// disposition is an INPUT to the decision, drawn nondeterministically by
  /// the `evalReduce` action and journaled with it, so any policy an
  /// implementation runs over a ticket's history refines this machine.
  type EvaluationFailureDisposition =
    ReworkEvaluationFailure
    | EscalateEvaluationFailure

  /// Where an operator Retry resumes a parked ticket. NoResume when not parked —
  /// or parked with NO modeled resume: revoke is the only modeled exit from
  /// the dependency_revoked wall (domain.qnt modeledResumeExists), and
  /// stamping a resume point on it would be a lie to the desk.
  ///
  /// ResumeReworking is the evaluation-failure wall's: it re-enters Working
  /// as a new cycle. That wall is reached by a VERDICT, and a verdict has no
  /// re-judge to offer — the fabric already relaunched the container below
  /// the cycle grain — so the only honest continuation is a new artifact,
  /// which is a work cycle.
  type Resume =
    NoResume | ResumeWorking | ResumeReworking | ResumeEvaluating |
    ResumeFinalizing

  /// Why a ticket sits on the human desk. The reason is what distinguishes
  /// the parks. WorkFailed is the CYCLE-level work wall (there is no retries
  /// wall: retrying a failed container below the cycle grain is the fabric's
  /// job, trusted here rather than modeled). ReworkBudgetExhausted is the
  /// evaluation-failure wall, reached when the failure's disposition is
  /// Escalate. DependencyRevoked is the cascade wall and is not retryable;
  /// its only exit is revoke. The remaining reasons name what infrastructure
  /// refused when it could not run an intact task set.
  type Reason =
    NoReason | WorkFailed | ReworkBudgetExhausted | DependencyRevoked |
    ExecutionPolicyDenied | TicketConfigIncompatible |
    ExecutionProfileUnavailable | RuntimeVersionUnsupported |
    RequiredCapabilityUnavailable

  /// How a finalization attempt resolves. ONE success, deliberately: an earlier
  /// model named two, because a merge promotes differently depending on
  /// whether it went through the gate — and *which* mechanism a merge uses
  /// is a property of the merge adapter, not of the machine. The domain
  /// knows only that the step succeeded or failed.
  ///   - FinalizationSucceeded  the step committed the artifact.
  ///   - FinalizationFailed     it did not, and is drawable only when the
  ///                            environment invalidated the artifact
  ///                            (domain.qnt finalizationOutcomes).
  type FinalizationOutcome = FinalizationSucceeded | FinalizationFailed

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
  type ArtifactMark = NoArtifact | ProducedArtifact(int)

  /// One ticket's record.
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
    // The work phase's task-set width. Release-time semantic policy: later
    // decisions read this immutable field, never the importing module's
    // ambient configuration.
    workFanout: int,
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
    // id order). No decision reads it: it is provenance, and its length is
    // whatever the authors and operators who drove the ticket made it.
    record: List[Task],
    // GHOST (accounting only): how many tasks this ticket has EVER
    // spawned. Every spawn site bumps it by its fan-out (spawnOn below),
    // so the machine invariant `spawned == record.length + tasks.size`
    // (domain.qnt idsAccounted) makes history-unique sequential identity a
    // checked theorem rather than a test-pinned convention: a decider that
    // DROPPED a task set instead of retiring it would break the equality
    // in the very next state.
    spawned: int,
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
  pure def hasOpenHumanTask(ticket: Ticket): bool = ticket.phase == Escalated

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

  // === Vocabulary helpers (task plumbing shared by machine and tests) ======

  /// Task ids are 1-INDEXED and sequential within the ticket — the base is
  /// named once so the id arithmetic below carries the convention rather
  /// than a magic numeral.
  pure val firstTaskId: int = 1

  /// How much of the live set has yet to resolve. A set with none
  /// outstanding is what makes a phase reducible (domain.qnt
  /// reducibleWorkIn/reducibleEvalIn).
  pure def outstandingCount(tasks: Set[Task]): int =
    tasks.filter(t => t.state == Outstanding).size()

  /// The CURRENT eval stage, DERIVED from the live task set's kind marks
  /// (standing rule 3: no stored stage index) — meaningful only while the
  /// set is a stage's fan-out (Evaluating; tasksWellFormed pins the set
  /// uniformly Evaluation(s), so the fold's pick order is irrelevant). 0 on an
  /// empty or work set (the fold's base: no eval mark, no stage).
  pure def evalStage(tasks: Set[Task]): int =
    tasks.fold(0, (acc, t) => match t.kind { | Work => acc | Evaluation(s) => s })

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
