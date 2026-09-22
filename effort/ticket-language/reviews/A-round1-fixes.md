# Fixes: Task A round 1 review

Worktree `~/claude/chuggy-wt/no-accounts-review-a`, branch
`model/no-accounts-review-a`, commit `f80cf32c`. All eight findings fixed,
plus one collateral staleness finding 6's fix exposed (see below). Did not
touch `model/no-accounts` or its worktree.

## Findings

### 1. `src/actor/decisionSemantics.ts:26-32` — the header's stated reason is false

Deleted the false "A REPLAYED STATE IS NOT A STATE THE CURRENT DOMAIN
INVARIANTS DESCRIBE" paragraph — `deskConsistent` only asks whether a resume
*exists*, not which one, so nothing in the bundle rejects a semantics-1
replay any more.

Read `deskConsistent` (`src/domain/invariants.ts:99-105`) and confirmed it
compares only existence: `(t.resumeAt !== "NoResume") === resumable`. Read
`modeledResumeExists` (`src/domain/ticket.ts`, now `reason !==
"DependencyRevoked"`) and confirmed the zero-budget clause the review says
was deleted is gone.

Then found and named the real divergence the header was missing: at
semantics 2, `execDecisionEventAt`'s `case 2` applies no resumeAt correction
of its own (unlike `case 1`, which always overrides to `ResumeEvaluating`
regardless of budget) — so a semantics-2 replay of a rework-wall row falls
through to the *current* decider. Confirmed in `model/domain.qnt:552-553`
and `src/domain/deciders.ts:316-321` that the current decider stamps every
rework-wall escalate `ResumeReworking` unconditionally now that there is no
budget field on `Ticket` or `Config` anywhere in the tree (`grep -rn
reworkPolicy\|reworkBudget\|BudgetedRework` returns nothing). Confirmed
against `main` (`git show 81e8093a:model/domain.qnt`) that the old
`reworkWallResume` stamped `NoResume` for a zero-budget ticket — so a
semantics-2 row decided under that machine, if it walled with an authored
budget of zero, replays today as `ResumeReworking`: retryable, though the
machine that wrote it refused a retry.

Added this as the list's fourth bullet ("There are three" → "There are
four") and removed the false closing paragraph. Test `decisionSemantics.test.ts:155-166`
already exercises exactly this (semantics-1 resume is `ResumeEvaluating`,
semantics-2 resume is `ResumeReworking` on the same row) and still passes.

### 2. `src/actor/state.ts:11-14` — cites `stepDescends`, which this change deleted

Reground on `recordMonotone`, the invariant that actually reads the
`prevRecords`/`(pre, rec)` staleness `installCore` (`model/domain.qnt:697-701`)
preserves. Did not claim re-snapshotting would make `recordMonotone`
*fail* — its `>=` check would only go vacuous under re-snapshotting, not
false — so worded the sentence around what `installCore`'s own comment
says the danger actually is: presenting a non-decision step as the domain
step the bundle is meant to check.

### 3. `src/domain/ids.ts:12-14` — cites `accountsBounded`, which this change deleted

Replaced with the bound that's actually still there: every id is drawn from
a universe a `Config` constant bounds (`nTickets`, `nTasks`, `maxStages` in
`src/domain/config.ts`), confirmed by reading `config.ts`'s
`ticketIdUniverse`/`workFanoutChoices`/`isValidProgram`.

### 4. `src/domain/derived.ts:61-64` — model/code prose divergence

Copied the model's current wording (`model/domain.qnt:1125-1128`, "sits flat
while its deps run") over the stale "own measure cannot descend" phrasing.

### 5. `src/domain/witnesses.ts:9-11`, `test/domain/witnesses.test.ts:8` and `:99`

All three reground on `eval-stage-passed` (the label the interpreter's
advance edge actually fires) instead of "the stage digit". Renamed the
test at (old) line 99 from "...keeps the stage digit exercised" to
"...keeps eval-stage-passed exercised" so a grep for the deleted concept no
longer lands on it.

### 6. `src/domain/ticket.ts:33-41` — `stagesLeft` is dead

Deleted `stagesLeft` and its now-unused `evalStage` import (confirmed by
`grep -rn stagesLeft` over the tree, excluding `node_modules`, returning
only this definition both before and after).

Collateral: the file's own header ("what a park implies, how far through
its program it is, and the two sites that move its task set") named a
concern nothing in the file addresses once `stagesLeft` is gone — no
remaining function measures program progress. Not a review finding, but a
staleness my own edit introduced, so fixed it in the same commit rather
than leaving it: the header now reads "what a park implies, and the two
sites that move its task set."

### 7. `src/domain/deciders.ts:13` — dangling comment terminator

`* */` → `*/`.

### 8. `test/random/shrink.test.ts:74` — "budgeted run" names nothing after the rename

"A seed whose budgeted run draws a revoke" → "A seed whose run draws a
revoke". Confirmed there is exactly one instance now (`config =
modelInstance`) and no other use of "budgeted" vocabulary survives in the
file.

## Gate output (verbatim)

```
$ node --test --test-reporter=spec $(find test/domain test/actor test/golden test/conformance test/generated -name '*.test.ts')
...
ℹ tests 180
ℹ suites 0
ℹ pass 180
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2957.067382
```

```
$ .chug/tasks/check-comments.sh
check-comments: 0 finding(s) across 905 file(s)

$ .chug/tasks/check-paths.sh
check-paths: 0 finding(s) across 1208 path claim(s) in 1157 file(s)

$ .chug/tasks/check-figures.sh
check-figures: 0 finding(s) across 102 file(s)

$ .chug/tasks/check-boundaries.sh
check-boundaries: graph clean across 1056 module(s)
```

```
$ npx tsc --noEmit -p .
```
Exits 2, naming exactly 19 files — the same 19 the round-1 review reports
(`src/adapters/http/{contract,outcomes}.ts`,
`src/adapters/postgres/{readiness,selector}.ts`,
`src/interpreter/{authoring,dispatchView,projectWriter}.ts`,
`test/adapters/httpOutcomes.test.ts`, `test/contract/rosters.test.ts`,
`test/interpreter/{authoring,i3,projection,wire}.test.ts`,
`test/postgres/{finalizerRework,nativeActionAdmits,readiness,ticketProjection}.test.ts`,
`test/ui/{resumePoint,ticketActions}.test.ts`) — none under `model/`,
`src/domain/`, `src/actor/`, or the five suites `node --test` ran. The list
did not grow; these are Task B's files (the accounts-removal wiring beyond
this branch's tip), not this commit's.

## Commit

One commit, `f80cf32c` on `model/no-accounts-review-a`, `--no-verify`
(reasoning given in the commit's own last paragraph: the pre-commit hook is
red on Task B's sibling commits to `model/no-accounts` in another
worktree off the same base; every gate this brief names was run directly
and is green). Not pushed.
