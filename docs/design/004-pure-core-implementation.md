# The pure-core implementation

**Status: IN PROGRESS** — S0 through S7 have landed. S8 is proposed.

What is left to build: the one place where an effect becomes a call. Nothing real is launched; the fabric is a recording stub. The deliverable is the core a later real fabric adapter plugs into without the core moving, which is the property `model/refinement.qnt` states under PLATFORM CAPTURE.

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
| S8 | The interpreter, the ports and the walk | The effect interpreter over `(Entry, post-Core)`; the ports — fabric, journal store, desk — with their promises stated where they are declared; the stub adapters; the journal entry's wire schema and the parse at the store boundary; and one ticket driven from arrival to completion against stubs, with journal-before-effect structural and duplicate deliveries injected and absorbed. | S7 | Proposed |

**Depends on** is consumption — what a row's code and its suites read. Independently of that graph, no row merges with the conformance replay red.

## The target tree

The directories that do not exist yet. Each arrives with the boundary rule it owes `.dependency-cruiser.cjs`, and with the fixture in `.chug/tasks/check-boundaries.test.sh` that proves the rule bites; `src/domain/`, `src/actor/` and `test/` are built and their rules are in that file already.

| Path | Holds | May import | Owes |
|---|---|---|---|
| `src/interpreter/` <!-- intent --> | the ports it declares, the effect interpreter, the executor loop, the journal entry's wire schema | `src/domain/`, `src/actor/` | `interpreter-constructs-no-adapter` |
| `src/adapters/` <!-- intent --> | one stub per port | `src/domain/`, `src/actor/`, `src/interpreter/` | `no-adapter-sees-another` |
| `src/compose.ts` <!-- intent --> | the single wiring site, and the only file that constructs an adapter | everything | `nothing-imports-the-composition-root`, and its own exclusion from `no-orphan-module` |

`interpreter` is the one name here the model does not supply: both of its modules are pure, so neither has a noun for the layer where an effect becomes a call. Refutation trigger for the split: a fifth home that is none of domain, actor, interpreter or adapter. The symptom is a directory named after a technology.

## What is not carried yet

### The one impure loop is S8's, and the ports are the interpreter's

`src/actor/` is pure, and mixing its cursor arithmetic with an `await` would lose that quietly — crashing at every observable seam is exhaustive over a pure state machine and a scheduling problem over an async one. So S8 adds exactly one impure loop, which drains the cursor and calls the interpreter. That also settles where the ports go — the layer that calls out is the interpreter, so the interpreter declares them and the adapters implement them; a port declared in a directory of its own is declared away from both sides and is a header file with a folder around it.

Refutation trigger: an obligation that needs a real clock or real concurrency to state, a lease timeout being the likely one. The symptom is a crash-seam case that cannot be written as a function.

### The interpreter's argument is `(Entry, post-Core)`

An effect is nullary, so no port call can be formed from the effect list alone, and `model/refinement.qnt` abstracts a whole emission to its decision identity — enough for its theorems and not enough for an adapter. So the interpreter reads each effect's subject off the record positionally: `effects[i]` belongs to `transitions[i]`, with `ticket-arrived` the sole exception, one effect against no transition, whose subject is the id the arrival appended and which `idsDense` makes the largest key. That rule is what `decideRevoke` builds by construction, and it is why `transitions[0].ticket` is the wrong generalisation — it is a special case that holds for single-transition steps and would open the revoked ticket's desk task once per parked dependent.

The alternative is payloads on the effect constructors, which changes the domain vocabulary and `StepRecord`, so it is a model commit first and not this plan's to take. Consequences: the routing is a total function over the effect constructors, exhaustively switched, not a partition into three — a bookkeeping effect goes to the desk and a work effect to the fabric, while the journal store is reached by the executor loop before any emission rather than by the interpreter at all.

### The dependencies still to land

| Need | Presumptive choice | Why | Slice |
|---|---|---|---|
| schema <!-- intent --> | a schema-first library, runtime dependency of `src/interpreter/` and outward | the first thing that needs a wire `Entry` is the journal store's adapter, and the model puts the parse at the boundary where a tampered journal arrives | S8 |

Naming a presumptive choice here is a note that the question was looked at, not the argument. Each still argues its case in the commit that lands it.

### Where a skill and this repo meet at an angle

**domain-modelling says a repository over an in-memory structure, or over a log the core already folds, is an abstraction with nothing on the far side.** The journal store port is required anyway, and not for indirection's sake: the refinement obligation is exactly that a real durable store substitutes without the core moving, and a port with no second side today is what makes that substitution a compile-time fact rather than a promise. That reason belongs in the port's own declaration, where somebody deleting it will read it.

**idiomatic-by-default does not license settling a question the model answers.** The idiomatic dequeue is a FIFO array, and the model leaves queue order unmodeled with the dequeue an unrestricted choice — an implementation may impose FIFO as a refinement, but FIFO may not leak into a decider or into a replayed comparison. And the idiomatic response to an invalid input is to throw, where the model refuses structurally and one layer out, by set membership; so the returned refusal a caller must handle belongs at S8's boundary parse, which is where illegal values actually arrive.

**The schema-first rule meets the zero-domain-dependency rule at the journal entry.** The wire schema must describe a `StepRecord`, whose type is a domain type that stays dependency-free. So the schema lives in `src/interpreter/` <!-- intent -->, beside the store port whose boundary the parse defends, and the domain type stays the truth, with a compile-time assertion pinning the inferred type and the domain type mutually assignable. The shape is written twice and the compiler checks the second writing, which is the difference between a duplicate and a mirror.
