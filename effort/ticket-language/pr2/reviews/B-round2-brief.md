# Review: PR 2 Task B round 2 (the fix round)

Fresh reviewer; you did not author the change. Work in
`~/claude/chuggy-wt/three-deletions-review-b`, branch
`model/three-deletions-fix-b` at 34039c0c (`node_modules` linked, Docker
running). Read `.chug/tasks/review-change.md` first; verdicts APPROVE /
CHANGES / ESCALATE. Commit nothing; revert scratch with `git checkout -- .`.
Then `reviews/B-round1.md`, `tasks/B-fix1.md` and `tasks/B-fix1-report.md`
(a claim) under `~/claude/chuggy-effort/ticket-language/pr2/`.

Scope: `git diff b55c95a4..34039c0c` only.

Check:
- The three `nativeReads.ts` subqueries all carry the Pending predicate; a
  stranded Pending ticket lists its Revoked deps ascending; a Revoked,
  Done, Working and Escalated ticket with a Revoked dep each answer `[]`;
  the new postgres cases go red under dropping the phase filter and under
  `ORDER BY ... DESC` (run both mutations).
- `responses.ts` ~223 and `nativeWeb.ts` ~268: read both comments against
  the SQL; are they now true for every phase.
- The deleted `revokedDependencies` in `src/domain/derived.ts`: nothing
  cites it (line-joined grep across `src/`, `test/`, `model/`).
- The contract document change and its golden: regenerate through the
  test and diff.
- `test/rig/stranding.spec.ts`: read it as a script against the console C
  is building (`tasks/C.md`): the copy regex, the "up next" claim, the
  inbox badge — is each something the wire after this PR can produce; does
  anything in it still drive a deleted feature. It cannot run here; judge
  it by reading.
- The three `as const` fixtures: no deleted key survives anywhere in `src/`
  or `test/` (grep line-joined for the nine names in the brief).
- The shared-line judgment in `nativeReadsResources` (house rule 5): is the
  file honest or did the fix hide a line to pass a gate.
- Gates: `check-postgres`, `check-queries`, `check-conformance`,
  `check-comments`, `check-figures`, `check-paths`; `check-source` red only
  on C's six files.

Write `~/claude/chuggy-effort/ticket-language/pr2/reviews/B-round2.md`,
verdict first; each finding names a real failure at file:line.
