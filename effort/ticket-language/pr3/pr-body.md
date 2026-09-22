Step 3 of the ticket-language convergence (`~/claude/chuggy-effort/ticket-language/SPIKE.md`): the rename. Language only; no machine change.

**Every renamed name is the package's name** (chug-ticket-domain 76c95a9): phases `Work`/`Evaluation`/`Finalization`; task kinds `WorkTask`/`EvaluationTask`; resume points `ResumeWork`/`ResumeRework`/`ResumeEvaluation`/`ResumeFinalization`; `FinalizationNeedsWork`; `TicketGraph` (`src/domain/ticketGraph.ts`); `CreateTicket`; `StageDefinition`; reasons `WorkFailureEscalated`, `EvaluationFailureEscalated`, and one `WorkExecutionUnavailableEscalated` in place of the five wall names; step labels follow.

**What does not move.** The fabric-facing execution task kind stays `Work`/`Evaluation` (mapped at the adapter, so no fabric or worker release rides with this). `execution.blocked_reason` keeps the five wall names as evidence; the ticket read gains `executionBlockedBy`, present only while the reason is `WorkExecutionUnavailableEscalated`, and the console draws the wall label from it. Effect strings and `Verdict` are deferred to PRs 8 and 7.

**Journal rows are immutable; the reader translates.** Decision semantics 5: `rowAtCurrentVocabulary` lifts every stored spelling to the new one before the codec, and the corrections for 1–4 read normalised rows. The cascade correction from #722 runs at 1–3. The frozen semantics-1 fixtures are byte-unchanged and still replay. The rig's journal replays legal row for row under the branch (`pr2-fix/replay-rig.ts`).

**Migration 006** rewrites `ticket_projection.phase/.reason/.resume_at`, `native_action.reason`, `project_continuation.expected_phase`; restates the CHECKs at the new spellings; `decision_event_is_valid` and every stored-spelling reader admit both; the `journal_entry_release_ticket` index covers both event tags; `submit_finalization_result` takes both outcomes. No guard by argument (every narrowed check is over a total rewrite of its own column). Render-diff of every earlier migration main vs branch is empty.

Reviews: `~/claude/chuggy-effort/ticket-language/pr3/reviews/ledger.md` (two round-one halves, a whole-branch mutation sweep of 63 mutations, a round three on the fixes; full roster clean at e32deb65; migration 006 rehearsed on a restored copy of the rig database; the rig journal replays legal under this branch).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
