# Task C report — the console stops offering a work width

Tip `5c46f391` on `model/work-fanout-goes`, two commits over `432678ad` (A+S+B):
`e499af87` the console stops offering a work width · `5c46f391` the fixtures
follow. `Co-Authored-By: Claude Sonnet 5`, not the brief's Fable line: the
session's attribution reminder names this model, as A, B and PRs 3–5 also did.

## Files changed

`app/{browser/TicketCreationAdvanced,browser/TicketProvenance,core/ticketCreation,
core/ticketLedger}.ts(x)`; ten test fixtures — B's nine plus
`ticketCreationForm.test.tsx` (its "offers what is chosen" case exercised the
deleted picker); and, outside `ui/`, `test/ui/ticketActions.test.ts:39` (named
by A's and B's own "what C must change", though outside the stated scope).

## What a reader sees, and the one judgment call

The "Advanced" disclosure's work-fanout picker, the provenance panel's "work
fanout" field, and the field in the creation body sent to the API are gone.
Evaluation fan-out is untouched. `taskSetOf` no longer reads
`authoring.workFanout` for a work set's expected width — it is the literal
`1`. `ticketPageLedger.test.tsx`'s wide/relaunched/short/superseded set was
authored as a work fan-out of three, a shape the wire can no longer produce;
recast as an evaluation stage authored three wide (same task numbers and
figures, assertions unchanged). Since a cycle's "Work" row always draws first
whether the cycle has one or not, its two tests' row lookup could no longer
assume the first `.ledger-row` was the set under test; added a `stageRow`
helper keyed on the row's label. All 37 cases in that file pass.

## Gates on the tip

`check-console` **0** (1299 unit) · `check-console-sheets` **0** ·
`check-figures` **0** · `check-comments` **0** · `check-paths` **0** ·
`check-source --static` **0**. Full `check-source.sh` (adds unit) also clean,
207 suites.
