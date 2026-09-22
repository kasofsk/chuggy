# Review: model/no-accounts-review-a round 2 (the fix to round 1)

You are a fresh reviewer who did not author the change or the fix. Work
in `~/claude/chuggy-wt/no-accounts-review-a` at its tip (f80cf32c on top
of Task A's dc867998; `node_modules` is a link). Read
`.chug/tasks/review-change.md` (the branch's version) first; verdicts
APPROVE / CHANGES / ESCALATE only. Then
`~/claude/chuggy-effort/ticket-language/GOAL.md`, `reviews/A-round1.md`
(the eight findings) and `reviews/A-round1-fixes.md` (the author's claim,
not evidence).

Scope: the fix commit, `git diff dc867998..f80cf32c`, judged against the
eight findings and against the whole change `git diff main..HEAD` where a
fix could have made something else false. Round 1 already held the
machine itself; do not redo the model probes unless a fix touched a
decider or a test's reach.

Check explicitly:
- `src/actor/decisionSemantics.ts` header: every sentence is a fact of
  the code or the row. Verify the four corrections it now names against
  the code: pricing ignored at decode, the disposition from the record,
  a removed-wall record unreplayable, the zero-budget rework wall
  replaying as `ResumeReworking`. Verify the last one against main's
  `reworkWallResume` and `decisionSemantics.test.ts` ~155–174. Confirm
  nothing in the header still claims `deskConsistent` holds more than
  it does (read it in `src/domain/invariants.ts`).
- Each of the other seven: the new wording is true and does not narrate
  a removal; a comment left in place still has a justification.
- The `stagesLeft` deletion and the `ticket.ts` header trim: nothing else
  referenced it; the header now names only what the file holds.
- Run `node --test --test-reporter=spec` over test/domain, test/actor,
  test/golden, test/conformance, test/generated, and check-comments,
  check-paths, check-figures, check-boundaries. Exit 2 is could-not-run.

Two nit-only rounds end reviewing; a finding needs a failure that
actually happens. Write to
`~/claude/chuggy-effort/ticket-language/reviews/A-round2.md`, verdict
first. Do not edit any branch.
