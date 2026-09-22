---
name: simplify-effort-2026-09-14
description: The simplify effort launched 2026-09-14 off the code audit; eleven wave-one tasks in chuggy-wt/simplify-* worktrees, ledger and briefs under ~/claude/chuggy-effort/audit-2026-09-14/simplify/
metadata:
  type: project
---

Geoff (2026-09-14) turned the audit into work: simplify and reduce footprint,
no feature or behaviour change except (a) build the repeatable-routine
mechanism so future create_draft/revise_draft changes are a diff, without
touching existing migrations, and (b) retire ui/console, porting what only it
has into ui/chuggy-ui. No regressions, no weakened guarantees; the best PR
removes the most code. Subagents at my discretion.

Effort dir: `~/claude/chuggy-effort/audit-2026-09-14/simplify/` — BRIEF-common.md,
tasks/T*.md (ownership per task), LEDGER.md (PR/review/merge state), reviews/.
Worktrees: `~/claude/chuggy-wt/simplify-<task>`, branches `simplify/<task>`,
postgres ports 55441-55451 one per task.

Wave 1 (parallel): T1a roots, T1b http/contract, T1c forge/git/k8s readers,
T2 interpreter parsers→zod, T3 interpreter machines+dead, T4 nativeWeb+selector,
T5 postgres routines, T7a retire console, T7b chuggy-ui cleanup, T8 gates/worker,
T9 model. Wave 2: T6 test fixtures after wave 1 merges. Follow-ups listed in
LEDGER.md (ledger digest, mirror arm, legacy worker config, fabric chuggy-web
manifest removal).

**How to apply:** each PR gets a fresh reviewer per [[review-discipline]]
(brief = task file + intended behaviour + diff, no author notes), a mutation
sweep as second review on guard-heavy ones (T5, T8, T9), then I integrate,
run full ci.sh, and merge per [[merge-authority-2026-08-31]]. Update LEDGER.md
at each step. Related: [[code-audit-2026-09-14]], [[parallel-agent-worktrees]].
