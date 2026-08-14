/// Small-scope instances of chuggy_domain for simulation: one per
/// GatePricing branch (charter §2 gate-pricing row: parameterize and decide
/// on evidence — the model must generate traces under BOTH prices), plus a
/// RetryFree instance so the operator-churn exemption in stepDescends is
/// exercised by a machine run, not just by pure unit tests.
///
/// PR 2: every instance runs the AUTHORING actions — the fleet starts
/// empty and tickets arrive as Drafts, with N_TICKETS read as the ARRIVAL BOUND
/// (kept small so the grown state space stays small: arrivals and revoke
/// multiply the branching).
///
/// PR 3: every instance runs WITH PROGRAMS ENABLED — MAX_STAGES = 2, so
/// arrivals draw nondet from ALL well-formed eval programs (both lengths,
/// both combinators, every fan-out in 1..N_TASKS: 20 programs at these
/// bounds; each stage carries its own combinator — eval is data on the
/// ticket, and the charter's unanimous default is domain.qnt defaultProgram,
/// one of the drawn programs). All three instances must keep
/// `allInvariants` green — including the PR 3 additions recordWellFormed,
/// recordMonotone, and programsWellFormed — while the budgeted instance
/// also feeds Stage 9b's second and third expected-violation runs
/// (cascadeParkNever, the cascade-reachability probe, and
/// stageAdvanceNever, the stage-advance-reachability probe).
///
/// NOTES-RECONCILIATION PR (docs/chuggy-notes-triage.md): the same three
/// instances, reshaped consts — REWORK_POLICY = RWBudget(n) (the rework
/// bound as a policy parameter, GatePricing pattern) and GAS (the renamed
/// required account). The action surface shrank (no freeze/unfreeze, no
/// separate stalled-retry — the pre-work resume is an operator-retry
/// flavor), so the Stage 9b probe seeds were re-examined against the new
/// nondet structure (forensics in scripts/check.sh).
///
/// CITATIONS PR: every instance runs WITH CITATIONS ENABLED —
///
/// MULTI-REPO PR (roadmap PR 4): every instance runs WITH REPOS ENABLED —
/// N_REPOS = 2, the smallest universe where per-repo attribution is
/// distinguishable from global attribution. Arrivals draw the ticket's
/// target repo (a third authored nondet draw) and every landing attempt
/// draws the environment's per-attempt branchMoved choice, with the
/// outcome drawn from landOutcomes(moved) — LandFailed drawable only on a
/// moved branch. allInvariants gained landingIsolation,
/// quietRepoLandsCleanly, and reposWellFormed. The two new draws changed
/// the simulator's nondet structure YET AGAIN — every 9b-RND seed
/// re-examined; forensics in scripts/check.sh (warn-only since the
/// witness-hardening PR: the deterministic layer, including the new
/// multi-repo witness module, is the gate).
///
/// MERGE-QUEUE + LANDING PR (roadmap PR 5): every instance runs WITH THE
/// GATE ENABLED — no new const (occupancy is a phase). The nondet surface
/// changed AGAIN: the old `land` action (one draw of moved + one of
/// outcome) became `gateEnter` (dequeue: a moved draw whose quiet arm
/// fast-paths SquashMerge in one step and whose moved arm opens the gate)
/// + `gateResolve` (the gated draw from landOutcomes(true) = AdvanceDefault
/// or Failed). allInvariants gained gatedPromotesDirectSquashes and
/// gateDepthOne; landingExclusive and landingIsolation were extended in
/// place (the path iff). Every 9b-RND seed was re-examined once more —
/// forensics in scripts/check.sh (warn-only: the deterministic layer is
/// the gate).
///
/// THE GROUPING REMOVAL: that PR's group half (PBatched, the marks, the
/// absorb action, batchWellFormed, the fan-out) is gone — the instances
/// draw no absorb pair, so the nondet surface narrowed once more.
///
/// Imports are not re-exported by the chuggy_domain instance, so each
/// module pulls the vocabulary (constructors used in --invariant
/// expressions and in the instantiation itself) from chuggy_measure
/// directly — same structure as v1's mc_small.

/// Budgeted gate pricing: a landing failure costs 1 gate budget AND 1 gas;
/// the gate wall (gate_budget_exhausted) is reachable.
module mc_chuggy_budgeted {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    GATE_PRICING = Budgeted(1),
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"
}

/// DeadlineOnly gate pricing: a landing failure costs gas alone — v1's
/// unbudgeted gate loop, metered only by the (required) gas account.
/// (The branch keeps its charter §2 name, DeadlineOnly, from before the
/// gas rename; it means gas-only.)
module mc_chuggy_deadline_only {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 3,
    GATE_PRICING = DeadlineOnly,
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"
}

/// RetryFree metering (v1's model-status §5b operator churn, kept as a
/// configuration): allInvariants must still HOLD here — free resumes are
/// exactly the exempted CHURN arm of stepDescends — while the
/// freeClimbNever witness must be VIOLATED (check.sh Stage 9b: the
/// deterministic free-climb machine trace in
/// tests/chuggy_witness_test.qnt — same consts as this instance — proves
/// the exemption is exercised, not dead; the demoted pinned-seed probe
/// reports trace-space health).
/// GAS = 2 keeps escalations frequent so retries are common. The
/// PR 3 churn bound is exercised here too: a free REvaluating resume
/// respawns the LOWEST stage's fan-out with the full stage digit
/// (measure.qnt CHURN set).
module mc_chuggy_retryfree {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 2,
    REWORK_POLICY = RWBudget(1),
    GAS = 2,
    GATE_PRICING = DeadlineOnly,
    OP_RETRY_PRICING = RetryFree,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"
}
