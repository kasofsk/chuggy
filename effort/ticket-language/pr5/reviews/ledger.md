# PR 5 review ledger

- Round 1 tip: **3d994ce8** (A 6c3cf9b0 · S de43ec16 · B dc111b8b · C 8c72995a · orchestrator split one over-long test). Two halves: machine (`brief-round1-machine.md`) and surface (`brief-round1-surface.md`).
- Round 1 surface (3d994ce8): CHANGES — unpinned kind/evidence labels (two mutants survived), stale `NoPoint` comment and two test comments, `resumePoint.ts` orphaned. Fixed by the orchestrator → ab93efd0 (exact-map + no-collision pins for both label maps, both reviewer mutants red-proved; comments rewritten; module and its two suites deleted). Surface gates 0. Machine half pending.
- Round 1 machine (3d994ce8): CHANGES — one finding, the two `execution` grants unproved (guard-fails-open). Fixed by the orchestrator → d7691240 (grant loop extended; red-proved: removing the grants fails the case naming the column). Everything else checked clean. Sweep launched at d7691240.
- Sweep (d7691240): APPROVE — 89 mutations, 72 red, 17 survivors none a behaviour defect; six cheap findings (five proof gaps, one stale sentence in `rosters.ts`). check-model 0 at d7691240 (orchestrator). The six are the orchestrator's (small fixes).
- F (orchestrator): the six pinned in one commit; M22, M17, M47, M37, M66 re-applied and each new case RED, reverted GREEN. origin/main merged; full roster running.
- Roster at d51c8215: check-postgres red on a pre-existing flake (workerCatalog published_at); fixed df5a79b2, gate clean. PR #726 merged, main 62574ae8.
- Released to the rig 2026-09-21 ~18:20Z with the ticket wipe (fabric #287); machine path exercised end to end on the new schema (create, dispatch, fail, escalate, revoke).
