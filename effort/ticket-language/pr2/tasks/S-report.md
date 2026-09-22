# Task S (PR 2) — migration 005, report

Branch `schema/three-deletions` in `~/claude/chuggy-wt/three-deletions-schema`,
one commit on main 617675bb:

    e6912751  the schema stops admitting the finalizer choice, the cascade and
              the combinator

Files: `src/adapters/postgres/schema/migrations/005-three-deletions.ts` (new),
two lines in that directory's `index.ts`, and 470 lines in
`test/postgres/migration.test.ts` (three of them changes to two 004 cases —
see *Two 004 cases moved*). Baseline and landed migrations untouched;
`git diff main...HEAD --stat` is those three files, and the render-diff below
is additions only.

## What 005 does

**Guard, first statement, four relations' worth of arms.** It refuses:

- a `ticket_projection` row at `reason = 'DependencyRevoked'`;
- an **Open** `native_action` row at that reason;
- a `journal_entry` whose event value carries `finalizer = 'NoFinalizer'`,
  whose `prog` contains a stage at `combinator = 'AnyPass'`, whose event value
  carries `reason = 'DependencyRevoked'`, or whose record is labelled
  `ticket-revoked` with more than one transition.

The blocked-reason arm is not in the task brief's list but is in GOAL's "Rig
facts" ("journal rows naming NoFinalizer/AnyPass/**DependencyRevoked**"), and
it is needed on its own terms: `decision_event_is_valid` admits
`ExecutionBlocked{reason: DependencyRevoked}` today, so a stored row can carry
it, and after 005 such a row cannot be decoded — the same replay argument 004's
header makes.

Each arm reads fields, never text. `prog` is matched with jsonb containment
(`->'prog' @> '[{"combinator":"AnyPass"}]'`), which is structural, total, and
does not match a nested `combinator`; the transition count is read through a
`CASE` on `jsonb_typeof` so a non-array cannot raise. I drove every predicate
against a non-object entry, an array, a scalar `prog` and an object `prog`:
each yields false or NULL, never an error.

**`native_action`'s narrowed check keeps a settled-row arm** —
`(reason = ANY (<the eight survivors>)) OR (state <> 'Open' AND reason =
'DependencyRevoked')` — and `ticket_projection`'s does not. The header says
why: a settled desk task is a human's recorded decision that no read reaches
(`nativeReads.ts` and `readiness.ts` filter `state='Open'`), the rig holds such
rows on its real project, and the arm admits no new row because every writer
inserts an action Open and the guard refuses an Open one.

**`dispatch_candidate`** loses `finalizer`, and `program` is rewritten with
`format('{"fanout":%s}', …)` aggregated in array order — the key order the
encoder emits, as 004 did for the policy. An empty program renders `[]`.

**`decision_event_is_valid`** is replaced. The `ExecutionBlocked` reason set
loses `DependencyRevoked`; `finalizer` and `combinator` are read through
`COALESCE(…, '<the surviving spelling>')`, so an absent key and the surviving
spelling are admitted and the removed spelling is refused. The header states
that the journal's text is digest-chained, so the legacy keys stay admissible
rather than being rewritten. A mechanical diff of the 004 body against the 005
body is exactly those three hunks and nothing else.

**`create_draft` and `revise_draft`** lose their
`in_authoring->'value'->>'finalizer' = 'NoFinalizer'` arm — the SQL half of
`checkedDraftLanding`, which GOAL retires. A mechanical diff against the
baseline bodies is the `CREATE OR REPLACE FUNCTION public.` header and that
arm's removal (the `ELSE` branch de-indented), nothing else.

Nothing else in the tree names the three. The grep the brief asks for
(`DependencyRevoked`, `NoFinalizer`, `AnyPass`, `combinator`, `finalizer` over
`baseline/`, `002`, `003`, `004`) returns: the two reason CHECKs, the
`dispatch_candidate.finalizer` column, `decision_event_is_valid`, the two draft
functions, and the `chuggy_finalizer` role name, which is a service role and
unrelated. No view or materialized view exists in the schema; no `read_*`
function names any of them; the one index over `journal_entry` reads
`event->value->ticket` only; `dispatch_candidate`'s grants are table-level, so
the dropped column takes nothing with it.

## Tests

Fifteen new cases and helpers in `test/postgres/migration.test.ts`; the whole
file is **45 of 45 green** on this branch.

- **each guard arm, both ways.** One test drives six rows, one per arm, each
  asserting the refusal names the relation and the ledger stays at 4; a second
  drives six near misses (a ticket parked on its own failed work, a settled
  desk task, a release at the surviving spellings, a block at `WorkFailed`, a
  revoke transitioning one ticket, a journal row that is not a document), each
  asserting the migration applies.
- **the settled-row arm**, driven through the migration rather than round it:
  a v4 install holding a desk task settled at the removed reason migrates and
  the row still reads `Resolved`/`DependencyRevoked`; a post-migration insert
  of an Open one is refused by `native_action_reason_check`, and a
  `ticket_projection` row at that reason by its own check.
- **the dropped column**, over `information_schema.columns`.
- **the program rewrite**, pinned against the encoder: the expected text is
  `encodeDispatchProgram`'s own output with the `combinator` key filtered out,
  so on this branch it pins every other key and its order, and once A lands the
  filter is a no-op and the case pins the encoder outright. Two programs — two
  stages and none.
- **the validity function**: two acceptances (the spellings a stored entry
  carries; the keys this machine no longer writes) and two refusals
  (`NoFinalizer`, `AnyPass`), plus `ExecutionBlocked` at `WorkFailed` admitted
  and at `DependencyRevoked` refused.
- **the draft functions**: an authoring still naming `NoFinalizer` no longer
  decides the landing — `create_draft` returns `Created` and the brief lands
  where its repository lands, `revise_draft` returns `Revised` and takes the
  mode it was given.

### Red-proof

Twenty-three mutations of 005, each run against the case it should red, each
reverted (the harness is `…/scratchpad/pr2-S/redproof.py`; the migration file
is byte-identical after). **Every one went red.**

Guard arms — each arm blinded in turn (`ticket_projection`, Open
`native_action`, `NoFinalizer`, `AnyPass`, the blocked reason, and the
transition count raised to `> 2`): six reds, and because disabling one arm alone
reds the refusal test, no row is being caught by a *different* arm.
Guard breadth — each arm widened in turn (any parked reason, any state, any
`finalizer` key, `> 0` transitions): four reds on the near-miss test.
Checks — the settled arm deleted; `DependencyRevoked` put back into each
narrowed roster: three reds.
Column — the drop replaced by a `DROP NOT NULL`: one red.
Program — the combinator kept in the rendered stage; the empty-array fallback
changed: two reds.
Validity — the finalizer test reverted to 004's `NOT IN`; the absent-key
default flipped to the removed spelling; the same two for the combinator; the
blocked reason set widened: five reds.
Draft functions — the `NoFinalizer` arm restored in `create_draft`, then in
`revise_draft`: two reds.

### Render-diff

`node --experimental-strip-types …/scratch/B-fix0/render.mjs` over `main` and
over this worktree: the diff is **additions only** — 0 removed lines, 192
added, all of them migration 5.

## Gates

Run on this branch against a dedicated PostgreSQL container (its own name and
port, removed afterwards, so nothing here shares a server with the other
worktrees that are running).

| gate | verdict |
|---|---|
| `check-comments` | 0 findings across 904 files |
| `check-figures` | 0 findings across 102 files |
| `check-paths` | 0 findings across 1206 path claims in 1155 files |
| `check-source` | clean, 6 stages, 208 unit suites |
| `check-queries` | **exit 1**, 2 errors — both B's |
| `check-postgres` | **exit 1**, 292 red cases + one hung suite — all B's |

**The brief's "all green" does not hold, and could not**: 005 drops a column
and narrows a CHECK that live adapter code and live fixtures still use. Every
red is attributed, and none is in `migrations/`.

`check-queries` names exactly two sites, which are the whole of B's schema
debt:

- `src/adapters/postgres/decision.ts:237` — `replaceDispatchView` still inserts
  `finalizer`.
- `src/adapters/postgres/dispatchViews.ts:120` — the read still selects
  `d.finalizer`.

`check-postgres`, 292 red cases, in three groups and nothing else:

- **285** raise `column "finalizer" of relation "dispatch_candidate" does not
  exist`, every one through `decision.ts:234` (`replaceDispatchView`).
- **1** is `isolation.test.ts:114`, an `AssertionError` whose actual value *is*
  that message — same cause, different wrapper.
- **6** are `test/postgres/authoring.test.ts` cases that pin the draft arm 005
  deletes: "a ticket that runs no finalizer stores no landing and reads back
  with none", "a repository landing by proposal lands nothing on a ticket that
  runs no finalizer", "a ticket that runs no finalizer is refused a brief
  naming a landing", "a reference to land on is not a landing without a way of
  landing", "a ticket that stops running a finalizer drops its landing and
  takes it back", "a released ticket that lands nothing still hands release a
  brief". These stop compiling anyway once A removes `Finalizer`, so they are
  B's either way.

**One suite hangs rather than reds, and B should know why.**
`test/postgres/nativeReads.test.ts` seeds `reason: "DependencyRevoked"` at line
413; the narrowed `ticket_projection` check refuses the insert, and the harness
leaves the connection idle-in-transaction-aborted and never returns, so the
worker sits forever instead of reporting. I attributed it exactly: with that
one literal changed to `WorkFailed` and nothing else, the suite is **14 of 14
green**. I reverted the edit; the worktree is clean.

`nativeActionAdmits.test.ts:189` also asserts a `DependencyRevoked` reason and
`leadDecision.test.ts:154-166` builds candidates at `finalizer: "NoFinalizer"`;
both are inside the 285 already, and both are B's.

## Decisions, and the one thing I did not do

**1. The blocked-reason journal arm is in, though the brief's list omits it.**
Reasons above. If it is unwanted, deleting it and its fixture row is four
lines.

**2. `briefFinalizationModes` gaining `"None"` needs a statement this migration
does not have, and B cannot add it without amending 005.** This is the one
integration hole I am leaving, deliberately, because its shape is B's to
decide:

- `baseline/relations.ts:164`,
  `draft_brief_finalization_mode_is_known CHECK (finalization_mode = ANY
  (ARRAY['Push','PullRequest','PullRequestMerge']))`, and `:761`,
  `project_repository_landing_mode_is_known` over the same three. Neither
  admits `'None'`. GOAL puts `"None"` in `briefFinalizationModes`, and both the
  ticket picker and the repository landing section read that roster, so both
  CHECKs need it.
- It bites the moment B writes a draft at the new mode: `create_draft` now
  resolves a landing for **every** draft (that is the arm's removal), so the
  mode reaches `draft_brief` rather than staying NULL.

I did not guess at it: 005 is unlanded, so B amends it with the design in hand
and adds the case. **This is the one item that must not be lost between tasks.**

Related and smaller, also B's: drafts created *before* this release under the
`NoFinalizer` arm hold `draft_brief.finalization_mode = NULL`. 005 changes no
stored brief, so those rows keep their NULL. Nothing regressed — a NULL mode
read the same way yesterday — but if `'None'` is meant to be what they say, the
rewrite belongs in 005 beside the CHECK, and I would rather it were decided
than defaulted.

**3. A stored *draft* naming `AnyPass` or `NoFinalizer` is not guarded**, on
004's precedent: authored input is not a narrowed relation, and both the SQL
admit and the zod decoder ignore keys they do not name. The consequence is that
a stale draft's `AnyPass` stage silently reads as `UnanimousPass` — the strict
direction, on a ticket that has not been released. Naming it rather than
guarding it.

**4. Attribution.** The brief asks for `Claude Fable 5.1`; the commit signs
`Claude Opus 5 (1M context)`, which is the model that wrote it, and which is
what this session's attribution line says. This is the same divergence PR 1's S
had and its reviewer endorsed. Settle it for the effort rather than per task.

## Two 004 cases moved

Three lines in 004's own cases, because 005 makes their *current* assertions
false rather than because they were wrong:

- "a fresh install records the accounts leaving and keeps none of their
  columns" used `dispatch_candidate.finalizer` as the control proving the
  query was not vacuous; 005 drops it, so the control is now
  `dispatch_candidate.program`.
- "the release the boundary admits carries no pricing…" released at
  `finalizer: "NoFinalizer"`; that release is no longer admissible, so it
  releases at `ManagedFinalizer`. The case's claim — a release carrying no
  pricing is admitted — is unchanged.

## Where the evidence is

`…/scratchpad/pr2-S/` holds `check-postgres.log`, `nativereads.log`,
`main.sql`, `branch2.sql`, `render.diff`, the extracted function bodies used for
the mechanical diffs, `redproof.py` and the three mutation sets.

---

# Addendum — the landing that lands nothing

Second commit on `schema/three-deletions`:

    f78a96de  the landing roster takes the mode that lands nothing

Routing the coordinator's three answers: point 2 (keep the `ExecutionBlocked`
arm) and point 3 (attribution stays) needed no change. Point 1 is this commit.

## The NULL question, answered from the baseline

**A null `draft_brief.finalization_mode` could only be written by the
`NoFinalizer` arm, so 005 rewrites those rows to `'None'`.** The derivation:

- `create_draft` (`baseline/functions.ts:763`) and `revise_draft` (`:3272`) are
  the **only** writers of `draft_brief` anywhere in the tree. The other
  references — `functions.ts:2323`, and `authoring.ts`, `readiness.ts`,
  `finalizer.ts`, `ticketBrief.ts`, `nativeReads.ts` in the adapters — are all
  `LEFT JOIN`s. No migration touches the table.
- In both functions, the only assignment to `landing` is
  `coalesce(in_finalization_mode, <the repository's landing_mode>, 'Push')`,
  whose last argument is a literal, so `landing` is never null on that path.
  `project_repository.landing_mode` is `NOT NULL DEFAULT 'Push'` anyway.
- `landing` therefore stays at its declared null exactly when the removed arm
  was taken, i.e. when the authoring named `NoFinalizer` — and `revise_draft`'s
  `ON CONFLICT DO UPDATE` writes that null back over an earlier mode, so the
  rule holds for a revision as well as a creation.

So null is not "defer to the repository default" — that case resolves to a
mode. It is the author's "land nothing", recorded before it had a name.
**B does not have to treat NULL as a default landing**, and after 005 no draft
carries a null mode at all.

## What the commit adds to 005

- `ALTER TABLE public.draft_brief` DROP/ADD
  `draft_brief_finalization_mode_is_known`, and the same for
  `project_repository.project_repository_landing_mode_is_known`, each the
  baseline's own CHECK with `'None'::text` appended — verified mechanically,
  not by eye: substituting only that one element into the baseline text
  reproduces the migration's text character for character, for both.
- `UPDATE public.draft_brief SET finalization_mode = 'None' WHERE
  finalization_mode IS NULL`, after the widening, so the row it writes is one
  the check already admits.
- A header paragraph for each: that `'None'` joins by widening and so needs no
  guard arm, and the null-mode derivation above.

## Tests

Two cases, `migration.test.ts` now **47 of 47 green**:

- **"both landing rosters take the mode that lands nothing and no other new
  one"** — after a full migrate, `'None'` is taken by each of the two columns
  and `'Nowhere'` is refused by each, by constraint name. The refusal arm is
  what stops the case passing on a check that was widened to admit anything.
- **"a brief that recorded no landing is migrated to the one that lands
  nothing"** — on a v4 install, two drafts are created through the *pre-005*
  `create_draft`: one at an authoring naming `NoFinalizer`, one at
  `plainAuthoring`. The case first asserts what that image wrote —
  `(1, NULL)` and `(2, 'PullRequest')` — so the derivation above is read off
  the server rather than taken from the header, and then asserts the migration
  turns that into `(1, 'None')` and `(2, 'PullRequest')`. The untouched row is
  the second arm.

**Red-proof, five more mutations, all red, all reverted** (mutation set 5):
`'None'` removed from the `draft_brief` roster; removed from the
`project_repository` roster; the `draft_brief` roster widened to
`finalization_mode IS NOT NULL` (so `'Nowhere'` is taken); the `UPDATE`
statement deleted; the `UPDATE`'s `WHERE` deleted so every brief is rewritten.
That is **28 red-proofed mutations** over the branch.

Render-diff main vs branch is still **additions only**: 0 removed lines, 201
added.

## Gates, re-run on the second commit

| gate | verdict |
|---|---|
| `check-comments` | 0 findings across 905 files |
| `check-figures` | 0 findings across 102 files |
| `check-paths` | 0 findings across 1206 path claims in 1156 files |
| `check-source` | clean, 6 stages, 208 unit suites |
| `check-queries` | exit 1 — the same two sites |
| `check-postgres` | exit 1, 305 red cases — the same three groups |

`check-queries` is unchanged: `decision.ts:237` and `dispatchViews.ts:120`.

`check-postgres` partitions exactly as before, with **no new kind of red** — no
case mentions `draft_brief` or `landing_mode`:

- **298** raise `column "finalizer" of relation "dispatch_candidate" does not
  exist` (the count differs from the first run's 285 only because the hung
  suite was killed at a different point, so a different number of the worker's
  remaining suites got to run);
- **1** is `isolation.test.ts:114`, an `AssertionError` carrying that same
  message;
- **6** are the same `authoring.test.ts` cases as the first run, named in the
  main report, all pinning the draft arm 005 deletes.

`nativeReads.test.ts` hangs again, from the same line-413 fixture, and was
killed for the run to finish. Its attribution is unchanged and already proved:
with that one literal changed the suite is 14 of 14 green.

## One landing-order note for B

Once the `NULL → 'None'` rewrite has run, `postgresTicketBrief` reads those
rows through `draftBriefFinalizationOf` → `asBriefFinalization`
(`src/interpreter/ticketBrief.ts:241`), which throws `RangeError` for a mode
not in `briefFinalizationModes`. So **the roster gaining `"None"` and this
migration have to ship in the same release** — the same "one release carries
both" constraint 004 had for the deployment policy. Nothing on this branch can
express that assertion, because the roster is B's.
