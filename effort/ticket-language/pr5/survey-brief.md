# PR 5 survey — Escalated as a sum

Read-only. Detached worktree of your own at `origin/main` (currently d126c09a; PR 4 `model/finalization-unavailable` will merge shortly, so also read that branch at `~/claude/chuggy-wt/finunavail` for the finalization arm it adds):

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/pr5-survey origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/pr5-survey/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/SPIKE.md` (the plan table's PR 5 row and the "Decisions" section), `pr3/survey.md` and `pr4/survey.md` (the shape and depth of survey wanted), `pr3/GOAL.md` and `pr4/GOAL.md` (what landed and what each deferred to PR 5), the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` (types `WorkEscalation`, `EvaluationFailureEscalation`, `FinalizationEscalation`, `Escalation`, `TicketState.Escalated(Escalation)`, `isEscalated`, and every `match escalation` arm — the resume derivation is there), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## The decision that shapes this PR (Geoff, 2026-09-21)

**The rig's tickets are disposable.** No lift, correction or semantic version for rows written before this PR. The release wipes the rig's ticket data (dump first). So the migration may replace the two columns outright, refuse or truncate old rows, and the actor needs no semantics-6 correction; the frozen fixtures at semantics 1–5 may be deleted or kept as the survey recommends (say which and why). Do NOT recommend compatibility machinery.

## Questions to answer, each with file:line evidence

1. **The model.** Chuggy's `model/ticket.qnt` today: how `Escalated`, `reason`, `resumeAt` are represented (record fields? separate?), every decider/enablement that reads or writes them, and the package's target shape. What facts does each package escalation variant carry (`WorkEscalation` etc.) and where in chuggy is each fact available today (e.g. the work cycle, the evaluation generation, the finalization generation PR 4 adds, the git evidence PR 3 left "durable nowhere")? List the diff against the package text after this PR: which lines of `ticket.qnt` match the package and which still differ.
2. **Resume derived.** The package derives resume from the variant. Which of chuggy's `resumePoints` roster, `ResumeTicket` command handling, `resume_at` column, `project_continuation.expected_phase`, and the console's resume actions/labels (`ticketActions.ts`, `resumePoint.ts`, `codeLabels.ts`) go, and what replaces them on the wire (the SPIKE says `Resume` leaves the wire; the console asks the escalation).
3. **Schema.** Every column, CHECK, function and index that names `reason` or `resume_at` (`ticket_projection`, `native_action.reason`, `project_continuation`, `decision_event_is_valid`, `submit_*`, `request_finalization_approval`, `record_finalization_hold` from PR 4, partial indexes). Propose 008's shape: one JSON-typed `escalation` column (or `jsonb`), its CHECK, and what each function does instead. State what a wipe must truncate for the rig (which tables hold ticket data, in FK order) and what it must keep (configurations, repositories, bindings, identities, policies).
4. **Wire and console.** `ticketResponseSchema`, `escalationReasons`, `executionBlockedBy`, PR 4's `finalizationBlockedBy`: fold them into one `escalation` object on the read? Which console surfaces draw reason/resume/blocked-by today (list every file), and what the escalation object gives them instead.
5. **Stored text.** Per `~/.claude/projects/-home-geoff-claude-chuggy/memory/stored-text-outside-the-journal.md`: every column that stores a model event or record as opaque text, and whether this PR changes the shape of any of them (journal rows will — old ones are wiped; new rows carry the sum). Say what `rowAtCurrentVocabulary`/`eventAtCurrentVocabulary`/`decisionSemantics.ts`'s corrections become once no pre-6 row exists: keep, delete, or shrink.
6. **Surprises**: anything the SPIKE row got wrong, and anything PR 3/4 left for PR 5 (search both GOAL.md files for "PR 5").

## Output

`~/claude/chuggy-effort/ticket-language/pr5/survey.md`, in the style and depth of `pr3/survey.md`, under ~200 lines, numbered surprises at the top. Remove your worktree when done (`git -C ~/claude/chuggy worktree remove --force ~/claude/chuggy-wt/pr5-survey`). Reply with the surprises section only.
