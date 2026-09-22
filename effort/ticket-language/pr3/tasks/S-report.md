# Task S — migration 006

Tip `2ab38d70` on `schema/rename`, four commits off `d3a66d0f`. Files: new
`migrations/006-rename.ts`, `migrations/index.ts`, `test/postgres/migration.test.ts`,
one sentence of `schema/README.md` (below).

**The guard's arms: none.** Every check 006 narrows is narrowed onto the image of
a rewrite of its own column, and the rewrite is total — the roster being replaced
is exactly the domain of the map — so no row can reach a new check at a spelling
it refuses, and a guard arm would be a control with no row it could ever find.
The header states that where 005's states its guard. What the shape needs
instead is the opposite ordering: the old check refuses the new spelling, so each
relation drops its checks, is rewritten, and takes them back at the new names;
nothing sees the relation unrostered because the drop holds its exclusive lock.

**Touched.** Rewritten: `ticket_projection.phase/.reason/.resume_at`,
`native_action.reason` (all rows, settled `DependencyRevoked` arm kept),
`project_continuation.expected_phase`. Restated: the three `ticket_projection`
checks, `native_action_reason_check`, `project_continuation_expected_phase_check`.
Replaced: `decision_event_is_valid` (tag, `out`, blocked `reason`, all both ways),
`public_ticket_command_is_valid` (refuses the release at both tags),
`ticket_command_is_valid` and `submit_finalization_result` (roster and binding arm
at both spellings), `request_finalization_approval` (`bound.phase` at
`'Finalization'`). Index `journal_entry_release_ticket` recreated over both tags.
`execution_blocked_reason_is_known` untouched. A catalogue query on a migrated
server, not a grep, is what closes that list: six CHECKs and five functions name a
renamed literal, and the sixth CHECK is the blocked reason's.

**What GOAL.md got wrong.** It puts the `bound.phase` pairing in
`submit_finalization_result`, which reads no phase — `request_finalization_approval`
does. It asks that pairing to admit `'Finalizing'` too, which is now dead code, so
it pairs with `'Finalization'` alone. And `submit_task_completion` still builds its
`ExecutionBlocked` event out of `execution.blocked_reason`: the five walls are what
the boundary writes **next**, not only history, so **B must collapse a wall-named
reason on the read side** or the decider gets a value the renamed `Reason` lacks.
Out of scope by one sentence: `schema/README.md` said the public grammar keeps
`ReleaseTicket` out, which 006 made a half-truth; it names both spellings now.

**Render-diff.** `render.mjs` main vs branch: migrations 1–5 render byte-identical,
`diff` empty; the branch adds only `-- migration 6`. No landed migration edited.

**Gates on the tip.** check-figures 0, check-comments 0, check-paths 0,
check-source --static 0, check-duplication 0, check-queries 0.
check-postgres is red and does not return, by construction: the domain here is
unrenamed, so every suite that projects a ticket writes `'Working'` into a column
whose check now holds `'Work'`. 241 cases failed and every one is SQLSTATE 23514 on
`ticket_projection_phase_is_known` or `_reason_is_known` — no other class appeared.
Two suites (`nativeReads`, `readiness`) report all their cases and then leave the
process alive, so the gate's `wait` never returns; re-run alone, their failures are
those same two constraints. `migration.test.ts` alone is 55/55, including 003's
resume case, whose row carried a phase this migration renames.

**Red-proof.** Eighteen mutations of 006 — an arm dropped from either reason map, a
phase or resume arm, each restated check left at its old roster, the settled
`DependencyRevoked` arm removed, the index back to one tag, each of the five
functions back to one spelling, the approval door back to `'Finalizing'` — all go red.
