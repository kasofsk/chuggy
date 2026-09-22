# Task C (PR 2): the console loses the three

Worktree `~/claude/chuggy-wt/three-deletions`, branch `model/three-deletions`
at Task B's tip. Read `.chug/tasks/review-change.md`, `GOAL.md` here,
`tasks/B-report.md` (what the wire now carries), and PR 1's `../tasks/C.md`
and `../tasks/C-report.md` for the shape and the judgment calls that round
made. The UI copy standard: nouns, one-word statuses, one short line.

Scope (`ui/chuggy-ui/` and the two oracle suites under `test/ui/`):
- The finalizer picker in ticket creation becomes the landing choice, with
  `None` among the modes; nothing says "finalizer" as a ticket property.
- The ticket page and the ledger lose `combinator`; a stage is its fanout.
- `DependencyRevoked` leaves every roster, label, sentence, resume point and
  wall detail; `resumePoint.ts` loses the case.
- A Pending ticket whose read carries `revokedDependencies` shows one line,
  "Blocked by revoked dependency N" (or "dependencies N, M"), in the
  situation column, with Revoke as its exit; no desk task, no wall.
- Every test that authored `NoFinalizer`, `AnyPass` or the cascade wall is
  deleted or rewritten to the surviving vocabulary; do not neutralise a
  fixture into copy that names a deleted feature (PR 1's sweep caught
  exactly that).
- `README.md` and `tokens.css` claims that name the removed things.

`npm run lint`, `npm run test` in `ui/chuggy-ui`; `.chug/tasks/check-source.sh`
green; then `CHUG_CI_FULL=1 .chug/tasks/ci.sh` once. Invoke the
`comments-describe-the-code` skill over your diff. Commit ending
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Report to
`tasks/C-report.md` with every judgment call listed.

## From Task B

Branch tip b55c95a4. `check-source` is red on exactly:
`ui/chuggy-ui/app/core/{codeSentences,resumePoint,ticketCreation,ticketLedger}.ts`
and `test/ui/{resumePoint,ticketActions}.test.ts`. The wire now has
`briefFinalizationModes` with `"None"`, no `finalizers`, no
`evaluationCombinators`, stages as `{ fanout }`, and the ticket read's
`revokedDependencies: number[]`. A brief with no finalization takes the
repository's landing default.
