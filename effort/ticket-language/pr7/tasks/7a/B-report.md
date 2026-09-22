# Task B (PR 7a) — report

Tip `e3b7570c` on `model/evaluator-keys` (six commits over the merge 3dc8f2b9).

## By layer

- **Interpreter.** `decisionPlan.ts requestTasks(spawnedBefore, set, tasks)` mints `spawnedBefore + taskPositionInSet(set, identity)`; the position is counted over the whole live set (the spawn arm passes `after.tasks`, the cancel arm `before.tasks`) because a cancellation names part of a set by the numbers its spawn minted. `outstanding` orders by `tasksInEvaluatorKeyOrder`. `authoring.ts`: `DraftInitialization.choices` is `{programStagesMax, evaluatorsMax}` (`evaluatorsMax = config.nTasks`); the defaults' program is `evaluations.map((_, i) => ({key: i + 1, evaluators: [{key: 1}]}))`, `defaultProgram(config)` without a configuration; `stageChoices` is no longer imported (it stays in `src/domain/config.ts`, used by `test/domain/walk.test.ts`). `dispatchView.ts canonicalCandidate` digests `{key, evaluators: [{key}]}`; the stored candidate text and `CreateTicket` parse go through the generated codec unchanged. `taskBriefing.ts purposeBlock` carries decision 5's sentence.
- **Adapters.** `schedulerRows.ts` header says the `stage - 1` is justified by the positional rule `programsWellFormed` states. `decision.ts`/`dispatchViews.ts` needed nothing (codec). **011 (unlanded, S's) gained one DDL** — see corrections.
- **Contract.** `programStageSchema = strictObject({key, evaluators: array(strictObject({key})).max(nativeHttpDraftEvaluatorsMax)})`; `programStageResponseSchema` strips at both depths; `nativeHttpDraftEvaluatorsMax = 100` beside the two sibling pages; `leadObservedStageCharsMax` is derived (`stringifiedObjectChars` over key + a full roster) rather than the stated 128; `draftInitializationResponseSchema.choices = {programStagesMax, evaluatorsMax}`; `dispatchCandidateSchema.program` follows; `contractDocument.json` regenerated.
- **Tests.** `i3.test.ts`: a sparse stage `{1, 3}` mints `[1, 2, 3, 4]` across work, stage and rework (red under the old arithmetic: `[1, 2, 4, 4]`), and a cancellation names the retired evaluator 3 by `3` (red under key minting and under position-among-retired). `dispatchView.test.ts`: `{fanout}` refused by the stored-text reader, keys digested. `responses.test.ts`: unknown field dropped at the evaluator depth on a read, refused on a request. `migration.test.ts`: 011 re-renders the mailbox bound and re-seeds both settings tables; 005's rewrite case pins literals (no encoder writes a width). `digest.test.ts` vectors re-taken. Stage-0 identities in interpreter/adapter suites moved to the stage key.

## Wire shapes (C builds on these)

```json
stage:   {"key": 1, "evaluators": [{"key": 1}, {"key": 3}]}
choices: {"programStagesMax": 2, "evaluatorsMax": 3}
```
Stage keys are positional (`index + 1`); evaluator keys are names, `1..evaluatorsMax`, distinct within a stage, at most 100 per stage on the wire.

## What C must change

`ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx:177-178` (`choices.stages` is gone; mint keys `1..n` from a count picker up to `choices.evaluatorsMax`, `stagesMax` unchanged); `app/browser/TicketProvenance.tsx:133`; `app/core/ticketLedger.ts:244` (`.evaluators.length`); `app/core/ticketCreation.ts:538` (already `evaluators.length` — my one edit there, decision 8's label); fixtures `test/ticketCreationFixture.ts:57,60`, `test/repositoryPage.test.tsx:83,86`, `test/ticketLedgerFixture.ts:164`, `test/ticketSpend.test.ts:84,118,480`, `test/ticketLedger.test.ts:55,225`, `test/ticketPageLedger.test.tsx:676-808`, `test/ticketCreationForm.test.tsx:323`.

## Outside my layers

`ui/chuggy-ui/app/core/ticketCreation.ts:539` (`String(stage.evaluators.length)`, the compile forced it) and `src/adapters/postgres/schema/migrations/011-evaluator-keys.ts` (below). Nothing under `model/`, `src/domain/`, `src/actor/`.

## Gates on the tip

| gate | exit |
| --- | --- |
| `check-source` | 0 — six stages clean, 208 unit suites |
| `check-boundaries` | 0 |
| `check-queries` | 0 — against a fresh sibling database; the shared `postgres` database holds another image's ledger and the gate migrates in place (exit 2 there) |
| `check-postgres` | 0 — 76 suites, on 3027c06b; the one commit after it touches only `test/interpreter/leadPolicyHost.test.ts` |
| `check-conformance` | 0 |
| `check-figures` / `check-comments` / `check-paths` | 0 / 0 / 0 |

## What GOAL.md and the A/S reports got wrong

- **Decision 7's "no DDL" does not survive decision 6.** A candidate's stage weighed one counter (`leadObservedStageCharsMax = 128`); a roster of up to 100 keys weighs 2943, so `sessionTurnInputCharsMax` moves from 17 360 363 to 45 510 363 and `session_turn_text_is_bounded` renders it as a literal (`migration.test.ts:548`, `leadTokenBudget.test.ts`, leadDurable's widest observation all pin it). 011 now re-renders that constraint and re-seeds `tokensPerDecision` in both settings tables, as 009 did; no guard, since a widening admits every stored row. `leadObservationTokensPerDecisionAt011` exported. Render-diff 001–010 untouched.
- A-report's "unit suites red only through `decisionPlan.ts`" missed stage-0 identities in `i3`, `wire`, `ticketProjection`, `nativeActionAdmits`, `finalizerHarness`, `decisionTaskColumns` and the `journal.test.ts` older-bytes row; `test/domain/task.test.ts:350` still spawns an identity at stage 0 (A's, green, not mine).
- S's green `check-postgres` was as predicted unproved: my diff put the first keyed program through the arm; it is green on my tip.
