Step 6a of the ticket-language convergence (`chug-ticket-domain` at 76c95a9): **work fan-out goes.**

The package's work identity is `WorkTask{ticket, cycle}`: one work task per cycle. chuggy's `workFanout` was N identical work tasks on one brief in one cycle, all required to pass, with the finalizer taking the highest-numbered task's handoff; every ticket the rig ever released carried 1. It leaves the model (`spawnWork` is the one work spawn; `tasksWellFormed`'s Work arm says one; `N_TASKS` stays as the evaluation stage ceiling), the goldens (re-emitted), the generated mirror, the domain, the actor, the wire (`authoringSchema`, the dispatch candidate, the draft initialization's choices, the HTTP cursor member), the postgres writers and readers, and the console (the Advanced picker, the provenance field, the creation body). Evaluation fan-out is untouched.

**Migration 009.** Guard as 008: refuses while any journal row exists and names `deploy/rig/wipe-tickets.sql` (the `CreateTicket` payload loses the field, so no stored release replays). `dispatch_candidate.work_fanout` dropped, with the relation's multi-column CHECK restated over the two floors (dropping the column silently drops the whole CHECK). `decision_event_is_valid` refuses a `CreateTicket` that names the field. The cursor member leaving narrowed the lead's mailbox bound, so 009 re-renders `session_turn_text_is_bounded`, re-seeds `tokensPerDecision` and carries 005's guard for a stored turn past the new bound.

`check-random.test.sh`'s pinned seed is re-pinned: the walk's draws moved with the work set.

Survey, decisions, task reports and reviews: `~/claude/chuggy-effort/ticket-language/pr6/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
