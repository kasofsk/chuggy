# The Kubernetes fabric

**Status: PROPOSED** — kasofsk/chuggy#71 is the ticket.

A Kubernetes-Jobs fabric is an adapter answering `src/interpreter/ports.ts` and nothing more: PLATFORM CAPTURE in `model/refinement.qnt` is exactly the claim that this substitution moves no core. A controller-and-CRDs runtime would owe a re-proved sibling of that module; this deployment deliberately does not buy one.

## Spawn, and absorption that outlives the object

One Job per task of the deciding entry's task set, named from the ticket and task ids alone, so a re-delivered emission collides into already-exists instead of a second fan-out. The name is not the whole of absorption: a finished Job is garbage-collected, and a key that dies with its object would let an old re-emission double-spawn — so the adapter also records each served emission key under a unique constraint in its own store, which is the mechanism the ports' promise names.

## The read model

Told only the decision, the effect's position and the ticket, the adapter answers "what do I run" from its own component: a fold of the journal it is handed at the root, to the emission's own seq — never to latest, because a re-emission of an old spawn must see the task set that decision created. The fold is never a source of truth and decides nothing; a delivery it cannot yet serve — a journal read failing, a ticket whose type the catalog lacks, an author the registry cannot resolve — is refused by throwing, so the cursor holds and the row re-emits. Failing closed on a missing grant is the authority split, applied at spawn.

## Completions: a push and a watch

The success path is the worker's own declaration through `src/interpreter/inbound.ts`, acknowledged only after the entry is durable. The failure path is the Job watch: a failed or deadline-exceeded Job is delivered as the fail verdict, which is the model's own decision that infrastructure death and a red verdict are one event. A Job that succeeded but declared nothing is failed after a grace, because a fabric that synthesized a pass would be deciding. The deadline and relaunch limit set on every Job are what discharge the trusted fabric axioms; retry below the cycle stays Kubernetes's.

## The client

A thin client over `fetch` against the in-cluster API — one namespace, one resource kind, a watch — rather than the client library. Refutation trigger: a second watch-resync defect adopts the library, and the dependency's justification writes itself.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R5 | The adapter: catalog, read model, spawn, watch, cancellation | #68, #70 | Proposed |
