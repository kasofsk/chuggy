# B-fix1 (PR 2): the three findings of B round 1, and the dead derivation

Worktree `~/claude/chuggy-wt/three-deletions-review-b`, branch
`model/three-deletions-fix-b` from b55c95a4. Commit on top; do not
rebase; do not touch `ui/`. Read `.chug/tasks/review-change.md`, then
`reviews/B-round1.md` (findings 1–3 and the notes) and `tasks/B-report.md`
under `~/claude/chuggy-effort/ticket-language/pr2/`.

1. **`revokedDependencies` is non-empty only for a Pending ticket.** Narrow
   the read (`src/adapters/postgres/nativeReads.ts` ~408, ~452, ~512) so a
   ticket in any other phase answers `[]`; the contract comment at
   `src/contract/responses.ts` ~223 and the one at
   `src/interpreter/nativeWeb.ts` ~268 then say what the read does. Test:
   a stranded Pending ticket lists its Revoked dep; the same ticket after
   its own revoke lists nothing; a Done ticket with a Revoked dep lists
   nothing. Red-proof by dropping the phase filter.
2. **Ascending order is pinned.** A fixture with two Revoked dependencies
   seeded in descending id order and one Working one; the detail read and
   both page reads answer `[lower, higher]`. Red-proof by reversing the
   `ORDER BY`.
3. **The `as const` fixtures.** `test/interpreter/leadPolicyHost.test.ts`
   ~67 and `test/interpreter/selector.test.ts` ~461 and ~2527 lose
   `finalizer`/`combinator`. Then grep line-joined across `src/` and `test/`
   for every deleted name (NoFinalizer, ManagedFinalizer, Finalizer,
   finalizer:, AnyPass, UnanimousPass, combinator, DependencyRevoked,
   cascade) and fix what is left outside `ui/`.
4. **The dead domain derivation.** `src/domain/derived.ts` `revokedDependencies`
   has no caller: the read has no core and B derived it from the projection.
   Delete the function and its test; if anything in `src/domain` or the
   conformance suites cites it, fix the citation. Say in the report that
   GOAL's "pure derivation in src/domain" is superseded by the projection
   read and why.
5. State in the report, as a decision, that a repository's landing default
   may now be `None` (it follows from None being a landing) — no code
   change unless the wire's per-repository PUT refuses it for a reason
   worth keeping.

Gates: `check-postgres`, `check-queries`, `check-conformance`,
`check-boundaries`, `check-comments`, `check-figures`, `check-paths`,
`node --test` on touched suites; `check-source` red only on C's six
console files. Commits end
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Report to
`tasks/B-fix1-report.md` with the mutation each test went red under.
