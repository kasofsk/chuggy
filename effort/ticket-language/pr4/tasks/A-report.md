# Task A report — the model, goldens, generated mirror, domain and actor

Tip: `fbdb7b6f` on `model/finalization-unavailable`, 5 commits off main `e5f7b3d3`.

## Per layer

- **`model/`** — `ticket.qnt`: `FinalizationOutcome` gains
  `FinalizationResultUnavailable`, `Reason` gains
  `FinalizationUnavailableEscalated`, both docs extended.
  `domain.qnt`: `finalizationOutcomes` draws the third,
  `finalizationOutcomeEnabled` gains its arm, `decideFinalizationResult`
  escalates at `ResumeFinalization` with the label
  `ticket-escalated finalization_unavailable_escalated`; the module header, the
  outcome-roster doc and the `finalizationResult` action doc stop calling the
  report conclusive. `refinement.qnt`, `api.qnt` and `mc/` needed **no edit**:
  every draw and enablement there is a reference to `finalizationOutcomes`, so
  the third branch arrives free (survey §1 was right).
- **Model suites** — new `finalizationUnavailableEscalatesTest`;
  `finalizationOutcomesDrawRuleTest` extended; the hand-built `escFinalizer`
  park (old `chuggy_test.qnt:500-503`, `ResumeFinalization` under
  `WorkFailureEscalated`) deleted and `resumeReturnsToStampedPhaseTest` rebuilt
  on `dFinalizationUnavailable.post`; its row dropped from
  `handBuiltFixturesAccountedTest`; the revoke section's "both desk-reason
  flavors" comment reworded. New `finalizationUnavailableWitness` in the
  **existing** `chuggy_witness_gate_test` — so the witness roster in
  `check-model.sh` is unchanged and `check-model.test.sh`'s 13-call fixture
  figure still holds. No invariant added; none names the reason roster.
- **Goldens** — `finalization-unavailable.itf.json`, 31 steps, directed
  emitter, seed `0x1`, 60000/60, aimed
  `not(lastStep.label == "ticket-resumed" and … t.to == Finalization)`. Step 30
  is the wall (`OpenHumanTask`), step 31 the resume
  (`Finalization`, `["RunFinalizer"]`) — one row carries both halves, and a
  resume into Finalization is the only one the machine has. Six other rows
  moved (the third branch re-walks the same seed) and were re-emitted with
  `.chug/tasks/emit-goldens.sh`; every `steps` field read back off the file.
  Corpus now 10 rows / 226 steps against the 24 / 800 budget.
- **Generated + `src/domain`** — `modelTypes.ts` and `model-api.ts`
  regenerated; `finalizationOutcomes`, `finalizationOutcomeEnabled` and
  `decideFinalizationResult` take the arm; `test/domain/` gains the new
  decider test and the roster equality is extended.
- **`src/actor`** — `decisionSemanticsVersionCurrent` stays **5**; the header
  gains the rule that a value added to a decider's input alphabet mints no
  version. `rowAtCurrentVocabulary`/`supersededSpellings` untouched. Two tests:
  the wall and its resume decided by the current deciders and replayed legal at
  5, and that neither new word is a spelling the vocabulary lifts.
- **`test/conformance`, `test/random`** — no edit needed; both route through
  the roster and the codec. Verified the default seeded sweep really draws the
  third outcome: 4 `finalizationResult` draws across the 2000 runs, 1 of them
  `FinalizationResultUnavailable`.

## Outside my layers (smallest edits, B and C own the substance)

- `src/contract/rosters.ts` — `escalationReasons` gains the reason (a compile
  in `test/ui/resumePoint.test.ts`, plus `test/contract/rosters.test.ts`'s
  deepEqual against `reasonTags`).
- `ui/chuggy-ui/app/core/resumePoint.ts` — `walledPoint` arm →
  `"ResumeFinalization"`.
- `ui/chuggy-ui/app/core/codeSentences.ts` — one placeholder sentence
  ("the platform could not finalize this ticket"); **C re-decides the copy**.

## Gates on the tip

| gate | exit |
|---|---|
| `check-model` | 0 — 0 failure(s), 113 test(s) |
| `check-model-api` | 0 |
| `check-conformance` | 0 — 10 goldens, 226 steps |
| `check-random` | 0 — 2000 runs, 80000 steps |
| `check-source --static` | 0 |
| `check-source --unit` | 0 — 208 suites |
| `check-figures` | 0 |
| `check-comments` | 0 |
| `check-paths` | 0 |
| `check-conformance.test.sh` | 0 — 9 passed |
| `check-random.test.sh` | 0 — 16 passed |

## Reds left

Only `check-console` (exit 1), all Task C: `codeLabels.ts:41`
(`escalationReasonLabel`) and `:128` (`escalationDetailLine`),
`ticketSections.ts:67` (`escalationBadgeLabel`), the total record in
`ui/chuggy-ui/test/ticketSections.test.ts:52`, and the runtime arrays in
`ui/chuggy-ui/test/codeLabels.test.ts` and `test/resumePoint.test.ts`.
No unit red is left in the root tree.

## Notes on GOAL.md

- Nothing in it was wrong. Two things it did not say: the third branch moves
  **six existing goldens**, so the corpus diff is large and mechanical; and the
  contract/console compile cascade reaches three files before the root tree
  typechecks, which is why they are in this branch at all.
- Commit attribution: the brief asked for `Claude Fable 5.1`; this ran on Opus
  5 (1M context) and the commits say so.
