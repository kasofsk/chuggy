# PR 8a round 1, boundary half — verdict: **CHANGES** (one finding)

Tip 378eb585, detached worktree `~/claude/chuggy-wt/released-review-boundary`, own
container `chuggy-check-postgres-8r` on 55438. Gates at the tip, all **0**:
`check-source` (6 stages, 208 suites) · `check-boundaries` · `check-queries` ·
`check-postgres` (77 suites) · `check-conformance` · `check-figures` ·
`check-comments` · `check-paths` · `check-duplication`. `ui/chuggy-ui`: `npx tsc
--noEmit` 0 and `npx vitest run` 0 (117 files, 1311 tests) with no `ui/` edit and
no `npm ci` under `ui/`.

## Finding

**1. The door's stage selection is unheld: dropping it leaves the whole gate green.**
`src/adapters/postgres/schema/migrations/013-released-ticket.ts:546-547` —
`WHERE (stages.stage->>'key')::bigint = bound.stage AND
(evaluators.evaluator->>'key')::bigint = bound.evaluator`. I removed the stage
conjunct and re-ran: `migration.test.ts` **107/107 pass**, then the whole
`check-postgres` **77 suites clean**. Every door fixture releases a one-stage plan
(`test/postgres/migration.test.ts:4884-4899`, `releasedWhole`), and every scheduler
suite runs the refinement instance (`test/actor/harness.ts:54-58` `nTasks: 1,
maxStages: 1`, wired at `test/postgres/harness.ts:842`), so `bound.stage` is 1
everywhere and the walk picks the only stage either way. S's red-proof list covers
the evaluator key (the fixture has evaluators 1 and 3) and not the stage key.

The door is *correct* for two stages — I drove a hand-built two-stage release
through `submit_task_completion` on a fresh migrate: an evaluator at stage 2 got
stage 2's definition (`{9,10,11,12}`), never stage 1's, and `contextRef` was
`result_digest_fold` of the cycle's passed work digest. So this is an unproved
guard, not a live defect; but it guards exactly the shape the brief names (the
rig's sanity ticket) and the shape this PR newly depends on, since each stage's
`inputs` folds `configuration.evaluations[stage-1]` and its `executionRequirements`
is materialized per stage, so the definitions genuinely differ by stage. Were the
conjunct to go, an evaluator of stage 2 would be journalled under stage 1's
definition, `reportMatchesTask` would refuse it, and the completion would settle
nothing while the execution is already `Terminal`. Cost to close: one
migration-suite case releasing a two-stage plan whose stages carry different
definitions, red-proved against the dropped conjunct. This is also the whole of
brief check 8's "two-stage, two-evaluator plan … in a scheduler suite" — no suite
does it, and after B's item 3 none can.

## Checked and clean

- **1 · release resolves and stores.** Drove releases under four revisions. Journal
  `CreateTicket` carries `id` = the ticket, every ref positive, each evaluator of a
  stage carrying that stage's `Evaluation:<key>` definition; every ref equals
  `digestFold` of the matching `ticket_definition` digest, and `digest` =
  `materialDigest(definition)`. Changing `image` moved `workload` and
  `executionRequirements` only; `work.instructions` moved the work task's `inputs`
  only; `review.instructions` moved the evaluator's `inputs` only. No ref is the
  same fold for two different materials: where work and evaluation share an
  `inputs` fold the two configuration blocks are byte-equal. `taskInputsBlock`
  (`ticketDefinition.ts:119-127`, 1-based plan key) and `purposeBlock`
  (`taskBriefing.ts:473-475`, zero-based row index via `schedulerRows.ts:222`)
  select the same block. The material is resolved outside the transaction but the
  fence matches `authoring_version`, which `revise_draft` bumps on every brief edit
  (`baseline/functions.ts:3269-3272`), so no read can drift behind it.
- **2 · dispatch reads the store.** `materializeExecutionRequirement` has exactly
  one caller in `src` (`ticketDefinition.ts:134`); `scheduler.ts:395` copies
  `execution.requirement_*` out of `ticket_definition`. The inverse mutation is
  already a suite case (`schedulerStore.test.ts:320-357`: the pinned revision is
  rewritten behind the release and the execution still carries the release's digest
  and `platformDefaultVersion` 1).
- **3 · the writer observes first.** `observe` is reachable only from
  `projectWriterDispatchPlan`; every other spawn goes through `spawnSource`, which
  reads `ticket_source`. `dispatchWriter.test.ts:856-870` refuses each durable
  evidence with its code and leaves the memory identical (no entry, no projection);
  `:871-883` defers each transient one. `finalizerRework.test.ts:399-421` runs a
  rework at `postgresHarnessObservedCommit` with both remote ports fatal — it
  neither parks nor defers, and `projectWriterUnreadableLanding` has no `Parked`
  arm left.
- **4 · the door.** `journal_entry_release_ticket` is rebuilt over `value->'id'`,
  and `EXPLAIN` of the door's read shows `Index Scan using
  journal_entry_release_ticket` with the ticket in the Index Cond. Re-proved RED,
  one mutation at a time, each against a fresh migrate: `deps`/`prog` admitted ·
  `acceptedSourceRef` unweighed · the `ticket_source` insert deleted · the unsourced
  refusal deleted. Render-diff of every migration, main aaaff1ec vs the tip, through
  `pr8/scratch/S/render.mjs`: **zero removed, zero changed**, 643 appended lines,
  all migration 13. A second submission is `AlreadySubmitted` before the insert, and
  the insert is `ON CONFLICT DO NOTHING`, so no second source row.
- **5 · stored text.** `draft_revision.authoring` is `authoringSchema`'s JSON
  (`authoring.ts:219-249`); `nativeReads.ts:440,485,533` read `dependencies`/`id`,
  as do `journal.ts:211` and `decision.ts:659`. The grep is clean outside landed
  migrations. `wipe-tickets.sql` truncates `draft_revision`, `draft_brief`,
  `dispatch_candidate`, `operation` and both new tables.
- **6 · the wire.** `src/contract` gained one exported type and no schema;
  `test/contract/contractDocument.json` is untouched; `check-conformance` replays
  clean. Nothing the console reads moved, so kept configuration revisions and the
  drafts page are unaffected.
- **7 · 013 whole.** Guard byte-identical to 008's (and 009–012's). Every field name
  in the arms matches `src/generated/model-api.ts` (`id`, `content`,
  `dependencies`, `workConfiguration`, `evaluationPlan.stages[].key/evaluators[]
  .key/task`, the four definition refs, `obligation.task/definition/contextRef`,
  `resultRef`, `acceptedSourceRef`, `Dispatch.value.ticket/source`). The boundary
  owner's `journal_entry` grant is three columns; the authority CHECK is re-rendered
  without `'ExecutionBlocked'`; `ticket_command_is_valid` differs from 007's by the
  single added `'Dispatch'`; the wipe runs without CASCADE (migration suite case).
- **8 · B's departures.** The transient-evidence deferral is **main's behaviour
  verbatim** — `projectWriterUnreadableLanding` checked transience before the
  operation refusal there too — and 8a strictly narrows what can reach it from every
  spawn to the dispatch alone. It does carry 7b round 1's wedge shape: the input
  stays `Pending`, the writer returns on `Deferred` (`projectWriter.ts:829-834`), and
  the aging term re-picks it as class head, so a permanently-unreachable remote
  stops the project deciding and the operation never answers its principal. Not this
  PR's to fix, but worth a line in 8b's brief. `submit_worker_result`: the only
  caller is `workerPlane.ts:377-383`, which always passes the nine-argument overload
  (NULL when the manifest names no source), so the sourceless overload serves no
  caller in `src`, `images/`, `deploy/` or `~/claude/chuggy-fabric`; moving the
  `execution_result_source` insert back after the completion call goes **RED** across
  the gate. `ticket_command_is_valid` refuses only a `Decide` carrying `Dispatch`;
  `ManualDispatch`/`ProposeDispatch` are separate command words and drive every
  postgres fixture's dispatch.
- **9 · comments and docs.** Gates above are clean; nothing I read overstates.

## Two report lines that overstate the tree (not findings)

- B's report and D's both say the scheduler's new arm is "not `ImpossibleState`".
  `schedulerCompletion.ts:399-414` still records kind `ImpossibleState` and varies
  only the evidence string, and `schedulerRefusalEvidence` has no caller in any
  suite — `SourceUnrecorded`/`WorkResultUnrecorded` are reached only by
  `migration.test.ts`'s literals.
- GOAL decision 4 places the reserved source reference in
  `schema/shared.ts`; it is `executionSource.ts:48`. It is also close to
  unreachable in practice, because `draftReleaseReadiness` refuses a release whose
  brief names no repository — the same parenthetical in decision 4 is wrong about
  that too.
