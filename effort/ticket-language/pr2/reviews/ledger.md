# PR 2 review ledger

| Round | Tip | Verdict | Notes |
|---|---|---|---|
| S (author) | schema/three-deletions e6912751 | — | 005 guard + narrowed CHECKs + settled-row arm + program rewrite + validity v4 + draft functions; 23 mutations; render diff additions-only. Routed: widen the two landing-mode CHECKs for None, settle NULL drafts (S-fix). |
| S-fix (author) | schema/three-deletions f78a96de | — | landing-mode CHECKs widened with None; NULL draft modes rewritten to None (derived from baseline create/revise_draft); 28 mutations. S round 1 review launched on a pinned worktree. |
| A (author) | model/three-deletions c64bb04c | — | five commits; refusals read off the record (zod strips the keys); six dispatch signatures lost config; conformance guard reworked. A round 1 launched on pinned worktree. |
| integration | model/three-deletions 27d510e3 | — | schema f78a96de merged; Task B launched on it. |
| S round 1 | f78a96de | APPROVE | 26 seeded guard shapes; program rewrite derived from encoder; notes: README.md:198 'migration 5' collision (doc pass); stored undecided operation may carry ExecutionBlocked{DependencyRevoked} → semantics question for B. |
| A round 1 | c64bb04c | CHANGES | three prose/fixture lines (stale finalizer field in deciders.test.ts, unparsable config.ts comment, manifest em-dash escapes); deadlock question answered (stuckSet empty, vacuous); tier gap on revoke-from-Escalated. Fixed by orchestrator on model/three-deletions-fix-a. |
| B (author) | model/three-deletions 9a1f7151 | — | None lands nothing; default = repository landing; revokedDependencies off projection + release entry; stored op refusal; 005 gains session_turn re-render + two functions + CHECK; dispatchViewSchemaVersion stays 1. |
| integration | b55c95a4 | — | fix-a 321195a1 merged; B round 1 review and Task C launched. |
| B round 1 | b55c95a4 | CHANGES | (1) revokedDependencies listed for a Revoked ticket, contradicting the contract comment; (2) ascending order unpinned; (3) three `as const` fixtures keep deleted keys. Notes: dead domain derivation; repository landing may be None; per-row subquery cost. → B-fix1 on model/three-deletions-fix-b. |
| B-fix1 (author) | model/three-deletions-fix-b 34039c0c | — | Pending-only read; order pinned; fixtures cleaned; dead derivation deleted; contract doc prose fixed; rig escalation.spec → stranding.spec. B round 2 review launched. |
| B round 2 | 34039c0c | CHANGES | one finding: stranding.spec.ts watched a project-table row that cannot carry the line → orchestrator repointed it at the ticket page; fixture header clause fixed (ORDER BY absence unpinnable). |
| C (author) | model/three-deletions 5abccfee | — | landing picker with None; stages as fanout; blocked-by banner; Repository page Finalizer panel deleted; full ci red only on check-model.test.sh count. |
| integration | dd7e1423 | — | fix-b 597f1e0c merged (1da7cdc9); gate-suite count 3c056c62; orchestrator dropped C's phase re-check dd7e1423. Sweep launched. |
| sweep | dd7e1423 | APPROVE | forty mutations, thirty-six red in a named suite, four unpinned non-defects; two decisions for Geoff: None landing skips approvalRequired; dependableIn admits a stranded dependency. |
| PR | #719 d3a66d0f | open | full ci exit 0; merge held for rig chain 82→84 |
