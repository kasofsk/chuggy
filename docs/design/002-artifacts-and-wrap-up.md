# What a ticket produces, and what is done with it

**Status: PROPOSED** — argued, not built. No slice has landed. Every question this document opened has been resolved; what remains is the work.

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
| `landingIsolation`'s path conjuncts | check the phase matches the path |

Give the produced thing an identity and R1 stops needing a proxy:

> **the artifact that was committed is the artifact that was evaluated.**

That single invariant is strictly stronger than the path argument — it holds for wrap-up kinds that have no branch at all — and **every row in that table becomes unnecessary in the domain.** The artifact is not an addition to pay for; it is what buys the deletion.

Measured surface today: 91 merge-specific references in `domain.qnt`, four purely-merge invariants plus two more partly, nineteen gate-account references in `measure.qnt`, two ladder rungs.

## What the domain keeps

Five things, each a statement about the machine rather than about git:

1. **A completion happens exactly once per ticket.** `landingExclusive` generalizes to `completionExclusive` — same force, wider vocabulary.
2. **What is committed is what was evaluated.** The new invariant. Replaces the path rule.
3. **Some wrap-up kinds need exclusive access to a shared resource; at most one holder.** `gateDepthOne` generalizes to a lease.
4. **A failure is priced and parks at a named wall.** Unchanged in shape.
5. **It never wedges** — every occupancy has an enabled resolution that frees the resource in the same step.

**Why the lease stays in the domain when the merge does not.** Deciding that ticket A holds a resource and therefore ticket B may not *reads state belonging to another ticket* — the authority split's own test for a global decision. Only the actor may make it; pushing it to an adapter would create a second writer, which the single-writer rule forbids. So mutual exclusion is domain. **Git is not.**

Generalizing it buys something real rather than abstracting for its own sake: two deploys to the same environment should not run at once either. The resource is a parameter, not always the repo.

## What leaves the domain

- `branchMoved` and the quiet/moved draw, in both actions
- `landOutcomes`' path rule; the two success outcomes collapse to one
- `quietRepoLandsCleanly` and `gatedPromotesDirectSquashes`, deleted
- `landingIsolation`'s path-iff and failure-implies-moved conjuncts
- `decideDequeue`'s routing composition

A side benefit: removing a binary environment draw from every attempt **roughly doubles the density of completed wrap-ups in random exploration**. The model's own notes record that landing attempts are currently rare enough on multi-repo instances that landing mutants are caught by the deterministic layer rather than the random one.

## What is lost, named rather than glossed

**The §5e theorem** — that a gated promotion advances the default ref while a quiet one squash-merges directly. This was v1's single conformance divergence, split deliberately in R3. It goes, and that is correct: *which* promotion mechanism fires is a property of the merge implementation. The merge adapter holds it and its own conformance pins it. R3 was PROPOSED and unconfirmed, so nothing decided is overturned.

**"A quiet branch always lands cleanly"** — v1's §4 insight. Also merge-specific truth, and it moves with the merge.

## Why merge-only is wrong, not merely narrow

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

**The artifact.** `Ticket.artifact`, an opaque token — the decision sequence number is the obvious candidate, aligning with the Nomad design's D7 keying. Set at `work-passed`, read at eval spawn and at wrap-up, superseded when a rework produces a new one. `None` until work first passes. **Not a measure input**, the same treatment `repo` gets.

**Identity, never content.** The model has no more business representing a diff or a build output than an evaluator's prose. This distinction is load-bearing: citation scoping was a content-shaped abstraction and it was removed for depending on evaluator honesty, a property outside the model. An identity depends on nothing outside the model, and *same-artifact* is provable without knowing what is in it.

**The wrap-up kind**, authored data on the ticket exactly like the eval program:

| Kind | Meaning |
|---|---|
| `WNone` | the effect was external and already happened; evaluation passing completes the ticket |
| `WExclusive(resource)` | the step needs a lease on a named resource — merge takes the repo, a registry push takes the registry, a deploy takes the environment |

**Phases.** `PLanding`/`PGated` become generic: *wants to wrap up* and *holds the lease*. Two phases rather than one because occupancy stays **derived from phase** — storing a lease elsewhere would violate derive-don't-store. A `WNone` ticket enters neither.

**Outcomes.** `WrapUpOk | WrapUpFailed`. Two, not three.

**Every kind emits exactly one completion effect.** A `WNone` completion is not silent: the adapter still publishes the ticket's completion to the world. Keeping it uniform is what lets `completionExclusive` stay a clean iff rather than acquiring a per-kind carve-out — and a carve-out on that invariant is exactly the shape the grouping removal took out.

## Worked examples

### A. Deploy to staging — `WNone`

```yaml
program:  [ { fanout: 1, combinator: CUnanimousPass } ]   # one smoke test
wrapUp:   WNone                                           # effect already happened
```

| Step | Label | Transition | Effects |
|---|---|---|---|
| 1 | `dispatch` | `Pending → Working` | `SpawnWorkTasks` |
| 2 | `task-done` | — | — |
| 3 | `work-passed` | `Working → Evaluating` | `SpawnEvalTasks` |
| 4 | `task-done` | — | — |
| 5 | `eval-passed` | `Evaluating → Done` | `Complete` |

The work task *is* the deploy. Its artifact is the release that went out — `art:7`. Evaluation smoke-tests `art:7`. Wrap-up has nothing to do, so evaluation passing completes the ticket directly, skipping both wrap-up phases.

### B. Land a code change — `WExclusive(repo:1)`

```yaml
program:  [ { fanout: 2, combinator: CUnanimousPass },    # lint + tests
            { fanout: 1, combinator: CUnanimousPass } ]   # approval
wrapUp:   WExclusive(repo: 1)
```

| Step | Label | Transition | Effects |
|---|---|---|---|
| … | `work-passed` | `Working → Evaluating` | `SpawnEvalTasks` |
| … | `eval-stage-passed` | `Evaluating → Evaluating` | `SpawnEvalTasks` |
| n | `eval-passed` | `Evaluating → WrapUp` | `EnqueueWrapUp` |
| n+1 | `wrapup-started` | `WrapUp → WrapUpHolding` | `AcquireLease(repo:1)` |
| n+2 | `ticket-done` | `WrapUpHolding → Done` | `Complete` |

Work produces candidate `art:12`; both eval stages judge `art:12`; the merge adapter commits `art:12`. The lease is held only across n+1→n+2 and freed by leaving the phase.

**What the domain no longer knows:** whether the default branch moved, whether this was a fast-path squash or a ref advance, which of two promotion effects fired. On failure n+2 is `wrapup-failed`, priced through the same arms as today's gate failure, and the lease frees by leaving the phase either way.

### C. Publish a release built by another ticket — `WExclusive(registry:1)`

Ticket **B** (build) → artifact `art:20`, `wrapUp: WNone`. Ticket **R** (release), `deps: {B}`:

```yaml
program:  [ { fanout: 1, combinator: CUnanimousPass } ]   # verify the staged release
wrapUp:   WExclusive(registry: 1)
```

| Step | Label | Transition | Effects |
|---|---|---|---|
| … | *(B reaches Done carrying `art:20`)* | | |
| 1 | `dispatch` | `Pending → Working` | `SpawnWorkTasks` |
| 2 | `work-passed` | `Working → Evaluating` | `SpawnEvalTasks` |
| 3 | `eval-passed` | `Evaluating → WrapUp` | `EnqueueWrapUp` |
| 4 | `wrapup-started` | `WrapUp → WrapUpHolding` | `AcquireLease(registry:1)` |
| 5 | `ticket-done` | `WrapUpHolding → Done` | `Complete` |

R's work stages the release *from* `art:20` and produces its own `art:21`; eval verifies `art:21`; wrap-up pushes `art:21` under a registry lease, because two concurrent registry pushes should not interleave. The lease being a parameter is what makes this expressible.

### What the examples expose

**The invariant guards opposite hazards in the two directions.** In B and C the effect happens *after* evaluation, so `committed == evaluated` guards against committing something other than what was judged — that is R1. In A the effect happens *during work*, so evaluation runs after the fact, and the same invariant guards against **judging something other than what was committed** — smoke-testing a staging environment somebody has since redeployed. Same sentence, opposite direction, both real. Merge-only framing could never surface the second.

## Resolved

**Is a third `WShared` kind needed?** No — two. Concrete cases exist for `WNone` and `WExclusive` and none for a lease-free step, and the predecessor's set is exactly these two, with its publish command riding on merge rather than standing alone. The restraint rule applies: nothing stronger lands without evidence that this was insufficient. A third kind arrives with its first real user.

**How is a failed wrap-up priced?** By rename, not redesign. `GatePricing` → wrap-up pricing, `gateLeft` → the wrap-up account, `RsGateBudgetExhausted` → the wrap-up wall. Same arms, same walls, same measure digit and radix. Note the question only exists for `WExclusive`: a `WNone` ticket has no step, so it cannot fail at wrap-up.

**Does the lease need a queue discipline?** No new machinery. R6 stops being a special case and becomes an instance of the standing **bounds work, not waiting** position: never-wedging is structural and free (every occupancy has an enabled resolution that frees the lease by leaving the phase), and how long a ticket waits for a lease is unbounded by decision. That is a simplification — one fewer special case, and R6's acceptance no longer needs its own argument.

**Does the measure move?** Renames only. `rankGated`/`rankLanding` become the holding and queued rungs; `rankCeiling` does not move; the artifact is measure-blind like `repo`, pinned by one test. A `WNone` ticket drops three rungs at once (Evaluating → settled), which still strictly descends. Reworked first, per standing rule 1, with the expectation that no numeral changes.

**Does the artifact widen the charter's task-records row?** The question dissolves — the charter was retired, so there is no row to amend. An artifact is a *product*, not a record of execution, so it is a new statement in `architecture.md` with this document as its argument. That is the shape the retirement was meant to produce: decisions in present tense in the reference tier, arguments in the design tier.

**Does the refinement layer change?** Deferred, with a trigger: re-examine when the artifact lands in the domain. D7's keyed artifact directory — *a complete directory is the record that the effect already happened* — is a world-side idempotency mechanism stronger than "the re-emitted effect absorbs", so the double-spend argument may **strengthen**. Doing that before the artifact exists in the domain is out of order.

**Can a dependency's artifact change under a dependent?** No, and the question dissolves on facts already in the model. `terminalsAbsorbing` forbids any transition out of `PDone`; `depsDoneIn` requires every dependency to be `PDone`; only `landSuccess` ever writes `PDone`. So by the time a dependent can dispatch, its dependency's artifact is **final and immutable**. There is no pin-versus-follow decision, no staleness, and no new machinery: a dependent reads `artifact` off its deps as a derived value. Which of several deps' artifacts a ticket actually uses is below the model's grain — the brief's business, not the machine's. This makes case C nearly free, and it is the strongest argument for artifact identity, because cross-ticket reference is currently not merely unproved but **unexpressible**.

## Sequencing

1. `measure.qnt` first — rung renames, the artifact's measure-blindness test, the descent table re-derived for the `WNone` three-rung drop.
2. The artifact: the field, set at `work-passed`, plus `committedIsEvaluated`.
3. The wrap-up kind, the two generic phases, and the lease — with `gateDepthOne` generalized and the merge-specific machinery deleted in the same change, since the invariant that replaces them must land with them.
4. `architecture.md` gains the statement of what a ticket produces.

Each step lands with its witness module; the three traces above are the natural shapes for them.

## Remaining open

Nothing blocking. One thing worth watching rather than deciding now: whether `WExclusive`'s resource should be a bare token or carry a kind, so that a repo lease and an environment lease cannot collide in the same namespace by accident. A single namespace is simpler and a collision is an authoring error; if authoring errors turn out to be common, the kind is the fix.
