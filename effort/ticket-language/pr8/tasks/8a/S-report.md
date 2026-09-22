# Task S (PR 8a) — migration 013, the released ticket

Tip `3c10ad8f` on `schema/released-ticket`, one commit off `aaaff1ec`, not pushed. New
`migrations/013-released-ticket.ts`; edited `migrations/index.ts`, `deploy/rig/wipe-tickets.sql`,
`schema/README.md`, `test/postgres/migration.test.ts`, `test/postgres/privileges.test.ts`.
`baseline/privileges.ts` NOT touched — it is migration 001's body, so every grant is in 013.

## 013's shape

Guard (008's, byte for byte) · `ticket_definition` + `ticket_source` with their keys, FKs and grants ·
three column grants on `journal_entry` to the boundary owner · `journal_entry_release_ticket`
re-rendered · `operation_completion_authority_is_its_boundary` re-rendered without `'ExecutionBlocked'`,
still `NOT VALID` · two new predicates · `decision_event_is_valid` whole · `submit_task_completion` whole
(`CREATE OR REPLACE`, signature unchanged, no grant restated).

**The arms admit** (consts at the top; `{type,value}` idiom):

    CreateTicket.value = {id,content,dependencies:[..],workConfiguration:{workload,inputs,
      executionRequirements,resultContract},evaluationPlan:{stages:[{key,evaluators:[{key,task:{…}}]}]},
      finalizationConfiguration}          — `deps`/`prog` refused for being named
    Dispatch.value     = {ticket,source}  — both positive; Revoke/ResumeTicket keep the bare integer
    TaskDone.value.report = WorkResultReport{result:{obligation:{task,definition,contextRef},resultRef},
      acceptedSourceRef} | EvaluationResultReport{result:<same>,verdict} | TerminalFailureReport 012's

`command_reference(jsonb)` = `command_integer(x) AND x > '0'::jsonb` (a jsonb comparison cannot raise, so
the floor needs no second statement, and 011's `(…)::bigint < 1` folds into it);
`command_task_definition(jsonb)` = the four. Both the boundary owner's, nobody's to execute. 012's three
dead conditions go, and so does the stage's `? 'fanout'` — the same argument, fourth of the same class.
`obligation.task` is weighed **equal to** the event's `task` rather than re-validated; the red-proof then
showed `jsonb_typeof(produced|obligation) <> 'object'` unreachable behind it, so both were removed (7b's
precedent).

## The two tables

`ticket_definition(tenant,project,ticket,definition jsonb,digest text)`, PK `(tenant,project,ticket)`,
FK → `project`; CHECKs: definition an object bounded at the tree's one document bound (65536, the
`configuration_revision.canonical` figure — the material is resolved from one), digest non-empty and
bounded, ticket positive. Grants: ticket service SELECT+INSERT, boundary owner SELECT.
`ticket_source(tenant,project,ticket,source bigint,repository,commit,ref)`, PK `(…,source)`, FK →
`project`; CHECKs: ticket and source positive, `(repository IS NULL)=(commit IS NULL)`, commit hex,
repository/ref bounded. Grants: ticket service and boundary owner SELECT+INSERT, scheduler SELECT, api
SELECT per column. **No FK to `ticket_projection`: nothing in the baseline has one** (it is rebuilt, not
repaired), so both point at `project` as every other per-ticket relation does.

## How the door builds the obligation

`task` from `execution_request_task` (010's identity) · `definition` from the `CreateTicket` entry read
through `journal_entry_release_ticket` — `value->'workConfiguration'` for work, the `stages[key=stage]
.evaluators[key=evaluator].task` for an evaluator · `contextRef` = `bound.cycle` for **both** kinds ·
`resultRef` = today's `{manifest,digest,schema}` · `acceptedSourceRef` = `result_digest_fold(commit)` off
`execution_result_source`, with the `ticket_source` row written in the same statement. A failure report
builds no obligation. A definition it cannot find leaves the report unadmittable and the existing RAISE
fires — loud, as 012 left it.

## What GOAL.md and the brief got wrong

- **The release payload's ticket key moves to `id`, and the index moves with it.** Nobody named this.
  `journal_entry_release_ticket` indexed `value->'ticket'`; left alone it indexes nothing for every
  release this image writes, and the door's own read would scan the partition. 013 re-renders it over
  `id` at both tags. **B owes `nativeReads.ts:447,492,540`** (`->'value'->'ticket'`, `->'value'->'deps'`)
  and the fixtures in `nativeReads.test.ts:105,326,363` and `ticketInstants.test.ts:229` — I left those
  alone rather than hand B a red my diff cannot fix.
- **The boundary owner held no grant on `journal_entry`.** The door reads the release back out of it, so
  013 grants SELECT on `tenant`, `project`, `entry` and nothing else.
- **`contextRef` for an evaluator is not derivable.** The copy's `currentTaskObligations` owes
  `input.workResult`, which chuggy's `beginEvaluation` sets to `ticket.spawned` — a mint counter no row
  holds. I used the cycle, per the brief's fallback. **A must make `EvaluationInput.workResult` the work
  cycle** (or B must reconcile), or every evaluation report fails `reportMatchesTask`.
- **`SourceUnrecorded` has no reader.** `CompletionRow.result` is `string | null`, so there is no compile
  error: an unhandled result lands at `schedulerCompletion.ts:379` as `Conflicting` + an `ImpossibleState`
  incident. B owes it an arm.
- `baseline/privileges.ts` is in migration 001's body; the brief listing it as a place to add a grant
  would have been an edit to a landed migration.

## Render-diff, tests, red-proofs

`scratch/S/render.mjs` (6b's), `~/claude/chuggy` at `aaaff1ec` vs the worktree: one append hunk, 388
lines, **zero removed and zero changed** — 001–012 render identically.

`migration.test.ts` **106 pass**: the ledger row; the guard (refusing, naming the wipe, leaving 12 and the
old release still admitted); 38 event rows (21 releases, 6 dispatches, 11 reports); 10 rows against the
two tables' CHECKs; the grants and the two predicates' ownership; the authority CHECK; the index answering
a lookup at `id`; and three door cases — a work pass with its obligation, accepted source and
`ticket_source` row, an evaluator pass carrying its own key's definition, and the unsourced pass refused.
`privileges.test.ts` **38 pass** (scheduler read roster gains `ticket_source`; it may write neither table).

**Thirty-three single mutations, all RED, no survivors** after the trim: 013 unregistered; the guard
deleted; its remedy stripped; `deps`/`prog` admitted; content unfloored; the work definition unweighed;
the evaluator's definition unweighed; the stage no longer positional; evaluators no longer distinct; the
dispatch folded back into the bare integer; its source unfloored; the obligation's task unweighed; its
context unweighed; `acceptedSourceRef` unweighed; the result reference unweighed; each of six CHECKs
dropped; the door reading the wrong field for the work definition; the evaluator key ignored in the walk;
the context taken from the ticket; the source folded from the result digest; the `ticket_source` insert
deleted; the unsourced refusal deleted; the index at the old key; the authority CHECK keeping the tag; the
door's `entry` grant, the scheduler's and the api's `ticket_source` grants each dropped; the predicate
left unowned. **Two survivors removed as unreachable** (the produced/obligation `jsonb_typeof` conjuncts).
Six landed cases pinned at 012 (`fanout_events`, `identity_completion`, `evaluatorkeys_events`,
`taskreport_events`, `taskreport_completion`, `journal_instants_index`), each observed red at full migrate
before pinning.

## Gates on the tip

`check-source --static` 0 (5 stages) · `check-boundaries` 0 · `check-queries` 0 · `check-comments` 0 ·
`check-figures` 0 · `check-paths` 0 · `check-duplication` 0.

`check-postgres` **1 — fifteen cases in five suites, all B's**, one cause: the door now needs a released
definition in the journal and these fixtures journal none, so the mailbox refuses the report it builds.
`evaluationReports.test.ts` (3), `scheduler.test.ts` (5, incl. `:1382`), `schedulerRace.test.ts` (4),
`schedulerStore.test.ts` (3), `workerPlane.test.ts` (3). The generated codec also still spells the 012
report, so B's `harness.ts` history, the fixtures and `model-api` move together.

Container `chuggy-check-postgres-8a` removed. Commit attribution is the Fable line the brief names.
