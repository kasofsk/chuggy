# Mutation sweep: PR 3 (the rename), whole branch

Fresh reviewer; you did not author any of it. Work in
`~/claude/chuggy-wt/rename-sweep`, detached at a704946c, the tip of
`model/rename` (Docker running; run `npm ci` at the root only — never inside
`ui/chuggy-ui/`, which has no lockfile and wipes the root install). Read
`.chug/tasks/review-change.md` first, then `GOAL.md` under
`~/claude/chuggy-effort/ticket-language/pr3/`. Verdicts APPROVE / CHANGES /
ESCALATE. Revert every scratch mutation with `git checkout -- .`; commit
nothing. `../pr2/reviews/sweep.md` is the shape and the bar.

Scope: `git diff 55de9de6...a704946c`. Round 1 (`reviews/round1-machine.md`,
`round1-surface.md`; fixes in `tasks/F1-report.md`) reviewed the pieces; do
not repeat them. This round is the sweep: for each behaviour the branch adds
or changes, mutate the code and find the test that goes red. A behaviour no
test can redden is a finding; a test that stays green under a mutation it
names is a finding. A sweep round ships unless it finds a behaviour defect,
so separate "unpinned" from "wrong".

This PR is a rename, so most of its behaviour is "the old bytes still mean
what they meant". Mutate at least, one at a time, recording what went red
(or did not):
- `src/actor/decisionSemantics.ts` `wordAtCurrentVocabulary` /
  `rowAtCurrentVocabulary`: drop one key at a time (`Working`, `Evaluating`,
  `Finalizing`, `ReleaseTicket`, `WorkFailed`, `ReworkBudgetExhausted`,
  each wall name, `FinalizationFailed`, `ResumeWorking`…, each old step
  label) — which test reddens for each; is there a key whose removal nothing
  catches. Make the map non-total (skip `rec.transitions[].from`); make it
  run after the codec instead of before; apply it at semantics 5 rows only.
- The cascade correction at semantics 1–3 removed; run at 4; parked set
  unrestricted; `decisionSemanticsVersionCurrent` back to 4.
- `checkedFinalizationSubmission`'s lift removed; `storedSchedulerCompletion`'s
  lift removed.
- `decisionPlan.ts`'s domain→fabric task-kind map inverted or dropped;
  `wire.ts`'s fabric→domain lift dropped.
- `executionBlockedBy`: the `reason` predicate dropped; ORDER BY inverted;
  `outcome='Blocked'` dropped; the `chuggy_api` grant removed from 006.
- Migration 006: each column rewrite skipped one at a time
  (`ticket_projection.phase`, `.reason`, `.resume_at`, `native_action.reason`,
  `project_continuation.expected_phase`); one wall name left out of the
  collapse; a restated CHECK still admitting an old spelling;
  `decision_event_is_valid` refusing the old spelling; the partial index over
  the new tag only; `submit_finalization_result` refusing the old outcome;
  `request_finalization_approval` reading `'Finalizing'`.
- `model/`: one arm of the rename reverted in `domain.qnt` (a phase, a
  reason) — which of check-model, goldens, conformance, random redden; the
  wall collapse undone (`executionBlocked` drawing a `why` again).
- Contract/wire: `escalationReasons` carrying a fourth name;
  `ticketResponseSchema` without `executionBlockedBy`; a phase roster with an
  old spelling.
- Console: `phaseLabel` returning the constructor; `escalationDetail` ignoring
  the wall; `blockedReasonLabel` missing one wall; `TicketSituation` drawing
  the wall while the reason is not `WorkExecutionUnavailableEscalated`. Read
  `tasks/C-report.md`'s judgment calls and say whether any is wrong.
- The frozen fixtures: edit one byte of `test/actor/journalAtSemanticsOne*.json`
  — what reddens (the digest chain, or nothing).
- Fabric alignment: `.chug/configurations/*.json`, `images/worker/*` and the
  fabric's ticket-service config carry nothing the new parser refuses and
  nothing renamed (grep for the old and new spellings).

Then the docs, once: every comment the branch touches read against the code
beside it; a comment describing an old name as current, or stating a
quantity, is a finding with file:line. Line-joined grep for every old
spelling in GOAL.md's table across the whole tree including `ui/` and
`.chug/`; account for each hit (frozen fixture, map key, admitted old
spelling, copy, or a miss). `check-figures`, `check-comments`, `check-paths`
results included.

Write `~/claude/chuggy-effort/ticket-language/pr3/reviews/sweep.md`:
verdict first, a table of mutation → what went red, findings (file:line,
input, effect), then unpinned behaviours separately. Hand back the verdict
and findings in under 30 lines.
