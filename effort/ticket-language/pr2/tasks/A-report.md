# Task A report (PR 2): the model loses NoFinalizer, the cascade and AnyPass

Worktree `~/claude/chuggy-wt/three-deletions`, branch `model/three-deletions`,
base main `617675bb`. Tip `c64bb04c`. Not pushed.

## Commits

| Commit | What it did |
|---|---|
| `05547b54` | `model/ticket.qnt`, `domain.qnt`, `refinement.qnt`, `api.qnt`, `model/tests/`, `.chug/tasks/check-model.sh`: the three deletions in the specification |
| `8dec85a1` | `emit-goldens.sh`, `test/golden/`: `nofinalizer-completion` dropped, all nine goldens re-emitted with the pinned quint, corpus and coverage suite follow |
| `d3128929` | `src/generated/`, `src/domain/generated/`, `src/domain/`, `src/actor/`, and the domain/actor/conformance/random/itf/generated suites |
| `ea4731f9` | `src/actor/decisionSemantics.ts` at version 4 and its suite |
| `c64bb04c` | two call sites in `test/interpreter/` the signature change left behind |

### 1. The model

`Stage = { fanout: int }`; `Combinator` and `Finalizer` deleted; `Ticket` loses
`finalizer`; `Reason` loses `DependencyRevoked`; `combine(tasks)` is unanimous
and takes no combinator. `decideRevoke` transitions its own ticket only, with
one `CancelTicketWork` and no `OpenHumanTask`. `modeledResumeExists`,
`revokeDoomed`, `cascadeSafety`, `noStructuralDeadlock`, `canFinish` and
`finalizerChoices`/`noFinalizationWithoutAKind`/`finalizerWellFormed` left
`allInvariants`, which is now completionExclusive, revokedNeverCompletes,
artifactWellFormed, terminalsAbsorbing, deskConsistent, tasksWellFormed,
recordWellFormed, recordMonotone, idsAccounted, programsWellFormed, depsAcyclic,
ticketIdsWellFormed, stuckSubsetCovered. `deskConsistent`'s second conjunct is
now `(resumeAt != NoResume) iff (phase == Escalated)` — every wall has a resume.
Three tests replace what went: `revokeTransitionsOnlyItsOwnTicketTest`,
`strandedDependentWaitsForItsAuthorTest`, `stageVerdictIsUnanimousTest`. The
`cascade` and `wrapup_none` witness modules and
`noFinalizerCompletionRecoversTest` are deleted, and `check-model.sh`'s witness
roster is `resume rework stage sparse gate dependency`.

No comment anywhere in `model/` still cites `cascadeSafety`,
`DependencyRevoked`, `NoFinalizer` or `AnyPass`; the same grep is clean across
`src/domain`, `src/actor`, `src/generated` and the A-owned suites.

### 3. The domain

The generator wrote `src/domain/generated/modelTypes.ts` and
`src/generated/model-api.ts`. New in `src/domain/derived.ts`:

```ts
export function revokedDependencies(core, id): readonly TicketId[]
```

the direct dependency edges whose ticket is Revoked, in id order — `visEdges`
already sorts, which is where the ordering comes from.

### 4. Decision semantics 4

`DecisionSemanticsVersion = 1 | 2 | 3 | 4`, current 4, header rewritten in its
own voice with no count. `replayableDecision` is now three arms rather than a
label list: the removed walls, a `ticket-done` record with a transition out of
any phase but Finalizing, and a `ticket-revoked` record with more than one
transition. `storedJournalLegalOn` already consulted it, so the refusals land
there unchanged.

## What each gate said

Run at the tip, in the worktree.

```
check-conformance: 9 golden(s), 180 step(s) replayed clean, records, states and bundle
check-random: 1 instance(s), 2000 run(s), 80000 step(s) walked clean against the bundle and the completion accumulator
check-model: 0 failure(s), 111 test(s) run
check-boundaries: graph clean across 1052 module(s)
check-comments: 0 finding(s) across 904 file(s)
check-figures: 0 finding(s) across 102 file(s)
check-paths: 0 finding(s) across 1204 path claim(s) in 1154 file(s)
check-source: 3 stage(s) failed, 6 run
```

`check-source` is red as the brief said it would be. The files, and nothing
else:

```
src/adapters/http/contract.ts
src/adapters/http/outcomes.ts
src/interpreter/authoring.ts
src/interpreter/dispatchView.ts
test/adapters/httpOutcomes.test.ts
test/contract/representations.ts
test/contract/rosters.test.ts
test/interpreter/authoring.test.ts
test/interpreter/leadTurn.test.ts
test/interpreter/projection.test.ts
test/interpreter/selector.test.ts
test/postgres/authoring.test.ts
test/postgres/leadDecision.test.ts
test/postgres/migration.test.ts
test/postgres/nativeReads.test.ts
test/ui/resumePoint.test.ts
test/ui/ticketActions.test.ts
```

Every commit used `--no-verify`, for that red alone.

## Mutations that red-proofed a test

Each was applied to the tip, the suite run, and the file restored. Every one of
them turned the named test red and nothing else, except where stated.

| # | Mutation | Test that went red |
|---|---|---|
| M1 | `completedWithoutFinalizing` returns `false` | a row that completed a ticket without running a finalizer cannot be replayed |
| M2 | its phase test reads `t.from !== "Working"` | the same |
| M3 | `revokedMoreThanItsOwnTicket` returns `false` | a revoke that transitioned more than its own ticket cannot be replayed |
| M4 | its arity test reads `transitions.length > 0` | the same |
| M5 | `replayableDecision` keeps only the removed-wall arm | both of the above |
| M6 | `decisionSemanticsVersionCurrent` stays 3 | the current semantics is the one whose refusals this module states |
| M7 | `isDecisionSemanticsVersion` drops its `4` arm | the same |
| M8 | every `.object(` in `src/generated/model-api.ts` becomes `.strictObject(` | the whole `decisionSemantics.test.ts` file: the pinned fixture is refused, naming `finalizer` and `combinator` as unrecognized keys |

M8 is the red proof of the dropped-key acceptance. It is coarser than the
others — a strict codec refuses the fixture at load rather than failing one
assertion — but it is the only edit that could make the acceptance false, and
the refusal names both keys.

The three earlier commits carry their own evidence in the suites they moved;
the model's suites are their own red proof, since `check-model.sh` runs every
test and the witness modules are claims the run expects violated.

## Decisions the brief did not make

**How `storedJournalLegalOn` refuses a `NoFinalizer` or an `AnyPass` row.**
GOAL asks for the refusal to be on the row naming them. It cannot be: zod's
`.object()` strips unknown keys, so by the time a stored row is an `Entry` the
`finalizer` and `combinator` keys are gone and unspellable to the actor. I
verified this against the regenerated codec and the pinned fixtures, which
carry both keys and parse clean. So the refusal is read off the record, which
survives the decode:

- a finisher-free release completed its ticket out of Evaluating, so a
  `ticket-done` record transitioning from any phase but Finalizing is refused;
- a cascading revoke transitioned its dependents, so a `ticket-revoked` record
  with more than one transition is refused;
- `AnyPass` gets no arm. A stage it passed on a mixed set carries
  `eval-passed` where this machine's `combine` produces
  `rework-started eval_failure`, and `recordEquals` already refuses that row. A
  history where the difference never arose replays identically, which is
  correct, since `UnanimousPass` is the surviving meaning.

That arithmetic is what makes the header's five corrections and one divergence:
the semantics-1 eval resume, the disposition read from the record at 1 and 2,
the removed-wall refusal, these two new refusals, and the standing semantics-2
rework-wall divergence.

**Six signatures shed a parameter.** `decideRevoke` took the config only to
open the cascade's desk tasks. With that gone the config was unused, and
`noUnusedParameters` is on, so keeping it was not an option — only hiding it
behind an underscore was. I dropped it instead, and the same drop propagated
through `execDecisionEvent`, `execDecisionEventAt`, `replayCore`,
`storedReplayCore`, `crashRecoverTo` and the conformance `replayStep`, each of
which carried the config only to pass it on. `recoveryComplete` in
`src/actor/obligations.ts` takes `_config` instead, because `Obligation` is a
fixed signature and five of its siblings already do.

**The guarded bundle evaluation lost its demonstration.** `cascadeSafety` was
the one member of `invariantBundle` that could throw — it reached `ticketAt`
for a dangling dep — and `test/conformance/evaluate.test.ts` used it to show
the guard in `evaluate.ts` catching something. Every remaining member is total
on that state. Rather than delete the demonstration or weaken it to a green
assertion, `evaluateBundle` now takes the roster it asks (defaulting to
`invariantBundle`) and the suite hands it a partial leaf directly. Both halves
are still asserted: the dangling state fails `depsAcyclic` and refuses nothing,
and the injected leaf is named as refusing rather than taking the run down.

**`dependableIn` keeps its refusal of an edge to a Revoked ticket.** GOAL does
not name it as leaving, and without it a release could author a dependency that
can never be satisfied. It is now just `phase !== "Revoked"`.

**`retryableIn` keeps its `resumeAt !== "NoResume"` conjunct.** With
`deskConsistent` it is now equivalent to the phase check, but collapsing it
would make the enablement depend on an invariant rather than on the ticket.

**A staged-program walk in the model suite changed one task's verdict.**
`stagedProgramPassesTest` had a stage-1 task failing and relied on `AnyPass` to
carry the stage. It now passes that task, so the test still pins a passing final
stage rather than being weakened to expect a rework.

**Two figures in suites moved with the vocabulary.**
`validProgramsIn(modelInstance).length` is 6 rather than 20 (two fan-outs, no
combinator, at most two stages), and `stageChoices(config).length` is
`config.nTasks` rather than twice it.

## Minimal edits outside A's scope

Forced by the typecheck, listed as the brief asks. All are mechanical; none
changes behaviour.

- `src/interpreter/projectWriter.ts` — three calls drop the config argument.
- `test/interpreter/projection.test.ts`, `test/interpreter/reworkCap.test.ts`,
  `test/interpreter/i3.test.ts`, `test/postgres/readiness.test.ts` — the same
  argument drop, plus `ticketOn`'s finish-kind argument and one instance
  constant that was left holding nothing.

`test/interpreter/projection.test.ts` is still red on a `DependencyRevoked`
reason, which is B's to rework, and `test/ui/` and the rest of
`test/postgres/` are untouched.
