# Review: schema/no-accounts round 1

**APPROVE** — migration 004 read against the baseline it replaces, its six new
cases run green, both server gates run on the branch and every red attributed
to an adapter or fixture outside `migrations/`.

I read `.chug/tasks/review-change.md` in the worktree, `GOAL.md`, the whole of
`004-no-accounts.ts`, the `index.ts` registration, the 288 added test lines,
and the files the migration reaches into: `baseline/relations.ts`,
`baseline/functions.ts`, `baseline/privileges.ts`, `003-no-handoff.ts`,
`src/adapters/postgres/domainConfiguration.ts`, `src/adapters/postgres/pool.ts`,
`src/interpreter/domainConfiguration.ts`, `src/roots/ticketService.ts`,
`src/generated/model-api.ts` and `src/domain/deciders.ts`.

## Findings

None. Nothing I could reduce to a file, a line and an input that goes wrong.

## What I verified rather than took on trust

**The function body differs only where it was allowed to.** I extracted the
baseline's `decision_event_is_valid` (`schema/migrations/baseline/functions.ts`,
the `CREATE FUNCTION` at 777) and the migration's statement 2 mechanically and
diffed them. Three hunks: the header (`CREATE FUNCTION` →
`CREATE OR REPLACE FUNCTION public.`), the two reason literals, and the four
`ReleaseTicket` pricing clauses plus the `finalizationPricing` `IF` block.
Nothing else. The `public.` qualification is a strengthening, not a drift —
the baseline creates it unqualified and would follow `search_path`.

**The narrowed reason lists are the live ones.** `GasExhausted` and
`FinalizationBudgetExhausted` appear in exactly three places across
`baseline/` + `002` + `003`: `relations.ts:658`, `relations.ts:1174` and
`functions.ts:808`. All three are narrowed here, and 003 touches neither
constraint. Both new lists match their baseline definitions with those two
literals removed and the other nine in order.

**Nothing else reads the dropped columns.** Over `baseline/`, `002` and `003`
the six names occur only at `relations.ts:117-119`, `relations.ts:1166-1170`
and `privileges.ts:809-814` (column grants, which go with the columns). No
view or materialized view exists anywhere in the schema; `dispatch_candidate`
is named by no function at all; `ticket_projection` is named by two
(`append_project_change`, `request_finalization_approval`) and both read
`phase` only. No test outside `migration.test.ts` asserts a column privilege
on them, so there is no privileges suite to retire the way 003 had to.

**The guard arms are each reachable, and neither test passes on the other's
arm.** I ran the guard's two journal predicates separately against the two
fixture entries: the label arm matches only the label fixture, the reason arm
only the `ExecutionBlocked` fixture. So neither case is passing because the
other clause caught its row — the failure mode the guards-fail-open trap warns
about. I also checked the arms against rows the guard must *not* choke on: a
non-JSON row, a JSON array, and an event whose `value` is a scalar
(`{"type":"Revoke","value":3}`) all evaluate to NULL rather than raising. The
`CASE … IS JSON OBJECT` is doing real work: PostgreSQL only skips the cast
because `entry` is a column reference, and the same expression over a literal
raises at plan time.

**The JSON paths are the ones the writer writes.** `journal_entry.entry` is
`encodeEntry` of `{seq, event, rec}` (`src/generated/model-api.ts:460-476`),
`rec` is `{label, transitions, effects}` (439-452) and `ExecutionBlocked`'s
value is `{ticket, reason}` (305-311). `->'rec'->>'label'` and
`->'event'->'value'->>'reason'` are field reads of exactly those, not
substring matches. The two labels are the only ones a spent account can reach:
`src/domain/deciders.ts` emits `ticket-escalated gas_exhausted` at 345 and 383
and `ticket-escalated finalization_budget_exhausted` at 408, and no other
label is produced from an account wall.

**A refusal cannot leave the schema half-migrated.** `postgresMigrateCompatible`
(`src/adapters/postgres/pool.ts:200-226`) applies every pending migration and
its ledger row inside one `postgresTransaction` under the advisory lock, so the
`RAISE EXCEPTION` rolls back the ledger insert with everything else. The tests'
"ledger stays at 3" assertion is therefore not the whole proof of atomicity,
but it cannot pass while the property fails either.

**The `format()` rendering matches what the image will compare against.**
`postgresDomainConfigurationPrecondition` compares the row to
`JSON.stringify(domain)` as text (`domainConfiguration.ts:20,29`). `domain`
reaches it from `domainConfigurationSchema.parse` via
`src/roots/ticketService.ts:36,128`, and zod builds its output in shape order,
so the encoding is the schema's declaration order with no spaces and bare
integers. With the three keys removed that is `nTickets`, `nTasks`,
`maxStages` — the order statement 6 writes. I confirmed `format('%s', …)` of
`->>` yields the integer unquoted.

**Baseline, 002 and 003 are untouched.** `git diff main...HEAD --stat` is three
files: the new migration, two added lines in `index.ts`, 288 added lines at the
end of `migration.test.ts`. Nothing removed, nothing reordered. That is
stronger than the render-diff and I did not need to re-derive it. The
registration matches what 003's landing commit touched, file for file.

## Gates

`check-comments` 0 findings, `check-figures` 0 findings, `check-source` clean
(6 stages).

`test/postgres/migration.test.ts` on the branch: **33 of 34 pass**. All six new
004 cases pass. The one red is `the baseline's index is what answers every read
of a ticket's release` (line 352), which drives `postgresNativeReads` and dies
on `t.gas_left` — the adapter, not the migration.

`.chug/tasks/check-queries.sh` — exit 1, six errors, all in
`decision.ts`, `dispatchViews.ts` and `nativeReads.ts`. Identical to the
report's log.

`.chug/tasks/check-postgres.sh` — exit 1, 308 failing cases. I attributed
every one:

- 304 `column "gas_left" of relation "ticket_projection" does not exist`,
  raised in `decision.ts:201`
- 5 `column t.gas_left does not exist`, `nativeReads.ts`
- 1 `violates check constraint "ticket_projection_reason_is_known"` —
  the `test/postgres/nativeReads.test.ts:110` fixture seeding `GasExhausted`
- 2 `AssertionError` (`isolation.test.ts:114`,
  `ticketProjection.test.ts:443`), both holding the `gas_left` error as their
  actual value
- 1 `ZodError` — see below

Every one is an adapter or a fixture outside `migrations/`. None is 004's.

## Notes

**The report's "three causes" is three short of complete, and B's list needs
one more suite.** Three of the 308 are not raw pg errors: two AssertionErrors
that carry the `gas_left` error as their actual value, and one ZodError,
`standing_agentic_refusals answers one past its page` at
`test/postgres/leadHttpReads.test.ts:393`. I bisected that one because a Zod
failure with no column name in it is exactly what a real defect would look
like: the suite passes on a v3 database and fails on a v4 one, and applying
004's statements one at a time onto a v3 clone shows statement 3 (the
`ticket_projection` ALTER) is the trigger. The path is
`nativeWeb.ts:1673` → `nativeStandingRefusals` → `nativeReads.ts:503`, which
selects `t.gas_left`; the route answers 500 and the schema parse of the body
fails. So it is the same cause as the other five, but it reaches B as a Zod
error rather than a pg one, and `leadHttpReads.test.ts` belongs on B's list
beside the suites the report names. The conclusion — every red is B's — holds.

Bisecting also reproduced the rollout ordering the report predicts: applied to
a database whose `deployment_authoring_policy` row was written by a
six-key image, statement 6 turns the *whole* suite red, because every app
start then fails the domain-configuration precondition. That is the "one
release carries both" constraint, not a defect, and it is why the combined run
on the code branch is the one that has to be clean.

**The `format()` key-order coupling is real and no test in the tree closes
it.** The author names it, the migration header names it, and I agree with the
decision: `jsonb - 'key'` would write a row no image can match and would brick
startup on the rig, which is a worse failure than a coupling. But
`the authoring policy loses the keys the accounts configured` pins the literal
`{"nTickets":2,"nTasks":1,"maxStages":1}` rather than the relationship that
matters, which is that the migrated row equals `JSON.stringify` of the Config
the image builds. So if Task B reorders `domainConfigurationSchema`'s shape
while removing the three keys, every suite stays green and the rig refuses to
start after the rollout. S cannot express that assertion — the post-A `Config`
does not exist on this branch — so it belongs to whoever integrates: either B
changes the precondition to compare `::jsonb IS NOT DISTINCT FROM ${encoded}::jsonb`
(which dissolves the coupling and lets 004 use the plain `jsonb -` form), or
B's suite asserts the migrated row against the image's own encoding. Naming it
here so it is not lost in a task report.

**Things I looked at and chose not to flag.** The journal guard skips a row
that is not a JSON object, so a corrupt row migrates silently — but such a row
is already refused by the journal load (`journal.ts:298-302`), so there is no
failure it lets through that the actor would not have refused anyway. The
`UPDATE` in statement 6 casts `domain_configuration::jsonb` unguarded, so a
non-JSON singleton fails the migration; that is a refusal inside the
transaction, which is the safe direction. If a key were missing the `format()`
would write syntactically invalid JSON into a column whose only check is
length — but every row of that table is written by the precondition, which
writes all six keys, so there is no input that produces it. The guard does not
look at `draft_revision.authoring` or `dispatch_candidate.configuration_canonical`;
I agree those are authored input rather than a narrowed relation, and a stale
draft carrying `reworkPolicy` is admitted anyway, because both the SQL admit
and the zod decoder ignore keys they do not name.

**Attribution.** The commit signs `Claude Opus 5 (1M context)` where the task
brief asked for `Claude Fable 5.1`. The author's reasoning — that signing as a
model which did not write the change is a false statement in the permanent
record — is right, and this is not a reviewer's call. Flagging it only so the
effort decides deliberately rather than by default.

**Practices invoked.** `fix-the-assumption-not-the-hack` — which is what made
me weigh the `format()` rewrite as a fork rather than read past it. I did not
invoke `domain-modelling`, `layering` or `dependencies`: this change adds no
type, crosses no boundary and takes no dependency.
