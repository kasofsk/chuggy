# Mutation sweep — PR 2 (the three deletions), whole branch

Reviewed at `dd7e1423` in `~/claude/chuggy-wt/three-deletions-sweep`, detached,
scope `git diff 617675bb...dd7e1423`. Fresh session, authored none of it. Every
mutation below was applied one at a time and reverted with `git checkout -- .`;
the tree is clean and nothing was committed.

## APPROVE

Forty mutations, covering every behaviour the brief names. Thirty-six went red,
each in a suite that names the behaviour it lost. Four did not, and none of the
four is a behaviour defect: two are console rendering nobody asserts, one is a
redundant half of a two-condition SQL guard whose property a suite does pin, and
one is a wire default pinned by an equality assertion rather than by a
behavioural case. Per the house rule a sweep round ships unless it finds a
behaviour defect, so this is an APPROVE with no findings. C's seven judgment
calls all check out, and the one call that was later reversed (the phase gate in
`SituationNotice`) was reversed correctly.

Baseline before mutating, every gate clean at this tip: doc-lint (21 files),
check-figures (102 files), check-paths (1205 claims, 1156 files), check-comments
(906 files), check-knowledge, check-gates (23 gates), check-duplication (1035
files), check-console-sheets (30 sheets), check-shell-quoting, check-roster (8
practices), check-boundaries (1054 modules), check-source --static (5 stages)
and --unit, check-console (118 files, 1282 tests), check-conformance (9 goldens,
180 steps), check-random (2000 runs, 80000 steps), check-queries, check-model
(111 tests), check-model-api, check-postgres `migration.test.ts` (48 cases), and
`check-model.test.sh` (16 cases — the red C reported is fixed by `3c056c62`).

## Mutation → what went red

### `model/` — check-model is the whole of the model's evidence

| Mutation | Red |
|---|---|
| `decideRevoke` parks each Pending dependent again (transitions, `OpenHumanTask`, phase Escalated) | **check-model**: `revokeTransitionsOnlyItsOwnTicketTest`, `strandedDependentWaitsForItsAuthorTest`, **and** the randomized invariant run ("the ticket instance violated an invariant") |
| the passing final stage takes `completeTicket` instead of `move(… Finalizing, "eval-passed", ["RunFinalizer"])` | **check-model**: 6 unit (`happyPathRecordsTest`, `effectExclusivityHappyPathTest`, `finalizationSuccessTest`, `finalizerProtocolDirectCommitTest`, `stagedProgramPassesTest`, `revokedNeverCompletesTest`), 3 witness (`stagedProgramWitness`, `finalizationSuccessWitness`, `safeAbortReworkWitness`), 2 refinement (`finalizationCompletionCrashRecoveryTest`, `finalizationFailureEntersReworkTest`) |
| `combine` as any-pass (`ticket.qnt`: `forall` → `exists`) | **check-model**: `stageVerdictIsUnanimousTest`, `evalFailureDispositionTest` |

Under each of those three, **check-conformance stayed green** (9 goldens, 180
steps) and `test/golden/coverage.test.ts` stayed green; verified directly for
two of the three rather than assumed. That is the corpus's design — it replays
against `src/`, not against the model that emitted it — and it is why a model
mutation is reported against check-model alone.

### `src/domain/` — the counterpart the goldens replay

| Mutation | Red |
|---|---|
| `decideRevoke` parks each Pending dependent again | **check-source --unit** ×4 (`a revoke deep in a chain transitions its own ticket and nobody else`, `a revoke of the ticket in the middle leaves the one behind it waiting`, `a revoke leaves its dependents where they were, and depsAcyclic is what refuses a cycle`, `each otherwise-undriven arm journals legally and decides what the domain decides`) **and check-random**. check-conformance green — no golden revokes a ticket that has a Pending dependent |
| the passing final stage completes outright | **check-conformance**, **unit** ×5 (`a stage passes only when every task in it did, so one failure sinks it`, `a decision leaving finalization withdraws the approval it left unanswered`, `crash, recover, continue: the disciplined machine at every observable seam`, `the duplicate dispatch and the duplicate completion, one effect-first crash each`, `each otherwise-undriven arm journals legally…`) |
| `combine` as any-pass (`program.ts`: `every` → `some`) | **unit** ×2 (`a stage passes only when every task in it did, so one failure sinks it`, `a stage passes only when every task in it passed`). conformance and check-random green |
| `revocableIn` refuses Pending | **unit** ×4 (`the absorbing terminals and the point of no return are the unrevocable phases`, `the console's revocable phases are the model's, phase by phase`, `what the console offers is what the two predicates enable`, `each otherwise-undriven arm journals legally…`) **and check-random** |

### `src/actor/decisionSemantics.ts` — semantics 4

| Mutation | Red |
|---|---|
| drop `completedWithoutFinalizing` from `replayableDecision` | `a row that completed a ticket without running a finalizer cannot be replayed` |
| drop `revokedMoreThanItsOwnTicket` from `replayableDecision` | `a revoke that transitioned more than its own ticket cannot be replayed` |
| make the ≤3 dropped-key acceptance strict (`stageSchemaWire` and the `ReleaseTicket` value to `strictObject`) | the whole of `test/actor/decisionSemantics.test.ts` fails to load — `journalAtSemanticsOne.json row 0 is unreadable: Unrecognized key: "combinator"` / `Unrecognized keys: … "finalizer"` — plus `a writer rebuilds a history from the machine that decided it, not from its own` |

### The finalizer

| Mutation | Red |
|---|---|
| `finalizationNext`'s `None` arm concludes `FinalizationFailed` | **unit** ×2 (`a brief that lands nothing succeeds before anything is prepared`, `a pass over a ticket that lands nothing concludes it and asks no remote`) |
| `finalizerGather`'s `None` early return removed, so a landless ticket goes through the binding | **unit**: `a pass over a ticket that lands nothing concludes it and asks no remote` |
| `briefFinalizationDefault` → `{ mode: "None" }` | unit green; **check-postgres**: `the draft door falls back to the landing this tree defaults to` |
| `create_draft`'s `coalesce(mode, repository's landing, 'Push')` → `coalesce(mode, 'None')` | **check-postgres**: 10 authoring cases incl. `a brief naming a landing keeps it over the one its repository is bound under`, `a brief naming no repository lands where the work happened`, `a repository landing by proposal refuses a brief naming no branch` |

### The ticket read (`nativeReads.ts`, all three query sites)

| Mutation | Red |
|---|---|
| drop `t.phase='Pending' AND` | **check-postgres** ×2: `only a Pending ticket names the dependencies of its own that are revoked`, `revoked dependencies are ascending in the detail read and in both pages` |
| `ORDER BY d.ticket` → `ORDER BY d.ticket DESC` | same two |
| `d.phase='Revoked'` → `d.phase IN ('Revoked','Done')` | same two |

### Stored operation decode

| Mutation | Red |
|---|---|
| `DependencyRevoked` back in `reasonSchemaWire` | **check-postgres**: `an operation carrying a wall this machine lost is refused by name` |

### Migration 005 (all **check-postgres**, `migration.test.ts`)

| Mutation | Red |
|---|---|
| guard arm `ticket_projection` neutered | `a row the three deletions leave unreplayable refuses the migration untouched` |
| guard arm `native_action` (Open) neutered | same |
| guard arm `session_turn` neutered | `a session turn wider than threedeletions's bound refuses the migration untouched` |
| guard sub-arm: journal `finalizer = 'NoFinalizer'` | `a row the three deletions leave unreplayable…` |
| guard sub-arm: journal `prog @> '[{"combinator":"AnyPass"}]'` | same |
| guard sub-arm: journal `reason = 'DependencyRevoked'` | same |
| guard sub-arm: journal revoke record with more than one transition | same |
| `native_action_reason_check`'s settled arm widened to Open | `the narrowed reason checks refuse a live row at the parked reason` |
| the `dispatch_candidate.program` rewrite skipped | `a stored dispatch program is rewritten as the encoder without the combinator writes it` |
| the NULL → `'None'` `draft_brief` rewrite skipped | `a brief that recorded no landing is migrated to the one that lands nothing` |
| `project_repository_landing_mode_is_known` left without `'None'` | `both landing rosters take the mode that lands nothing and no other new one` |
| the `session_turn` bound re-render skipped | `the installed session constraints match the runtime` |
| the `selector_runtime_settings` re-seed skipped | `fresh selector settings carry current controls and only their initial history` |
| `decision_event_is_valid` admits `NoFinalizer` | `the boundary admits the surviving spellings and the absent keys, and refuses the deleted ones` |

Note on the guard: neutering a predicate rather than deleting an arm is the
honest mutation here for the same reason 004's sweep found — the first arm
carries `AS relation` and deleting it outright breaks the `DO $$` block's own
SQL, which is a could-not-run rather than a red.

### The contract

| Mutation | Red |
|---|---|
| `programStageSchema` takes an optional `combinator` | **unit**: `the contract document renders the committed golden`, `a hand-assembled read drops an unknown field at every depth` |
| `finalizer` back on `ticketResponseSchema` | **unit**: `a ticket read emits exactly the keys the contract names` |
| `DependencyRevoked` back in `escalationReasons` | **unit**: `the escalation reasons are the model's, less the absent one` |
| `briefFinalizationProposes("None")` true | unit green, check-postgres green; **check-console**: `a form landing on None sends its mode and no target`, `changing the landing to None releases a ticket the target box would have refused` — see Unpinned 4 |

### The console

| Mutation | Red |
|---|---|
| `revokedDependencyLine`'s noun always singular | **check-console**: `a Pending ticket blocked by more than one names them, plural and ascending` |
| the landing picker filters `None` out of `landingOptions` | **check-console**: `a form landing on None still asks for a landing, and asks for no target`, `changing the landing to None releases a ticket the target box would have refused` |
| `creationStageLabel` draws `"N × UnanimousPass"` again | **nothing** — Unpinned 1 |
| a `Finalizer` panel back on the Repository page | **nothing** — Unpinned 2 |

### Fabric alignment (read, not mutated)

`.chug/configurations/basic-coding.json` and `chuggy-development.json` name no
`finalizer` and no `combinator`; neither does anything under `cluster/` on
`~/claude/chuggy-fabric-wt/no-accounts`, the branch released against
`617675bb`, whose `CHUG_TICKET_SERVICE_CONFIG.domain` is `nTickets`/`nTasks`/
`maxStages` with `rework` beside it. So PR 2 needs no fabric change. (The
default-branch checkout of `chuggy-fabric` still carries PR 1's removed
`gas`/`reworkPolicy`/`finalizationPricing` keys; that is PR 1's rollout, not
this branch's.)

## The docs, once

`check-figures` 0 findings across 102 files, `check-paths` 0 findings across
1205 claims, `check-comments` 0 findings across 906 files, `doc-lint` 0/0 across
21 files. Line-joined greps over the whole tree, `ui/` and `.chug/` included,
for the names this branch deletes — `Finalizer`, `NoFinalizer`,
`FinalizerChoice`, `finalizerChoices`, `finalizerLabel`, `finalizerWellFormed`,
`noFinalizationWithoutAKind`, `wrapup_none`, `nofinalizer-completion`,
`DependencyRevoked`, `dependency_revoked`, `modeledResumeExists`,
`revokeDoomed`, `cascadeSafety`, `noStructuralDeadlock`, `canFinishSet`,
`Combinator`, `EvaluationCombinator`, `evaluationCombinators`, `AnyPass`,
`combinator`, `checkedDraftLanding`, `repositoryReadyConfiguration` — and the
prose forms `cascade`, `doomed`, `deadlock`, `no finalizer`. Every survivor is
legitimate: the 004 and baseline migration bodies and `migration.test.ts`
fixtures, which are history; `decisionSemantics.ts`'s and `005`'s headers, which
name the legacy spellings because admitting them is their subject;
`readiness.test.ts:241`, which names the removed wall as the thing it refuses;
`domain.qnt:36,618` and the scheduler's "cascade"/"deadlock", which are other
words entirely. No comment in the branch describes something it removed, and
none states a quantity.

Comments read against the code beside them, one by one: `deciders.ts`'s new
`decideRevoke` header, `derived.ts`'s header (the `revokeDoomed` paragraph is
gone with the function), `enablement.ts`'s `retryableIn` and `dependableIn`,
`program.ts`, `ticket.qnt`'s `Stage`/`Resume`/`Reason`/`hasOpenHumanTask`/
`taskPassed`/`combine`, `invariants.ts`'s `deskConsistent`, `rosters.ts`'s
`resumePoints` and `briefFinalizationModes`, `ticketBrief.ts`'s landing
paragraph and `briefFinalizationTarget`, `postgres/ticketBrief.ts`'s two
rewritten headers, `finalizer.ts`'s two new paragraphs and `FinalizationOffer`,
`finalizerRun.ts`'s new paragraph, `ticketCommand.ts`'s `FinalizationSubmission`,
`decisionSemantics.ts`'s whole header, `005`'s whole header,
`ui/core/resumePoint.ts`, `ui/core/ticketCreation.ts`'s two rewritten headers,
`ui/core/ticketLedger.ts`, `ui/README.md`, `schema/README.md`,
`test/rig/README.md` and `test/rig/stranding.spec.ts`. All accurate.

`ui/chuggy-ui/README.md:156-161` is worth one line: PR 1's sweep found this
sentence stale ("the wall and the actions with their costs") and this branch
rewrote it to "the notice — a phase, a wall or a blocked dependency — the
actions and a list of anchors", which matches `SituationNotice`'s three arms
exactly. The "list of anchors" clause is pre-existing rather than this branch's,
and `TicketPageDetails` draws those anchors in the shell's details pane rather
than in the `<aside>`; that is a sentence PR 1's landing wrote and not a claim
this change makes, so it is a note rather than a finding.

House rule 15 is honoured where it bites: `check-model.sh` dropped two witness
runs, and `check-model.test.sh`'s fixture figure moved 15 → 13 in the same
commit (`3c056c62`), which is the red C reported as pre-existing and out of
scope. The suite passes, 16 cases.

## On the C-report's judgment calls

All seven are right.

1. **Deleting the Repository "Finalizer" panel** rather than reworking it.
   `RepositoryLandingSection` is still rendered at `RepositoryPage.tsx:111` and
   draws the same choice from `repositories[].landing.mode`; keeping both would
   have been a duplicate.
2. **`repositoryReadyConfiguration` deleted.** Its only caller was the panel;
   `latestReadyConfiguration`, which it wrapped, is still used by
   `ticketCreationRun.ts:112` and still has its own test.
3. **`revokedDependencyLine` phrasing.** Matches
   `test/rig/stranding.spec.ts`'s `/blocked by revoked dependenc/iu`, and both
   the singular and the plural are pinned (mutation above).
4. **`LandingWithTarget` narrowing.** `briefLandingLine` guards `None` before
   either narrowed function is called, and both switches stay exhaustive.
5. **`creationFaultSentence("landing")` reworded.** The field is still
   reachable: `creationFieldOf` maps any `["brief","finalization"]` issue whose
   third segment is not `target` to `"landing"`, and the discriminated union
   still produces one for an unknown mode or for a `None` carrying a target. The
   new sentence describes that refusal; the old one described the deleted
   `draftLandingIsAuthored` refine.
6. **No project-table badge.** In scope as written; the rig drill asserts the
   stranded ticket keeps its ordinary up-next row instead.
7. **Comment fixes beyond the brief.** Both rewritten comments match the code.

The one thing C reported that the tree no longer does is the phase gate in
`SituationNotice` — `dd7e1423` removed it, with the why in its own commit
message ("the read lists revoked dependencies for a Pending ticket alone"). That
reversal is right: the predicate lives in all three query sites and mutating it
out goes red, so the console would have been re-deciding something the adapter
already decides. The `ticketSituation.test.tsx` case C added for the gate went
with it, and the three that remain cover singular, plural and empty.

## Unpinned (not wrong — nothing here is a defect)

1. **`creationStageLabel` drawing a combinator again.** Returning
   `` `${creationFanoutLabel(stage.fanout)} × UnanimousPass` `` from
   `ui/chuggy-ui/app/core/ticketCreation.ts:539` passes check-console and
   check-console-sheets. The label is drawn in the program stage chooser
   (`TicketCreationAdvanced.tsx:120,127`) and no case asserts its text. Worth one
   assertion if the stage's reading is meant to be a claim; worth nothing if it
   is not.
2. **A `Finalizer` panel back on the Repository page.** Adding a
   `<Panel variant="section" title="Finalizer">` with constant copy to
   `RepositoryPage.tsx` passes check-console: `repositoryPage.test.tsx` deleted
   the panel's case rather than asserting the section is gone. The removal is
   nevertheless pinned by the *type* — `defaults.finalizer` and
   `choices.finalizers` left `draftInitializationResponseSchema`, so a genuine
   re-add fails tsc — which is the stronger guard, and the mutation only passes
   because it draws a constant.
3. **Either half of `submit_finalization_result`'s landing pairing, alone.**
   Dropping `AND bound.landing IS NOT DISTINCT FROM 'None'` from the
   `bound.attempt IS NULL` guard passes, and dropping it from the
   `FinalizationSucceeded`-with-no-attempt arm passes. Dropping *both* is caught
   —`test/postgres/finalizerBoundary.test.ts:148` `a request whose brief lands
   nothing concludes on no attempt at all` asserts a `BindingMismatch` for a
   brief that lands somewhere. So the property is pinned and the two conditions
   overlap; this is redundancy, not a gap, and recording it is what stops a
   later reader reading either green as coverage.
4. **`briefFinalizationProposes("None")` is decided by the console, not by
   `src/`.** Making it true passes check-source --unit and check-postgres and is
   caught only by check-console. The consequence inside `src/` is
   `briefLandingIsWhole` (`src/contract/brief.ts:175`) refusing a `None` brief
   that names no branch, and no contract case drives that shape. Small, and the
   console does catch it.
5. **The wire does not couple `revokedDependencies` to the phase.**
   `ticketResponseSchema.revokedDependencies` is a plain page, so the "empty for
   every ticket but a Pending one" rule lives entirely in the three SQL sites and
   in `nativeReads.test.ts`. That is where `dd7e1423` deliberately put it, and
   the predicate goes red when mutated out; recorded because a second producer of
   a `TicketResource` would inherit the obligation silently.
6. **A transitive edge behind a Revoked ticket is still authorable.**
   `dependableIn` now refuses only a Revoked ticket, so an author may depend on a
   Pending ticket that is itself stranded behind one. `noStructuralDeadlock` is
   what used to forbid holding such a ticket un-parked and it left with the
   cascade, by decision. The model's own header states the surviving rule
   ("refusing it at authoring time is what keeps an author from writing that
   ticket"), which is about the direct edge. Deliberate; recorded.

## Notes

- **Attribution.** `f78a96de` and `e6912751` (S, the schema half) carry
  `Co-Authored-By: Claude Opus 5 (1M context)`; every other authored commit on
  the branch carries `Claude Fable 5.1`. As the brief says: noted, not a finding.
- **A landing that lands nothing takes no approval.** `finalizationNext`'s
  `None` arm returns before `attempt.approvalRequired` is ever read, because the
  approval is a property of a prepared attempt and a landless finalization
  prepares none. The header states this ("A LANDING THAT LANDS NOTHING CONCLUDES
  BEFORE THE BINDING IS CONSULTED") and it follows from the GOAL's "reports
  `FinalizationSucceeded` at once". Read and content with it; flagged here only
  because a project that requires approval gets none for such a ticket, and that
  is worth being a decision rather than a discovery.
- **A nit I chose not to flag.** `RepositoryDeclared` in
  `ui/chuggy-ui/app/browser/repositories/RepositoryPage.tsx:55-72` now wraps a
  single `<Panel>` in a `<>…</>` left over from the deleted sibling. Harmless.
- **What I read and did not mutate.** `model/refinement.qnt`'s `DecisionEvent`
  and `execDecisionEvent` (the refinement suite is what proves they cannot
  drift), `src/domain/config.ts`, `src/domain/invariants.ts`'s bundle order,
  `src/adapters/postgres/readiness.ts`'s `finalizationEvidenceOf` (the new
  `attempted` throw is the optional `attempt` arriving), `src/interpreter/
  wire.ts`'s `checkedFinalizationSubmission`, and `test/rig/stranding.spec.ts`,
  whose "up next" and inbox-badge claims are rig-only and not decidable here.
- **Practices invoked.** None. This round is a sweep against running code; every
  judgment here is a mutation's verdict or a comment read against the code beside
  it. `.chug/tasks/review-change.md`, PR 2's `GOAL.md` and PR 1's `sweep.md` were
  read first, as the brief directs.
