# Review: Task B round 2 (the fix round)

**APPROVE**

Scope read: `git diff 6fcb53cf..f4a86f29` in `~/claude/chuggy-wt/no-accounts-fixb`
at `f4a86f29`, the two commits `f3d0519c` and `f4a86f29`. I read
`.chug/tasks/review-change.md`, `reviews/B-round1.md`, `tasks/B-fix1.md` and
`tasks/B-fix1-report.md`, and `src/domain/task.ts`,
`src/interpreter/reworkCap.ts`, `src/domain/deciders.ts`,
`src/adapters/postgres/schema/migrations/004-no-accounts.ts` and the three
touched suites in full rather than the hunks. Both findings of round 1 are
fixed, and fixed in the way the brief asked. I drove nine histories the tests
do not contain through the real deciders, red-proofed five mutations (two in
the domain, one in the cap, three in the guard), re-ran the render diff, and
ran six gates plus the touched suites. The worktree is clean at `f4a86f29`;
every scratch edit was reverted with `git checkout -- .` and confirmed.

One thing I could not reach a finding on, and which the brief asked me to
decide, is in the notes under **The one history "immediately before" gets
wrong**. It is a real, driven divergence, it is not reachable at today's
authoring defaults, and I do not believe it is fixable inside this function's
signature — so it is a note and not a blocking change.

## The count

`evaluationFailureReworksStarted` (`src/domain/task.ts:55-74`) is correct on
everything I could drive at it. Every history below is the real deciders'
(`execDecisionEvent` from `genesis`, `decisionEventEnabled` true at every
step), not a hand-built record; `=>` is the count the function returns.

| History as the deciders retire it | `=>` | right? |
|---|---|---|
| `1W:P 2E0:F 3E0:P 4W` — fanout-2 stage, the **Failed task has the lower id** | 1 | yes — the flag is set by any `Failed` in the run and no later `Passed` clears it |
| `1W:P 2E0:P 3E1:F 4W` — **multi-stage, the failure in stage 1** | 1 | yes — both stages are one non-Work run, and the stage-1 failure colours it |
| `1W:P 2E0:P 3E1:P 4W` — multi-stage passing, then `FinalizationFailed` | 0 | yes — the finalizer's rework is uncounted, which is the whole point of the fix |
| `1W:P 2E0:F 3W:F 4W:P` — rework, then a `WorkFailed` park and `ResumeWorking` | 1 | yes — the resumed work merges into the same run, so the resume costs nothing, as on `main` |
| `... 4E0:F` park, `ResumeReworking`, `5W` | 2 | yes — GOAL's "no refill": the next failure re-escalates |
| `1W:P 2E0:F 3W:C` — **revoked mid-rework** | 1 | moot, and safely so |

The revocation case cannot matter: `decideRevoke` (`deciders.ts:157-163`)
retires the live set with `Cancelled` and moves the ticket to `Revoked`, which
`reducibleEvalIn` never admits again, so `reworkDisposition` is never called on
a revoked ticket. The `Cancelled` work tasks it leaves are Work-kind and merge
into the run they sit in, so they could not change a count even if one were
taken.

Two evaluation runs *are* adjacent with no Work between them — that is exactly
the multi-stage case, and `decideEvalStageReduce` (`deciders.ts:277-289`)
spawns stage *n+1* only on a passing stage *n*, so a stage-0 failure never has
a stage 1 after it. Treating the whole contiguous non-Work stretch as one run
is therefore right rather than merely harmless.

**`>= cyclesMax` is right and red-proofs.** `cyclesMax: 2` drives
Rework, Rework, Escalate; `cyclesMax: 0` escalates the first failure;
`cyclesMax: 1` reworks once. Mutating `reworkCap.ts:54-55` from `>=` to `>`
reds all three cap cases (21/24 pass). Reverted.

**The reviewer's scenario inverted is genuinely driven.**
`dispositionsUnder(2, 2)` (`test/interpreter/reworkCap.test.ts:57-90`) steps
`execDecisionEvent` for every event, including the two
`FinalizationResult(FinalizationFailed)` rounds, and I confirmed against the
retired record rather than the test's assertion that those rounds really do
put Work runs in `record` before the evaluation failures start:

```
finalization FAILED   phase=Working  reworks=0  1W:P 2E0:P 3W:O
finalization FAILED   phase=Working  reworks=0  1W:P 2E0:P 3W:P 4E0:P 5W:O
```

`3W` and `5W` are Work runs in the record, and the count is 0 across both — so
the case is testing the thing it claims and not a degenerate history. The two
domain mutations the report names also hold: `if (!inWorkRun) reworks += 1`
(the landed behaviour) reds 7 of 24, deleting
`if (inWorkRun) evaluationFailed = false;` reds 1 of 24. Both reverted.

## The guard arm

`004-no-accounts.ts:75-78` uses `length(input) > 17403663`, the same bound the
narrowed CHECK at line 166 installs, and only the upper bound narrows — the
baseline's lower bound and the `result` bound
(`baseline/relations.ts:1147`) are unchanged, so one arm is the whole
narrowing. I enumerated 004's other statements: the two `reason` CHECKs have
their arms, `decision_event_is_valid` is `CREATE OR REPLACE FUNCTION` and is
called only from another function (`baseline/functions.ts:2128`), never from a
table CHECK, so it revalidates nothing; the drops and updates revalidate
nothing. The header's new claim that every narrowed check below has its arm up
there is true of the file as it stands.

Both arms red-proof, three ways, against a real server:

| Mutation | Red |
|---|---|
| drop the `session_turn` arm from the `DO` block | the in-band refusal case (the raw `check constraint … is violated by some row` does not match the regex) |
| `> 17403663` → `>= 17403663` | the at-bound case |
| `> 17403663` → `> 17525063` (the old baseline figure) | the in-band refusal case |

So the guard literal is pinned in both directions by the `constant + 1` /
`constant` pair, which is what the fix brief asked for. All three reverted.

**The refusal text.** `'rows this migration no longer admits remain in %'` is
the better wording — an operator handed "account rows remain in session_turn"
would look for a column that was never there — and nothing else quotes the old
text. `grep -rn "account rows remain"` over the tree is empty; the only hits
anywhere are in the effort directory's own round-1 and B-fix0 scratch, which
are records of what was, not claims about the tree. The two moved regexes
(`migration.test.ts:1426,1460`) still name their relation, so they remain
per-relation assertions rather than a shared prefix match.

## Gates, run here at `f4a86f29`

| Gate | Exit | Line |
|---|---|---|
| `check-postgres` | 0 | 75 suite(s) clean against postgres:18-alpine with 4 worker(s) |
| `check-queries` | 0 | `src/adapters/postgres` agrees with postgres:18-alpine |
| `check-conformance` | 0 | 10 golden(s), 206 step(s) replayed clean, records, states and bundle |
| `check-comments` | 0 | 0 finding(s) across 908 file(s) |
| `check-figures` | 0 | 0 finding(s) across 102 file(s) |
| `check-paths` | 0 | 0 finding(s) across 1209 path claim(s) in 1160 file(s) |
| `node --test` on `task.test.ts` + `reworkCap.test.ts` | 0 | 24 tests, 0 fail |
| `node --test` on the two new `migration.test.ts` cases | 0 | 2 tests, 0 fail |
| `check-source` | 1 | 3 stage(s) failed, 6 run |

Nothing exited 2.

`check-source` is red on five files and nothing else, all of them C's:

- `ui/chuggy-ui/app/core/codeSentences.ts`
- `ui/chuggy-ui/app/core/resumePoint.ts`
- `ui/chuggy-ui/app/core/ticketCreation.ts`
- `test/ui/resumePoint.test.ts`
- `test/ui/ticketActions.test.ts`

`src/contract/rosters.ts` and `src/domain/pricing.ts` appear in that output as
the *targets* of C's broken imports (`TS2307`, `TS2305`), not as red files of
their own. The three stages are typecheck, lint and unit, and every diagnostic
in all three is in one of the five.

**Render diff.** `render.mjs` over `~/claude/chuggy` at `81e8093a` and over the
branch: **0 removed lines, 119 added**, in one hunk appended at the end, the
whole `-- migration 4` block. Still additions-only.

## Notes

### The one history "immediately before" gets wrong

`ExecutionBlocked` is admissible in `Evaluating`
(`src/actor/decisionEvent.ts:246-252`, `taskPhaseIn`), including after some
task of the stage has already resolved `Failed`. `decideExecutionBlocked`
parks at `ResumeEvaluating` and `retireLive` cancels the rest of the set, so
the `Failed` task stays in the record; `decideResumeTicket`
(`deciders.ts:421-432`) then spawns a *fresh stage-0 set* — which lands in the
same contiguous non-Work run as the abandoned one. Driven through the real
deciders, every step `decisionEventEnabled`:

```
eval task 2 FAILED               Evaluating  reworks=0  1W:P 2E0:F 3E0:O
eval task 3's execution blocked  Escalated   reworks=0  1W:P 2E0:F 3E0:C
operator resumes                 Evaluating  reworks=0  1W:P 2E0:F 3E0:C 4E0:O 5E0:O
re-eval 4 and 5 pass             Evaluating  reworks=0  1W:P 2E0:F 3E0:C 4E0:P 5E0:P
eval reduced -> finalizing       Finalizing  reworks=0  ...
finalization FAILED -> working   Working     reworks=1  ... 6W:O
```

That `6W` is the finalizer's rework, and it is counted — so on the ticket's
*first* evaluation failure `reworkDisposition` answers
`EscalateEvaluationFailure` at `cyclesMax: 1`, and gives one rework instead of
two at the fabric's `cyclesMax: 2`. It is the same shape as round-1's finding
1, reached by a different door, and it makes `reworkCap.ts:15` ("THE CAP IS
OVER EVALUATION FAILURES ALONE") and `task.ts:48` ("How many reworks a failing
evaluation has cost a ticket") not literally true.

I am not raising it as a finding, for three reasons.

1. **It needs an eval stage of fanout ≥ 2.** `authoring.ts:523` authors
   `fanout: 1`, and a fanout-1 stage has no sibling execution left to block
   once its one task has reported. The rest of the chain — an infrastructure
   denial mid-evaluation, an operator resume, a clean re-evaluation, a
   `ManagedFinalizer`, a finalization failure — is ordinary, but the first link
   is not authored today.
2. **The consequence is conservative and visible.** The ticket parks one
   failure early, which opens a desk task a human reads. Nothing is lost and
   no record is wrong.
3. **I do not think it is decidable from the task history at all.** The
   abandoned run retires as `F C P P` in id order. A legitimate fanout-4 stage
   where one task fails, two pass and one is never reported retires as exactly
   `F C P P` too — `retiredInIdOrder` cancels whatever is outstanding at
   retirement, and id order is independent of resolution order. The two
   histories are identical as multisets *and* in id order, so no rule over
   `(kind, state, id)` can separate them. The only separating fact is which
   decision spawned the run, which lives on the journaled event and not on the
   ticket — and standing rule 3 forbids storing it back. I invoked
   `domain-modelling` here: this is its "a qualifier is a missing distinction",
   and the honest resolutions are either to narrow the two doc claims to what
   the derivation can actually see, or to take the count off the journaled
   dispositions, which is a design change and not a fix-round edit. Both are
   Geoff's call, not mine, and neither belongs in this commit.

### Smaller things I read and chose not to flag

- `test/interpreter/reworkCap.test.ts:78` passes `"ReworkEvaluationFailure"` to
  `evalReduceEvent` inside the finalization loop, where the evaluation
  *passed* and the disposition is dead. Harmless — `decideEvalStageReduce`
  reads `onFailure` only in the failing branch — but a reader may pause on it.
- `evaluationFailureReworksStarted` carries no assertion (house rule 10).
  Neither did `workCyclesStarted`, so this change does not introduce it, and I
  could not name a precondition worth asserting over a fold of a task list.
- `reworkCap.ts:28` is a 101-column one-line doc. The tree is full of those
  (`task.ts:100,150`), no gate covers comment wrapping, and prettier does not
  reflow them. Not a finding, and I would not touch it.
- Two commits rather than one is right: the findings are independent and house
  rule 12 wants each why in its own message. Both messages carry the why.
- `tasks/B-report.md` is corrected where it needed to be — the `cyclesMax`
  paragraph now records the defect and the new rule, and decision 3 is marked
  superseded. Its line 38 still names `workCyclesStarted`, correctly, as the
  name `bb22143b` landed, with the rename annotated inline.
- The attribution split round 1 noted (`eb7f1fdb` and `6fcb53cf` carry
  `Claude Opus 5 (1M context)`, the rest `Claude Fable 5.1`) is unchanged and
  still needs settling before this lands. Not this fix round's job.

### Practices invoked

`domain-modelling` (cited above, on the undecidability of the count from the
task history). I did not load `layering` or `fix-the-assumption-not-the-hack`:
nothing crossed a boundary in this diff, and the one assumption worth
rethinking is the note above, which I am not asking the author to act on.
