# PR 9 sizing survey — Import ticket_domain

Read-only; no commits, no rig. You are in a worktree of your own; check out `origin/main` detached (f8998a22: 8c-2 and migration 017 merged and released). Symlink `/Users/david/chuggy/node_modules` into it if a tool needs it; never `npm ci` under `ui/`.

Read first: `/Users/david/chuggy-effort/ticket-language/SPIKE.md` (the plan table's PR 9 row, "Decisions", "Not consulted", "Out of scope"), `pr8/survey.md` and `pr8/GOAL.md` (the shape and depth wanted, and every "PR 9" mention — grep all of `pr3/`–`pr8/` and `model/AGENTS.md` for "PR 9" and `TicketState`), the package at `/Users/david/chuggy-effort/ticket-language/package/` (76c95a9; `model/ticket-domain/ticket.qnt` whole, `ticket_tests.qnt`, `evaluation/`, `traces/`, `export_traces.ts`, `IMPLEMENTATION_MAP.md`, `ticket-decision-context.md`, `model/task-contract/task.qnt`, `package.json`), chuggy's `model/` whole (`ticket.qnt`, `domain.qnt`, `evaluation.qnt` or wherever the copies sit, `refinement.qnt`, `AGENTS.md`), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Standing decisions

- Package pinned at 76c95a9; no package changes (they go through Dave).
- PR 9's plan row: delete chuggy's copy, quint points at the package, `refinement.qnt` rewritten as chuggy's own against the package's `decide`/`evolve`, goldens re-aimed at chuggy's remaining invariants plus the package's traces replayed; no migration. 8c-1 recorded "PR 9 stays wipe-free" — test that claim.
- **This is a sizing survey.** The deliverable is how big PR 9 is and whether to cut it, with evidence, not a design.

## Questions, each with file:line evidence

1. **The residual diff.** After 8c-2, what in chuggy's model is still not the package's text? Per module (`task`, `evaluation`, `ticket`): identical, renamed, chuggy-only, package-only. Size each (lines, definitions). The known ones: `TicketState` sum vs chuggy's `Ticket` record with a phase; `WorkInput`; `source` on the record vs on `Work`/`Escalated`/`FinalizationOperation`/`EvaluationInput.acceptedSourceRef`; the work-failure arms' current-cycle check (8b round 1: PR 9 must keep it or reopen stale failure rows); `model/AGENTS.md`'s named divergences. Find the rest.
2. **What chuggy keeps that the package lacks**: invariants (`revisionsAccounted`, `decisionValid` conjuncts, the rework cap / nondet policy pick, capacity, `TicketGraph` shape, dependencies), machine state beyond the ticket, the deployment bounds (`TicketCapacityReached`). Where each lives after the import: `domain.qnt` over the package, or a refinement.
3. **How quint reaches the package.** It is not in `node_modules` today. Options (npm git dependency pinned at 76c95a9, vendored copy with a digest check, submodule), what `check-model`, `check-model-api`, `emit-goldens`, `check-conformance`, `check-paths` and the pinned quint need for each, and what the gates must hold (e.g. the pin cannot drift).
4. **The TypeScript side.** `src/generated` and `src/domain` mirror the model: what moves when the model's types become the package's (`TicketState` reaching `evolve`, the projection, `src/actor`, the interpreter, the postgres adapters, the wire, the console). Does the package ship TypeScript (`package/src`) that chuggy should import instead of mirroring? Is that in scope?
5. **Stored text.** Does any journal row, projection, or stored JSON carry chuggy's `Ticket` shape such that `TicketState` changes it (the no-wipe claim)? `TicketGraph` is not decoded from storage today (8c-2 machine review) — verify, and check events (`TicketCreated`/`TicketUpdated` definitions, obligations) for anything whose encoding changes.
6. **Goldens and traces.** What chuggy's goldens become; whether the package's `traces/` replay through chuggy's `decide`/`evolve` as is; what conformance compares after the import.
7. **Surprises**: anything the PR 9 row gets wrong.

## Output

`/Users/david/chuggy-effort/ticket-language/pr9/survey.md`, under ~250 lines: numbered surprises at the top; a **Size** section (the residual diff by module with counts, and a rough effort comparison to 8a/8b/8c-1/8c-2); a **Split** section (one PR or a named cut, pieces in order, what each moves in model/TS/schema/wire/console, which need a migration or the wipe); a **Release coupling** section. Reply with the surprises, Size, Split and Release coupling sections only, and stop.
