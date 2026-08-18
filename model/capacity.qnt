/// The execution-capacity model, deliberately separate from ticket Core.
/// Queued work owns no slot; admitted, launching and running work own one;
/// terminal and cancelled work own none. Infrastructure attempts are below
/// this grain and therefore cannot allocate a second logical slot.

module execution_capacity {
  type ExecutionStatus = Queued | Admitted | Launching | Running | Terminal | Cancelled
  type Entitlement = { reserved: int, maximum: int }
  type Execution = {
    id: int,
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

  /// One logical ticket/task names at most one execution registration. A pod
  /// or infrastructure attempt never enters this identity space.
  pure def identityUnique(xs: Set[Execution]): bool =
    xs.forall(e =>
      xs.filter(other => other.ticket == e.ticket and other.task == e.task).size() == 1)

  /// Every registration is traceable to one journaled effect position.
  pure def provenanceWellFormed(xs: Set[Execution]): bool =
    xs.forall(e => e.sourceSeq > 0 and e.sourceEffect >= 0)

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
