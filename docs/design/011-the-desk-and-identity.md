# The desk and identity

**Status: LANDED** — the face and the spawn-time credential resolution are both in the tree, and each rule of the reconciliation now lives in its enforcer's header: the configuration-only, fail-closed spawn in `src/adapters/k8sFabric/k8sFabric.ts`, the reference-transit discipline in `src/interpreter/secretSource.ts`, the author's arrival-time write and the grant join in `src/interpreter/registry.ts`, and the authorship split on the merge in `src/adapters/gitWrapUp/gitWrapUp.ts`.

The desk is an authenticated HTTP face served by the dispatcher, and each module states what it carries: `src/interpreter/registry.ts` is the contract, `src/adapters/httpApi/` is the face, `src/adapters/registrySqlite.ts` holds the allowlist, the annex and the credential grants, and `src/adapters/deskEvents.ts` answers the desk port the interpreter declares.

## Landing

| # | What lands | Depends on | Status |
|---|---|---|---|
| R3 | The face: routes, identity, registry, rendered board | #68 | **Landed** |
| R7 | Spawn-time credential resolution | #69, #71, #72 | **Landed** |
