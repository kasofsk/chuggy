# Task M report — main merged into model/rename, and the stored outcome lifts

Tip `64e5abb5` on `model/rename`: the merge commit `9a25d529` and one commit
after it.

## Part 1 — the merge

Two conflicts, both as the brief said. `src/adapters/postgres/schema/migrations/005-three-deletions.ts`
was main's alone — the branch never touched it — so main's guard (no cascade
arm) is what merged, and `test/postgres/migration.test.ts` auto-merged to
main's cases over the branch's spellings, which are already correct: its
`deletionRevokeEntry` writes only `Pending`/`Revoked`/`Escalated`.

`decisionSemantics.ts`: main's `decisionAtRevokeCascadedToDependents` survives
whole, at semantics 1, 2 and 3, composed outside `decisionAtReworkWallParkedEvaluating`
at 1 exactly as main had it; 4 and 5 go straight to the current decider.
`revokedMoreThanItsOwnTicket` is gone, `replayableDecision` no longer refuses
the cascade, and `recordEquals` in `storedJournalLegalOn` is what refuses a
cascade stamped 4 or 5. The correction needed no rewriting for the new
vocabulary: it reads `ticket-revoked`, `Pending` and `Escalated`, none of which
the rename touched, and it runs after `rowAtCurrentVocabulary` either way. The
header's cascade paragraph is main's, with "at 4 the correction does not run"
becoming "above 3", and its `Finalizing` line taking the branch's
`Finalization`. Imports came to `../domain/ticketGraph.ts`, and the reduce's
`core` accumulator became `graph`.

`test/actor/decisionSemantics.test.ts`: both sides' tests survive. Main's
`cascade` fixture and `forgedParks` table are unchanged but for
`storedReplayCore` → `storedReplayGraph`, one forged park's `from: "Working"`
→ `"Work"` (a `Transition` is a decoded record, so the lift has already run),
and the semantics-4 refusal becoming a loop over 4 and 5. `journalAtSemanticsOne*.json`
untouched.

`ui/chuggy-ui/` auto-merged clean: main's card rewrite of `ProjectTable.tsx`
and its split of `TicketCells.tsx` land unchanged, and its new
`getByText("Working")` assertion is right on this branch too — `phaseLabel`
keeps `Working`/`Evaluating`/`Finalizing` as the product's copy for the
renamed phases.

## The replay probe

`replay-rig.ts` against this branch's `src` and `pr2-fix/rig-journal/vteng.jsonl`
(one edit, `storedReplayCore` → `storedReplayGraph`):

```
chuggy:     662 rows, semantics 1/2/3, 4 cascades at seq 203,267,310,561 — legal
            78 tickets: Revoked 47, Done 31
rehearsal:   30 rows, semantics 1,   5 cascades at seq 5,14,17,23,29     — legal
            15 tickets: Revoked 15
```

## Part 2 — the lift

Exported `wordAtCurrentVocabulary` from `src/actor/decisionSemantics.ts` — the
one-field lift `rowAtCurrentVocabulary` is built from. Callers:
`rowAtCurrentVocabulary` in the same file, and `checkedFinalizationSubmission`
in `src/interpreter/wire.ts`, which lifts `record["outcome"]` before comparing
it and returns the record carrying the lifted word. Test
`test/interpreter/wire.test.ts`: a stored `FinalizationFailed` submission reads
as `FinalizationNeedsWork`, and `FinalizationAbandoned` is still refused.
Red-proved both halves — dropping the lift and dropping the rewritten return
each redden that case alone.

## Gates on `64e5abb5`

| gate | exit |
|---|---|
| check-source (6 stages, 208 suites) | 0 |
| check-boundaries | 0 |
| check-conformance | 0 (9 goldens, 184 steps) |
| check-postgres | 0 (75 suites) |
| check-queries | 0 |
| check-figures | 0 |
| check-comments | 0 |
| check-paths | 0 |
| check-console | 0 |

A's and B's 14 deliberate unit reds are gone; `check-source` is clean.

## What the brief got wrong

Nothing that changed the work. Two notes: 005's cascade arm was *not* on both
sides via the merge base — the branch simply never touched 005, so main's file
merged with no decision to make. And `check-console` needed `npm ci` in
`ui/chuggy-ui/`, whose `node_modules` was an empty directory; the root's was
stale too (prettier absent).

Commits end `Co-Authored-By: Claude Opus 5 (1M context)`, per the session's
attribution reminder rather than the brief's `Claude Fable 5.1`, as A's and
B's did.
