/// The execution-capacity model: what a scheduler allocates, at a grain the
/// ticket machine never sees. Queued work owns no slot; admitted, launching
/// and running work owns one; terminal and cancelled work owns none.
/// Infrastructure attempts are below this grain and therefore cannot allocate
/// a second logical slot.
///
/// SEPARATE FROM TICKET CORE, AND SEVERABLE. Nothing here imports the domain
/// and nothing there imports this. The join is PROVENANCE: a registration
/// names the journal position of the spawn effect that authorized it, which
/// is the key an at-least-once fabric absorbs on. The dependency points one
/// way — a registration knows its journaled cause, and no decision knows a
/// slot.
///
/// IDENTITY IS THE COMPOSITE. A ticket id is project-local and a task id is
/// ticket-local, so the pair names a logical task only underneath its
/// project. This ledger spans projects, so the project is part of the key
/// rather than context a reader supplies; the journal sequence is
/// project-local for the same reason. The item position within a spawn's
/// fan-out is not a field: inside one effect it stands in bijection with the
/// logical task id, and a stored duplicate of a derivable fact is a finding
/// (standing rule 3).
///
/// The account is what a release pinned for allocation, and may be the
/// project or a wider account. It is an entitlement axis and never an
/// identity one, which is why it cannot stand in for the project above.
///
/// WHAT IT DOES NOT DECIDE: which ticket runs next. That is the dispatcher's
/// pick among Ready tickets, priced in gas and journaled as its own decision.
/// Capacity moves when a logical task is placed, never whether a ticket may
/// advance.
///
/// WHAT IS ESTABLISHED HERE is what the examples beside it assert: safety of
/// a state, and the admission and preference predicates over one. There is no
/// state machine and no invariant run yet — registration, entitlement change,
/// cancellation, attempt reconciliation and terminal submission arrive with
/// the actions that move them.
module execution_capacity {
  type ExecutionStatus = Queued | Admitted | Launching | Running | Terminal | Cancelled
  type Entitlement = { reserved: int, maximum: int }

  /// One logical task's registration with the scheduler.
  type Execution = {
    id: int,
    project: int,
    ticket: int,
    task: int,
    account: int,
    sourceSeq: int,
    sourceEffect: int,
    status: ExecutionStatus
  }

  pure def ownsSlot(status: ExecutionStatus): bool = match status {
    | Admitted => true
    | Launching => true
    | Running => true
    | Queued => false
    | Terminal => false
    | Cancelled => false
  }

  pure def activeCount(xs: Set[Execution]): int =
    xs.filter(e => ownsSlot(e.status)).size()

  pure def accountActiveCount(xs: Set[Execution], account: int): int =
    xs.filter(e => e.account == account and ownsSlot(e.status)).size()

  /// One logical task names at most one execution registration. The key is
  /// the composite, so two projects may each run their own ticket 3 / task 1;
  /// a pod or infrastructure attempt never enters this identity space.
  pure def identityUnique(xs: Set[Execution]): bool =
    xs.forall(e =>
      xs.filter(other => and {
        other.project == e.project,
        other.ticket == e.ticket,
        other.task == e.task
      }).size() == 1)

  /// Every registration is traceable to one journaled effect position, read
  /// underneath the project whose journal issued that sequence.
  pure def provenanceWellFormed(xs: Set[Execution]): bool =
    xs.forall(e => e.project > 0 and e.sourceSeq > 0 and e.sourceEffect >= 0)

  /// Terminal and cancelled executions are absorbing; infrastructure may
  /// observe retries inside Launching/Running without creating a model step.
  pure def legalStatusMove(before: ExecutionStatus, after: ExecutionStatus): bool =
    match before {
      | Queued => after == Admitted or after == Cancelled
      | Admitted => after == Launching or after == Terminal or after == Cancelled
      | Launching => after == Running or after == Terminal or after == Cancelled
      | Running => after == Terminal or after == Cancelled
      | Terminal => after == Terminal
      | Cancelled => after == Cancelled
    }

  pure def reservationDeficit(
      entitlements: int -> Entitlement,
      xs: Set[Execution],
      account: int): int =
    val left = entitlements.get(account).reserved - accountActiveCount(xs, account)
    if (left > 0) left else 0

  /// Admission is a scheduler decision over durable logical allocations, not
  /// a reading of Kubernetes pods. A queued execution can borrow only below
  /// its maximum and while the cluster ledger has headroom.
  pure def mayAdmit(
      cluster: int,
      entitlements: int -> Entitlement,
      xs: Set[Execution],
      e: Execution): bool = and {
    e.status == Queued,
    activeCount(xs) < cluster,
    accountActiveCount(xs, e.account) < entitlements.get(e.account).maximum
  }

  /// A positive reservation deficit dominates a borrower with no deficit.
  /// Runtime tie-breakers refine the remaining unrestricted choice.
  pure def preferredOver(
      entitlements: int -> Entitlement,
      xs: Set[Execution],
      left: Execution,
      right: Execution): bool =
    reservationDeficit(entitlements, xs, left.account) > 0 and
      reservationDeficit(entitlements, xs, right.account) == 0

  pure def capacitySafe(
      cluster: int,
      entitlements: int -> Entitlement,
      xs: Set[Execution]): bool = and {
    activeCount(xs) <= cluster,
    identityUnique(xs),
    provenanceWellFormed(xs),
    xs.forall(e => and {
        entitlements.get(e.account).reserved >= 0,
        entitlements.get(e.account).maximum >= entitlements.get(e.account).reserved,
        accountActiveCount(xs, e.account) <= entitlements.get(e.account).maximum
      })
  }
}
