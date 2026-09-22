# PR 2 fix — the old machine's cascade rows replay

Branch `fix/cascade-rows-replay`, worktree `~/claude/chuggy-wt/cascade-rows`, off main ba0c5a68 (PR 2 merged). Run `npm ci` there first. Read `CLAUDE.md`, `.chug/tasks/review-change.md`, `src/actor/decisionSemantics.ts` whole, `src/actor/journal.ts` (`storedJournalLegalOn`), `src/adapters/postgres/schema/migrations/005-three-deletions.ts` whole, `test/actor/decisionSemantics.test.ts`, `test/postgres/migration.test.ts`'s 005 cases.

## What went wrong

PR 2 (#719) decided that a stored `ticket-revoked` record with more than one transition — the old machine's cascade, which parked every Pending dependent in `Escalated{DependencyRevoked}` — "names a machine this one is not" and is refused: `replayableDecision` returns false on it, and 005's guard raises when any such row exists. That decision rested on a rig check that grepped the journal for the three deleted names. The cascade row never names `DependencyRevoked` in its event; it is a plain `Revoke` whose record carries the dependents' transitions and one `OpenHumanTask` effect per dependent. The rig holds nine such rows: vteng/chuggy seq 203, 267, 310, 561 (semantics 2) and vteng/rehearsal seq 5, 14, 17, 23, 29 (semantics 1). The release of ba0c5a68 failed at 005's guard and the rig was rolled back (fabric #282).

Their shape, from the rig: `event.type = "Revoke"`, `rec.label = "ticket-revoked"`, `rec.transitions = [{ticket: r, from: <any non-terminal>, to: "Revoked"}, {ticket: d1, from: "Pending", to: "Escalated"}, …]`, `rec.effects = ["CancelTicketWork", "OpenHumanTask", …one per dependent]`. Every dependent those rows parked was later revoked by its own `Revoke` row, whose record says `from: "Escalated"`; no other decision was ever taken on a parked dependent, because the old machine gave it `NoResume`. No projection row sits at `DependencyRevoked` today.

## What to build

**A semantics ≤3 correction, not a refusal.** A stored row at semantics 1–3 whose record is a cascade replays to its own stored record (read off the row, as the other corrections do), and to the post-state that record describes: the revoked ticket Revoked, and each dependent named in the extra transitions Escalated with `reason: NoReason` and `resumeAt: NoResume` (the old reason no longer exists; nothing can be done to such a ticket but revoke it, which is all any stored continuation ever did, and `revocableIn` admits Escalated). `replayableDecision` stops refusing the cascade; a row at semantics 4 whose record is a cascade is still not something semantics 4 writes, so `storedJournalLegalOn`'s `recordEquals` refuses it as it refuses any record the current decider would not produce — say so in the doc comment rather than adding a second check. `decisionSemanticsVersionCurrent` stays 4: a semantics-4 row is unchanged; what changes is how ≤3 rows are read.

Tests: a fixture in `test/actor/` in the rig's shape (a semantics-2 cascade with two dependents, then each dependent's own `Revoke` from Escalated) that replays legal under `storedJournalLegalOn`; the same rows stamped semantics 4 refused; the `revokedMoreThanItsOwnTicket`-based case in `decisionSemantics.test.ts` inverted. Keep `test/actor/journalAtSemanticsOne*.json` as they are.

**005's guard loses its cascade arm.** 005 has been applied to no database (the rig's ledger is 4; the failed job raised in the guard before any statement), so its body is edited in place — the one time that is honest, and the commit message says why. The header's paragraph on the cascade arm is rewritten to say the rows are admitted and read by the actor's correction. `migration.test.ts`'s case for that arm becomes: a cascade row present, 005 applies. `decision_event_is_valid` needs no change (it validates events; the cascade's event is a plain `Revoke`).

Nothing else: no model change, no wire change, no console change. Effects, `native_action` rows the cascade opened (all settled), and `decision_input` are untouched.

## Gates

`check-source` (unit + static), `check-conformance`, `check-postgres`, `check-queries`, `check-figures`, `check-comments`, `check-paths`, `check-boundaries`. Report each exit on the tip. Then a fresh reviewer and a mutation sweep, as PR 2 had.

## Commits

On `fix/cascade-rows-replay`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Report to `~/claude/chuggy-effort/ticket-language/pr2-fix/report.md` (tip, what changed, gates), under ~40 lines.
