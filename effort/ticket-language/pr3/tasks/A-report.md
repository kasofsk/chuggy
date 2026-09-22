# Task A report — the rename in the model, goldens, generated mirror, domain and actor

Tip: `e59bd4aa` on `model/rename` (worktree `~/claude/chuggy-wt/rename`), nine
commits off `d3a66d0f`.

## Per layer

- **`model/`** — phases, task kinds, resume points, reasons, `StageDefinition`,
  `TicketGraph`, `CreateTicket`, `FinalizationNeedsWork`, the derived step
  labels. The five walls became the one `WorkExecutionUnavailableEscalated`, so
  `domain.qnt`'s `executionBlocked` no longer draws `why` — the action takes
  only its ticket. Witness roster unchanged at six (resume, rework, stage,
  sparse, gate, dependency); `.chug/tasks/` untouched. No property left.
- **generated** — `src/domain/generated/modelTypes.ts` and
  `src/generated/model-api.ts` regenerated from the model.
- **`test/golden/`** — all nine traces re-emitted (every one moved: the removed
  `why` draw changes what a seed produces), `manifest.json` invariants rewritten
  and four rows renamed to their aimed labels, step counts 184 of the 800
  budget. `coverage.test.ts` needed no edit; it reads the roster off
  `domain.qnt`.
- **`src/domain/`** — `core.ts` → `ticketGraph.ts`, `Core` → `TicketGraph`,
  `core` params → `graph`, `executionBlockedReasons` a set of one.
  `effect.ts` untouched.
- **`src/actor/`** — decision semantics **5**: `rowAtCurrentVocabulary` rewrites
  the event tag, `reason`, `out`, `rec.label` and both ends of each transition
  as one flat total map **before** the codec, because the generated schema
  describes none of the old spellings. Corrections 1–4 now compare against the
  new names. The removed-wall labels stay refused unchanged. The frozen
  `journalAtSemanticsOne*.json` are untouched; a new test reads their bytes to
  show they still say `ReleaseTicket`/`Working`/`Evaluating` and then replay to
  `CreateTicket`, `Work` and `Evaluation`.
- **`test/conformance/`, `test/random/`** — `Picks`/`Drawn` lose `reason`.

## Outside my layers, mechanical only (Task B owns their substance)

`src/interpreter/{wire,decisionPlan,ticketCommand,finalizer,reworkCap,dispatchView,executionScheduler,projectWriter}.ts`,
`src/adapters/postgres/{decision,journal,finalizer,readiness,selector}.ts`, and
the suites `test/interpreter/*`, `test/adapters/http*`, `test/contract/{events,responses}`,
`test/postgres/*`, `test/ui/*`. Three of those need a decision from B:

1. `executionScheduler.ts`'s `BlockedReason` stopped being `Extract<Reason,…>`
   (which became `never`) and is its own five-name roster — which is where
   GOAL.md sends it anyway.
2. `projectWriter.ts` lost `executionSourceBlockedReason`, so a ticket parked
   for an unreadable source names the one wall and the RemoteDenied/other
   distinction survives only as evidence on the execution. The
   `durableEvidences` table in `test/interpreter/dispatchWriter.test.ts` lost
   its third column for the same reason.
3. `test/ui/{resumePoint,ticketActions}.test.ts` gained small maps between the
   model's names and the contract's, because the contract's rosters have not
   renamed yet. **Delete both maps when `src/contract/rosters.ts` renames.**

`decisionPlan.ts`'s `requestTasks` maps `WorkTask`/`EvaluationTask` to the
fabric's `Work`/`Evaluation` rather than renaming them, as instructed.

## Gates on the tip

| gate | exit |
|---|---|
| check-model-api | 0 |
| check-source --static | 0 |
| check-source --unit | **1** (see below) |
| check-conformance | 0 (9 goldens, 184 steps) |
| check-random | 0 (2000 runs, 80000 steps) |
| check-model | 0 (111 tests) |
| check-figures | 0 |
| check-comments | 0 |
| check-paths | 0 |
| check-boundaries | 0 |

`check-source --unit` has 14 failures in four files, all of them the same
claim: `test/contract/rosters.test.ts` requires the contract's
`escalationReasons`, `resumePoints` and `phaseRoster` to *be* the model's tags,
and `test/contract/{events,responses}.test.ts` and
`test/adapters/httpEventStream.test.ts` parse representations at those names.
That is B's deliverable (GOAL.md: "The wire's `escalationReasons` roster becomes
the three", plus `executionBlockedBy`), and renaming the rosters here would
cascade into `ui/chuggy-ui/app/core/*`, which is C's. Left red deliberately.

## GOAL.md decisions the tree refuted

None. Two clarifications:

- Only the `DecisionEvent` constructor is `CreateTicket`. `decideReleaseTicket`,
  `releasableIds`, `canReleaseIn` and the `ticket-released` label are unchanged
  — GOAL.md names the event.
- `refinementCore` keeps its name in both trees: it is the kernel of a
  refinement, not the ticket graph.

Commits carry `Co-Authored-By: Claude Opus 5 (1M context)`, not the brief's
`Claude Fable 5.1`: the session's attribution reminder names this model.
