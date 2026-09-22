# Task S (PR 2): migration 005 — the schema stops admitting the three

Worktree `~/claude/chuggy-wt/three-deletions-schema`, branch
`schema/three-deletions` from main 617675bb. Read
`.chug/tasks/review-change.md`, `GOAL.md` here (especially "Rig facts" and
"Decision semantics 4"), then `src/adapters/postgres/schema/migrations/004-no-accounts.ts`
and `003-no-handoff.ts` as the shapes to repeat, and PR 1's
`../reviews/S-round1.md` and `../reviews/B-round1.md` finding 2 (a narrowed
CHECK must be inside the guard). Never edit a landed migration or the
baseline.

`005-three-deletions.ts`:
- Guard first, one `DO` block naming the relations, refusing: a
  `ticket_projection` row at reason `DependencyRevoked`; an Open
  `native_action` row at that reason; a `journal_entry` whose ReleaseTicket
  value carries `finalizer = 'NoFinalizer'` or any stage with
  `combinator = 'AnyPass'`; a journal row whose record label is
  `ticket-revoked` with more than one transition. Read the fields, not the
  text (004's header says why).
- `native_action`: narrow the reason CHECK to the surviving roster PLUS a
  settled-row arm (`state <> 'Open' AND reason = 'DependencyRevoked'`), and
  state in the header that a settled desk task is a human's recorded
  decision the wire never reads, that the rig holds such rows on its real
  project, and that the arm is history and admits no new row.
- `ticket_projection`: narrow its reason CHECK (no settled arm; the guard
  proved no row).
- `dispatch_candidate`: drop `finalizer`; rewrite `program` JSON to drop
  each stage's `combinator`, rendered in the encoder's key order as 004 did
  for the policy (read `src/interpreter/dispatchView.ts` for the shape).
- `decision_event_is_valid`: ReleaseTicket admits `finalizer` absent or
  `ManagedFinalizer`, each stage admits `combinator` absent or
  `UnanimousPass`; the `ExecutionBlocked` reason set and the projection
  reason set lose `DependencyRevoked`. Header: the journal text is
  digest-chained, so the legacy keys stay admissible rather than rewritten.
- Any other CHECK, function or column that names the three (grep the
  baseline for `DependencyRevoked`, `NoFinalizer`, `AnyPass`, `combinator`,
  `finalizer`; `read_*` functions, indexes, views included).

`test/postgres/migration.test.ts`: each guard arm with a two-arm test (a
row present refuses with the message naming the relation, ledger stays at
4; absent migrates), the program rewrite pinned against the encoder, the
settled-row arm admitting a settled row and refusing an Open one, the
dropped column, and the validity function's two acceptances and two
refusals. Red-proof each and name the mutation. Render-diff main vs branch
(`../scratch/B-fix0/render.mjs` is the tool): additions-only.

Gates: `check-postgres`, `check-queries`, `check-comments`,
`check-figures`, `check-paths`, `check-source` on this branch (all green:
this branch touches nothing the typecheck can see). Commit ending
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Report to
`tasks/S-report.md`.
