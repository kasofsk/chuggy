# Task B report — the rename in the interpreter, the adapters and the contract

Tip `23a3f93e` on `model/rename`, five commits off `8127f7b4` (A merged with S).

## Per layer

- **`src/contract/`** — `phaseRoster` and `resumePoints` take the model's
  spellings; `escalationReasons` loses four members rather than renaming them.
  New roster `blockedReasons`/`BlockedReason` restates the interpreter's
  `allBlockedReasons`, held against it in `test/contract/rosters.test.ts`.
  `ticketResponseSchema` gains `executionBlockedBy`, optional.
  `executionTaskKinds` stays `Work`/`Evaluation`: it is the fabric's word.
- **`src/interpreter/`** — `TicketResource.executionBlockedBy`;
  `storedSchedulerCompletion` in `wire.ts` lifts the stored envelope through
  A's `rowAtCurrentVocabulary` before decoding; `core` → `graph` in
  `projectWriter.ts` and `dispatchView.ts` (`ProjectMemory.core` → `.graph`);
  twelve files' comments say `TicketGraph` and the new phases.
- **`src/adapters/postgres/`** — the `executionBlockedBy` column on the single
  ticket read, the three release LATERAL joins admit both tags (006 recreated
  the partial index over both), `readTicket` extracted out of
  `nativeReadsResources` for the function-length cap.
- **006** — one statement added:
  `GRANT SELECT(blocked_reason) ON TABLE public.execution TO chuggy_api`, plus
  a header paragraph. Without it the whole read is refused, not one field.
- **tests** — A's two temporary vocabulary maps in `test/ui/` deleted; the
  `test/postgres/` suites write the new spellings (what turns that gate green);
  digest vectors re-pinned; `journal.test.ts`'s unsupported-semantics fixture
  moved to 6, 5 now having deciders. Three new end-to-end cases in
  `schedulerStore.test.ts` for the wall, one in `nativeReads.test.ts` for a
  release stored at the old tag, one in `wire.test.ts` for the collapse.

## The `executionBlockedBy` query

In `readTicket`, `src/adapters/postgres/nativeReads.ts`:

```sql
(SELECT x.blocked_reason FROM execution x
  WHERE x.tenant=t.tenant AND x.project=t.project
    AND x.ticket=t.ticket AND x.outcome='Blocked'
    AND t.reason='WorkExecutionUnavailableEscalated'
  ORDER BY x.terminal_at DESC,x.execution DESC
  LIMIT 1) AS execution_blocked_by
```

The single ticket read alone carries it; the project table has no room for a
wall. Red-proved three ways in `test/postgres/schedulerStore.test.ts` — drop
the grant, drop the reason guard, reverse the ordering — each red on its own
case, and the walled case drives the block through the real boundary and the
real writer and reads it back as `chuggy_api`, not as the owner.

## Adapter mapping sites (domain task kind → fabric)

`decisionPlan.ts` (`requestTasks`, and `SpawnWorkTasks` → `SpawnWork`) and
`projectWriter.ts:493`. A had written both; neither needed changing. Nothing
else in these layers names a domain task kind. `wire.ts`'s
`storedSchedulerCompletion` is the fourth mapping site and is new: it is the
wall collapse, and it is permanent, `submit_task_completion` building its
`ExecutionBlocked` out of `execution.blocked_reason` for good.

## Files outside my layers

`schema/migrations/006-rename.ts` — the grant above. Not compile-forced, but
the read cannot run without it. Nothing else; `src/actor/` untouched.

## Gates on the tip

`check-boundaries` 0, `check-queries` 0, `check-postgres` 0 (75 suites),
`check-conformance` 0 (9 goldens, 184 steps), `check-figures` 0,
`check-comments` 0, `check-paths` 0, `check-duplication` 0.

`check-source` **1**: `typecheck` and `unit` red, `browser`/`lint`/`format`/
`residue` clean. Every finding is the console —
`ui/chuggy-ui/app/core/{codeSentences,resumePoint,ticketActions}.ts` and the
two bridge suites that drive them — which is C's, the same hand-off A made me.

## What GOAL.md got wrong

1. **No grant on `execution.blocked_reason` for `chuggy_api`.** It had column
   grants on every other column of `execution`. A column grant refuses the
   whole query, so this was the read failing rather than the field missing.
   Fixed in 006. No owner-connected suite could have caught it.
2. **The wall cannot reach the reader for one path.** A ticket a *continuation*
   parks on an unreadable source (`projectWriterUnreadableLanding`) has no
   execution row at all, so B.md's "make sure `executionBlockedBy` still
   reaches the reader for that path" is not satisfiable as written. The
   `GitEvidence` is now durable nowhere for a continuation. **Filed, not
   fixed**: the fix is a durable home for the observation, a writer change.
3. **The stored finalization outcome is not lifted.** 006 admits both
   spellings of `in_outcome`, but `checkedFinalizationSubmission` in `wire.ts`
   still compares against `finalizationOutcomeTags` alone, so a
   `SubmitFinalizationResult` written before the deploy and not yet decided is
   admitted by the database and refused by the writer. **Filed, not fixed**:
   the word map's one honest home is `decisionSemantics.ts`, which this task
   was told not to touch.

Commits end `Co-Authored-By: Claude Opus 5 (1M context)`, per the session's
attribution, not the brief's `Claude Fable 5.1`. A's did the same.
