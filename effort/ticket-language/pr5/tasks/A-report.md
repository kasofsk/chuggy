# Task A report — the sum in the model, the goldens, the domain and the actor

Tip `6c3cf9b0` on `model/escalation-sum`, five commits off main `bd63df14`: `b0131e54` the desk's wall is
a sum and its resume is derived from it · `a8458a04` the deciders carry the wall and derive the resume
from it · `d4080075` decision semantics 6 alone, because the rig's journal was wiped · `eafec7cf` a golden
for the wall an evaluation block parks at · `6c3cf9b0` the draft lift's test goes with the lift.
Commits carry `Co-Authored-By: Claude Opus 5 (1M context)`, not the brief's `Claude Fable 5.1`: the
session's attribution reminder names this model, as PR3 and PR4 also reported.

## Per layer

- **`model/`** — `Reason` becomes `Escalation`, the six GOAL.md spells, `EvaluationBlockedEscalated` among
  them. `Ticket.reason` and `Ticket.resumeAt` collapse into `Ticket.escalation`; `resumeOf` is the total
  map to `Resume`, and `Resume`'s doc now reads as derived. `decideExecutionBlocked` matches on the
  interrupted phase: `Evaluation` stamps `EvaluationBlockedEscalated` with the new label
  `ticket-escalated evaluation_blocked_escalated`, anything else `WorkExecutionUnavailableEscalated`.
  `escalate` takes the wall, not a resume; `decideResumeTicket` switches on `resumeOf(escalation)`;
  `retryableIn` is `hasOpenHumanTask`; `deskConsistent` is one equivalence, escalated phase iff
  non-`NoEscalation` wall. `refinement.qnt`'s `ExecutionBlocked` loses `why`, `api.qnt` exports
  `ApiEscalation`, the suites follow, and `resumeDerivedFromTheWallTest` pins all six arms of `resumeOf`.
- **Goldens** — the ten re-emitted (no step count moved) plus `evaluation-blocked.itf.json` and its
  manifest row. `corpus.ts declaredLabels` reads labels out of `domain.qnt` at run time, so it and
  `coverage.test.ts` needed no edit; the witness roster stays at six (the old `evaluationResumeWitness`
  became the evaluation-block witness), so `check-model.sh`/`.test.sh` counts are unchanged.
- **Generated** — `modelTypes.ts`, `model-api.ts`: `Escalation`/`escalationTags`/`escalationSchema`/
  `encode|decodeEscalation`, `Ticket.escalation`, `ExecutionBlocked` value `{ticket}`.
- **`src/domain`** — `resumeOf` beside `hasOpenHumanTask` in `ticket.ts`; `deciders.ts` mirrors the model;
  `enablement.ts` loses `executionBlockedReasons`; `invariants.ts` carries the one equivalence.
- **`src/actor`** — semantics **6 alone**: `decisionSemantics.ts` is the version, its guard and a header
  saying why the mechanism stays; corrections 1–5, `currentVocabulary`, `supersededSpellings`,
  `wordAtCurrentVocabulary`, `rowAtCurrentVocabulary`, `eventAtCurrentVocabulary` deleted.
  `storedJournalLegalOn` refuses any other semantics, with the doc comment saying the rig was wiped. The
  three `journalAtSemantics*.json` fixtures and their tests are gone; `decisionSemantics.test.ts` is four
  tests over one history walking both execution walls and the finalization one. `executionBlockedEvent`
  takes only the ticket; `equality.ts` compares one field.

## The new golden

`evaluation-blocked` — `mc_chuggy`, seed `0x1`, 9 steps, aimed by refuting
`lastStep.label != "ticket-escalated evaluation_blocked_escalated"`. It walks a dispatched evaluation set
blocked by a wall: the judgement is intact and unmade, so it is the only park whose resume re-enters
evaluation. Its pair is `work-execution-unavailable`, the same refusal one phase earlier.

## Outside my layers

`src/interpreter/wire.ts` (in scope): `parseStoredDecisionEventText`, `parseStoredEntry`,
`entryAtRecordedDisposition` and `rowFields` deleted; `storedSchedulerCompletion` and
`checkedFinalizationSubmission` read the record directly. `parseStoredEntry` was byte-identical to
`parseEntry` once the lift went, so its callers use `parseEntry`. `src/interpreter/authoring.ts` points
`parseDraftAuthoring` back at `parseDecisionEventText`, and `authoring.test.ts` loses the lift's test.
Forced, and as small as they go: `src/interpreter/projectWriter.ts` (two call sites) and
`src/adapters/postgres/journal.ts` (two `parseStoredEntry` call sites → `parseEntry`).

## Unit reds left for B and C

`test/contract/rosters.test.ts`, `test/interpreter/{dispatchWriter,i3,projection,wire}.test.ts`,
`test/ui/{resumePoint,ticketActions}.test.ts`. Static adds `src/interpreter/decisionPlan.ts`,
`src/interpreter/projectDecision.ts`, `src/interpreter/projectWriter.ts` (`projectionOf`) and the four
`test/postgres/` files. No typecheck or lint error sits in `model/`, `src/domain`, `src/actor` or `wire.ts`.

## Gates on the tip

`check-model` 0 (114 tests) · `check-model.test` 0 · `check-model-api` 0 · `check-conformance` 0 (11
goldens, 235 steps) · `check-conformance.test` 0 · `check-random` 0 (2000 runs, 80000 steps) ·
`check-random.test` 0 · `check-figures` 0 · `check-comments` 0 · `check-paths` 0 · `check-boundaries` 0 ·
`check-source --static` **1**, `--unit` **1**, both entirely the reds above.

## Where GOAL.md was thin

One thing: it writes `ExecutionBlocked{ticket}`, so the variant keeps a single-field record while
`Revoke`, `Dispatch`, `WorkReduce` and `ResumeTicket` carry a bare int. I kept the record, because S
rewrites `submit_task_completion` to build exactly that JSON. Worth a deliberate nod at review.
