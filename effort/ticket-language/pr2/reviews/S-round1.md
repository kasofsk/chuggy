# Review: schema/three-deletions round 1 (migration 005)

**APPROVE** — every guard arm driven one at a time against a real PostgreSQL 18
on a container of its own, each narrowed and widened CHECK probed after a full
migrate, the four replaced function bodies diffed mechanically against the
bodies they replace, the program rewrite derived from the encoder rather than
from the test, and all six gates run on the branch with every red attributed
outside `migrations/`.

I read `.chug/tasks/review-change.md` in the worktree, `GOAL.md`, `tasks/S.md`,
PR 1's `../reviews/S-round1.md` and `ledger.md`, the whole of
`005-three-deletions.ts`, the `index.ts` registration, the 565 changed lines of
`test/postgres/migration.test.ts`, and the files 005 reaches into:
`baseline/relations.ts`, `baseline/functions.ts`, `baseline/constraints.ts`,
`baseline/privileges.ts`, `004-no-accounts.ts`, `003-no-handoff.ts`,
`src/interpreter/dispatchView.ts`, `src/generated/model-api.ts`,
`src/interpreter/ticketBrief.ts`, `src/contract/rosters.ts`,
`src/interpreter/repositoryBinding.ts`, `src/adapters/postgres/decision.ts`,
`src/adapters/postgres/nativeReads.ts`, `src/adapters/postgres/readiness.ts`,
`src/adapters/postgres/finalizer.ts`, `src/adapters/postgres/journal.ts` and
`src/adapters/postgres/runtimeSchema.ts`.

## Findings

None. Nothing I could reduce to a file, a line and an input that goes wrong.

## What I verified rather than took on trust

**Every guard arm fires on its own row and on nothing else.** I ran statement 0
alone against a v4 install, seeding 26 shapes one at a time inside a
transaction. Refused, each naming exactly the relation it should: a
`ticket_projection` row at `DependencyRevoked`; an Open `native_action` at it; a
`ReleaseTicket` at `finalizer = 'NoFinalizer'`; a stage at
`combinator = 'AnyPass'` in first position, in second position, and carrying
extra keys beside it; an `ExecutionBlocked` at `DependencyRevoked`; a
`ticket-revoked` record with two transitions. Admitted, each the near miss of
one of those: a projection at `WorkFailed`, a Withdrawn action at the removed
reason, a release at both surviving spellings, a block at `WorkFailed`, a
revoke transitioning one ticket.

**The jsonb containment neither over-reaches nor raises.** The cases the brief
names: a stage carrying `{"inner":{"combinator":"AnyPass"}}` is admitted —
`@>` is not recursive past the array's own elements, so a nested combinator is
not a stage's combinator and admitting it is right. `prog` holding non-object
elements (`[1,"AnyPass",null,[{"combinator":"AnyPass"}]]`), `prog` as a scalar,
`prog` as an object, `value` as a scalar, `rec` as a scalar, an entry that is
not JSON, a JSON array and a JSON scalar: all evaluate to false or NULL, none
raises. The transition count is the same — a record with no `transitions` key,
one whose `transitions` is an object and one whose `transitions` is a string
are all admitted rather than raising, because `jsonb_array_length` sits behind
`CASE WHEN jsonb_typeof(...) = 'array'`.

**The settled arm admits what it says and only that.** After a full migrate on
a fresh database: a Withdrawn `native_action` at `DependencyRevoked` is
admitted, an Open one is refused by `native_action_reason_check` by name, an
Open one at `WorkFailed` is admitted, and a **Withdrawn** one at `GasExhausted`
is refused — so the arm is `state <> 'Open' AND reason = 'DependencyRevoked'`
rather than a general settled-row escape from the roster. `ticket_projection`
at the removed reason is refused by `ticket_projection_reason_is_known`. The
suite's own settled case (`migration.test.ts:1808`) drives the other direction
through the migration and the row still reads `Resolved`/`DependencyRevoked`.

**The header's argument for that arm is the one that holds.** `native_action.reason`
is selected by nothing in the tree — `nativeReads.ts:510,530` and
`readiness.ts:331` and `finalizer.ts:589` read `action`, `kind`,
`authorizing_seq`, `state` and `resolution` and never `reason` — so a settled
row at the removed reason decodes into nothing. And no new row can reach the
arm through a writer: `decision.ts:402` inserts without `state`, which defaults
`Open`, and the guard refuses an Open one.

**The program rewrite is the encoder's own rendering.** `encodeDispatchProgram`
(`dispatchView.ts:89`) is `value.map(encodeStage)`, `encodeStage`
(`model-api.ts:181`) is `encodeJson`, and `encodeJson` rebuilds an object
through `Object.entries`, so the key order is the `Stage` object's own — after
A that is `fanout` alone. `decision.ts:241` stores `JSON.stringify` of that
into a `text` column, which for one stage is `{"fanout":N}` with no spaces and
a bare integer, and for no stages is `[]`. `format('{"fanout":%s}', stage->>'fanout')`
aggregated `ORDER BY position` over `WITH ORDINALITY`, with `coalesce(…, '')`
between the brackets, is exactly that for both. The suite pins it against the
encoder itself for a two-stage program and an empty one, and both are green.

**`decision_event_is_valid` differs from 004's body in three hunks and nothing
else.** I extracted both statements and diffed them: `DependencyRevoked` leaves
the `ExecutionBlocked` reason list, `value->>'finalizer' NOT IN (…)` becomes
`COALESCE(value->>'finalizer', 'ManagedFinalizer') <> 'ManagedFinalizer'`, and
the same for `combinator`. Driven on the server: absent `finalizer` accepted,
`ManagedFinalizer` accepted, `NoFinalizer` refused; absent `combinator`
accepted, `UnanimousPass` accepted, `AnyPass` refused; `ExecutionBlocked` at
`WorkFailed` accepted and at `DependencyRevoked` refused. A `ReleaseTicket`
whose `prog` element lacks `fanout` is still refused, because the `COALESCE`
sits beside `NOT command_integer(item->'fanout')` in the same condition.

The function is a CHECK on nothing: it is called only by
`public_ticket_command_is_valid` (`003-no-handoff.ts:232`), which is the
admission grammar. So replacing it cannot fail against a stored row, which is
what makes the header's "the line the guard draws over the rows, drawn again
over what the boundary will accept next" the precise statement of it.

**The two draft functions differ from the baseline only by the removed arm.** I
extracted `baseline/functions.ts`'s `create_draft` and `revise_draft` and
diffed each against 005's. Two hunks each: `CREATE FUNCTION x(` becomes
`CREATE OR REPLACE FUNCTION public.x(`, and the
`in_authoring::jsonb->'value'->>'finalizer' = 'NoFinalizer'` arm goes with its
`RAISE`, the `ELSE` branch de-indenting. Nothing else, including
`revise_draft`'s `ON CONFLICT DO UPDATE`, which is outside the arm and
unchanged. `LANGUAGE plpgsql SECURITY DEFINER SET search_path` is re-declared
in both, which it has to be — `CREATE OR REPLACE` resets unstated attributes —
and owner and grants survive a replace, so the baseline's
`OWNER TO chuggy_boundary_owner` and `privileges.ts:48,212`'s
`GRANT … TO chuggy_api` still stand.

**The NULL derivation holds, read off the baseline bodies.** `create_draft`
(`baseline/functions.ts:763`) and `revise_draft` (`:3272`) are the only writers
of `draft_brief` anywhere in `src/` — every other mention is a read, and no
migration touches it. In both, the only assignment to `landing` is
`coalesce(in_finalization_mode, <the binding's landing_mode>, 'Push')`, whose
last argument is a literal, and `project_repository.landing_mode` is
`NOT NULL DEFAULT 'Push'` besides. So the column is null exactly where the
removed arm was taken, and `revise_draft`'s `ON CONFLICT … SET
finalization_mode=EXCLUDED.finalization_mode` writes that null back over an
earlier mode, so a revision reaches it too. The `UPDATE` runs after the
widening, so the value it writes is one the check already admits, and
`draft_brief_finalization_is_whole` and
`draft_brief_finalization_target_needs_a_mode` both pass for `'None'` with a
null target.

**The two widened CHECKs are the baseline text plus one element.**
`relations.ts:164` and `:761` are `ARRAY['Push','PullRequest','PullRequestMerge']`
and 005's are those three in order with `'None'::text` appended; nothing else in
the statement differs. `PullRequestMerge` occurs in five places across
`baseline/` + `002` + `003`: those two roster CHECKs, the
`draft_brief_finalization_is_whole` CHECK and the `landing IN (…)` branch inside
each draft function. The last three enumerate the modes that need a branch
rather than the roster, and `'None'` correctly belongs to neither. They need no
guard arm because a widened check revalidates the same rows and admits strictly
more of them — which is what the header says, and the reason PR 1's B-round1
finding 2 does not apply here: both *narrowed* checks do sit behind a guard arm.

Widening the repository roster as well as the brief's is right rather than
extra: `repositoryBinding.ts:117` resolves a binding's landing mode against
`briefFinalizationModes`, the same list `ticketBrief.ts:241` uses, so one roster
stands behind both columns.

**Nothing else in the schema names the three.** Over `baseline/`, `002` and
`003`: the two reason CHECKs, `dispatch_candidate.finalizer`
(`relations.ts:120`), `decision_event_is_valid` and the two draft functions.
`dispatch_candidate`'s grants are table-level (`privileges.ts:323-324`), so the
dropped column takes nothing with it; no view or materialized view exists; no
`read_*` function names any of the three; the one `journal_entry` index reads
`event->value->ticket`. The only other `finalizer` is `chuggy_finalizer`, a
role, and `'finalizer-v1'`, a task configuration name.

**The header's two borrowed claims check out.** The `IS JSON OBJECT` cast
pattern is `journal_entry_release_ticket` at `baseline/constraints.ts:325-330`,
verbatim. The digest chain is `journal.ts:118`,
`journalChainDigest(partition, previous, row.entry)` over the stored text, so
rewriting an entry's bytes would break it — which is the header's reason for
admitting the legacy keys instead.

**Render diff, main vs branch.** `render.mjs` over `~/claude/chuggy` at
617675bb and over this worktree: **0 removed lines, 201 added**, all of them
migration 5. Baseline and the landed migrations are byte-identical.

## Gates, run on this branch

Against a PostgreSQL 18 container of this review's own (`chuggy-review-s`, port
55461), so nothing shared a server with the worktrees that are running.

| gate | verdict |
|---|---|
| `check-comments` | 0 findings across 905 files |
| `check-figures` | 0 findings across 102 files |
| `check-paths` | 0 findings across 1206 path claims in 1156 files |
| `check-source` | clean, 6 stages, 208 unit suites |
| `check-queries` | exit 1 — two errors, both B's |
| `check-postgres` | exit 1 — 308 red, all B's, plus the hang |

`test/postgres/migration.test.ts` on its own: **47 of 47 green**.

`check-queries` names exactly the two sites the report names and no others:
`src/adapters/postgres/decision.ts:237` and
`src/adapters/postgres/dispatchViews.ts:120`.

`check-postgres` partitions exactly as the brief expects:

- **301** raise `column "finalizer" of relation "dispatch_candidate" does not
  exist`, every one through `decision.ts:234` in `replaceDispatchView`;
- **1** is `isolation.test.ts:114`, an `AssertionError` whose actual value is
  that same message;
- **6** are `authoring.test.ts` cases pinning the arm 005 deletes
  (`:2210`, `:2270`, `:2281`, the `reference to land on` case, `:2334`, `:2386`),
  each expecting `finalization_mode: null` or the
  `a ticket with no finalizer lands nothing` rejection;
- `nativeReads.test.ts` hangs rather than reds. I reproduced it — the suite sat
  four minutes with no output — and killed it so the run could finish. The
  report's attribution is the fixture at `nativeReads.test.ts:413`, which seeds
  a desk task at `reason: "DependencyRevoked"`; both narrowed checks refuse it.

No red is in `migrations/`, and none is of a kind the report does not name.

## Notes

**What I looked at and chose not to flag.**

`005:28` says a settled desk task is one "the wire never reads". `finalizer.ts:589`
does `LEFT JOIN native_action n` with no state filter and selects `n.state` and
`n.resolution` — but it joins on `a.attempt`, and
`native_action_kind_names_its_capability` makes `attempt IS NOT NULL` exactly
when the kind is `FinalizationApproval`, so that join cannot reach a
`TicketEscalation` desk task. The load-bearing half of the sentence — that
`reason` is selected nowhere — is true outright.

The `program` rewrite raises a raw PostgreSQL error rather than the guard's
message if a stored `program` is valid JSON that is not an array. The column is
written only by `replaceDispatchView`, which stringifies an array, and GOAL
records `dispatch_candidate` empty on the rig, so there is no input that gets
there. Not worth a guard arm; worth knowing if one ever appears.

`src/adapters/postgres/schema/README.md:198` says
"`public_ticket_command_is_valid` is the grammar migration 5 wrote". That line
predates this change (f3bb0000) and means the pre-baseline numbering, but the
tree now has a `005-three-deletions.ts` that writes no such grammar, so the
number collides. It is not this change's line and I would not block on it;
someone landing a doc pass should take it.

**One thing to carry to B, beyond what the report already carries.** A stored,
still-undecided `operation` can carry `ExecutionBlocked{reason:
"DependencyRevoked"}` — `public_ticket_command_is_valid` keeps `ReleaseTicket`
off the wire entirely, so the finalizer and the combinator cannot reach the
inbox, but that one reason can. 005 is right not to guard it: the validity
function is the admission grammar rather than a constraint on a relation, so no
stored row can make the migration fail. Whether a command admitted before the
upgrade and decided after it decodes is `decisionSemantics.ts`'s question, and
it belongs beside the stored-journal rules GOAL's "Decision semantics 4"
already sets.

The report's own three relays stand and I agree with each: the `'None'` roster
and this migration must ship in one release, because `asBriefFinalization`
(`ticketBrief.ts:241`) throws `RangeError` for a mode not in
`briefFinalizationModes` and after 005 there are rows at `'None'`; a stored
*draft* naming `AnyPass` is not guarded, on 004's precedent, and reads as
`UnanimousPass`, which is the strict direction on a ticket not yet released;
and the `Claude Opus 5 (1M context)` attribution against the brief's
`Claude Fable 5.1` is the divergence PR 1's S had, which is the effort's to
settle once rather than a finding here.

**Practices invoked.** `comments-describe-the-code`, against the 56-line header
and the test file's doc comments: no comment in the diff refers to the task, the
brief, the coordinator or another task's work, and the header's length is spent
describing the SQL beside it rather than justifying it. `check-comments` and
`check-figures` agree from their side.

**What I did not do.** I did not re-run the author's 28 mutations. The guard
probes above are the stronger form of the same question for the arms — each one
driven alone against a row only it can match — and `check-postgres`,
`check-queries` and the 47-case suite I ran myself. I never edited the tree;
scratch lived outside it and the worktree is clean at f78a96de.
