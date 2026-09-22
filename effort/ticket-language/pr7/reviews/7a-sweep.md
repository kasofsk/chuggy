# Mutation sweep — PR 7a "The program is a plan", whole branch

Reviewed at `7a85b85a` in `~/claude/chuggy-wt/evkeys-sweep`, detached, scope
`git diff e9a6136e..7a85b85a`. Fresh session; I authored none of it. Each
mutation was applied alone, proved to have changed its file, and reverted; the
worktree was byte-clean when removed. Both `node_modules` symlinked, no `npm ci`.

## APPROVE

Ninety-seven mutations over every added or changed behaviour the brief names —
model, domain, actor, interpreter, adapters, 011, contract, console, emitters.
**Seventy-four went red in the narrowest gate or suite that should catch them.
Twenty-three survived; none is a behaviour defect.** Nineteen are provably
equivalent, inert or structurally non-informative; four are proof gaps, gathered
into three findings a cheap case each closes. A fourth finding is one line the
diff made false without touching. The round ships; 1–3 are the ones I would land.

Baseline at the tip, every gate run here and all clean: check-model (115),
check-source (6 stages, 208 suites), check-postgres (76), `migration.test.ts`
(91, own database), check-queries (own database), check-console (1304), and the
other thirteen. `emit-goldens.sh` reproduces all eleven goldens byte for byte.
Render-diff `e9a6136e` vs the tip: 107 added, **zero removed, zero changed** —
001–010 render identically.

## The table — red

| # | mutation | went red in |
|---|---|---|
| q1–q3 | `.qnt` spawn by `1..length`; `retireLive` walks `1..size`; `stageGeneration` at evaluator 1 | `sparseStageSpawnsResolvesAndRetiresTest`, `evaluationResumeWitness` |
| q8–q14 | `.qnt` `stageChoices` dense only; `validPrograms` key off by one; `everyEvaluator` from 0; `defaultProgram` narrowed; `evaluatorKeys` first key alone; `evaluationTaskOf` re-applies `+1`; work retirement key 0 | check-model ×1 each |
| t1 | `sameKeys` drops injectivity | **exactly** `invariants.test.ts:351` — nothing else in check-source, check-conformance, check-random |
| t2, t3 | `sameKeys` drops cardinality / containment | `invariants` ×1 each |
| t5–t14 | TS spawn keys by position; `stageGeneration` at evaluator 1; `isValidProgram` drops the positional key / uniqueness / non-empty / the bound; mirror `stageChoices` dense; `everyEvaluator` from 0; `defaultProgram` narrowed | `deciders`, `config`, `invariants`, `witnesses` |
| t16–t20, t32 | key order reversed; `taskPositionInSet` by key / 0-based / no throw; `evaluationTaskOf` adds `+1`; `evalStage` drops the `-1` | `task`, `invariants`, `deciders` (18 cases for t20) |
| t22, t23 | stage equality drops the key / the roster | `equality` |
| t25 | `stageAt` always reads `program[0]` | check-conformance |
| t26–t28 | mirror `programsWellFormed` positional / uniqueness; `tasksWellFormed` admits an off-program stage | `invariants` ×1 each |
| i1, i2 | the mint by evaluator key / position over the retired set | `i3.test.ts`, both new cases |
| i4, i5, i8 | defaults' stage key from 0 / empty roster; every digested evaluator flattened to 1 | `authoring`, `responses`, `dispatchView` |
| c1–c7 | stage/evaluator schema non-strict; the response stops stripping at the evaluator depth; the roster bound dropped; `evaluatorsMax` 1000; `leadObservedStageCharsMax` back to 128; `choices` keeps `stages` | `responses`, `leadTokenBudget`, `contractDocument` |
| s1–s5 | 011: `fanout` admitted; positional key; uniqueness; non-empty roster; evaluator floor at 0 | `migration.test.ts`, on exactly the row that owns each |
| s6–s9, s11, s12, s16, s17 | the mailbox bound not re-rendered / at 009's figure / the budget not re-seeded; the guard deleted / its remedy stripped; `…At011` off by one; the combinator disjunct; the place from 0 | `migration.test.ts` ×1 each |
| u1–u9 | `stageExpected` highest key / wrong index; provenance draws `stage.key`; the picker offers from 0 / one too many / mints keys from 0 / positions from 0; the reindex dropped from remove / from choose | 1–6 console cases each |
| g1, g2, g3, g5 | the manifest miscounts; the ITF vocabulary drops the stage key / flattens evaluators; `draws.ts` key off by one | check-conformance ×3, check-random |
| a1, a2 | the generated stage codec edited; `contractDocument.json` renames `evaluators` | check-model-api, `responses` |

## Findings

1. **`011-evaluator-keys.ts:171,172,183` — three of the arm's four SHAPE
   refusals are unpinned, and the arm's own header is what states them.**
   `test/postgres/migration.test.ts:4185` holds eight rows, every one
   value-wrong and none shape-wrong. Dropping `NOT command_integer(item->'key')`
   **admits** a stage with no key at all and one keyed `"1"` (`NULL <> place` is
   NULL and a NULL `IF` falls through — S-report's own hole, one field over).
   Dropping `NOT command_integer(entry->'key')` **admits** an evaluator keyed
   `"1"` and raises `invalid input syntax for type bigint` on `"abc"` and `1.5`.
   Dropping `jsonb_typeof(item->'evaluators') <> 'array'` makes `evaluators: 3`
   raise `cannot get array length of a scalar` where the tip returns false —
   the sentence the header argues ("THE SHAPE IS WEIGHED BEFORE THE VALUE, IN
   TWO STATEMENTS AND NOT ONE"). Probed against migrated databases: the tip
   refuses all six shapes cleanly; each mutation survives `migration.test.ts`
   whole, check-postgres (76), check-source and check-queries — and the machine
   half established that table's literals are the arm's *only* coverage. Fix:
   four rows expecting `false` — `[{evaluators:[{key:1}]}]`,
   `[{key:"1",evaluators:[{key:1}]}]`, `[{key:1,evaluators:[{key:"1"}]}]`,
   `[{key:1,evaluators:3}]`. House rule 13.

2. **`src/interpreter/authoring.ts:500` — `evaluatorsMax` off the config cannot
   be proved at any config in the tree.** `config.nTasks` replaced by
   `programStagesMax` passes check-source (208), check-conformance,
   check-random, check-console and check-postgres. The one case asserting it
   (`test/interpreter/authoring.test.ts:46`) runs at `refinementInstance`
   `{nTasks: 1, maxStages: 1}`, where the two bounds coincide; `modelInstance`
   is `{nTasks: 2, maxStages: 2}`, coincident too, and `test/domain/configs.ts`
   holds nothing else. The failure: the picker offers `1..evaluatorsMax` and
   mints keys from it, so where `nTasks < maxStages` the form mints keys
   `src/domain/config.ts:80` refuses — a refusal with nothing on the form to
   fix, the failure round 1 surface named for the remove path — and where
   `nTasks > maxStages` the reader cannot pick a roster the server admits. Fix:
   assert `draftInitializationPolicy({nTickets: 3, nTasks: 3, maxStages: 2})
   .choices` is `{programStagesMax: 2, evaluatorsMax: 3}`. House rule 13.

3. **`ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx:122` — the picker's
   ADD path reindexes and nothing pins it.** Dropping `programPositioned` from
   `stageAdded` alone passes 1304 console cases, check-console,
   check-console-sheets and `tsc --noEmit`. Input: default program, "add stage",
   submit without touching the count — today sends `[{key:1,…},{key:2,…}]`,
   without the reindex two stages both keyed 1, which `src/domain/config.ts:80`
   refuses. Both new form cases change a count after adding and the choose path
   reindexes, so the add path's own reindex is masked by theirs. This is the
   third arm of round 1 surface's finding 2: choose and remove are now pinned,
   add is not. Fix: one case that adds a stage and submits without choosing.

4. **`test/domain/task.test.ts:347-350` — a fixture that now names an identity
   the machine refuses, under a comment that still reads as the old offset.**
   `evaluated()` builds `evaluationTaskOf(1, cycle, 0, 1, evaluator)`; with the
   `+1` gone from `evaluationTaskOf` that writes `stage: 0`, which
   `taskIdentityValid` (`src/domain/task.ts:242`) refuses, and the comment above
   still says "One evaluator of stage zero judging `cycle`" — true of the index
   it meant, false of the key it now writes. No assertion reads the stage, so
   nothing reddens. Not in the diff, and false because of it: the class this
   branch already took twice (`model/domain.qnt:185`). Fix: pass `1`, say one.

## Survivors that are not findings

- **q4–q7 — structurally non-informative.** Weakening `.qnt`
  `programsWellFormed` (positional key, uniqueness) or `tasksWellFormed` (width,
  key set) cannot red an invariant *search*; the model red-proofs no invariant.
  Each has a mirror that IS pinned: t26, t27, t2, t3.
- **q15, q16, t7, t29, t30 — provably equivalent.** `stageGeneration` at the
  LAST listed key (model and mirror): every run spawns one of every listed key.
  `e.stage == s + 1` for `program[s].key`, three sites: identical wherever
  `programsWellFormed` holds, which is everywhere it is read.
- **t15 — inert.** A work task's retirement key 0 instead of 1: a work set is
  one task, and in TS the value is only a sort key. The model's
  `range(1, highest + 1)` walk is what needs the 1, and q14 reds it.
- **i3, t31, g4 — inert.** `outstanding`, `outstandingTasksIn` and the ITF
  live-set encoding unsorted redden only on the now-unused import (TS6133): the
  mint reads `taskPositionInSet` off the set, so list order names nothing, and a
  JS Set's insertion order is the roster's, ascending by construction. No golden
  draws a descending roster.
- **i7 — provably equivalent.** `canonicalCandidate` dropping `key` loses
  nothing: a stage's key is its array position, and `dispatchView.test.ts:73`
  varies the roster and the program length, both still distinguishable.
- **s14 — inert.** Without `jsonb_typeof(item) <> 'object'` a scalar or array
  item answers `? 'fanout'` false and `item->'key'` NULL, so the value checks
  refuse it anyway; four probed shapes, verdict unmoved.
- **u11, u12 — round 1 surface's reads, re-confirmed on a clean mutation.**
  `stageAdded`'s `Math.min` clamp (house rule 9; the only reachable over-wide
  `last` is a synthetic default) and `creationStageLabel` (one caller, a React
  list key). Neither is behaviour.

## Docs pass and fabric alignment

Finding 4 is what the docs pass turned up. Everything else the diff touches
reads true, checked on the code: `011`'s "as 004, 005 and 009 each re-rendered
it at theirs" (all three carry that `ALTER TABLE`) and
"`execution_request_task.evaluator` NEEDS NO RESTATING … both are positive"
(`010:125` bounds it `>= 1`, no ceiling); `taskBriefing.ts:467`'s "every
evaluator of a stage runs the stage's block, whatever key it carries"
(`purposeBlock` reads `stage`, never the evaluator); `decisionPlan.ts:97`'s "a
stage keyed `{1, 3}` spends two of the count and would mint three" (and i1 reds
it); `ticket.qnt`'s `retireLive` "bounded by the largest key the set holds" and
`stageGeneration` "at the stage's FIRST LISTED evaluator key";
`schedulerRows.ts:15`'s "one less because a stage's key is its position — the
rule `programsWellFormed` states"; `config.ts`/`domain.qnt` `stageChoices`
"every non-empty ascending list of distinct keys" (the fold appends in ascending
order). The brief's package check: `model/ticket.qnt:117,128` are
`evaluation.qnt`'s two types at pin 76c95a9 minus `task`, field for field, and
`evaluatorKeys` is its body verbatim, so 7b's copy renames nothing;
`programsWellFormed` is `planValid` minus `taskDefinitionValid`, plus
`MAX_STAGES`, the `N_TASKS` bound and `key == i + 1` (subsuming
`stageKeysUnique`). The branch states no lesson (house rule 16).

**Fabric alignment: clean.** Nothing under `.chug/`, `images/` or `deploy/`
names `fanout`, a fan-out, `choices.stages` or a stage width, and neither does
`~/claude/chuggy-fabric`. The `stage` hits in `images/worker/` are the
Dockerfile's build stages and the worker's own check stage, neither moved here.

## Notes

- **On the `sameKeys` fix, as the fresh eyes the addendum asked for.** Removing
  the injectivity conjunct reddens `invariants.test.ts:351` and **nothing else**
  across 208 suites, check-conformance and check-random, so that case is exactly
  informative. The same seam elsewhere: `spawnEvalStage` maps `stage.evaluators`
  (a list) where the model maps `evaluatorKeys` (a value-Set), so a roster
  naming one key twice would spawn two JS tasks against the model's one —
  refused upstream by `isValidProgram`, `programsWellFormed` and 011's arm, each
  red-proved here (t9, t27, s3). `taskPositionInSet` and
  `tasksInEvaluatorKeyOrder` read keys, not object identity; `equality.ts`
  compares rosters positionally, stricter than the model rather than weaker.
  Nothing else admits a state the model refuses.
- `programStageSchema` still has no `.min(1)` and no positional check at the
  parse; `isValidProgram` answers both and no console path can send either.
  Round 1 surface raised the first and the machine half did not take it; I am
  not flagging it either — which layer answers is not a failure that happens.
- I did not mutate the goldens' step bodies: they are the model's output and
  `emit-goldens.sh` owns them. I mutated the manifest (g1), the ITF vocabulary
  (g2–g4) and the walk's draws (g5) instead.
- Practices invoked: `comments-describe-the-code` (the docs pass) and
  `modular-and-layered-code` (findings 1 and 2 are its "test hardest at
  boundaries" — the mailbox and the authoring policy are the two this PR moved).
- Worktree `evkeys-sweep` removed; every database this sweep made
  (`evkeys_sweep_queries`, `evkeys_s13`, `evkeys_s14`, `evkeys_s15`,
  `evkeys_s18`) dropped.
