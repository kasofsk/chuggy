# Round 1, machine half — model/rename @ 64e5abb5 off main 55de9de6

**APPROVE.**

Read: `CLAUDE.md`, `.chug/tasks/review-change.md`, `pr3/GOAL.md`, `survey.md` §1–4/§8/§11,
`pr2-fix/GOAL.md`; the whole of `model/{ticket,domain,refinement,api}.qnt`,
`model/tests/*`, `src/domain/*`, `src/actor/*`, `006-rename.ts`,
`test/{actor,conformance,random,golden,postgres}`; and the rendered schema of
every migration on both sides.

## 1. Is it only a rename?

Method: normalised both sides through GOAL.md's substitution table (old→token,
new→token) and diffed. `model/ticket.qnt`, `domain.qnt`, `refinement.qnt` and
`api.qnt` reduce to comment reflow plus exactly two substantive hunks, both the
admitted wall collapse:

- `domain.qnt` `action executionBlocked` loses `nondet why = Set(five).oneOf()`
  and passes the single reason. That is all it lost: `decideExecutionBlocked`,
  `escalate`, the retire and the label are unchanged.
- `refinement.qnt` `decisionEventEnabled`'s `ExecutionBlocked` arm becomes
  `a.reason == WorkExecutionUnavailableEscalated` — the same predicate over a
  one-element roster.

The same collapse is carried consistently into `test/random/draws.ts` (the
`reason` draw and `drawnWire.why` are gone) and `test/conformance/dispatch.ts`
(`replayStep` supplies the constant). Every other file in this half reduces to
the table plus prettier reflow; the largest residues are `decisionSemantics.ts`
(new, below) and its suite. `test/postgres/schedulerStore.test.ts` gains a case
(+161) driving a block through the scheduler to an API-role read — outside a
strict rename, argued in 563642aa's message, and it is what catches the grant
006 adds. Worth naming, not worth blocking.

`decideReleaseTicket` / `actorReleaseTicket` keep their names while the event
becomes `CreateTicket`; that matches the model, which is what governs.

## 2. Do stored rows still replay?

`rowAtCurrentVocabulary` is total over the vocabulary a journal row can hold. I
enumerated main's rosters against the map: step labels (main's 19 vs the
branch's 19 — the four that differ are all keys), `Phase`, `Reason`,
`FinalizationOutcome`, `DecisionEvent` tags. Nothing else in an `Entry` names
renamed vocabulary: `StepRecord` is label/transitions/effects, `Transition` is
ticket/from/to, no `DecisionEvent` value carries a `resumeAt` or a task kind,
and effects are deferred to PR 8. So GOAL.md's `event.value.resumeAt` and
"task kinds inside `event`/`rec`" name fields no row has — nothing is missed.
Key set and value set are disjoint, so the lift is idempotent and safe to run
at semantics 5 as it does.

Every correction now compares against the new spelling:
`completedWithoutFinalizing` → `"Finalization"`;
`decisionAtReworkWallParkedEvaluating` → `"EvaluationFailureEscalated"` /
`"ResumeEvaluation"` (and reads `decision.post`, which is the current decider's
output anyway); the cascade correction reads `Pending`/`Escalated`/`NoResume`/
`NoReason`, none renamed. `removedWallLabels` holds the two labels that are
deliberately *not* map keys, so `replayableDecision` still refuses them.

Traced by hand and then driven:
- **semantics 1** — `journalAtSemanticsOne*.json`, bytes unchanged (`git diff`
  empty). Row 10's `ticket-escalated rework_budget_exhausted` /
  `Evaluating→Escalated` lifts to the new label and phase, `entryAtRecordedDisposition`
  reads the lifted record, and the semantics-1 resume correction stamps
  `ResumeEvaluation`. Legal.
- **semantics 2, rig cascade shape** — `replay-rig.ts` (one edit in a scratch
  copy: `storedReplayCore`→`storedReplayGraph`) against this branch's `src` over
  `pr2-fix/rig-journal/vteng.jsonl`:
  `chuggy: 662 row(s), semantics 1/2/3, 4 cascade row(s) at seq 203,267,310,561 — storedJournalLegalOn = true` (78 tickets: Revoked 47, Done 31)
  `rehearsal: 30 row(s), semantics 1, 5 cascade row(s) at seq 5,14,17,23,29 — storedJournalLegalOn = true` (15 Revoked)
- **semantics 4 written by main today** — extracted main's `src` to a scratch
  tree, drove main's own deciders to a 12-row journal covering `ReleaseTicket`,
  `Working`, `ticket-escalated work_failed`, `ExecutionBlocked` at
  `ExecutionPolicyDenied`, and `FinalizationResult` at `FinalizationFailed`,
  encoded with main's `encodeEntry`, and read the rows back through this
  branch's `parseStoredEntry`/`storedJournalLegalOn` at semantics 4:
  all twelve decode into the new words and `storedJournalLegalOn = true`.

No row the map admits would have been refused by main other than a forged one
already spelling the new words, which no writer produces and which
`recordEquals` still judges on its merits. The digest chain is over the stored
text (`digest.ts`), not a re-encoding, so the lift cannot make an untouched row
read as tampered.

Every stored-command path that can carry old vocabulary is lifted:
`checkedFinalizationSubmission` (outcome), `storedSchedulerCompletion` (the
wall, which `submit_task_completion` keeps writing forever). What falls through
to `parseTicketCommand` is `Decide{Revoke|Dispatch|WorkReduce|EvalReduce|ResumeTicket}`,
`ReleaseDraft` and `ResolveNativeAction` — none names renamed vocabulary.

## 3. Migration 006

**No guard, and the argument holds.** I checked the rewrite's domain against the
roster each check actually carries after 005 in the rendered schema:
`ticket_projection.reason` is `{NoReason, WorkFailed, ReworkBudgetExhausted, +5 walls}`
and the `CASE` names all seven non-`NoReason` values; `.resume_at` is
`{NoResume, +4}` and all four are named; `.phase` and
`project_continuation.expected_phase` are the seven phases and all three
renamed ones are named; `native_action.reason` adds `DependencyRevoked`, which
the `ELSE` leaves alone and the restated check still admits on settled rows
only. The rewrite is total over the old roster, so no row can reach a new check
at a spelling it refuses, and a guard arm here really would be a control with
no row to find. Each of the six constraint names 006 drops exists in the
effective schema.

**Nothing is left at an old spelling that should move.** I reduced the rendered
schema to its effective objects (last definition per function/index/constraint
wins) and grepped for every old literal. What survives is exactly the intended
set: `execution.blocked_reason`'s five-wall check, `submit_task_completion`
(which builds `ExecutionBlocked` out of that column and so writes a wall name
next, not only before), and the both-spellings admissions in
`decision_event_is_valid` (v5: both tags, both reason sets, both outcomes),
`public_ticket_command_is_valid` (excludes both release tags),
`ticket_command_is_valid` and `submit_finalization_result` (`in_outcome` at
both). `request_finalization_approval` is the one read paired with a projected
phase and takes `'Finalization'` alone, correctly, because the projection was
rewritten above it. `journal_entry_release_ticket` is dropped and recreated over
`ARRAY['ReleaseTicket','CreateTicket']`, in the baseline's own unqualified form.
The `chuggy_api` column grant on `execution.blocked_reason` is there.

Against the rig facts in `tasks/S.md` — rows in every old phase, reasons
including the walls, settled `native_action` at `DependencyRevoked`, open and
settled rows at the others, `project_continuation` rows — I could not construct
a row 006 refuses or leaves at an old spelling.

**Render-diff main vs branch for migrations 1–5: empty** (byte-identical
rendering of 8056 lines; 006 is the only addition).

## 4. Goldens and witnesses

Re-emitted **all nine** goldens with `emit-goldens.sh` into a scratch
`CHUG_GOLDEN_DIR`: all nine are byte-identical to the committed files, and the
emitted set is exactly the committed set (no orphan under an old name). The
`steps` counts that moved in `manifest.json` (eval-stage-passed 11→10,
finalization-needs-work 12→13, work-failure-escalated 10→11,
rework-started-eval-failure 12→15) are the honest consequence of
`executionBlocked` losing a nondet draw: the same seed walks a different trace.
The manifest's invariants are rewritten in the new names, including
`rework-wall-resume`'s `t.to == Work` / `kind != WorkTask`. `check-model.sh`'s
witness roster is the same six modules (`resume rework stage sparse gate
dependency`) and `chuggy_witness_test.qnt` still declares exactly those six.

## 5. Docs and comments

`check-figures`, `check-comments` and `check-paths` are clean. I grepped this
half for every old spelling: what remains is the frozen fixtures (deliberate,
and asserted to still say the old words), the map's own keys, the decider
names the model keeps, and two local bindings in `model/tests/chuggy_test.qnt`
(`dResumeWorking`, `cEscWorking`). No comment states a quantity a reader must
trust; no new line claims a path this tree has not got; nothing states a lesson
outside the change's scope.

## Gates run on the tip

`check-figures` 0 · `check-comments` 0 · `check-paths` 0 · `check-boundaries` 0
· `check-model-api` 0 · `check-source` 0 · `check-conformance` 0 ·
`check-random` 0 · `check-postgres` 0 (75 suites) · `check-queries` 0 ·
`check-model` 0 (111 tests).

## Notes — looked at, not flagged

- **`ExecutionTaskKind` now overlaps `Phase`.** `src/interpreter/executionRequirement.ts:3`
  is `"Work" | "Evaluation"` and `Phase` now contains both. Before the rename
  the two unions were disjoint, so passing a phase where a fabric task kind
  belongs was a compile error; now it is not. No such mix-up exists today, so
  it is not a finding by this brief's standard, and it is the surface
  reviewer's file. Worth a branded type if PR 5 or 7 touches that boundary.
- **Deploy ordering.** After 006, the old image writing `'Finalizing'` into
  `ticket_projection.phase` hits the restated CHECK. That exposure is the same
  one 003 and 005 already carry (they narrowed rosters too), so it is the
  tree's accepted single-writer deploy model, not this change's defect. Worth
  the runbook's attention at release: stop the writer, migrate, roll.
- **`submit_finalization_result` admits `FinalizationFailed` for good.** GOAL.md
  chose that; nothing narrows it later. Not reopened here.
- `test/postgres/schedulerStore.test.ts`'s new case and the `+161` it brings are
  outside a strict rename; named above, not blocked.
- `decideReleaseTicket` keeping its name beside a `CreateTicket` tag is a grep
  seam (house rule 11), but the model spells it that way and the model governs.
- Practices invoked: none. This review is a diff-and-drive against the model,
  the rig's own journal and the rendered schema; no general standard was the
  thing in question.
