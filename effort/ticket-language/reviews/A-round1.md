# Review: model/no-accounts round 1 (Task A) — CHANGES

**CHANGES**

The machine change is right and I could not break it: the disposition is a
nondet draw in `evalReduce`, a journaled payload in `refinement.qnt` and
`decisionEvent.ts`; the escalate branch keeps its label; finalization failure
always reworks; resume is free; dispatch needs no gas. Two model mutations went
red, both gate suites still fail their own mutant, the ten-row golden re-plan
holds, and every gate I could run is green. What is wrong is prose and one dead
export: six comments still argue from the measure or the accounts, and one of
them — the replay module's own header — now makes a false claim about a
function in the same tree.

## Findings

### 1. `src/actor/decisionSemantics.ts:26-32` — the header's stated reason is false

> "The first semantics grants the rework wall an eval resume, while
> `deskConsistent` in `src/domain/invariants.ts` holds that a wall's resume is
> the one its own decider stamps — so a correct replay of such a history reaches
> a state the current bundle rejects."

`deskConsistent` (`src/domain/invariants.ts:99-105`) holds no such thing. It
asks only whether a resume **exists**:

```ts
return parked === named && (t.resumeAt !== "NoResume") === resumable;
```

It never compares which resume. And `modeledResumeExists`
(`src/domain/ticket.ts:26-30`) is now `reason !== "DependencyRevoked"`, so a
semantics-1 replay of a rework wall — reason `ReworkBudgetExhausted`, `resumeAt`
corrected to `ResumeEvaluating` by `decisionAtReworkWallParkedEvaluating` —
gives `parked = named = true`, `resumable = true`, `resumeAt !== NoResume`.
`deskConsistent` **holds**. I checked the rest of the bundle over that state and
found nothing else it breaks.

This paragraph was true on `main`, where `modeledResumeExists` returned false for
`ReworkBudgetExhausted` at a zero budget. Deleting that clause deleted the
witness, and the rewrite kept the conclusion.

The divergence that *does* exist after this change is a different one, and the
header does not name it: at semantics **2**, a rework wall on a ticket authored
`BudgetedRework(0)` stamped `resumeAt: NoResume` (`reworkWallResume` on `main`),
and the same row now replays to `ResumeReworking` — the desk offers a Retry the
machine that wrote the row refused. `test/actor/decisionSemantics.test.ts:155-174`
asserts exactly that and calls it correct, and the fixture ticket 1 in
`journalAtSemanticsOneWalls.json` is authored `BudgetedRework(0)`, so it is the
case the suite actually runs. But the header says "EVERY CORRECTION IS READ OFF
THE ROW... There are three", and this is a fourth divergence that is neither
corrected nor listed.

Fix: say what is true. Either the paragraph goes (nothing in the bundle rejects
a corrected replay any more), or it is rewritten around the semantics-2
zero-budget resume, which is the one behaviour a replayed history no longer
reproduces — and that one belongs in the three-bullet list above it, since the
module's whole discipline is that a superseded semantics is stated as a
correction rather than left to drift.

### 2. `src/actor/state.ts:11-14` — cites `stepDescends`, which this change deleted

> "re-snapshotting on an emit would compare the measure against itself and
> falsely report `stepDescends` broken on a step the model proves harmless."

`stepDescends` and the measure are gone from `model/` and `src/domain/` in this
diff. `grep -rn stepDescends` over the tree returns nothing but this sentence, so
the carry rule's only stated justification now points at a symbol a reader cannot
find. The rule itself is still real — `installCore` in `model/domain.qnt:672-690`
still keeps `prevRecords` stale across a refinement step, and `recordMonotone`
still reads it — so the sentence wants re-grounding on `recordMonotone`, not
deleting.

### 3. `src/domain/ids.ts:12-14` — cites `accountsBounded`, which this change deleted

> "buys exactness the accounts do not need (`accountsBounded` bounds every digit
> by a declared constant)"

`accountsBounded` is removed from both `model/domain.qnt` and
`src/domain/invariants.ts` in this diff. The argument for `number` over `bigint`
now rests on a control that no longer exists, in the file that decides whether
every id in the domain is safe.

### 4. `src/domain/derived.ts:61-64` — the model's prose was updated here and the code's was not

The model now reads (`model/domain.qnt:1249-1252`):

> "Tickets that cannot move without a human ... it sits flat while its deps run"

`src/domain/derived.ts` still reads:

> "Tickets whose own measure cannot descend without a human"

Same definition, two descriptions, and the one in `src/` names a measure the tree
does not have. This is the straightforward model/code divergence the brief asks
about, and the model is the one that is right.

### 5. `src/domain/witnesses.ts:9-11`, `test/domain/witnesses.test.ts:8` and `:99` — "the stage digit"

All three say `stageAdvanceNever` exists so that "the stage digit" stays
exercised. The stage digit was `micro`'s middle term in `src/domain/measure.ts`,
deleted here. The witness is still worth having — without it `eval-stage-passed`
is never fired and the interpreter's advance edge is untested — so the sentences
want the reason they now have, and `:99` is a test name a grep for the deleted
concept will land on.

### 6. `src/domain/ticket.ts:33-41` — `stagesLeft` is dead, and the model has no counterpart

```ts
export function stagesLeft(ticket: Ticket): number {
```

Its only caller was `micro()` in the deleted `src/domain/measure.ts`.
`grep -rn stagesLeft` over the whole tree (excluding `node_modules`) returns this
definition and nothing else — no other source file, no test. The model deleted
its `stagesLeft` with the measure section, so `src/domain/` now carries an
exported function the specification does not have, and its own doc comment still
calls it "the digit". Delete it with the rest of the measure.

### 7. `src/domain/deciders.ts:13` — dangling comment terminator

```ts
 *   would no longer be a function.
 * */
```

The `* */` is what is left of the deleted metering paragraph. Prettier accepts
it, so no gate catches it; it should be `*/`.

### 8. `test/random/shrink.test.ts:74` — "budgeted run" names nothing after the rename

> "A seed whose budgeted run draws a revoke"

This change renamed `budgetedInstance` to `modelInstance` and the file's own
`config` with it (`shrink.test.ts:45-46`). There is one instance now, and
"budgeted" is the vocabulary that left.

## Notes

**What I read.** `git diff main..HEAD` whole, then in full: `model/ticket.qnt`,
`model/domain.qnt`, `model/refinement.qnt`, both `model/mc/` files,
`src/domain/{deciders,enablement,invariants,ticket,phase,witnesses,derived,ids,config}.ts`,
`src/actor/{decisionEvent,decisionSemantics,journal,equality,obligations,state}.ts`,
`test/golden/{manifest.json,corpus.ts,coverage.test.ts}`,
`test/actor/decisionSemantics.test.ts` and its two pinned fixtures,
`test/random/{draws,walk,walk.test,shrink.test}.ts`, `test/domain/{configs,declared,witnesses.test,enablement.test}.ts`,
the three repinned gate files, and the package's `ticket.qnt` for the one type
taken from it.

**Gates, run in `~/claude/chuggy-wt/no-accounts-review-a`.** All exit 0:

```
check-model: 0 failure(s), 116 test(s) run
check-conformance: 10 golden(s), 206 step(s) replayed clean, records, states and bundle
check-random: 1 instance(s), 2000 run(s), 80000 step(s) walked clean against the bundle and the completion accumulator
check-model-api: generated API is current
check-comments: 0 finding(s) across 905 file(s)
check-paths: 0 finding(s) across 1209 path claim(s) in 1157 file(s)
check-figures: 0 finding(s) across 102 file(s)
check-boundaries: graph clean across 1056 module(s)
check-conformance.test.sh: 9 passed, 0 failed
check-random.test.sh: 16 passed, 0 failed
```

`node --test` over `test/domain test/actor test/golden test/conformance
test/generated`: 180 tests, 180 pass. `npx tsc --noEmit -p .` names exactly the
19 files the report lists, none of them under `model/`, `src/domain/`,
`src/actor/` or the suites above. No exit 2 anywhere.

**Re-proofs I ran** (on a copy of `model/` in my scratchpad; I edited neither
worktree):

- `escalate(c, j, ResumeReworking, ...)` → `ResumeEvaluating` in
  `decideEvalStageReduce` → `stagedShortCircuitEscalatesTest` red.
- `finalizerFailure`'s `move(... Working ...)` → an escalate →
  `finalizationFailureReworksTest` red.
- The semantics-2 fixture goes red on demand: flipping row 5's record transition
  from `Escalated` to `Working` in a copy of `journalAtSemanticsOneWalls.json`
  turns "a second-semantics EvalReduce takes the edge its record records" and
  three siblings red (6 pass, 4 fail). The rec-derived disposition is really what
  those tests read.

**The golden re-plan holds.** Ten rows, every one aimed by an invariant
`coverage.test.ts`'s regex can read (`lastStep.label != "x"` or `not(lastStep.label
== "x" and ...)`), and `check-conformance` replays all ten clean.
`rework-wall-resume`'s aim does discriminate: it requires `t.to == Working` **and**
the last retired record entry's `kind != Work`. Only the evaluation wall can
satisfy both — the work wall and an `executionBlocked` in Working both retire a
Work set, so their `ResumeWorking` leaves `Work` last, and an `executionBlocked`
in Evaluating resumes to Evaluating, not Working. I read the emitted trace to
confirm: step 31 is `ticket-escalated rework_budget_exhausted` on ticket 6,
step 32 is `ticket-resumed` Escalated → Working on the same ticket.

**`review-change.md`'s renumbering is safe.** `grep` for `standing rule 1`,
`standing rule 2` and `standing rules 1` over the whole tree returns nothing, so
no surviving citation points at a retired rule, and 3 and 4 kept their numbers,
so the fifteen-odd citations of those still land. I considered whether the added
sentence ("The number is the citation's...") is a lesson stated outside its own
scope under house rule 16 and decided it is not: it is the minimum explanation of
why the list now starts at 3, which this change had to make.

**Looked at and chose not to flag.** `model/refinement.qnt:611` still says an
orphaned bookkeeping effect has "nothing priced riding it", inside a paragraph
the change rewrote from "price" to "count" two lines above — it reads as plain
English rather than as a measure claim, so it is an opinion, not a finding.
`mc_chuggy_directed`'s header drops `completionRedelivery` from its
"WHAT IS DROPPED" list; I checked `model/domain.qnt:915-926` and no such action
exists in `step`, so the list is now accurate rather than short. The removed
model tests are all account-only — I read `evaluatorCrashTicketPaysTest` on
`main` and it asserted nothing but three account deltas. `test/domain/enablement.test.ts:269`
keeps the "a running ticket is not retryable" case as its fourth ticket, so that
coverage survived the rewrite. `phase.ts`'s rank ladder has no readers left:
`grep` for `phaseRank|rankCeiling|rank{Settled,Working,Pending,Evaluating,Finalizing}`
over every `.ts`/`.tsx`/`.qnt` in the tree returns nothing, and `isSettled` as a
direct exhaustive switch is the better shape.

**Practices invoked**: `comments-describe-the-code`,
`fix-the-assumption-not-the-hack`. The first is what findings 1–5, 7 and 8 are —
comments that describe a tree that no longer exists — and the second is what
finding 6 is: the measure's assumption went, and one of its helpers stayed.

**Unsure about.** Whether finding 1's semantics-2 zero-budget resume needs
anything but a header sentence. It is deliberate, it is tested, and the new
machine makes every rework wall retryable anyway, so I do not think it is a
behaviour defect — but it is the one thing a replayed rig journal will do
differently from what it did, and the module whose job is to name exactly that
does not name it.
