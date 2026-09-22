# Task A (PR 8a) — the released ticket: the definition, the source, and the report that carries its obligation

Worktree `~/claude/chuggy-wt/released`, branch `model/released-ticket` off `origin/main` (PR 7b merged; confirm `git log -1 origin/main` is aaaff1ec "Merge pull request #731"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b model/released-ticket ~/claude/chuggy-wt/released origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/released/node_modules

Never `npm ci` under `ui/`. Standing prefixes: Node 24 on PATH, `TMPDIR=/tmp`, `FORCE_COLOR=0 NO_COLOR=1`. Read first: `~/claude/chuggy-effort/ticket-language/pr8/GOAL.md` §"The split" and §"PR 8a — decisions" (1–3, 10 and 11 are yours to build; do not reopen them, but say in the report where one cannot be built as written and what you built instead), `pr8/survey.md` §1, §5, §6 and surprises 1, 3, 9, 12, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` lines 1–110 (the types), 250–275 (`releasedTicketValid`), 345–432 (inputs and obligations), `decideDispatch`, `applyWorkReport`/`applyTaskReport` and the `evolve` arms that carry `source` (grep `source` and `acceptedSourceRef`; you carry the same value on one field, decision 2), its `README.md` lines 5–13 and 29–31, `model/task-contract/task.qnt` (already verbatim in the tree), `pr7/tasks/7b/A-report.md` (what the tree holds now, and the shapes 7b left), `pr6/tasks/6b/A.md` and `A-report.md` (the copy precedent and `model/AGENTS.md`), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, and every test of those.

- First commit: `model/ticket-domain/evaluation/evaluation.qnt` made VERBATIM (`diff` against the package empty, in the report) and `model/AGENTS.md` rewritten to say so (the six-line list goes; the verbatim rule stays for both copies). Everything that fails to typecheck after that commit is what the rest of the task builds.
- `ReleasedContent`, `ReleasedTicket`, `Ticket.definition`, `Ticket.source` (decisions 1, 2). `deps` and `program` gone from the record; every reader goes through the definition. `releasedTicketValid` per decision 1; `programsWellFormed` becomes its plan half.
- `CreateTicket(ReleasedTicket)` (the `id` is the ticket), `Dispatch({ ticket, source })`, `TaskDone.report`'s two produced arms carrying a `ValidatedTaskResult` (decision 3). `decideDispatch` sets `source`; the work-pass arm replaces it with `acceptedSourceRef` and begins the instance with the copy's full `EvaluationInput`; rework, needs-work, resume and finalization read it. `reportMatchesTask` is the exact-obligation comparison; `workTaskObligation` is chuggy's twin of the package's (`ticket.qnt:380-390`), and an evaluator's owed obligation is what the copy's `currentTaskObligations` yields. A failure report matches by identity as today.
- Invariants: `sourcePinned` (decision 2); the copy's `invariant` with `acceptedSourceRef > 0` holds of every instance; `releasedTicketValid` of every ticket's definition; `evaluationsMonotone`, `idsAccounted` and the rest untouched in meaning. `refinement.qnt`, `api.qnt` (the `Api*` aliases the mirror needs — `ReleasedTicket`, `TaskDefinition`, `ValidatedTaskResult`, `TaskObligation`), tests, mc follow. `check-model` clean (slow; once at the end, log under `pr8/check-model-8a-A.log`).
- Goldens re-emitted; the corpus carries decision 10's five shapes. Extend `test/golden/corpus.ts` scenarios if the existing ones cannot, and say which; the corpus's definitions use small distinct positive ints so a reader can see a ref travel (a source `7` becoming an accepted `8` in the instance). `check-conformance`, `check-random` clean (re-pin the seed if draws moved, and say so).
- Generated mirror; `src/domain/{ticket,task,invariants,deciders,enablement,…}.ts`, `src/actor/{decisionEvent,equality,…}.ts` follow. The refusal for a mismatched obligation is the domain's not-enabled, as today.
- Unit reds outside your layers that are exactly B's sites (`src/interpreter`, `src/adapters`, `src/contract`) are B's — list them by file.
- Comments: nothing says `deps`, `program`, `prog`, or a source observed at a spawn; the `source` field's doc and the definition's doc are two sentences each and name where the package puts each value.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Exit codes in the report.

## Commits

On `model/released-ticket`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr8/tasks/8a/A-report.md`: tip, the copy's diff against the package (empty), what changed per layer, the generated spelling of `ReleasedTicket`, `Dispatch`, the two produced report arms and `ValidatedTaskResult` (S and B build on them — quote the codec's field names and nesting exactly), what B must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~60 lines. Write the report, reply with its contents, and stop.
