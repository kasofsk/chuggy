# The arrival boundary for task configuration

**Status: PROPOSED** — nothing below is enforced yet; the landing table at the end sequences what will be.

A ticket carries the configuration of the tasks its phases run, and that configuration is authored: a user wrote it, it arrives from outside the tree, and it decides what a task does. For an agent task it decides the prompt, the tools and the permissions; for a build or a CI task it is argv. The decision here is where an ill-formed one is refused, and it is a pair, because the two halves cannot be refused in the same place.

## The gap

The discipline already exists and covers one thing. `model/domain.qnt` validates the eval program structurally at arrival — an empty program, a zero or oversized fan-out, an overlong program — and the argument is written where the decider is: refused at authoring time, no reachable state holds one, *rather than the interpreter defending against one mid-flight*. The program is immutable after arrival, like deps.

Task configuration content is not in the model at all. `tasksWellFormed` constrains task ids, kinds and fan-out, which is the state machine rather than what a task was configured to do. So the machine knows a task exists, what phase it belongs to and how it resolved, and knows nothing about the data that decided its behaviour.

That gap is invisible until something implements a task. `src/briefing/` is the first, and it put its refusals where no ticket passes: the spec that says which transform names exist is a TypeScript type, so `keyof Spec` rejects an unknown name when this repo is compiled, and a ticket is not compiled. The module now refuses a name that resolves to nothing at run time as well, which makes it honest about what a parsed string is worth, and leaves the question of where that refusal belongs.

## Two refusals, in two places

**R1 — decidable from the configuration alone, so it goes to arrival.** Every task name a ticket references resolves to a task the tree has, and every task's params satisfy the schema that name declares. Both are pure predicates over authored data and neither needs a ticket to have run, which is exactly the shape `programsWellFormed` has. So they belong in the model first and in the arrival decider second, and what they buy is the same thing: no reachable state holds a ticket whose task configuration does not resolve.

**R2 — needs the runtime view, so it stays at execution and changes kind.** Whether a chain composes to a non-empty prompt depends on the ticket's state when the work phase runs, so no arrival predicate can decide it without lying. It stays where it is, and stops being an exception: an empty prompt becomes an outcome the phase machinery evaluates, not an `Error` crossing a layer boundary. A thrown exception routes around the machine that exists to decide what happens to failed work, and the actor deciding everything is the property the whole tree is arranged around.

Neither half absorbs the other. Everything at execution is the interpreter defending mid-flight against an ill-formed program, in the words the model already uses to reject it — and it spends a dispatch, a lease and a rework cycle discovering what the configuration said all along. Everything at arrival needs a predicate over data that does not exist yet, and the model would have to prove it.

## Where the parse goes

`docs/design/004-pure-core-implementation.md` settled this shape once already, for the journal: `zod` at the boundary where untrusted data arrives, a runtime dependency of `src/interpreter/` and outward, with the type inferred from the schema so the second writing of the shape is a mirror the compiler checks rather than a duplicate. Task configuration is the same problem one boundary over, and takes the same answer.

The consequence for `src/briefing/` is that its spec stops being written by hand. What the parse produces is what the spec is, and the compile-time typing it already has then protects everything downstream of the parse — which is where that typing was always going to be worth something, and is not where it was aimed.

## The fifth home

004 names its own refutation trigger for the split into domain, actor, interpreter and adapter: a fifth home that is none of them. The `briefing-is-pure` rule in `.dependency-cruiser.cjs` argues its way out of the trigger on the grounds that no layer imports the directory and it imports none. The caller that turns a configured task into an agent invocation is that import, so the trigger fires on the first real consumer, and the argument in that comment expires with it.

The position proposed here is that briefing is not a fifth layer. It is pure, it decides text from data, and it reaches nothing outside itself — which is `src/domain/`'s rule stated exactly. What makes it feel like its own thing is that the model has no noun for prompt composition, and that is the same discomfort `interpreter` already carries as the one directory name the model does not supply. Under this position the directory moves and the split does not change.

The alternative worth keeping open: if the prompt turns out to be built where the effect becomes a call rather than before it, briefing is the interpreter's and moves there instead. What decides between them is which layer the first real caller sits in, so the decision waits for that caller and no longer.

## Landing

| # | What lands | Where | Depends on | Status |
|---|---|---|---|---|
| B1 | Task-configuration well-formedness, and its arrival refusal | `model/domain.qnt` | — | Proposed |
| B2 | The arrival parse, with the spec inferred from the schemas | `src/interpreter/` | B1 | Proposed |
| B3 | An empty prompt as an outcome rather than an exception | `src/briefing/` | B1 | Proposed |
| B4 | The fifth-home decision, and the boundary rule amended to carry it | `.dependency-cruiser.cjs` | B2 | Proposed |

B1 lands in the model before anything consumes it, which is the ordinary direction here: the model leads, and a refusal the model does not carry is a refusal the conformance replay cannot see. B4 waits on B2 because the caller B2 introduces is what decides it.
