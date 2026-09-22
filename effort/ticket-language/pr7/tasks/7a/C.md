# Task C (PR 7a) — the console sends evaluator keys and draws a stage as its count

Worktree `~/claude/chuggy-wt/evkeys`, branch `model/evaluator-keys`, which carries A, S and B. `node_modules` is a symlink to the root's; never `npm ci` under `ui/` (`cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Read: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7a — decisions" (8 is yours), `pr7/survey.md` §6, `pr7/tasks/7a/B-report.md` §"What C must change" and the wire shape of a stage and of `choices`, `pr6/tasks/6b/C.md` and `C-report.md`, the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`ui/chuggy-ui/` only.

- `app/core/ticketCreation.ts` and the creation form: the picker keeps its count per stage, bounded by `choices.evaluatorsMax`; the body sent is `{key: <position>, evaluators: [{key: 1}..{key: n}]}` per stage; `creationStageLabel` draws the count. `TicketProvenance.tsx` draws `n×` from `evaluators.length`. `ticketLedger.ts`'s expected width reads `evaluators.length`. Nothing draws a key (decision 8).
- Fixtures under `test/` follow; every case that built a `{fanout}` stage builds `{key, evaluators}`; one case pins the body sent for a two-stage pick (keys positional, evaluators `1..n`); one pins the ledger's width for a sparse stage (`[{key: 1}, {key: 3}]` → 2).
- Copy per the standard: nouns, one short line.

## Gates on the tip

`check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`. Report each exit.

## Commits

On `model/evaluator-keys`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7a/C-report.md`: tip, files changed, what a reader sees differently, gates. Under ~30 lines. Write the report, reply with its contents, and stop.
