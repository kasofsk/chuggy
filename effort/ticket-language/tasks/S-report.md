# Task S report — migration 004 retires the accounts from the schema

Branch `schema/no-accounts` in `~/claude/chuggy-wt/no-accounts-schema`, one
commit `cf708286` ("the schema stops holding the accounts") on top of main
`81e8093a`. Not pushed.

Files: `src/adapters/postgres/schema/migrations/004-no-accounts.ts` (new),
`src/adapters/postgres/schema/migrations/index.ts`,
`test/postgres/migration.test.ts`. No other TypeScript touched; the landed
baseline and 002/003 are untouched.

## What 004 does, statement by statement

1. **Guard** (`DO $$ … RAISE EXCEPTION 'account rows remain in %' …`), first
   statement. Names `ticket_projection` and `native_action` when a row's
   `reason` is `GasExhausted` or `FinalizationBudgetExhausted`, and
   `journal_entry` when a row's stored record says a step reached a removed
   wall.
2. `CREATE OR REPLACE FUNCTION public.decision_event_is_valid` — body copied
   whole from baseline `functions.ts:777-846`, with only these removed: the
   four `ReleaseTicket` clauses reading `reworkPolicy` and `resumePricing`, the
   whole `finalizationPricing` `IF` block, and the two literals from the
   `ExecutionBlocked` reason list. Nothing else changed — a reviewer diffing
   against baseline lines 777-846 should see exactly those deletions.
3. `ALTER TABLE public.ticket_projection` — drops
   `ticket_projection_accounts_are_not_negative`,
   `ticket_projection_accounts_are_whole`, the columns `gas_left`,
   `rework_left`, `finalization_left`, and drop-then-adds
   `ticket_projection_reason_is_known` without the two literals.
4. `ALTER TABLE public.native_action` — drop-then-adds
   `native_action_reason_check` without the two literals.
5. `ALTER TABLE public.dispatch_candidate` — drops `rework_policy`,
   `finalization_pricing`, `resume_pricing`.
6. `UPDATE public.deployment_authoring_policy` — rewrites the singleton row's
   `domain_configuration`.

Both narrowed reason lists were taken from the **current** schema: 003 does not
touch either constraint (it narrows `ticket_projection_phase_is_known` and
`ticket_projection_resume_is_known` only), so baseline `relations.ts:658` and
`relations.ts:1174` are the live definitions. Likewise `decision_event_is_valid`
is still the baseline body — 003 replaced `ticket_command_is_valid` and
`public_ticket_command_is_valid`, which call it, not it.

## Brief item 7 — everything else naming the dropped columns

`grep -n 'gas_left\|rework_left\|finalization_left\|rework_policy\|finalization_pricing\|resume_pricing'`
over `baseline/*.ts`, `002-worker-pool.ts` and `003-no-handoff.ts` finds only:

- `baseline/relations.ts:117-119` — the three `dispatch_candidate` columns.
- `baseline/relations.ts:1166-1170` — the three `ticket_projection` columns and
  the two account CHECKs.
- `baseline/privileges.ts:809-814` — the six column grants, which PostgreSQL
  drops with the columns. Nothing else in `privileges.ts` names them
  (`dispatch_candidate`'s grants at 323-326 are table-wide).

**No function, view, trigger or index reads any of them.** The only two
functions mentioning `ticket_projection` at all are `append_project_change`
(reads `phase`, already replaced by 003) and `request_finalization_approval`
(reads `phase`); neither names a dropped column, so neither is replaced here.
A camelCase sweep (`reworkPolicy|finalizationPricing|resumePricing|gasLeft|
reworkLeft|finalizationLeft`) finds only `functions.ts:818-828`, which is the
release admit replaced in statement 2.

## Decisions I made, as a principal engineer

Three departures from the brief's letter. All three are in the commit and in
the migration's header.

**1. The authoring-policy rewrite does not use `jsonb - 'key'` (brief item 6).**
`postgresDomainConfigurationPrecondition`
(`src/adapters/postgres/domainConfiguration.ts:29`) compares the stored row to
`JSON.stringify(domain)` **as text** (`domain_configuration IS NOT DISTINCT FROM
${encoded}`). `jsonb` has no key order and renders with spaces, so
`(domain_configuration::jsonb - 'reworkPolicy' - 'gas' - 'finalizationPricing')::text`
yields `{"nTasks": 1, "nTickets": 2, "maxStages": 1}` — which no image will ever
match, and the ticket service would then refuse to start on the rig after the
rollout rather than migrate. So 004 writes the retained keys back in the order
the domain configuration declares them:

```sql
SET domain_configuration = format('{"nTickets":%s,"nTasks":%s,"maxStages":%s}',
      domain_configuration::jsonb->>'nTickets',
      domain_configuration::jsonb->>'nTasks',
      domain_configuration::jsonb->>'maxStages')
```

This is mutation-proved: swapping it for the `jsonb - 'key'` form turns the
policy test red.

**The underlying fragility is not mine to fix here.** A durable singleton
compared to an image's own `JSON.stringify` output as text means any future
key-order change in `Config` silently bricks startup. The honest fix is for
that precondition to compare `::jsonb IS NOT DISTINCT FROM ${encoded}::jsonb`,
which is `src/adapters/postgres/domainConfiguration.ts` and therefore **Task
B's**. If B makes that change, 004's `format(…)` can become the plain `jsonb -`
form. Flagging it rather than reaching outside "schema only".

**2. The journal guard also reads the blocked event's reason, not only the
record's label.** The brief asked for the two labels. I added a second field
test on the same row:
`(…)->'event'->'value'->>'reason' IN ('GasExhausted','FinalizationBudgetExhausted')`.
Reason: the guard's stated purpose is that a history the machine cannot replay
must not be migrated over, and after Task A a journal row carrying
`ExecutionBlocked{reason:GasExhausted}` fails to *decode* — the Reason union
loses the literal — so it cannot replay either, and its record's label is
`ticket-escalated execution_blocked`, which the label test does not see. Both
tests are field matches, not substring matches, so the brief's actual
constraint ("match on the label, not a substring of the whole row") holds.

**3. The cast stands behind `IS JSON OBJECT`.** `journal_entry.entry` is `text`
with no JSON constraint, and the baseline's own
`journal_entry_release_ticket` index guards its cast the same way
(`baseline/constraints.ts:325-329`). A `CASE` is used rather than `AND` because
`AND` does not guarantee evaluation order, so a non-document row would be a
cast failure instead of a clean refusal.

**4. Commit attribution.** The brief asked for
`Co-Authored-By: Claude Fable 5.1`. I am Opus 5 (1M context) and signed as
that, per the session's attribution reminder; signing as a model that did not
write the change would be a false statement in the permanent record. Say the
word if the effort wants the line normalised.

## Tests

Added to `test/postgres/migration.test.ts`, following the 003 block's shape.
Six cases, all passing:

- `a fresh install records the accounts leaving and keeps none of their columns`
  — version 4 applied, ledger row `{4, "the accounts leave the schema"}`, and an
  `information_schema.columns` query over the six dropped names **plus** one
  retained name per table (`ticket_projection.reason`,
  `dispatch_candidate.finalizer`) returning exactly the two retained ones. The
  retained names are there so the query cannot pass by looking at nothing.
- `every narrowed reason check refuses the literals the accounts left it` —
  four inserts: both removed literals against **both** constraints, each
  asserted by constraint name. A narrowing that dropped only one literal is a
  red.
- `the release the boundary admits carries no pricing, and no blocked reason
  names an account` — `decision_event_is_valid` admits a `ReleaseTicket`
  carrying no `reworkPolicy`/`finalizationPricing`/`resumePricing`, admits
  `ExecutionBlocked{WorkFailed}`, and refuses `ExecutionBlocked` under both
  removed reasons.
- `a ticket parked at an account wall refuses the migration untouched` — two
  relations (`ticket_projection`, `native_action`), each asserted to be named
  in the exception and to leave the ledger at 3.
- `a journal that names an account wall refuses the migration untouched` — two
  entries, one carrying the wall in its record label and one carrying it in an
  `ExecutionBlocked` event's reason; ledger stays at 3 for each.
- `the authoring policy loses the keys the accounts configured` — a row written
  as an image with the accounts wrote it, asserted to become
  `{"nTickets":2,"nTasks":1,"maxStages":1}` exactly, key order included.

As the brief notes, `workerPlanePostgres.test.ts`'s definition matcher cannot
see `CREATE OR REPLACE` bodies; nothing here relies on it — the replaced
`decision_event_is_valid` is proved by calling it.

### Red-proof (every term of the migration mutated one at a time)

```
journal label arm dropped:                        RED (good)
journal event-reason arm dropped:                 RED (good)
ticket_projection guard arm dropped:              RED (good)
native_action guard arm dropped:                  RED (good)
projection check keeps GasExhausted:              RED (good)
action check keeps FinalizationBudgetExhausted:   RED (good)
gas_left not dropped:                             RED (good)
rework_policy not dropped:                        RED (good)
policy rewritten through jsonb instead of format: RED (good)
blocked reason list keeps GasExhausted:           RED (good)
release admit still requires reworkPolicy:        RED (good)
```

Script at `~/claude/chuggy-effort/ticket-language/scratch/S/` (`mutate.py` was
run from the scratchpad; the mutations are listed above verbatim).

## Gate results

Prettier clean, `tsc --noEmit` clean, `eslint` clean on the touched files,
pre-commit hook `clean (2s)`.

### `.chug/tasks/check-queries.sh` — **exit 1**, all findings Task B's

Log: `~/claude/chuggy-effort/ticket-language/scratch/S/check-queries.log`.
Verbatim:

```
check-queries: reusing chuggy-check-postgres on port 55432

/home/geoff/claude/chuggy-wt/no-accounts-schema/src/adapters/postgres/decision.ts
  204:9   error  Invalid Query: column "gas_left" of relation "ticket_projection" does not exist        @ts-safeql/check-sql
  242:66  error  Invalid Query: column "rework_policy" of relation "dispatch_candidate" does not exist  @ts-safeql/check-sql

/home/geoff/claude/chuggy-wt/no-accounts-schema/src/adapters/postgres/dispatchViews.ts
  139:15  error  Invalid Query: column d.rework_policy does not exist  @ts-safeql/check-sql

/home/geoff/claude/chuggy-wt/no-accounts-schema/src/adapters/postgres/nativeReads.ts
  420:62  error  Invalid Query: column t.gas_left does not exist  @ts-safeql/check-sql
  451:60  error  Invalid Query: column t.gas_left does not exist  @ts-safeql/check-sql
  503:64  error  Invalid Query: column t.gas_left does not exist  @ts-safeql/check-sql

✖ 6 problems (6 errors, 0 warnings)

check-queries: FAILED — a query or a row type disagrees with postgres:18-alpine
```

Exactly the three files the brief predicted. Not fixed here. Note for Task B:
`nativeReads.ts` also reads `d.domain_configuration::jsonb->>'gas' AS gas_max`
at lines 425, 456 and 508 — SafeQL does not flag that one because the key is
gone from the JSON rather than from a column, so it will start returning NULL
silently after 004 instead of erroring.

### `.chug/tasks/check-postgres.sh` — **exit 1**, 308 failing cases, all Task B's

Log: `~/claude/chuggy-effort/ticket-language/scratch/S/check-postgres.log`.
Final line:

```
check-postgres: FAILED — a worker went red against postgres:18-alpine
```

**This gate cannot reach 0 on this branch alone, and that is structural, not a
defect in 004.** The schema branch removes columns the adapters still write and
read, which is precisely why GOAL.md says one release carries both. Every one
of the 308 distinct failures resolves to one of three causes:

- 304 × `error: column "gas_left" of relation "ticket_projection" does not
  exist` — all raised inside `src/adapters/postgres/decision.ts:201`
  (`decisionProject`), reached through `projectDecision.ts` / `pool.ts`. One
  write site, 304 suites that drive it.
- 5 × `error: column t.gas_left does not exist` — `src/adapters/postgres/
  nativeReads.ts`.
- 1 × `error: new row for relation "ticket_projection" violates check
  constraint "ticket_projection_reason_is_known"` — a **test fixture**,
  `test/postgres/nativeReads.test.ts:110` (`seedFilterProjection`), seeding
  `reason = 'GasExhausted'`. That is the narrowed check doing its job.

Failing suites, by count: `scheduler` 44, `schedulerStore` 26, `runEvidence`
21, `authoring` 19, `schedulerRace` 18, `journal` 14, `ticketProjection` 12,
`workerPlane` 10, `workerPool` 8, `ticketInstants`/`operationalReads`/`i5` 6
each, `schedulerContext`/`nativeReads` 5, `projectChange`/`isolation` 4,
`migration` 1, and single figures elsewhere.

**One failure is inside `migration.test.ts` and is Task B's too:** `the
baseline's index is what answers every read of a ticket's release` (line 353)
drives `postgresNativeReads`, whose query still selects `t.gas_left`. It needs
no change of its own — it will go green when B's adapter does. All six of the
new 004 cases pass in the full gate run and standalone.

Task B will also need to update the fixtures that seed the removed vocabulary
(`test/postgres/nativeReads.test.ts:110` at least) and the suites that assert
the accounts on the wire, e.g. `ticketProjection.test.ts`'s `the public read
serves the resume point and the accounts the row holds`, `a resume clears the
point it re-entered at, pays for itself and refills`, `a row written before the
accounts existed serves none of them`, `a budgeted account at zero is served,
and an unbudgeted one is absent`, `the projection refuses a resume, a negative
account and a half-written pair`, and `a park offers the resume only while the
ticket can pay for it`.

## Render-diff

Both renders and the diff are under
`~/claude/chuggy-effort/ticket-language/scratch/S/`:

- `render.mjs` — imports `migrations` from a given worktree's
  `schema/migrations/index.ts` and prints every migration's version, name and
  statements.
- `render-main.txt` — from `/home/geoff/claude/chuggy` at main `81e8093a`,
  7592 lines.
- `render-branch.txt` — from the branch, 7699 lines.
- `render-diff.txt` — the whole diff:

```
7592a7593,7699
> === 4 the accounts leave the schema
…
```

107 added lines, **0 removed or changed lines**. The only difference is
migration 004.

## Unsure / left for the reviewer

- The `format(…)` authoring-policy rewrite hardcodes the three retained keys
  and their order. If Task A reorders `domainConfigurationSchema`'s shape, this
  statement and its test both need to follow. The test pins the exact string,
  so a reorder is a red rather than a silent rig breakage — but it is a
  coupling worth knowing about, and B making the precondition compare `jsonb`
  would dissolve it.
- The guard does not look at `draft_revision.authoring` or
  `dispatch_candidate.configuration_canonical`, both of which can carry the
  authored pricing as stored text. Those are history and authored input rather
  than relations whose checks are narrowed here, and the brief did not name
  them; if a stale draft carrying `reworkPolicy` must be refused at release
  after this, that belongs to the release path (Task B), not to a schema guard.
- `check-postgres` and `check-queries` both exit 1 for the same structural
  reason. Whoever integrates S into the code branch should re-run both there;
  that combined run is the one that has to be clean, and it is the first place
  the brief's "both exit 0" can actually be met.
