# Task A — the sum in the model, the goldens, the domain and the actor

Worktree `~/claude/chuggy-wt/escsum`, branch `model/escalation-sum` (off main bd63df14; `node_modules` is linked, never `npm ci` under `ui/`). Read, in order: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` (decisions are settled — build them, do not relitigate), `pr5/survey.md` (§1, §2, §5 and surprises 1, 2, 5, 9, 11 are your map, with file:line), the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` lines 30–70 and 580–625 and 925–970 (the target's escalation and resume arms), `pr3/tasks/A-report.md` and `pr4/tasks/A-report.md` (how the last two model tasks went), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

- `model/`: `Escalation` as GOAL.md spells it; `Ticket.escalation` replacing `reason` and `resumeAt`; `resumeOf`; `decideExecutionBlocked` stamping `WorkExecutionUnavailableEscalated` or `EvaluationBlockedEscalated` by the phase interrupted; the `ExecutionBlocked` event without its `reason`; `retryableIn` = `hasOpenHumanTask`; `deskConsistent` restated over the sum; `refinement.qnt`, `api.qnt`, the model tests and mc suites follow. `check-model.sh` green.
- Goldens: `.chug/tasks/emit-goldens.sh` re-emits the ten; add one aimed at an evaluation set blocked by a wall (`evaluation-blocked.itf.json`) so `ticket-escalated evaluation_blocked_escalated` is walked; `test/golden/manifest.json`, `corpus.ts declaredLabels`, `coverage.test.ts`, `check-model.sh`/`.test.sh` witness roster count.
- `src/domain/generated/modelTypes.ts`, `src/generated/model-api.ts` (regenerated), `src/domain/*` (deciders, enablement, invariants, equality, phase, derived), `src/actor/*`: **semantics 6 alone** — `decisionSemanticsVersionCurrent = 6`, `isDecisionSemanticsVersion` admits 6 only, `storedJournalLegalOn` refuses 1–5 with a doc comment saying why (the rig was wiped; nothing older replays), corrections 1–5 deleted, the three `test/actor/journalAtSemantics*.json` fixtures deleted with their tests, `currentVocabulary`/`supersededSpellings`/`wordAtCurrentVocabulary`/`rowAtCurrentVocabulary`/`eventAtCurrentVocabulary` deleted. In `src/interpreter/wire.ts` delete `parseStoredDecisionEventText` and the three lift call sites (`storedSchedulerCompletion`, `checkedFinalizationSubmission`'s outcome lift, `parseStoredEntry`), and point `parseDraftAuthoring` back at `parseDecisionEventText` — those are the only interpreter edits; list them.
- Tests under `test/model`, `test/domain`, `test/actor`, `test/golden`, `test/conformance` follow.

NOT yours: migrations (S), the rest of `src/interpreter`, `src/adapters`, `src/contract`, `ui/`. Compile reds in those layers from your renames are expected; B turns them green. If a compile forces an edit elsewhere, make the smallest one and list it.

## Gates

`check-model` (slow; run it once on the tip), `check-conformance`, `check-random` (its suite hardcodes a mutant and a seed — run `check-random.test.sh` and `check-conformance.test.sh` too; PR 3 learned this), `check-source` static + unit for your layers (unit reds elsewhere are B's — list them by file), `check-figures`, `check-comments`, `check-paths`, `check-boundaries`. Report each gate's exit on the tip.

## Commits

Small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr5/tasks/A-report.md`: tip, what changed per layer, the new golden and what it walks, every file outside your layers you touched, the unit reds left for B by file, gates on the tip, anything GOAL.md got wrong. Under ~60 lines.
