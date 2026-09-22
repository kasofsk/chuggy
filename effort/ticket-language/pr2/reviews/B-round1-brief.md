# Review: PR 2 Task B round 1 (interpreter, adapters, contract) + A's fix

Fresh reviewer; you did not author the change. Work in
`~/claude/chuggy-wt/three-deletions-review-b`, detached at b55c95a4
(`node_modules` linked, Docker running). Read `.chug/tasks/review-change.md`
first; verdicts APPROVE / CHANGES / ESCALATE. Commit nothing; revert scratch
with `git checkout -- .`. Then `GOAL.md`, `tasks/B.md` (with its appended
sections), `tasks/B-report.md` (a claim) under
`~/claude/chuggy-effort/ticket-language/pr2/`; `reviews/A-round1.md` and
`reviews/S-round1.md` are done — do not redo them, but DO check the three
lines A's fix commit 321195a1 changed and its new revoke-from-Escalated
case (red-proof it by keeping the wall's reason on revoke).

Scope: `git diff 27d510e3..b55c95a4` — B's 9a1f7151 (sixty files) and
A's fix 321195a1.

Check:
- **`None` lands nothing.** Drive a finalizer run whose brief mode is
  `None`: one FinalizationResult Succeeded, no forge client call, no
  artifact read, no proposal; the brief is read before the binding so a
  ticket whose repository has no binding still concludes. Then the
  negative: a Push brief still lands. Where does the finalizer read the
  mode — and can a brief with mode None but a `reference` reach the
  finalizer (B added a CHECK `draft_brief_finalization_none_names_no_reference`
  to 005; verify the wire refuses it too, or the CHECK is the only line).
- **The default.** No `finalization` in a brief → the repository's landing
  default, never `None`. Verify against `briefFinalizationDefault`,
  `create_draft`'s coalesce and the post-005 no-NULL claim; a draft made
  through the wire without a mode lands by the repository default.
- **`revokedDependencies`** off the projection plus the journal release
  entry: a Pending ticket with one Revoked dep lists it; two, in id order;
  a Done dep and a Working dep listed nowhere; a ticket whose release
  entry is missing (can it be?) — what does the read do. Also judge the
  choice: is the journal's ReleaseTicket entry the read already joins, or
  a new join per ticket read (cost on the ticket list)?
- **Stored operation refusal**: an undecided `operation` carrying
  `ExecutionBlocked{DependencyRevoked}` is refused at decode with the
  message naming the operation; the readiness test UPDATEs a real row —
  confirm it goes red when the refusal is removed.
- **005's B additions**: the session_turn re-render (derive
  `sessionTurnInputCharsMax` yourself and compare the literal), the guard
  arm for it, the two CREATE OR REPLACE bodies diffed against what they
  replace, the new CHECK. Render diff main vs branch additions-only.
- **The contract**: the document is byte-identical to what its test
  emits; `responses.test.ts` pins the ticket read's key set including
  `revokedDependencies`; a stage on the wire is `{ fanout }` only and an
  extra `combinator` key is refused (or stripped — say which and whether
  that matters).
- **dispatchViewSchemaVersion stays 1**: the author's argument is that an
  old cached view says strictly more; check the reader of a cached view
  does not fail on the extra keys (zod strict?).
- **Dispatch views / selector**: what the selector shows the lead lost
  `finalizer` and `combinator`; a prompt or sheet naming them?
- Gates: `check-postgres` (75), `check-queries`, `check-conformance`,
  `check-random`, `check-boundaries`, `check-comments`, `check-figures`,
  `check-paths`; `check-source` red only on the six console files listed
  in the report.
- Prose: every touched comment against its code; grep line-joined for the
  twelve deleted names across `src/` and `test/` (not `ui/`).

Write `~/claude/chuggy-effort/ticket-language/pr2/reviews/B-round1.md`,
verdict first; each finding names a real failure at file:line.
