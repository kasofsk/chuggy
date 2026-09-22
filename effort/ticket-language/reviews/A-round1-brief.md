# Review: model/no-accounts round 1 (Task A: model, goldens, domain, actor)

You are a fresh reviewer who did not author this change. Work in
`~/claude/chuggy-wt/no-accounts-review-a`, pinned at Task A's tip (two
commits on main 81e8093a; `node_modules` is linked). Read
`.chug/tasks/review-change.md` there first; it is your brief (note the
change itself edits that file — read the version on the branch, and judge
the edit too). Its verdicts APPROVE / CHANGES / ESCALATE are the only
ones you may return. Then read
`~/claude/chuggy-effort/ticket-language/GOAL.md`, `SPIKE.md` (Decisions
and The plan), the task brief `tasks/A.md`, and the author's
`tasks/A-report.md` — the report is the author's claim, not evidence.

The change is `git diff main..HEAD`. The tree is expected red under
`check-source` for `src/interpreter`, `src/adapters`, `src/contract` and
the console (Task B and C's), so judge the model, goldens, generated
types, `src/domain`, `src/actor`, their tests, and the gate/doc edits.

The convergence target is the package's text:
`/tmp/claude-1000/-home-geoff-claude-chuggy/6988229d-0563-475a-9255-7ce0b2467e85/scratchpad/ctd/model/ticket-domain/ticket.qnt`.
The one type taken from it must be verbatim.

Check explicitly, beyond the brief's own rules:
- Every comment and header that argued from the measure or the accounts
  now describes the code as it is, and none narrates the removal
  (comments describe the code; a "was" is a history comment).
- The disposition is a nondet draw in `evalReduce` and a journaled payload
  in `refinement.qnt` and `decisionEvent.ts`; the escalate branch keeps
  its label; finalization failure always reworks; resume is free; dispatch
  needs no gas. Re-prove one or two of these by mutating the model and
  seeing the suite or an aimed golden go red (`.chug/tasks/check-model.sh`
  is slow; `quint test` on the suite file is faster for a single probe).
- The golden re-plan: every kept row is still aimed by an invariant it
  refutes (`test/golden/coverage.test.ts` can only read two aim shapes),
  and the new `rework-wall-resume` aim actually discriminates a resume from
  the rework wall from any other resume.
- `decisionSemantics.ts`: versions 1|2|3, corrections read off the stored
  row (`{event, rec}`), a record naming a removed wall not replayable, and
  the semantics-2 escalated-rec fixture proves the rec-derived disposition
  (check the fixture can go red: flip the rec's transition and the test
  must fail).
- Two gate suites were repinned (`check-conformance.test.sh`,
  `check-random.test.sh`): confirm each still fails its own mutant.
- The rank ladder in `src/domain/phase.ts` was deleted; confirm no reader
  wanted an ordering.
- `review-change.md` retired standing rules 1 and 2 and kept 3/4's
  numbers: judge whether the citations by number elsewhere still point
  at what they mean.
- Run: check-model, check-conformance, check-random, check-model-api,
  check-comments, check-paths, check-figures, check-boundaries and the
  owned suites (`node --test` on test/domain, test/actor, test/golden,
  test/conformance, test/generated). Exit 2 is could-not-run.

Write the review to `~/claude/chuggy-effort/ticket-language/reviews/A-round1.md`:
verdict first, then findings, each naming a failure that actually happens
(file:line, input, what goes wrong). No style nits without a failure. Do
not edit either worktree's branch (`model/no-accounts` is being worked
on by Task B concurrently; your worktree is your own).
