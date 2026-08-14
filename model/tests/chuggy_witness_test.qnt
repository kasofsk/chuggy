/// DETERMINISTIC REACHABILITY WITNESSES — the
/// LOAD-BEARING layer of the model gate's two-layer witness policy.
///
/// WHY THIS FILE EXISTS: Stage 9b's four expected-violation probes
/// (freeClimbNever / cascadeParkNever / stageAdvanceNever)
/// were pinned-seed random runs, and every PR that changes the machine's
/// nondet structure kills the seeds was the FOURTH
/// consecutive re-pin of the freeClimbNever seed, each dragging a paired
/// allInvariants run that had to move in lock-step. Seeds prove trace-SPACE
/// facts; the four shapes are trace facts, and a trace fact deserves a
/// deterministic trace. Each module below builds the witnessed shape as an
/// explicit machine trace that no nondet drift can touch: the run proves
/// the shape REACHABLE, asserts the witness verdict AT the witnessing step
/// (violated exactly where the shape fires, holding where it must not),
/// and asserts `allInvariants` after EVERY step — which folds in the old
/// paired allInvariants pins (green invariants ON a trace known to contain
/// the shape; the sign-flip catcher), so those two pinned twins are
/// subsumed and removed from Stage 9. The random probes survive in Stage
/// 9b as a demoted bonus layer (trace-space health, warn-only).
///
/// MECHANISM (chosen by experiment; documented honestly): `quint test`
/// cannot force the machine's own nondet actions — their `oneOf` picks
/// belong to the simulator — but it CAN drive the machine deterministically
/// through the conformance pattern:
/// `init.then(apply(decide*(core, <explicit choice>)))`. What upgrades
/// these from decider chains (tests/chuggy_test.qnt's grain) to MACHINE
/// traces is the driver actions in each module: every driver conjoins the
/// corresponding machine action's ENABLEMENT GUARD — evaluated in the
/// pre-state; a violated guard disables the step and fails the run — with
/// `apply` of the decider at named choices, and additionally asserts the
/// choice lies within the set the machine action draws from
/// (deps ⊆ dependableTickets, prog ∈ validPrograms, tid in
/// the delivery range). Each driver is therefore the machine action with
/// its nondet picks named, so every trace these runs accept is a trace of
/// `step` — reachability is proved against the real transition relation,
/// not a loosened one. The fallback mechanism (per-witness restricted mc
/// modules run via --invariant) was not needed. Seeds appear nowhere.
///
/// GUARD DISCIPLINE (review finding m6): every driver conjunct REFERENCES
/// a definition the machine action itself reads — an enablement val
/// (canArrive, draftTickets, revocableTickets, taskPhaseTickets,
/// reducibleWork, reducibleEval, wrapUpTickets, doneTickets,
/// retryableEscalated, readyTickets), a shared pure guard
/// (dispatchableIn), or a shared draw-set definition (deliverableTaskIds,
/// dependableTickets, validPrograms). NONE is a copied
/// expression: a copied guard drifts silently — strengthen the machine's
/// and the stale copy keeps these runs' "machine trace" claim alive while
/// the machine refuses the step. dispatchableIn and deliverableTaskIds are
/// hoisted into domain.qnt and consumed by both sides. Audit rule for
/// future drivers: if a conjunct cannot be written as a reference to a
/// definition the machine action reads, hoist first.
///
/// These runs also discharge stepDescends' NORMATIVE CONVENTION
/// (domain.qnt): no exemption arm without a deterministic witness run
/// that fires it — the roster at stepDescends maps every arm (CHURN,
/// AUTHORING, and the STUTTER labels) to its run/step in this file.
///
/// One module per instance (Quint 0.32: a run must assign every var in its
/// module, so instances cannot share a module); each module's consts are
/// byte-identical to the mc/mc_chuggy.qnt instance the random layer samples,
/// so the deterministic trace speaks about the same machine. The model
/// gate runs all EIGHT via `quint test --main=<module>`; `just chuggy`
/// mirrors. (The count was stale at seven between the grouping removal,
/// which deleted the batch module, and the accepted-wait module below.)
///
/// New nondet extends THIS layer first, per its own
/// convention: the machine's two NEW nondet draws — the authored repo pick
/// at arrival and the environment's per-attempt invalidated choice at the
/// landing — each get deterministic runs exercising BOTH branches
/// (chuggy_witness_multirepo_test: the choice pinned MOVED with the gate
/// rework and the landing wall attributed; pinned QUIET with the landing
/// succeeding; and the repo pick exercised off-default with a cross-repo
/// dep chain unblocking). The existing four modules updated mechanically:
/// arrivals author repo 1, and every landing driver names its invalidated
/// choice with the outcome guarded by the machine's own wrapUpOutcomes draw
/// rule (a quiet failure is not drawable — the drivers reference the same
/// definition the landing actions draw from, per the guard discipline
/// above). The fifth module has NO paired random probe: its shapes are
/// exercised by every unseeded allInvariants run (landing attempts are
/// dense — unlike the carry), so the deterministic runs alone carry the
/// gate.
///
/// THE WRAP-UP extends this layer first,
/// per the convention: the wrap-up surface is staged (rather than one-step
/// `land` became the dequeue `wrapUpStart` — quiet arm fast-pathing the
/// direct completion, moved arm opening the depth-1 gate — plus the gated
/// `wrapUpResolve` drawing from wrapUpOutcomes(true)), so every landing driver
/// here became the doDequeue/doGateResolve pair, referencing
/// wrapUpStartableIn / holdingTickets / wrapUpOutcomes — and, per the
/// adversarial review's MAJOR 1, doDequeue applies the HOISTED routing
/// decider decideDequeue rather than re-composing the quiet/moved route
/// inline (a copied route drifts exactly like a copied guard: the p3
/// mutant re-routed quiet into the lease and shipped green against the
/// drivers' copy; decideDequeue's header has the story). Nothing copied.
/// Three NEW modules carry the PR's witness half:
///   - chuggy_witness_gate_test (budgeted consts): DEPTH-1 EXCLUSIVITY as
///     a guard-refusal pinned mid-trace (the second same-repo ticket's
///     dequeue REFUSED while the slot is held, enabled again the step the
///     slot frees) and BOTH success effects on one machine trace — the
///     held WOk, then the direct completion (the path rule, R3,
///     witnessed) — plus the QUIET FAST-PATH as its
///     own witnessed run (direct-path reachability pinned against the
///     hoisted routing decider, the p3-mutant catcher);
///   - chuggy_witness_gate_deadline_test (deadline-only consts): the
///     eviction priced on the OTHER WrapUpPricing branch — two gate
///     failures metered by gas alone (wrapUpLeft identically 0) into the
///     gas wall — the documented gate-loop shape reproduced on this
///     machine, with the deadline backstop doing exactly its job (R5);
/// (A ninth module, chuggy_witness_batch_test, witnessed the group half;
/// the grouping removal deleted the machinery and this module with it.)
/// Like the multi-repo module, none has a paired random probe: landing
/// attempts are dense in random exploration; the unseeded Stage 9 runs are
/// the random side.

/// SHAPE 1 — THE FREE CLIMB (freeClimbNever, mc_chuggy_retryfree consts).
/// A ticket burns both accounts down to gas 0, parks on the desk from a
/// pipeline phase (rework_budget_exhausted at Evaluating), and the operator
/// resumes it FREE under RetryFree — retryable at zero gas only because the
/// resume charges nothing — with the measure CLIMBING on the resume step.
/// That step must violate freeClimbNever (the climb is real) while
/// allInvariants HOLDS on it (stepDescends' RetryFree CHURN arm exempts
/// exactly this step — the arm a sign-flip would break, which is what the
/// removed pinned twin existed to catch and this run now catches
/// deterministically). The module's SECOND run walks the OTHER free
/// resume — the pre-work RPending flavor, the `t.to == PPending` CHURN
/// arm's own witness (see its header) — and the first run also fires the
/// task-done-duplicate STUTTER arm en route (the stepDescends convention
/// roster).
module chuggy_witness_free_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 2,
    WRAPUP_PRICING = DeadlineOnly,
    OP_RETRY_PRICING = RetryFree,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (see the file header: machine actions with
  // --- their nondet picks named; guards checked in the pre-state) --------
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }
  action doOpRetry(j: int): bool = all {
    retryableEscalated.contains(j),
    apply(decideOpRetry(core, j))
  }
  action doRevalFail(j: int): bool = all {
    readyTickets.contains(j),
    apply(decideRevalFail(core, j))
  }

  /// Single-stage single-evaluator program: the shape needs escalation
  /// economics, not staging (the stage witness owns staging).
  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run freeClimbDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))
      .expect(and { tickets.get(1).phase == PDraft, allInvariants })
      .then(doRelease(1))
      .expect(and { tickets.get(1).phase == PPending, allInvariants })
      // gas 2 -> 1; the single work set spawns (ids 1, 2: width N_TASKS).
      .then(doDispatch(1))
      .expect(and { tickets.get(1).gasLeft == 1, allInvariants })
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      // At-least-once: the SAME task's completion re-delivers — with a
      // DIFFERENT verdict and citation, which first-write-wins discards
      // whole. State-identical no-op: the task-done-duplicate STUTTER
      // arm of stepDescends fired on a machine trace (the convention
      // roster at stepDescends).
      .then(doTaskDone(1, 1, VFail))
      .expect(and {
        lastStep.label == "task-done-duplicate",
        currentMeasure == prevMeasure,
        allInvariants
      })
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      // Work passes: first-time stage-0 entry, eval task 3 spawns running.
      .then(doWorkReduce(1))
      .expect(and {
        lastStep.label == "work-passed",
        tickets.get(1).phase == PEvaluating,
        allInvariants
      })
      .then(doTaskDone(1, 3, VFail))
      .expect(allInvariants)
      // The short-circuit buys the one budgeted rework: rework 1 -> 0 AND
      // gas 1 -> 0 — both accounts empty from here on.
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "rework-started eval_failure",
        tickets.get(1).reworkLeft == 0,
        tickets.get(1).gasLeft == 0,
        allInvariants
      })
      .then(doTaskDone(1, 4, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 5, VPass))
      .expect(allInvariants)
      // Re-entry respawns the failed evaluator (task 6; nothing carries —
      // the failing evaluator always respawns, and the silent work
      .then(doWorkReduce(1))
      .expect(and { lastStep.label == "work-passed", allInvariants })
      .then(doTaskDone(1, 6, VFail))
      .expect(allInvariants)
      // The stage fails with the rework account empty: park on the desk
      // FROM A PIPELINE PHASE at gas 0, resume point REvaluating.
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "ticket-escalated rework_budget_exhausted",
        tickets.get(1).phase == PEscalated,
        tickets.get(1).resumeAt == REvaluating,
        tickets.get(1).gasLeft == 0,
        // Retryable AT ZERO GAS — only because RetryFree prices the
        // pipeline resume at 0 (under RetryCharged this ticket would be
        // parked for good: charge 1 > gas 0).
        retryableEscalated.contains(1),
        allInvariants
      })
      // THE WITNESSED STEP: the free resume climbs back into Evaluating
      // (fresh lowest-stage fan-out, task 7) charging nothing.
      .then(doOpRetry(1))
      .expect(and {
        lastStep.label == "operator-retry",
        lastStep.transitions == [{ ticket: 1, from: PEscalated, to: PEvaluating }],
        tickets.get(1).gasLeft == 0,                  // free: still zero
        currentMeasure > prevMeasure,                 // the climb is real
        not(freeClimbNever),                          // the witness fires HERE
        // ... and allInvariants still holds ON the climbing step: this is
        // stepDescends' RetryFree CHURN arm exempting the climb — the
        // conjunct that catches a sign-flip in that arm (the removed
        // pinned twin's whole job, now deterministic).
        allInvariants
      })

  /// The PRE-WORK park and its FREE resume — the `t.to == PPending` CHURN
  /// arm's deterministic witness (the stepDescends convention roster):
  /// Ready -> revalidation park -> operator resume back to Pending
  /// charging NOTHING under BOTH meterings, measure climbing, with
  /// allInvariants holding on the climb (the RPending arm exempting) and
  /// freeClimbNever NOT firing — the witness's deliberate exclusion of
  /// the pre-work resume, pinned at machine level. NOTE on zero gas: this
  /// flavor's affordability at gasLeft 0 (resumeCharge 0 <= 0) is pinned
  /// by the pure unit test preWorkResumeFreeAtZeroGasTest and is NOT
  /// machine-reachable — nothing pre-work ever spends and the only road
  /// back to Pending is this resume itself, so a revalidation park always
  /// carries the full grant; the machine-trace facts are gasLeft == GAS
  /// on BOTH sides of the resume (parked spending nothing, resumed
  /// charging nothing). The dispatch step after it pins the other half of
  /// the pricing story: the Working boundary still meters the actual
  /// re-entry (standing rule 2).
  run preWorkResumeClimbDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doRelease(1))
      .expect(and { isReady(1), allInvariants })
      // The world shifts under the ticket before it ever runs: the
      // pre-work park — Escalated with the pre-work reason and resume.
      .then(doRevalFail(1))
      .expect(and {
        lastStep.label == "ticket-escalated revalidation_failed",
        tickets.get(1).phase == PEscalated,
        tickets.get(1).reason == RsRevalidationFailed,
        tickets.get(1).resumeAt == RPending,
        tickets.get(1).gasLeft == GAS,      // the park spent NOTHING
        retryableEscalated.contains(1),     // always retryable: charge 0
        allInvariants
      })
      // THE WITNESSED STEP: the free pre-work resume climbs back to
      // Pending (rank 0 -> 4) charging nothing.
      .then(doOpRetry(1))
      .expect(and {
        lastStep.label == "operator-retry",
        lastStep.transitions == [{ ticket: 1, from: PEscalated, to: PPending }],
        tickets.get(1).gasLeft == GAS,      // still uncharged: the resume is free
        currentMeasure > prevMeasure,       // the climb is real
        freeClimbNever,                     // ...but NOT the pipeline witness's shape
        allInvariants                       // the RPending CHURN arm exempts it
      })
      // The Working boundary still meters the actual re-entry.
      .then(doDispatch(1))
      .expect(and {
        tickets.get(1).gasLeft == GAS - 1,
        currentMeasure < prevMeasure,
        allInvariants
      })
}

/// SHAPE 2 — THE CASCADE PARK (cascadeParkNever, mc_chuggy_budgeted
/// consts). A revoke whose TRANSITIVE pre-flight dependents get parked
/// Escalated/dependency_revoked in the same decision: 1 <- 2 <- 3 with 2
/// released (PPending) and 3 still a Draft, so ONE revoke parks both
/// pre-flight phases in one atomic StepRecord — the machine-level shape
/// cascadeSafety's green runs need to be non-vacuous. The follow-up
/// desk-only revoke pins the wall's one modeled exit (and the AUTHORING
/// flat member: no park, no descent required).
module chuggy_witness_cascade_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (file header; only the ones this shape uses).
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doRevoke(j: int): bool = all {
    revocableTickets.contains(j),
    apply(decideRevoke(core, j))
  }

  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run cascadeParkDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))            // ticket 1
      .expect(allInvariants)
      .then(doArrive(Set(1), progFlat1, 1))           // ticket 2 depends on 1
      .expect(allInvariants)
      // Release 2: PPending, blocked behind the unreleased Draft 1 — one
      // dependent will be parked from EACH pre-flight phase.
      .then(doRelease(2))
      .expect(and { isBlocked(2), allInvariants })
      .then(doArrive(Set(2), progFlat1, 1))           // ticket 3: TRANSITIVE dependent of 1
      .expect(and { not(tickets.get(3).deps.contains(1)), allInvariants })
      // THE WITNESSED STEP: revoking 1 parks BOTH dependents atomically —
      // 2 out of PPending, 3 out of PDraft (3 never named 1 as a dep: the
      // cascade walked the transitive closure).
      .then(doRevoke(1))
      .expect(and {
        lastStep.label == "ticket-revoked",
        lastStep.transitions == [
          { ticket: 1, from: PDraft, to: PRevoked },
          { ticket: 2, from: PPending, to: PEscalated },
          { ticket: 3, from: PDraft, to: PEscalated }
        ],
        lastStep.effects == ["Revoke", "OpenHumanTask", "OpenHumanTask"],
        not(cascadeParkNever),                     // the witness fires HERE
        tickets.get(2).reason == RsDependencyRevoked,
        tickets.get(3).reason == RsDependencyRevoked,
        // The wall stamps no resume: revoke is its only modeled exit.
        tickets.get(2).resumeAt == RNone,
        retryableEscalated == Set(),
        // allInvariants ON the parked state: cascadeSafety checked with
        // revokeDoomed = {2, 3} genuinely nonempty — non-vacuous by
        // construction.
        allInvariants
      })
      // The desk settles a parked dependent by revoking it: the DESK-ONLY
      // revoke — one transition, no park (3 is already settled parked, not
      // pre-flight), cascadeParkNever HOLDS here.
      .then(doRevoke(2))
      .expect(and {
        lastStep.label == "ticket-revoked",
        lastStep.transitions == [{ ticket: 2, from: PEscalated, to: PRevoked }],
        cascadeParkNever,                          // ... and does NOT fire here
        allInvariants
      })
}

/// SHAPE 3 — THE STAGE ADVANCE (stageAdvanceNever, mc_chuggy_budgeted
/// consts). A 2-stage program's stage-0 unanimous pass advancing to stage
/// 1: the eval-stage-passed Evaluating -> Evaluating edge — the interpreter's advance and the measure's
/// stage digit exercised on a machine trace, then run through to Done so
/// the staged program's whole lifecycle closes.
module chuggy_witness_stage_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (file header; only the ones this shape uses).
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }
  action doDequeue(j: int, moved: bool): bool = all {
    wrapUpStartableIn(core, j),
    apply(decideDequeue(core, j, moved))
  }
  action doGateResolve(j: int, out: WrapUpOutcome): bool = all {
    holdingTickets.contains(j),
    wrapUpOutcomes(true).contains(out),
    apply(decideWrapUpResolve(core, j, out, true))
  }
  action doLandDuplicate(j: int): bool = all {
    doneTickets.contains(j),
    apply(decideCompleteDuplicate(core, j))
  }

  /// Two stages: a width-2 unanimous stage 0 (the pass must be UNANIMOUS
  /// to advance) into a width-1 stage 1.
  pure val progStaged: List[Stage] =
    [{ fanout: 2, combinator: CUnanimousPass },
     { fanout: 1, combinator: CUnanimousPass }]

  run stageAdvanceDeterministicTest =
    init
      .then(doArrive(Set(), progStaged, 1))
      .expect(and { tickets.get(1).program.length() == 2, allInvariants })
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))                         // gas 3 -> 2; work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      // Stage 0 spawns: ids 3, 4 (the program's declared width 2).
      .then(doWorkReduce(1))
      .expect(and {
        lastStep.label == "work-passed",
        evalStage(tickets.get(1).tasks) == 0,
        tickets.get(1).tasks.size() == 2,
        allInvariants
      })
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 4, VPass))
      .expect(allInvariants)
      // THE WITNESSED STEP: stage 0 passes UNANIMOUSLY with a later stage
      // remaining — the interpreter advances, Evaluating -> Evaluating,
      // spawning stage 1's fan-out (id 5). No measure exemption: the stage
      // digit's -1 dominates the spawn (allInvariants carries
      // measureDescends through the advance).
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "eval-stage-passed",
        lastStep.transitions == [{ ticket: 1, from: PEvaluating, to: PEvaluating }],
        lastStep.effects == ["SpawnEvalTasks"],
        not(stageAdvanceNever),                    // the witness fires HERE
        evalStage(tickets.get(1).tasks) == 1,
        tickets.get(1).tasks.size() == 1,
        currentMeasure < prevMeasure,
        allInvariants
      })
      .then(doTaskDone(1, 5, VPass))
      .expect(allInvariants)
      // The FINAL stage passes: no advance this time (the program passed).
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "eval-passed",
        stageAdvanceNever,                         // ... and does NOT fire here
        tickets.get(1).phase == PWrapUp,
        allInvariants
      })
      // The dequeue draws QUIET: the skip fast-path — gate never opened,
      // the direct squash resolves the landing in one step (the path
      // rule's quiet arm; the held arm is the lease module's).
      .then(doDequeue(1, false))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        tickets.get(1).completions == 1,
        allInvariants
      })
      // At-least-once: a stale landing success re-delivers after Done —
      // absorbed with NO landing effect (completionExclusive's boundary; the
      // land-duplicate STUTTER arm of stepDescends fired on a machine
      // trace — the convention roster).
      .then(doLandDuplicate(1))
      .expect(and {
        lastStep.label == "complete-duplicate",
        lastStep.effects == [],
        tickets.get(1).completions == 1,
        currentMeasure == prevMeasure,
        allInvariants
      })
}

/// SHAPE 5 — THE MULTI-REPO ISOLATION SHAPES (mc_chuggy_budgeted consts
/// + N_REPOS = 2). Three runs, one per branch of the repo nondet surface:
///   - QUIET: a repo-2 ticket (the repo pick exercised off-default) whose
///     landing attempt the environment chose quiet — the landing MUST
///     succeed (wrapUpOutcomes refuses a quiet failure) and the ticket-done
///     step carries the quiet attribution. This run is the trace-pinned
///     half of quietRepoLandsCleanly (the invariant's header is explicit
///     about the split: per-attempt implication as the state theorem,
///     THIS trace as the pinned-quiet reading).
///   - MOVED: the same lifecycle whose attempts the environment chose
///     moved — the wrap-up rework AND, on the second failure, the
///     gate-budget wall each carry {repo, invalidated: true}: the rework
///     is attributed to the repo whose branch moved, and to nothing else.
///   - CROSS-REPO DEP: a repo-2 ticket dependent on a repo-1 ticket —
///     blocked while the dep is unlanded, READY the moment repo 1's
///     landing makes it Done (the dep gate read Done-ness, not location),
///     then landing cleanly itself; repo 1's success is drawn under a
///     MOVED branch, pinning at machine level that a move makes failure
///     possible, never certain. Each landing resolution is attributed to
///     its own repo in one trace with both repos live.
/// allInvariants — now carrying wrapUpIsolation, quietRepoLandsCleanly,
/// and reposWellFormed — is asserted after EVERY step of all three runs.
/// NO paired random probe (file header): landing attempts are dense in
/// random exploration, so the unseeded Stage 9 runs cover the random side;
/// these deterministic traces alone are the lease.
module chuggy_witness_multirepo_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (file header; only the ones these shapes use).
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }
  action doDequeue(j: int, moved: bool): bool = all {
    wrapUpStartableIn(core, j),
    apply(decideDequeue(core, j, moved))
  }
  action doGateResolve(j: int, out: WrapUpOutcome): bool = all {
    holdingTickets.contains(j),
    wrapUpOutcomes(true).contains(out),
    apply(decideWrapUpResolve(core, j, out, true))
  }

  /// Single-stage single-evaluator program: these shapes need the landing
  /// boundary, not staging (the stage witness owns staging).
  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  /// THE QUIET LANDING: the environment chooses the target repo's branch
  /// quiet for the attempt — the landing succeeds, attributed. (A quiet
  /// FAILURE is not merely unobserved here: doLand's wrapUpOutcomes guard —
  /// the machine's own draw rule — makes the step undrivable, so this run
  /// also documents the refusal structurally.)
  run quietLandDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 2))         // the ticket targets repo 2
      .expect(and { tickets.get(1).repo == 2, allInvariants })
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))                         // gas 3 -> 2; work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // stage 0 spawns: eval id 3
      .expect(and { lastStep.label == "work-passed", allInvariants })
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // THE WITNESSED STEP: the attempt's invalidated choice is QUIET —
      // the dequeue fast-paths (the lease is never taken), the landing
      // succeeds, and the step is attributed to the ticket's own repo
      // with the quiet cause on record.
      .then(doDequeue(1, false))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        lastStep.landing == WOAttempt({ repo: 2, invalidated: false }),
        tickets.get(1).completions == 1,
        quietRepoLandsCleanly,                     // the state theorem, on the pinned-quiet step
        allInvariants
      })

  /// THE MOVED REWORK, ATTRIBUTED: the environment chooses the branch
  /// MOVED at both attempts — the first failure buys the Budgeted gate
  /// rework, the second parks at the gate-budget wall, and BOTH steps
  /// carry {repo: 1, invalidated: true}: a landing failed only via its
  /// own repo's branch moving, and the trace says so each time.
  run movedReworkAttributedTest =
    init
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))                         // gas 3 -> 2; work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // stage 0 spawns: eval id 3
      .expect(allInvariants)
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // The branch MOVED at the dequeue: the lease is taken and holds repo
      // 1's depth-1 slot.
      .then(doDequeue(1, true))
      .expect(and {
        lastStep.label == "wrapup-started",
        tickets.get(1).phase == PWrapUpHolding,
        not(leaseFreeIn(core, 1)),
        allInvariants
      })
      // THE WITNESSED STEP (rework half): the lease failed — Budgeted(1)
      // buys one wrap-up rework (gate 1 -> 0, gas 2 -> 1; work ids 4, 5),
      // the step carries the attribution, and the slot frees by phase.
      .then(doGateResolve(1, WFailed))
      .expect(and {
        lastStep.label == "rework-started wrapup_failure",
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).wrapUpLeft == 0,
        tickets.get(1).gasLeft == 1,
        leaseFreeIn(core, 1),
        allInvariants
      })
      .then(doTaskDone(1, 4, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 5, VPass))
      .expect(allInvariants)
      // Silent citations: the eval re-entry respawns in full (id 6).
      .then(doWorkReduce(1))
      .expect(and { lastStep.label == "work-passed", allInvariants })
      .then(doTaskDone(1, 6, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // The branch moved AGAIN at the re-dequeue: the lease re-opens...
      .then(doDequeue(1, true))
      .expect(and { tickets.get(1).phase == PWrapUpHolding, allInvariants })
      // THE WITNESSED STEP (wall half): ...and fails with the gate
      // account empty — the ticket parks at the gate-budget wall, and the
      // PARKING step is attributed like the rework was.
      .then(doGateResolve(1, WFailed))
      .expect(and {
        lastStep.label == "ticket-escalated wrapup_budget_exhausted",
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).phase == PEscalated,
        tickets.get(1).reason == RsWrapUpBudgetExhausted,
        tickets.get(1).resumeAt == RWrapUp,
        allInvariants
      })

  /// THE CROSS-REPO DEP CHAIN: ticket 1 targets repo 1, ticket 2 targets
  /// repo 2 and depends on 1 — the dep gate is LOCATION-BLIND: 2 is
  /// Blocked exactly while 1 is not Done, and repo 1's landing unblocks
  /// it with the repos never consulted. Repo 1's success is drawn under
  /// a MOVED branch (failure is possible there, not certain); repo 2
  /// lands quiet. One trace, both repos, each landing attributed to its
  /// own.
  run crossRepoDepDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))         // ticket 1 -> repo 1
      .expect(allInvariants)
      .then(doArrive(Set(1), progFlat1, 2))        // ticket 2 -> repo 2, dep CROSSES repos
      .expect(and {
        tickets.get(2).repo == 2,
        tickets.get(2).deps == Set(1),
        allInvariants
      })
      .then(doRelease(2))
      .expect(and { isBlocked(2), allInvariants }) // blocked behind the Draft dep
      .then(doRelease(1))
      .expect(and {
        isReady(1),
        isBlocked(2),                              // still blocked: dep released, not Done
        allInvariants
      })
      .then(doDispatch(1))                         // gas 3 -> 2; ticket 1 work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))
      .expect(allInvariants)
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // The branch moved: repo 1's gate opens for the candidate.
      .then(doDequeue(1, true))
      .expect(and { tickets.get(1).phase == PWrapUpHolding, allInvariants })
      // THE WITNESSED STEP: repo 1 lands out of the lease (moved branch,
      // clean integration anyway — the move makes failure possible, not
      // certain; the held promotion is WOk, the path rule)
      // and the repo-2 dependent derives READY in the same post-state:
      // the cross-repo unblock, no machinery, no repo consulted.
      .then(doGateResolve(1, WOk))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).phase == PDone,
        isReady(2),                                // THE cross-repo unblock
        allInvariants
      })
      .then(doDispatch(2))                         // ticket 2's own ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(2, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(2, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(2))
      .expect(allInvariants)
      .then(doTaskDone(2, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(2))
      .expect(allInvariants)
      // The dependent lands in ITS repo, quiet (the fast-path direct
      // squash), attributed to repo 2 — two repos, two completions, each on
      // its own record.
      .then(doDequeue(2, false))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.landing == WOAttempt({ repo: 2, invalidated: false }),
        tickets.get(2).phase == PDone,
        tickets.get(1).completions == 1,
        tickets.get(2).completions == 1,
        allInvariants
      })
}

/// SHAPE 6 — THE EXCLUSIVE LEASE (R3/R4; mc_chuggy_budgeted
/// consts). Two same-repo tickets both enqueue; the first dequeue draws
/// MOVED and takes the lease — and the second ticket's dequeue is
/// REFUSED BY GUARD while the slot is held (wrapUpStartableIn false: the
/// depth-1 exclusivity as a pinned guard-refusal, not just an invariant
/// over states that happened to occur). The occupant resolves as the GATED
/// promotion (WOk — the default ref advanced onto the validated
/// candidate), the slot frees BY PHASE in the same step, and the second
/// ticket dequeues QUIET into the fast-path direct squash (WOk) —
/// BOTH success effects distinguished on one machine trace, each from its
/// own path: the divergence as a theorem, witnessed. The SECOND run is
/// the QUIET FAST-PATH as its own named
/// witnessed shape — direct-path reachability through decideDequeue's
/// valid artifact on a solo trace where the lease NEVER opens: the
/// deterministic catcher for a routing mutant (quiet re-routed into the
/// gate), which the pre-hoisting inline composition let ship green
/// through every layer because the drivers carried a copy of the route.
module chuggy_witness_gate_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (file header; only the ones this shape uses).
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }
  action doDequeue(j: int, moved: bool): bool = all {
    wrapUpStartableIn(core, j),
    apply(decideDequeue(core, j, moved))
  }
  action doGateResolve(j: int, out: WrapUpOutcome): bool = all {
    holdingTickets.contains(j),
    wrapUpOutcomes(true).contains(out),
    apply(decideWrapUpResolve(core, j, out, true))
  }

  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run leaseExclusiveDeterministicTest =
    init
      // Two same-repo tickets, walked to the landing queue one after the
      // other (each: dispatch gas 3 -> 2, work ids 1-2, eval id 3).
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doRelease(2))
      .expect(allInvariants)
      .then(doDispatch(1))
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))
      .expect(allInvariants)
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      .then(doDispatch(2))
      .expect(allInvariants)
      .then(doTaskDone(2, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(2, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(2))
      .expect(allInvariants)
      .then(doTaskDone(2, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(2))
      .expect(and {
        // Both enqueued, the lease free: EITHER may dequeue (order is
        // deliberately unmodeled — the nondet pick).
        wrapUpTickets == Set(1, 2),
        wrapUpStartableIn(core, 1),
        wrapUpStartableIn(core, 2),
        allInvariants
      })
      // Ticket 1 dequeues MOVED: the lease is taken and holds repo 1's slot.
      .then(doDequeue(1, true))
      .expect(and {
        lastStep.label == "wrapup-started",
        tickets.get(1).phase == PWrapUpHolding,
        // THE WITNESSED REFUSAL (R4): while the slot is held, the second
        // same-repo ticket CANNOT draw the dequeue — including its
        // would-be-quiet fast-path (quietness is only checked AT the
        // dequeue: each dequeued job re-checks the fast-path). A
        // doDequeue(2, _) here would disable the run.
        not(wrapUpStartableIn(core, 2)),
        wrapUpStartable == Set(),
        not(leaseFreeIn(core, 1)),
        allInvariants                          // carries leaseExclusive
      })
      // THE GATED PROMOTION (R3, one half): the validated candidate
      // advances the default ref — and the slot frees by phase, so the
      // refusal lifts in the same post-state.
      .then(doGateResolve(1, WOk))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).completions == 1,
        leaseFreeIn(core, 1),
        wrapUpStartableIn(core, 2),                // the queue moves on
        allInvariants
      })
      // THE FAST-PATH (R3, the other half): ticket 2 dequeues QUIET —
      // the lease is skipped and the direct squash lands in one step.
      // Both success effects now stand on this one trace, each from its
      // own path.
      .then(doDequeue(2, false))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        lastStep.landing == WOAttempt({ repo: 1, invalidated: false }),
        tickets.get(2).completions == 1,
        allInvariants
      })

  /// THE QUIET FAST-PATH, witnessed as its own shape (adversarial review,
  /// MAJOR 1 — direct-path reachability pinned against the ROUTING rule):
  /// a solo ticket walked to the queue and dequeued QUIET resolves its
  /// landing IN THE DEQUEUE STEP — ticket-done, the direct squash, quiet
  /// attribution, and the lease NEVER opens anywhere on the trace. A
  /// decideDequeue mutant that re-routed quiet into the lease (the
  /// review's p3, which the pre-hoisting composition let ship green)
  /// leaves the ticket PWrapUpHolding at the witnessed step and fails every
  /// conjunct below; the driver references decideDequeue itself, so there
  /// is no copy of the route left to drift.
  run quietFastPathDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))                         // gas 3 -> 2; work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // eval id 3
      .expect(allInvariants)
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "eval-passed",
        tickets.get(1).phase == PWrapUp,
        leaseFreeIn(core, 1),
        allInvariants
      })
      // THE WITNESSED STEP: valid-artifact dequeue = same-step landing.
      .then(doDequeue(1, false))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.effects == ["Complete"],
        lastStep.landing == WOAttempt({ repo: 1, invalidated: false }),
        lastStep.transitions == [{ ticket: 1, from: PWrapUp, to: PDone }],
        tickets.get(1).phase == PDone,
        tickets.get(1).completions == 1,
        leaseFreeIn(core, 1),                       // the lease was never taken
        allInvariants
      })
}

/// SHAPE 7 — THE DEADLINE-ONLY EVICTION (R5;
/// mc_chuggy_deadline_only consts). The OTHER WrapUpPricing branch on a
/// machine trace: two wrap-up failures metered by GAS ALONE (wrapUpLeft
/// identically 0 — no gate account exists to spend) into the gas wall at
/// the third — the documented gate-loop shape reproduced on this machine,
/// with the required gas account doing exactly the backstop job it must:
/// without it the day never ends, and the queue behind the spinning ticket
/// starves. Each
/// eviction is attributed {repo, invalidated: true}, and the final wall
/// parks with resumeAt RWrapUp — re-ENQUEUE, not re-gate — unretryable
/// at zero gas under RetryCharged (the permanently-parked corner, honest).
module chuggy_witness_gate_deadline_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = DeadlineOnly,
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"

  // --- Deterministic drivers (file header; only the ones this shape uses).
  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }
  action doDequeue(j: int, moved: bool): bool = all {
    wrapUpStartableIn(core, j),
    apply(decideDequeue(core, j, moved))
  }
  action doGateResolve(j: int, out: WrapUpOutcome): bool = all {
    holdingTickets.contains(j),
    wrapUpOutcomes(true).contains(out),
    apply(decideWrapUpResolve(core, j, out, true))
  }

  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run gateEvictionDeadlineOnlyDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))
      .expect(allInvariants)
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))                         // gas 3 -> 2; work ids 1, 2
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // eval id 3
      .expect(allInvariants)
      .then(doTaskDone(1, 3, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // Gate failure #1: gas alone pays (2 -> 1); no gate account exists.
      .then(doDequeue(1, true))
      .expect(and { tickets.get(1).phase == PWrapUpHolding, allInvariants })
      .then(doGateResolve(1, WFailed))
      .expect(and {
        lastStep.label == "rework-started wrapup_failure",
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).wrapUpLeft == 0,              // identically zero: DeadlineOnly
        tickets.get(1).gasLeft == 1,
        allInvariants
      })
      .then(doTaskDone(1, 4, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 5, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // eval id 6
      .expect(allInvariants)
      .then(doTaskDone(1, 6, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // Gate failure #2: the loop spins on gas (1 -> 0).
      .then(doDequeue(1, true))
      .expect(allInvariants)
      .then(doGateResolve(1, WFailed))
      .expect(and {
        lastStep.label == "rework-started wrapup_failure",
        tickets.get(1).wrapUpLeft == 0,
        tickets.get(1).gasLeft == 0,
        allInvariants
      })
      .then(doTaskDone(1, 7, VPass))
      .expect(allInvariants)
      .then(doTaskDone(1, 8, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))                       // eval id 9
      .expect(allInvariants)
      .then(doTaskDone(1, 9, VPass))
      .expect(allInvariants)
      .then(doEvalReduce(1))
      .expect(and { lastStep.label == "eval-passed", allInvariants })
      // Gate failure #3, gas empty: THE BACKSTOP — the DeadlineOnly wall
      // parks the ticket instead of spinning forever (R5: no free loop,
      // never silently).
      .then(doDequeue(1, true))
      .expect(allInvariants)
      .then(doGateResolve(1, WFailed))
      .expect(and {
        lastStep.label == "ticket-escalated gas_exhausted",
        lastStep.landing == WOAttempt({ repo: 1, invalidated: true }),
        tickets.get(1).phase == PEscalated,
        tickets.get(1).reason == RsGasExhausted,
        tickets.get(1).resumeAt == RWrapUp,       // resume re-ENQUEUES
        // Charging resume at zero gas: parked for good under RetryCharged
        // (the honest corner — a human funds nothing by pressing Retry).
        retryableEscalated == Set(),
        leaseFreeIn(core, 1),                       // the wall freed the slot
        allInvariants
      })
}

/// THE ACCEPTED WAIT, PINNED (2026-08-14, davemo88) — the odd module out:
/// every other run here witnesses something the machine GUARANTEES; this
/// one witnesses something it deliberately DOES NOT, so the acceptance is
/// a thing the suite holds rather than a paragraph the next reader has to
/// re-derive.
///
/// The shape: ticket 1 arrives as a Draft and the author never releases
/// it; ticket 2 deps on it and IS released. Ticket 2 can now be moved by
/// NO machine action — only by an author (release 1, or revoke either).
/// It holds no desk task, and nothing in its dep chain holds one, so it is
/// in neither `stuckSet` nor `coveredSet` and `stuckSubsetCovered` passes
/// VACUOUSLY over it. That is bounds-work-not-waiting made concrete: the
/// ticket is not churning, it is waiting, and waiting is unbounded by
/// decision.
///
/// It also pins the OTHER half — that the accepted class is not swept up
/// by the deadlock net. `noStructuralDeadlock` stays GREEN here, because a
/// continuation exists (the author may still release 1). Should a future
/// edit make this state flag, that edit has changed the accepted position,
/// not merely tightened an invariant.
module chuggy_witness_draft_wait_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 1,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 1,
    N_REPOS = 1
  ).* from "../domain"

  action doArrive(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    apply(decideArrive(core, deps_, prog, repo_, WExclusive(repo_)))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }

  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run draftWaitAcceptedDeterministicTest =
    init
      .then(doArrive(Set(), progFlat1, 1))          // 1: the Draft, never released
      .expect(allInvariants)
      .then(doArrive(Set(1), progFlat1, 1))         // 2: deps on it
      .expect(allInvariants)
      .then(doRelease(2))
      .expect(and {
        // 2 is released and blocked behind an authoring-side dep.
        tickets.get(2).phase == PPending,
        isBlocked(2),
        tickets.get(1).phase == PDraft,
        // No MACHINE action can move it: not dispatchable, no task set to
        // reduce, not enqueued, not retryable. Only an author can.
        not(readyTickets.contains(2)),
        not(dispatchableIn(core, 2)),
        reducibleWork == Set(),
        reducibleEval == Set(),
        wrapUpTickets == Set(),
        retryableEscalated == Set(),
        // THE ACCEPTANCE: invisible to the desk walks, both empty, so the
        // containment holds over nothing at all.
        stuckSet == Set(),
        coveredSet == Set(),
        stuckSubsetCovered,
        // AND NOT a structural deadlock: a continuation exists.
        canFinishSet == Set(1, 2),
        noStructuralDeadlock,
        allInvariants
      })
}

/// THE WRAP-UP-LESS COMPLETION (design 002) — a ticket whose effect already
/// happened during work, so evaluation passing IS its completion. A deploy,
/// a report: nothing to merge, no branch worth landing, and no lease to take.
///
/// It pins the route AND the bug the route arrived with. The first version
/// completed the ticket off the LIVE core rather than the retired one, so a
/// Done ticket kept its eval tasks — completeTicket does not retire a set,
/// because on the lease path the set is already retired when the ticket
/// enqueues, and skipping the wrap-up phases skipped that too. The random
/// layer found it at roughly one run in fourteen; the empty-task-set
/// conjunct below is what makes it a one-line failure instead.
module chuggy_witness_wrapup_none_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 1,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    WRAPUP_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 1,
    N_REPOS = 1
  ).* from "../domain"

  action doArriveNone(deps_: Set[int], prog: List[Stage], repo_: int): bool = all {
    canArrive,
    deps_.subseteq(dependableTickets),
    validPrograms.contains(prog),
    repos.contains(repo_),
    wrapUpChoices.contains(WNone),
    apply(decideArrive(core, deps_, prog, repo_, WNone))
  }
  action doRelease(j: int): bool = all {
    draftTickets.contains(j),
    apply(decideRelease(core, j))
  }
  action doDispatch(j: int): bool = all {
    readyTickets.contains(j),
    dispatchableIn(core, j),
    apply(decideDispatch(core, j))
  }
  action doTaskDone(j: int, tid: int, v: Verdict): bool = all {
    taskPhaseTickets.contains(j),
    deliverableTaskIds(core, j).contains(tid),
    apply(decideTaskDone(core, j, tid, v))
  }
  action doWorkReduce(j: int): bool = all {
    reducibleWork.contains(j),
    apply(decideWorkReduce(core, j))
  }
  action doEvalReduce(j: int): bool = all {
    reducibleEval.contains(j),
    apply(decideEvalStageReduce(core, j))
  }

  pure val progFlat1: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  run wrapUpNoneCompletesDeterministicTest =
    init
      .then(doArriveNone(Set(), progFlat1, 1))
      .expect(and { tickets.get(1).wrapUp == WNone, allInvariants })
      .then(doRelease(1))
      .expect(allInvariants)
      .then(doDispatch(1))
      .expect(allInvariants)
      .then(doTaskDone(1, 1, VPass))
      .expect(allInvariants)
      .then(doWorkReduce(1))
      .expect(and {
        lastStep.label == "work-passed",
        tickets.get(1).phase == PEvaluating,
        // Work stamped what it produced; the deploy's release identity.
        tickets.get(1).artifact != ANone,
        allInvariants
      })
      .then(doTaskDone(1, 2, VPass))
      .expect(allInvariants)
      // THE WITNESSED STEP: evaluation passing completes it outright. No
      // enqueue, no lease, no wrap-up phase entered at all.
      .then(doEvalReduce(1))
      .expect(and {
        lastStep.label == "ticket-done",
        lastStep.transitions == [{ ticket: 1, from: PEvaluating, to: PDone }],
        lastStep.effects == ["Complete"],
        // It resolved no wrap-up attempt, so it carries no attribution —
        // the completeness arm of wrapUpIsolation permits exactly this.
        lastStep.landing == WONone,
        tickets.get(1).phase == PDone,
        tickets.get(1).completions == 1,
        // THE REGRESSION PIN: the eval set was retired on the way through.
        tickets.get(1).tasks == Set(),
        tickets.get(1).record.length() == 2,
        // It never held, and never wanted, a lease.
        holdingTickets == Set(),
        wrapUpTickets == Set(),
        allInvariants
      })
}
