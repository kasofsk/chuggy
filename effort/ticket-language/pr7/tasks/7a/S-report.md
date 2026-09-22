# Task S (PR 7a) — migration 011, the program is a plan

Tip `d208b133` on `schema/evaluator-keys`, one commit off `e9a6136e`, not pushed. New
`migrations/011-evaluator-keys.ts`; edited `migrations/index.ts` and
`test/postgres/migration.test.ts`. The schema README describes neither
`execution_request_task.evaluator` nor the `CreateTicket` payload, so it needed nothing;
`deploy/rig/wipe-tickets.sql` already truncates `dispatch_candidate` and `journal_entry`.

## 011's shape

Two statements, no DDL, no grants.

1. **The guard**, 008's `DO` block byte for byte, naming `deploy/rig/wipe-tickets.sql`. The
   header argues it in this migration's terms: a stored release names a fan-out and names no
   evaluator, so no stored entry validates under this image.
2. **`decision_event_is_valid` replaced whole** (`CREATE OR REPLACE`, owner and grants
   untouched). Only the `prog` loop moves; the `TaskDone`, `FinalizationResult`,
   `ExecutionBlocked`, `deps` and `workFanout` arms are 010's, carried through verbatim.

**The item spelling the arm admits** — the generated codec's, read off
`src/generated/model-api.ts` on `origin/main`, where a record of a list of records is a plain
object holding a plain array of plain objects (no wrapper): `{"key": N, "evaluators": [{"key":
N}, …]}`. `key`, `evaluators` and the evaluator's `key` are three consts at the top of the
migration (010's idiom), so a rename by A lands in one place. **A's report had not landed when
this was written**, so the names are decision 1's rather than A's confirmed.

The arm walks `prog` `WITH ORDINALITY` and refuses an item that is not an object, names
`fanout`, has a non-integer `key`, a `key` that is not its 1-based place, an `evaluators` that
is not a non-empty array, an evaluator that is not an object with a positive integer `key`, a
key repeated within the stage, or a `combinator` other than the one name 010 carries
(absent still means `UnanimousPass`). Stage-key distinctness needs no line: a list of
positions is distinct. Evaluator keys are **not** held dense — `[{key:1},{key:3}]` is admitted.

The shape is weighed one statement before the value, because `jsonb_array_length` raises on a
non-array and a cast raises on non-numeric text, and SQL promises no left-to-right `OR`.

## Render-diff

`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs` (6b's) against
`~/claude/chuggy` at `e9a6136e` and against the worktree: one append hunk, 100 added lines, all
of migration 11, **zero removed and zero changed**. 001–010 render identically.

## Tests and red-proofs

Three new cases in `test/postgres/migration.test.ts`: the ledger row; the guard refusing,
naming the wipe, leaving the ledger at 10 and the width still admitted by the validator it did
not replace; and a table of eight programs through `decision_event_is_valid` — a sparse stage
`[{key:1,evaluators:[{key:1},{key:3}]}]` and a two-stage positional program admitted, and
`fanout` present, a stage keyed 2 in place 1, an empty evaluator list, a key named twice, a key
of 0, and `combinator: "AnyPass"` each refused.

Eleven single mutations, each run against the case that owns it — **all RED, no survivors**:
011 never registered in `index.ts`; the guard block deleted; the guard's message stripped of
the remedy; `item ? 'fanout'` deleted; the positional key check deleted; the positional check
reading the constant 1 instead of the ordinality; the non-empty evaluator check deleted; the
uniqueness check deleted; the evaluator floor moved from `< 1` to `< 0`; the uniqueness check
replaced by a density check (which refuses `{1,3}`); the combinator disjunct deleted.

`migration.test.ts` whole on the tip: **90 pass, 0 fail**. No existing case moved — the
fan-out-era fixtures are all pinned at migrations 003–005 with `installationAt`, and 009's own
event table uses `prog: []`, which 011 still admits.

## Gates on the tip

`check-figures` 0, `check-comments` 0, `check-paths` 0, `check-duplication` 0,
`check-source --static` 0 (five stages clean), `check-queries` **0**.

`check-postgres` **0 — 76 suites clean**, which is not what the brief predicted. No postgres
suite releases a ticket through this arm: the `prog` TypeScript writes reaches
`decision_event_is_valid` only on the release path, and no suite exercises it with a program in
it. **B's diff is what will first put a keyed program through this arm**, so B should re-run
`check-postgres` rather than trust this green.

## What GOAL.md and the brief got wrong

- The brief expected `check-postgres` red "where TypeScript still writes `fanout`". It is
  green; see above.
- Commit attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief names —
  this ran on Opus, as 6a's and 6b's S did. The brief has now named Fable three times.
- **A latent hole this task found and did not close.** A `CreateTicket` whose `value` omits
  `prog` (or `deps`) entirely is **admitted**, at 010 on `origin/main` as well as at 011: the
  absent key makes `jsonb_typeof(value->'prog') <> 'array'` SQL NULL, `false OR NULL` is NULL,
  and a NULL `IF` falls through. Proved by probing both a database migrated to 010 from
  `~/claude/chuggy` and one migrated to 011 from the branch. It is 009/010's and outside this
  brief's scope (`prog` **items**), and closing it here risks reddening
  `test/postgres/nativeReads.test.ts:104`, which builds exactly that shape. Filing it as work
  rather than fixing it silently: the fix is `IS DISTINCT FROM 'array'` in a later migration.
