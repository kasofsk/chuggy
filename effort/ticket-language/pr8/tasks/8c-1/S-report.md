# S report (8c-1) — filed by the orchestrator from the builder's hand-back

Tip 47af8924 on `schema/ticket-commands` (off e78a93ce): 015-ticket-commands.ts, index.ts, schema README, migration.test.ts. Hook clean; migration suite 128/128. No table added; wipe script untouched.

- Guard refuses while `journal_entry` OR `operation` holds a row (stored envelopes carry `event`; a stored NotEnabled would break the new CHECK). e78a93ce's wipe script empties `operation` (line 82).
- `task_report_is_valid` requires positive `report.value.ticket`; `decision_event_is_valid` rebuilt whole, five report-bearing arms require report.ticket = fact.ticket.
- `decision_command_is_valid(command jsonb)` dropped+recreated; admits only CreateTicket, RevokeTicket/ResumeTicket (positive ticket), ReportTaskTerminal, DispatchTicket{ticket,source>0}, ReportFinalizationResult{ticket,workCycle,generation>0, result arm with evidence>0}.
- **Envelope field is `ticketCommand`, not `command`** (decision 4 correction: `command` is the envelope discriminator). Const `decideField`. Decide with `event` refused.
- Public exclusions: CreateTicket; mailbox also refuses Decide of ReportFinalizationResult or DispatchTicket; dead ReleaseTicket exclusion dropped.
- `accept_operation` rewritten (RevokeTicket Safety/CorrectnessReducing, ResumeTicket Ordinary; dead Dispatch arm dropped); `accept_dispatch_operation` stand-in `ticketCommand:{ResumeTicket}`; authority CHECK re-rendered NOT VALID (ReportTaskTerminal → ExecutionScheduler, ReportFinalizationResult → Finalizer).
- `submit_task_completion` rewritten whole, builds `ReportTaskTerminal` with ticket, tag ReportTaskTerminal. `submit_finalization_result` builds no TicketCommand (writer does from SubmitFinalizationResult envelope); rewritten only for its tag.
- `decision_input.refusal text` ({type,value}, type = outcome_code); `decision_input_outcome_is_known` (NotEnabled, CommandUnreadable gone); `decision_input_refusal_is_its_outcome` via `decision_refusal_is_valid(code, refusal)` (SECURITY DEFINER, IMMUTABLE, boundary owner; ticket service EXECUTE + UPDATE(refusal); API SELECT(refusal)).
- Render-diff: main's render is a byte-identical prefix; only 015 added.
- Red-proofs: 46 mutations, 45 red; survivor `IS JSON OBJECT`→`IS JSON` equivalent (type=code check refuses non-objects).
- check-postgres red (B's): acceptance, finalizer, finalizerClosure, finalizerQueue, httpBoundary, leadHttpReads, nativeActionAdmits, nativeReads, notifications, readiness, scheduler, schedulerRace, schedulerStore, sourceDeferral, ticketInstants, ticketProjection, viaSession. Unconfirmed: sessionStoreRows 10 s statement timeout ("a batch above the body bound…"), touches nothing 015 changed — probably load.
- Beyond GOAL: guard over `operation`; `accept_dispatch_operation` rewritten; positive tickets for Revoke/Resume; `submit_finalization_result` rewritten for its tag.
