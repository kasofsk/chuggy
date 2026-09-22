# Mutation sweep: PR 1 (the accounts leave), whole branch

Fresh reviewer; you did not author any of it. Work in
`~/claude/chuggy-wt/no-accounts-review-b`, detached at 7429fe4f, the tip
of `model/no-accounts` (`node_modules` linked, Docker running). Read
`.chug/tasks/review-change.md` first, then
`~/claude/chuggy-effort/ticket-language/GOAL.md`. Verdicts APPROVE /
CHANGES / ESCALATE. Every scratch mutation is reverted with
`git checkout -- .` before you finish; commit nothing; edit no branch.

Scope: `git diff main...7429fe4f`. Prior rounds (`reviews/S-round1.md`,
`A-round1.md`, `A-round2.md`, `B-round1.md`) reviewed the pieces for
correctness; do not repeat them. This round is the sweep: for each
behaviour the branch adds or changes, find the test that pins it by
mutating the code and watching for red. A behaviour no test can turn red
is a finding; so is a test that stays green under a mutation it names.
Per `~/.claude/...` house rule: a sweep round ships unless it finds a
behaviour defect, so separate "unpinned" from "wrong".

Mutate at least these, one at a time, and record the gate or suite that
went red (or did not):
- `model/ticket.qnt`: the EvalReduce disposition (`ReworkEvaluationFailure`
  → escalate and vice versa); `finalizerFailure` reworking vs escalating;
  resume with the wall reason; the dispatch guard — which of
  `check-model`, `check-conformance`, `check-random`, the goldens go red.
- `src/actor/decisionSemantics.ts`: each of the four corrections (drop one;
  swap the rec-derived disposition; let a record naming a removed wall
  replay; the v2 zero-budget row) — which replay test goes red.
- `src/domain/task.ts` `evaluationFailureReworksStarted` and
  `src/interpreter/reworkCap.ts` (already red-proofed in B round 2 — one
  spot check only).
- The journal chain (`src/adapters/postgres/...journal`): verify over the
  decoded row instead of the stored text; skip the semantics version from
  the envelope digest; accept a semantics-3 bare-int EvalReduce.
- Migration 004: each guard arm removed; the deployment-policy rewrite
  changing key order; the dispatch_candidate drops; the narrowed reason
  CHECKs widened back.
- Deployment-policy pin at startup: compare as text instead of `::jsonb`.
- The wire/contract: reintroduce a removed escalation reason literal in
  `src/contract/rosters.ts`; put a pricing field back on the ticket view —
  which contract test goes red.
- Console (`ui/chuggy-ui`, sonnet-authored, lightly reviewed): the wall
  detail copy for `ReworkBudgetExhausted`; `resumePoint.ts` returning
  `undefined` for the rework wall; the deleted Budgets panel's section
  order; `OfferedAction` drawing without a cost. Also read
  `tasks/C-report.md`'s judgment calls and say whether any is wrong.
- Fabric alignment: `src/roots/ticketService.ts` requires
  `rework.cyclesMax` and exactly three `domain` keys; confirm a config
  carrying the old `gas`/`reworkPolicy`/`finalizationPricing` keys is
  refused at startup with a message naming the key.

Then the docs, once: every comment the branch touches is read against the
code beside it; a comment that describes something the branch removed, or
states a quantity, is a finding with file:line. `check-figures`,
`check-comments`, `check-paths` results included.

Attribution: commits eb7f1fdb and 6fcb53cf carry a different
Co-Authored-By from the rest; note it, not a finding.

Write `~/claude/chuggy-effort/ticket-language/reviews/sweep.md`: verdict
first, then a table of mutation → what went red, then findings (file:line,
input, effect), then unpinned behaviours as a separate list.
