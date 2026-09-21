/// A DIRECTED EMITTER for the labels a random walk does not reach in a
/// gate's sample budget.
///
/// This is not an instance of the machine and it proves nothing. It is the
/// SAME instance as mc_chuggy — identical consts, named in the module below
/// — under a RESTRICTED step relation: the same machine actions, drawn from
/// the same enablement sets, with the derailing ones left out of the roster.
/// Nothing here changes what the machine does on a step it takes. What
/// changes is which steps the sampler is allowed to try.
///
/// WHY IT EXISTS. Some declared step labels sit at the end of a long,
/// specific chain: a ticket must dispatch, work, evaluate, and reach the
/// finalizer. Under the whole action roster the sampler spends its budget on
/// arrivals, revokes and execution blocks that end the chain, and the labels
/// are not reached at a sample budget any gate can afford. They are
/// reachable — the deterministic witness runs in
/// tests/chuggy_witness_test.qnt walk straight to them — so the missing
/// thing is aim, not existence.
///
/// WHY NOT EMIT FROM THOSE WITNESS RUNS INSTEAD. `quint test --out-itf` writes
/// the states but takes no `--mbt`, so the trace carries no `nondetPicks`. A
/// trace without the picks records what happened and not what was chosen, so
/// an implementation replaying it would have to infer each decider's inputs
/// from the state it produced. That inference is the heuristic the corpus
/// exists to avoid. Driving the same shapes through `quint run --mbt` keeps
/// every golden in one format with one reader.
///
/// WHAT IS DROPPED FROM THE ROSTER, and why each is safe to drop here. This
/// module emits; the instance in mc_chuggy.qnt is what the invariants are
/// checked over, and it keeps the full roster.
///   revoke      — ends a ticket's life, and the chain needs it alive.
///   executionBlocked   — parks the ticket before it ever reaches the
///               finalizer.
/// Everything else stays, INCLUDING release and resumeTicket: dropping release would
/// stop the fleet ever filling, and resumeTicket is how a parked ticket rejoins the
/// chain, so both are part of the shape being aimed at rather than noise.
///
/// A LABEL AIMED AT HERE IS STILL AIMED AT BY AN INVARIANT. The emitter asks
/// quint to refute "this label never occurs" exactly as it does for the
/// untargeted rows; the restriction only makes the refutation findable. The
/// manifest row records the module, the step relation, the seed and the aim,
/// so every golden reproduces from what is written beside it.

module mc_chuggy_directed {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    MAX_STAGES = 2
  ).* from "../domain"

  /// The consts above are mc_chuggy's, unchanged. `finalizationResult`
  /// appears repeatedly so the sampler reaches the finalizer's own outcomes
  /// rather than spending its draws on the arrivals that precede them.
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
