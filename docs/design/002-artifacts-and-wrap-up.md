# What a ticket produces, and what is done with it

**Status: IMPLEMENTED** — all four slices landed.

| Slice | State |
|---|---|
| 1–2 · the artifact, and the measure blindness it needed | **Landed** |
| 3 · the wrap-up kind, the generic lease, the merge vocabulary out | **Landed** |
| 4 · `architecture.md` | **Landed** |

## The two questions

**What crosses a phase boundary?** Nothing does. `decideWorkReduce` on success retires the work set and calls `spawnOn(retired, TKEval(0), fan)`; the eval-failure arm calls `spawnOn(retired, TKWork, N_TASKS)`. Fresh tasks, no payload, either way. A `Ticket` carries `phase deps repo program tasks record spawned reason landings` — **there is no artifact**. The thing work produces, eval judges and wrap-up commits does not exist as a value anywhere in the model.

**What happens at the end?** Exactly one thing: a merge. The only path to `PDone` is `landSuccess`, reachable only from `PLanding` or `PGated`, and the outcome vocabulary is `LandAdvanceDefault | LandSquashMerge | LandFailed` — all merge verbs. Every ticket merges.

They are related but they are **not** the same question, and an earlier draft of this document claimed they were. See the correction at the end.

## Part 1 — the artifact

### What it is for

Naming what a ticket produces buys three things. None of them is a new theorem, and saying so plainly matters, because the case for it was overstated once already.

**It makes a currently-unexpressible thing expressible.** A ticket cannot name the artifact its dependency produced. Today a dep is *only* a phase check — `depsDoneIn` reads Done-ness and nothing else. A release ticket that publishes a build ticket's output cannot be described at all. That is a capability gap, not a proof gap, and it is the strongest of the three.

**It completes the specification at a seam the implementation has to get right anyway.** The model is what the implementation grows up against. If the spec is silent on what crosses work → eval, the implementation invents it, and conformance traces cannot catch the invention because they carry labels, transitions and effects but no payload.

**It gives an already-decided requirement somewhere to live.** The Nomad design's D6 — *the evaluation task installs the work task's artifact; it never rebuilds it* — is a work→eval artifact-flow requirement with no model vocabulary.

### What it is *not* for

It does not let R1 be proved directly, and an invariant of the form *the artifact committed is the artifact evaluated* would be **worthless** if the artifact were derived from the cycle: the phase machine already forbids work between `eval-passed` and wrap-up, so nothing could make it false. That is a tautology of exactly the shape `stuckSubsetCovered` turned out to be, and adding one deliberately would be worse than inheriting one.

### Shape

`Ticket.artifact`, an opaque token. Set at `work-passed`, superseded when a rework produces a new one, `None` until work first passes. **Identity, never content** — the model has no more business representing a diff or a build output than an evaluator's prose. Citation scoping was a content-shaped abstraction and it was removed for depending on evaluator honesty; an identity depends on nothing outside the model.

Not a measure input, the same treatment `repo` gets. The one invariant worth stating is modest and non-vacuous: an artifact exists iff the ticket has passed work at least once.

**Cross-ticket reads are free, and this is the good news.** `terminalsAbsorbing` forbids any transition out of `PDone`; `depsDoneIn` requires every dependency to *be* `PDone`; only `landSuccess` ever writes `PDone`. So by the time a dependent can dispatch, its dependency's artifact is **final and immutable**. There is no pin-versus-follow decision, no staleness, and no new machinery — a dependent reads `artifact` off its deps as a derived value. Which of several deps' artifacts a ticket uses is below the model's grain.

## Part 2 — wrap-up

### Why merge-only is wrong, not merely narrow

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

### The hazard is real and stays modelled

`branchMoved` is not a proxy for anything. It models an actual environment event — the default branch moved under the candidate between evaluation and merge, so the tree that lands is the candidate merged into a *new* base and genuinely differs from the tree that was evaluated. The gate exists to re-validate against that new result. The two paths are the two cases of a real hazard, and deleting them would delete the modelling of the hazard.

What generalizes is the hazard itself, once the git vocabulary is stripped:

> **an artifact validated at evaluation may no longer be valid at commit time**, and the wrap-up kind decides whether that can happen and what re-validation costs.

For merge it is HEAD moving. For a registry push it is someone else publishing that version. For a `WNone` deploy it cannot arise at all — the commit already happened during work, which is the same asymmetry the worked examples surface from the other side.

So the per-attempt environment draw **stays**, renamed rather than removed, along with the two-phase lease shape and the re-validation path.

### What actually leaves

Smaller than the first draft claimed, and each item leaves for its own reason:

- `LandAdvanceDefault` vs `LandSquashMerge` collapse to one success outcome, and `gatedPromotesDirectSquashes` is deleted — *which* promotion mechanism fires is a property of the merge implementation, not of the machine.
- The git vocabulary throughout: `branchMoved` becomes an invalidation draw, `landOutcomes` an outcome rule, the landing phases generic.
- `gateDepthOne`'s per-repo quantifier becomes per-resource.
- Merge stops being the only kind.

**Lost with the promotion split:** the §5e theorem, v1's single conformance divergence, deliberately split in R3. That is correct — it belongs to the merge adapter, whose own conformance can pin it. R3 was PROPOSED and unconfirmed, so nothing decided is overturned.

### Why the lease stays in the domain when the merge does not

Deciding that ticket A holds a resource and therefore ticket B may not *reads state belonging to another ticket* — the authority split's own test for a global decision. Only the actor may make it; pushing it to an adapter would create a second writer. So mutual exclusion is domain. **Git is not.**

Generalizing it buys something real: two deploys to the same environment should not run at once either. The resource is a parameter, not always the repo.

### Shape

| Kind | Meaning |
|---|---|
| `WNone` | the effect was external and already happened; evaluation passing completes the ticket |
| `WExclusive(resource)` | the step needs a lease on a named resource — merge takes the repo, a registry push takes the registry, a deploy takes the environment |

**Phases.** `PLanding`/`PGated` become generic: *wants to wrap up* and *holds the lease*. Two phases because occupancy stays **derived from phase** — storing a lease elsewhere would violate derive-don't-store. A `WNone` ticket enters neither.

**Outcomes.** `WrapUpOk | WrapUpFailed`.

**Every kind emits exactly one completion effect**, `WNone` included. A silent completion would make `completionExclusive` need a per-kind carve-out, and a carve-out on that invariant is exactly the shape the grouping removal took out.

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

The work task *is* the deploy. Its artifact is the release that went out, `art:7`. Evaluation smoke-tests `art:7`. Wrap-up has nothing to do, so evaluation passing completes the ticket directly, skipping both wrap-up phases.

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

Work produces candidate `art:12`; both eval stages judge `art:12`; the merge adapter commits it. The lease is held only across n+1→n+2 and freed by leaving the phase. The invalidation draw happens at n+1: an artifact the environment has not invalidated takes the direct path and completes without ever holding the lease; an invalidated one takes the lease and is re-validated.

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

R's work stages the release *from* `art:20` and produces its own `art:21`; eval verifies `art:21`; wrap-up pushes it under a registry lease, because two concurrent registry pushes should not interleave. **This is the case that is unexpressible today**, and it is what the artifact is chiefly for.

### What the examples expose

The invalidation hazard runs in **opposite directions** depending on when the effect happens. In B and C the effect follows evaluation, so the risk is committing something other than what was judged. In A the effect happens during work and evaluation runs after the fact, so the risk is *judging* something other than what was committed — smoke-testing a staging environment somebody has since redeployed. Merge-only framing could never surface the second, and a `WNone` kind is what makes it visible.

## Resolved

**Is a third `WShared` kind needed?** No — two. Concrete cases exist for both and none for a lease-free step, and the predecessor's set is exactly these two, with its publish command riding on merge rather than standing alone. A third arrives with its first real user.

**How is a failed wrap-up priced?** By rename, not redesign. `GatePricing` → wrap-up pricing, `gateLeft` → the wrap-up account, `RsGateBudgetExhausted` → the wrap-up wall. Same arms, same walls, same measure digit and radix. The question only exists for `WExclusive`: a `WNone` ticket has no step, so it cannot fail at wrap-up.

**Does the lease need a queue discipline?** No new machinery. R6 stops being a special case and becomes an instance of the standing **bounds work, not waiting** position: never-wedging is structural (every occupancy has an enabled resolution that frees the lease by leaving the phase), and how long a ticket waits is unbounded by decision.

**Does the measure move?** Renames only. The two rungs stay; `rankCeiling` does not move; the artifact is measure-blind like `repo`, pinned by one test. A `WNone` ticket drops three rungs at once (Evaluating → settled), which still strictly descends. Reworked first, per standing rule 1.

**Does the artifact widen the charter's task-records row?** The question dissolves — the charter was retired. An artifact is a product, not a record of execution, so it becomes a statement in `architecture.md` with this document as its argument.

**Does the refinement layer change?** Deferred with a trigger: re-examine when the artifact lands. D7's keyed artifact directory is a world-side idempotency mechanism stronger than "the re-emitted effect absorbs", so the double-spend argument may strengthen.

**Can a dependency's artifact change under a dependent?** No — see Part 1. The question dissolves on `terminalsAbsorbing`.

## Sequencing, as executed

1. `measure.qnt` first — rung renames, the artifact's measure-blindness test, the descent table re-derived for the `WNone` three-rung drop.
2. The artifact: the field, set at `work-passed`, the exists-iff-work-passed invariant, and the cross-ticket read.
3. The wrap-up kind, the generic phases and the lease — with the merge vocabulary renamed and the promotion split deleted in the same change.
4. `architecture.md` gains the statement of what a ticket produces.

Each step lands with its witness module; the three traces are their natural shapes.

## Remaining open

Whether `WExclusive`'s resource should be a bare token or carry a kind, so a repo lease and an environment lease cannot collide in one namespace. A single namespace is simpler and a collision is an authoring error; if those turn out to be common, the kind is the fix.

---

## The record

### Correction — 2026-08-14 (the central claim of the first two drafts)

The first two drafts argued that R1 — *no commit reaches the default branch without every evaluator passing against the exact tree that lands* — was proved **by proxy**, that `branchMoved` and the path rule were a workaround for missing artifact identity, and that naming the artifact would make the whole merge apparatus unnecessary in the domain. The second draft made this the headline: *the artifact is what pays for the deletion.*

That was wrong, in a way worth recording rather than quietly fixing.

`branchMoved` does not stand in for a domain fact. It models an environment event — HEAD moving between evaluation and merge, after which the landed tree is the candidate merged into a new base and genuinely differs from the evaluated one. The two paths are the hazard's two cases. Deleting them deletes the modelling of the hazard, and the proposed replacement invariant — *the artifact committed is the artifact evaluated* — would have been **true by construction**, since the phase machine already forbids work between `eval-passed` and wrap-up. It could not have failed, which is the `stuckSubsetCovered` defect diagnosed three commits earlier and would have been worse for being deliberate.

What survives: the artifact, on the narrower and honest grounds in Part 1 — cross-ticket expressibility above all. And wrap-up genericity, which never depended on the R1 argument and rests on the false failure taxonomy and the predecessor's own decision.

What changed: the hazard is generalized rather than removed, so the environment draw, the two-phase lease and the re-validation path all stay. The deletion is real but smaller — the promotion split and the git vocabulary, not the apparatus.

Caught before any code was written, by asking what the replacement invariant would actually be checked against.

### Correction — 2026-08-14 (two defects the suites did not catch)

Both slices landed green on the unit and witness suites and were then found
wrong by the random layer, which is worth recording because it is the second
time in this repo that an all-green suite has hidden something.

**A `WNone` completion left live tasks on a Done ticket.** `completeTicket`
does not retire a task set — on the lease path the set is already retired
when the ticket enqueues — so the route that skips the wrap-up phases skipped
the retirement too. The gate reddened on one run in fourteen and was clean on
the other thirteen; reproducing it took 25,000 samples. The fix is six words;
finding it was not. `chuggy_witness_wrapup_none_test`'s empty-task-set
conjunct now makes it a deterministic one-line failure.

**`wrapUpIsolation`'s completeness arm assumed every completion was an
attempt.** It forbade the `ticket-done` label on any step carrying no
attribution. A `WNone` completion resolves no wrap-up attempt and so
legitimately carries none. The arm now permits exactly that case and
constrains it to tickets whose kind is `WNone`.

Neither is a flaw in the design above; both are the design meeting parts of
the machine written before it existed.
