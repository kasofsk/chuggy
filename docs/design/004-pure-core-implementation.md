# The pure-core implementation

**Status: LANDED** — S0 through S8 have landed.

Nothing real is launched; the fabric is a recording stub. What the plan set out to deliver is the core a later real fabric adapter plugs into without the core moving, which is the property `model/refinement.qnt` states under PLATFORM CAPTURE. Each argument this file used to carry now lives where the thing it argues for is enforced — a gate header, a boundary rule's own comment, or the module that holds the code — so what is left below is the mapping into `git log` and the positions that are still only proposed.

## The slice table

A landing commit carries a `Slice: 004-pure-core-implementation <row>` trailer, so the mapping is readable from `git log` with no platform to ask. A landed row keeps that pointer; what it argued for is in the code, the gates and the suites.

| # | Label | Contract | Depends on | Status |
|---|---|---|---|---|
| S0 | Toolchain and tree shape | — | — | **Landed** `1bf76be` |
| S1 | The golden corpus | — | S0 | **Landed** `caf6c54` |
| S2 | The measure and the vocabulary | — | S1 | **Landed** `9c87073` |
| S3 | The deciders and the enablement predicates | — | S2 | **Landed** `a10d38c` |
| S4 | The invariants | — | S2 | **Landed** `af5a39a` |
| S5 | The replayer and the conformance gate | — | S1, S3, S4 | **Landed** `d375b5f` |
| S6 | The randomized layer | — | S5 | **Landed** |
| S7 | The journaled actor | — | S3, S4 | **Landed** |
| S8 | The interpreter, the ports and the walk | — | S7 | **Landed** |

**Depends on** is consumption — what a row's code and its suites read. Independently of that graph, no row merges with the conformance replay red.

## What would refute the split

`interpreter` is the one directory name the model does not supply: both of its modules are pure, so neither has a noun for the layer where an effect becomes a call. Refutation trigger for the split into domain, actor, interpreter and adapter: a fifth home that is none of them. The symptom is a directory named after a technology.

The one impure loop has the same kind of trigger, and it is narrower: an obligation that needs a real clock or real concurrency to state, a lease timeout being the likely one. The symptom is a crash-seam case that cannot be written as a function.

## The runtime dependency

| Need | What landed | Why | Slice |
|---|---|---|---|
| schema | `zod`, a runtime dependency of `src/interpreter/` and outward | the first thing that needs a wire `Entry` is the journal store's adapter, and the model puts the parse at the boundary where a tampered journal arrives; the inferred type is what makes the second writing of the shape a mirror the compiler checks rather than a duplicate | S8 |

## Where a skill and this repo still meet at an angle

**idiomatic-by-default does not license settling a question the model answers.** The idiomatic dequeue is a FIFO array, and the model leaves queue order unmodeled with the dequeue an unrestricted choice — an implementation may impose FIFO as a refinement, but FIFO may not leak into a decider or into a replayed comparison. Nothing in this tree queues anything yet, so the position is stated and not yet spent.
