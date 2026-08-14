# What a ticket produces, and what is done with it

**Status: PROPOSED** — argued, not built. No slice has landed.

## The two questions, which turn out to be one

**What crosses a phase boundary?** Nothing does. `decideWorkReduce` on success retires the work set and calls `spawnOn(retired, TKEval(0), fan)`; the eval-failure arm calls `spawnOn(retired, TKWork, N_TASKS)`. Fresh tasks, no payload, either way. A `Ticket` carries `phase deps repo program tasks record spawned reason landings` — **there is no artifact**. The thing work produces, eval judges and landing lands does not exist as a value anywhere in the model.

**What happens at the end?** Exactly one thing: a merge. The only path to `PDone` is `landSuccess`, reachable only from `PLanding` (the quiet fast-path) or `PGated`. The outcome vocabulary is `LandAdvanceDefault | LandSquashMerge | LandFailed` — all merge verbs. Every ticket merges.

These are the same question. A ticket produces something; the thing it produces is what wrap-up commits to the world. The model is silent on the first and hardcodes one answer to the second.

## Why hardcoding the merge is wrong, not merely narrow

A ticket that builds an artifact or deploys to an environment merges nothing and has no branch worth landing. Under the current model such a ticket cannot finish at all, and three things break rather than one:

**It consumes a merge-gate slot it does not need.** `gateDepthOne` serializes one occupant per repo. A deploy would queue behind, and block, real merges — a correctness-shaped cost, not an inelegance.

**Its failure taxonomy is actively false.** `landOutcomes(false) = { LandSquashMerge }`: a quiet branch *always* lands cleanly, because the moving default branch is the only reason a merge can fail. For a deploy that is simply untrue — a deploy fails on its own terms, with nothing upstream having moved. The model would be unable to express the failure that actually happens, and would insist on a success that did not.

**The trace lies.** Every completion records a merge effect for work that merged nothing.

## The predecessor already decided this

This is the part that settles it. Chuggernaut has a `wrap_up` block on the job type, defaulting to `{ type: merge }`, with a `none` variant described as: *"`merge` (default) squash-merges the job branch through the merge queue/gate; `none` goes straight to Done — for jobs whose effect is external (deploys, reports) and whose branch is scratch."*

Its state table carries both edges — `Evaluation → WrapUp` when `wrap_up: merge`, and `Evaluation → Done` when `wrap_up: none` — and its spec ships a worked deploy example:

```yaml
wrap_up:
  type: none                   # the deploy's effect is external; nothing to merge
```

It also separates the merge from the publish: `wrap_up.run` is a post-merge command, and a wrap-up failure *"re-run[s] only the `wrap_up.run` publish command at a fresh attempt; the squash has already landed, so the merge is never redone."*

So wrap-up genericity is not a new idea to be weighed. It is **decided behaviour in the system chuggy replaces**, and chuggy's model collapsed it to merge-only. This is a regression to repair, not a feature to justify.

## The artifact: why identity, and why it earns its place

The case for naming what a ticket produces is not that typed interfaces are tidy. It is that **the model's headline requirement is currently proved by proxy.**

R1 says: *no commit reaches the default branch without every required evaluator passing against the exact tree that lands.* The model gets there **structurally** — on a quiet branch the evaluated tree is the landing tree; on a moved branch only the gate-validated candidate may land. That is an argument about **paths**. Give the produced thing an identity and R1 becomes what it actually is, checkable on every reachable step:

> **the artifact that was committed is the artifact that was evaluated.**

Two further properties are unstatable today and fall out for free:

- **Evaluation never judges another cycle's output.** A rework respawns work, then eval. Nothing prevents a model where eval judges the wrong cycle's product, because there is no product to be wrong about.
- **A completion commits something that was built.** `landings` counts effects, not subjects.

And it connects to a decision already taken elsewhere: the Nomad design's **D6** (*"the evaluation task installs the work task's artifact; it never rebuilds it"*) is a work→eval artifact-flow requirement the model has no vocabulary for, and its **D7** (*"the artifact directory is keyed by the decision sequence number, and a complete directory is the record that the effect already happened"*) is an idempotency mechanism keyed on artifact identity — refinement-layer material, in the layer that exists to prove no double-spend.

**Identity, never content.** The model has no more business representing a diff or a build output than it has representing an evaluator's prose. An opaque token — the decision sequence number is the obvious candidate, which aligns with D7 — proves *same artifact* without knowing anything about what is in it. This distinction is load-bearing: the citation-scoping mechanism was a content-shaped abstraction and it was removed for depending on evaluator honesty, a property outside the model. An identity depends on nothing outside the model.

## Proposed shape

**A ticket produces an artifact.** `Ticket.artifact: Option[ArtifactId]`, an opaque token. Set at `work-passed`, read at eval spawn and at wrap-up, superseded when a rework produces a new one. **Not a measure input** — the same treatment `repo` gets and `batch` got before it was removed, pinnable in one test.

**Wrap-up is a declared kind, not a fixed step.** The ticket carries its wrap-up kind as authored data, exactly as it carries its eval program — this is the charter's *eval is data* applied one seam later. Two kinds to start, matching the predecessor:

| Kind | Meaning |
|---|---|
| `Merge` | today's path: enqueue, dequeue, the depth-1 gate, the branch-moved draw, the two promotion effects |
| `None` | the artifact's effect is external; evaluation passing completes the ticket directly |

The merge path keeps every property it has now — depth-1 serialization, the path rule, the priced eviction, `landingExclusive`. What changes is that those become properties **of the merge kind**, not of every ticket. `gateDepthOne` should quantify over gated tickets, which a `None` ticket never becomes.

**Exclusivity generalizes rather than weakens.** `landingExclusive` currently reads *exactly one landing effect per ticket, iff Done*. The honest generalization is *exactly one **completion** effect per ticket, iff Done* — where a merge kind's completion effect is the promotion and a none kind's is whatever names the external effect. The invariant keeps its force; only the vocabulary widens.

## What this costs at three settled points

**Standing rule 1 — the measure comes first.** A new field means `measure.qnt` is reworked before the machine, even though the answer is expected to be "blind to it". Adding a wrap-up kind may add or remove rank ladder rungs: a `None` ticket skips `PLanding` and `PGated` entirely, so the descent table needs re-deriving and `rankCeiling` may move.

**The charter's task-records row.** *Task records are first-class (they carry the anatomy)*. An artifact is not a task record, so this arguably widens what "the anatomy" means. Worth an explicit decision rather than an assumption.

**The refinement layer.** D7 keys idempotency on artifact identity. If the artifact enters the domain, the refinement layer's double-spend argument should be re-examined to see whether it strengthens — a complete artifact directory being *the record that the effect already happened* is a stronger claim than the journal-seq keying alone.

## Deliberately out of scope here

Artifact **content**, artifact **storage**, retention, and the `wrap_up.run` post-merge publish command — a third thing that runs after a successful merge, distinct from both the merge and the evaluation. It is real in the predecessor and it should be modelled, but it is a separate seam and folding it in here would make one change into three.

## Open

**Should a failed wrap-up be priced like a failed gate?** The predecessor escalates on a non-zero wrap-up exit without undoing the merge. Under a generic wrap-up the question is whether a `None` ticket's external effect failing draws on gas, on gate budget, or on an account of its own.

**Is `None` the right second kind, or is it the absence of a kind?** Modelling it as a variant keeps wrap-up total and makes the trace explicit. Modelling it as `Option` makes the common case smaller. The variant is proposed here because a trace that says *this ticket completed with no external effect* is worth more than one that says nothing.
