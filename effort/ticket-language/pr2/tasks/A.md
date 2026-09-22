# Task A (PR 2): the model loses NoFinalizer, the cascade and AnyPass

Worktree `~/claude/chuggy-wt/three-deletions`, branch `model/three-deletions`
from main 617675bb. Read `.chug/tasks/review-change.md`, then `GOAL.md` in
this directory (the whole design), then PR 1's `../tasks/A.md` and
`../reviews/A-round1.md`/`A-round2.md` for the prose failures that round
caught (stale citations of deleted symbols, quantities in comments, a
header claiming a property the code no longer has).

Scope, in order, committing per coherent step:
1. `model/ticket.qnt`, `model/domain.qnt`, `model/refinement.qnt`,
   `model/mc/`, `model/tests/`: the three deletions per GOAL. Every comment
   that argues the cascade (ticket.qnt ~45, ~158, ~260–282; domain.qnt
   ~20, ~106, ~173–182, ~222–255, ~298–357, ~704–729, ~1145, ~1184+) is
   rewritten or deleted, never left citing `cascadeSafety`,
   `DependencyRevoked`, `NoFinalizer` or `AnyPass`. `check-model.sh`'s
   witness roster loses `cascade` and `wrapup_none`. The refinement's
   hazard/witness suites lose whatever named them.
2. `.chug/tasks/emit-goldens.sh` / `test/golden/manifest.json`: drop
   `nofinalizer-completion`; regenerate every golden with the pinned quint;
   `test/golden/corpus.ts` and `coverage.test.ts` follow.
3. `src/generated/` and `src/domain/generated/` via the generator;
   `src/domain/` (deciders, config, invariants, derived, ids, state,
   witnesses): the same deletions, plus the new pure
   `revokedDependencies(core, id): readonly TicketId[]` (a dependency of
   `id` whose phase is Revoked, in id order; empty otherwise — direct deps
   only, since a transitive one is blocked through its own parent).
4. `src/actor/decisionSemantics.ts`: version 4 per GOAL, header updated in
   its own voice (it now has five corrections and one divergence — say so
   in words, no count). `storedJournalLegalOn` refuses the three shapes.
   Tests for each refusal and for the two dropped-key acceptances at ≤3,
   red-proofed by named mutations.
5. `check-conformance`, `check-random`, `check-model`, `check-boundaries`,
   `check-comments`, `check-figures`, `check-paths`: green. `check-source`
   will be red on interpreter/contract/console files B and C own — list
   them by path in the report and nothing else.

Do not touch `src/interpreter`, `src/adapters`, `src/contract`, `ui/` or
the migrations beyond what the typecheck forces; if a type change forces
an edit there, make the minimal one and list it. Commit messages end
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `--no-verify`
only for the check-source red you listed. Report to
`tasks/A-report.md`: commits, what each gate said, every mutation that
red-proofed a test, decisions the brief did not make.
