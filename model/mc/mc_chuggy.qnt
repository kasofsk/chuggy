/// SMALL-SCOPE INSTANCES the randomized runs sample.
///
/// One per pricing branch, so escalation traces exist under both and the
/// choice between them is made on evidence rather than taste; plus a
/// RetryFree instance that keeps the operator-churn exemption in
/// `stepDescends` exercised rather than dead.
///
/// Bounds are the smallest that still reach the shapes worth reaching:
/// MAX_STAGES = 2 so a program can advance rather than only pass, and
/// N_REPOS = 2 so own-repo attribution is distinguishable from a constant
/// stamp. Everything else is as small as it goes — the state space is the
/// budget.
///
/// The wrap-up path needs no const of its own: lease occupancy is a phase,
/// and which resource a ticket needs is authored data. Its nondet surface
/// is two draws — the dequeue's invalidation choice, and the resolution's
/// outcome from what that choice permits.
///
/// Invariants are wired for `--invariant=allInvariants`.

module mc_chuggy_budgeted {
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
}

/// DeadlineOnly gate pricing: a landing failure costs gas alone — the predecessor's
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
    WRAPUP_PRICING = DeadlineOnly,
    OP_RETRY_PRICING = RetryCharged,
    MAX_STAGES = 2,
    N_REPOS = 2
  ).* from "../domain"
}

/// RetryFree metering (the predecessor's the predecessor's findings operator churn, kept as a
/// configuration): allInvariants must still HOLD here — free resumes are
/// exactly the exempted CHURN arm of stepDescends — while the
/// freeClimbNever witness must be VIOLATED (check.sh Stage 9b: the
/// deterministic free-climb machine trace in
/// tests/chuggy_witness_test.qnt — same consts as this instance — proves
/// the exemption is exercised, not dead; the demoted pinned-seed probe
/// reports trace-space health).
/// GAS = 2 keeps escalations frequent so retries are common. The
///  churn bound is exercised here too: a free REvaluating resume
/// respawns the LOWEST stage's fan-out with the full stage digit
/// (measure.qnt CHURN set).
module mc_chuggy_retryfree {
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
}
