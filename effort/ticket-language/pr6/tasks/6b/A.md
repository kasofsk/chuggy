# Task A (PR 6b) — the task contract's identity replaces the model's task id and kind

Worktree `~/claude/chuggy-wt/identity`, branch `model/task-identity` off `origin/main` (PR 6a merged; confirm `git log -1 origin/main` names "Work fan-out goes"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b model/task-identity ~/claude/chuggy-wt/identity origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" (decisions 1–3 and 5 are yours to build; do not reopen them, but say in the report where one cannot be built as written), `pr6/survey.md` §1, §2 and surprises 2–6 and 8, the package's `~/claude/chuggy-effort/ticket-language/package/model/task-contract/task.qnt`, `pr6/tasks/A.md` and `A-report.md` (this task's shape in 6a: the gates it ran, where the seed moved), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, and every test of those.

- First commit: `model/task-contract/task.qnt`, the package file byte for byte (`diff` it in the report). `ticket.qnt` imports it; chuggy's `TaskKind` goes; `Task = {identity: TaskIdentity, state: TaskState}`; `Ticket.workCyclesStarted`; `spawnWork` and `spawnOn` name identities as decision 2 says; `Ticket.spawned` stays. `resolveTask`, `retireLive`, `evalStage`, `reducibleWorkIn`/`reducibleEvalIn`, `decideTaskDone`, revoke, escalate and the four invariants go by identity; `taskIdentityValid` over every live task is a new invariant the goldens walk. `refinement.qnt`'s `TaskDone` carries `task: TaskIdentity` (no `tid`); `api.qnt` exports what the mirror needs. `check-model` clean (slow; once at the end, log under `pr6/check-model-6b-A.log`).
- Goldens re-emitted; `manifest.json` invariants follow; `check-conformance`, `check-random` clean (re-pin the seed if draws moved, and say so).
- Generated mirror; `src/domain/task.ts` (the record walk that derived the cycle from kind sequence is replaced by the identity's `cycle`), `ids.ts`, `enablement.ts`, `invariants.ts`, `deciders.ts`, `actor/decisionEvent.ts` (enablement of `TaskDone` by identity, decision 3). Unit reds outside your layers that are exactly B's sites are B's — list them by file.
- Comments: nothing says a task has a number; the copy's neighbouring doc (`model/AGENTS.md` or the module header of `ticket.qnt`, whichever the tree uses for such a claim) says the copy is verbatim and why (survey 5), and names what it imports and what it does not yet call.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`. Exit codes in the report.

## Commits

On `model/task-identity`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/A-report.md`: tip, what changed per layer, the shape of `TaskIdentity` in the generated mirror (B and C build on it), what B and C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~50 lines. Write the report, reply with its contents, and stop.
