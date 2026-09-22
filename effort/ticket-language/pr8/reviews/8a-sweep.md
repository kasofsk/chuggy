# Mutation sweep — PR 8a "The released ticket", whole branch

Reviewed at `a7923309` in a detached worktree, scope `git diff aaaff1ec..a7923309`.
Fresh session; I authored none of it. Each mutation was applied alone, proved to
have changed its file, run against the narrowest gate or suite that owns it, and
reverted; the worktree was byte-clean when removed.

## APPROVE

**91 mutations** over the model, the package copies, the domain, the actor, the
interpreter, the adapters, 013, the contract, the goldens and the draws. **58
went red. 33 survived; none is a behaviour defect** — ten are equivalent, inert
or structurally non-informative (an invariant conjunct deleted can never redden;
a draw narrowed can never redden; four are the verbatim package copy, which its
own suites at 76c95a9 prove and chuggy's do not), and twenty-three are proof
gaps gathered into six findings a cheap case each closes. 1–4 are the ones I
would land.

Baseline at the tip, all clean: `check-model` 123 tests, `check-source` 6
stages, the unit suites, `check-conformance` 12 goldens / 259 steps,
`check-random` 2000 samples, `check-model-api`, `check-postgres` 77 suites,
`check-queries`, `migration.test.ts` 108 standalone, five doc gates. `diff` of
both package copies against 76c95a9 is **empty**, which is what
`model/AGENTS.md` now claims. Nothing under `.chug/`, `images/`, `deploy/` or
in `~/claude/chuggy-fabric` names `deps`, `prog` or a per-request requirement
materialization; the worker manifest's `{repository, ref, commit, base}` is the
key array the door reads.

## The table — red

| # | mutation | went red in |
|---|---|---|
| M1, M2, M3, M6, M7, M15 | the work-pass arm keeps `jb.source`; the instance begun at the cycle; `reportMatchesTask` compares identities only; `producedResultRef` = the cycle; the dispatch spawns without its source; the completion pins the task ref as the artifact | `check-model` ×1 each |
| M22, M8b | `planValid` dropped from `releasedTicketValid`; `releasedTicketOf` mints `id: j + 1` | `check-model` |
| T1, T2, T12, T15, T18, T20, T23 | the pass arm keeps `ticket.source`; the instance begun at `workCyclesStarted`; the band dropped; `acceptedSourceRef` from the content ref; the work obligation owed with none outstanding; the work identity keyed by the content ref; the work `contextRef` from the definition id | `deciders`, `ticket`, `invariants`, `enablement` |
| T6, T11, T16, T17 | `content > 0` dropped from the TS release rule; `sourcePinned` weakened; `ticketEqualsDefinition` blind to `content` / to `finalizationConfiguration` | `config`, `invariants`, `equality` |
| T8, T9 | **round 1's two fixes**: `stageDefinitionEquals` drops `taskDefinitionEquals`; `instanceEquals` drops `acceptedSourceRef` | `evaluation`, `recovery` |
| T14 | the evaluator obligation's `contextRef` from the cycle | `evaluation` |
| I6, I7 | every ticket handed the reserved source; the source ref folded from the repository, not the commit | `executionSourceObservation` |
| I8, I9, I13 | `ticket_source` not written at the decision; the definition row not written at the release; the spawn's source dropped when evidence is present | `check-postgres` |
| I14, I15 | `asOperationDecisionEvent` admits a client `Dispatch`; a rework spawns at the cycle count, not the ticket's source | `ticketCommand`, `dispatchWriter` |
| D1–D23 | **all 23**, each on the row that owns it: the evaluator `contextRef` from the cycle / from another ticket's cycle / from a failed result; **D13, round 1's fix** — the stage conjunct dropped from the definition lookup — and D14, the evaluator conjunct; `WorkResultUnrecorded` and `SourceUnrecorded` deleted; the `ticket_source` insert deleted; `journal_entry_release_ticket` at the old key; the `command_integer`/reference/`deps`-`prog` predicates; the `Dispatch` completion guard; the positional stage CHECK; three CHECKs and the scheduler GRANT; the 008 wipe guard; `deploy/rig/wipe-tickets.sql` missing `ticket_source`; the work `contextRef` from the ticket | `migration.test.ts`, `check-postgres` |
| G1, G3, G4, G5, G6 | the manifest's step count; the draw without its source; the ITF evaluator task; the ITF `acceptedSourceRef`; the fixture's evaluator `contextRef` | `check-conformance`, `check-random`, unit |
| C4 | `digestFold` without its `+ 1` | `resultManifest` |

Gate note: I6, I7, I14 and I15 are red in the **unit** suites and green under
`check-postgres` — four interpreter files 8a touches are owned by
`test/interpreter/`. A sweep reaching only for `check-postgres` would have
called them survivors.

## Findings — all proof gaps, each closed by a case
1. **The release-refusal rule is proved by one case.** `releasedTicketValid`
   (`model/domain.qnt:247-261`) has nine conjuncts, and of the two events
   `journalRefusesInvalidReleasePayloadTest`
   (`model/tests/chuggy_refinement_test.qnt:136-143`) refuses, only `planValid`
   reddens on deletion (M22). The other eight — content ref, work
   configuration, finalization ref, id, dependency positivity, stage bound,
   positional stage key, evaluator-key bound — delete green (M4, M5, M16–M21):
   `releasedTicketOf` mints every ref from `releaseRef` and every plan is drawn
   from `validPlans`, so nothing ever offers one outside the rule. The TS twin
   is the mirror image — `planValid` deletes green there (T7), the content ref
   reddens (T6). One hand-built `CreateTicket` per conjunct family beside
   `badDeps`/`badPlan`, plus a `planValid` case in `test/domain/config.test.ts`.
   `id > 0` and `dependencies.forall(> 0)` look **dominated** by the seam and
   the dependability guard, so a case may not exist for them — itself the answer
   to whether those two earn their place.
2. **Nothing in TypeScript ever offers a report whose obligation is wrong.**
   `obligationCurrent` (`src/domain/ticket.ts:289-299`) cuts back to its
   identity half (T3), and `taskObligationEquals` (`src/domain/task.ts:251-259`)
   loses its definition half (T4) or its `contextRef` half (T5) — and the
   evaluation side's call of it (`src/domain/evaluation.ts:273`, T13) — with
   every unit suite green. `test/domain/task.test.ts:327-338` varies only the
   task **identity**. The model has exactly the missing case:
   `reportAdmissibilityRequiredTest`'s fourth row, a report at `contextRef + 1`
   (`chuggy_refinement_test.qnt:121-131`), and M3 reddens. The PR's headline
   decision, held on one side only. One assertion closes it.
3. **A dispatch naming a source nobody observed is refused nowhere a case can
   see.** `dispatchSources.contains(a.source)` (`model/refinement.qnt:340`, M14)
   and `event.value.source > 0` (`src/actor/decisionEvent.ts:190`, T19) both
   delete green. The writer mints the event from its own observation, so this is
   the guard's proof and not its behaviour — but that guard is what stands
   between a client `Dispatch` and an unobserved source, and its sibling
   (`asOperationDecisionEvent`, I14) *is* pinned. One refused `Dispatch` a side.
4. **The stored definition's per-stage material has no case.**
   `test/postgres/ticketDefinition.test.ts` holds two tests over a one-stage
   fixture and asserts the task **keys**, the workload and the execution
   requirement — never the `inputs` block, never a second stage. So the stage
   index can be taken one past (`ticketDefinition.ts:126`, I1), every stage
   given the **work** definition (I2), each evaluator of a stage a **different**
   one (I3), the inputs block folded from the work material (I4), and the
   scheduler can ask the row for `Work` whatever the execution is
   (`scheduler.ts:397`, I5) — all five green: round 1's door finding one layer
   up, same fixture, same blindness. A two-stage fixture asserting each task's
   `inputs` digest and its own stage's material closes four; the fifth wants one
   evaluation execution read back.
5. **The two new refusal evidences are never distinguished.**
   `schedulerRefusalEvidence` (`schedulerCompletion.ts:409`) answers
   `RefusedBinding` for every result under both gates (I10), although the door's
   refusals themselves are pinned (D3, D4). One case per evidence.
6. **The two codecs 8a added validate nothing a case exercises.**
   `authoringSchema.safeParse` (`authoring.ts:244`, C1) and
   `dispatchProgramSchema.parse` (`dispatchView.ts:95`, C3) each survive
   replacement by a raw cast under both gates. Both read chuggy's own stored
   text, so this is defence in depth: one malformed-input case each, or accept
   it knowingly.

Not findings, recorded so the next sweep does not re-run them: `M8`/`T10` delete
a conjunct from an **invariant**, which cannot redden; `I11` reorders the
observation behind an enablement test every dispatchable ticket passes; `G2`
narrows a draw; `C2` changes `unsourcedTicketReference`'s value, near-unreachable
for the reason round 1 gave; `M9`/`M10` substitute a value uniformly on both
sides of every comparison the model makes of it, and its twin is pinned at T23,
T14, D1 and D23; `M11`–`M13` are the package copy.

## Docs

- Both package copies are byte-identical to 76c95a9 and `model/AGENTS.md` names
  no divergence, which is now true; `taskOwner` is correctly gone, it has no
  caller. Nit: the evaluation bullet does not say that `domain.qnt` now calls
  `planValid` and `evaluatorKeys` **from that copy** (`domain.qnt:252,259`),
  where the task-contract bullet does name its callers.
- **`src/adapters/postgres/schema/README.md:174`** says of `ticket_definition`
  "the boundary owner reads it", but `013` also grants it SELECT to the
  scheduler role (`013-released-ticket.ts:250`) and `schedulerCreateExecutions`
  needs that grant — D12 reddens on its deletion. The `ticket_source` paragraph
  three lines down names all three readers. One clause.
- Nit: two comment lines added here run well past the wrap the rest of the file
  keeps (`model/domain.qnt:1054`, and the `stageChoices` comment near :115).
