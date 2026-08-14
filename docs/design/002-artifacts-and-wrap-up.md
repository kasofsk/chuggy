# What a ticket produces, and what is done with it

**Status: PROPOSED** — argued, not built. No slice has landed.

## The two questions, which turn out to be one

**What crosses a phase boundary?** Nothing does. `decideWorkReduce` on success retires the work set and calls `spawnOn(retired, TKEval(0), fan)`; the eval-failure arm calls `spawnOn(retired, TKWork, N_TASKS)`. Fresh tasks, no payload, either way. A `Ticket` carries `phase deps repo program tasks record spawned reason landings` — **there is no artifact**. The thing work produces, eval judges and landing lands does not exist as a value anywhere in the model.

**What happens at the end?** Exactly one thing: a merge. The only path to `PDone` is `landSuccess`, reachable only from `PLanding` or `PGated`, and the outcome vocabulary is `LandAdvanceDefault | LandSquashMerge | LandFailed` — all merge verbs. Every ticket merges.

These are the same question, and — the point of this document — **answering the first is what lets us delete most of the machinery behind the second.**

## The central claim: the artifact pays for the simplification

R1 is the model's headline requirement: *no commit reaches the default branch without every required evaluator passing against the exact tree that lands.*

The model proves it **by proxy**, as an argument about paths. On a quiet branch the evaluated tree *is* the landing tree; on a moved branch only the gate-validated candidate may land. Everything merge-shaped in the domain exists to make that path argument work:

| Machinery | Exists to |
|---|---|
| `branchMoved`, the per-attempt draw | distinguish the two paths |
| `landOutcomes(moved)` | make the wrong outcome undrawable on each path |
| `LandAdvanceDefault` vs `LandSquashMerge` | name which promotion each path uses |
| `gatedPromotesDirectSquashes` | check the effect matches the path |
| `quietRepoLandsCleanly` | check a quiet attempt cannot fail |
| `landingIsolation`'s path-iff and failure-implies-moved conjuncts | check the phase matches the path |

Give the produced thing an identity and R1 stops needing a proxy. It becomes what it actually is, checkable directly on every reachable step:

> **the artifact that was committed is the artifact that was evaluated.**

That single invariant is strictly stronger than the path argument — it holds for wrap-up kinds that have no branch at all — and **every row in that table becomes unnecessary in the domain.** The artifact is not an addition to pay for; it is what buys the deletion.

## What the domain keeps

Wrap-up genericity is not "add a variant beside merge". It is: the domain models the *shape* of finishing, and merge becomes one implementation of it, living in an adapter.

Five things are genuinely domain-level, and each survives because it is a statement about the machine rather than about git:

1. **A completion happens exactly once per ticket.** `landingExclusive` generalizes to `completionExclusive` — same force, wider vocabulary.
2. **What is committed is what was evaluated.** The new invariant above. Replaces the path rule.
3. **Some wrap-up kinds need exclusive access to a shared resource; at most one holder at a time.** `gateDepthOne` generalizes to a lease.
4. **A failure is priced and parks at a named wall.** Unchanged in shape; `GatePricing` becomes wrap-up pricing.
5. **It never wedges** — every occupancy has an enabled resolution that frees the resource in the same step.

**Why the lease stays in the domain, when the merge does not.** Deciding that ticket A holds a resource and therefore ticket B may not *reads state belonging to another ticket* — which is exactly the authority split's test for a global decision. Only the actor may make it; pushing it to an adapter would create a second writer, which the charter forbids. So mutual exclusion is domain. **Git is not.**

And generalizing it buys something real rather than just abstracting: two deploys to the same environment should not run at once either. The resource is a parameter, not always "the repo".

## What leaves the domain

- `branchMoved` and the quiet/moved draw, in both actions
- `landOutcomes`' path rule; the two success outcomes collapse to one
- `quietRepoLandsCleanly` and `gatedPromotesDirectSquashes`, deleted
- `landingIsolation`'s path-iff and failure-implies-moved conjuncts
- `decideDequeue`'s routing composition

A side benefit worth naming: removing a binary environment draw from every attempt **roughly doubles the density of completed wrap-ups in random exploration**. The model's own notes record that landing attempts are currently rare enough on multi-repo instances that landing mutants are caught by the deterministic layer rather than the random one. This makes the random layer more useful, for free.

## What is lost, named rather than glossed

**The §5e theorem** — that a gated promotion advances the default ref while a quiet one squash-merges directly. This was v1's single conformance divergence, split deliberately in R3. It goes, and that is correct: *which* promotion mechanism fires is a property of the merge implementation, not of the machine. The merge adapter can hold it, and its own conformance can pin it. R3 was PROPOSED and unconfirmed, so nothing decided is being overturned.

**"A quiet branch always lands cleanly"** — v1's §4 insight. Also merge-specific truth, and it moves with the merge.

Both are real content and neither belongs in a domain that must also describe a deploy.

## Why merge-only is wrong, not merely narrow

Kept from the first draft because it is the case for doing this at all.

A ticket that builds an artifact or deploys an environment merges nothing and has no branch worth landing. Under the current model it cannot finish, and three things break:

**It consumes a lease it does not need.** `gateDepthOne` serializes one occupant per repo, so a deploy would queue behind and block real merges.

**Its failure taxonomy is actively false.** `landOutcomes(false) = { LandSquashMerge }` — a quiet branch *always* lands cleanly, because a moving default branch is the only reason a **merge** can fail. A deploy fails on its own terms with nothing upstream moved. The model could neither express the failure nor withhold the success.

**The trace lies**, recording a merge effect for work that merged nothing.

### The predecessor already decided this

Chuggernaut carries `wrap_up` on the job type, defaulting to `{ type: merge }`, with `none` described as *"for jobs whose effect is external (deploys, reports) and whose branch is scratch"*. Its state table has both `Evaluation → WrapUp` and `Evaluation → Done`, and its spec ships a worked deploy example:

```yaml
wrap_up:
  type: none                   # the deploy's effect is external; nothing to merge
```

So this is **a regression to repair, not a feature to justify.**

## Proposed shape

**The artifact.** `Ticket.artifact: Option[ArtifactId]`, an opaque token — the decision sequence number is the obvious candidate, which aligns with the Nomad design's D7 keying. Set at `work-passed`, read at eval spawn and at wrap-up, superseded when a rework produces a new one. **Not a measure input**, the same treatment `repo` gets.

**Identity, never content.** The model has no more business representing a diff or a build output than an evaluator's prose. This distinction is load-bearing: citation scoping was a content-shaped abstraction and it was removed for depending on evaluator honesty, a property outside the model. An identity depends on nothing outside the model, and *same-artifact* is provable without knowing what is in it.

**The wrap-up kind**, authored data on the ticket exactly like the eval program — the charter's *eval is data* applied one seam later:

| Kind | Meaning |
|---|---|
| `WNone` | the effect was external and already happened; evaluation passing completes the ticket |
| `WShared` | there is a wrap-up step, and it needs no exclusive resource |
| `WExclusive(resource)` | the step needs a lease on a named resource — merge takes the repo; a deploy takes the environment |

**Phases.** `PLanding`/`PGated` become generic: *wants to wrap up* and *holds the lease*. Two phases rather than one because occupancy stays **derived from phase** — storing a lease elsewhere would violate derive-don't-store. A `WNone` ticket enters neither.

**Outcomes.** `WrapUpOk | WrapUpFailed`. Two, not three.

## What this costs at three settled points

**Standing rule 1 — the measure comes first.** `measure.qnt` is reworked before the machine. The two rungs stay but are renamed; a `WNone` ticket drops from Evaluating straight to settled, skipping both, so the descent table needs re-deriving even though `rankCeiling` should not move.

**The charter's task-records row.** *Task records are first-class (they carry the anatomy)*. An artifact is not a task record, so this arguably widens what "the anatomy" means — worth an explicit decision rather than an assumption.

**The refinement layer.** D7 keys idempotency on artifact identity and treats a complete artifact directory as the record that the effect already happened. If the artifact enters the domain, the double-spend argument should be re-examined — it may **strengthen**.

## Deliberately out of scope

Artifact **content**, **storage** and retention; and the post-merge **publish command** — a third thing that runs after a successful merge, real in the predecessor, and its own seam. Folding it in would make one change into three.

## Open

**Is `WShared` earning its place on day one?** Three kinds may be one more than the evidence supports. The alternative is `WNone | WExclusive(resource)` and letting the first no-lease wrap-up add the third.

**How is a failed wrap-up priced?** The predecessor escalates on a non-zero exit without undoing the merge. Whether a `WNone` or `WShared` failure draws on gas, on the wrap-up account, or on one of its own is undecided.

**Does the lease need a queue discipline?** Today the dequeue is an unrestricted nondet pick and R6 accepts unbounded queue wait. That acceptance was written about the merge gate; it should be restated about leases generally, or narrowed.
