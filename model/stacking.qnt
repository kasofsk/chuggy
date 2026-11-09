/// The finalization queue of ONE reference, under three ticket policies. It is
/// self-contained, and models only the `GitMerge` finalization kind: a mode,
/// an approval and every other kind are absent.
///
/// A tree is the ordered list of (ticket, accepted commit) pairs a reference
/// would hold, so trees compare by equality, a merge result's tree is the
/// history with the candidate appended, and the reference's tip is the history.
///
/// QUEUE. One queue per reference, landing one ticket at a time, in rank order.
/// A ticket takes its rank once, at its first finalization request of a work
/// cycle, and keeps it through a re-check, a re-evaluation and an invalidation:
/// the hold runs from the send-back through the re-check, the re-evaluation and
/// the landing, and nothing ranked later lands ahead of it. A failed evaluation,
/// a rework, an ejection or a landing releases the rank. The holder is the lowest
/// rank, whatever phase it is in. A Direct ticket is in no queue.
///
/// KNOWN LIMIT. An invalidated ticket that has not started evaluating still
/// holds its rank and blocks every ticket behind it, with no timeout.
///
/// SERIALIZED. The holder lands only if its merge result is the tree it
/// evaluated, which is its accepted commit containing the tip; otherwise it is
/// sent back to be re-checked at the same rank. Only a Direct landing moves the
/// tip under it afterwards, so its re-checks are bounded by those.
///
/// STACKED. A Stacked ticket evaluates over the queue ahead of it when every
/// entry ahead is a member of one stack that stands: the holder, which may still be
/// in evaluation, then entries already pending whose own stack stands over the
/// entries before them. An entry still being evaluated that is not the holder is
/// no member. A Serialized entry past the
/// holder is a barrier, because its re-check makes a new accepted commit.
/// Failing that, it evaluates unstacked and behaves as Serialized. Its stack
/// is written when its evaluation starts and never changes; a ticket whose
/// stack stops standing goes back to be evaluated again, which is no rework and keeps its rank.
///
/// DIRECT. A Direct landing moves the tip, so every stack built on the old one
/// stops standing.
///
/// STANDING RULE: DERIVE, DON'T STORE. Whether a stack stands, who holds and
/// the queue order are functions of the state and are stored nowhere.
module stacking {
  type Policy = Direct | Serialized | Stacked
  type Phase = Work | Ready | Evaluation | Failed | Pending | Landed | Ejected
  type Pair = { ticket: int, commit: int }
  type Tree = List[Pair]
  type Stack = { base: Tree, beneath: List[Pair] }
  type Stacking = Unstacked | StackedOn(Stack)
  type Invalidation = InvalidateEvaluation | InvalidateEvaluationFailure
  /// `entry` is zero outside the queue. `commit` counts work reports and
  /// `reworks` the returns to Work, so the two stay in step unless something
  /// that is not a rework sent the ticket back. `expected` is the tree the
  /// evaluation started over.
  type Ticket = {
    policy: Policy, phase: Phase, entry: int, rechecks: int, commit: int,
    stacking: Stacking, expected: Tree, stackFailures: int, reworks: int,
    invalidations: int, landedEntry: int
  }
  /// `landedStep` is how many tickets the latest step landed.
  type State = {
    tickets: int -> Ticket, history: Tree, nextEntry: int,
    landedStep: int, rankKept: bool, invalidated: List[{ ticket: int, kind: Invalidation }]
  }

  /// Configuration: the most tickets beneath a stacked one, and the number of
  /// failed stacked evaluations after which a ticket evaluates unstacked.
  pure val stackDepthMax: int = 3
  pure val stackFailuresMax: int = 2

  pure def initial(policies: int -> Policy): State = {
    tickets: policies.keys().mapBy(i => {
      policy: policies.get(i), phase: Work, entry: 0, rechecks: 0,
      commit: 0, stacking: Unstacked, expected: List(), stackFailures: 0,
      reworks: 0, invalidations: 0, landedEntry: 0 }),
    history: List(), nextEntry: 1, landedStep: 0, rankKept: true, invalidated: List()
  }

  pure def pairOf(s: State, i: int): Pair = { ticket: i, commit: s.tickets.get(i).commit }
  pure def queued(t: Ticket): bool = t.policy != Direct
  pure def ranked(t: Ticket): bool = and {
    queued(t), t.entry > 0, or { t.phase == Work, t.phase == Ready, t.phase == Evaluation, t.phase == Pending } }
  /// The queue is the ranked tickets by rank. A ticket is ranked from its first finalization request of a work cycle until it fails, is ejected or lands; a re-check and an invalidation keep its rank, and a ticket in Work with a rank is the one whose re-check is in flight.
  pure def inQueue(t: Ticket): bool = ranked(t)
  pure def queueKey(t: Ticket, i: int): int = t.entry
  pure def queueSet(s: State): Set[int] = s.tickets.keys().filter(i => inQueue(s.tickets.get(i)))
  pure def queueRank(s: State, i: int): int =
    queueSet(s).filter(j => queueKey(s.tickets.get(j), j) < queueKey(s.tickets.get(i), i)).size()
  pure def queueOrder(s: State): List[int] =
    range(0, queueSet(s).size()).foldl(List(), (acc, r) =>
      acc.append(queueSet(s).filter(j => queueRank(s, j) == r).fold(0, (a, b) => b)))
  /// Zero when nothing holds the reference.
  pure def holder(s: State): int =
    val q = queueOrder(s)
    if (q.length() > 0) q[0] else 0

  pure def landedCount(s: State): int =
    s.tickets.keys().filter(i => s.tickets.get(i).phase == Landed).size()

  /// A stack stands while the history is its base followed by a prefix of its
  /// beneath, and every ticket still beneath is evaluated or pending at the
  /// commit the stack names.
  pure def stands(s: State, r: Stack): bool =
    val n = r.base.length()
    val h = s.history
    val rest = h.slice(n, h.length())
    val remaining = r.beneath.slice(rest.length(), r.beneath.length())
    and {
      h.length() >= n, h.slice(0, n) == r.base,
      rest.length() <= r.beneath.length(),
      rest == r.beneath.slice(0, rest.length()),
      remaining.indices().forall(k => {
        val t = s.tickets.get(remaining[k].ticket)
        and { or { t.phase == Evaluation, t.phase == Pending }, t.commit == remaining[k].commit } })
    }

  /// The tickets ahead of `me`, in queue order.
  pure def ahead(s: State, me: int): List[int] =
    val t = s.tickets.get(me)
    val key = if (inQueue(t)) queueKey(t, me) else 100000
    queueOrder(s).select(j => queueKey(s.tickets.get(j), j) < key)

  /// Whether the entry at position `k` of `line` is a member of a stack
  /// standing over the entries before it.
  pure def memberAt(s: State, line: List[int], k: int): bool =
    val t = s.tickets.get(line[k])
    val before = line.slice(0, k).foldl(List(), (acc, j) => acc.append(pairOf(s, j)))
    and {
      if (k == 0) or { t.phase == Evaluation, t.phase == Pending }
      else match t.stacking {
        | StackedOn(r) => and { t.phase == Pending, t.policy == Stacked, r.beneath == before, stands(s, r) }
        | Unstacked => false
      }
    }

  /// What `me` evaluates over: a stack when it may stack, else nothing.
  pure def stackFor(s: State, me: int): Stacking =
    val t = s.tickets.get(me)
    val line = ahead(s, me)
    if (and { t.policy == Stacked, t.stackFailures < stackFailuresMax, line.length() > 0,
              line.length() <= stackDepthMax, line.indices().forall(k => memberAt(s, line, k)) })
      StackedOn({ base: s.history,
                  beneath: line.foldl(List(), (acc, j) => acc.append(pairOf(s, j))) })
    else Unstacked

  pure def expectedOf(s: State, me: int, st: Stacking): Tree =
    match st {
      | StackedOn(r) => r.base.concat(r.beneath).append(pairOf(s, me))
      | Unstacked => s.history.append(pairOf(s, me))
    }

  /// Sends back every ticket whose stack stopped standing to be evaluated
  /// again. It counts no rework, and is one pass: a stack beneath a ticket
  /// names the same members as the stack of every ticket beneath it.
  pure def sweep(s: State): State =
    val stale = s.tickets.keys().filter(i => {
      val t = s.tickets.get(i)
      match t.stacking {
        | StackedOn(r) => and { or { t.phase == Evaluation, t.phase == Failed, t.phase == Pending }, not(stands(s, r)) }
        | Unstacked => false
      } })
    {
      ...s,
      tickets: s.tickets.keys().mapBy(i =>
        if (stale.contains(i))
          { ...s.tickets.get(i), phase: Ready, stacking: Unstacked,
            invalidations: s.tickets.get(i).invalidations + 1 }
        else s.tickets.get(i)),
      invalidated: stale.fold(s.invalidated, (acc, i) => acc.append({ ticket: i,
        kind: if (s.tickets.get(i).phase == Failed) InvalidateEvaluationFailure else InvalidateEvaluation }))
    }

  /// Every step ends here: it counts the landings and sweeps.
  pure def settle(before: State, after: State): State =
    sweep({ ...after, landedStep: landedCount(after) - landedCount(before),
      rankKept: before.tickets.keys().forall(i => or { not(ranked(before.tickets.get(i))), not(ranked(after.tickets.get(i))),
        before.tickets.get(i).entry == after.tickets.get(i).entry }) })

  pure def withTicket(s: State, i: int, t: Ticket): State = { ...s, tickets: s.tickets.set(i, t) }
  pure def phaseIs(s: State, i: int, p: Phase): bool = s.tickets.get(i).phase == p

  pure def canReport(s: State, i: int): bool = phaseIs(s, i, Work)
  pure def report(s: State, i: int): State =
    val t = s.tickets.get(i)
    settle(s, withTicket(s, i, { ...t, phase: Ready, commit: t.commit + 1 }))

  pure def canStart(s: State, i: int): bool = phaseIs(s, i, Ready)
  pure def start(s: State, i: int): State =
    val t = s.tickets.get(i)
    val st = stackFor(s, i)
    settle(s, withTicket(s, i, { ...t, phase: Evaluation, stacking: st, expected: expectedOf(s, i, st) }))

  pure def canPass(s: State, i: int): bool = phaseIs(s, i, Evaluation)
  pure def passEvaluation(s: State, i: int): State =
    val t = s.tickets.get(i)
    if (queued(t))
      settle(s,
        withTicket({ ...s, nextEntry: s.nextEntry + (if (t.entry > 0) 0 else 1) }, i,
          { ...t, phase: Pending, entry: if (t.entry > 0) t.entry else s.nextEntry }))
    else settle(s, withTicket(s, i, { ...t, phase: Pending }))

  pure def canFail(s: State, i: int): bool = phaseIs(s, i, Evaluation)
  pure def failEvaluation(s: State, i: int): State =
    settle(s, withTicket(s, i, { ...s.tickets.get(i), phase: Failed, entry: 0 }))

  pure def canRework(s: State, i: int): bool = phaseIs(s, i, Failed)
  pure def rework(s: State, i: int): State =
    val t = s.tickets.get(i)
    val stackedFail = match t.stacking { | StackedOn(_) => 1 | Unstacked => 0 }
    settle(s, withTicket(s, i, { ...t, phase: Work, rechecks: 0, stacking: Unstacked, reworks: t.reworks + 1,
                          stackFailures: t.stackFailures + stackedFail }))

  pure def canEject(s: State, i: int): bool =
    not(or { phaseIs(s, i, Landed), phaseIs(s, i, Ejected) })
  pure def eject(s: State, i: int): State =
    settle(s, withTicket(s, i, { ...s.tickets.get(i), phase: Ejected, entry: 0, stacking: Unstacked }))

  /// A Direct ticket lands whenever it is evaluated; a queued one only as holder.
  pure def canLand(s: State, i: int): bool =
    val t = s.tickets.get(i)
    and { t.phase == Pending, or { not(queued(t)), holder(s) == i } }
  pure def mergeTree(s: State, i: int): Tree = s.history.append(pairOf(s, i))
  /// Whether a landing here is a re-check rather than a landing.
  pure def needsRecheck(s: State, i: int): bool =
    and { queued(s.tickets.get(i)), mergeTree(s, i) != s.tickets.get(i).expected }
  pure def land(s: State, i: int): State =
    val t = s.tickets.get(i)
    if (needsRecheck(s, i))
      settle(s, withTicket(s, i, { ...t, phase: Work, rechecks: t.rechecks + 1, stacking: Unstacked,
                            reworks: t.reworks + 1 }))
    else
      settle(s, withTicket({ ...s, history: mergeTree(s, i) }, i, { ...t, phase: Landed, landedEntry: t.entry }))

  // ---- invariants

  pure def landedTickets(s: State): Set[int] = s.tickets.keys().filter(i => phaseIs(s, i, Landed))

  /// Landing is one ticket at a time.
  pure def landsOneAtATime(s: State): bool = s.landedStep <= 1
  /// A queued ticket landed in the order it entered: every queued landing came
  /// before any ticket still pending entered the queue.
  pure def landsInQueueOrder(s: State): bool =
    landedTickets(s).forall(l => or { not(queued(s.tickets.get(l))),
      s.tickets.keys().forall(p => or { not(ranked(s.tickets.get(p))),
        s.tickets.get(l).landedEntry < s.tickets.get(p).entry }) })
  /// ... and along the history, queued landings have increasing entries.
  pure def historyFollowsEntries(s: State): bool =
    s.history.indices().forall(a => s.history.indices().forall(b => or { a >= b,
      or { not(queued(s.tickets.get(s.history[a].ticket))), not(queued(s.tickets.get(s.history[b].ticket))),
        s.tickets.get(s.history[a].ticket).landedEntry < s.tickets.get(s.history[b].ticket).landedEntry } }))
  /// Each landed ticket's tree is the one it was evaluated over, except Direct's own.
  pure def landedAsEvaluated(s: State): bool =
    s.history.indices().forall(k => {
      val t = s.tickets.get(s.history[k].ticket)
      or { t.policy == Direct, s.history.slice(0, k + 1) == t.expected } })
  pure def landedOnce(s: State): bool =
    s.history.indices().forall(k => s.history.indices().forall(m => or { k == m,
      s.history[k].ticket != s.history[m].ticket })) and
    landedTickets(s) == s.history.indices().map(k => s.history[k].ticket)
  /// A live stack stands.
  pure def liveStacksStand(s: State): bool =
    s.tickets.keys().forall(i => match s.tickets.get(i).stacking {
      | StackedOn(r) => or { not(or { phaseIs(s, i, Evaluation), phaseIs(s, i, Failed), phaseIs(s, i, Pending) }), stands(s, r) }
      | Unstacked => true })
  /// A standing stack's base is a prefix of the history it was built on.
  pure def stackBaseIsPrefix(s: State): bool =
    s.tickets.keys().forall(i => match s.tickets.get(i).stacking {
      | StackedOn(r) => and { r.base.length() <= s.history.length(), s.history.slice(0, r.base.length()) == r.base }
      | Unstacked => true })
  /// Only the holder may be a Serialized ticket beneath another.
  pure def serializedOnlyHolderBeneath(s: State): bool =
    s.tickets.keys().forall(i => match s.tickets.get(i).stacking {
      | StackedOn(r) => r.beneath.indices().forall(k => or { k == 0, s.tickets.get(r.beneath[k].ticket).policy != Serialized })
      | Unstacked => true })
  /// Only a Stacked ticket is invalidated, and each invalidation is logged once.
  pure def invalidatedOnlyStacked(s: State): bool =
    s.tickets.keys().forall(i => or { s.tickets.get(i).invalidations == 0, s.tickets.get(i).policy == Stacked }) and
    s.tickets.keys().forall(i => s.invalidated.select(e => e.ticket == i).length() == s.tickets.get(i).invalidations)
  /// An invalidation is no rework: a ticket is in Work only after a rework,
  /// and otherwise has been sent back exactly as often as it has reported again.
  pure def reworksAreReturnsToWork(s: State): bool =
    s.tickets.keys().forall(i => {
      val t = s.tickets.get(i)
      if (t.phase == Ejected) true
      else if (t.phase == Work) t.reworks == t.commit
      else t.reworks == t.commit - 1 })
  /// A ticket at its failure cap holds no stack.
  pure def failureCapHolds(s: State): bool =
    s.tickets.keys().forall(i => match s.tickets.get(i).stacking {
      | StackedOn(_) => s.tickets.get(i).stackFailures < stackFailuresMax
      | Unstacked => true })
  /// A stack is no deeper than the depth.
  pure def depthHolds(s: State): bool =
    s.tickets.keys().forall(i => match s.tickets.get(i).stacking {
      | StackedOn(r) => r.beneath.length() <= stackDepthMax
      | Unstacked => true })

  /// No step moved the rank of a ticket that was ranked before it and after it, and
  /// ranks are unique and issued.
  pure def ranksHold(s: State): bool = and {
    s.rankKept,
    s.tickets.keys().forall(i => or { s.tickets.get(i).entry == 0, s.tickets.get(i).entry < s.nextEntry }),
    s.tickets.keys().forall(i => s.tickets.keys().forall(j => or { i == j, not(ranked(s.tickets.get(i))),
      s.tickets.get(i).entry != s.tickets.get(j).entry })) }

  /// A ticket re-checks once for the tickets that ranked ahead of it, and then only
  /// for a Direct landing: nothing ranked later can land ahead of it.
  pure def recheckBounded(s: State): bool =
    s.tickets.keys().forall(i => s.tickets.get(i).rechecks <= 1 + s.history.indices().filter(k => s.tickets.get(s.history[k].ticket).policy == Direct).size())

  pure def invariants(s: State): bool = and {
    landsOneAtATime(s), landsInQueueOrder(s), historyFollowsEntries(s), landedAsEvaluated(s), landedOnce(s), ranksHold(s), recheckBounded(s),
    liveStacksStand(s), stackBaseIsPrefix(s), serializedOnlyHolderBeneath(s),
    invalidatedOnlyStacked(s), reworksAreReturnsToWork(s), failureCapHolds(s), depthHolds(s)
  }
}
