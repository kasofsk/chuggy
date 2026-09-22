# PR 8a — review round 1, machine half (tip 378eb585)

**CHANGES.** Two findings, both in the transcribed equalities; everything else the brief
asked for holds, and the model half is clean.

## Findings

### 1. `src/actor/equality.ts:95,123-128` + `src/domain/evaluation.ts:498-509` — the ticket comparison cannot see an evaluator's definition

`ticketEqualsDefinition` delegates the plan to `ticketEqualsStage` → `stageDefinitionEquals`,
which reads `entry.key` and not `entry.task`. Two `ReleasedTicket`s differing only in an
evaluator's `TaskDefinition` compare **equal** — run at the tip:

    releasedTicketOf(1, ∅, defaultPlan) vs the same with every evaluator's task
    replaced by the ticket's workConfiguration  ->  ticketEquals === true

The model's `==` says false, so `ticketEquals` is now strictly weaker than the `==` it is
written to stand in for (this file's own header: "the replay checker and the recovery
obligation ask the same question"). The failure the header names is the one this opens:
`recoveryComplete` (`src/actor/obligations.ts:48`) green on a graph the journal rebuilt with
different evaluator definitions. `src/domain/invariants.ts:134` inherits it through
`stagesEqual`: `evaluationsWellFormed`, whose stated job is "so no plan can drift from the
authored data", is blind to exactly the field every evaluator obligation's `definition` is
built from (`currentTaskObligations` → `entry.task`) — an instance plan that drifted there
leaves the invariant green while the door refuses every evaluation report.

Before this PR `EvaluatorDefinition` was `{ key }` alone, so key-equality was complete; the
`task` field arrived without a conjunct. `test/actor/equality.test.ts`'s
`FieldMutants<Shape> = Record<keyof Shape, …>` guard did not fire because no roster exists for
`EvaluatorDefinition` — `stageMutants.evaluators` mutates a key (`evaluatorOf(2)`), which the
comparison does read.

Also: the comment at `:95` says "every declared field compared". It is not true of the plan.

### 2. `src/domain/evaluation.ts:602-613` — `instanceEquals` does not read `input.acceptedSourceRef`

Same class, same PR. Run at the tip:

    begin(1, {ticket:1, workResult:101, acceptedSourceRef:11}, plan)
    begin(1, {ticket:1, workResult:101, acceptedSourceRef:12}, plan)
      ->  instanceEquals === true

`EvaluationInput` gained the field verbatim from the package; `instanceMutants.input`
(`test/actor/equality.test.ts:137`) mutates `workResult` only and there is no
`FieldMutants<EvaluationInput>`, so nothing went red. Reached through `ticketEquals` →
`ticketEqualsInstance`, so it feeds the same `recoveryComplete` and the same
`projectWriter.ts:204` version stamp. `evaluationsWellFormed`'s new
`open.input.acceptedSourceRef !== t.source` conjunct covers the *current* instance only; a
retired one is compared by `instanceEquals` alone.

Fix for both: a conjunct each (`taskDefinitionEquals(left.task, right.task)` in
`stageDefinitionEquals`; `left.input.acceptedSourceRef === right.input.acceptedSourceRef`),
plus a roster per shape in `test/actor/equality.test.ts` so the next field is a compile error.

## Nits (not blocking)

- `model/AGENTS.md:15` says `domain.qnt` "calls `taskIdentityValid`, `taskDefinitionValid` and
  `taskOwner`". `git grep taskOwner model/` outside the copy is empty — the clause was
  rewritten in this PR and `taskOwner` carried over. That list is the evidence for which
  contract vocabulary this tree actually drives.
- `model/domain.qnt:110` says the source band is "clear of the evaluator definitions below".
  True at `N_TASKS = 2` (definitions 1..8, sources 9..12) and false from `N_TASKS = 3`, where
  `evaluatorTaskOf(3)` reaches 12. Every instance the tree checks is 1 or 2, so nothing is
  wrong today; the sentence is one `const` away from being false.

## What holds

1. **Copies** — `diff` against the package at 76c95a9 is empty for both `task.qnt` and
   `ticket-domain/evaluation/evaluation.qnt`. `model/AGENTS.md` says verbatim for both and
   names no divergence in either copy (the `EvaluationBlockedEscalated` divergence it names is
   chuggy's own `Escalation` sum, argued at `model/ticket.qnt:230-235`).
2. **The source chain** — dispatch is the only observer (`decideDispatch`, and no other decider
   takes a source). Read off the re-emitted goldens: `eval-stage-passed` 9 → 12 on the pass →
   instance `as12`; `evaluation-blocked-resume` 9 → 11, rework at 11 (state 16, cycle 2),
   resume at 11 (state 27, cycle 3); `finalization-needs-work` 10 → 12, finalizer rework at 12
   (state 11, cycle 2). `sourcePinned` is in `allInvariants`/`invariantBundle` and red-proofed
   at `test/domain/invariants.test.ts:596`. **Mutation** (`decideWorkTaskDone`'s pass arm
   keeping `jb.source`): `check-model` RED, `happyPathInstanceTest`.
3. **The exact-obligation rule** — `reportMatchesTask(ticket, task, report)` → `obligationCurrent`,
   which is set membership on the whole `TaskObligation`, so a stale cycle, a foreign
   `definition` and a wrong `contextRef` each fail; a failure report matches by identity alone.
   An evaluator's `contextRef` is `instance.input.workResult` (the copy's own
   `currentTaskObligations`), i.e. D's accepted result reference, and a work task's is the
   cycle. **Mutation** (`obligationCurrent` comparing `owed.task == obligation.task`):
   `check-model` RED, `reportAdmissibilityRequiredTest` and nothing else.
4. **`releasedTicketValid`** — the package's six conditions plus `planValid` and chuggy's
   bounds; positional stage keys and evaluator keys in 1..N_TASKS in both halves;
   `definitionsWellFormed` is in the bundle `check-conformance` evaluates on every state of
   every golden, and the enablement refuses a zero ref
   (`test/domain/enablement.test.ts:328`, `journalRefusesInvalidReleasePayloadTest`).
5. **Goldens** — `emit-goldens.sh` at the tip leaves `test/golden/` byte for byte unchanged
   (`git status --porcelain test/golden` empty); `manifest.json` steps current. Decision 10's
   four shapes are all in the corpus; the fifth cannot be (A-report: a refused report takes no
   step) and `reportAdmissibilityRequiredTest` covers it. `test/random/draws.ts` draws the
   dispatch source from `dispatchSources` rather than deriving it.
6. **`src/domain`/`src/actor`** — `applyProduced` holds the whole obligation with
   `taskObligationEquals`; `currentTaskObligations` builds each obligation's `definition` from
   `entry.task`; `idsAccounted` changed in comment only. `liveObligations` builds the work
   obligation at `workCyclesStarted`, which `tasksWellFormed` pins equal to the outstanding
   task's own cycle.
7. **Comments and gates** — `git grep -n '\bdeps\b\|\bprog\b\|program\b' model src/domain src/actor`
   is empty. At the tip: `check-model` 0 (123) · `check-conformance` 0 (12 goldens, 259 steps) ·
   `check-random` 0 · `check-model-api` 0 · `check-figures` 0 · `check-comments` 0 ·
   `check-paths` 0 · `check-duplication` 0 · 211 unit tests across
   `test/{domain,actor,generated,golden,itf,random,conformance}`.
