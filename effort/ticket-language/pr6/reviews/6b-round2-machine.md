# PR 6b review round 2, machine half — task D's diff, `1fb1bc26..71c13aae`

Verdict: **CHANGES** — one finding, in a test's account of itself. The model,
the roster, the adapter, 010's ALTER and both model docs are right.

## Finding

1. **`test/postgres/migration.test.ts:3809-3812` claims a roster it does not
   hold, and leaves two thirds of the restated CHECK untested.** The header
   says "Each source an execution may be registered under, now that no task
   names one"; the table under it is `ExplicitTask` (refused) and
   `TaskKindDefault` (admitted). `ExplicitTask` is the one source an execution
   may *not* be registered under, and `TicketDefault` and `PlatformDefault` —
   two of the three the new ARRAY admits — are absent. The failure: the
   constraint at `010-task-identity.ts:131` is a hand-written literal nothing
   holds to `requirementSources` (`src/contract/rosters.ts:165`), and
   `'TicketDefault'` is spelled in no test that reaches a server
   (`schedulerStore.test.ts:281` exercises `PlatformDefault`; nothing exercises
   `TicketDefault`) — so a typo in that one word passes every gate and refuses
   every ticket-default execution on the rig. House rule 13. Add the two
   admitted rows, which also makes the header sentence true.

## What I checked and found right

- **Model.** `selectedRequirement` takes no task, `materialize` passes none,
  `explicitTasks`/`ExplicitTask` survive nowhere under `model/`. The renamed
  `precedenceIsKindThenTicketThenPlatformTest` pins all three arms, kind first;
  the re-keyed cases still exercise what their names claim.
- **Roster.** Contract roster, interpreter union, `asRequirementSource` and
  `executionRowRequirementSource` lost the member together;
  `rosters.test.ts:308` is an exhaustive `Record` over the union, so a
  one-sided drop fails to compile. No `switch` over `RequirementSource` exists
  in `src/` — both readers are `!==` guards that throw — so no arm went quiet.
  The console holds no roster of its own.
- **010.** 009's drop-by-name-then-restate idiom; the literal admits exactly
  the three. Re-proved red: without the ALTER, `check-postgres` exits 1 with
  exactly one ✖ ("Missing expected rejection: a requirement a task named for
  itself"); restored, clean. No stale row can fail validation —
  `deploy/rig/wipe-tickets.sql:43` truncates `public.execution`.
- **Render-diff 001–009 empty by construction**: D touched only
  `010-task-identity.ts`, no migration imports `rosters.ts`, and `shared.ts`
  carries role names alone.
- **Docs.** `AGENTS.md:13-14` — `ticket.qnt` uses `TaskIdentity` and neither
  def; `domain.qnt:976,1033` calls `taskOwner` and `taskIdentityValid`; the
  five named types have zero callers outside the copy. `domain.qnt:347-349`
  now names the cycle counter and `stageGeneration`, which is what the
  identities are distinct by.
- **Gates at the tip, all 0**: `check-model` (114), `check-model-api`,
  `check-source` (207 suites), `check-queries`, `check-postgres` (76 suites),
  `check-figures`, `check-comments`, `check-paths`.

## Notes

- The roster test holds the contract roster to the *interpreter's* union, not
  the model's; model↔TypeScript drift there is caught by a reader, not a gate.
  Pre-existing, not D's.
- 010's new header paragraph and the doc on `selectedRequirement` each state a
  rule at the definition it governs, inside this change's scope — neither is a
  house-rule-16 lesson. Practices invoked: none.
- Worktree `~/claude/chuggy-wt/identity-review-machine2` removed; no database
  of mine left on `chuggy-check-postgres`.
