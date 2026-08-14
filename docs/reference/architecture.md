# Architecture

How chuggy is built. Present tense, and where the model proves something this page points at the module rather than restating it — a proved statement and a prose copy of it will diverge, and only one of them is checked.

## The model leads

A Quint model of the machine exists, is proved, and emits the golden traces the implementation replays. **When the implementation and the model disagree, the implementation is wrong.**

That is the inverse of the usual arrangement and it is deliberate. The predecessor's model chased an implementation and caught it; catching is expensive and only ever tells you what already shipped. Here the machine is specified and its safety properties are established before there is code to argue with.

`model/` holds it:

| File | Owns |
|---|---|
| `model/measure.qnt` | The termination measure and the record vocabulary it is a function of — the phase ladder, task lifecycle, accounts, the descent table, and the named non-descending sets. **Written before the machine**, and reworked first whenever the machine changes. |
| `model/domain.qnt` | The machine: pure deciders over an observed `Core`, the state and actions layer, and every safety invariant. |
| `model/refinement.qnt` | The journaled actor as a refinement of that machine — the durable journal, the executor cursor, and the two step relations that make the atomicity discipline a checkable difference rather than a convention. |
| `model/mc/`, `model/tests/` | Instances the randomized runs sample, and the deterministic suites: unit tests, eight witness modules, and the refinement suites. |

## The four standing rules

1. **The termination measure is written before the machine.** Every transition either descends it or belongs to a named, separately-bounded set. A change to the machine reworks `measure.qnt` first — not afterwards, and not in the same breath.

2. **No free re-entry.** Every path back into active work is metered. An unmetered re-entry is a loop with no bound on it, and the predecessor found two the expensive way: a gate-failure loop and an operator-retry loop, each of which spun forever because the path back cost nothing.

3. **Derive, don't store.** Any state expressible as a predicate over other state is a predicate. Stored duplicates of derivable facts are two things that can disagree, and the machinery that keeps them agreeing is machinery that can be wrong — the predecessor stored the ready/blocked split and had to model an unblock cascade to maintain it. Here they derive, and the cascade does not exist.

4. **Conformance from day one, direction reversed.** The model emits; the implementation replays.

## What the model proves

Twenty-three invariants hold in every reachable state of every instance, checked by randomized runs and asserted after every step of eight deterministic witness traces. They are listed at `allInvariants` in `model/domain.qnt`; the load-bearing ones:

- **Exactly one completion per ticket** (`completionExclusive`) — the exclusivity boundary. Any number of tasks may execute and duplicate, because the fabric is at-least-once; what is proved is that the completion effect fires once, whatever kind of wrap-up produced it.
- **A revoked ticket never completes** (`revokedNeverCompletes`), and both terminals are absorbing (`terminalsAbsorbing`).
- **The cascade is atomic** (`cascadeSafety`) — every ticket transitively doomed by a revocation is parked with its own desk task in the same decision, so there is no reachable state where a doomed ticket waits invisibly.
- **No structural deadlock** (`noStructuralDeadlock`) — every live ticket can still reach Done, or was settled by its author, or holds an open desk task.
- **At most one holder of a resource** (`leaseExclusive`), and a ticket with no wrap-up step never takes a lease at all (`noLeaseWithoutAKind`).
- **Accounts are resources** (`accountsBounded`) — nothing overdraws, nothing refunds.
- **The record is append-only** (`recordMonotone`), task identity is history-unique (`idsAccounted`), and dependencies are acyclic (`depsAcyclic`).
- **The measure descends** (`measureDescends`) on every step outside three named sets.

And in `model/refinement.qnt`, under journal-then-effect: every journaled history projects to a legal machine trace (`journalLegal`), replay of the journal is exactly the state the actor holds (`recoveryComplete`), and crash-recover at any seam never charges an account twice or completes a ticket twice (`noDoubleSpentBudget`, `noDuplicateCycle`).

**Chuggy bounds work, not waiting.** The measure bounds how much work the fleet can do — no ticket churns forever. It does not bound how long a ticket waits, for an author to release it, for the dispatcher to choose it, or for a lease to free. That is accepted, and `001-what-chuggy-is-not.md` records why.

## What a ticket produces

A ticket produces an **artifact** — an opaque identity for the thing work built, evaluation judged, and wrap-up commits. Its only modelled property is distinctness; content is never modelled, because a diff, a build output and an evaluator's prose are all equally outside what the machine can reason about.

It exists chiefly so a dependent can name what its dependency produced. That read is safe by construction rather than by discipline: a dependency is `Done` before any dependent can dispatch, and `Done` is absorbing, so nothing can change under a reader.

## How a ticket finishes

Wrap-up is a **declared kind**, authored on the ticket like its eval program. A ticket whose effect already happened during work — a deploy, a report — completes when evaluation passes, entering no wrap-up phase and taking no lease. A ticket that needs exclusive access to a resource takes a **lease** on it: a merge takes its repo, a registry push takes the registry, a deploy-to-environment takes the environment.

Mutual exclusion is the domain's business; git is not. Deciding that one ticket holds a resource and another may not reads state belonging to another ticket, which is the authority split's test for a global decision — an adapter doing it would be a second writer. Which promotion mechanism a merge uses is not modelled at all.

## The single writer

One journaled actor holds all state and makes every decision. Nothing else writes.

This is not a lock discipline, it is a shape: there is no shared mutable state to contend for, so the "one transition at a time" guarantee is structural rather than maintained. A change that appears to need a second writer is the wrong shape — simplify instead.

**Journal before effect.** A decision is appended to the durable journal, and only then do its effects reach the world. The other order is fatal and the model demonstrates it: `refinement.qnt`'s hazard relation adds exactly one action — decide, emit, die before the journal write — and that single delta breaks the double-spend and duplicate-landing theorems while every domain invariant stays green. The domain machine is *blind* to the hazard, which is the machine-checked argument that this obligation belongs to the refinement layer and cannot be discharged inside the core.

Effects between the journal position and the executor cursor are **re-emitted** after a crash. That is at-least-once toward the world, and it is safe because every emitted effect is keyed by its decision's journal sequence number and absorbs on redelivery. What nothing can absorb is an *un-keyed* effect — one that reached the world but never the journal — and that is exactly the orphan the discipline forbids.

## Deciders and effects

A decider is a pure function of an observed view and an event, returning transitions and a list of effects. It never performs one.

**Reads are not effects.** A value a decision needs is gathered into the view before the decider runs. Getting this backwards is the commonest way a decider/effects split stops being testable: the decider acquires an await, then a mock, and then it is no longer a function anyone can replay a trace through.

**The continuation contract.** An effect whose *result* the decision needs terminates the decider. Re-entry runs against a freshly gathered view — never against the view the first pass held. This is a rule, not an optimization: a decider that resumes on a stale view is deciding about a world that has moved.

The corollary is that a cheap read must be gathered into the view *before* the branch that needs it, rather than fetched mid-decision.

## The authority split

This determines what may be concurrent, and it is the first thing to get right.

**Global — the actor decides, and nothing else may.** Anything that reads or writes state belonging to a ticket other than the one being decided: dependency admission and unblocking, revoke cascades, capacity accounting, and merge-gate serialization.

**Ticket-local.** Resolved type and evaluator list, cycle and attempt budgets, verdicts, branch contents, the composed brief.

**The test:** *a decision is global exactly when it reads or writes state belonging to a ticket other than the one being decided.* That is what makes the second list safely parallelizable and the first list not.

**Node-local — the node decides, and neither the actor nor the repo may.** This is the one most likely to be collapsed into the other two. A node *advertises* physical capacity, which placement may match on; it separately *grants* capability out of its own configuration, which is never advertised and never requestable. The distinction is a security property, not a layering preference: a capability a job could request is a capability a merge can grant itself. Both halves fail closed at the node.

Sequential decisions and concurrent I/O are not in tension. Everything slow runs off the actor thread and reports back as an event; the event alphabet is the seam that separates them.

## Ports

A port is named after its **contract**, not after the first thing that implemented it, and its promises matter more than its signature — a second implementation that satisfies the port satisfies the invariants by construction, where an inline branch satisfies them only by review.

Each port documents what it promises, where it is allowed to fail, and its ordering and idempotence. Two failure classes that must not be conflated: a refusal to serve *this work now* is a decision input, not an error; a precondition for serving a *kind* of work at all is refused at boot.

The fabric is Nomad, and it decides nothing. It runs what the actor tells it to run. Its guarantees are trusted and unmodeled — restart and reschedule policy, the scheduler's placement and quota, blocking queries for watch delivery. **One is not supplied and must be built:** a maximum task runtime has no Nomad equivalent, so it is a deliberate line of the adapter rather than an axiom inherited from a fabric that provided it.

## Language and shape

TypeScript. The contract vocabulary is ADT-shaped — messages, effects, phases — and TypeScript checks discriminated-union exhaustiveness at zero runtime cost, which recovers the most valuable property a move away from a strongly-typed systems language would otherwise lose. Every union is switched exhaustively with `assertNever` in the default arm; that rule is what makes the language argument real rather than aspirational.

Wire types are schema-first: the schema is written once and the static type is derived from it, never written twice.

The tree is in its target shape from the first commit — a pure domain, an effect vocabulary, one interpreter where effects meet adapters, and the adapters themselves. No layout is ported from anywhere. The boundary is enforced by a graph rule over transitive reachability rather than a per-file lint, because the leak that matters is a helper three imports deep, and it lands in the same commit as the directories it governs.

## Contract-first change

Any change to the core **names the contract it changes**. If a change cannot be expressed that way, the contract it needs does not exist yet, and writing it is the first commit of the work.

The contract is the scope. That is what makes a unit of work safely delegable to an agent, and it is why the boundaries above are enforced mechanically rather than by discipline: agent-driven development erodes disciplinary boundaries faster than human development does.
