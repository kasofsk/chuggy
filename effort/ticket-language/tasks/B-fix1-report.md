# B-fix1 — the rework cap counts evaluation failures; 004's guard covers its own CHECK

Worktree `~/claude/chuggy-wt/no-accounts-fixb`, branch `model/no-accounts-fixb`,
two commits on top of `6fcb53cf`. Not pushed, not rebased; the baseline
migration is untouched.

- `f3d0519c` — the cap counts the reworks a failing evaluation bought
- `f4a86f29` — 004's guard covers the check 004 narrows (HEAD)

Two commits rather than one: the findings are independent and house rule 12
wants each why in its own message. The tree's own recent history (`#712`,
`#713`) is single-concern commits of this size.

## Finding 1 — the count

`src/domain/task.ts`: `workCyclesStarted(record, live)` is now
`evaluationFailureReworksStarted(record, live)`. It folds `record` + `tasks` in
id order into maximal runs and counts a Work run only when the run of
Evaluation-kind tasks immediately before it holds a task resolved `Failed`.
The first fan-out has no evaluation before it and does not count; a run after a
passing evaluation is the finalizer's rework and does not count. The
`evaluationFailed` flag resets when a fresh evaluation run opens, so a failure
three runs back cannot colour a later finalizer rework; consecutive evaluation
runs of different stages are one non-Work run, which is right because a
stage-0 failure means there is no stage 1.

`src/interpreter/reworkCap.ts`: the comparison is now `>= cyclesMax`, because
the first fan-out no longer counts itself. For a ticket whose finalizer never
fails the arithmetic is identical to what landed (`1 + reworks > cyclesMax` ≡
`reworks >= cyclesMax`), which is why no existing cap-driven suite moved.
`cyclesMax: 2` is two reworks and a park on the third failed evaluation;
`cyclesMax: 0` parks on the first.

Doc comments rewritten at both sites, plus a fourth header paragraph in
`reworkCap.ts` stating that the cap is over evaluation failures alone and why
counting the finalizer's reworks buys nothing (the cap is consulted only on a
failing evaluation, so it could never park that loop). `ReworkCap`'s one-line
doc restated. `tasks/B-report.md` corrected in three places: the `cyclesMax`
paragraph now records the defect and the new rule, the "what changed" paragraph
names the rename, and decision 3 ("migration 004's statements are untouched")
is marked superseded by B-fix0 and B-fix1.

Nothing else in the tree named `workCyclesStarted`. No golden or conformance
fixture encodes the count — it is derived at the writer and only the
disposition is journaled, and that is unchanged. `check-conformance` replayed
all 10 goldens clean.

Verified against the real deciders (throwaway probe, not committed) that a
resume from the rework wall still re-escalates on the next failure — reworks
goes 2 → 3 across `ResumeReworking`, which is GOAL's "no refill".

### Tests and the mutation each went red under

`test/domain/task.test.ts` — the `cyclesOver` helper became `reworksOver`,
taking `[kind, state]` pairs because outcomes now matter.

| Case | Red under |
|---|---|
| a rework is a work run that follows an evaluation run some task failed | M1 |
| the work a passed evaluation is followed by is the finalizer's, and is uncapped | M2 |
| an evaluation run counts once however many of its tasks resolved | M3 |
| the count folds the record and the live set as one history | M1 |
| a cap of two reworks the first two failures and parks the third | M5 |
| a cap of one reworks once, and a cap of none parks the first failure | M5 |
| a finalizer that failed twice leaves the ticket every rework the cap allows | M1 |

- **M1** `if (!inWorkRun && evaluationFailed) reworks += 1;` →
  `if (!inWorkRun) reworks += 1;` — i.e. the landed behaviour, counting every
  work run. Reds all four domain cases and all three cap cases. This is the
  defect the finding named: the `ManagedFinalizer` case escalates on its first
  evaluation failure under it.
- **M2** delete `if (inWorkRun) evaluationFailed = false;` — the flag is never
  reset, so a finalizer rework after a passing evaluation inherits an older
  failure. Reds the uncapped case alone (fail 1 of 24).
- **M3** `task.state.value === "Failed"` → `=== "Cancelled"`. Reds 7 of 24.
- **M4** `inWorkRun = true` → `inWorkRun = false`, so every work task opens a
  run. Reds 2 of 24, including the fan-out assertions. Recorded for coverage;
  no case is left resting on it alone.
- **M5** `>= cyclesMax` → `> cyclesMax` in `reworkDisposition`. Reds the three
  cap cases, `cyclesMax: 0` included.

Every mutation was reverted and the suites re-proved green (24 of 24) before
committing.

The `ManagedFinalizer` case is the reviewer's scenario inverted:
`dispositionsUnder(cyclesMax, finalizationFailures)` drives two full
Work → Evaluation(Pass) → Finalizing → `FinalizationFailed` → Working rounds
through the real deciders before the evaluation failures start, and still gets
Rework, Rework, Escalate at `cyclesMax: 2`.

## Finding 2 — the guard

`004-no-accounts.ts` gains a fourth `UNION ALL` arm inside the existing `DO`
block:

```sql
UNION ALL
SELECT 'session_turn'
 WHERE EXISTS (SELECT FROM public.session_turn
                WHERE length(input) > 17403663)
```

**Decided beyond the brief:** the refusal text moved from
`'account rows remain in %'` to
`'rows this migration no longer admits remain in %'`. A turn wider than the
re-rendered mailbox bound is not an account row, and an operator handed
"account rows remain in session_turn" would go looking for a column that was
never there. The two existing guard cases' regexes moved with it, and the
header's guard paragraph gained the clause that says why. If a reviewer
prefers the old wording I will put it back; keeping it seemed the worse of the
two, and leaving the guard's message and its coverage disagreeing is the shape
"an unverified control is worse than none" is about.

Header also extended: the guard paragraph now names the narrowed mailbox bound
beside the removed walls, and states that every narrowed check below has its
arm up there.

### Tests and the mutation each went red under

`test/postgres/migration.test.ts`, two arms over a shared `turnOfWidth` helper
that brings the subject to the accounted installation and inserts one lead
session holding one queued turn of `n` characters (`repeat('x', n)` server
side, so nothing 17 MB crosses the wire; each arm runs in ~0.5 s).

| Case | Red under |
|---|---|
| a session turn wider than the narrowed bound refuses the migration untouched | dropping the `session_turn` arm from the `DO` block — the ALTER then fails with the raw `check constraint … is violated by some row`, which is not the guard's message |
| a session turn at the narrowed bound migrates | the guard literal `> 17403663` → `>= 17403663` |

The pair is what pins the guard's literal to
`leadObservationTokensPerDecisionAt004`: the wide arm inserts
`constant + 1` and the compliant arm inserts `constant`, so a guard literal
that drifted from the constant in either direction reds one of them. Both
mutations were reverted and both arms re-proved green.

The helper needed `execution_cluster` and `capacity_account` rows before
`agent_session` (FKs `agent_session_draws_its_cluster` and
`capacity_account_cluster_fkey`) — found by running it, not by reading.

### Render diff

`node --experimental-strip-types
~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs` over
`~/claude/chuggy` (main `81e8093a`) and over the branch: **0 removed lines,
119 added**, all of them the `-- migration 4` block appended at the end. Main
vs branch is still additions-only.

## Gates

Run at HEAD (`f4a86f29`) unless noted.

| Gate | Exit | Line |
|---|---|---|
| `check-postgres` | 0 | 75 suite(s) clean against postgres:18-alpine with 4 worker(s) |
| `check-queries` | 0 | `src/adapters/postgres` agrees with postgres:18-alpine |
| `check-conformance` | 0 | 10 golden(s), 206 step(s) replayed clean, records, states and bundle |
| `check-boundaries` | 0 | graph clean across 1059 module(s) |
| `check-comments` | 0 | 0 finding(s) across 908 file(s) |
| `check-figures` | 0 | 0 finding(s) across 102 file(s) |
| `check-paths` | 0 | 0 finding(s) across 1209 path claim(s) in 1160 file(s) |
| `emit-goldens.test.sh` | 0 | 14 passed, 0 failed |
| `check-source` | 1 | 3 stage(s) failed, 6 run — C's files only |
| `node --test` over `test/{domain,interpreter,actor,contract}/*.test.ts` | 0 | 1495 tests, 0 fail |
| `node --test` over `test/{roots,adapters,random}/*.test.ts` | 0 | 860 tests, 0 fail |

Nothing exited 2.

`check-source` is red in three stages (static, lint, unit) on the five files
Task C owns, and on nothing else:

- `ui/chuggy-ui/app/core/codeSentences.ts`
- `ui/chuggy-ui/app/core/resumePoint.ts`
- `ui/chuggy-ui/app/core/ticketCreation.ts`
- `test/ui/resumePoint.test.ts`
- `test/ui/ticketActions.test.ts`

The same five as at `eb7f1fdb`, with the same errors. The gate's format stage
went red once on my own `test/postgres/migration.test.ts`; `npx prettier
--write` over the touched files fixed it and it is green (4 failed stages → 3),
which is the only reason the stage count differs from the round-1 review's.
Both commits used `--no-verify` for that reason alone.

## Other decisions the brief did not make

1. **Two commits, not one** (above).
2. **The guard's refusal text** (above).
3. **`tasks/B-report.md` decision 3** marked superseded rather than left
   standing. It is a factual claim about the tree that two later commits have
   made false; `B-fix0-report.md` already records the change, so a pointer was
   enough.
4. **Attribution**: both commits carry `Claude Fable 5.1`, as the brief names.
   The round-1 review's note about the mixed attribution on `eb7f1fdb` and
   `6fcb53cf` (`Claude Opus 5 (1M context)`) still stands and still needs
   settling before this lands; I did not rewrite history to do it.
