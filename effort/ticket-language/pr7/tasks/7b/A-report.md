# Task A (PR 7b) — report

Branch `model/evaluation-instance`, worktree `~/claude/chuggy-wt/evinst`, tip **1c885b36**, ten commits off `origin/main` (f8d6c8fd).

## The copy against the package

`model/ticket-domain/evaluation/evaluation.qnt` diverges in **six** hunks, not four; the extra two are forced by the first and are listed in `model/AGENTS.md` with the reason. `EvaluatorDefinition` keeps `key` alone, `EvaluationInput` keeps `ticket` and `workResult`, `planValid` drops `taskDefinitionValid`, `invariant` drops `acceptedSourceRef > 0` — and then `currentTaskObligations` must yield `List[TaskIdentity]` (no definition is left to complete a `TaskObligation` with) and `applyProduced` must take the result REFERENCE where the package takes a `ValidatedTaskResult`. `diff` prints exactly those hunks and nothing else.

## Per layer

- **`model/`** — `ticket.qnt` imports the copy and drops its own `EvaluatorDefinition`/`StageDefinition`; `Ticket.evaluations: List[EvaluationInstance]` replaces `record`, `tasks` is the work cycle's one task, `stageGeneration` is gone, `TaskOutcome` loses `Cancelled` (`retireLive` empties the set, so nothing produces it). `TaskDone{ticket, task, report, onFailure}` is the only completion; `EvalReduce` and `ExecutionBlocked` are gone and the stage-conclusion arms live in the completion decider. `domain.qnt` roster: `evaluationsWellFormed`, `evaluationsMonotone` (ghost `prevEvaluations`), `idsAccounted` restated as a SLOT count. `refinement.qnt`, `api.qnt`, `mc/` follow; `mc_chuggy_directed` gains `partialEvaluationResumed`.
- **`test/golden/`** — twelve rows, 208 steps, seeds unmoved. One scenario needed extending: **`evaluation-blocked-resume`** (directed, aimed by `not(lastStep.label == "ticket-resumed" and partialEvaluationResumed)`), because every wall's resume carries the same label and a partial resume cannot be aimed by one. Its last state is the required shape — evaluator 1 `Produced(EvaluatorPassed(1))`, evaluator 2 `Awaiting`, generation 2. `rework-wall-resume`'s invariant now reads `currentInstance(...).state`. A stage passing at generation 1 is `eval-stage-passed`; a failure reworking is `rework-started-eval-failure`; a sparse stage is carried by nine of the twelve.
- **`src/domain/`** — new `evaluation.ts` is the protocol's TS mirror and the only thing that moves an instance; it also holds the structural equalities over the protocol's shapes. `ticket.ts` gains `currentInstance`, `withInstance`, `instanceRuns`, `runSpawnTotal`, `evaluationSpawnTotal`, `spawnEvalRun`, `beginEvaluation`, `liveTasks`, `owesTask`, `applyTaskReport`, `reportValid`, `reportMatchesTask`, `evaluationFailureReworksStarted(ticket)`. `program.ts` is `allPassed`; `enablement.ts` has `completableIn` in place of `taskPhaseIn` and loses `reducibleEvalIn`.
- **`src/actor/`** — `taskDoneEvent(ticket, task, report, onFailure)`; `equality.ts` delegates to `instanceEquals`.
- **Suites** — every fixture is built by the protocol (`judgedInstance`, `runningInstance`, `blockedInstance`, `rosterOf` in `test/domain/fixtures.ts`); the equality roster reaches `EvaluationInstance`, `EvaluationProgress` and `StageRun`. Every new conjunct was red-proved one deletion at a time: two cases were being caught by a neighbouring conjunct and now stand on a ticket past Evaluation, and `evaluationsMonotone`'s length conjunct was deleted as redundant with the per-index read (the model needs it; TypeScript does not).

## The shapes S, B and C build on

```ts
type Ticket = { …; readonly evaluations: readonly EvaluationInstance[]; … };  // `record` is gone
type EvaluationInstance = { workCycle: number; input: EvaluationInput; plan: EvaluationPlan; state: EvaluationState };
type TaskTerminalReport =
  | { type: "WorkResultReport";       value: { result: TaskResultRef } }
  | { type: "EvaluationResultReport"; value: { result: TaskResultRef; verdict: EvaluationVerdict } }
  | { type: "TerminalFailureReport";  value: { evidence: number; kind: FailureKind } };
```
`EvaluationVerdict = "EvaluatorPass" | "EvaluatorFail"` (`Verdict` is gone); `FailureKind = "ProcessFailure" | "ExecutionUnavailableFailure"`; `DecisionEvent.TaskDone.value = { ticket, task, report, onFailure }`.

## What B and C must change

B, typecheck: `src/interpreter/decisionPlan.ts:38`; `projectWriter.ts:55,57,569,573`; `resultManifest.ts:54`; `reworkCap.ts:29,57`; `ticketCommand.ts:51,118`; `wire.ts:175`; `test/interpreter/dispatchWriter.test.ts:67,600,698,699`; `i3.test.ts:6,7,56,119,224,255,257,259,319,321,322,349,351,417,419`; `projection.test.ts:25,51,60,122,183,185`; `reworkCap.test.ts:16,32,60,62`; `wire.test.ts:27,28,53,79,83,249`; `test/postgres/finalizerHarness.ts:61,127`; `nativeActionAdmits.test.ts:25,35`; `readiness.test.ts:23,51`; `ticketProjection.test.ts:25,31`. Lint (all downstream of those): `decisionPlan.ts:416`, `projectWriter.ts:402,552,573`, `resultManifest.ts:697`, `reworkCap.ts:57`, and the same suites. Unit suites red only through those imports: `test/adapters/{composeFinalizerRuntime,composeRepositoryCredentials,decisionTaskColumns}.test.ts`, `test/interpreter/ticketServiceRun.test.ts`, `test/roots/*`. `reworkCap.ts` must take its count from `src/domain/ticket.ts` (`evaluationFailureReworksStarted(ticket)`), and the three `test/postgres` suites must deliver a `TaskTerminalReport` where they delivered a verdict string. `test/actor/harness.ts` no longer exports `plainResult` (it exports `plainDisposition`, `walkToFirstJudgement`, `firstJudgement`).

C: `ui/chuggy-ui/` imports no domain type and is untouched by this branch.

## Files outside my layers touched

One: `test/ui/ticketActions.test.ts:41`, `record: []` → `evaluations: []` — the smallest compile-forced edit, and the suite is green.

## Gates on the tip

| gate | exit |
| --- | --- |
| `check-model` | 0 (log: `pr7/check-model-7b-A.log`, 123 tests, 0 failures) |
| `check-conformance` | 0 (12 goldens, 208 steps) |
| `check-random` | 0 (2000 runs, 80000 steps) — seed unmoved |
| `check-model-api` | 0 |
| `check-source` | 1 — typecheck, lint and unit entirely B's files above; in-scope unit suites 155/155 green (`test/domain`, `test/actor`, `test/generated`, `test/ui`), `residue`/`browser`/`format` clean |
| `check-figures` | 0 |
| `check-comments` | 0 |
| `check-paths` | 0 |

## What GOAL.md got wrong

1. **Decision 1 cannot be built with four divergences.** Six, as above; the two extra are consequences, not choices.
2. **Decision 2's `idsAccounted` as written is refutable after a resume**, because the subset a resume re-asked is unrecoverable from the run. `spawned` is therefore a SLOT counter: `spawned == workCyclesStarted + Σ over runs (generation × roster size)`. A resume claims the stage's whole roster, and the unused slots are gaps a monotone mint does not mind. **B's mint must bump by the roster, not by the number of tasks it dispatches.**
3. **The package treats `EvaluatorProcessFailed` as BLOCKED, not as a stage failure** — `statusBlocked` is true for it and for `EvaluatorExecutionUnavailable` alike. So a died evaluator parks the ticket and its resume re-asks it; it does not fail the stage. Decision 5 did not name this, and it is the one semantic change in the branch that no decision asked for.
4. `TaskOutcome` loses `Cancelled`, which decision 3 did not mention: `retireLive` empties the live set, so nothing produces the mark any more.
5. Positional stage keys are not lifted, as 7a left them; `EvaluationBlockedEscalated` stays nullary where the package's carries the instance, which is PR 9's.
