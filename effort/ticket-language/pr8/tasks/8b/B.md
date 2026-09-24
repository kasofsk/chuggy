# Task B (PR 8b) — the writer decides and journals events, materializes obligations, and the continuation is gone

Branch `model/ticket-events`, tip 469425c8 (A's 2acfe7a7 merged with S's 727b62d2, clean). Setup: `_setup.md` beside this file (read it first; it is part of this brief) — **except** the branch step: this branch is local, not on origin, so run `git checkout model/ticket-events` once (no fetch) and confirm `git log -1 --oneline` is 469425c8. If the checkout is refused because another worktree holds the branch, reply saying so and stop. Use your own postgres: `docker run -d --name chuggy-check-postgres-8b-b -e POSTGRES_PASSWORD=chuggy-check -p 55437:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55437; remove it when done.

Read, in order: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8b — decisions" and every 8b progress line after them (the corrections A and S forced are there), `pr8/tasks/8b/A-report.md` and `S-report.md` (your site lists, by file:line, and the spellings), `pr8/survey.md` §3, §6 and surprises 2, 9–12, `pr8/tasks/8a/B.md` and `B-report.md` (this task's shape in 8a), `pr7/reviews/7b-round1-machine.md` §1 (the deferred-forever wedge), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/`, `src/contract/`, `test/contract/{representations.ts, contractDocument.json}`, and the tests of all of them under `test/`; 014 (unlanded, S's) only where an alignment below needs it.

- **The writer decides and journals events (decisions 1–6).** Every A-report site: `decide(graph, command, policy)` then `evolve`; the journal row is `{seq, event}` (S's trigger refuses anything else); `reworkDisposition(held, cyclesMax)` is the policy argument and no command carries `onFailure`; `storedJournalLegalOn` without config; replay is A's.
- **Materialization from obligations (decision 7).** `decisionPlan.ts` reads `decision.obligations` and `entry.event`, never a positional record: a decision's `ExecuteTask`s are **one** `execution_request` + one `input_bundle` numbered at the index of the first, identity `"<seq>:<index>:ExecuteTask"`, request `kind` still `SpawnWork`/`SpawnEvaluation` by the identity's variant; `CancelTask`s one `CancelTicketWork` request, `"…:CancelTask"`; `FinalizeTicket` → `finalization_request` at its index, `"…:FinalizeTicket"`; the desk from the transition into `Escalated`, `native_action.action` = `"<seq>:TicketEscalation"` under S's new unique (write `effect_position` 0 for the desk and say so in a one-line comment only if the column's NOT NULL forces a value). `subject()` and the effect strings go. The pod annotations and `CHUG_WORKER_TASK` carry the new identity strings opaquely; nothing parses them — confirm by grep.
- **The continuation is gone (decision 4).** Delete `project_continuation`'s writers and readers (`readiness.ts:620`, `decision.ts:474-483`, the fence `projectWriter.ts:273-290`), the `Continuation` input class and its aging term. `check-queries` must reach 0.
- **Finalization evidence (A's correction 2).** The `FinalizationResult` command's `evidence` is the fold (`result_digest_fold`'s TypeScript twin) of the settling `finalization_attempt.attempt_digest` for the submission (`finalizationEvidenceOf`, `readiness.ts` near :375, is where to read it). If the attempt row is not reachable there, say why and use the smallest positive ref that is, naming it.
- **The failure report (A's correction 1).** `TerminalFailureReport` is `{failure: {task, evidence}, kind}` everywhere TypeScript builds or reads it (the scheduler completion path, fixtures).
- **Readers.** `nativeReads.ts` matches `TicketCreated` (S's index); `nativeReads.test` fixtures journal `{seq, event}` in the event spelling; every fixture journalling `rec` or a command tag follows.
- **The deferral bound (decision 9), one commit.** A transient dispatch observation bumps `decision_input.deferred_passes` (and sets `deferred_since` on the first) in the settle that defers; past `sourceDeferralPassesMax` (a named code default beside `holdPassesMax`) the operation is refused `ExecutionSourceUnreadable` with the last evidence, no journal row; the aging term stops promoting an exhausted input. Red-proof with a remote that stays transient: without the bound the operation is never answered.
- Contract: no wire change is expected. If a schema must move, say why.
- Tests: a work pass decides once and materializes the first stage's request with the new identity; each failure edge under its policy; the three resumes; a revoke cancels live tasks; a stale completion is refused with no journal row; replay of a stored journal equals the writer's graph; `i3`/`ticketServiceRun`/`projection` end to end Work → Evaluation → Done with no continuation row anywhere.
- Comments: nothing says step record, transition, effect string, reduce, continuation or `onFailure`.

NOT yours: `model/`, `src/domain/`, `src/actor/`, `src/generated/`, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Environment note

`check-source`'s `test/rig` typecheck needs `@playwright/test`, which no `package.json` declares and this machine's `node_modules` lacks. The orchestrator is checking whether `origin/main` is red the same way here; treat `test/rig`'s playwright import errors as environment, list them, and do not add the dependency.

## Gates on the tip

`check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-random`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. One gate at a time; kill orphaned `node --test` children before `check-postgres`. Report each exit.

## Report

Tip; what changed per layer; the identity strings as written; what 014 gained, if anything; whether the wire moved; the finalization evidence's source; the deferral red-proof; files outside your layers touched; gates on the tip; anything GOAL.md or the A/S reports got wrong. Under ~60 lines.
