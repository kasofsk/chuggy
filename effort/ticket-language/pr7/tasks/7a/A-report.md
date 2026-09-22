# Task A (PR 7a) — report

Branch `model/evaluator-keys`, worktree `~/claude/chuggy-wt/evkeys`, tip **b8937233**, four commits off `origin/main` (e9a6136e): the first agent's model commit 12715708 and three of mine.

## Per layer

- **`model/`** (12715708, reviewed and kept) — `EvaluatorDefinition = {key}`, `StageDefinition = {key, evaluators}`; `evaluatorKeys`; `evaluationTaskOf` applies no offset; `spawnEvalStage(j, ticket, s)` reads `program[s]`; `stageGeneration` counts at the stage's first listed key; `retireLive` walks `1..highest key in the set`; `taskOrdinal` → `taskRetirementKey`; `evalStage` reads `stage - 1` under the positional rule stated once at `StageDefinition` and at `programsWellFormed`. `domain.qnt`: `everyEvaluator`, `stageChoices` = every non-empty ascending roster from `1..N_TASKS`, `validPrograms` with positional keys, `defaultProgram = [{key: 1, evaluators: everyEvaluator}]`, the three `.fanout` spawn reads gone, `programsWellFormed` as decision 2. **My one model change (05d74d78):** `tasksWellFormed` had dropped the width conjunct and held only `keys == evaluatorKeys(program[s])`; I put `tasks.size() == program[s].evaluators.length()` beside it so the model states what the mirror's `sameKeys` already checked.
- **`test/golden/`** — re-emitted in 12715708 (the addendum's "not yet" was stale): eleven rows, same seeds, step counts moved in five manifest rows. Every golden but `work-execution-unavailable` carries a sparse stage `{2}` (e.g. `walk` 31 states, `evaluation-blocked` 20); no scenario needed extending.
- **`src/generated/`, `src/domain/generated/`** — regenerated (`check-model-api` clean on the tree as found); `ApiEvaluatorDefinition` exported.
- **`src/domain/`, `src/actor/`** (d52f5371; the first agent's uncommitted diff, kept except one stale "ordinal order" comment in `enablement.ts`) — `config.ts`: `everyEvaluator`, `stageChoices` returns rosters, `isValidProgram` as decision 2. `ticket.ts`: `stageAt`, `spawnEvalStage(ticket, id, index)`, `stageGeneration` at the first listed key. `task.ts`: `taskRetirementKey`, `tasksInEvaluatorKeyOrder`, `retiredInEvaluatorKeyOrder`, and `taskPositionInSet(tasks, identity)` (decision 4's position-in-set, uncalled until B). `invariants.ts`: `tasksWellFormed` by `sameKeys` against the listed keys, `programsWellFormed` as decision 2. `deciders.ts`: the three spawn sites pass an index only. `actor/equality.ts`: a stage compares key and roster.
- **Suites** (b8937233) — every `{fanout}` fixture is `{key, evaluators}`; every identity a suite names carries the stage key (`evalTask(1, 1, 1, …)`, not `0`). New: sparse stage through spawn/resolve/retire and its second generation; `retireLive` of `{1, 3}` keeps both; `taskPositionInSet`; `tasksWellFormed` on a sparse program; `isValidProgram` refuses an empty roster, key 0, a repeated key and an off-position stage key. Red-proved one mutation at a time (retire by a `1..size` walk, generation at evaluator 1, spawn by count, key comparison dropped): each turns exactly its own case red. `walk.test.ts` derives the program count from `stageChoices` (12 at the reference instance).

## `StageDefinition` in the mirror (B and C build on this)

```ts
type EvaluatorDefinition = { readonly key: number };
type StageDefinition = { readonly key: number; readonly evaluators: readonly EvaluatorDefinition[] };
```
`evaluationTaskOf(ticket, workCycle, stage, generation, evaluator)` takes the stage **key** (no `+ 1`); `spawnEvalStage(ticket, id, index)` and `stageGeneration(ticket, index)` take the index and read `stageAt`. `stageChoices(config)` is `readonly EvaluatorDefinition[][]` (rosters), `everyEvaluator(config)` the full one.

## What B and C must change

B (typecheck reds, exactly B's sites): `src/interpreter/authoring.ts:451,489-495` (`choices.stages` → `evaluatorsMax`, defaults mint `{key: i+1, evaluators: [{key: 1}]}`); `src/interpreter/decisionPlan.ts:35-36,69-70,101` (`tasksInEvaluatorKeyOrder`; mint `spawnedBefore + taskPositionInSet(tasks, identity)`); `src/interpreter/dispatchView.ts:101`; `src/adapters/http/codecs.ts:74`; `src/adapters/http/contract.ts:277`; `src/contract/authoring.ts:25`; `src/contract/http.ts:538` (doc); `test/adapters/httpOutcomes.test.ts:444`; `test/contract/representations.ts:112,191`; `test/contract/responses.test.ts:999`; `test/interpreter/dispatchView.test.ts:87`; `test/interpreter/leadPolicyHost.test.ts:97`; `test/interpreter/leadTurn.test.ts:49`; `test/interpreter/selector.test.ts:490,509,524,2539,2644,2784,2804,2836,2922,3024,3030,3145,3455,3486`; `test/postgres/leadDecision.test.ts:153,162`; `test/postgres/migration.test.ts:1893`. Unit suites red only through `decisionPlan.ts`: `test/adapters/{composeFinalizerRuntime,composeRepositoryCredentials,decisionTaskColumns}.test.ts`, `test/interpreter/{dispatchWriter,i3,projection,ticketServiceRun}.test.ts`. Lint red: `decisionPlan.ts:69-70,101` (unresolved imports).

C: `ui/chuggy-ui/app/browser/TicketProvenance.tsx:133`, `app/core/ticketLedger.ts:244`, `app/core/ticketCreation.ts:539` (decision 8).

## Files outside my layers touched

None. `git diff origin/main..HEAD --stat` is entirely under `model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/{actor,domain,generated,itf,random}/`.

## Gates on the tip

| gate | exit |
| --- | --- |
| `check-model` | 0 (log: `pr7/check-model-7a-A.log`, 115 tests, 0 failures) |
| `check-conformance` | 0 (11 goldens, 189 steps) |
| `check-random` | 0 (2000 runs, 80000 steps) — seed unmoved |
| `check-model-api` | 0 |
| `check-source` | 1 — typecheck, lint and unit entirely B's files above; `residue`, `browser`, `format` clean; in-scope unit suites 197/197 |
| `check-figures` | 0 |
| `check-comments` | 0 |
| `check-paths` | 0 |

## What GOAL.md got wrong

Nothing that could not be built. Two notes: decision 3's `retireLive` walks `1..highest key in the set` (bounded by `N_TASKS` through `programsWellFormed`) rather than sorting, which is ascending-by-key as asked; and the addendum's "goldens are not yet re-emitted" was already false at 12715708. Task S's field names (`key`, `evaluators`) are the mirror's exactly.
