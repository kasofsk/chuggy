# Review: model/no-accounts-review-a round 2 (the fix to round 1) — CHANGES

**CHANGES**

The eight round-1 findings are answered, and the one that mattered is answered
correctly: the false `deskConsistent` paragraph is gone, and the divergence the
header was missing is now stated, in the right semantics, in the right
direction. I verified it end to end against `main`'s machine and the pinned
fixture rather than against the author's account of it. The other seven are
true rewordings, the dead export is gone with its import, and 180/180 tests and
all four gates are green in the worktree.

What is wrong is smaller, and it is the same defect round 1 found, twice more:
one of the eight fixes replaced a citation of a deleted symbol with a claim the
change itself made false, and three sentences in `model/domain.qnt` — the
specification, which the regrounded `src/` comments now mirror — still cite
symbols this change deletes. Round 1's finding 2 asserted `grep -rn
stepDescends` over the tree returns only the `state.ts` sentence; that was
wrong, and the author fixed what the finding named rather than what the grep
would have shown.

## Findings

### 1. `model/domain.qnt:661`, `:1065`, `:1284` — the model still cites what this change deleted

Three `///` comments name symbols removed in `git diff main..HEAD`:

- `:661` (the `prevRecords` ghost): "the retained-record monotonicity invariant
  needs one step of history, exactly like stepDescends needs prevMeasure".
- `:1065` (`recordMonotone` itself): "Checked step-wise like stepDescends; with
  it, 'retained' is a theorem, not a convention."
- `:1284` (`stageAdvanceNever`): "the green invariant runs above are checked
  against traces where the stage digit and the interpreter's advance edge are
  exercised".

`grep -rn "prevMeasure\|stepDescends\|measureDescends"` over every `.qnt` and
`.ts` in the tree (excluding `node_modules`) returns exactly `:661` and `:1065`
and nothing else; `grep -n "stage digit"` returns exactly `:1284`. All three
declarations are deleted in this diff (`git diff 81e8093a..HEAD --
model/domain.qnt` removes `var prevMeasure`, `val stepDescends`, `val
measureDescends` and the old "stage digit" occurrence at its line 326).

This is round-1 findings 2 and 5 in the file that outranks the ones they were
raised against. It is worse after the fix than before it: `src/actor/state.ts`
now grounds the carry rule on `recordMonotone`, and `recordMonotone`'s own
header in the specification explains itself by analogy to an invariant that no
longer exists; `src/domain/witnesses.ts` and `test/domain/witnesses.test.ts`
now say `eval-stage-passed` where `stageAdvanceNever`'s model header still says
"the stage digit", so the code and the spec describe the same witness in two
vocabularies and the stale one is the spec's.

Fix: reground all three where the code's counterparts were regrounded. `:661`
and `:1065` want the analogy dropped or replaced (`recordMonotone` is now the
only one-step-of-history invariant, so there is nothing to be "exactly like");
`:1284` wants `eval-stage-passed` in place of "the stage digit", matching
`src/domain/witnesses.ts:9-11`.

### 2. `src/domain/ids.ts:13-16` — the replacement bound is false for task ids

> "buys exactness this domain does not need: every id is drawn from a universe
> a `Config` constant bounds (`nTickets`, `nTasks`, `maxStages` in
> `src/domain/config.ts`), small enough that `number` already represents it
> exactly"

Two of the three branded numeric ids are bounded that way. `TicketId` is drawn
from `ticketIdUniverse` (`config.ts:30-34`, `nTickets * 2`) and `StageIndex`
indexes a program `isValidProgram` caps at `maxStages` (`config.ts:72-81`).
`TaskId` is neither drawn from a universe nor bounded by a `Config` constant:
`nextTaskId` (`src/domain/task.ts:108-110`) issues `firstTaskId +
recordLength + liveCount`, and `record` grows by a fan-out on every retire, for
as many work cycles as the ticket runs. This file says so itself four lines
down — `ids.ts:28`: "A task's identity: sequential within its ticket, **across
the ticket's whole history**."

What bounded that history on `main` was the accounts: `gasLeft` was decremented
at every rework edge and every resume, so a ticket's cycle count — and with it
its record length and its largest task id — was capped by a declared constant,
which is what the deleted `accountsBounded` bounded. This change removes that
cap from the domain (the GOAL puts the rework cap in the ticket service's
configuration, outside `Config`), so the replacement sentence asserts a bound
that this very commit's parent removed. It is round-1 finding 1's shape exactly:
the witness was deleted and a conclusion was written to replace it.

Fix: say what is true. The paragraph's own argument already carries it — the
assumption is *checked* rather than bounded, by `asSafeInteger` at every
boundary — so the parenthetical can name the two ids a `Config` constant really
bounds and leave the task id to the check, or drop the bound claim and rest on
the check alone. (`asSafeInteger`'s own doc at `ids.ts:55-58`, "Every quantity
here is bounded by a declared constant", is the same claim in vaguer words and
is now equally untrue for a task id; it is pre-existing and I am not asking for
it, but it is the sentence a reader will land on next.)

## Notes

**What I read.** The brief; `.chug/tasks/review-change.md` on the branch;
`GOAL.md`, `reviews/A-round1.md`, `reviews/A-round1-fixes.md`; `git diff
dc867998..f80cf32c` whole and the fix commit's message; then in full
`src/actor/decisionSemantics.ts`, `src/actor/state.ts`, `src/domain/ids.ts`,
`src/domain/config.ts`, `src/domain/ticket.ts`, `src/domain/witnesses.ts`,
`src/domain/derived.ts:59-70`, `src/domain/invariants.ts` (`deskConsistent`,
`recordMonotone`, the roster), `src/domain/deciders.ts:295-325`,
`src/domain/task.ts:100-120`, `test/actor/decisionSemantics.test.ts:1-200`,
`test/actor/journalAtSemanticsOneWalls.json`'s release row,
`test/domain/witnesses.test.ts`, `test/random/shrink.test.ts:35-90`,
`model/domain.qnt` around `installCore`, `recordMonotone`, `stuckSet`,
`stageAdvanceNever` and the rework wall, `git show 81e8093a:model/domain.qnt`
(`reworkWallResume`, `resumeCharge`, `decideResumeTicket`), `git show
81e8093a:src/domain/ticket.ts`, and `.chug/tasks/check-figures.sh`'s header.

**The header's four corrections, checked one at a time.**

- *The disposition from the record.* True. `dispositionInRecord`
  (`decisionSemantics.ts:85-91`) reads `rec.transitions.some(t => t.to ===
  "Escalated")`, `eventAtRecordedDisposition` applies it, and both `case 1` and
  `case 2` of `execDecisionEventAt` go through it while `case 3` does not.
- *A removed-wall record unreplayable.* True. `removedWallLabels` holds the two
  labels, `replayableDecision` refuses them, and
  `decisionSemantics.test.ts:176-197` proves `storedJournalLegalOn` refuses a
  row carrying `ticket-escalated gas_exhausted`.
- *The zero-budget rework wall replaying as `ResumeReworking`.* True, and this
  is the new bullet. `main`'s `reworkWallResume` (`git show
  81e8093a:model/domain.qnt:347-348`) is `if (reworkBudget(rw) > 0)
  ResumeReworking else NoResume`, and the wall was stamped with it at `:638`.
  The current decider (`src/domain/deciders.ts:316-322`) stamps
  `"ResumeReworking"` unconditionally on the escalate branch, `case 2` applies
  no resume correction, and the fixture's ticket 1 is released with
  `"reworkPolicy": {"type": "BudgetedRework", "value": 0}` — so the row the
  suite actually replays is the zero-budget one.
  `decisionSemantics.test.ts:155-166` asserts `ResumeEvaluating` at 1 and
  `ResumeReworking` at 2 on that row, and `:167-174` asserts it is resumable
  under both. The bullet's last clause ("replays retryable though the machine
  that wrote it refused a retry") is exactly that.
- *Pricing ignored at decode* (the brief's first item) is not in this header,
  and I do not think it should be: it happens at `decodeEntry`, not as a
  correction read off the row, and the fixture proves it works — the pinned
  release rows still carry `finalizationPricing`, `reworkPolicy` and
  `resumePricing` and decode clean. The header's own first bullet is the
  semantics-1 eval-resume correction, which `decisionAtReworkWallParkedEvaluating`
  implements and `decisionSemantics.test.ts:155-166` pins.

**Nothing in the header still overclaims `deskConsistent`.** `grep -n
deskConsistent src/actor/decisionSemantics.ts` returns nothing; the false
paragraph is deleted rather than reworded. `deskConsistent`
(`invariants.ts:99-105`) compares only existence, and with
`modeledResumeExists` now `reason !== "DependencyRevoked"` a corrected
semantics-1 replay of the rework wall satisfies it, which is why deleting the
paragraph is the right answer rather than rewriting it.

**The other six rewordings.** `state.ts:9-15` is true and stops short of the
claim it could not make: re-snapshotting `pre` would make `recordMonotone`
vacuous, not false, and the new sentence says "present a step that decided
nothing as the domain step ... meant to check" rather than "falsely report
broken" — which is what `installCore`'s own header
(`model/domain.qnt:678-701`) says the danger is. `recordMonotone` is the only
invariant reading `view.pre` (`grep -n "view.pre" src/domain/invariants.ts`
returns `:171` and `:173`), so naming it is right. `derived.ts:61-64` is the
model's own wording at `model/domain.qnt:1125-1128`, verbatim in substance.
`witnesses.ts:9-11` and `witnesses.test.ts:8`, `:99` name `eval-stage-passed`,
which is literally what `stageAdvanceNever` (`witnesses.ts:37-39`) tests.
`deciders.ts:13` is `*/`. `shrink.test.ts:74` drops "budgeted", and `grep -rn
"budgeted\|Budgeted"` over `src/domain`, `src/actor` and `test/random` returns
nothing.

**The `stagesLeft` deletion.** `grep -rn "stagesLeft"` over every `.ts`, `.tsx`
and `.qnt` outside `node_modules` returns nothing — the definition was its only
occurrence. `evalStage` survives its lost caller with six others
(`deciders.ts:271`, `invariants.ts:140`, `task.test.ts:116-118`, and the model),
so dropping the import from `ticket.ts` is right and not a wider deletion.
The header trim is honest about what is left: `hasOpenHumanTask` and
`modeledResumeExists` are "what a park implies", `spawnOn` and `retireLive` are
"the two sites that move its task set". (`ticketIsSettled` and the second
paragraph's `completions` are both unnamed by the header and both pre-date this
branch; not this change's.)

**Gates, run in `~/claude/chuggy-wt/no-accounts-review-a` at `f80cf32c`.** No
exit 2 anywhere:

```
node --test over test/domain test/actor test/golden test/conformance test/generated
  tests 180, pass 180, fail 0                                          exit 0
check-comments: 0 finding(s) across 905 file(s)                        exit 0
check-paths: 0 finding(s) across 1208 path claim(s) in 1157 file(s)    exit 0
check-figures: 0 finding(s) across 102 file(s)                         exit 0
check-boundaries: graph clean across 1056 module(s)                    exit 0
```

I did not redo the model probes: no fix touches a decider or a test's reach —
the only non-comment edits in `dc867998..f80cf32c` are the `stagesLeft`
deletion, its import, and one test's name.

**An opinion, not a finding.** `decisionSemantics.ts:15-16` introduces the list
as "EVERY CORRECTION IS READ OFF THE ROW, which is why one takes the row and
not just its event. There are four", and the fourth bullet says "a rework
wall's resume gets no correction of its own". A reader checking the lede
against the list finds three things read off the row and one that is read off
nothing — it is an uncorrected divergence, which is what round 1 called it. The
list is the right place for it (a superseded semantics stated rather than left
to drift is this module's whole discipline), so this is a lede that wants one
more clause, e.g. three corrections and the one divergence none of them covers.
Take it or leave it.

**Looked at and chose not to flag.** `decisionSemantics.ts:17-18` calls the
semantics-1 wall "the evaluation wall" where bullet 4 and
`decisionAtReworkWallParkedEvaluating` call the same wall (reason
`ReworkBudgetExhausted`) "the rework wall"; the bullet is unchanged by this fix
and PR 3 renames the reason anyway. `ticket.ts`'s second paragraph names
`completions`, which no function in the file touches — pre-existing on `main`,
unchanged here. `ids.ts:55-58` is covered inside finding 2 rather than raised
separately.

**Practices invoked**: `comments-describe-the-code`. Every finding in both
rounds is one shape of it — a comment describing a tree that no longer exists —
and finding 2 is its fourth point read in reverse: the justification was
rewritten to keep the conclusion when the thing being justified had changed.

**Unsure about.** Whether finding 1 belongs to this round at all: those three
model sentences were made false by `82649aff`, not by the fix, and round 1 held
the machine and passed them. I am raising them because the fix commit's stated
scope is "reground comments the accounts removal left dangling", these are
dangling, and two of them are now the stale half of a pair whose other half the
fix regrounded. If the effort would rather they went in with Task B's model
work, that is a scheduling call, not a disagreement about the text.
