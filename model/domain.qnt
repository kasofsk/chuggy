/// THE CHUGGY DOMAIN MACHINE — the deciders, the state and actions layer,
/// and every safety invariant.
///
/// A decider is a PURE FUNCTION of an observed `TicketGraph` and an event,
/// returning transitions and a list of effects. It never performs one. That
/// is what lets the same functions serve any runtime shape, and what lets a
/// golden trace be replayed through them with no world to stub.
///
/// READS ARE NOT EFFECTS. Anything a decision needs is gathered into the view
/// before the decider runs. Getting this backwards is the commonest way a
/// decider/effects split stops being testable: the decider acquires an await,
/// then a mock, and then it is no longer a function.
///
/// THE SHAPE OF A TICKET'S LIFE. It is released as a Pending, and the
/// selector picks it out of the derived Ready set — which pick is the
/// selector's own agency, not scheduler noise, so any policy refines
/// unrestricted choice. Work runs one task set per cycle. Evaluation runs the
/// ticket's authored program, stage by stage, short-circuiting on a failure.
/// Then the ticket finalizes: a passing final stage moves it into Finalization,
/// where a platform-owned finalizer runs and reports one outcome, and the
/// ticket leaves the phase by that report — including when the report is that
/// no result was reachable, which parks it at the desk.
///
/// THE EVALUATION-FAILURE DISPOSITION. A failing stage has two continuations
/// and this machine chooses neither of them: it CONSULTS an
/// `EvaluationFailureDisposition` (ticket.qnt) carried with the decision.
/// Rework re-enters Work as a new cycle; Escalate parks the ticket on the
/// desk, where the operator's resume re-enters Work the same way. Here the
/// disposition is a nondet draw of `taskDone` — the completion that concludes
/// a failing stage is where it is consulted — and in refinement.qnt it is a
/// journaled pick, so an implementation that computes it from a ticket's
/// history — a cap on work cycles, a human's call — refines this machine
/// rather than changing it. A finalization failure has no such fork: it
/// always re-enters Work, and bounding a finalizer's own failure loop is
/// the finalizer's business, below this grain.
///
/// DERIVE, DON'T STORE. Ready and Blocked are predicates over deps, not
/// phases, so no unblock cascade exists to get wrong. Lease occupancy is a
/// predicate over phase, so nothing cleans up. The open-desk-task flag, the
/// evaluation tasks the fabric is running and a ticket's dependency
/// artifacts are all derived.
///
/// WHAT THIS FILE DELIBERATELY DOES NOT KNOW:
///   - Any INTERNAL structure to a wrap-up step — staging, failure classes, a
///     fix-and-retry path with its own budget. A step is one abstract verdict;
///     what a merge, a registry push or a deploy does inside it belongs to
///     that adapter.
///   - WHY a resource needs serializing. The domain owns mutual exclusion,
///     because deciding that one ticket holds a resource and another may not
///     reads state belonging to another ticket — the authority split's test
///     for a global decision, and a second writer if an adapter did it. It
///     does not own git.
///   - Scheduling and capacity. No slot count, no queue order, no fairness:
///     the fabric owns placement and quota, and waiting is unbounded by
///     decision.
///   - Retry below the cycle. No attempt counter, no per-task budget. The
///     fabric relaunches a failed task; this machine's grain is the cycle.
///   - The runtime shape. No journal, no cursor, no crash, no fabric
///     vocabulary at all — that is model/refinement.qnt, layered on this
///     machine and severable. Every shape must refine THIS machine, and this
///     file never learns which one runs it.
///   - Ticket batching in any form, and atomic changes across project partitions. Both
///     are deliberately absent, and nothing here can express either.
///
/// This header describes the machine; it does not narrate how the machine
/// came to be.
module chuggy_domain {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "./ticket"

  /// Maximum number of released tickets. Ticket identities come from the
  /// wider finite universe below and may be sparse or numerically reversed.
  const N_TICKETS: int
  /// THE EVALUATOR-KEY BOUND: the finite vocabulary a stage's roster is
  /// drawn from, so an authored evaluator key runs 1..N_TASKS and a stage
  /// carries at most that many possibly-parallel tasks. Work is not fanned
  /// out (ticket.qnt spawnWork) and names no evaluator.
  const N_TASKS: int
  /// Authored-program length cap — release's validity ceiling. Real programs
  /// are short by construction (stages are declared per evaluator), so the
  /// cap is a model-checking bound rather than domain vocabulary.
  const MAX_STAGES: int
  /// Finite external-id universe for model checking. It is deliberately wider
  /// than the ticket-count bound so traces can contain gaps and reverse
  /// numeric dependency edges. Production ids are opaque and unbounded.
  pure val ticketIdUniverse: Set[int] = 1.to(N_TICKETS * 2)

  /// What an evaluation failure may do. Both edges are always available: the
  /// machine holds no policy over the choice (ticket.qnt
  /// EvaluationFailureDisposition), so every run of `evalReduce` may take
  /// either, and any implementation policy is a restriction of this draw.
  pure val dispositionChoices: Set[EvaluationFailureDisposition] =
    Set(ReworkEvaluationFailure, EscalateEvaluationFailure)

  /// WHAT A TASK CAN COME BACK WITH, as the environment may produce it: a
  /// work task produced its artifact or reached no result at all; an
  /// evaluator judged either way or reached no result. The references are
  /// derived from the task's identity (ticket.qnt taskResultRefOf) rather
  /// than drawn, because the machine's only claim on them is that they
  /// exist.
  pure def reportChoices(task: TaskIdentity): Set[TaskTerminalReport] =
    val failures = Set(ProcessFailure, ExecutionUnavailableFailure)
      .map(kind => TerminalFailureReport({
        evidence: taskRefOf(task), kind: kind }))
    match task {
      | WorkTask(_) => failures.union(Set(WorkResultReport({
          result: taskResultRefOf(task) })))
      | EvaluationTask(_) => failures.union(
          Set(EvaluatorPass, EvaluatorFail).map(verdict =>
            EvaluationResultReport({ result: taskResultRefOf(task),
              verdict: verdict })))
    }

  /// THE FULL ROSTER: every evaluator key the bound allows, ascending. The
  /// default program's stage, and the longest roster a stage can list.
  pure val everyEvaluator: List[EvaluatorDefinition] =
    range(1, N_TASKS + 1).foldl([], (roster, k) => roster.append({ key: k }))

  /// The stage rosters an author may draw from: every NON-EMPTY ascending
  /// list of distinct keys from 1..N_TASKS, grown one key at a time. Keys
  /// are authored names rather than positions (ticket.qnt StageDefinition),
  /// so a sparse roster — 1 and 3, skipping 2 — is a choice like any other
  /// and the walk draws it.
  pure val stageChoices: Set[List[EvaluatorDefinition]] =
    everyEvaluator.foldl(Set([]), (acc, entry) =>
      acc.union(acc.map(roster => roster.append(entry))))
      .filter(roster => roster.length() >= 1)

  /// Every WELL-FORMED authorable program: non-empty, at most MAX_STAGES
  /// stages, each stage a roster from stageChoices under its POSITIONAL key.
  /// This set IS the release-refusal rule (programsWellFormed): the empty
  /// program, the empty roster, a key past the bound and an overlong program
  /// are not in it, so no release can carry one — the same
  /// structural-refusal shape as dependableTickets for deps
  /// draws from exactly this set).
  pure val validPrograms: Set[List[StageDefinition]] =
    1.to(MAX_STAGES).fold(Set([]), (acc, _) =>
      acc.union(acc.map(p => stageChoices.map(roster =>
        p.append({ key: p.length() + 1, evaluators: roster }))).flatten()))
      .filter(p => p.length() >= 1)

  /// THE DEFAULT PROGRAM: ONE stage listing every evaluator the bound
  /// allows. Every evaluator defaults to stage 0, so a ticket whose
  /// evaluators all share one stage judges in one parallel roster —
  /// pinned in tests/chuggy_test.qnt.
  pure val defaultProgram: List[StageDefinition] =
    [{ key: 1, evaluators: everyEvaluator }]

  /// The ticket-source seam, now CLOSED:
  /// every ticket the machine ever holds is built here, and the only caller is
  /// reaches the released pipeline only through decideRelease. The author's
  /// eval PROGRAM is released with the Pending (eval is data; authoring came
  /// first precisely so programs would have an release to ride).
  /// The TARGET PROJECT is released the same way — authored data
  /// riding the release, immutable after, like deps and the program.
  pure def freshTicket(
      deps_: Set[int], prog: List[StageDefinition]): Ticket = {
    phase: Pending,
    deps: deps_,
    program: prog,
    artifact: NoArtifact,
    tasks: Set(),
    evaluations: [],
    workCyclesStarted: 0,
    spawned: 0,
    escalation: NoEscalation,
    completions: 0
  }

  // ==========================================================================
  // === Pure deciders ========================================================
  // ==========================================================================
  // decide(view, event) -> Decision, never an effect. Every runtime shape
  // reuses these unchanged.

  pure def withTicket(c: TicketGraph, j: int, jb: Ticket): TicketGraph =
    { ...c, tickets: c.tickets.set(j, jb) }

  /// The one funnel every phase flip goes through, recording exactly one
  /// transition (golden-trace shaped, standing rule 4). from == to is
  /// a real row now — the stage advance records
  /// Evaluation -> Evaluation.
  pure def move(
      c: TicketGraph, j: int, to_: Phase, label: str,
      effects_: List[str]): Decision =
    { rec: {
        label: label,
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: to_ }],
        effects: effects_},
      post: withTicket(c, j, { ...c.tickets.get(j), phase: to_ }) }

  // --- Release and revoke ---------------------------------------------------
  // --------------------------------------------------------------------

  /// A ticket IS RELEASED as a Pending — the environment (an author) creates it.
  /// A ticket does not exist in TicketGraph before this decision. Its
  /// externally allocated id may be sparse. Dependencies may point only at
  /// already released tickets, and never at a tombstone: a Revoked ticket never
  /// becomes Done, so an edge to one is an edge that blocks its dependent
  /// for good, and refusing it at authoring time is what keeps an author
  /// from writing that ticket rather than discovering it afterwards.
  /// Callers guarantee deps_ ⊆ dependable ids (see `dependableTickets`).
  ///
  /// The release also carries the ticket's EVAL PROGRAM, validated the
  /// same structural way — callers guarantee prog ∈ validPrograms, so an
  /// empty program, an empty roster, a key past N_TASKS or named twice, an
  /// off-position stage key, or an overlong program is REFUSED at authoring
  /// time: no reachable state holds one
  /// (programsWellFormed), rather than the interpreter defending against
  /// one mid-flight. The program is immutable after release, like deps.
  ///
  /// Dynamic-DAG boundary: releases are author actions — only
  /// the environment action `release` calls this decider, and no ticket-event
  /// decider creates tickets, so the ticket set grows only by authoring, never by
  /// tickets spawning tickets. Author commands (release/revoke) are also guarded
  /// by enablement, not absorbed as duplicates: authors are command
  /// sources, not the at-least-once fabric — only fabric events get
  /// idempotent stutter deciders.
  ///
  /// The first domain decision for a ticket. The id is allocated by native
  /// release candidate authoring, may be sparse, and is never minted or
  /// ordered by TicketGraph.
  pure def decideReleaseTicket(
      c: TicketGraph, j: int, deps_: Set[int],
      prog: List[StageDefinition]): Decision =
    { rec: { label: "ticket-released", transitions: [], effects: []},
      post: { ...c, tickets: c.tickets.put(j, freshTicket(deps_, prog)) } }

  /// REVOKE — the author settles one ticket. Table provenance for the
  /// edge: lines 47-48 `(_, Revoked) => true` — every non-terminal phase
  /// may be revoked (the caller's guard, revocableIn) — and lines 45-46
  /// `(Done | Revoked, Revoked) => false` — the terminals are absorbing, so
  /// no decider ever moves a ticket OUT of Revoked (invariant
  /// terminalsAbsorbing). The revoked ticket settles: the live work task is
  /// retired and the world is told to cancel it, while the evaluation
  /// instances are KEPT exactly as they stood — provenance survives the
  /// author's settlement, "Revoked runs nothing" is not "Revoked remembers
  /// nothing", and leaving the phase is already enough to stop a run's
  /// obligations being owed (ticket.qnt liveTasks) —
  /// and the escalation cleared: Revoked opens NO human task
  /// (hasOpenHumanTask excludes it; revocation is the author's settled
  /// choice, like Done).
  ///
  /// ONE TICKET TRANSITIONS, the one the author named. A dependent behind
  /// it is left where it is: it stays Pending, depsDoneIn never admits it
  /// (a dep that is not Done blocks, and Revoked never becomes Done), and
  /// revoke stays offered on it (revocablesIn admits Pending), so its own
  /// author settles it the same way this one was settled. Revoking it here
  /// would destroy another author's ticket with no human deciding it, and
  /// parking it here would open a desk task for a decision only its author
  /// can take.
  pure def decideRevoke(c: TicketGraph, j: int): Decision =
    { rec: {
        label: "ticket-revoked",
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: Revoked }],
        // "CancelTicketWork" for the revoked ticket, and nothing else: no
        // dependent moved, so no desk task opens.
        effects: ["CancelTicketWork"]},
      post: withTicket(c, j,
        { ...retireLive(c.tickets.get(j)), phase: Revoked,
          escalation: NoEscalation }) }

  // --- Pure guard predicates ------

  /// Revocation stops before finalization and cannot rewrite a terminal outcome.
  pure def revocableIn(c: TicketGraph, j: int): bool =
    c.tickets.get(j).phase != Done and
      c.tickets.get(j).phase != Revoked and
      c.tickets.get(j).phase != Finalization

  /// May the operator retry this ticket's open human action? Exactly while
  /// the desk holds a task for it — every resume is free, so nothing else is
  /// asked, and every wall the sum can hold resumes somewhere (resumeOf is
  /// total), so there is no stamp left to check against the phase.
  pure def retryableIn(c: TicketGraph, j: int): bool =
    hasOpenHumanTask(c.tickets.get(j))

  /// WHAT A TICKET WAITS ON before it may run — the single definition, read
  /// by the readiness check (depsDoneIn) and the cross-ticket artifact
  /// read alike. Named for
  /// what it is rather than for the dispatch gate it feeds, because the
  /// merge gate that shared that word is gone.
  ///
  /// One definition on purpose: the grouping defect was a DERIVED waiting
  /// relation diverging from the stored field depsAcyclic watched, so a
  /// future derived relation moves both checks or neither.
  pure def waitsOn(c: TicketGraph, j: int): Set[int] = c.tickets.get(j).deps

  /// WHAT THIS TICKET'S DEPENDENCIES PRODUCED (design 002) — the read that
  /// makes a release ticket expressible at all. Derived, never stored, and
  /// stable: every dep is Done before a dependent can dispatch, and Done
  /// is absorbing, so nothing here can change under a reader.
  pure def depArtifacts(c: TicketGraph, j: int): Set[ArtifactMark] =
    waitsOn(c, j).map(d => c.tickets.get(d).artifact)

  pure def depsDoneIn(c: TicketGraph, j: int): bool =
    waitsOn(c, j).forall(k => c.tickets.get(k).phase == Done)

  // --- TicketGraph-parameterized enablement (the refinement layer — the
  // m6 hoist discipline one level up, applied to the enablement SETS):
  // the journaled actor's replay checker (model/refinement.qnt,
  // journalLegalOn) must re-check each journaled decision's enablement at
  // the REPLAYED prefix state — a TicketGraph, not this module's live vars
  // — and a copied guard drifts exactly like the witness-driver copies m6
  // killed. So each enablement val below (the state section) is now a
  // one-line reference to its pure TicketGraph form here; the machine's
  // actions
  // and the replay checker consume the SAME definition. No semantic
  // change: each val's body moved verbatim into its pure def (liveTickets
  // becomes the explicit c.tickets.keys()).

  /// Room for one more release (the N_TICKETS release bound).
  pure def canReleaseIn(c: TicketGraph, j: int): bool = and {
    c.tickets.keys().size() < N_TICKETS,
    ticketIdUniverse.contains(j),
    not(c.tickets.keys().contains(j))
  }

  /// Tickets a release may depend on: anything but a tombstone, because a
  /// Revoked ticket never becomes Done (decideReleaseTicket).
  pure def dependableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(k => c.tickets.get(k).phase != Revoked)

  /// The only authoring phase, hence the only releasable set.
  /// Every non-terminal may be revoked.
  pure def revocablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => revocableIn(c, j))

  /// The derived Ready room (isReadyIn per ticket).
  pure def readiesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => isReadyIn(c, j))

  /// Tickets the fabric is currently running a task for, which is who a
  /// completion can be delivered to. Narrower than "in a task phase": a
  /// resolved work task waits for its reduce, and nothing is running for it.
  pure def completableIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => liveTasks(c.tickets.get(j)) != Set())

  pure def reducibleWorkIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j =>
      c.tickets.get(j).phase == Work and outstandingCount(c.tickets.get(j).tasks) == 0)

  pure def doneIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => c.tickets.get(j).phase == Done)

  /// Parked tickets the operator may Retry (retryableIn per ticket).
  pure def retryablesIn(c: TicketGraph): Set[int] =
    c.tickets.keys().filter(j => retryableIn(c, j))

  /// The derived waiting room (standing rule 3), as pure predicates over a
  /// TicketGraph so tests can pin them: any dependency not yet Done blocks.
  pure def isReadyIn(c: TicketGraph, j: int): bool =
    c.tickets.get(j).phase == Pending and depsDoneIn(c, j)

  pure def isBlockedIn(c: TicketGraph, j: int): bool =
    c.tickets.get(j).phase == Pending and not(depsDoneIn(c, j))

  /// Every task identity ticket j can still be told about: one work task per
  /// cycle it has started, and every evaluator of every run its instances
  /// hold, at the generation those runs now stand at. DERIVED — the ticket
  /// keeps no task log — and a superset of the live set, which is the point:
  /// the witness drivers (tests/chuggy_witness_test.qnt) deliver a
  /// SETTLED task's completion from here to show it absorbed by identity.
  pure def deliverableTasksIn(c: TicketGraph, j: int): Set[TaskIdentity] =
    val jb = c.tickets.get(j)
    range(1, jb.workCyclesStarted + 1)
      .foldl(Set(), (found, cycle) => found.union(Set(workTaskOf(j, cycle))))
      .union(jb.evaluations.foldl(Set(), (found, evaluation) =>
        found.union(instanceTasks(evaluation))))

  /// Park a ticket on the human desk, naming the wall (the termination
  /// requirement commits the terminal, not the names); where Retry resumes
  /// is the wall's own (resumeOf). The open desk task
  /// is DERIVED from
  /// the phase (hasOpenHumanTask, standing rule 3); "OpenHumanTask" is its
  /// trace-visible effect. This is THE park. The live work task is retired
  /// and the world is told nothing more about it; an evaluation park keeps
  /// its instance, which is what its resume re-asks from.
  pure def escalate(
      c: TicketGraph, j: int, wall: Escalation, label: str): Decision =
    move(
      withTicket(c, j, { ...retireLive(c.tickets.get(j)), escalation: wall }),
      j, Escalated, label, ["OpenHumanTask"])

  /// Ready -> Work: launch a cycle for the ticket THE SELECTOR PROPOSED.
  /// Work is ONE task-set phase (one work task per cycle; Work is not
  /// staged), and the cycle counter — with the run's own generation for an
  /// evaluation — is what makes each identity a ticket names one no earlier
  /// task of it ever carried.
  ///
  /// THE AGENTIC SELECTOR: this decider makes the accepted dispatch
  /// proposal first-class — j
  /// is the CHOICE, and the chooser is the `dispatch` action's nondet pick
  /// among readyTickets. That pick is not incidental scheduler noise to be
  /// refined away: the selector is itself agentic rather than a FIFO pop,
  /// so its choice is a genuine nondet outcome and ANY
  /// Ready ticket may be chosen next, and the `dispatch` StepRecord in the
  /// trace IS the ticket writer's decision event — an implementation
  /// conforms with any policy (LLM-driven, priority, whatever) because
  /// every policy refines unrestricted choice among Ready tickets. No
  /// policy-hook parameter is introduced: with exactly one honest default
  /// (unrestricted nondet) a const would have one branch and nothing to
  /// compare — it enters only when a real competing policy needs modeling.
  /// No queue, no fairness — standing non-goals.
  pure def decideDispatch(c: TicketGraph, j: int): Decision =
    val jb = c.tickets.get(j)
    move(
      withTicket(c, j, spawnWork(j, jb)),
      j, Work, "dispatch", ["SpawnWorkTasks"])

  /// THE COMPLETION — one decider for every task this machine ever asks
  /// for, in either phase, carrying what came back (ticket.qnt
  /// TaskTerminalReport). There is no second event behind it: a completion
  /// that concludes a stage decides the stage in the same step, which is why
  /// the evaluation-failure disposition is an argument here.
  ///
  /// FIRST WRITE WINS: if the task is not one the ticket is currently
  /// waiting on (ticket.qnt liveTasks), this is a duplicate or a stale
  /// delivery and the decision is a state-identical no-op — a duplicate an
  /// at-least-once fabric cannot be asked not to send. The stale arm is
  /// structural: task identities are unique across the ticket's whole
  /// history, so a completion for an earlier stage, generation or cycle
  /// names one nothing is waiting on — no match, no-op BY IDENTITY.
  ///
  /// A WALL IS NOT A VERDICT, and the two phases answer it differently. An
  /// evaluator that infrastructure could not run marks that evaluator and
  /// the stage RUNS ON: its siblings are still judging, and whether the
  /// ticket parks is the stage's decision once they finish (evaluation.qnt
  /// concludeStage). A work task's wall parks the ticket at once, because a
  /// work cycle is one task and there is nothing left of it to wait for.
  pure def decideTaskDone(
      c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport,
      onFailure: EvaluationFailureDisposition): Decision =
    val jb = c.tickets.get(j)
    if (not(liveTasks(jb).contains(task))) taskDoneStep(c, j, jb)
    else if (jb.phase == Work) decideWorkTaskDone(c, j, task, report)
    else decideEvalTaskDone(c, j, task, report, onFailure)

  /// The completion's own step: no transition, because a task settling is
  /// progress inside a phase. The state it carries is the caller's.
  pure def taskDoneStep(c: TicketGraph, j: int, jb: Ticket): Decision =
    { rec: { label: "task-done", transitions: [], effects: []},
      post: withTicket(c, j, jb) }

  /// A WORK completion. The cycle's one task settles — produced, or died
  /// with the fabric's relaunches behind it — and the reduce that follows
  /// reads the settled task (decideWorkReduce). Infrastructure that could
  /// not run it at all parks the ticket here instead: there is no sibling to
  /// wait for and no judgement to preserve.
  pure def decideWorkTaskDone(
      c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport): Decision =
    val jb = c.tickets.get(j)
    match report {
      | WorkResultReport(_) =>
        taskDoneStep(c, j, { ...jb, tasks: resolveTask(jb.tasks, task, Passed) })
      | TerminalFailureReport(failure) =>
        match failure.kind {
          | ProcessFailure =>
            taskDoneStep(c, j, { ...jb, tasks: resolveTask(jb.tasks, task, Failed) })
          | ExecutionUnavailableFailure =>
            escalate(c, j, WorkExecutionUnavailableEscalated,
              "ticket-escalated work_execution_unavailable_escalated")
        }
      // Unreachable: a work task takes no evaluator's verdict
      // (ticket.qnt reportMatchesTask is the completion's enablement).
      | EvaluationResultReport(_) => taskDoneStep(c, j, jb)
    }

  /// AN EVALUATION completion, which is also THE EVAL-PROGRAM INTERPRETER:
  /// the report goes to the instance (ticket.qnt applyTaskReport, which is
  /// the protocol's own applyProduced/applyFailure and their concludeStage),
  /// and the state that comes back says which edge this was:
  ///
  ///   - still RUNNING the same stage -> a status settled and the stage owes
  ///     its remaining evaluators; no transition.
  ///   - RUNNING a later stage -> the stage passed and the next one is
  ///     asked. The Evaluation -> Evaluation transition is a real row.
  ///   - PASSED -> the program passed, so the ticket finalizes. WHAT its
  ///     finalizer commits, and whether that is anything at all, is the
  ///     finalizer's own configuration below this grain.
  ///   - FAILED -> the later stages are not created: they are skipped, not
  ///     failed, and no run exists for them. The edge `onFailure` names is
  ///     taken — Rework re-enters Work as a new cycle, whose judgement is a
  ///     new instance; Escalate parks at the evaluation-failure wall, whose
  ///     resume re-enters Work the same way.
  ///   - BLOCKED -> every evaluator has answered and at least one of them
  ///     was a wall, so the judgement is intact and unmade: park at the
  ///     blocked wall, whose resume re-asks exactly those evaluators at the
  ///     next generation (decideResumeTicket).
  pure def decideEvalTaskDone(
      c: TicketGraph, j: int, task: TaskIdentity,
      report: TaskTerminalReport,
      onFailure: EvaluationFailureDisposition): Decision =
    val jb = c.tickets.get(j)
    val before = currentInstance(jb)
    val advanced = withInstance(jb, applyTaskReport(before, task, report))
    val stepped = withTicket(c, j, advanced)
    match advanced.evaluations[advanced.evaluations.length() - 1].state {
      | Running(progress) =>
        if (progress.stage.stageIndex == runningStageIndex(before))
          taskDoneStep(c, j, advanced)
        else
          move(withTicket(c, j, spawnEvalRun(advanced)),
            j, Evaluation, "eval-stage-passed", ["SpawnEvalTasks"])
      | EvaluationPassed(_) =>
        move(stepped, j, Finalization, "eval-passed", ["RunFinalizer"])
      | EvaluationFailed(_) =>
        match onFailure {
          | ReworkEvaluationFailure =>
            move(withTicket(c, j, spawnWork(j, advanced)),
              j, Work, "rework-started eval_failure", ["SpawnWorkTasks"])
          | EscalateEvaluationFailure =>
            escalate(stepped, j, EvaluationFailureEscalated,
              "ticket-escalated evaluation_failure_escalated")
        }
      | EvaluationBlocked(_) =>
        escalate(stepped, j, EvaluationBlockedEscalated,
          "ticket-escalated evaluation_blocked_escalated")
    }

  /// The Work task settled: reduce the phase, at CYCLE level only. Work runs
  /// ONE task per cycle, so the phase's success is that task's. A pass
  /// retires the work task, marks the artifact it produced and OPENS THE
  /// INSTANCE that judges it (ticket.qnt beginEvaluation), whose first stage
  /// is asked at once — one task per evaluator that stage lists, fanned out
  /// in parallel. Every entry spawns the stage in
  /// full — an evaluator is never skipped on the grounds that its subject
  /// did not change, because deciding that soundly needs the evaluator to
  /// declare its own footprint honestly, which is a property of the
  /// evaluator and not of this machine. A
  /// failed task is a failed CYCLE and escalates directly: the fabric
  /// has already retried it below the cycle (trusted
  /// relaunch limit), and modeling attempts of our own is a standing
  /// non-goal.
  pure def decideWorkReduce(c: TicketGraph, j: int): Decision =
    val jb = c.tickets.get(j)
    if (workProduced(jb.tasks))
      move(
        withTicket(c, j, beginEvaluation(j, retireLive(jb))),
        j, Evaluation, "work-passed", ["SpawnEvalTasks"])
    else
      escalate(c, j, WorkFailureEscalated,
        "ticket-escalated work_failure_escalated")

  /// A finalizer reports only a domain outcome. Queueing,
  /// preparation, approval, permits and reconciliation are focused durable
  /// operational records; TicketGraph does not learn a finalizer
  /// implementation. Which conditions a finalizer calls unreachable is the
  /// same kind of detail: the machine draws the outcome, never the cause.
  pure def finalizationOutcomes: Set[FinalizationOutcome] =
    Set(FinalizationSucceeded, FinalizationNeedsWork,
      FinalizationResultUnavailable)

  pure def finalizationOutcomeEnabled(
      c: TicketGraph, j: int, out: FinalizationOutcome): bool =
    match out {
      | FinalizationSucceeded => c.tickets.get(j).phase == Finalization
      | FinalizationNeedsWork => c.tickets.get(j).phase == Finalization
      | FinalizationResultUnavailable => c.tickets.get(j).phase == Finalization
    }

  /// A finalizer reporting failure re-enters Work as a new cycle: it did
  /// not commit the artifact, and the only continuation a failed commit has
  /// is new work. There is no wall here — how many times a finalizer may
  /// report failure is the finalizer's own business, below this grain.
  pure def finalizerFailure(c: TicketGraph, j: int): Decision =
    val jb = c.tickets.get(j)
    move(withTicket(c, j, spawnWork(j, jb)),
      j, Work, "rework-started finalization_needs_work", ["SpawnWorkTasks"])

  /// THE COMPLETION: the ticket reaches Done. Native desk state is updated
  /// transactionally with the journal, so no external completion effect is
  /// emitted.
  pure def completeTicket(c: TicketGraph, j: int): Decision =
    { rec: {
        label: "ticket-done",
        transitions: [{ ticket: j, from: c.tickets.get(j).phase, to: Done }],
        effects: []},
      post: withTicket(c, j,
        { ...c.tickets.get(j), phase: Done,
          completions: c.tickets.get(j).completions + 1 }) }

  /// A result resolves only from Finalization. A success is
  /// the ticket's single completion
  /// (completeTicket: ghost `completions` counts it, one per ticket); a
  /// failure re-enters work (finalizerFailure); no result at all parks the
  /// ticket at ResumeFinalization, which is the only wall whose resume re-runs
  /// the very step it interrupted — nothing about the ticket has to change for
  /// the next attempt to differ, because what stood in the way was never the
  /// ticket. Without this edge a finalizer that cannot reach a result leaves
  /// the ticket in Finalization, which is neither revocable (revocableIn) nor
  /// retryable (retryableIn), until the environment changes under it.
  /// A finalizer's internals and recovery protocol stay below this grain: it
  /// reports one abstract verdict, including the verdict that it has none.
  pure def decideFinalizationResult(
      c: TicketGraph, j: int, out: FinalizationOutcome): Decision =
    match out {
      | FinalizationSucceeded => completeTicket(c, j)
      | FinalizationNeedsWork => finalizerFailure(c, j)
      | FinalizationResultUnavailable =>
        escalate(c, j, FinalizationUnavailableEscalated,
          "ticket-escalated finalization_unavailable_escalated")
    }

  /// Operator Retry on a parked ticket: resume at the point its wall implies
  /// (resumeOf). Resuming is free — a resume is a human act, and this machine
  /// bounds no human. This is THE operator resume — one decider, a flavor
  /// per resume point, one trace label ("ticket-resumed"; the flavor is
  /// visible in the transition's target):
  ///   ResumeWork and ResumeRework: THE SAME CONTINUATION — respawn
  ///     the work task as a new cycle. The two walls they answer differ
  ///     (failed work, a failed evaluation) but a verdict has no re-judge to
  ///     offer, so both are honest only as new work.
  ///   ResumeEvaluation: RE-ASK THE EVALUATORS THE WALL STOPPED, and only
  ///     those — the instance's blocked run is reopened at the next
  ///     generation and the evaluators that already judged keep what they
  ///     said (evaluation.qnt resumeBlocked). The generation is what makes
  ///     the re-asked tasks new identities, so a late completion from the
  ///     interrupted attempt names one nothing is waiting on.
  ///   ResumeFinalization: request a fresh finalization attempt.
  pure def decideResumeTicket(c: TicketGraph, j: int): Decision =
    val jb = c.tickets.get(j)
    val resumed = { ...jb, escalation: NoEscalation }
    val workResume =
      move(withTicket(c, j, spawnWork(j, resumed)),
        j, Work, "ticket-resumed", ["SpawnWorkTasks"])
    match resumeOf(jb.escalation) {
      | ResumeWork => workResume
      | ResumeRework => workResume
      | ResumeEvaluation =>
        val reopened =
          withInstance(resumed, resumeBlocked(currentInstance(resumed)))
        move(withTicket(c, j, spawnEvalRun(reopened)),
          j, Evaluation, "ticket-resumed", ["SpawnEvalTasks"])
      | ResumeFinalization =>
        move(withTicket(c, j, resumed), j, Finalization, "ticket-resumed", ["RunFinalizer"])
      | NoResume =>
        // Unreachable: retryableIn refuses an unparked ticket, and
        // deskConsistent holds that an unparked ticket is at NoEscalation,
        // which is the only escalation resumeOf answers NoResume for.
        { rec: { label: "ticket-resume-refused", transitions: [], effects: []}, post: c }
    }

  // ==========================================================================
  // === State + actions ======================================================
  // ==========================================================================

  var tickets: int -> Ticket
  /// The last decision's StepRecord — the golden-trace-shaped observation
  /// (standing rule 4: the model emits golden traces from day one).
  var lastStep: StepRecord
  /// GHOST: the PREVIOUS state's evaluation instances, per ticket — written
  /// by every action, read only by evaluationsMonotone (the
  /// history-monotonicity invariant needs one step of history).
  var prevEvaluations: int -> List[EvaluationInstance]

  val graph: TicketGraph = { tickets: tickets }
  /// The current instances snapshot the ghost carries forward each step.
  val currentEvaluations: int -> List[EvaluationInstance] =
    tickets.keys().mapBy(j => tickets.get(j).evaluations)

  /// Released ticket identities. Ordering has no semantic meaning.
  val liveTickets: Set[int] = tickets.keys()

  action apply(d: Decision): bool = all {
    tickets' = d.post.tickets,
    lastStep' = d.rec,
    prevEvaluations' = currentEvaluations
  }

  /// REFINEMENT-LAYER SEAM (the refinement layer — the state-shaped counterpart
  /// of the TicketGraph-parameterized enablement exports above): install an
  /// externally reconstructed TicketGraph WITHOUT taking a domain step. The
  /// refinement module's executor/crash actions (refinement.qnt emitNext /
  /// crashRecover / effectCrash) are NOT domain steps — the domain trace
  /// has no row for them — so the step-history ghost stays STALE (it
  /// keeps describing the last real decision, which keeps every
  /// lastStep/ghost invariant's verdict byte-identical across the
  /// refinement-layer step; `apply` would re-snapshot it and falsely
  /// present the crash as a flat domain step). NOT in `step`'s any{}
  /// roster: the domain machine cannot reach this — only the refinement
  /// layer calls it, and only with a replay of its own journal (under the
  /// journal-then-effect discipline that replay equals the live state —
  /// refinement.qnt recoveryComplete — so the domain vars do not move).
  /// Exported as an action rather than left to the refinement module
  /// because Quint 0.32's instance flattening rejects a primed assignment
  /// of an instance's var from the importing module's own expressions
  /// ("Variable not set" at evaluation) — the assignment must live in the
  /// module that declares the var, exactly like the invariants.
  action installGraph(c: TicketGraph, rec: StepRecord): bool = all {
    tickets' = c.tickets,
    lastStep' = rec,
    prevEvaluations' = prevEvaluations
  }

  // --- Derived waiting room (standing rule 3: derive, don't store) ---------
  // Blocked and Ready are PREDICATES over deps, not phases.
  // Storing them is what forces an unblock cascade; chuggy stores only
  // Pending and derives the split, so the
  // unblock cascade disappears entirely — there is no Blocked->Ready edge
  // to model or to get wrong. (The open-human-task flag is derived too:
  // ticket.qnt hasOpenHumanTask; the evaluation tasks are derived from
  // the current run: ticket.qnt liveTasks.) The model extends them
  // for free: a Pending dependency is simply not Done and blocks with no
  // new machinery; the pure bodies live with
  // the deciders (isReadyIn/isBlockedIn) so unit tests can pin exactly
  // that.

  def isReady(j: int): bool = isReadyIn(graph, j)

  def isBlocked(j: int): bool = isBlockedIn(graph, j)

  // --- Enablement sets ------------------------------------------------------

  // Each enablement val below REFERENCES its pure TicketGraph form (the
  // refinement PR's hoist — see the TicketGraph-parameterized enablement
  // section with the deciders): one definition, consumed by the machine's
  // actions, the witness drivers, and the journal replay checker alike.

  /// Room for one more release (the N_TICKETS release bound keeps the state
  val releasableIds: Set[int] = ticketIdUniverse.filter(j => canReleaseIn(graph, j))
  /// Tickets a new release may depend on: no tombstones (dependableIn).
  val dependableTickets: Set[int] = dependableIn(graph)
  /// The only authoring phase, hence the only
  /// releasable set: a ticket is released from Pending and nowhere else.
  /// Every non-terminal may be revoked.
  val revocableTickets: Set[int] = revocablesIn(graph)
  val readyTickets: Set[int] = readiesIn(graph)
  /// Tickets a completion can be delivered to (real or duplicate).
  val completableTickets: Set[int] = completableIn(graph)
  val reducibleWork: Set[int] = reducibleWorkIn(graph)
  val finalizerTickets: Set[int] = liveTickets.filter(j =>
    tickets.get(j).phase == Finalization)
  val doneTickets: Set[int] = doneIn(graph)
  /// Parked tickets the operator may Retry (retryableIn).
  val retryableEscalated: Set[int] = retryablesIn(graph)

  /// No machine, operator, or author action can move anything. Revoke is
  /// enabled on EVERY non-terminal (table lines 47-48), so a Pending chain
  /// stranded behind a revoked dep is still actionable by its author — the
  /// only true dead end is a
  /// fully-released fleet in which every ticket is settled in a terminal
  /// (Done or Revoked). The `settled` stutter covers exactly that state so
  /// runs never deadlock.
  val quiet: bool = and {
    releasableIds.size() == 0,
    liveTickets.forall(j => Set(Done, Revoked).contains(tickets.get(j).phase))
  }

  // --- init -----------------------------------------------------------------

  /// The fleet starts EMPTY: authoring is the ticket source now —
  /// the static nondet DAG is fully replaced by `release`, which grows
  /// the fleet one Pending at a time through the freshTicket seam (deps still
  /// acyclic by construction: they may only point at already-released,
  /// strictly smaller ids).
  /// The conjuncts are validity conditions on the instantiation: an
  /// instance that admits no well-formed eval program, or no task set, or
  /// no ticket, has NO initial state rather than a degenerate one.
  action init = all {
    N_TASKS >= 1,        // well-formedness: a phase carries a real task set
    N_TICKETS >= 1,         // the release bound must admit at least one ticket
    MAX_STAGES >= 1,     // at least one authorable program must exist
    tickets' = Map(),
    lastStep' = { label: "init", transitions: [], effects: []},
    prevEvaluations' = Map()
  }

  // --- actions --------------------------------------------------------------

  /// A new ticket is released as Pending with a nondeterministic subset of
  /// dependable existing tickets and a well-formed evaluation program. At
  /// most N_TICKETS releases ever happen, which is the only bound on how
  /// many tickets a run holds.
  action releaseTicket = all {
    releasableIds.size() > 0,
    nondet j = releasableIds.oneOf()
    nondet deps_ = dependableTickets.powerset().oneOf()
    nondet prog = validPrograms.oneOf()
    apply(decideReleaseTicket(graph, j, deps_, prog))
  }

  /// Author revokes any non-terminal ticket, and that ticket alone
  /// (decideRevoke).
  action revoke = all {
    revocableTickets.size() > 0,
    nondet j = revocableTickets.oneOf()
    apply(decideRevoke(graph, j))
  }

  /// Ready -> Work: THE AGENTIC SELECTOR'S PICK. The
  /// nondet choice below IS the selector — an agentic component whose
  /// selection among Ready tickets is a real decision, not scheduler noise
  /// (see decideDispatch's header for the full agency note); the recorded
  /// `dispatch` step is its decision event in the golden trace.
  /// Scheduling/quota below the pick stays trusted fabric (no bespoke
  /// scheduler) — no slot count, no queue order, no
  /// fairness.
  action dispatch = all {
    readyTickets.size() > 0,
    nondet j = readyTickets.oneOf()
    apply(decideDispatch(graph, j))
  }

  /// A task-completion event is released for a task the ticket is currently
  /// running, and the report it carries is drawn: produced, judged either
  /// way, or reached no result. One action models all of it because the
  /// fabric is at-least-once — the machine cannot choose to not receive
  /// duplicates — and the DISPOSITION is drawn here too, because the
  /// completion that concludes a failing stage is where it is consulted
  /// (decideTaskDone).
  ///
  /// Duplicate-adversary SCOPE: this action draws from what is live, and
  /// the witness drivers (tests/chuggy_witness_test.qnt) draw from
  /// deliverableTasksIn — every identity the ticket's history names — so
  /// the stale arm is exercised where the shape can be pinned
  /// deterministically. Identities are unique within the ticket and never
  /// reused, so a completion from an earlier stage, generation or cycle
  /// names one nothing is waiting on and no-ops BY IDENTITY. That RETIRES
  /// the weaker absorption argument (a stale completion at the same name was
  /// indistinguishable from a fresh verdict on the respawned set) —
  /// staleness is absorbed structurally, and the only remaining
  /// first-write-wins case is a duplicate delivery for a live task. A stale
  /// TICKET COMPLETION still implies a success occurred, and Done is
  /// absorbing (completionRedelivery). The observed/actual split that would
  /// make mid-rework duplicates dangerous — a decider acting on a stale
  /// VIEW — is exactly the deferred §4 refinement layer (reconcile vs
  /// journaled-actor), not this shared domain layer. A sharper corner: a
  /// ticket revoked OUT of Finalization could race an in-flight merge in
  /// the real system — in-model revokedNeverCompletes holds structurally (a
  /// revoked ticket leaves finalizerTickets, so no wrap-up action can
  /// resolve it, and the revoke frees the slot by phase); the real
  /// revoke/merge race — the candidate already advancing when the revoke
  /// lands — is record-vs-effect atomicity, the §4 refinement layer.
  action taskDone = all {
    completableTickets.size() > 0,
    nondet j = completableTickets.oneOf()
    nondet task = liveTasks(tickets.get(j)).oneOf()
    nondet report = reportChoices(task).oneOf()
    nondet onFailure = dispositionChoices.oneOf()
    apply(decideTaskDone(graph, j, task, report, onFailure))
  }

  action workReduce = all {
    reducibleWork.size() > 0,
    nondet j = reducibleWork.oneOf()
    apply(decideWorkReduce(graph, j))
  }

  /// The external finalizer returns one domain result. Queueing,
  /// approval, permits and implementation are durable operational state.
  action finalizationResult = all {
    finalizerTickets.size() > 0,
    nondet j = finalizerTickets.oneOf()
    nondet out = finalizationOutcomes.oneOf()
    all {
      finalizationOutcomeEnabled(graph, j, out),
      apply(decideFinalizationResult(graph, j, out))
    }
  }

  /// One resume action for every retryable park.
  action resumeTicket = all {
    retryableEscalated.size() > 0,
    nondet j = retryableEscalated.oneOf()
    apply(decideResumeTicket(graph, j))
  }

  /// The dead-end stutter (STUTTER set): keeps quiet states from
  /// deadlocking the simulator.
  action settle = all {
    quiet,
    tickets' = tickets,
    lastStep' = { label: "settled", transitions: [], effects: []},
    prevEvaluations' = currentEvaluations
  }

  action step = any {
    releaseTicket,
    revoke,
    dispatch,
    taskDone,
    workReduce,
    finalizationResult,
    resumeTicket,
    settle
  }

  // ==========================================================================
  // === Invariants ===========================================================
  // ==========================================================================
  // Inside the machine module (Quint 0.32: a separate module cannot see
  // instantiated vars), re-exposed to --main
  // scope through each mc instance's wildcard import.

  /// THE headline property, effect-only: exactly one completion per
  /// cycle, proved at the completion boundary and nowhere else —
  /// any number of task executions may duplicate (at-least-once fabric),
  /// but the completion effect is emitted exactly once per ticket, exactly
  /// when it is Done. "Per cycle" collapses to "per ticket" because a
  /// completion effect ends the ticket (Done is absorbing) and failed
  /// completions emit no completion effect. DELIBERATELY UNCHANGED — per-ticket
  /// exclusivity is strictly stronger than any per-project form (exactly one
  /// completion per ticket implies at most one per ticket per project), so the
  /// A withdrawn extension covered groups — a marked Done ticket
  /// having completed via its lead's completion, emitting nothing of its own.
  /// That extension is WITHDRAWN with the grouping removal, and the
  /// invariant reverts to its plain form: Done iff exactly one completion
  /// effect, with no mark conjunct to carve out.
  val completionExclusive: bool = liveTickets.forall(j => and {
    tickets.get(j).completions <= 1,
    (tickets.get(j).completions == 1) iff (tickets.get(j).phase == Done)
  })

  /// REVOKED NEVER COMPLETES: a revoked ticket
  /// has emitted no completion effect — and never will: Revoked is absorbing
  /// (terminalsAbsorbing), no decider touches a revoked
  /// ticket's `completions`. Post-evaluation phases are deliberately not revocable. Stated as its own named
  /// invariant because it is the model's exclusivity half, though
  /// state-wise it is a corollary of completionExclusive (completions = 1 iff
  /// Done, completions <= 1, Revoked != Done ⇒ completions = 0) — same
  /// stated-corollary treatment as stuckSubsetCovered.
  val revokedNeverCompletes: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Revoked) implies (tickets.get(j).completions == 0))

  /// A COMPLETED TICKET PRODUCED SOMETHING (design 002). Deliberately the
  /// weak form: an artifact exists by the time a ticket is Done. The
  /// tempting stronger claim — that what was committed is what was
  /// evaluated — would be TRUE BY CONSTRUCTION, since the phase machine
  /// forbids work between eval-passed and wrap-up, and an invariant that
  /// cannot fail is the stuckSubsetCovered defect written on purpose.
  /// A Revoked ticket may hold NoArtifact: it may never have run.
  val artifactWellFormed: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Done) implies (tickets.get(j).artifact != NoArtifact))

  /// The absorbing terminals never transition OUT.
  /// Both carry it here, because Revoked is reachable.
  val terminalsAbsorbing: bool =
    lastStep.transitions.foldl(true, (b, t) =>
      b and t.from != Done and t.from != Revoked)

  /// The human desk is consistent: a named wall iff parked. ONE
  /// equivalence now, where there were two: the resume point is derived
  /// (resumeOf, total on the sum), so a wall the desk can read is a
  /// continuation the deciders will take, and there is no second field left
  /// to disagree with the first. (The open-task flag needs no conjunct
  /// either — it is DERIVED from the phase, standing rule 3.) note: Revoked
  /// passes at NoEscalation — "Revoked runs nothing" is this invariant plus
  /// tasksWellFormed doing their existing tickets over the phase.
  val deskConsistent: bool = liveTickets.forall(j =>
    (tickets.get(j).phase == Escalated) iff
      (tickets.get(j).escalation != NoEscalation))

  /// THE LIVE TASK SET is exactly the current phase's anatomy, and after
  /// the evaluation instance arrived that anatomy is small: Work carries the
  /// single work task of the cycle just started, and EVERY OTHER PHASE
  /// CARRIES NOTHING. Evaluation's tasks are not here at all — the current
  /// run owes them and currentTaskObligations names them — so what this
  /// invariant used to hold (one stage, a real index into the program,
  /// exactly the keys that stage lists, nothing settled by a cancellation)
  /// is now the instance's own, through the protocol's stageRunInvariant.
  val tasksWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    if (jb.phase == Work) and {
      jb.tasks.size() == 1,
      jb.tasks.forall(t =>
        t.identity == WorkTask({ ticket: j, cycle: jb.workCyclesStarted }))
    } else jb.tasks == Set())

  /// EVERY INSTANCE IS WELL-FORMED by the protocol's own invariant, which is
  /// the whole of what an evaluation's state has to satisfy — chuggy
  /// re-states none of it. What chuggy adds is the AGREEMENT between an
  /// instance and the ticket carrying it: it judges THIS ticket, under the
  /// program the ticket was released with (so no plan can drift from the
  /// authored data), for a work cycle the ticket has actually started, and
  /// the instances stand in the order those cycles ran — strictly
  /// ascending, so no cycle has two.
  ///
  /// THE PHASE SAYS WHICH INSTANCE IS OPEN: a ticket in Evaluation is
  /// running the last one, at the cycle it is on, and a ticket parked at the
  /// blocked wall has the last one blocked. Those two are what let
  /// currentInstance be read without a search, and what make the desk's wall
  /// and the instance's state one fact instead of two that can disagree.
  /// A ticket that left evaluation keeps the instance as it stood: it is
  /// provenance, exactly as the task log it replaced was.
  val evaluationsWellFormed: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    and {
      jb.evaluations.indices().forall(i =>
        val ev = jb.evaluations[i]
        and {
          invariant(ev),
          ev.input.ticket == j,
          ev.plan == { stages: jb.program },
          ev.workCycle <= jb.workCyclesStarted,
          i == 0 or jb.evaluations[i - 1].workCycle < ev.workCycle
        }),
      (jb.phase == Evaluation) implies and {
        jb.evaluations.length() > 0,
        runningStageIndex(currentInstance(jb)) >= 0,
        currentInstance(jb).workCycle == jb.workCyclesStarted
      },
      (jb.escalation == EvaluationBlockedEscalated) implies and {
        jb.evaluations.length() > 0,
        instanceBlocked(currentInstance(jb))
      }
    })

  /// HISTORY IS APPEND-ONLY: against the previous state (ghost
  /// prevEvaluations), every instance a ticket held is still there and still
  /// says what it said — with one exception, and exactly one: the LAST
  /// instance, while it is still the last, is the open one and advances.
  /// Once a newer instance sits behind it, it is frozen too. So a rewritten
  /// judgement, a dropped instance and a reordered history are each caught
  /// in the step that did it, and "the instances are the ticket's
  /// provenance" is a theorem rather than a convention. (Tickets are never
  /// deleted, so the ghost's domain always survives into liveTickets.)
  val evaluationsMonotone: bool = prevEvaluations.keys().forall(j => and {
    liveTickets.contains(j),
    tickets.get(j).evaluations.length() >= prevEvaluations.get(j).length(),
    prevEvaluations.get(j).indices().forall(i => or {
      tickets.get(j).evaluations[i] == prevEvaluations.get(j)[i],
      and {
        i + 1 == prevEvaluations.get(j).length(),
        tickets.get(j).evaluations.length() == prevEvaluations.get(j).length()
      }
    })
  })

  /// IDENTITY ACCOUNTING: the mint counter is exactly what the ticket's own
  /// history says it must be — one slot per work cycle started, plus, for
  /// every run of every instance, its roster once per generation it reached
  /// (ticket.qnt evaluationSpawnTotal). Every spawn site bumps the counter
  /// from the AUTHORED program while this sum reads the INSTANCES, so the
  /// two sides come from different places: a spawn that claimed the wrong
  /// stage's roster, a resume that claimed nothing, or a cycle counted twice
  /// breaks the equality in the very state that did it.
  ///
  /// It is a SLOT count, not a task count. A resume re-asks only the
  /// evaluators it reopened and still claims the roster, which is what keeps
  /// the counter derivable at all — the subset a resume asked is not
  /// recoverable from the run once those evaluators have answered. The
  /// slots nothing used are gaps, and a gap costs a monotone mint nothing.
  val idsAccounted: bool = liveTickets.forall(j =>
    val jb = tickets.get(j)
    jb.spawned == jb.workCyclesStarted + evaluationSpawnTotal(jb))

  /// THE CONTRACT'S OWN PREDICATE over every task this machine is currently
  /// waiting on (task-contract/task.qnt taskIdentityValid). It is the one
  /// claim the contract makes about an identity, so the machine is held to
  /// it where the identities are minted rather than where they are read: a
  /// spawn that drew a cycle, stage, generation or evaluator from zero would
  /// be caught in the state that spawned it.
  val taskIdentitiesValid: bool = liveTickets.forall(j =>
    tickets.get(j).tasks.forall(t => taskIdentityValid(t.identity)))

  /// PROGRAM WELL-FORMEDNESS: every live ticket carries a well-formed
  /// eval program — non-empty, at most MAX_STAGES stages, each stage keyed
  /// by its own POSITION and listing a non-empty roster of distinct keys in
  /// 1..N_TASKS. Holding in EVERY reachable state is the release-refusal
  /// callers draw from validPrograms) and are never rewritten, so an
  /// ill-formed program is refused at authoring time or never exists.
  ///
  /// The positional stage key is CHUGGY'S rule, not the task contract's,
  /// which asks only that stage keys be distinct: the identity carries the
  /// stage's key, and a layer holding an identity but no program — the
  /// dispatch view's stage column — reads the index back out of the key.
  /// The instance stores the index itself, so nothing HERE needs the rule
  /// any more; it is kept because those layers still do. Evaluator keys are
  /// NOT positional.
  val programsWellFormed: bool = liveTickets.forall(j =>
    val p = tickets.get(j).program
    and {
      p.length() >= 1,
      p.length() <= MAX_STAGES,
      p.indices().forall(i => and {
        p[i].key == i + 1,
        p[i].evaluators.length() >= 1,
        evaluatorKeys(p[i]).size() == p[i].evaluators.length(),
        evaluatorKeys(p[i]).forall(k => k >= 1 and k <= N_TASKS)
      })
    })

  def dependencyClosure(j: int): Set[int] =
    range(1, N_TICKETS + 1).foldl(tickets.get(j).deps, (seen, _) =>
      seen.union(seen.map(d => tickets.get(d).deps).flatten()))

  val depsAcyclic: bool = liveTickets.forall(j => and {
    tickets.get(j).deps.subseteq(liveTickets),
    not(dependencyClosure(j).contains(j))
  })

  /// Identity membership and ticket count are bounded independently.
  val ticketIdsWellFormed: bool = and {
    liveTickets.subseteq(ticketIdUniverse),
    liveTickets.size() <= N_TICKETS
  }

  // --- Visibility -----------------------------------------------------------

  /// THE VISIBILITY EDGES: the walk's edge relation is the DEPENDENCY
  /// edges, and only those. A withdrawn revision added the group's
  /// The walks below are bounded monotone fixpoints over actual keys, so
  /// sparse or numerically reversed edges behave identically.
  def visEdges(j: int): Set[int] = tickets.get(j).deps

  /// Tickets that cannot move without a human: parked on the desk, or
  /// Pending behind a dependency chain containing a parked ticket. A
  /// healthy-Blocked ticket is deliberately NOT stuck — it sits flat while
  /// its deps run, and progresses VICARIOUSLY.
  val stuckSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (st, _) =>
      liveTickets.filter(j => or {
        tickets.get(j).phase == Escalated,
        and {
          tickets.get(j).phase == Pending,
          visEdges(j).exists(d => st.contains(d))
        }
      }))

  /// Tickets reachable from an open human task by walking the visibility
  /// edges: the ticket's own desk task (derived — hasOpenHumanTask), or a
  /// desk task somewhere in its dependency chain.
  ///
  ///  note: Revoked contributes NOTHING here (hasOpenHumanTask excludes
  /// it), and neither does a Pending — its progress is its author's, the
  /// named AUTHORING conditionality. So a ticket left Pending behind a
  /// revoked dep is neither walked here nor walked by stuckSet, and what
  /// moves it is the author who released it.
  /// Coverage propagates through EVERY phase (no phase guard — as before),
  /// over the same edge superset stuckSet walks: stuck ⊆ covered stays a
  /// structural corollary, per sweep.
  val coveredSet: Set[int] =
    range(1, liveTickets.size() + 1).foldl(Set(), (cov, _) =>
      liveTickets.filter(j => or {
        hasOpenHumanTask(tickets.get(j)),
        visEdges(j).exists(d => cov.contains(d))
      }))

  /// THE TWO WALKS AGREE — and that is ALL this says. Renamed from
  /// `deskVisibility` because that name claimed a visibility guarantee
  /// this predicate cannot deliver.
  ///
  /// It is a TAUTOLOGY over the definitions, not a theorem about the
  /// machine. `stuckSet`'s base case is `Escalated`; `coveredSet`'s base
  /// case is `hasOpenHumanTask`, which IS `phase == Escalated` — the same
  /// predicate. Both walk the same `visEdges`, and `stuckSet`'s inductive
  /// arm is `coveredSet`'s plus one conjunct (`Pending`), hence strictly
  /// stronger. So with S and C the two sweep operators: S(X) ⊆ C(X) for
  /// every X, C is monotone, both iterate from Set() for the same number
  /// of sweeps, and stₖ ⊆ covₖ ⟹ stₖ₊₁ = S(stₖ) ⊆ C(stₖ) ⊆ C(covₖ) =
  /// covₖ₊₁. No step of that argument mentions the transition relation:
  /// swap chuggy for any other machine and it still holds. It cannot go
  /// red for any machine, which is exactly why the deadlock absorption
  /// could build sailed past it (the grouping removal's finding).
  ///
  /// KEPT IN `allInvariants` ANYWAY, for what it does guard: the two walks
  /// against EACH OTHER. It goes red if a future edit adds a `stuckSet`
  /// base case that is not a desk phase, puts a phase guard on
  /// `coveredSet`'s inductive arm, or reintroduces an edge kind in one
  /// walk but not the other — which is precisely what the
  /// group edges were, and why that PR had to add them to both. It guards
  /// the definitions; it does not guard the machine.
  ///
  /// The half no state predicate can carry — unbounded WAITING — is
  /// accepted by name under bounds-work-not-waiting.
  val stuckSubsetCovered: bool = stuckSet.subseteq(coveredSet)

  /// THE ANTI-VACUITY WITNESS, not an invariant of the machine: "no
  /// eval stage ever advances". EXPECTED TO BE VIOLATED (the model gate
  /// shows it deterministically by the stage-advance machine trace in
  /// tests/chuggy_witness_test.qnt, plus the demoted pinned-seed probe)
  /// — a reachable
  /// eval-stage-passed step is the machine-level proof that multi-stage
  /// programs actually run stage-by-stage on machine traces, so the green
  /// invariant runs above are checked against traces where the stage
  /// advance edge is exercised, not vacuous (a
  /// fleet that only ever drew single-stage programs would never take the
  /// edge). The unit tests walk the advance deterministically; this pins
  /// it as REACHABLE.
  val stageAdvanceNever: bool =
    not(lastStep.label == "eval-stage-passed")

  /// All safety invariants, for `--invariant=allInvariants`.
  val allInvariants: bool = and {
    completionExclusive,
    revokedNeverCompletes,
    artifactWellFormed,
    terminalsAbsorbing,
    deskConsistent,
    tasksWellFormed,
    evaluationsWellFormed,
    evaluationsMonotone,
    idsAccounted,
    taskIdentitiesValid,
    programsWellFormed,
    depsAcyclic,
    ticketIdsWellFormed,
    stuckSubsetCovered
  }
}
