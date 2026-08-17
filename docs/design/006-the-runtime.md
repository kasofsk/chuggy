# The runtime

**Status: PROPOSED** — kasofsk/chuggy#68 is the ticket. The face it implements, `src/interpreter/inbound.ts`, landed with #66.

The deployment runs the single-process journaled actor `model/refinement.qnt` proves — the same machine, so what is missing is a driver rather than a shape: nothing in `src/` calls the executor, and no path carries a completion back in. The runtime is that driver, and the decision this doc argues is that it is a fourth pure layer, not a second impure one.

## Reactive, and therefore under the ambient ban

Every stimulus the driver answers is an inbound call — a completion, a desk command, a watch event, boot — and every deferral it needs is a capability the composition root injects. A layer with that shape needs no clock, no timer and no randomness; the eslint block that binds the interpreter binds it verbatim, and `src/adapters/` stays the only directory holding ambient capability. Four modules:

- `src/runtime/drive.ts` <!-- intent --> owns the actor state and serializes every submission through one chain, which makes the single writer structural inside the process the way the store's key makes it structural outside it.
- `src/runtime/followUps.ts` <!-- intent --> is pure over the enablement sets: the actor's own next moves after a decision, bounded because every internal command descends the measure.
- `src/runtime/policy.ts` <!-- intent --> is the dispatch pick, first ticket id first. Any policy refines the model's unrestricted choice, and the placement spends the position 004 held open: the pick lives above the deciders and above replay, where it can leak into neither.
- `src/runtime/boot.ts` <!-- intent --> re-hands the gate instruction to every ticket holding the lease, reconstructed from the journal — legal because delivery is at-least-once, and the whole answer to a gate opened just before a crash.

## The boundary rules owed

Per `.dependency-cruiser.cjs`, a layer argued before it exists owes its rule names to the doc arguing it:

- `runtime-reaches-no-adapter` — the runtime coordinates adapters it is handed, never adapters it names.
- `the-runtime-is-reached-only-from-the-root` — a second importer of the drive would be an actor with two drivers.

`src/compose.ts` becomes the process entrypoint with its own rule unmoved: a start script names it, and a script is not an edge in the module graph.

## What would refute this

The reactive position fails the day an obligation requires the runtime to act with nobody calling — the lease timeout 004 pre-names is the candidate — and that day buys a refinement sibling in `model/`, not a timer smuggled into the layer. The fixpoint's bound fails only if a follow-up ascends the measure, which the journal's legality check refuses before any doc could.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R2 | The four modules, the two rules, the eslint block, the entrypoint | #66, #67 | Proposed |
