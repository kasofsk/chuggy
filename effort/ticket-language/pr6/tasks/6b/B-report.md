# Task B (PR 6b) — report

Tip `1fb1bc26` on `model/task-identity` (six commits over the merge 405063aa).

## By layer

- **Interpreter.** `ExecutionRequestPlan.tasks` is `{ task: number; identity:
  TaskIdentity }`. `decisionPlan.ts requestTasks` mints the number in one place,
  `ticket.spawned - ticket.tasks.size + taskOrdinal(identity)`; both arms (spawn,
  cancel) go through it and set membership is by `taskIdentityEquals`.
  `executionRequirement.ts` drops `taskDefaults` and the `ExplicitTask` lookup
  (the enum value stays; the baseline CHECK still admits it), and
  `taskKindDefaults["Evaluation:<n>"]` keys by the positive stage.
  `operationsView.ts ExecutionSummary` loses `stage?`, gains `identity`.
- **Adapters.** `decision.ts` writes `kind, cycle, stage, generation,
  evaluator`, nulls spelled out so `execution_request_task_check` sees a whole
  arm. `schedulerRows.ts` is the one place the positive column becomes the port's
  0-based index (`stage - 1`), so `LogicalExecution`, the pod document and
  `kubernetesWorkerPodDocument.golden.json` are unchanged. `operationalReads.ts`
  rebuilds the identity from the columns and refuses a half-named row. `wire.ts`
  needed nothing — `storedSchedulerCompletion` goes through the regenerated
  codec; `projectWriter.ts` untouched.
- **Contract.** `responses.ts` gains `taskIdentitySchema` (its own copy — the
  layer reaches nothing but zod, held to the model's in `rosters.test.ts`) and
  `identity` beside `task`; `stage` is gone. Page order and cursor stay on the
  integer, `rosters.ts` untouched, and `contractDocument.json` needed no change
  because it publishes request bodies only.

## The wire shape of `identity`

```json
{"type":"WorkTask","value":{"ticket":3,"cycle":1}}
{"type":"EvaluationTask","value":{"ticket":3,"workCycle":1,"stage":1,"generation":1,"evaluator":1}}
```

`stage` is the package's positive key — already the label, no `+ 1`.

## What C must change

Typecheck reds in `ui/chuggy-ui`: `app/browser/ticket/TicketLedger.tsx:375,377`;
`TicketUsage.tsx:46,48`; `app/core/runTotals.ts:242,277`;
`app/core/ticketLedger.ts:158,179`; `test/labels.test.ts:92`;
`test/projectExecutionIndex.test.ts:29`; `test/projectTableRows.test.ts:23`;
`test/runTotals.test.ts:57,165-200`; `test/ticketExecutions.test.ts:31,185-193`;
`test/ticketLedgerFixture.ts:100`. Silent (decision 7) sites that still compile:
`ticketLedger.ts:141,143-145,157-159,228,312,439-440` (the `-\d+$` suffix,
`executionStem`, `executionSetKey`, `cycleSetsOf`, `programRunsOf`, `stageLabel`),
`runTotals.ts:242` (a key built from `taskKind` + `stage`),
`TicketLedger.tsx:377` and `TicketUsage.tsx:52` (`Stage ${stage + 1}`).

## Outside my layers, gates, corrections

Nothing under `model/`, `src/domain/`, `src/actor/`, migrations or `ui/` was
touched (`test/ui/ticketActions.test.ts` is in this tree, not in `ui/`).
All eight gates exit 0 on the tip: `check-source`, `check-boundaries`,
`check-queries`, `check-postgres` (76 suites), `check-conformance`,
`check-figures`, `check-comments`, `check-paths`.

- A-report files `migration.test.ts:1227` as mine to move: it is a pre-004
  historical journal entry and must keep `tid`. Left alone.
- S-report lists `adapters/postgres/finalizerPreparation.ts` among the stage
  readers; it joins on `t.kind`. Its header was wrong, not its query.
- No live function still reads `value->'tid'`: 010 replaces both, and
  `decision_event_is_valid` refuses it outright; 004–009 are frozen bodies.
- `executionSourceObservation.ts`'s several-commit branch stays: the identity
  says which task declared the commits, not how many, so `declared.length !== 1`
  is still reachable.
