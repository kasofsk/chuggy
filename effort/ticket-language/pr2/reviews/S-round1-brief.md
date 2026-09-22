# Review: PR 2 Task S round 1 (migration 005)

Fresh reviewer; you did not author the change. Work in
`~/claude/chuggy-wt/three-deletions-review-s`, detached at f78a96de
(`node_modules` linked, Docker running). Read `.chug/tasks/review-change.md`
first; verdicts APPROVE / CHANGES / ESCALATE. Commit nothing; revert scratch
with `git checkout -- .`. Then read `GOAL.md` and `tasks/S.md` in
`~/claude/chuggy-effort/ticket-language/pr2/`, and `tasks/S-report.md` as
the author's claim. PR 1's `../reviews/S-round1.md` shows the bar.

Scope: `git diff 617675bb..f78a96de` — two commits, all under
`src/adapters/postgres/schema/migrations/005-three-deletions.ts`,
`test/postgres/migration.test.ts` and three lines of 004's tests.

Check explicitly, on a real server:
- **Guard arms**, one at a time, each with a seeded row: ticket_projection at
  DependencyRevoked; an Open native_action at it (and a Resolved one NOT
  refusing); journal ReleaseTicket with finalizer NoFinalizer; a prog stage
  at AnyPass (jsonb containment: can a stage carrying `combinator: AnyPass`
  inside a nested value evade it, or a non-object element crash it?);
  ExecutionBlocked at DependencyRevoked; a ticket-revoked record with two
  transitions (and one with exactly one NOT refusing; a record with no
  transitions key not crashing). Message names each relation; ledger stays
  at 4 on refusal.
- **native_action CHECK** settled arm: a Resolved and a Withdrawn row at the
  literal survive; an Open one is refused; a new Open row at it is refused
  by the CHECK, not only by the guard.
- **program rewrite**: derive the encoder's key order from
  `src/interpreter/dispatchView.ts` and compare byte-for-byte with what the
  migration renders for a two-stage program; a program with one stage; an
  empty program.
- **decision_event_is_valid**: absent finalizer accepted, ManagedFinalizer
  accepted, NoFinalizer refused; same for combinator; a ReleaseTicket with
  prog element lacking `fanout` still refused.
- **draft functions**: the replaced `create_draft`/`revise_draft` bodies
  differ from the baseline only by the removed arm (diff them yourself);
  the NULL→'None' rewrite runs after the widening; the derivation that NULL
  meant only the NoFinalizer arm — verify in the baseline bodies yourself,
  including `revise_draft`'s ON CONFLICT path.
- **The two widened CHECKs** are the baseline text plus 'None' and nothing
  else; they need no guard (widening) — confirm the header says so and
  that no other CHECK or function in the baseline enumerates the landing
  modes (grep `PullRequestMerge` across the baseline).
- Render diff main vs branch additions-only (the author's tool is
  `~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`).
- Every comment in 005 read against the SQL beside it; no quantity a reader
  must trust; `check-figures`, `check-comments`, `check-paths`.
- Gates: `check-postgres` and `check-queries` are expected red ONLY on
  `decision.ts`, `dispatchViews.ts`, `authoring.test.ts` and the
  `nativeReads.test.ts` hang (B's files). Confirm no other red.

Write `~/claude/chuggy-effort/ticket-language/pr2/reviews/S-round1.md`,
verdict first; each finding names a real failure at file:line.
