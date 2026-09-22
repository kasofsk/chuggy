# PR 3 — the rename

Step 3 of the convergence (SPIKE.md plan; package pin 76c95a9). Language only:
no machine change. Base: `model/three-deletions` (PR 2) merged to main.
Survey of the surface: `survey.md` (read it first; its fourteen surprises set
the scope below). Effort dir: this directory; tasks in `tasks/`, reviews in
`reviews/`, ledger `reviews/ledger.md`.

## Decisions (orchestrator, 2026-09-21, under Geoff's overnight grant)

**In this PR.** Every renamed name is the package's name.

| chuggy | becomes | forced by |
|---|---|---|
| Phase Working / Evaluating / Finalizing | Work / Evaluation / Finalization | plan |
| TaskKind Work / Evaluation(n) | WorkTask / EvaluationTask(n) | survey 1: the phase names collide with the task-kind constructors in `chuggy_ticket`; the package spells them WorkTask/EvaluationTask |
| Resume ResumeWorking / ResumeReworking / ResumeEvaluating / ResumeFinalizing | ResumeWork / ResumeRework / ResumeEvaluation / ResumeFinalization | survey 2: phase-named; PR 5 derives them away, until then they follow the phases |
| FinalizationOutcome FinalizationFailed | FinalizationNeedsWork | plan |
| Core (type; `src/domain/core.ts`; `core` params) | TicketGraph (`src/domain/ticketGraph.ts`; `graph`) | plan |
| DecisionEvent ReleaseTicket | CreateTicket | plan |
| Stage | StageDefinition | plan |
| Reason WorkFailed | WorkFailureEscalated | plan |
| Reason ReworkBudgetExhausted | EvaluationFailureEscalated | plan |
| Reason ExecutionPolicyDenied, TicketConfigIncompatible, ExecutionProfileUnavailable, RuntimeVersionUnsupported, RequiredCapabilityUnavailable | one Reason WorkExecutionUnavailableEscalated | plan; the wall name survives as evidence, see below |
| step labels derived from the above (`ticket-escalated work_failed`, `… rework_budget_exhausted`, `… execution_blocked`, `rework-started finalization_failed`) | `ticket-escalated work_failure_escalated`, `… evaluation_failure_escalated`, `… work_execution_unavailable_escalated`, `rework-started finalization_needs_work` | survey 11: labels are the reason in snake case |

**Deferred, and SPIKE.md's plan table says so now.**
- Effect strings → obligation names: PR 8, where `StepRecord.effects` itself is replaced. They are embedded in durable primary keys and stored effect positions (survey 5–7); renaming them alone buys a byte-format change for nothing.
- Verdict Pass/Fail → EvaluatorPass/EvaluatorFail: PR 7, with the evaluation protocol. It is the worker's digest-attested manifest vocabulary (survey 8) and changes with the worker's report, not before.

**Boundaries that do not move.**
- The fabric-facing execution task kind stays `Work` / `Evaluation`: `executionTaskKinds`, `execution_request_task.kind`, `CHUG_WORKER_TASK.taskKind`, `images/worker/*`. The domain's `WorkTask`/`EvaluationTask` maps to it at the adapter, as `SpawnWorkTasks` already maps to `SpawnWork`. So there is no fabric or worker release coupled to this PR (checked: the fabric names none of the renamed strings outside one comment).
- `execution.blocked_reason` keeps the five wall names. It is the evidence. The interpreter's `BlockedReason` stops being `Extract<Reason, …>` and becomes its own roster (the five), produced by the kubernetes and supplied adapters as today and stored as today.
- Landed migrations are not edited. 006 restates.

**The evidence reaches the reader.** The ticket read gains `executionBlockedBy?: BlockedReason`, present only while `reason` is `WorkExecutionUnavailableEscalated`: the `blocked_reason` of the ticket's most recent execution with `outcome = 'Blocked'`. The console's five wall labels move from the reason to this field. The wire's `escalationReasons` roster becomes the three.

**Journal rows are immutable; the reader translates.** Decision semantics **5**. A stored row written under 1–4 carries the old spellings in `rec.transitions[].from/to`, `rec.label`, `event.type` (`ReleaseTicket`), `event.value.reason`, `event.value.out`, `event.value.resumeAt`, task kinds inside `event`/`rec`. The stored-row decoder normalises every such field to the new spelling **before** anything else reads the row, as one total map old→new; every correction for 1–4 in `decisionSemantics.ts` then compares against the new spellings (they read normalised rows). The removed wall labels PR 1 refuses (`ticket-escalated gas_exhausted`, `… finalization_budget_exhausted`) have no new spelling and are refused as they are. The frozen fixtures `test/actor/journalAtSemanticsOne*.json` are NOT rewritten: they are old rows and the tests prove they still replay. `event_schema_version` stays 1: the bytes of a stored row do not change; what changed is the vocabulary a new row is written in, which `decision_semantics_version = 5` records.

**Migration 006** (`src/adapters/postgres/schema/migrations/006-rename.ts`), in the 005 shape: guard first, reading fields not text; then
- rewrite `ticket_projection.phase`, `.reason`, `.resume_at`; `native_action.reason` (all rows, settled included; the settled-row `DependencyRevoked` arm from 005 stays); `project_continuation.expected_phase`;
- restate the phase, reason and resume CHECKs on those tables at the new spellings only (data was rewritten);
- `execution_blocked_reason_is_known` unchanged (the five stay);
- `decision_event_is_valid` v5 and every admit/draft function that reads a stored spelling admit **both** spellings (stored rows keep the old; new rows carry the new), as 005 admitted the dropped keys absent or present;
- `submit_finalization_result` admits `in_outcome` at both spellings and pairs `bound.phase` with `'Finalization'` for new rows and `'Finalizing'` for rows written before 006 — simplest is to admit either on the read side, since the projection rows are rewritten;
- the partial index `journal_entry_release_ticket` is dropped and recreated over `IN ('ReleaseTicket','CreateTicket')`;
- `decision_input.command` JSON is not rewritten; its validators admit both.
Render-diff main vs branch for every earlier migration must be empty (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`).

**Console.** Phase labels, tones, sections, resume points, actions, page facts follow the new names; the reason labels become three plus the wall label off `executionBlockedBy`; `ConversationWorkCard.tsx:140`'s "Working" is copy and stays; `Stage` table headers are copy and stay.

**Goldens** re-emitted; `test/golden/manifest.json` invariants rewritten in the new names; `check-model.sh`/`.test.sh` witness roster count re-checked; `coverage.test.ts` regenerates labels from `domain.qnt`.

## Sequence

A. model (`ticket.qnt`, `domain.qnt`, `refinement.qnt`, `api.qnt`, tests, mc) + goldens + generated + `src/domain` + `src/actor` (semantics 5, the normalising decoder) + conformance + their tests. opus. Worktree `~/claude/chuggy-wt/rename` on branch `model/rename`.
S. migration 006 + `test/postgres/migration.test.ts` + render-diff. opus, parallel with A. Worktree `~/claude/chuggy-wt/rename-schema` on branch `schema/rename`, merged into `model/rename` after A.
B. interpreter + adapters + contract/wire (`executionBlockedBy`, rosters) + postgres reads + tests. opus, after A and S land on `model/rename`.
C. console. sonnet, after B.
R. fresh reviewer per round; whole-branch mutation sweep as the second review; full ci.sh with `origin/main` merged in; PR; merge; release to the rig by the runbook with a dump first; sanity checks; record.

## Progress

- 2026-09-21: survey landed (`survey.md`); goal written; A and S launched.
- 2026-09-21: A landed e59bd4aa on model/rename (14 unit reds are B's contract renames, deliberate). S running. PR 2's release failed on the rig (cascade rows); fix on main first, then merge main into model/rename before B.
- 2026-09-21: S landed 2ab38d70 on schema/rename (no guard by argument; render-diff empty; 18/18 red-proofs). Merged into model/rename. B launched.
- 2026-09-21: B landed 23a3f93e (executionBlockedBy correlated read; chuggy_api grant on blocked_reason added to 006; wall collapse in wire.ts permanent). Decisions: continuation-path RemoteDenied evidence has no home until PR 5 (Escalated as a sum) — listed there; stored FinalizationFailed submission lift in wire.ts is task B-fix1 after the main-side cascade fix merges in. C launched.
- 2026-09-21: C landed 14048917 (console). PR 2's fix #722 released to the rig (ledger 5). M landed 64e5abb5: main 55de9de6 merged (cascade correction runs at 1–3 over normalised rows; refused at 4 and 5 by `recordEquals`), replay probe legal over every rig row (chuggy 662, rehearsal 30), `wordAtCurrentVocabulary` exported and `checkedFinalizationSubmission` lifts through it; nine gates 0. Round 1 reviews launched in two halves (machine, surface) on detached worktrees `rename-review-{machine,surface}`.
- 2026-09-21: round 1 (machine APPROVE; surface CHANGES → F1 a704946c). Full roster at a704946c: two gate *suites* red (conformance suite's golden name, random suite's mutant `core` and seed) → 9ab90d02, roster clean. Sweep (63 mutations) CHANGES: raw `ticket.phase` in two console surfaces, comments → F2 e32deb65 plus the frozen `journalAtSemanticsFour.json` (main's deciders; every map key pinned). Round 3 and full roster running at e32deb65.
- 2026-09-21: **006 rehearsal**: rig dump `rig/chuggy-pre-006-rehearsal.dump` (ledger 5, 692 journal rows, 93 projections, 60 native actions, 211 continuations) restored into container `chuggy-rig-rehearsal` (port 55499); the branch's `migrate` as `chuggy_owner` applied 6 (`rig/migrate-006.log`): native_action reasons → WorkFailureEscalated 25 / EvaluationFailureEscalated 13 / WorkExecutionUnavailableEscalated 4 / DependencyRevoked 18 (settled); continuation phases → Work 97 / Evaluation 114; projections unchanged (all Done/Revoked NoReason). Replay probe (`rig/replay-rig.ts`, branch src) over the fresh journal: chuggy 662 rows and rehearsal 30 rows all legal.
- 2026-09-21: round 3 APPROVE (fixture provenance re-derived from main; all 16 keys red-proved). Orchestrator wrapped `Inbox.tsx`'s raw phase (246e224b). **PR #723 merged → main e5f7b3d3.** Release: dump `/home/geoff/backups/chuggy-pre-e5f7b3d3.dump` (ledger 5, 692 rows); phase 1 running (`release-e5f7b3d3-phase1.log`).
- 2026-09-21 ~11:50Z: **released.** Fabric #284 (source-commit e5f7b3d3; api@ed607442, web@0bcf9c56) merged; `chuggy-migrate-e5f7b3d3-registry` applied 6 (native_action and continuation rewrites identical to the rehearsal); seven deployments rolled; no CrashLoop; console 200; api reads ticket 84 (field `executionBlockedBy` absent, response valid under `ticketResponseSchema`); importer succeeded on the new image at 11:42Z; no error lines in any service log; `decision_event_is_valid` on the rig admits CreateTicket/ReleaseTicket, ExecutionBlocked with a wall, FinalizationNeedsWork/FinalizationFailed, refuses nonsense. Local rehearsal container removed. Temporary rig identity kept for the next PRs' checks.
- 2026-09-21 ~10:00Z: **regression** (Geoff): ticket view's Brief and Provenance showed InvalidRequest. Cause: `draft_revision.authoring` stores the release event as opaque text, every stored row spells `ReleaseTicket`, and `parseDraftAuthoring` parsed it with no lift (the drafts page and `ReleaseDraft` were broken the same way; the post-release check never read a draft). Fix #724 (`eventAtCurrentVocabulary`, `parseStoredDecisionEventText`; all 234 rig rows parse) → main d126c09a; reviewed APPROVE (reviewer audited every other stored-text reader: no second gap); released via fabric #285 (api only; migrate "already current"); draft 84, drafts page, ticket, configuration, console all 200; importer completed on the new image. Dump `/home/geoff/backups/chuggy-pre-d126c09a.dump`. Memory: `stored-text-outside-the-journal.md`.
