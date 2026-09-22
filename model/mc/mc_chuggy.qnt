/// THE SMALL-SCOPE INSTANCE the randomized runs sample.
///
/// Bounds are the smallest that still reach the shapes worth reaching:
/// MAX_STAGES = 2 so a plan can advance rather than only pass, N_TASKS = 2
/// so a stage lists more than one evaluator, N_TICKETS = 3 so a
/// dependency chain can be revoked from underneath. Everything else is as
/// small as it goes — the state space is the budget.
///
/// The wrap-up path needs no const of its own: lease occupancy is a phase,
/// and which resource a ticket needs is authored data. Its nondet surface
/// is two draws — the dequeue's invalidation choice, and the resolution's
/// outcome from what that choice permits.
///
/// Invariants are wired for `--invariant=allInvariants`.

module mc_chuggy {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(
    N_TICKETS = 3,
    N_TASKS = 2,
    MAX_STAGES = 2
  ).* from "../domain"
}
