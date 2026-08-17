# The runtime

**Status: LANDED** — R2 has landed; kasofsk/chuggy#68 was the ticket.

The deployment runs the single-process journaled actor `model/refinement.qnt` proves — the same machine, driven by a fourth pure layer rather than a second impure one. `src/runtime/` is that layer and each module states what it carries; the boundary rules are `.dependency-cruiser.cjs`'s, the ambient ban is `eslint.config.js`'s, and `src/compose.ts` is the entrypoint the start script names.

## What would refute this

The reactive position fails the day an obligation requires the runtime to act with nobody calling — the lease timeout 004 pre-names is the candidate — and that day buys a refinement sibling in `model/`, not a timer smuggled into the layer.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R2 | The four modules, the two rules, the eslint block, the entrypoint | #66, #67 | **Landed** |
