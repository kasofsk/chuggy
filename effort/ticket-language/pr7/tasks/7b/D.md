# Task D (PR 7b) — round 1 surface fixes

Worktree `~/claude/chuggy-wt/evinst`, branch `model/evaluation-instance`, tip 64a95abe. `node_modules` links to the root's; never `npm ci` under `ui/`. Scope `ui/chuggy-ui/` only. Read `~/claude/chuggy-effort/ticket-language/pr7/reviews/7b-round1-surface.md` (the verdict you are fixing), `pr7/tasks/7b/C.md` and `C-report.md`, `pr6/tasks/6b/E-report.md` (how 6b drew a superseded run), the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`.

Fix all four findings and the three non-blocking notes, each with a case that reddens without the fix:

1. **Every generation is a row.** An evaluator's earlier generation stays on the ledger beneath the one that replaced it, drawn as what it was (Blocked, Failed) and toned as superseded, so the rows a reader reconciles spend on sum to the cycle's rollup and the head's count. The stage's verdict and `expected` still read off the highest generation.
2. **`resumedFrom` names the stage resumed now**: the highest-numbered stage with a generation above one whose top generation is running, else the highest-numbered such stage; the reviewer's page (stage 1 resumed and settled, stage 2 resumed and running) says stage 2. Pin it so `.find` and `row.kind === "Ran"` both redden.
3. **`codeLabels.ts` "Evaluation blocked"**: the one line says a stopped evaluator parked the ticket and a resume asks it again; nothing is cancelled.
4. **A block parks the plan**: the stages after a blocked stage draw Queued, not Skipped; `ticketLedger.test.ts:251` moves to the new reading. Skipped stays for a failed stage.
5. One spelling for a generation in `runTotals.ts` (the model's word, "generation N"); `tones.ts standingTone` deleted with its test if nothing else reaches it; `ticketLedgerFixture.ts:6` describes what the fixture is now.

Out of scope, decided elsewhere: how an exhausted-retry evaluator's execution row is told apart from a failed one (the surface reviewer's adjacent note).

Gates on the tip: `check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`, `check-duplication`. Commits on the branch in the tree's voice ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Report to `pr7/tasks/7b/D-report.md`: tip, each finding's fix and its case, gates; under ~30 lines. Write the report, reply with its contents, and stop.
