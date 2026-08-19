/// DIRECTED EMITTERS for the labels a random walk cannot reach.
///
/// These are not instances of the machine and they prove nothing. Each is the
/// SAME instance as its sibling in mc_chuggy.qnt — identical consts, named in
/// the module below — under a RESTRICTED step relation: the same machine
/// actions, drawn from the same enablement sets, with the derailing ones left
/// out of the roster. Nothing here changes what the machine does on a step it
/// takes. What changes is which steps the sampler is allowed to try.
///
/// WHY THEY EXIST. Three declared step labels sit at the end of a long,
/// specific chain: a ticket must dispatch, work, evaluate, reach the gate,
/// fail there, and do it again until an account empties. Under the whole
/// action roster the sampler spends its budget on arrivals, revokes
/// and revalidation failures that end the chain, and the labels are not
/// reached at a sample budget any gate can afford. They are reachable — the
/// deterministic witness runs in tests/chuggy_witness_test.qnt walk straight
/// to them — so the missing thing is aim, not existence.
///
/// WHY NOT EMIT FROM THOSE WITNESS RUNS INSTEAD. `quint test --out-itf` writes
/// the states but takes no `--mbt`, so the trace carries no `nondetPicks`. A
/// trace without the picks records what happened and not what was chosen, so
/// an implementation replaying it would have to infer each decider's inputs
/// from the state it produced. That inference is the heuristic the corpus
/// exists to avoid. Driving the same shapes through `quint run --mbt` keeps
/// every golden in one format with one reader.
///
/// WHAT IS DROPPED FROM THE ROSTER, and why each is safe to drop here. These
/// modules emit; the three instances in mc_chuggy.qnt are what the invariants
/// are checked over, and they keep the full roster.
///   revoke      — ends a ticket's life, and the chain needs it alive.
///   executionBlocked   — parks the ticket before it ever reaches the gate.
///   completionRedelivery
///               — only fires after a completion, which is the chain's end.
/// Everything else stays, INCLUDING release and resumeTicket: dropping release would
/// stop the fleet ever filling, and resumeTicket is how a parked ticket rejoins the
/// chain, so both are part of the shape being aimed at rather than noise.
///
/// A LABEL AIMED AT HERE IS STILL AIMED AT BY AN INVARIANT. The emitter asks
/// quint to refute "this label never occurs" exactly as it does for the
/// untargeted rows; the restriction only makes the refutation findable. The
/// manifest row records the module, the step relation, the seed and the aim,
/// so every golden reproduces from what is written beside it.

module mc_chuggy_directed_deadline {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = BudgetedRework(1),
    GAS = 3,
    FINALIZATION_PRICING = DeadlineOnly,
     MAX_STAGES = 2
  ).* from "../domain"

  /// The consts above are mc_chuggy_deadline_only's, unchanged. Under
  /// DeadlineOnly a gate failure costs gas and nothing else, so the gate loop
  /// is what empties the gas account and reaches gas_exhausted.
  action gateLoopStep = any {
    releaseTicket,
    dispatch,
    taskDone,
    workReduce,
    evalReduce,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    resumeTicket,
    settle
  }
}

module mc_chuggy_directed_budgeted {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    REWORK_POLICY = BudgetedRework(1),
    GAS = 3,
    FINALIZATION_PRICING = Budgeted(1),
     MAX_STAGES = 2
  ).* from "../domain"

  /// The consts above are mc_chuggy_budgeted's, unchanged. Under Budgeted the
  /// gate loop spends finalizationLeft alongside gas, so this is where
  /// wrapup_budget_exhausted lives and where the rework budget can be spent
  /// out without the gas account emptying first.
  action gateLoopStep = any {
    releaseTicket,
    dispatch,
    taskDone,
    workReduce,
    evalReduce,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    resumeTicket,
    settle
  }
}

module mc_chuggy_directed_retryfree {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(
    N_TICKETS = 2,
    N_TASKS = 2,
    REWORK_POLICY = BudgetedRework(1),
    GAS = 2,
    FINALIZATION_PRICING = DeadlineOnly,
     MAX_STAGES = 2
  ).* from "../domain"

  /// The consts above are mc_chuggy_retryfree's, unchanged. The arm this
  /// module exists to reach is the PIPELINE resume — a park at Evaluating or
  /// Finalizer, resumed for nothing — which needs the ticket to reach an
  /// eval-branch or gate-branch wall first.
  action gateLoopStep = any {
    releaseTicket,
    dispatch,
    taskDone,
    workReduce,
    evalReduce,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    resumeTicket,
    settle
  }
}
