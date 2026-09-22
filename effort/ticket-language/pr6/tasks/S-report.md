# Task S — migration 009, the work fan-out leaves the schema

Tip `2679ec30` on `schema/work-fanout-goes`, two commits off `0f94fe6b`, not pushed. New `migrations/009-work-fanout.ts`; edited `migrations/index.ts` and `test/postgres/migration.test.ts`. `deploy/rig/wipe-tickets.sql` needed nothing (it already truncates `dispatch_candidate`, and no relation leaves); `schema/README.md` names neither the relation nor the field.

## 009's statements, in order

1. **The guard**, 008's `DO` block byte-for-byte (`008-escalation-sum.ts:69-75`): raises if any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`. The header argues it in this migration's terms — the field is absent rather than optional, so no stored release validates under this image.
2. **`dispatch_candidate`**, one ALTER (`009-work-fanout.ts:49-52`): `DROP CONSTRAINT dispatch_candidate_check`, `DROP COLUMN work_fanout`, then the same constraint again over the ticket and the version alone. The restatement is load-bearing: I probed the server, and dropping a column silently drops the whole multi-column CHECK, so the two floors would have left with the width and nothing would have said so.
3. **`decision_event_is_valid` replaced whole** (`:53-108`): the `CreateTicket` arm's `NOT command_integer(value->'workFanout')` becomes `value ? 'workFanout'` — a payload that *names* the field is refused, not ignored. That is past 005's precedent (it let deleted keys fall out of the validator, because entries carrying them were still in the journal), and the header argues it: behind the wipe the only writer that can name the field is an image of the earlier vintage pointed at a migrated database, and that means a width this machine would spend as one task.

**Grants: none restated, and that is a finding of its own.** `dispatch_candidate` is granted by table, not by column (`baseline/privileges.ts:323-324`), so the column leaving takes no privilege with it; and `decision_event_is_valid(jsonb)` keeps its signature, so `CREATE OR REPLACE` preserves both its owner and the `REVOKE ALL … FROM PUBLIC` at `baseline/privileges.ts:50`. A case pins both rather than leaving that to the reader.

**Nothing else in the schema carried it.** Grepped case-insensitively across `schema/`: the only column is `baseline/relations.ts:115` (its CHECK at `:124`), and the only function arm is the validator's (`baseline/functions.ts:817`, carried forward by 004, 005, 006, 007, 008). No index, no FK, no PK touches it.

## Render-diff

`render.mjs` (the brief's, at `scratch/B-fix0/render.mjs`) run against `~/claude/chuggy` at `0f94fe6b` and against the worktree: the only difference is the 69 lines migration 9 appends. 001–008 render identically.

## Tests and red-proofs

Five new cases in `test/postgres/migration.test.ts` (`:3494-3653`): the ledger row; the guard refusing and naming the wipe with `work_fanout` left standing and the ledger stopped at 8; the candidate published with no width and still refusing a ticket or a version below its floor; the boundary admitting `CreateTicket{ticket,deps,prog}` and refusing the same payload with `workFanout` at a number and at `null`; the validator still owned by `chuggy_boundary_owner` with `chuggy_api`, `chuggy_ticket_service` and `public` all denied EXECUTE.

Nine single mutations, each run against the case that owns it — all RED, no survivors (`scratchpad/redproof.py`): the guard deleted; the guard's message stripped of the remedy; `DROP COLUMN` removed; the CHECK dropped without being written again; the `value ? 'workFanout'` line removed; 008's `NOT command_integer(…)` put back in its place; the ledger name shortened; a `GRANT EXECUTE … TO chuggy_api` added; an `ALTER FUNCTION … OWNER TO chuggy_api` added.

One legacy case moved: "the boundary admits a block that names only its ticket…" now runs through `installationAt(subject, migration008.version)` (`:3370`). Its fixture's release tag carries a fan-out, which is 008's vocabulary — the PR 5 precedent for a case asserting an earlier migration's words.

`migration.test.ts` whole on the tip: **78 pass, 0 fail**.

## Gates on the tip

`check-figures` 0, `check-comments` 0, `check-paths` 0, `check-duplication` 0, `check-source --static` 0 (five stages clean).

`check-queries` **1**, two queries, both B's and both the same column: `src/adapters/postgres/decision.ts:237` (the dispatch-view insert) and `src/adapters/postgres/dispatchViews.ts:112` (the read). `selector.ts:156`'s `workFanout` is a zod field, not a tagged query, so the gate cannot see it — B's too.

`check-postgres` **1**: 310 red cases across twenty suites — `scheduler`, `schedulerStore`, `runEvidence`, `authoring`, `schedulerRace`, `journal`, `workerPlane`, `workerPool`, `ticketProjection`, `ticketInstants`, `operationalReads`, `schedulerContext`, `projectChange`, `isolation`, `finalizerClosure`, `evaluationReports`, `workerCatalog`, `restore`, `nativeActionAdmits`, `crash`. Every one of the 312 errors is the same `column "work_fanout" … does not exist` raised from `replaceDispatchView` (`decision.ts:235`), so the whole set is one line of B's. The gate terminated on its own; PR 5's hang did not recur.

## What B must know

- The column is gone and the relation's CHECK now covers the ticket and the version only; drop `work_fanout` from the insert at `decision.ts:237` and from the select and row type at `dispatchViews.ts:40,65,112`, and `workFanout` from `selector.ts:156`.
- The journalled payload is `{"type":"CreateTicket","value":{"ticket":N,"deps":[…],"prog":[…]}}`, and a payload still naming `workFanout` is now **refused**, not ignored — so once the dispatch-view insert is fixed, a second wave of reds will surface from fixtures that carry the field in a literal event: `journal.test.ts:229`, `digest.test.ts:60`, `readiness.test.ts:245`, `leadDecision.test.ts:153,163`, `leadDurable.test.ts:1275`.
- `test/postgres/migration.test.ts:1905` inserts `work_fanout` deliberately, at the schema 004 left, and must keep doing so.

## What GOAL.md got wrong

- "`ticket_projection`/`draft_revision`/whatever column carries it" — neither does. One column carries it, `dispatch_candidate.work_fanout`.
- "the `command_integer(value->'workFanout')` arms in the draft/admit functions" (and the brief's `request_*`/`submit_*` and dispatch-view functions) — there are none. `decision_event_is_valid` is the only function in the schema that ever named the field, and `dispatch_candidate` is written and read by TypeScript rather than by any SQL function.
- "`N_TASKS`/`workFanoutChoices` if nothing else needs them": `workFanoutChoices` goes, but **`N_TASKS` must stay**. It bounds an evaluation stage's fan-out (`domain.qnt:96,112,1014`, `config.ts:46,53,67`) and it is stored, as `nTasks`, in `deployment_authoring_policy.domain_configuration` (`004-no-accounts.ts:160`). Dropping it from `Config` would have made 009 rewrite that JSON too, and it does not.
- Commit attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief names — this ran on Opus, as PR 4's and PR 5's S did.
