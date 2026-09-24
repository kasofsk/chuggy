Step 8c-2 of the ticket-language convergence (`chug-ticket-domain` at 76c95a9): **update.**

The decider takes the package's `UpdateTicket` and the machine journals `TicketUpdated`, both verbatim; a ticket carries its `revision`, 1 at release and one more per update. An update is refused, in the package's order, when the ticket is missing, not Pending, named by another definition, at a stale revision, or given other dependencies. `revisionsAccounted` holds each step to that arithmetic. Journals stored before 8c-2 replay unchanged — a ticket map without revisions does not decode, and nothing stored carries one — so there is no wipe; decision semantics stays 8.

**The draft stays the editor.** A released draft reopens for revision while its ticket is Pending (`revise_draft`, refusing `DependenciesLocked` for a dependency change), and releasing it again sends `UpdateTicket {ticket, expectedRevision, authoringVersion, configurationRevision}`, re-resolving the definition and possibly re-pinning the configuration. **What a ticket runs is what was released:** `ticket_definition.brief` holds the released brief as a snapshot, digest-checked on read, and the scheduler, finalizer, briefing and dispatch read it; the definition, brief and pin move in the journal's transaction. The ticket read shows the same: its brief, program and configuration pin are the released ones, with `revision` and `releasedAuthoringVersion` on the wire, and the console's Edit offer runs revise-then-update and says when the draft holds unreleased changes.

**Migration 016.** Validators for `TicketUpdated` and the update envelope; `update_draft_fenced` beside the release's fence; `draft.released_authoring_version`; `ticket_projection.revision`; `ticket_definition.brief`, backfilled from each released draft and checked against the digest the code computes; `submit_task_completion` reads the latest definition. Column-scoped grants open the brief and the pinned configuration revision to the API role, and revoke the scheduler's and finalizer's reads of the draft.

No fabric or worker change beyond the release's digests.

Survey, decisions, task reports and reviews: the effort directory's `pr8/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
