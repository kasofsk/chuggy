# Review round 1 — fix/cascade-rows-replay @ aef4c3b7

CHANGES

The correction is the right shape and the rig's rows replay. One finding: the
parked set is read off the record with no constraint on the phase it is read
at, so the legality check admits cascades the old machine could not have
written and replays them into states neither machine can reach.

## Findings

### 1. `src/actor/decisionSemantics.ts:179-181` — a parked dependent is taken at any phase, not only Pending

```ts
const parked = row.rec.transitions
  .filter((t) => t.to === "Escalated" && held.has(t.ticket))
```

The header three lines above the function, and the module header at line 30,
both say what this reconstructs: a revoke "parking every **Pending** dependent
of the ticket it revoked". The filter never asks. `from` is re-derived from
`decision.post`, which makes the re-derived record agree with whatever the
stored record says rather than checking it, so any transition to `Escalated`
naming a held ticket is admitted at whatever phase that ticket replays at.

Two concrete journals, both run against this tip (semantics 2, `modelInstance`):

- release 1; release 2 (deps {1}); revoke 2 (`Pending→Revoked`); revoke 1 with
  record `[{1,Pending,Revoked},{2,Revoked,Escalated}]`, effects
  `[CancelTicketWork, OpenHumanTask]`.
  `storedJournalLegalOn` → **true**; `storedReplayCore` leaves ticket 2
  `Escalated`. A settled ticket is resurrected out of an absorbing terminal.
- release 1; release 2; dispatch 2; revoke 1 with record
  `[{1,Pending,Revoked},{2,Working,Escalated}]`.
  `storedJournalLegalOn` → **true**; ticket 2 replays `Escalated` with one
  live task and an empty retired record. `escalate` in `src/domain/deciders.ts:112`
  always `retireLive`s, and the cascade parked only Pending tickets, so no
  machine that ever ran produced that ticket — the correction builds it by hand
  because it copies phase/resume/reason onto whatever `ticketAt` returns.

`src/actor/journal.ts:83-92` is the only thing standing between a stored
journal and `projectWriterLoad` (`src/interpreter/projectWriter.ts:190-216`
calls it first and then folds the same rows into live memory), so a row it
admits becomes the writer's core and its projections. The module's own header
calls turning a legal history illegal the failure it exists to prevent; the
inverse — admitting a history no machine wrote — costs the check the same way,
and the standing commitment *an unverified control is worse than none* is the
reason to close it rather than note it.

Fix: park only a dependent the replayed state holds **Pending**, which is both
what the old machine did and what the header already claims —

```ts
.filter((t) => t.to === "Escalated" && held.has(t.ticket)
               && ticketAt(decision.post, asTicketId(t.ticket)).phase === "Pending")
```

and drop the repeats, because a record naming the same dependent twice is also
admitted today (verified: same fixture with `{2,Pending,Escalated}` listed
twice and a second `OpenHumanTask` → legal `true`; the duplicate transition is
copied into the re-derived record, so the comparison cannot see it). With both
in place `from` is `"Pending"` by construction and the re-derivation stops
agreeing with the row about the one thing it is not checking. Add the two rows
above to `test/actor/decisionSemantics.test.ts` beside the
ticket-never-held case — they are the same class of forgery that case already
covers, and it is the case that proves the correction refuses rather than
throws.

## Notes

Checked and not flagged:

- **(1) the rig's shape replays.** Traced `decideRevoke` → correction →
  `recordEquals` by hand and then ran it: the fixture's cascade is legal at 1,
  2 and 3, and each dependent's later `Revoke` re-derives
  `[{d,Escalated,Revoked}]` / `[CancelTicketWork]` because `revocableIn` admits
  `Escalated` and the correction is inert on a one-transition record. The
  later revoke rows do pass through `decisionAtRevokeCascadedToDependents`;
  `parked` is empty and it returns the decision untouched.
- **(2) nothing the old machine wrote is refused.** A cascade whose revoked
  ticket was `Working` is legal at 1–3 (ran it); `Escalated` likewise, since
  `revocableIn` is phase-only and `decideRevoke` reads `from` off the state.
  Effect order matches: `CancelTicketWork` from the current decider, then one
  `OpenHumanTask` per parked dependent, appended in record order.
  One thing outside this diff: `revocableIn` refuses `Finalizing`, so an old
  cascade row revoking a Finalizing ticket would be refused at
  `decisionEventEnabled` before any of this runs. GOAL says the rig's revoked
  tickets were "any non-terminal"; if any of the nine is `Finalizing` the
  release still fails, at replay rather than at 005. Worth a `SELECT` against
  the rig's journal before the next release attempt. Not a defect in this
  change — enablement is unchanged here.
- **(3) nothing new at 4.** The cascade at semantics 4 is refused by
  `recordEquals` (one transition derived, three stored), as the test asserts —
  no second check, and the doc comment says so, which is what GOAL asked for.
- **(4) 005.** The guard's remaining arms are `ticket_projection`,
  `native_action` Open, `session_turn` length and the journal's three field
  reads; the deletion leaves the `EXISTS (` parens balanced and no arm now
  reads `rec`. The header's new paragraph is true of the body, the first
  paragraph still describes the machine rather than the guard, and the
  migration's name still names what left the machine. `migration.test.ts`
  moves the cascade row from `deletedRows` to `undeletedRows`, so "a row each
  arm must not match migrates" now seeds a cascade row and asserts 005 applies
  — the admission is proved. `deletionRevokeEntry` gives the cascade row only
  `["CancelTicketWork"]` where the rig's carries an `OpenHumanTask` per
  dependent; the guard reads no effects, so it changes no verdict, and I would
  leave it.
- **(5) docs.** `check-figures`, `check-comments` and `check-paths` all exit 0
  on the tip (0 findings). No quantity in a comment; the counts of rig rows
  live in the commit messages, where house rule 12 puts them. The in-place
  edit of a landed migration is argued in its commit message with the
  condition that makes it honest, which is the trap
  `migrations-edited-in-place` names.
- Ran `tsc --noEmit` (exit 0) and `node --test test/actor/*.test.ts`
  (54 pass, 0 fail). `check-postgres` and `check-queries` need a server and
  were not run; nothing in the SQL edit looks like it would move them.
- Worktree left clean (`git status` empty at aef4c3b7); the probes above were
  run from the scratchpad, importing the worktree's modules.

Practices invoked: `domain-modelling@blessed-practices` — "make illegal states
unrepresentable", and a constructor that cannot refuse is one that lies, which
is finding 1 exactly: the correction constructs a post-state from a record it
declines to refuse.
