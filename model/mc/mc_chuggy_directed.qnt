/// A DIRECTED EMITTER for the events a random walk does not reach in a
/// gate's sample budget.
///
/// This is not an instance of the machine and it proves nothing. It is the
/// SAME instance as mc_chuggy — identical consts, named in the module below
/// — under a RESTRICTED step relation: the same machine actions, drawn from
/// the same draw sets, with the derailing ones left out of the roster.
/// Nothing here changes what the machine does on a step it takes. What
/// changes is which steps the sampler is allowed to try.
///
/// WHY IT EXISTS. Some declared events sit at the end of a long,
/// specific chain: a ticket must dispatch, work, evaluate, and reach the
/// finalizer. Under the whole action roster the sampler spends its budget on
/// arrivals, revokes and evaluator walls that end the chain, and the events
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
///   updateDefinition — gateLoopStep's chains run what the release pinned;
///                 updateStep keeps it.
///   refuse      — gateLoopStep draws nothing out of turn; updateStep draws
///                 the update's refusals only (refuseUpdate), which is a
///                 subset of what `refuse` draws.
/// Everything else stays, INCLUDING release and resumeTicket: dropping release would
/// stop the fleet ever filling, and resumeTicket is how a parked ticket rejoins the
/// chain, so both are part of the shape being aimed at rather than noise.
///
/// AN EVENT AIMED AT HERE IS STILL AIMED AT BY AN INVARIANT. The emitter asks
/// quint to refute "this event never occurs" exactly as it does for the
/// untargeted rows; the restriction only makes the refutation findable. The
/// manifest row records the module, the step relation, the seed and the aim,
/// so every golden reproduces from what is written beside it.

module mc_chuggy_directed {
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    MAX_STAGES = 2
  ).* from "../domain"

  /// The consts above are mc_chuggy's, unchanged. `finalizationResult`
  /// appears repeatedly so the sampler reaches the finalizer's own outcomes
  /// rather than spending its draws on the arrivals that precede them.
  /// THE AIM for the partial-resume golden (test/golden/manifest.json). A
  /// resumed event is not enough to name that shape: TicketEvaluationResumed
  /// follows every blocked wall, and what distinguishes this one is the STATE it lands
  /// in — a ticket back in evaluation at a later generation of the stage it
  /// was already judging, still holding an answer an evaluator gave before
  /// the wall, and owing the one that was stopped. Nothing else in the
  /// machine produces that, so refuting "this never happens" is what finds
  /// the trace. It is an observation and not an invariant: mc_chuggy keeps
  /// the roster the invariants are checked over.
  val partialEvaluationResumed: bool =
    tickets.keys().exists(j =>
      match tickets.get(j).state {
        | Evaluation(evaluation) => match evaluation.state {
            | Running(progress) => and {
                progress.stage.generation > 1,
                progress.stage.evaluators.keys().exists(e =>
                  match progress.stage.evaluators.get(e) {
                    | Produced(_) => true
                    | _ => false
                  }),
                progress.stage.evaluators.keys().exists(e =>
                  statusAwaiting(progress.stage.evaluators.get(e)))
              }
            | _ => false
          }
        | _ => false
      })

  /// THE UPDATE'S OWN REFUSALS, drawn where `refuse` draws them and from
  /// nowhere else: a refusal an update meets that a dispatch can meet too —
  /// TicketNotPending — names its command only when no other command is
  /// drawn out of turn.
  val refusedUpdates: Set[TicketCommand] = refusedCommands.filter(command =>
    match command {
      | UpdateTicket(_) => true
      | _ => false
    })

  action refuseUpdate = all {
    refusedUpdates.size() > 0,
    nondet command = refusedUpdates.oneOf()
    take(command, unaskedDisposition)
  }

  /// THE AIM for the stale-update golden: an update written against a
  /// revision another update has since replaced, which is the staleness an
  /// author meets — a revision behind, not one ahead.
  val staleUpdateRefused: bool = match lastStep {
    | Refused(reason) => match reason {
        | TicketRevisionStale(stale) => stale.expected < stale.current
        | _ => false
      }
    | _ => false
  }

  /// THE UPDATE'S STEP RELATION: release, update, dispatch and the fabric's
  /// reports, with only the update's refusals drawn out of turn.
  action updateStep = any {
    releaseTicket,
    updateDefinition,
    dispatch,
    taskDone,
    refuseUpdate,
    settle
  }

  action gateLoopStep = any {
    releaseTicket,
    dispatch,
    taskDone,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    finalizationResult,
    resumeTicket,
    settle
  }
}
