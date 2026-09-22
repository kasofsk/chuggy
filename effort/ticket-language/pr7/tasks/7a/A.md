# Task A (PR 7a) — the program is a plan: keyed evaluators in the model and its mirror

Worktree `~/claude/chuggy-wt/evkeys`, branch `model/evaluator-keys` off `origin/main` (PR 6b merged; confirm `git log -1 origin/main` is e9a6136e "Merge pull request #729"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b model/evaluator-keys ~/claude/chuggy-wt/evkeys origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evkeys/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7a — decisions" (decisions 1–4 are yours to build; do not reopen them, but say in the report where one cannot be built as written), `pr7/survey.md` §1, §2 and surprises 2, 3, 4, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/evaluation/evaluation.qnt` lines 1–60 and `taskIdentityFor`/`evaluatorKeys`/`planValid` (the spelling and the validity rule you restate), `pr6/tasks/6b/A.md` and `A-report.md` (this task's shape in 6b: the gates it ran, where the seed moved), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, and every test of those.

- `model/ticket.qnt`: `EvaluatorDefinition`, `StageDefinition` as decision 1; `evaluationTaskOf` by stage key and evaluator key (decision 3); `spawnEvalStage(j, ticket, s)` reading `program[s]`; `stageGeneration` at the stage's first listed evaluator key; `retireLive` in ascending evaluator-key order; `tasksWellFormed` by `evaluatorKeys`; `evalStage` justified by positional stage keys. `model/domain.qnt`: `stageChoices`/`validPrograms`/`defaultProgram` over the new vocabulary (`N_TASKS` is the evaluator-key bound; every non-empty ascending list of keys from `1..N_TASKS` is a stage's choice, so the walk draws sparse stages such as `{1, 3}`); `programsWellFormed` as decision 2, positional stage keys included; the three `.fanout` reads at the spawn sites; the width invariant at `:948`. `refinement.qnt`, `api.qnt`, `tests/`, mc as needed. `check-model` clean (slow; once at the end, log under `pr7/check-model-7a-A.log`).
- Goldens re-emitted; `manifest.json` follows; `check-conformance`, `check-random` clean (re-pin the seed if draws moved, and say so). At least one golden must carry a sparse stage — if the corpus's scenarios cannot, say which scenario you extended and why.
- Generated mirror; `src/domain/{ticket,task,invariants,deciders,config,enablement}.ts` and `src/actor` follow. `taskOrdinal` goes or becomes position-in-set; `tasksInOrdinalOrder` orders by evaluator key. Every unit test that built a `{fanout}` stage builds `{key, evaluators}`; at least one pins a sparse stage through spawn, resolve and retire, and one pins that `retireLive` of `{1, 3}` keeps both tasks (survey 3's failure, red-proved).
- Unit reds outside your layers that are exactly B's sites (`src/interpreter`, `src/adapters`, `src/contract`) are B's — list them by file.
- Comments: nothing says a stage is a width or that evaluators are numbered one to a count; `ticket.qnt`'s stage doc says what a key is and that stage keys are positional by chuggy's rule until the instance stores an index (decision 2), in one sentence.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`. Exit codes in the report.

## Commits

On `model/evaluator-keys`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7a/A-report.md`: tip, what changed per layer, the shape of `StageDefinition` in the generated mirror (B and C build on it), what B and C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~50 lines. Write the report, reply with its contents, and stop.

## Addendum (orchestrator, 2026-09-22): continuation after an outage

A first agent built the model commit 12715708 ("a stage lists the evaluators it fans out to, by authored key") on `model/evaluator-keys` in `~/claude/chuggy-wt/evkeys`, then left **uncommitted** edits across `src/generated/model-api.ts`, `src/domain/{generated/modelTypes,config,deciders,enablement,invariants,task,ticket}.ts`, `src/actor/equality.ts`, `test/actor/{equality.test,harness}.ts`, `test/itf/vocabulary.ts` and `test/random/draws.ts` (its last words were "Now the generated mirror") before repeated server errors ended it. The worktree already exists: do **not** recreate it; `git -C ~/claude/chuggy-wt/evkeys status` and `git diff` show where it stopped. Read the model commit and the uncommitted diff as a reviewer would before continuing: keep what is right, fix what is not, and say in the report which of the earlier agent's edits you changed. `src/generated/` and `src/domain/generated/` are emitted (`.chug/tasks/` has the emitter; check how 6b's A-report regenerated them) — regenerate rather than hand-edit if the diff there looks hand-made. Task S has landed at d208b133 on `schema/evaluator-keys`: 011's `CreateTicket` arm admits `{"key": N, "evaluators": [{"key": N}, …]}` per stage, so keep those field names exactly. Goldens are not yet re-emitted.
