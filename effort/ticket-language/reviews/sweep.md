# Mutation sweep — PR 1 (the accounts leave), whole branch

Reviewed at `7429fe4f` in `~/claude/chuggy-wt/no-accounts-review-b`, detached,
scope `git diff main...7429fe4f`. Fresh session, authored none of it. Every
mutation below was applied one at a time and reverted with `git checkout -- .`;
the tree is clean and nothing was committed.

## APPROVE

Twenty-six mutations, every one of the behaviours the brief names. Twenty-three
went red, each in a suite that names the behaviour it lost. Three did not, and
none of the three is a behaviour defect: two are console rendering the branch
made unnecessary rather than wrong, and the third is a wire field nothing emits.
Per the house rule a sweep round ships unless it finds a behaviour defect, so
this is an APPROVE with five stale-claim findings to fold into the landing
commit — four comments and one README line that describe charges and costs the
branch removed, one of them removed one commit *after* the line was rewritten.

Baseline before mutating: every gate clean at this tip — doc-lint,
check-figures (102 files), check-paths (1206 claims), check-comments (904
files), check-knowledge, check-gates, check-duplication, check-console-sheets,
check-shell-quoting, check-boundaries, check-roster, check-source --static and
--unit (208 suites), check-console, check-conformance (10 goldens, 206 steps),
check-random (2000 runs, 80000 steps), check-postgres (75 suites),
check-queries, check-keto (4 suites), check-model (116 tests), check-model-api,
and the four shell suites the branch touched.

## Mutation → what went red

### The model (`model/domain.qnt`; the brief says `ticket.qnt`, but `ticket.qnt` holds the record and the vocabulary and takes no decisions)

| Mutation | Red |
|---|---|
| `decideEvalStageReduce`: swap the two `onFailure` arms | **check-model** (6 unit: `evalFailureDispositionTest`, `shortCircuitRoutesToReworkTest`, `reworkRestartsLowestStageTest`, `stagedShortCircuitEscalatesTest`, `programAsDataCombinatorTest`, `anyPassNotAlwaysPassTest`; 2 witness: `evaluationReworkWitness`, `evaluationEscalateWitness`; refinement hazard). check-conformance and check-random stay green — by design, see note 1 |
| `finalizerFailure` escalates instead of reworking | **check-model** (`finalizationFailureReworksTest`, `safeAbortReworkWitness`, `finalizationFailureEntersReworkTest`) |
| `decideResumeTicket` keeps the wall reason | **check-model** (`executionBlockedAndResumeClassifiedTest`, `resumeReworkRespawnsWorkTest`, `executionBlockedResumeWitness`, `evaluationResumeWitness`, `evaluationEscalateWitness`, `executionBlockedResumeRecoversTest`, **and the randomized invariant run**: "the ticket instance violated an invariant") |
| `isReadyIn` (the dispatch guard) drops `depsDoneIn` | **check-model** (`dependencyGateTest` and the randomized invariant run) |

### The deciders (`src/domain/`) — the counterpart the goldens actually replay

| Mutation | Red |
|---|---|
| `decideEvalStageReduce`: swap the two arms | **check-conformance**, **check-source --unit** (16 suites incl. `deciders`, `reworkCap`, `decisionSemantics`, `hazard`, `recovery`, `projection`, `test/ui/resumePoint`). check-random green (the walk never draws that edge as a difference) |
| `finalizerFailure` escalates | **check-conformance**, unit (`a failed finalization re-enters work, and does so every time`; `a finalizer that failed twice leaves the ticket every rework the cap allows`) |
| `decideResumeTicket` keeps the wall reason | **check-conformance**, **check-random**, unit (`every resume re-enters where its wall said it would`) |
| `isReadyIn` drops `depsDoneIn` | **check-random**, unit (`a dependency that is not Done blocks, whatever else it is doing`). check-conformance green, exactly as its own header says it will be ("NOTHING ABOUT THE ENABLEMENT PREDICATES") |

### `src/actor/decisionSemantics.ts` — all four corrections

| Mutation | Red |
|---|---|
| Drop the semantics-1 rework-wall-parked-evaluating correction | `decisionSemantics.test.ts` ×4 |
| Invert `dispositionInRecord` | `decisionSemantics.test.ts` ×6 + `wire.test.ts` (`a pre-3 reduction is read at the disposition its own record reports`) |
| `replayableDecision` always true (a removed wall replays) | `a row parked on a wall this machine no longer has cannot be replayed` |
| Correct the v2 zero-budget row back to `NoResume` (i.e. remove the standing divergence) | `a parked ticket is resumable whichever semantics walled it`, `the first semantics parks the wall at the eval resume, the second where this machine does` — the divergence the header documents is pinned as a divergence, which is the right shape |

### The rework cap

| Mutation | Red |
|---|---|
| `reworkCap.ts`: `>=` → `>` | `a cap of two reworks the first two failures and parks the third`; `a cap of one reworks once, and a cap of none parks the first failure`; `a finalizer that failed twice leaves the ticket every rework the cap allows` |
| `task.ts`: drop `if (inWorkRun) evaluationFailed = false` | `the work a passed evaluation is followed by is the finalizer's, and is uncapped` |

### The journal chain

| Mutation | Red |
|---|---|
| Verify over the re-encoded decoded row instead of `row.entry` | **check-postgres**: `a row this image would re-encode differently still verifies and replays`, plus `a stored row that is not JSON…`, `…is JSON but not an entry…`, `the legality scan names a history whose declared machine could not have decided it` |
| Drop `decisionSemanticsVersion` from the envelope digest | `digest.test.ts` — `the complete envelope digest covers cause and release configuration` |
| Lift a semantics-3 bare-int `EvalReduce` instead of refusing it | `wire.test.ts` — `a bare reduction stored at the current semantics is refused, not lifted` |

### Migration 004

| Mutation | Red |
|---|---|
| Neuter the `ticket_projection` guard arm | `a ticket parked at an account wall refuses the migration untouched` |
| Remove the `native_action` guard arm | same suite, same case |
| Remove the `journal_entry` guard arm | `a journal that names an account wall refuses the migration untouched` |
| Remove the `session_turn` guard arm | `a session turn wider than the narrowed bound refuses the migration untouched` |
| Deployment-policy rewrite emits `nTasks` before `nTickets` | `the authoring policy loses the keys the accounts configured` |
| Drop the `dispatch_candidate` column drops | eight `authoring`/`release` postgres cases go red on the NOT NULL columns — which is the GOAL's own reason the schema and the code ship in one release |
| Widen `ticket_projection_reason_is_known` back | `every narrowed reason check refuses the literals the accounts left it` |
| Widen `native_action_reason_check` back | same case |

Note: removing the first guard arm *outright* breaks the `DO $$` block's own
SQL (`AS relation` lives on it) and the gate exits 2, could-not-run. I neutered
its predicate instead, which is the honest mutation.

### Startup pin, wire, fabric

| Mutation | Red |
|---|---|
| Deployment-policy precondition compares as text, not `::jsonb` | `a policy row rendered another way is still the one this image carries` |
| `escalationReasons` regains `GasExhausted` | `the escalation reasons are the model's, less the absent one` |
| `ticketResponseSchema` regains an optional `gasLeft` | **nothing** — see Unpinned 3 |
| …and `ticketResource` actually emits it | **check-postgres**: `project reads page by ticket identity and enforce a minimum sequence`, `project reads filter before paging and expose one ticket detail` |

Fabric alignment, checked directly rather than mutated: a
`CHUG_TICKET_SERVICE_CONFIG` carrying `domain.gas` /
`domain.reworkPolicy` / `domain.finalizationPricing` is refused —
`CHUG_TICKET_SERVICE_CONFIG.domain is invalid` — and one with no `rework`
block is refused with `CHUG_TICKET_SERVICE_CONFIG.rework is invalid`. The
message names the *object*, not the offending key, because
`decodedCommandConfiguration` joins `issues[0].path` and zod's
`unrecognized_keys` issue has no leaf in its path. That is pre-existing
reporter behaviour, not this branch's, so it is a note rather than a finding —
but an operator rolling the old fabric config gets "domain is invalid" with no
hint which of the three keys. `~/claude/chuggy-fabric-wt/no-accounts`'s
`cluster/apps/chuggy-ticket-service.yaml` carries exactly the three domain keys
and `"rework": { "cyclesMax": 2 }` top-level, matching
`src/roots/ticketService.ts`.

### Console

| Mutation | Red |
|---|---|
| `escalationDetailLine`'s `ReworkBudgetExhausted` arm returns `undefined` | check-console: `the wall a reader met on ticket 21 reads as a noun and a fragment`, `the wall notice says where it is, why, and which stage failed` (+ a tsc/lint error for the now-dead helper) |
| `resumePoint.ts` returns `undefined` for the rework wall | check-console: `every wall the wire can name has a point or names none`, `the rework wall's resume re-runs the work`; **and** the repo-root oracle `test/ui/resumePoint.test.ts`: `an evaluation failure reworks or parks by the disposition it is given`, `a program of one stage parks where the machine says it parks` |
| Swap the situation column's two remaining children | **nothing** — Unpinned 1 |
| `OfferedAction` draws a cost span again | **nothing** — Unpinned 2 |
| Reorder the "On this page" anchors (control) | check-console: `every section of the main body has an anchor pointing at it` |

## Findings

All five are stale claims, none is a behaviour defect. Each names a thing this
branch removed.

1. **`ui/chuggy-ui/README.md:158`** — "The situation column holds exactly the
   wall and the actions with their costs". Commit `7429fe4f` on this same
   branch removed `cost` from `ActionEffect`, removed the prop from
   `OfferedAction` and renamed the component for that reason; no action carries
   a cost. The line was rewritten by `ba75bdab` and not revisited by the commit
   that falsified it. It is also short by one: `TicketPageDetails` still draws
   the "On this page" anchors, which `ba75bdab` dropped from the sentence.
   Say what the column holds now.

2. **`test/actor/hazard.test.ts:164`** — the test is named "the rework
   double-spend: the fan-out launches and **the charge** dies with the crash".
   The same commit rewrote every `assertStep` label inside it away from charges
   ("the fan-out the accounts never paid" → "the fan-out the journal never
   decided", "one journaled charge" → "one journaled decision") and left the
   title. What dies with the crash is the journaled decision.

3. **`test/actor/recovery.test.ts:54,55,86`** — `/** …and the dispatch charge
   survives its seam. */`, `function phaseDispatchChargeSurvives()`, and `/**
   The rework's charge survives total cursor loss… */`. The branch deleted the
   `gasLeft`/`reworkLeft` assertions that *were* the charge from both phases;
   what survives the seam now is the spawn count. The identifier is also cited
   at line 193.

4. **`test/actor/harness.ts:8-9`** — "It is fixed tiny at the smallest
   constants that exercise a rework, because the rework is the re-entry that
   **charges** — where a double-spend bites." The three lines below it are
   where the branch deleted `reworkPolicy`/`gas`/`finalizationPricing` from
   `refinementInstance`. `model/refinement.qnt:209` states the surviving reason
   correctly ("it is the re-entry that launches work again") and is what this
   should say.

5. **`model/refinement.qnt:611`** — "An orphaned bookkeeping effect
   (OpenHumanTask, …) is the same shape with **nothing priced riding it**".
   The branch rewrote the two lines immediately above ("the theorems price" →
   "the theorems count", "the paid spawns" → "the spawns") and stopped one
   sentence short. Nothing is priced, so the sentence no longer distinguishes a
   bookkeeping orphan from a spawn orphan; the distinction that remains is that
   no work rides it.

### On the C-report's judgment calls

Nine of the ten are right, and the tenth is the same defect as finding 1's
sibling. C neutralised "Budgets"/"Rework" in `panel.test.tsx` and
`inputs.test.tsx` on the stated ground that "a reader could otherwise mistake
the fixture for a still-live feature", and on the same page decided to leave
`ui/chuggy-ui/test/offeredAction.test.tsx:110-119,156-160` drawing
`action="Add rework"`, `effect="Adds one rework cycle"` and
`refusedBecause="Not available in this release"`. Those three strings are not
generic placeholder text: they are verbatim the copy of the rework top-up
button that this branch deleted, `"Not available in this release"` being the
deleted `reworkTopUpRefusal` constant itself. The reasoning that moved
`panel.test.tsx` applies here with more force, not less. (The C-report also
describes the file under its old name, `test/actionWithCost.test.tsx`, and
describes the cost strings as still legitimate — both true when it was written
and overtaken by `7429fe4f`.)

Everything else C reported checks out against the tree: `resumePoint.ts`'s
unconditional `ResumeReworking`, the deleted Budgets panel and accounts module,
the `WorkAndFinalizer` rename, keeping `fromStage`/`ofStages`, and deleting
rather than weakening the two `test/ui/resumePoint.test.ts` cases whose premise
(a per-ticket authored budget) no longer exists. The deletions are not a
coverage loss: the rewritten evaluation-wall case drives both dispositions
explicitly and goes red under both console mutations above.

## Unpinned (not wrong — nothing here is a defect)

1. **The situation column's order.** Swapping `SituationNotice` and
   `{props.actions}` in `ui/chuggy-ui/app/browser/ticket/TicketSituation.tsx:99-105`
   passes check-console. The Budgets panel's removal left two children and
   nothing asserts which comes first. The anchor list's order *is* pinned
   (control mutation above), so this is an asymmetry rather than a rule. Worth
   one assertion if the column's reading order is meant to be a claim; worth
   nothing if it is not.

2. **`OfferedAction` drawing a price again.** Re-adding a `<span
   className="act-cost">` to `ActionLines` passes check-console and
   check-console-sheets. `offeredAction.test.tsx` asserts the effect text is
   present; no case asserts that nothing else is. A product with no prices has
   no test that says so.

3. **An optional pricing field re-declared on the ticket view.** Adding
   `gasLeft: countSchema.optional()` to `ticketResponseSchema` passes every
   gate — check-source --unit, check-console, the contract suites,
   `document.test.ts` (whose golden covers request schemas only, as its own
   header says). Emitting it from `ticketResource` *is* caught immediately, and
   `test/contract/responses.test.ts:175` pins the emitted key set exactly. So
   the wire's *shape* is pinned and its *schema's permissiveness* is not. Given
   `escalationReasons` is pinned by roster (mutation above), this is a small
   gap and arguably the right place to stop.

4. **The goldens are not checked against the model that emitted them.** A model
   mutation is caught only by check-model; check-conformance replays the
   committed corpus against the TypeScript deciders and cannot see that the
   corpus is now the output of a machine the model no longer describes. This is
   check-conformance's stated design ("IT NEVER REGENERATES, AND NOT AS A
   PROMISE") and `test/golden/coverage.test.ts` does read the declared label
   roster out of the model, so a model that *gains* a label is caught. A model
   that changes what an existing label does is not. Not this branch's to fix —
   recorded because a sweep that did not say it would be overstating its
   coverage.

5. **A removed-wall row on the hot replay path.** `replayableDecision` guards
   `storedJournalLegalOn`, not `storedReplayCore`/`projectWriterLoad`, so a row
   labelled `ticket-escalated gas_exhausted` reaching a load would be
   re-derived rather than refused. It cannot reach one: migration 004's guard
   refuses the installation, the narrowed `reason` CHECKs and
   `decision_event_is_valid` refuse a new one, and an `ExecutionBlocked` row
   carrying a removed reason fails to decode at all. The header in
   `decisionSemantics.ts` says exactly where the refusal lives, so the code and
   its account agree. Recorded, not flagged.

## Notes

- **Attribution.** `eb7f1fdb`, `6fcb53cf` and — the brief does not mention it —
  `cf708286` (the schema commit merged in from `schema/no-accounts`) carry
  `Co-Authored-By: Claude Opus 5 (1M context)`; every other authored commit on
  the branch carries `Claude Fable 5.1`. Noted, not a finding.
- **Model mutations and the fast gates.** Reported per-mutation above because
  the brief asks, but the answer is structural and worth stating once: no model
  mutation can redden check-conformance, check-random or the goldens, because
  those three read `src/` and a committed corpus. The model's own suites are
  the whole of the model's evidence, and they are thorough — the weakest model
  mutation I tried (the dispatch guard) still took out a named unit test *and*
  the randomized invariant run.
- **Practices invoked.** None. This round is a sweep against running code, not
  a design review; every judgment here is either a mutation's verdict or a
  comment read against the code beside it, and I had no call to cite a general
  standard. `.chug/tasks/review-change.md` and `GOAL.md` were read first, as
  the brief directs.
- **What I chose not to flag.** `model/domain.qnt:44,55` and
  `model/ticket.qnt:16,99` say "budget" of below-cycle retry budgets, a
  standing non-goal unrelated to the accounts. `model/mc/*.qnt` say "budget" of
  the sampler's. `src/contract/http.ts:148` and
  `test/interpreter/finalizerRun.test.ts:983` say it of page and pass budgets.
  `src/actor/decisionSemantics.ts:28-29`'s "there being no budget left to
  consult" and "a row parked with no rework budget" are correct: they describe
  what the *older* machine did, which is that module's whole subject. The
  `noDoubleSpentBudget` → `noDoubleSpentWork` rename is consistent across
  `src/actor/obligations.ts`, `model/refinement.qnt` and
  `model/tests/chuggy_refinement_test.qnt`.
- **A shape I read and am content with.** `evaluationFailureReworksStarted`
  counts a maximal Work run only when the evaluation run before it resolved
  something `Failed`, so a resumed rework-wall ticket re-parks on its very next
  evaluation failure. That is the old machine's behaviour exactly — the rework
  wall's resume never refilled — and it is what the GOAL's "resume stays
  `ResumeReworking`, which re-enters Working as a rework with no refill"
  describes. `test/interpreter/reworkCap.test.ts` drives it. Deliberate, and
  the header says so.
