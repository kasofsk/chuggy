# Review: Task B round 2 (the fix round)

Fresh reviewer; you did not author the change. Work in
`~/claude/chuggy-wt/no-accounts-fixb`, branch `model/no-accounts-fixb` at
f4a86f29 (`node_modules` linked, Docker running). Do not commit or edit the
branch; revert any red-proof scratch with `git checkout -- .` before you
finish. Read `.chug/tasks/review-change.md` first; verdicts APPROVE /
CHANGES / ESCALATE.

Scope: `git diff 6fcb53cf..f4a86f29` — two commits fixing the two findings
of `reviews/B-round1.md` (read it, and `tasks/B-fix1.md`, and the author's
`tasks/B-fix1-report.md` as a claim, not evidence). Do not re-review the
rest of the branch.

Check:
- **The count.** `evaluationFailureReworksStarted` in `src/domain/task.ts`:
  a Work run counts only when the evaluation run immediately before it holds
  a `Failed` task. Construct histories the tests do not: an evaluation run
  where the Failed task has a *lower* id than a Passed one; a rework whose
  eval stage was multi-stage (Evaluation value 0 then 1) with the failure in
  stage 1; a ticket whose record contains Cancelled work tasks from a
  revocation; a history where two evaluation runs are adjacent with no Work
  between them (can the deciders produce it?). Decide whether each is
  counted correctly and whether "immediately before" is the right notion
  against what the deciders actually retire into `record` (read
  `src/domain/deciders.ts` for how a failed evaluation retires its set and
  opens the rework fan-out, and how `finalizerFailure` re-enters Working).
- **`>= cyclesMax`.** `cyclesMax: 2` → Rework, Rework, Escalate; `0` →
  Escalate first. Flip it and confirm a test goes red.
- **The reviewer's scenario inverted** is driven through the real deciders,
  not a hand-built record; confirm the two finalization failures actually
  produce Work runs in `record` before the evaluation failures.
- **The guard arm** in `004-no-accounts.ts`: the `session_turn` arm uses the
  same bound as the CHECK; both test arms red-proof (drop the arm → the
  in-band refusal case fails; loosen the bound → the at-bound case fails).
  The refusal text changed; check the two moved regexes and that no other
  test or doc quotes the old text.
- Render diff main vs branch still additions-only.
- Gates: `check-postgres`, `check-queries`, `check-conformance`,
  `check-comments`, `check-figures`, `check-paths`; `node --test` on the
  touched suites. `check-source` is red on five console files C owns; list
  them and nothing else.

Write `~/claude/chuggy-effort/ticket-language/reviews/B-round2.md`, verdict
first; each finding names a real failure at file:line. No style nits.
