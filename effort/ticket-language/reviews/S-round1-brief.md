# Review: schema/no-accounts round 1

You are a fresh reviewer who did not author this change. Read
`.chug/tasks/review-change.md` in the worktree `~/claude/chuggy-wt/no-accounts-schema`
first; it is your brief and its verdicts (APPROVE / CHANGES / ESCALATE)
are the only ones you may return. Then read
`~/claude/chuggy-effort/ticket-language/GOAL.md` for what the change was
asked to do, and `~/claude/chuggy-effort/ticket-language/tasks/S-report.md`
for what the author says it did — the report is the author's claim, not
evidence; verify against the diff and by running things.

The change is `git diff main..schema/no-accounts` in that worktree: one
commit, migration 004 plus its registration and tests. Baseline and
migrations 002/003 must be untouched (verify). The author's render-diff is
under `~/claude/chuggy-effort/ticket-language/scratch/S/`; re-derive it
rather than trusting it if you can.

Things a careless review would miss here, to check explicitly:
- The `CREATE OR REPLACE decision_event_is_valid` body must differ from the
  baseline's (functions.ts ~777–846) ONLY by the pricing clauses and the
  two reason literals. Diff the bodies yourself.
- The guard must refuse, not fail halfway, and a refused migration must
  leave the ledger at 3 (the tests claim this; read how they prove it and
  whether the proof can pass while the property fails — see the
  guards-fail-open trap: a fixture that makes the guarded arm unreachable,
  a checker that continues past an unparsable shape).
- The journal guard matches the record label and the ExecutionBlocked
  reason as fields, not substrings; check the JSON paths against how
  `journal_entry.entry` is actually written (src/adapters/postgres/journal.ts).
- The authoring-policy rewrite renders text with `format()` to match a
  text comparison in `src/adapters/postgres/domainConfiguration.ts`; check
  the rendered text is byte-identical to what `JSON.stringify` of the new
  three-key config produces for the values in the row (key order, no
  spaces, integers).
- `check-postgres.sh` and `check-queries.sh` are red on this branch for
  Task B's reasons; run them and confirm every red is B's (a query or
  test outside migrations/), and that the six new 004 cases pass.

Write your review to `~/claude/chuggy-effort/ticket-language/reviews/S-round1.md`:
verdict first, then findings, each naming a failure that actually happens
(file:line, what input, what goes wrong). No style nits without a
failure. Do not edit the branch.
