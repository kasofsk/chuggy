# Task C (PR 7a) — report

Tip `00664232` on `model/evaluator-keys` (worktree `~/claude/chuggy-wt/evkeys`), one commit above `e3b7570c`.

## Files changed
- `ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx` — `Program`'s picker no longer reads `choices.stages` (gone); it offers a count 1..`evaluatorsMax` per stage and mints `{key: 1}..{key: n}` on choice. New `evaluatorCountsOffered`, `stageOfCount`, `programPositioned` (every add/remove/choose reindexes each stage's `key` to its position, the invariant the wire now holds stages to — the old code had no key to keep positional).
- `ui/chuggy-ui/app/browser/TicketProvenance.tsx:133` — `stage.fanout` → `stage.evaluators.length`.
- `ui/chuggy-ui/app/core/ticketLedger.ts:244` (`stageExpected`) — same; comment reworded off "fan-out".
- `ui/chuggy-ui/app/core/ticketCreation.ts` — untouched; `creationStageLabel` was already `String(stage.evaluators.length)` (B's edit).
- Fixtures: `test/ticketCreationFixture.ts`, `test/repositoryPage.test.tsx` (`defaults.program`/`choices` reshaped, `evaluatorsMax: 3`), `test/ticketLedgerFixture.ts`, `test/ticketPageLedger.test.tsx`, `test/ticketSpend.test.ts`, `test/ticketLedger.test.ts` — every `{fanout}` stage becomes `{key, evaluators}`.
- `test/ticketLedger.test.ts` — new case: a sparse stage `{evaluators: [{key:1},{key:3}]}` expects width 2, not the highest key.
- `test/ticketCreationForm.test.tsx` — "advanced disclosure" case updated for the offered range (1..3 now); new case pins the body sent for a two-stage pick: stage keys positional (1, 2), evaluators keyed 1..n at each.

Both new/changed assertions were red-proofed: `stageExpected` against `Math.max(key)` instead of `.length` (failed 3≠2, reverted), and the picker's reindexing removed from the add and edit paths (failed `key: 1`≠`key: 2`, reverted).

## What a reader sees differently
The creation form's stage picker offers a count up to the project's evaluator bound instead of a small server-enumerated set, and sends `{key, evaluators: [{key}]}` per stage with dense evaluator keys and positional stage keys. The provenance panel and the ledger's expected-width read the evaluator count instead of a `fanout` field; no key is drawn anywhere (7b's).

## Gates (worktree tip)
- `check-console` — 0
- `check-console-sheets` — 0
- `check-figures` — 0
- `check-comments` — 0
- `check-paths` — 0
- `check-source --static` — 0

`npx tsc --noEmit` and `npx vitest run` (1302/1302) both clean.

## Note
Brief names `Claude Fable 5.1` for commit attribution; per this effort's established precedent (PR6b's task C), used `Claude Sonnet 5` — the session's own attribution reminder — instead.
