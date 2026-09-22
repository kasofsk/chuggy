# Review round 1, machine half — PR 6b "Structured task identity" (branch `model/task-identity`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/6b-ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/identity-review-machine <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-review-machine/node_modules

Never `npm ci` under `ui/`. Your half: `model/`, `test/golden`, `src/generated`, `src/domain`, `src/actor`, `src/interpreter`, `src/adapters`, `src/contract`, `src/adapters/postgres/schema/migrations/010-task-identity.ts`, and their tests. The surface half (`ui/`, `test/ui`) is another reviewer's. Diff: `git diff 1e986583..<tip> -- <your paths>`.

Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" and the progress lines that correct them (generation is derived; `stage` is the positive key in the column), `pr6/survey.md` §1–§3 and surprises 2–9, `pr6/tasks/6b/{A,S,B}-report.md`, the package's `~/claude/chuggy-effort/ticket-language/package/model/task-contract/task.qnt`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The copy: `model/task-contract/task.qnt` byte-identical to the package's (`diff`); nothing else under `model/` redefines a name it exports; the neighbouring doc (`model/AGENTS.md`) says what has no caller yet and is true.
2. The model: every spawn site names an identity the package's `taskIdentityValid` admits; `workCyclesStarted` increments exactly at `spawnWork` and `idsAccounted` holds it to the record; `stageGeneration` — construct the resume edge A names (`ResumeEvaluation` into a stage the cycle already ran) and check that the new identities are not already in the record, and that a stale `TaskDone` naming the retired identity is not enabled. Is there any other edge where two live-or-retired tasks share an identity? `retireLive`'s `taskOrdinal` order against what the finalizer takes.
3. Goldens re-emitted, not hand-edited (`emit-goldens.sh` reproduces them byte for byte); the `TaskDone` draw in `test/random/draws.ts` covers both arms; `check-conformance`, `check-random` at the tip.
4. The mint (`decisionPlan.ts requestTasks`): injective and monotone per ticket across a resume at generation 2 and across a rework — the unique `(tenant,project,ticket,task)` and `ON CONFLICT DO NOTHING` (`scheduler.ts`) turn a repeat into a silently dropped obligation; build the case. `stage` sent as the positive key everywhere S lists; `taskKindDefaults["Evaluation:<stage>"]` keyed the same way; the pod document golden unchanged or its change justified.
5. 010: guard byte-identical to 008's; the `execution_request_task` CHECK per arm against `taskIdentityValid`; three column grants sufficient for every API read that touches the columns (run one as `chuggy_api`); `submit_task_completion` journals the identity off the row under the same lock — construct two executions for one ticket and check each completion names its own; `decision_event_is_valid` refuses `tid`; render-diff 001–009 main vs branch empty; pick three of S's assertions and re-prove them by mutation.
6. Stored text: every reader of a `TaskDone` as opaque text parses the new shape (`wire.ts storedSchedulerCompletion`, anything under memory `stored-text-outside-the-journal.md`); old rows are wiped, no lift.
7. Comments and docs: true, in the tree's voice, no quantities, no stale path claims; nothing still calls the integer the task's identity. Run `check-figures`, `check-comments`, `check-paths`, `check-boundaries`, `check-queries`, `check-postgres` at the tip.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/6b-round1-machine.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~80 lines. Remove your worktree and drop any database you made. Write the verdict, reply with it, and stop.
