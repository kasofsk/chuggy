# Task A (PR 6b) — report

Branch `model/task-identity`, worktree `~/claude/chuggy-wt/identity`, tip **223a986c**, seven commits off `origin/main` (1e986583, "Work fan-out goes").

## Per layer

- **`model/task-contract/task.qnt`** — the package file at pin 76c95a9, `diff` against `package/model/task-contract/task.qnt` is **empty**. `model/AGENTS.md` carries the neighbouring doc: verbatim, do not edit, what imports it, and that `TaskDefinition`/`TaskObligation`/`ValidatedTaskResult`/`TaskFailure`/`TaskTerminal` have no caller yet.
- **`model/`** — `TaskKind` gone; `Task = {identity, state}`; `Ticket.workCyclesStarted` added before `spawned`; `spawnWork`/`spawnOn`/`spawnEvalStage`, `resolveTask`, `retireLive`, `evalStage`, `reducibleWorkIn`/`reducibleEvalIn`, `decideTaskDone`, revoke, escalate and the four invariants all by identity; `taskIdentitiesValid` is a new bundle member. `refinement.qnt`'s `TaskDone` carries `task: TaskIdentity`. Retirement orders by `taskOrdinal` (work = 1, evaluator = its number) since there is no id to sort on. Quint imports are not transitive, so every module naming a contract type imports it itself.
- **`test/golden/`** — all 11 re-emitted, same seeds, same step counts, 0 failed. The `tid` draw is now a `task` draw carrying a `TaskIdentity`. `manifest.json`'s `rework-wall-resume` aiming invariant reads the identity's arm through an inline `match` instead of `.kind`.
- **`src/generated/`, `src/domain/generated/`** — regenerated; `api.qnt` exports `ApiWorkTaskIdentity`/`ApiEvaluationTaskIdentity`/`ApiTaskIdentity` (the generator fails closed without them).
- **`src/domain/`, `src/actor/`** — `task.ts` rewritten around identities; `evaluationFailureReworksStarted` now collects the work cycles an evaluator failed and counts work tasks at `cycle - 1`, replacing the record walk over the kind sequence. `ids.ts` drops `firstTaskId` and retitles `TaskId` as the number minted outside the machine. `enablement.ts`'s `outstandingTaskIdsIn` is now `outstandingTasksIn: readonly TaskIdentity[]`. `decisionEvent.ts`'s `taskDoneEvent`/enablement take an identity.
- **Suites** — every in-scope suite converted; the new and changed conjuncts are red-proved one at a time (work-arm identity, eval-arm `workCycle`, eval-arm ordinal run, `recordWellFormed`'s `taskOwner`, `idsAccounted`'s work-cycle conjunct, `taskIdentitiesValid`): each mutation turns exactly its own case red.

## `TaskIdentity` in the mirror (B and C build on this)

```ts
type WorkTaskIdentity = { readonly ticket: number; readonly cycle: number };
type EvaluationTaskIdentity = {
  readonly ticket: number; readonly workCycle: number;
  readonly stage: number; readonly generation: number; readonly evaluator: number;
};
type TaskIdentity =
  | { readonly type: "WorkTask"; readonly value: WorkTaskIdentity }
  | { readonly type: "EvaluationTask"; readonly value: EvaluationTaskIdentity };
type Task = { readonly identity: TaskIdentity; readonly state: TaskState };
```

`stage` is the contract's positive key: `evaluationTaskOf(ticket, workCycle, stageIndex, generation, evaluator)` in `src/domain/task.ts` applies `stageIndex + 1`, and that is the only place the offset lives.

## What B and C must change

B (compile reds, all exactly B's sites): `src/interpreter/decisionPlan.ts:31,63,68,69,70,128,131,149,155`; `test/interpreter/dispatchWriter.test.ts:599`; `test/interpreter/i3.test.ts:113,265,267`; `test/interpreter/projection.test.ts:59,121,160,185,194`; `test/interpreter/reworkCap.test.ts:42,61,65`; `test/interpreter/wire.test.ts:76`; `test/postgres/finalizerHarness.ts:453`; `test/postgres/finalizerApproval.test.ts:405`; `test/postgres/nativeActionAdmits.test.ts:84`; `test/postgres/readiness.test.ts:51`; `test/postgres/ticketProjection.test.ts:112`; `test/ui/ticketActions.test.ts:35` (a `Ticket` literal missing `workCyclesStarted`). Three suites fail only transitively on `decisionPlan.ts`: `test/adapters/composeFinalizerRuntime.test.ts`, `test/adapters/composeRepositoryCredentials.test.ts`, `test/interpreter/ticketServiceRun.test.ts`.

C (the `tid` wire field, which no longer names what the decider takes): `test/postgres/privileges.test.ts:320,348`; `test/postgres/migration.test.ts:1227`; `test/postgres/scheduler.test.ts:1133`; and the SQL that reads `value->'tid'` — `src/adapters/postgres/schema/migrations/baseline/functions.ts:792,3837` plus `004`–`009`.

## Files outside my layers touched

None. Every file in `git diff origin/main..HEAD` is under `model/`, `test/golden/`, `src/domain/`, `src/actor/`, `src/generated/`, `test/domain/`, `test/actor/`, `test/conformance/`, `test/itf/`, `test/generated/` or `test/random/draws.ts`.

## Gates on the tip

| gate | exit |
| --- | --- |
| `check-model` | 0 (log: `pr6/check-model-6b-A.log`, 114 tests, 0 failures) |
| `check-conformance` | 0 (11 goldens, 190 steps) |
| `check-random` | 0 (2000 runs, 80000 steps) — seed unmoved; `check-random.test.sh` also 16/16 |
| `check-model-api` | 0 |
| `check-source` | 1 — typecheck, lint and unit, entirely B's files above; `residue`, `browser` and `format` clean |
| `check-figures` | 0 |
| `check-comments` | 0 |
| `check-paths` | 0 |

## What GOAL.md got wrong

- **Decision 2's `generation: 1` cannot be built as written.** `ResumeEvaluation` re-enters the lowest stage of a cycle that may already have run it; at a constant generation the resume mints identities the record already holds, and the machine's stale-completion argument — a stale delivery names a retired identity and no-ops — stops holding on that edge. `stageGeneration` derives it by counting the runs the record shows at evaluator one: 1 everywhere the plan expected 1, 2 where the resume needs it.
- **`workCyclesStarted` needed an invariant the plan did not name.** A stored counter a spawn mints from is a second source of truth, so `idsAccounted` gained a conjunct holding it equal to the work tasks the ticket shows, the way it already holds `spawned`.
