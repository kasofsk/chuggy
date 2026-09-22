# Task A — the model loses the accounts

Worktree: `~/claude/chuggy-wt/no-accounts` (branch `model/no-accounts`,
based on main 81e8093a; `npm ci` has been run or is running — check
`~/claude/chuggy-effort/ticket-language/scratch/npm-ci.log` ends with
"exit 0" before you start gates). Scratchpad:
`~/claude/chuggy-effort/ticket-language/scratch/A/`.
Read `~/claude/chuggy-effort/ticket-language/GOAL.md` first (all of it), then
`SPIKE.md` beside it, then the repo's CLAUDE.md, `model/AGENTS.md` and
`.chug/tasks/review-change.md` — the author is bound by it. Invoke with the
Skill tool `comments-describe-the-code:comments-describe-the-code` and
`fix-the-assumption-not-the-hack:fix-the-assumption-not-the-hack` before
writing. The package's text is the target: its `ticket.qnt` is at
`/tmp/claude-1000/-home-geoff-claude-chuggy/6988229d-0563-475a-9255-7ce0b2467e85/scratchpad/ctd/model/ticket-domain/ticket.qnt`
(read-only reference; do not copy code from it beyond the one type named in
GOAL.md, and take that type's text verbatim).

Do not touch `ui/chuggy-ui/`, `src/interpreter/`, `src/adapters/`,
`src/contract/` (Task B) or `src/adapters/postgres/schema/migrations/`
(Task S). Where the compiler leads you into those, stop at the boundary and
list the sites in your report.

## Model

1. `git mv model/measure.qnt model/ticket.qnt`; module `chuggy_ticket`.
   Delete the "The measure" section whole (finalizationBudget through
   sysMeasure), the `Bounds` type, the three pricing types, and the six
   Ticket fields GOAL.md names. Rewrite the module header and every field
   comment that argued from the measure or the accounts so it describes
   the record as it now is (a comment that says what was removed is a
   comment about history, house rule: describe the code). Add
   `type EvaluationFailureDisposition = ReworkEvaluationFailure | EscalateEvaluationFailure`
   with a comment saying what the machine consults it for. Update every
   `import chuggy_measure` (domain, refinement, api, tests, mc).
2. `model/domain.qnt`: consts GAS, REWORK_POLICY, FINALIZATION_PRICING go,
   with `bounds`, `reworkPolicyChoices`, `finalizationPricingChoices`,
   `resumePricingChoices`. `decideEvalStageReduce` takes the disposition as
   a parameter; the `evalReduce` action draws it nondet from the two
   values (a `pure val dispositionChoices`), and the step label for the
   escalate branch stays "ticket-escalated rework_budget_exhausted".
   `finalizerFailure` always re-enters Working with "rework-started
   finalization_failed". `resumeCharge`, the gas guard on dispatch and
   resume, and the refill in `resumeTicket` go; `reworkWallResume` becomes
   `ResumeReworking` unconditionally; `modeledResumeExists`'s zero-budget
   clause goes. The type invariant at ~1164 loses the account bounds.
   Reread the file header whole and rewrite "THE ACCOUNTS" to describe
   the disposition; the header must not narrate the removal.
3. `model/refinement.qnt`: `EvalReduce(int)` becomes
   `EvalReduce({ ticket: int, onFailure: EvaluationFailureDisposition })`;
   `ReleaseTicket` loses the three pricing fields; the actor's evalReduce
   draws and journals the disposition. Every theorem about gas/refill
   goes; the rest are re-proved.
4. `model/mc/mc_chuggy.qnt` and `mc_chuggy_directed.qnt`: one instance
   each (`mc_chuggy`, `mc_chuggy_directed`); the pricing instances and
   their rationale comments go. `model/tests/*`: delete tests that existed
   only for an account or the measure; fix the rest; never weaken a test
   to keep it.
5. Goldens: re-plan `test/golden/manifest.json`. Rows keep their aim style
   (an invariant the run must refute). Keep an aimed row for each of:
   execution-blocked, eval-stage-passed, rework-finalization-failed,
   work-failed, the rework wall reached by an Escalate disposition, a
   resume from the rework wall (re-enters Working), finalization-succeeded,
   nofinalizer-completion, a Rework disposition re-entering Working, a
   free walk. Drop gas-exhausted, finalization-budget-exhausted,
   rework-wall-refillable, and the retryfree rows (resume is free for
   every ticket now; keep ONE resume-aimed row). Names lose their pricing
   prefix. Regenerate with `.chug/tasks/emit-goldens.sh`; every removed
   golden file is deleted; `test/golden/coverage.test.ts` must pass.
6. `scripts/generate-model-api.ts` regenerates `src/domain/generated/` and
   `src/generated/model-api.ts` from `model/api.qnt` (which loses the three
   Api aliases and gains `ApiEvaluationFailureDisposition`).

## Code (domain, actor, conformance)

Chase `npx tsc --noEmit -p .` outward from the generated types through
`src/domain/` (delete `measure.ts`, `pricing.ts`; `config.ts` becomes
`{ nTickets, nTasks, maxStages }`; deciders, enablement (`retryableIn` is
"parked with a modeled resume"), invariants lose the measure and account
invariants; witnesses) and `src/actor/` (`decisionEvent.ts` codec:
ReleaseTicket loses pricing, EvalReduce gains `onFailure`; `equality.ts`;
`decisionSemantics.ts` as GOAL.md "Decision semantics" specifies:
`DecisionSemanticsVersion = 1 | 2 | 3`, current 3, and the correction for
1 and 2 reads the disposition from the stored row's `rec`, so
`execDecisionEventAt` and `storedReplayCore`/`storedJournalLegalOn` pass
the row; write the header so it states the three corrections as the row's
facts). `test/conformance/*`, `test/domain/*`, `test/actor/*`,
`test/generated/*`, `test/random/draws.ts`, `test/itf/vocabulary.ts`
follow. Delete a test that existed only for an account; never weaken one.
`test/actor/journalAtSemanticsOneWalls.json` is a stored history fixture:
keep it replaying under the correction, and add a semantics-2 EvalReduce
row fixture whose rec escalated, proving the rec-derived disposition.

Stop at `src/interpreter`, `src/adapters`, `src/contract`: leave them red
and list every file tsc names in the report.

## Gates

`.chug/tasks/check-model.sh` must be green (it is slow; run it once at the
end, and once more if you change the model after). `.chug/tasks/
check-conformance.sh`, `check-goldens.sh` (or whatever the roster names for
goldens), `check-comments.sh`, `check-paths.sh`, `check-figures.sh` green.
`check-source` will be red for Task B's directories and the console:
state exactly which files. Exit 2 is could-not-run: fix the environment,
never treat it as a pass.

## Commit and report

Commits on the branch, each message carrying its why (house rule 12); the
first commit is the model alone (model/ + goldens + generated), the second
the code. If the hook fails only on Task B's files, `--no-verify` and say
so in the message's last paragraph. End every message with
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push.
Report to `~/claude/chuggy-effort/ticket-language/tasks/A-report.md`: what
changed, the golden re-plan (old name → new name or dropped, and the aim),
gate results verbatim, the red files Task B inherits, anything unsure.
