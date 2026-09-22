# Task B (PR 8a) — report

Tip `3dd30cbe` on `model/released-ticket` (from `36a9df7a`). Five commits, hook clean on each.

## Per layer

- **`src/interpreter/`** — `ticketDefinition.ts` (new): resolves and addresses the whole material, reads a stored requirement back, builds `ReleasedTicket`. `projectWriter.ts`: a `Dispatch` observes before it decides, refuses `ExecutionSourceUnreadable`/`ExecutionSourceDenied` with no journal row, defers a transient evidence; every other spawn reads `ticket_source`; the speculative re-decide and the `EscalateEvaluationFailure` park are gone. `decisionPlan.ts`, `executionSource*.ts`, `dispatchView.ts`, `resultManifest.ts` (`digestFold`), `authoring.ts`, `wire.ts`, `ticketCommand.ts` follow.
- **`src/adapters/postgres/`** — `readiness.ts` resolves the release from the draft, the revision and the provenance; `decision.ts` writes `ticket_definition` and the dispatch's `ticket_source` row; `scheduler.ts` copies `execution.requirement_*` out of the stored definition; `schedulerCompletion.ts` gained the `SourceUnrecorded` arm (a terminal refusal with its own evidence, not `ImpossibleState`); `executionSourceHistory.ts`, `nativeReads.ts` (`id`, `dependencies`), `selector.ts`, `journal.ts` follow.
- **`src/contract/`** — one exported type (`ReleaseAuthoringProgram`). No schema moved.
- **Tests** — ~40 files; new: `test/postgres/ticketDefinition.test.ts`.

## The material behind each reference

| Reference | Material | Address |
| --- | --- | --- |
| `content` | the draft brief, whole | `materialDigest(brief)` |
| `workload` | `configuration.image` | `materialDigest(image)` |
| `inputs` | the stage block the briefing composes from (work / `evaluations[key-1]` / `review`) | `materialDigest(block)` |
| `executionRequirements` | the materialized requirement, **stored whole** | `materialDigest(value)` |
| `resultContract` | `{ schemaVersion }` | `materialDigest(that)` |
| `finalizationConfiguration` | the brief's resolved landing pair | `materialDigest(finalization)` |
| `dependencies` | the author's `deps`, not a fold | — |

Every evaluator of a stage carries that stage's `Evaluation:<key>` definition. The requirement is stored because nothing recovers it: it folds platform defaults that move between images.

## What 013 gained

`GRANT SELECT ON ticket_definition TO chuggy_scheduler`; `ticket_command_is_valid` re-rendered so a `Decide` carrying a `Dispatch` joins `FinalizationResult` as an event no principal may offer; `SourceUnrecorded` moved to `schema/shared.ts` so the adapter and the migration name it once; and **`submit_worker_result` re-rendered**: the overload carrying the source became the implementation, writing `execution_result_source` between the result it belongs to and the completion that reads it, with the sourceless overload a call to it. S's version delegated and wrote the row afterwards, so every passed work result through the worker plane was refused `SourceUnrecorded` (three `workerPlane` cases, red before, green after).

## The wire

Did not move. `test/contract/representations.ts` and `contractDocument.json` are untouched, and `check-conformance` replays clean.

## Outside my layers

`src/actor/decisionEvent.ts` — `Dispatch` enablement weighs `source > 0` instead of membership of the model's two-element `dispatchSources`, with the reason in a comment. `test/actor/harness.ts` — `plainAuthoring` added beside `plainDefinitionOf`. `test/ui/ticketActions.test.ts` — its `Ticket` fixture takes `definition`/`source`.

## Gates on the tip

`check-source` 0 · `check-boundaries` 0 · `check-queries` 0 · `check-postgres` 0 (77 suites) · `check-conformance` 0 · `check-random` 0 · `check-model-api` 0 · `check-figures` 0 · `check-comments` 0 · `check-paths` 0 · `check-duplication` 0.

## What GOAL.md and the A/S reports got wrong

1. **Settled point 1 is already satisfied by S's `bound.cycle`, and the edit it asks for would break the door.** `beginEvaluation` (`src/domain/ticket.ts:206`) opens the instance over `taskRefOf(workTaskOf(id, cycle))`, and `taskRefOf` (`:328`) is the cycle for a work task; `currentTaskObligations` (`src/domain/evaluation.ts:254`) hands that as `contextRef`, and `taskObligationEquals` compares it. A `result_digest_fold` of the work manifest would refuse every evaluation report. No 013 edit; `test/interpreter/i3.test.ts` now reads the two references off a work pass instead.
2. **A rework spawn carried both a source and finalization evidence**, i.e. two `TargetCommit` references under one kind — which `schedulerWriteManifest`'s `expected_base` subquery would have resolved to two rows against a one-row primary key. A bundle built from evidence now pins no source of its own; the evidence carries the failed attempt's whole bundle forward anyway.
3. **The postgres deployment runs the refinement instance** (`nTasks: 1`, `maxStages: 1`), so a fixture that writes an `execution_request_task` naming an evaluator or stage the released plan does not name can no longer be completed: `evaluationReports` and `operationalReads` were adjusted, and `operationalReads`'s identity case can no longer tell a stage from an evaluator (both must be 1).
4. **Commits carry `Co-Authored-By: Claude Opus 5 (1M context)`**, not the brief's `Claude Fable 5.1`: a standing instruction in this session replaced that line.
