Follow-up to #719. Its release to the rig failed at migration 005's guard: nine journal rows (vteng/chuggy seq 203, 267, 310, 561; vteng/rehearsal 5, 14, 17, 23, 29; semantics 1–2) are the old machine's cascade revokes, and #719 refused them on the strength of a rig check that looked for the deleted names rather than the cascade's shape. The rig was rolled back (fabric #282); ledger stayed 4.

**The cascade is a semantics ≤3 correction, not a refusal.** A stored `ticket-revoked` record at semantics 1–3 that parked dependents replays to the current decider's revoke extended with one `Escalated` transition and one `OpenHumanTask` per dependent, and a post-state with each parked dependent at `Escalated{NoReason, NoResume}`, from which only revoke is enabled, which is all any stored continuation ever did. Only *which* dependents were parked is read off the row, and only a dependent the replay holds Pending, once; every other field is re-derived, so `recordEquals` refuses a record that parks a settled, working, never-held or repeated ticket, and refuses any cascade stamped semantics 4. `decisionSemanticsVersionCurrent` stays 4.

**005 loses the guard's cascade arm, edited in place.** No ledger holds 005 (the rig is at 4; the failed job raised in the guard before any statement), so the body is edited rather than fixed forward, and the commit says so. Its header now says the rows are admitted and read by the actor's correction. `decision_event_is_valid` is unchanged: the cascade's event is a plain `Revoke`.

Checked on the rig: the corrected guard's predicate finds no holder; the nine rows revoke tickets from Pending, Working or Escalated (never Finalizing), and every dependent they parked was later revoked from Escalated.

Reviews: round 1 CHANGES (parked set unrestricted; fixed), round 2 fresh; seven-mutant sweep red each round. Records under `~/claude/chuggy-effort/ticket-language/pr2-fix/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
