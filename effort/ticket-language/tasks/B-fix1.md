# B-fix1: the rework cap counts only evaluation-failure reworks; 004's guard covers its own CHECK

Worktree `~/claude/chuggy-wt/no-accounts-fixb`, branch `model/no-accounts-fixb`
at 6fcb53cf. Commit on top; do not rebase, do not touch the baseline
migration, do not push. Read `.chug/tasks/review-change.md` first, then
`~/claude/chuggy-effort/ticket-language/reviews/B-round1.md` (findings 1 and
2 are yours; the rest is context) and `GOAL.md`.

## Finding 1 — `src/interpreter/reworkCap.ts`, `src/domain/task.ts`

Geoff's decision: finalizer rework is uncapped ("the finalizer can be
responsible for handling possible uncapped rework cycles"), and the cap
means what `BudgetedRework(2)` meant on main: two reworks *after a failed
evaluation*, a park on the third failed evaluation. Today
`workCyclesStarted` counts every maximal Work run, so a `FinalizationFailed`
(which re-enters Working through `finalizerFailure`) spends the cap. The
reviewer drove a `ManagedFinalizer` ticket through the real deciders: two
finalization failures then one evaluation failure escalates at `cyclesMax: 2`.

Fix: count, off `record` + `tasks` in id order, the Work runs that follow an
Evaluation run in which some task resolved `Failed` — those are the
evaluation-failure reworks. The first fan-out (no evaluation before it) and a
run after a passed evaluation (finalizer rework) do not count. Then
`reworkDisposition` escalates when that count `>= cyclesMax`, so `cyclesMax:
2` is exactly two reworks and a park on the third failure, and `cyclesMax:
0` parks on the first. Rename the domain function to what it now counts;
rewrite the two doc comments so they state this meaning, and correct the
report claim in `tasks/B-report.md` (a doc, same bar).

Tests, each proved red by a mutation you name in the report:
- a Work→Eval(Failed)→Work history counts one; a fan-out-2 run counts once;
- Work→Eval(Passed)→Work (finalizer rework) counts zero;
- an evaluation run with one Failed and the rest Cancelled counts one;
- through the real deciders: a `ManagedFinalizer` ticket with two
  finalization failures then evaluation failures still gets two reworks
  before parking at `cyclesMax: 2` (the reviewer's scenario, inverted);
- `cyclesMax: 0` escalates the first failure.
Check `test/interpreter/reworkCap.test.ts`, `dispatchWriter.test.ts`,
`ticketServiceRun.test.ts` and any golden/conformance fixture that encodes
the old count; the semantics of the journaled disposition do not change.

## Finding 2 — `src/adapters/postgres/schema/migrations/004-no-accounts.ts`

The header says a narrowed CHECK refuses at the top naming the relations
that hold the rows; 6fcb53cf added a narrowed CHECK on `session_turn`
(input length bound 17525063 → 17403663) outside the guard. Add a `UNION
ALL` arm to the existing `DO` block: `'session_turn'` where an input longer
than 17403663 exists. Extend `test/postgres/migration.test.ts` with the two
arms (a row in the band refuses with the message naming `session_turn`,
the ledger untouched; no such row migrates). Keep the guard's literal
pinned to `leadObservationTokensPerDecisionAt004` the way the CHECK's is.
Re-run the render diff (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`)
and confirm main vs branch is still additions-only.

## Gates

`check-postgres`, `check-queries`, `check-conformance`, `check-boundaries`,
`check-comments`, `check-figures`, `check-paths`, `emit-goldens` suite,
`node --test` over the touched suites. `check-source` stays red only on the
console files C is fixing; list them. Commit with `--no-verify` only for that
reason, message ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
Report to `~/claude/chuggy-effort/ticket-language/tasks/B-fix1-report.md`:
commit, the mutation each test went red under, gate exits, anything you
decided that the brief did not.
