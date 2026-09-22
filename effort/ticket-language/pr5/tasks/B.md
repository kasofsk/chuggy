# Task B — the sum in the interpreter, the adapters, the contract and their tests

Worktree `~/claude/chuggy-wt/escsum`, branch `model/escalation-sum`, which carries A (model, goldens, domain, actor, semantics 6 alone) merged with S (migration 008, the boundary rewrite, the wipe). `node_modules` is linked; never `npm ci` under `ui/`. Read, in order: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` (decisions are settled), `pr5/survey.md` (§2, §4, §5 and surprises 3, 6, 7, 9 are your map), `pr5/tasks/A-report.md` and `pr5/tasks/S-report.md` whole (what landed, the reds left for you by file, and S's "What B must know"), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres reads and writes, kubernetes, supplied, http), `src/contract/` (rosters, responses, wire), and their tests under `test/`:

- `TicketProjection`: `escalation` and `escalationEvidence` replace `reason` and `resumeAt` (`projectDecision.ts`, `projectWriter.ts projectionOf`, `decision.ts` upsert at the new columns, the desk insert at `native_action.escalation`).
- **Evidence** (GOAL "Evidence lives on the projection"): the writer fills `escalationEvidence` from what the interpreter holds — an execution block's `blocked_reason` (the scheduler completion; S's event no longer carries it, so read it from the completion/execution the plan already has) or the continuation path's `GitEvidence` name (`projectWriter.ts:510-530`, survey 7); a finalization unavailable's submission `kind` (`wire.ts checkedFinalizationSubmission`, survey 6). `nativeReads.ts` reads the two columns and drops the two correlated subqueries; `check-queries` must agree.
- **The wire folds**: `ticketResponseSchema` loses `reason`, `resumeAt`, `executionBlockedBy`, `finalizationBlockedBy` and gains optional `escalation: { kind, evidence?, resumeAt }`; `escalationReasons` → `escalationKinds` (five); `blockedReasons`, `finalizationUnavailableKinds`, `resumePoints` stay; `nativeWeb.ts TicketResource` follows; the contract document/fixtures follow. `resumeAt` in the object is `resumeOf(kind)` from the domain — derived at the read, never stored.
- `decisionPlan.ts:188-190`: a native action's resolutions are always both.
- `wire.ts`: A already removed the lifts; confirm `storedSchedulerCompletion` builds the event with the ticket alone and that nothing else in your layers names a reason literal, `resumeAt` or `resume_at` (`git grep -n "resumeAt\|resume_at\|\.reason\b\|escalationReasons\|executionBlockedBy\|finalizationBlockedBy" src/interpreter src/adapters src/contract`).
- Tests: A's list (`test/contract/rosters.test.ts`, `test/interpreter/{dispatchWriter,i3,projection,wire}.test.ts`) and S's list (seven `test/postgres/` fixture files naming `reason` in INSERTs; `privileges.test.ts:789` column list; `ticketProjection.test.ts:335` constraint name; `migration.test.ts` "baseline's index" case; and **`privileges.test.ts:349`, a false green** — its forged `ExecutionBlocked` carries a `reason` that 008 now refuses for shape, so the case passes without testing authority; drop the field so it tests what it claims).
- `src/adapters/postgres/schema/README.md` and comments in your layers naming the old fields.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/` (`test/ui/{resumePoint,ticketActions}.test.ts` are C's). If a compile forces an edit there, make the smallest one and list it.

## Traps

- The postgres gate on the starting tip **does not terminate**: `nativeReads.test.ts` and `readiness.test.ts` leave pooled clients idle in an aborted transaction after the projection insert fails, and the gate waits forever. Fix the inserts first; if you must run the gate before then, run those two suites alone with a timeout. If the harness leaving an aborted transaction open is a defect of its own, fix it and say so.
- Semantics 6 refuses every older row: no fixture or test may stamp a journal row below 6.

## Gates

`check-source` (unit + static), `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each exit on the tip. Console reds (`test/ui/*`, `check-console`) are C's; list them.

## Commits

On `model/escalation-sum`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr5/tasks/B-report.md`: tip, what changed per layer, where each evidence value comes from (file:line), the wire's escalation object with an example, files outside your layers touched, the reds left for C, gates on the tip, anything GOAL.md got wrong. Under ~60 lines.
