# Task D (PR 8a) — the accepted work result is the reference the report carried

Tip **6f7a3788** on `model/released-ticket`, three commits off cefa77f2. B's §"What GOAL.md
… got wrong" item 1 is settled the other way: the model reads the report and the door follows.

## Per layer

- **`model/ticket.qnt`** — `beginEvaluation(ticket, workResult)` derives nothing and no longer
  writes the mark; `producedResultRef` is new beside `taskRefOf` and puts a work result in a
  band of its own (`workResultBand * ticket + cycle`), so a reference that reads back as the
  cycle is a defect a golden shows. `producedResult` uses it; `reportValid` and
  `reportMatchesTask` are untouched — `resultRef > 0`, obligation only. `taskRefOf`'s remaining
  caller is failure evidence.
- **`model/domain.qnt`** — `decideWorkTaskDone`'s pass arm pins both references the report
  carried: `artifact: ProducedArtifact(result.resultRef)` beside the `source` it already pinned.
  `decideWorkReduce` reads the mark back and hands the reference over; the `NoArtifact` arm is
  named unreachable. The source band's comment names the family it is now clear of.
- **`src/domain/{ticket,deciders}.ts`** — the same, plus `producedResultRef` exported.
- **Goldens** — twelve re-emitted, `manifest.json`'s `steps` refreshed (eleven moved; the seeds
  and aiming invariants are untouched).
- **Fixtures** — `test/domain/fixtures.ts`: `resultFor` draws through `producedResultRef`, an
  evaluator's `obligationFor` contextRef is `workResultOf(ticket, workCycle)` rather than the
  cycle, and the three instance builders derive their input from `(ticket, cycle)` instead of
  taking a `workResult` (~35 call sites lost the argument).
- **Door (013, unlanded)** — `submit_task_completion` builds an evaluation task's `contextRef`
  by reading the work task `(ticket, cycle)`'s passed `execution_result` in the same
  transaction and folding its digest; a work task's stays `bound.cycle`. No such row →
  `WorkResultUnrecorded` (`shared.ts`, beside `SourceUnrecorded`), journalling nothing;
  `schedulerCompletion.ts` gained the arm and its evidence line. The header paragraph that said
  both kinds answer the same number is replaced.

## The golden

`eval-stage-passed.itf.json`: the completion at step 3 pins **401** on ticket 4's first cycle,
the reduce at step 7 opens the instance at `workResult` 401 with `workCycle` **1**, and every
evaluator obligation's `contextRef` is 401 while the work obligation's is 1.

## Red-proofs

- Model: `taskCompletionPinsItsResultReferenceTest` (refinement unit) — two completions
  differing only in the reference are admitted alike and replay to **different** states;
  `artifactStampedAndSupersededTest` pins 101 against cycle 1.
- Domain/actor: `deciders.test.ts` gained the completion-pins case; `journal.test.ts`'s
  replay case is inverted; `i3.test.ts` reads `contextRef == resultRef != cycle` off a work pass.
- Door, each against a fresh `postgres-databases.ts prepare`, one mutation at a time, all RED:
  the context taken from the cycle; the `IF NOT FOUND` refusal deleted; `w.verdict = 'Pass'`
  dropped; `t2.cycle = bound.cycle` dropped (a later passed cycle stands in the fixture);
  `e2.ticket = bound.ticket` dropped (another ticket's passed cycle stands beside it).

## Outside my scope, forced

`test/postgres/evaluationReports.test.ts` numbered an evaluation task's `cycle` by the task
number, so its stages judged cycles no work ran; `furtherSpawn` now takes the cycle an
evaluation judges. `migration.test.ts`'s `identityExecution` gained a digest and a ticket.

## Gates on the tip

`check-model` 0 (123 tests) · `check-conformance` 0 (12 goldens, 259 steps) · `check-random` 0 ·
`check-model-api` 0 · `check-source` 0 (6 stages, 208 suites) · `check-postgres` 0 (77 suites) ·
`check-queries` 0 · `check-figures` 0 · `check-comments` 0 · `check-paths` 0 ·
`check-duplication` 0 · `check-boundaries` 0. Container `chuggy-check-postgres-8d` removed.
