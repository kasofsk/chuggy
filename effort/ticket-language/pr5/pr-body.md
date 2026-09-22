Step 5 of the ticket-language convergence (`chug-ticket-domain` at 76c95a9): **Escalated is a sum.**

`Ticket.reason` and `Ticket.resumeAt` become one `Ticket.escalation`, a six-variant sum (`NoEscalation`, `WorkFailureEscalated`, `WorkExecutionUnavailableEscalated`, `EvaluationFailureEscalated`, `EvaluationBlockedEscalated`, `FinalizationUnavailableEscalated`) whose constructors are the package's. Resume is derived from the variant by `resumeOf` and stored nowhere; `retryableIn` collapses to `hasOpenHumanTask`. `EvaluationBlockedEscalated` enters now so the derivation is total: an evaluation set interrupted by a wall parks there and resumes at evaluation, and a new golden walks it. The `ExecutionBlocked` event carries the ticket alone; the wall name is evidence, kept on the execution row as today and copied to the projection.

**Decision semantics is 6 alone.** The rig's tickets are disposable (Geoff, 2026-09-21), so every correction for semantics 1–5, the frozen fixtures and the vocabulary map are deleted. Migration 008 refuses to apply while any journal row exists and names `deploy/rig/wipe-tickets.sql`, a tracked script that empties every ticket-bearing relation and resets the project counters; a postgres case proves what it empties and what it keeps.

**Schema (008).** `ticket_projection.reason`/`resume_at` → `escalation` + `escalation_evidence`; `native_action.reason` → `escalation`; `decision_event_is_valid` and `submit_task_completion` replaced whole; `request_finalization_approval` follows.

**Wire.** `reason`, `resumeAt`, `executionBlockedBy` and `finalizationBlockedBy` fold into one optional `escalation: { kind, evidence?, resumeAt }` on the ticket read. `escalationReasons` → `escalationKinds`; new `gitEvidences` roster. Breaks the wire; the console is the only client.

**Console.** One switch on the kind for label, sentence, badge and tone; the evidence draws the wall line; the offer is read off `resumeAt`, and `resumePoint.ts` is gone.

**Also:** `test/postgres/workerCatalog.test.ts` read `published_at` as a millisecond `Date`, so two publications inside one millisecond tied and the republication case went red on a fast run (1 in 6 on a fresh database). It reads the column as text now.

Survey, decisions, task reports and reviews: `~/claude/chuggy-effort/ticket-language/pr5/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
