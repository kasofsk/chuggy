# Task S (PR 7b) — migration 012, one completion event

Tip `280b9dec` on `schema/evaluation-instance`, one commit off `f8d6c8fd`, not pushed. New
`migrations/012-task-report.ts`; edited `migrations/index.ts`, `test/postgres/migration.test.ts`,
`test/postgres/nativeReads.test.ts`. The schema README describes no journal event, so it needed nothing.

## 012's shape

Three statements, no DDL, no grants; `execution_result.verdict` and its CHECK untouched.

1. **The guard**, 008's `DO` block byte for byte, naming `deploy/rig/wipe-tickets.sql`.
2. **`decision_event_is_valid` replaced whole.** New `TaskDone` arm; `ExecutionBlocked`'s arm deleted;
   `CreateTicket`'s `deps`/`prog` tests `IS DISTINCT FROM 'array'`, the rest of that arm and the
   `FinalizationResult` arm 011's byte for byte.
3. **`submit_task_completion` replaced whole — signature unchanged, so `CREATE OR REPLACE` and no
   grant restated.** The identity is built on every path now (the blocked one included) and the report
   chosen from the locked row: Blocked → `TerminalFailureReport(ExecutionUnavailableFailure)`;
   evaluation task → `EvaluationResultReport` with `Pass`/`Fail` as `EvaluatorPass`/`EvaluatorFail`;
   work `Pass` → `WorkResultReport`; work `Fail` → `TerminalFailureReport(ProcessFailure)`.

**The report spelling the arm admits** — the codec's idiom off `src/generated/model-api.ts` (a sum
carrying a record is `{type, value}`, a nullary sum its own name as a string), in seven consts:

    {"type":"WorkResultReport",      "value":{"ticket":N,"result":{"manifest":N,"digest":N,"schema":N}}}
    {"type":"EvaluationResultReport","value":{"ticket":N,"result":{…},"verdict":"EvaluatorPass"|"EvaluatorFail"}}
    {"type":"TerminalFailureReport", "value":{"ticket":N,"kind":"ProcessFailure"|"ExecutionUnavailableFailure"}}

**A's report had not landed**, so two divergences from the package are mine, each for decision 1's own
reason: `WorkResultReport` drops `acceptedSourceRef` and `TerminalFailureReport` drops
`failure: TaskFailure` — the task is on the event (decision 4) and the evidence stays on the execution.
`ValidatedTaskResult` is chuggy's `TaskResultRef`. If A spells any of it otherwise, the consts move.

## Render-diff

6b's `scratch/B-fix0/render.mjs`, `~/claude/chuggy` at `f8d6c8fd` vs the worktree: one append hunk,
240 lines, all of migration 12, **zero removed and zero changed**. 001–011 render identically.

## Tests and red-proofs

Four cases: the ledger row; the guard refusing, naming the wipe, leaving the ledger at 11 and the
attested completion still admitted; twelve reports (admitted / value-wrong / shape-wrong per
constructor, plus three arm-level rows) and six whole events refused (a verdict beside the report,
the previous vintage's completion, an `EvalReduce`, an `ExecutionBlocked`, a release with no `prog`,
one with no `deps`); and the door journalling the whole `{ticket, task, report}` for four seeded rows
— work pass, evaluation fail, work fail, blocked evaluator — the digest read back through
`result_digest_fold` rather than written down.

**Twenty-two single mutations, all RED, no survivors:** 012 unregistered; the guard deleted; its remedy
stripped; `value ? 'verdict'` deleted; the report's ticket unweighed; the kind roster given a third
name; the absent kind left to answer NULL; the verdict roster given the manifest's `Pass`/`Fail`; the
absent verdict left to answer NULL; the produced result unweighed; the failure arm dispatched on the
payload's `kind` instead of the constructor; the `ExecutionBlocked` arm restored; an `EvalReduce` arm
added; `deps` reverted to `<>`; `prog` reverted to `<>`; a wall reported as a process failure; the
evaluator's verdict inverted; a work failure reported as a produced result; the task kind no longer
choosing the arm; the digest journalled unfolded; the identity skipped on the blocked path; the event
attesting a verdict beside its report.

One conjunct was **removed for failing its red-proof**: `jsonb_typeof(report) <> 'object'` is
unreachable — `->`/`->>` on a non-object answer NULL rather than raising, so the ticket and roster
tests already refuse every non-object.

Two landed cases **pinned at their own vintage** (`escalation_block` at 11, `identity_events` at 10):
the door and shapes they read are what 012 replaces, and both go red at full migrate — proved by
reverting the pins. `migration.test.ts` whole: **95 pass, 0 fail**. `nativeReads.test.ts`: **20 pass**
— nothing validates a raw `journal_entry` insert, so its `prog: []` is honesty, not a fix.

## Gates on the tip

`check-figures`/`check-comments`/`check-paths`/`check-duplication`/`check-boundaries`/`check-queries` 0,
`check-source --static` 0 (five stages).

`check-postgres` **1 — six cases in two suites, all B's** (with A's codec): the generated
`decisionEventSchema` still spells `verdict`/`result` and still has an `ExecutionBlocked` arm, so the
interpreter refuses the event this door builds. `scheduler.test.ts:1121` ("carries … the verdict"),
`:1297` ("journals the ticket alone"); `schedulerStore.test.ts:700, :730, :775, :805`, the last three
failing in `readiness.ts:400` as "stored operation … is unreadable".

## What GOAL.md and the brief got wrong

- **Decision 3's empty-manifest clause is not decidable here.** The door sees the manifest's *id*, not
  its text; the exhausted-retry manifest is distinguishable only by the prose
  `schedulerCompletion.ts:77` authors into `execution_result_report`. I mapped by task kind instead:
  every work `Fail` is `ProcessFailure` (the package has no work verdict), every evaluation `Fail` is
  `EvaluatorFail`. **A live decision, not a nit:** the package's `statusBlocked` counts
  `EvaluatorProcessFailed` as blocked, so routing an exhausted evaluator retry to `ProcessFailure`
  would *park the ticket for a human* where today the job pays (survey 6). Making it park needs a new
  signal from the caller — a signature change plus a `schedulerCompletion.ts` edit, both in B's scope.
- `EvalReduce` had **no arm to delete**: every tag without an arm already fell to `RETURN false`. It is
  refused after 012 exactly as before.
- Commit attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief names — fourth time.
- A latent sibling of the closed hole, **not fixed** (out of scope, carried verbatim): the
  `FinalizationResult` arm's `value->>'out' IN (…)` answers NULL, not false, for an absent `out`. The
  mailbox refuses it (`IS NOT TRUE`), so nothing wrong is admitted, but the function is not total on
  its inputs. Fix is a `COALESCE` in a later migration.
