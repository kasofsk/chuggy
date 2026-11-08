/// Scenarios of the finalization queue on one reference. Each leaves every
/// invariant standing after every step it takes.
module stacking_test {
  import stacking.* from "../stacking"

  var st: State

  action setup(policies: int -> Policy): bool = all { invariants(initial(policies)), st' = initial(policies) }
  action move(after: State): bool = all { invariants(after), st' = after }
  action rep(i: int): bool = all { canReport(st, i), move(report(st, i)) }
  action begin(i: int): bool = all { canStart(st, i), move(start(st, i)) }
  action pass(i: int): bool = all { canPass(st, i), move(passEvaluation(st, i)) }
  action failsAt(i: int): bool = all { canFail(st, i), move(failEvaluation(st, i)) }
  action redo(i: int): bool = all { canRework(st, i), move(rework(st, i)) }
  action ejectIt(i: int): bool = all { canEject(st, i), move(eject(st, i)) }
  action lands(i: int): bool = all { canLand(st, i), move(land(st, i)) }
  /// The work is reported and its evaluation starts and passes.
  action enter(i: int): bool = rep(i).then(begin(i)).then(pass(i))
  action holds(c: bool): bool = all { c, st' = st }

  pure def phaseOf(s: State, i: int): Phase = s.tickets.get(i).phase
  pure def pair(i: int, c: int): Pair = { ticket: i, commit: c }
  pure def beneathOf(s: State, i: int): List[Pair] =
    match s.tickets.get(i).stacking { | StackedOn(r) => r.beneath | Unstacked => List() }
  pure def unstacked(s: State, i: int): bool =
    match s.tickets.get(i).stacking { | StackedOn(_) => false | Unstacked => true }

  run serializedRechecksAfterDirectLandingTest =
    setup(Map(1 -> Direct, 2 -> Serialized))
      .then(enter(2)).then(enter(1)).then(lands(1))
      .then(holds(and { holder(st) == 2, mergeTree(st, 2) != st.tickets.get(2).expected }))
      .then(lands(2))
      .then(holds(and {
        phaseOf(st, 2) == Work, st.tickets.get(2).rechecking, st.tickets.get(2).reworks == 1,
        st.history == List(pair(1, 1)), holder(st) == 2 }))
      .then(enter(2)).then(lands(2))
      .then(holds(and { phaseOf(st, 2) == Landed, st.history == List(pair(1, 1), pair(2, 2)),
                        st.tickets.get(2).expected == st.history }))

  run twoStackedLandInOrderTest =
    setup(Map(1 -> Stacked, 2 -> Stacked))
      .then(enter(1)).then(enter(2))
      .then(holds(and { unstacked(st, 1), beneathOf(st, 2) == List(pair(1, 1)) }))
      .then(holds(not(canLand(st, 2))))
      .then(lands(1)).then(lands(2))
      .then(holds(and { st.history == List(pair(1, 1), pair(2, 1)),
                        st.tickets.get(2).reworks == 0, st.invalidated == List() }))

  run ejectingTheMiddleRestacksTheOneBehindTest =
    setup(Map(1 -> Stacked, 2 -> Stacked, 3 -> Stacked))
      .then(enter(1)).then(enter(2)).then(enter(3))
      .then(holds(beneathOf(st, 3) == List(pair(1, 1), pair(2, 1))))
      .then(ejectIt(2))
      .then(holds(and {
        phaseOf(st, 3) == Ready, phaseOf(st, 1) == Pending, phaseOf(st, 2) == Ejected,
        st.tickets.get(3).invalidations == 1, st.tickets.get(3).reworks == 0,
        st.invalidated == List({ ticket: 3, kind: InvalidateEvaluation }) }))
      .then(begin(3))
      .then(holds(beneathOf(st, 3) == List(pair(1, 1))))
      .then(pass(3)).then(lands(1)).then(lands(3))
      .then(holds(and { st.history == List(pair(1, 1), pair(3, 1)), st.tickets.get(3).reworks == 0 }))

  run directLandingInvalidatesAStackTest =
    setup(Map(1 -> Direct, 2 -> Serialized, 3 -> Stacked))
      .then(enter(2)).then(enter(3))
      .then(holds(beneathOf(st, 3) == List(pair(2, 1))))
      .then(enter(1)).then(lands(1))
      .then(holds(and {
        phaseOf(st, 3) == Ready, unstacked(st, 3), phaseOf(st, 2) == Pending,
        st.tickets.get(3).invalidations == 1, st.tickets.get(3).reworks == 0,
        st.tickets.get(3).stackFailures == 0,
        st.invalidated == List({ ticket: 3, kind: InvalidateEvaluation }) }))

  run directLandingInvalidatesAFailedEvaluationTest =
    setup(Map(1 -> Direct, 2 -> Serialized, 3 -> Stacked))
      .then(enter(2)).then(rep(3)).then(begin(3)).then(failsAt(3))
      .then(enter(1)).then(lands(1))
      .then(holds(and {
        phaseOf(st, 3) == Ready, st.tickets.get(3).reworks == 0,
        st.tickets.get(3).stackFailures == 0,
        st.invalidated == List({ ticket: 3, kind: InvalidateEvaluationFailure }) }))

  run serializedWaiterIsABarrierTest =
    setup(Map(1 -> Stacked, 2 -> Serialized, 3 -> Stacked))
      .then(enter(1)).then(enter(2)).then(enter(3))
      .then(holds(and { unstacked(st, 2), unstacked(st, 3) }))
      .then(lands(1))
      .then(holds(not(canLand(st, 3))))
      .then(lands(2))
      .then(holds(and { phaseOf(st, 2) == Work, holder(st) == 2 }))
      .then(holds(not(canLand(st, 3))))
      .then(enter(2))
      .then(holds(holder(st) == 3))
      .then(lands(3))
      .then(holds(and { phaseOf(st, 3) == Work, st.tickets.get(3).rechecking,
                        st.tickets.get(3).reworks == 1, st.history == List(pair(1, 1)) }))

  run failureCapUnstacksTheNextEvaluationTest =
    setup(Map(1 -> Serialized, 2 -> Stacked))
      .then(enter(1))
      .then(rep(2)).then(begin(2)).then(holds(not(unstacked(st, 2))))
      .then(failsAt(2)).then(redo(2))
      .then(rep(2)).then(begin(2)).then(holds(not(unstacked(st, 2))))
      .then(failsAt(2)).then(redo(2))
      .then(holds(and { st.tickets.get(2).stackFailures == stackFailuresMax, st.tickets.get(2).reworks == 2 }))
      .then(rep(2)).then(begin(2))
      .then(holds(unstacked(st, 2)))
      .then(pass(2)).then(lands(1)).then(lands(2))
      .then(holds(and { phaseOf(st, 2) == Work, st.tickets.get(2).rechecking }))

  run stackDepthIsBoundedTest =
    setup(Map(1 -> Serialized, 2 -> Stacked, 3 -> Stacked, 4 -> Stacked, 5 -> Stacked))
      .then(enter(1)).then(enter(2)).then(enter(3)).then(enter(4)).then(enter(5))
      .then(holds(and {
        beneathOf(st, 4).length() == stackDepthMax, unstacked(st, 5) }))
      .then(lands(1)).then(lands(2)).then(lands(3)).then(lands(4))
      .then(holds(st.history.length() == 4))
      .then(lands(5))
      .then(holds(and { phaseOf(st, 5) == Work, st.tickets.get(5).rechecking }))
}
