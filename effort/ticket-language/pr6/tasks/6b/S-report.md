# Task S (PR 6b) — migration 010, the task identity in columns

Tip `cfcc4f83` on `schema/task-identity`, two commits off `1e986583`, not pushed. New `migrations/010-task-identity.ts`; edited `migrations/index.ts` and `test/postgres/migration.test.ts`. `deploy/rig/wipe-tickets.sql` needed nothing (no relation arrives or leaves; `execution_request_task` was already truncated); `schema/README.md` names neither the relation nor the stage.

## 010's shape, in order

1. **The guard**, 008's `DO` block byte for byte: raises if any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`. The header argues it in this migration's terms — a stored `TaskDone` names its task by an integer, the key is gone rather than optional, so no stored entry validates under this image.
2. **`execution_request_task`**, one ALTER: `DROP CONSTRAINT execution_request_task_check`, `ADD COLUMN cycle bigint NOT NULL`, `ADD COLUMN generation bigint`, `ADD COLUMN evaluator bigint`, then the constraint again stating each arm whole — `Work`: cycle ≥ 1, stage, generation, evaluator all null; `Evaluation`: cycle, stage, generation, evaluator all present and ≥ 1. `task`, `kind`, the PK, the unique, the FK and the freeze trigger are untouched.
   **The existing `stage` becomes the package's positive key** rather than gaining a second column: the identity has one stage, and two spellings of it in one row is the drift the whole import is against. The only change is the floor in the restated constraint (`>= 0` → `IS NOT NULL AND >= 1`), and nothing rewrites a row because behind the wipe there are none.
   **`cycle` is NOT NULL because both arms carry one**; the other three are nullable because only one arm does. Adding a NOT NULL column with no default fails loudly on a non-empty table, which behind the guard cannot happen and would be the right refusal if it did.
3. **Three grants**: `GRANT SELECT(cycle|generation|evaluator) … TO chuggy_api`. `stage` was already granted at the baseline and keeps that grant through a floor change; every other role holds this relation by table, so a column arriving is already theirs.
4. **`decision_event_is_valid` replaced whole**: the `TaskDone` arm drops `command_integer(value->'tid')` for `NOT value ? 'tid'` (009's precedent, and its argument) and asks the identity of `value->'task'`.
5. **`submit_task_completion` replaced whole**, `CREATE OR REPLACE` and **no grant restated** — the signature does not move, because the identity is read rather than passed. It joins `execution_request_task` in the same `FOR UPDATE OF e` statement that already binds the execution (the join is total by `execution_has_its_authorized_task`) and builds `task` from `t.kind, t.cycle, t.stage, t.generation, t.evaluator`. `AlreadySubmitted`, `BindingMismatch` and the `Blocked` arm's `ExecutionBlocked{ticket}` are exactly as they were.

**The event spelling the arm admits** — the generated codec's, read off `src/generated/model-api.ts` on `origin/main` (a sum carrying a record is `{"type":…,"value":{…}}`): `{"type":"WorkTask","value":{"ticket":N,"cycle":N}}` and `{"type":"EvaluationTask","value":{"ticket":N,"workCycle":N,"stage":N,"generation":N,"evaluator":N}}`. The two constructor names and the two cycle field names are four consts at the top of the migration (008's `escalationRoster` idiom), read by both the arm that admits an entry and the function that builds one, so a rename by A lands in one place.

**What the arm weighs is the shape, not the floors**: `command_integer` per field, as the `tid` it replaces and the `ticket` beside it, with the positivity in the columns. The header says so.

## Render-diff

`scratch/B-fix0/render.mjs` (the brief's) run against `~/claude/chuggy` at `1e986583` and against the worktree: one append hunk, all of migration 10, no removed or changed line. 001–009 render identically.

## Tests and red-proofs

Six new cases plus a grants case in `test/postgres/migration.test.ts`: the ledger row; the guard refusing, naming the wipe, leaving no `cycle` column and the ledger stopped at 9; the relation taking a whole identity per kind and refusing every half of one (including an evaluation at the stage index the column used to admit); the api reading every column of the identity and holding no INSERT/UPDATE/DELETE; the mailbox admitting both identities and refusing `tid`, a half identity, an evaluation spelled the work arm's way, an unknown constructor and a task that is still a number; the door journalling the identity off the row it settled, for a work task and an evaluator, with `tid` proved absent; and the door still the boundary owner's and the scheduler's alone.

Sixteen single mutations, each run against the case that owns it — all RED, no survivors: the guard deleted; its message stripped of the remedy; `cycle` never added; `cycle` left nullable; the restated constraint removed; the stage kept at its index floor; the evaluation arm no longer asking for a generation; the work arm no longer refusing an evaluator; `evaluator` left ungranted; the arm no longer refusing `tid`; the work arm no longer asking for a cycle; the evaluation arm reading the work arm's cycle field; the door journalling `tid` again; the door building the cycle off the wire integer; the door reading no task row at all; the door swapping the stage for the generation.

`migration.test.ts` whole on the tip: **86 pass, 0 fail**. One legacy fixture moved: 008's completion seed inserts a `cycle`, which the relation now requires.

## Gates on the tip

`check-figures` 0, `check-comments` 0, `check-paths` 0, `check-duplication` 0, `check-source --static` 0 (five stages clean).

`check-queries` **1**, one query: `src/adapters/postgres/decision.ts:333` inserts `execution_request_task` without the identity. B's.

`check-postgres` **1**: 285 red cases across 27 suites — `finalizerPreparation`, `schedulerStore`, `scheduler`, `runEvidence`, `schedulerRace`, `finalizerConstraints`, `finalizerPermit`, `finalizer`, `finalizerBoundary`, `finalizerQueue`, `workerPlane`, `finalizerApproval`, `workerPool`, `journal`, `finalizerClosure`, `ticketInstants`, `operationalReads`, `schedulerContext`, `finalizerRework`, `finalizerUnavailable`, `ticketProjection`, `projectChange`, `i5`, `evaluationReports`, `workerCatalog`, `nativeActionAdmits`, `i3`. Every one of the 285 is the same line — `null value in column "cycle"` raised from `decisionExecution` (`decision.ts:332`) — so the whole set is one insert of B's. `migration.test.ts` is green. The gate terminated on its own.

## What B must know

- `decision.ts:333` must write `cycle` for both kinds and `stage`, `generation`, `evaluator` for an evaluation; `stage` is now **positive**, so `decisionPlan.ts requestTasks` must send `stageIndex + 1` and every reader of `execution_request_task.stage` (`scheduler.ts:342,369,759,1013,1131`, `operationalReads.ts:273,345`, `schedulerCompletion.ts:143`, `finalizerPreparation.ts:154,184,218`) moves with it.
- The requirement key `taskKindDefaults["Evaluation:<stage>"]` and the console's three `+1` label sites follow the same floor (decision 6, C's).
- The journalled payload is `{"type":"TaskDone","value":{"ticket":N,"task":{…},"verdict":…,"result":{…}}}`; a payload naming `tid` is **refused**, not ignored, so fixtures carrying a literal `TaskDone` will go red once the insert is fixed.
- If A renames the identity's constructors or its record fields, the four consts at the top of `010-task-identity.ts` are the only place the migration spells them.

## What GOAL.md got wrong

- Decision 4 reads as if `stage` might stay an index beside a new positive key. It cannot usefully: one row would then carry the stage twice, under two floors, with nothing holding them equal. The existing column is restated.
- Decision 4's "`GRANT SELECT(col)` each" is three lines and not four — `stage` was already granted at the baseline and a floor change takes no privilege with it.
- Commit attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief names — this ran on Opus, as 6a's S did.
