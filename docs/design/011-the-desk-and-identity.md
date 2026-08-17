# The desk and identity

**Status: R3 LANDED** — the face, identity and the annex are in the tree; kasofsk/chuggy#73 carries the spawn-time credential resolution, which is not.

The desk is an authenticated HTTP face served by the dispatcher, and each module states what it carries: `src/interpreter/registry.ts` is the contract, `src/adapters/httpApi/` is the face, `src/adapters/registrySqlite.ts` holds the allowlist and the annex, and `src/adapters/deskEvents.ts` answers the desk port the interpreter declares.

## Per-user credentials against the node-grants rule

The two reconcile at one point: the author is written by the authenticated desk at arrival and never changes, and at spawn the resolution reads configuration alone — the registry row and the task-type catalog — so nothing a work task writes can influence which credential reaches a job, and a subject with no stored grant fails the spawn closed. Credentials transit as references; the material moves only between the secret store and the job the spawn named.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R3 | The face: routes, identity, registry, rendered board | #68 | **Landed** |
| R7 | Spawn-time credential resolution | #69, #71, #72 | Proposed |
