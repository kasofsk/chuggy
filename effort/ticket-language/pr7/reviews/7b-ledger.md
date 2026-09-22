# PR 7b — review ledger (branch `model/evaluation-instance`)

| round | tip | reviewer | verdict | fix |
|---|---|---|---|---|
| 1 machine | 64a95abe | opus, fresh | CHANGES: durable unreadable spawn defers forever and wedges the project writer (finalizer-rework bundle lacks Repository); privileges guard vacuous; wall evidence over-attached; AGENTS.md nit | E (`tasks/7b/E.md`, branch `fix/evaluation-instance-machine`) |
| 1 surface | 64a95abe | opus, fresh | CHANGES: superseded generations leave the ledger but stay in sums; resumedFrom `.find`; "cancelled" copy; a block skips later stages; adjacent: ProcessFailed rows drawn Failed | D (`tasks/7b/D.md`, ui only) + orchestrator console mapping after E's roster change |
| sweep | 2acc04d1 | opus, fresh | APPROVE: 137 mutations, 113 red, 0 behaviour defects; 8 proof/doc gaps | orchestrator pinned all eight, 62a65fd4 (red-proved the arm row and the complete fold) |

## Build

- A landed 1c885b36 (`tasks/7b/A-report.md`); S landed 280b9dec (`S-report.md`); merged 0d2e1639.
- B (opus) on `model/evaluation-instance` from 0d2e1639, brief `tasks/7b/B.md` + Addendum (codec spelling, `in_on_failure`, exhausted-retry outcome, slot mint).
- C landed 4185edb9 on `console/evaluation-instance` (`tasks/7b/C-report.md`), its own worktree `~/claude/chuggy-wt/evinst-console`; merged into the model branch after B.
- B landed 3545efa9 (`tasks/7b/B-report.md`); C merged 72a8029b; orchestrator folded three test clones 64a95abe (affected gates clean but for duplication at 72a8029b: `ci-affected-7b-build.log`).

Tip for round 1: 64a95abe. D landed 0b037997 (ui); E pending.
- E landed 10cb02ac (`tasks/7b/E-report.md`), merged a31c6e1f; orchestrator console mapping 2acc04d1; affected gates clean (`ci-affected-7b-round1.log`).

Tip for sweep: 2acc04d1.

PR #731 opened on 62a65fd4; full roster clean at 2acc04d1 (`ci-full-7b-2acc04d1.log`), re-run on 62a65fd4 (`ci-full-7b-62a65fd4.log`).
