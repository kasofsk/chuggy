# Review round 1, surface half — PR 5 "Escalated is a sum" (branch `model/escalation-sum`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/escsum-review-surface <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/escsum-review-surface/node_modules

Never `npm ci` under `ui/`. Your half: `ui/chuggy-ui/app`, `ui/chuggy-ui/test`, `test/ui`, `src/contract/responses.ts` and `rosters.ts` as the console reads them. Diff: `git diff bd63df14..<tip> -- ui test/ui src/contract`.

Read first: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` ("The wire folds", "Console"), `pr5/tasks/{B,C}-report.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check

1. Every surface survey §4 lists (`pr5/survey.md`): does each switch on `escalation.kind` with no arm missing and no raw kind string reaching the page? `git grep -n "reason\b\|resumeAt\|executionBlockedBy\|finalizationBlockedBy\|lastSet" ui/chuggy-ui/app test/ui` — anything left must be justified.
2. `EvaluationBlockedEscalated`'s label, sentence, tone, detail line and resume sentence: present in every surface that draws the other five; copy per the standard (nouns, one-word statuses, one short line, no internals).
3. Evidence labels: every name in `blockedReasons`, `gitEvidences` and `finalizationUnavailableKinds` has a label; an unknown name does not crash the page.
4. Resume: the offer is drawn from `escalation.resumeAt`; nothing recomputes it; `ResumeOffer.NotRead` is gone with its producer; the Inbox pill and badge for an escalated ticket still draw.
5. Tests: `test/ui/resumePoint.test.ts`, `ticketActions.test.ts`, and the console's own tests pin each arm; mutate two labels and one switch arm and confirm a test reddens.
6. Gates at the tip: `check-console`, `check-console-sheets`, `check-source`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr5/reviews/round1-surface.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~60 lines. Remove your worktree when done.
