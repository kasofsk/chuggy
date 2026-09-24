# Task B (PR 8c-1) — the writer takes the package's commands, stores refusals with their payload, and the wire carries them

Branch `model/ticket-commands`, tip `cdc7ead7` (A merged with S). Setup: `_setup.md` beside this file (read it first; it is part of this brief) — **except** the branch step: `git fetch origin model/ticket-commands && git checkout model/ticket-commands` once, and confirm `git log -1 --oneline` is `cdc7ead7`. Use your own postgres: `docker run -d --name chuggy-check-postgres-8c-b -e POSTGRES_PASSWORD=chuggy-check -p 55441:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55441; remove it when done.

Read, in order: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c — split", §"PR 8c-1 — decisions" and every 8c-1 progress line after them (the corrections A and S forced are there), `pr8/tasks/8c-1/A-report.md` and `S-report.md` (your site lists and the spellings), `pr8/survey.md` §2, §7 and surprises 4–6, `pr8/tasks/8b/B.md` and `B-report.md` (this task's shape in 8b), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/`, `src/contract/`, `test/contract/{representations.ts, contractDocument.json}`, and the tests of all of them under `test/`; 015 (unlanded, S's) only where an alignment below needs it.

- **The envelope (decision 4).** The interpreter's `TicketCommand` becomes `ProjectCommand`; its `Decide` arm carries `ticketCommand: TicketCommand` (A's; S named the field — `command` is the discriminator). Every reader and fixture follows; the stored text changes (the wipe empties it).
- **The command map (decision 5).** One pure interpreter function from a `ProjectCommand` and the materials the adapter read to the `TicketCommand` the writer decides: release (8a's `releaseTicketEvent` folded in or renamed — say which), both dispatches with the observed source, a native-action answer, the finalizer's submission with `workCycle` and `generation` from the `finalization_request` row it names (decision 3), a completion. `readiness.ts` reads rows and calls it; nothing under `src/adapters/` constructs a `TicketCommand` literal — confirm by grep and quote it.
- **Refusals (decision 6).** The writer journals a `TicketDecided` and refuses a `TicketRefused` with its code and payload, no journal row; `RefusalCode` per decision 6 with `NotEnabled` and `CommandUnreadable` gone and `allRefusalCodes` matching 015's CHECK exactly; `decision_input`'s payload column written in the codec's spelling. Every site that produced `NotEnabled` now produces the domain refusal `decide` returned; if a site refuses for a reason `decide` does not decide, say which and what it now answers.
- **The wire (decision 6).** `operationRefusalCodes` per decision 6; the operation response's `Refused` arm carries `refusal`, a strict schema per domain code, absent for a boundary code, ticket numbers in the wire's ticket spelling and a task in the spelling the wire already uses for tasks (name it). `outcomes.ts` and `nativeReads.ts`/`nativeWeb.ts` follow. The contract document and `representations.ts` regenerated. The public mutations do not change.
- **The door and reports.** Every TypeScript builder or reader of a `TaskTerminalReport` spells `ticket` in the arm (the scheduler's completion path, fixtures), and every fixture journalling a report follows.
- Tests: each reachable refusal answered on the wire with its payload (a dispatch over an undone dependency names it; a stale completion is `TaskNotCurrent` with its task; a finalization result for an old generation is `FinalizationNotCurrent` with the cycle and generation); a boundary refusal carries no payload; `i3`/`ticketServiceRun`/`projection` end to end Work → Evaluation → Done.
- Comments: nothing says decision event where it now means a command, or `NotEnabled`.

NOT yours: `model/`, `src/domain/`, `src/actor/`, `src/generated/`, `ui/`. If a compile forces an edit there, make the smallest one and list it. `ui/`'s reds from the roster change are C's; list them by file.

## Gates on the tip

`check-source` (list `ui/` reds as C's and `test/rig` playwright errors as environment), `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-random`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. One gate at a time; kill orphaned `node --test` children before `check-postgres`. Report each exit.

## Report

Tip; what changed per layer; the wire's `refusal` schema per code, quoted; where the command map lives and the grep; what each former `NotEnabled` site answers now; what 015 gained, if anything; files outside your layers touched; `ui/` sites C must answer, by file:line; gates on the tip; anything GOAL.md or the A/S reports got wrong. Under ~60 lines.

## Orchestrator notes (after A and S)

- The `Decide` field is `ticketCommand` (S's const `decideField`), not `command`.
- `event_schema_version` stays 1 (the wipe empties the journal; semantics 8 gates replay) — do not move it.
- `submit_finalization_result` builds no `TicketCommand`: the writer builds `ReportFinalizationResult` from the `SubmitFinalizationResult` envelope (decision 3's `workCycle`/`generation` from the request row).
- A release naming a Revoked dependency is now admitted by `decide` (the package's rule). If a boundary check (`draftReleaseReadiness` or similar) refused it on the old enablement, say so; do not add a refusal.
- S's `sessionStoreRows` timeout under load was unconfirmed; if it recurs in your `check-postgres`, run the gate once more and report both.
