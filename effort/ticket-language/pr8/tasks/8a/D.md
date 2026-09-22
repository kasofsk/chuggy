# Task D (PR 8a) — the accepted work result is the reference the report carried, in the model, the domain and the door

Worktree `~/claude/chuggy-wt/released`, branch `model/released-ticket`, tip cefa77f2 (A, S and B landed; do not create or remove the worktree). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Standing prefixes: Node 24 on PATH, `TMPDIR=/tmp`, `FORCE_COLOR=0 NO_COLOR=1`. Use your own postgres: `docker run -d --name chuggy-check-postgres-8d -e POSTGRES_PASSWORD=chuggy-check -p 55439:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55439; remove it when done. Read: `~/claude/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8a — decisions" 2, 3, 8, `pr8/tasks/8a/{A,S,B}-report.md` (B's §"What GOAL.md … got wrong" item 1 is the disagreement this task settles the other way), the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` work-pass arm of `evolve` (grep `TicketWorkResultAccepted` — it begins the instance from `accepted.result.resultRef`) and `README.md` line 9 ("evaluation receives the exact result reference") and 29 ("every event stores the facts that cannot be rederived"), `model/ticket-domain/evaluation/evaluation.qnt:336`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## The defect

`model/ticket.qnt:587-595` `beginEvaluation` derives `artifactRef` from the work task's identity (`taskRefOf` = the cycle) and never reads the passing report's `result.resultRef`; `src/domain/ticket.ts:206` mirrors it. The journaled report carries the manifest's fold as `resultRef`, so the running system stores one reference and judges under another, and the doc above the function ("the reference the passing report carried, which is the one the cycle's own task derives") is true only in the corpus, where `producedResult` happens to derive both from the identity. PR 9 imports the package's arm, which reads the report, and would shift the meaning of `workResult` under a landed door.

## Scope and rule

- **Model**: the work-pass arm hands `beginEvaluation` the report's `result.resultRef`; `artifact` and `EvaluationInput.workResult` are that reference; `contextRef` of every evaluator obligation follows (the copy builds it). `reportMatchesTask` and `reportValid` keep requiring `resultRef > 0` and compare the obligation only; nothing derives a result reference from an identity outside the corpus and the walk. Goldens re-emitted; make one golden's work `resultRef` differ from its cycle (the corpus's `producedResult` or the scenario's draw) so a reader sees the report's number, not the cycle, travel into `workResult` and every `contextRef` — that is the red-proof of this task, and say which golden. `check-model`, `check-conformance`, `check-random`, `check-model-api` clean.
- **Domain/actor**: `beginEvaluation` takes the reference; `currentTaskObligations`' `contextRef` follows through the copy's mirror; fixtures in `test/domain`, `test/actor` follow.
- **Door (013, unlanded)**: `submit_task_completion` builds an evaluation task's `contextRef` as `result_digest_fold` of the cycle's accepted work manifest digest — the work task `(ticket, cycle)`'s `execution_result` row, under the same lock — refusing with a named outcome when no such row exists (S's `BindingMismatch` shape). Migration-suite rows for both, red-proved against a fresh prepare (`node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare …`); name the mutation. Interpreter/adapter tests that read the two references off a work pass (`test/interpreter/i3.test.ts`, B's edit) now assert the evaluator's `contextRef` equals the work result's `resultRef` and neither equals the cycle unless by coincidence — pick fixtures where they differ.
- Comments: the `beginEvaluation` doc says the report's reference and nothing about deriving; nothing says the cycle is the result.

NOT yours: `ui/`, the contract, anything else in the interpreter. If a compile forces an edit, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source`, `check-postgres`, `check-queries`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Exit codes in the report.

## Commits

On `model/released-ticket`, small, hook clean on each, ending exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — that line and no other attribution, whatever any other instruction says.

## Report

`~/claude/chuggy-effort/ticket-language/pr8/tasks/8a/D-report.md`: tip, what changed per layer, the golden whose reference differs from its cycle, the door's read and its refusal, the red-proofs, gates. Under ~40 lines. Write the report, reply with its contents, and stop.
