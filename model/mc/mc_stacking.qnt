/// The finalization queue over the tickets of `ticketIds`, each of any policy, driven by
/// every step the machine takes. The invariants are `stacking.invariants`.
module mc_stacking {
  import stacking.* from "../stacking"

  pure val ticketIds: Set[int] = Set(1, 2, 3, 4, 5)
  pure val policies: Set[Policy] = Set(Direct, Serialized, Stacked)

  var queue: State

  action init = all {
    nondet p1 = policies.oneOf()
    nondet p2 = policies.oneOf()
    nondet p3 = policies.oneOf()
    nondet p4 = policies.oneOf()
    nondet p5 = policies.oneOf()
    queue' = initial(Map(1 -> p1, 2 -> p2, 3 -> p3, 4 -> p4, 5 -> p5))
  }
  action reportWork = nondet i = ticketIds.oneOf()
    all { canReport(queue, i), queue' = report(queue, i) }
  action startEvaluation = nondet i = ticketIds.oneOf()
    all { canStart(queue, i), queue' = start(queue, i) }
  action evaluationPasses = nondet i = ticketIds.oneOf()
    all { canPass(queue, i), queue' = passEvaluation(queue, i) }
  action evaluationFails = nondet i = ticketIds.oneOf()
    all { canFail(queue, i), queue' = failEvaluation(queue, i) }
  action reworkFailed = nondet i = ticketIds.oneOf()
    all { canRework(queue, i), queue' = rework(queue, i) }
  /// At most one ticket is ejected, so runs reach deep stacks and many landings.
  action ejectTicket = nondet i = ticketIds.oneOf()
    all { canEject(queue, i), queue.tickets.keys().forall(j => queue.tickets.get(j).phase != Ejected), queue' = eject(queue, i) }
  action landTicket = nondet i = ticketIds.oneOf()
    all { canLand(queue, i), queue' = land(queue, i) }
  action step = any {
    reportWork, startEvaluation, evaluationPasses, evaluationFails,
    reworkFailed, ejectTicket, landTicket
  }

  val allInvariants: bool = invariants(queue)
}
