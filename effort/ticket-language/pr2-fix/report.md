# PR 2 fix — the cascade rows replay

`fix/cascade-rows-replay` in `~/claude/chuggy-wt/cascade-rows`, off ba0c5a68.
Tip **b5d30cd1**: `fb7b1f29` the cascade replays rather than being refused,
`4821ee8d` the cascade's own refusal is the ticket it never held, `aef4c3b7`
005 admits the cascade rows it was refusing, `b5d30cd1` the cascade parks a
Pending dependent or nothing (review round 1, finding 1).

## The correction

`replayableDecision` no longer refuses a `ticket-revoked` record with more than
one transition. `decisionAtRevokeCascadedToDependents` runs at semantics 1, 2
and 3: it takes that record's transitions into `Escalated`, keeps those naming a
ticket **the replayed state holds Pending**, drops repeats, and returns the
current decider's decision extended with one transition per parked dependent
(`from` read off the replayed state, `to: "Escalated"`) and one `OpenHumanTask`
each, and a post with each dependent at `Escalated`, `NoReason`, `NoResume`.

Pending is what the cascade parked, and it is derivable rather than trusted: a
ticket leaves Pending only once its dependencies are Done, and a Done ticket is
not revocable. So a record parking a ticket the fleet never held, one already
revoked or already running, or the same dependent twice, is re-derived without
it and fails `recordEquals` — the re-derivation no longer agrees with the row
about the one thing it is checking. At 4 the correction does not run and that
same comparison refuses the row; no second check.
`decisionSemanticsVersionCurrent` stays 4.

005 loses the guard's cascade arm from its body in place (no ledger holds 005 —
the rig is at 4 and the failed job raised before a statement ran); its header
now says the rows are admitted and read by the actor. `decision_event_is_valid`
untouched. No model, wire or console change.

Tests: a pinned rig-shaped history in `test/actor/decisionSemantics.test.ts` —
releases 1/2/3, a cascade at seq 4 parking 2 and 3, then each dependent's own
revoke from `Escalated` — legal at 1–3 and refused at 4; four forged parks
(never-held ticket, already-revoked dependent, already-working ticket, the same
dependent twice) each refused and none thrown on; the old refusal case inverted;
the cascade row moved into the rows 005 must admit in `migration.test.ts`.

## Gates on the tip

`ci.sh` changed run (base ba0c5a68): all gates clean, exit 0 — check-paths,
check-duplication, check-comments, check-boundaries, check-source static+unit,
check-postgres, check-queries, check-keto. Standalone besides, each exit 0:
check-figures, check-comments, check-paths, check-boundaries, check-source,
check-conformance (9 goldens, 180 steps).

Mutation sweeps, all red: round 1 six mutants plus 005's guard arm restored;
round 2 re-ran them on the new code and added two — membership without the
Pending phase, and repeats not dropped — each killing the forged-parks case.

**Not done: the round-2 fresh reviewer** — this session was told not to spawn
subagents.

## The rig's own journal, replayed

`rig-journal/vteng.jsonl` (692 rows, both projects) decoded exactly as
`postgresJournalStored` does — `parseStoredEntry(JSON.parse(entry), semantics)`
per row, digest chain skipped since the export carries none — and folded through
`storedJournalLegalOn` at the rig's config `{256, 8, 4}`, by
`scratchpad/pr2-fix/replay-rig.ts` (nothing written to the tree):

| | tip b5d30cd1 | main ba0c5a68 |
|---|---|---|
| chuggy, 662 rows, semantics 1/2/3, cascades at 203/267/310/561 | legal; replays 78 tickets, Revoked 47 Done 31 | refused at seq 203 by `replayableDecision` |
| rehearsal, 30 rows, semantics 1, cascades at 5/14/17/23/29 | legal; replays 15 tickets, all Revoked | refused at seq 5 by `replayableDecision` |

All nine cascades park only `Pending` dependents (1, 6, 4, 2 and one each), and
their revoked tickets are Pending, Working or Escalated — never Finalizing — so
the round-1 note about `revocableIn` refusing `Finalizing` costs these rows
nothing. No ticket replays `Escalated`: every parked dependent was later revoked.
