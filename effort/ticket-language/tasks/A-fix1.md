# Task A-fix1 — answer review round 1 on Task A

Worktree: `~/claude/chuggy-wt/no-accounts-review-a`, branch
`model/no-accounts-review-a` (Task A's tip; `node_modules` is a link).
Task B is committing on `model/no-accounts` in another worktree: do not
touch that worktree or branch. Your commit lands on this branch and is
merged later.

Read `~/claude/chuggy-effort/ticket-language/reviews/A-round1.md` in full:
eight findings, all in `src/domain`, `src/actor` and their tests. Read
the repo's CLAUDE.md and `.chug/tasks/review-change.md` (the branch's
version), and invoke `comments-describe-the-code:comments-describe-the-code`
with the Skill tool before writing.

Fix every finding as the review states it. Rules:
- A comment whose justification was deleted is rewritten to the
  justification that is true now, or deleted if the code needs none. Do
  not reword around a stale claim; a churned-on comment is deleted rather
  than reworded.
- Finding 1 (`src/actor/decisionSemantics.ts` header) is the one that
  matters: the header must state exactly what a replayed pre-3 row differs
  in, as facts of the row, and nothing it cannot back. Read
  `deskConsistent` in `src/domain/invariants.ts` and say what it actually
  holds. The zero-budget rework wall that stamped `NoResume` at semantics
  2 and replays as `ResumeReworking` is a divergence the header names
  (the tests at ~155–174 already assert it); count the corrections
  correctly or do not count them.
- Finding 6: delete `stagesLeft` and anything only it used.
- Run `node --test --test-reporter=spec` over test/domain, test/actor,
  test/golden, test/conformance, test/generated, and
  `.chug/tasks/check-comments.sh`, `check-paths.sh`, `check-figures.sh`,
  `check-boundaries.sh`; all green. tsc still names Task B's files and
  nothing else — confirm the list did not grow.

One commit, message carrying the why (house rule 12; it answers review
round 1), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
`--no-verify` is expected (the hook is red on B's files); say so in the
message's last paragraph. Do not push. Report to
`~/claude/chuggy-effort/ticket-language/reviews/A-round1-fixes.md`: each
finding, what you did, the gate output verbatim.
