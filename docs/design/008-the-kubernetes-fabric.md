# The Kubernetes fabric

**Status: R5 LANDED** — `src/adapters/k8sFabric/` answers the fabric port, with its suite against an in-process fake of the Jobs API; the live-cluster demonstrable — a kind cluster running real Jobs that curl their completions back — stays open on kasofsk/chuggy#71.

What the adapter enforces it now states in its own headers: the spawn's two-layer absorption and its ordering in `src/adapters/k8sFabric/k8sFabric.ts`, the emission-seq fold in `src/adapters/k8sFabric/resolve.ts`, the failure-only watch and its grace in `src/adapters/k8sFabric/watch.ts`, the axiom-discharging catalog in `src/adapters/k8sFabric/catalog.ts`, and the client's refutation trigger for adopting the library in `src/adapters/k8sFabric/client.ts`.

What no header can carry is the road not taken: a controller-and-CRDs runtime would owe a re-proved sibling of PLATFORM CAPTURE in `model/refinement.qnt`, and this deployment deliberately does not buy one.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R5 | The adapter: catalog, read model, spawn, watch, cancellation | #68, #70 | **Landed** |
