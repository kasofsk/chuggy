# Task A (PR 8b) — the journal carries events: `TicketEvent`, `decide` with obligations, `evolve`, and the reduce folded into the completion

Branch `model/ticket-events` off `origin/main` 02bd9572. Setup: `_setup.md` beside this file (read it first; it is part of this brief).

Read first: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8b — decisions" (1–7, 11 and 12 are yours to build; do not reopen them, but say in the report where one cannot be built as written and what you built instead — decision 3's claim that no decided event is identity is one you must prove, and if it is false, stop and report the counterexample instead of weakening the check), `pr8/survey.md` §1, §3, §6 and surprises 1, 2, 9, 10, 12, the package's `model/ticket-domain/ticket.qnt` lines 150–245 (events, obligations, `TicketDecision`), 335–432, 846–1172 (`decide`, every `evolve` arm) and 1285–1363 (`obligationValid`, `obligationAgrees`, `obligationsUnique`, `decisionValid`), `pr8/tasks/8a/A-report.md` and `D-report.md` (what the tree holds after 8a), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, and every test of those.

- **Types (decisions 1, 2).** `TicketEvent` (the package's arms minus `TicketUpdated`) and its payload records, `Obligation` and its three records, verbatim in spelling. `Entry = { seq, event: TicketEvent }`. `StepRecord`, `Transition` and `Decision` are deleted from the model and the mirror; nothing keeps a positional effect list.
- **`decide` and `evolve` (decisions 2, 4, 5, 6).** `decide(graph, DecisionEvent, failurePolicy): { event, obligations }` over chuggy's `Ticket` record, one decider per arm as today but returning the package's event and obligations; `evolve(graph, TicketEvent)` arm for arm the package's, identity on a state that no longer owes the event. `DecisionEvent` loses `WorkReduce` and `TaskDone.onFailure`; a work completion decides the pass or the failure in one step; `decideWorkReduce`, `reducibleWorkIn` and whatever Work bookkeeping existed only to carry the pass go. Resume yields the three events by escalation. The machine's step is `decide` then `evolve`; its ghost is the last `{ event, obligations }`.
- **Invariants.** `decisionValid` of every reachable decision (package `:1349-1363` with its helpers, adapted to chuggy's record where `liveTaskList` reads the state); **decided events are never identity** (`evolve(g, decide(g, c).event) != g` whenever `c` is enabled) — the property decision 3's replay check rests on; everything standing today keeps its meaning. `refinement.qnt`: replay is `evolve` folded; `journalLegal` per decision 3. `api.qnt` gains the `Api*` aliases the mirror needs (`TicketEvent`, `Obligation`, their records). `check-model` clean (slow; once at the end; log to a file and give its path).
- **Goldens (decision 11).** Twelve re-emitted with the step schema `{ event, obligations }`. The corpus carries: a work completion that is one `TicketWorkResultAccepted` with the first stage's `ExecuteTask`s; the same failing stage under each policy (`TicketEvaluationReworkStarted` with a work `ExecuteTask`, `TicketEvaluationFailureEscalated` with none); the three resumes; a revoke's `CancelTask`s. An event applied to a state that no longer owes it is identity: a unit test (8a's `reportAdmissibilityRequiredTest` precedent) if no trace can carry it. Extend `test/golden/corpus.ts` if needed and say which scenarios. `check-conformance` and `check-random` clean (re-pin the seed if draws moved, and say so).
- **Generated mirror and TypeScript.** `src/generated/model-api.ts` codecs; `src/domain/` deciders, `evolve`, enablement, invariants; `src/domain/effect.ts` deleted with every reader in your layers; `src/actor/journal.ts` replay and legality per decision 3; `decisionSemanticsVersionCurrent` 7; `src/actor/decisionEvent.ts`, equality and the actor harness follow. `src/actor/obligations.ts`'s `Obligation` (a refinement predicate, survey 4) is renamed so the package's name is free — name what you chose.
- Unit reds outside your layers (`src/interpreter`, `src/adapters`, `src/contract`) are B's — list them by file.
- Comments: nothing says step record, transition, effect string, reduce or continuation; `evolve`'s doc says in two sentences that it applies an event only to a state that still owes it and where the package says so.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Exit codes in the report.

## Report

Tip; what changed per layer; **the generated spelling of `TicketEvent`'s seventeen arms, `Obligation`'s three and the `Entry` row, quoted exactly as the codec encodes them** (S and B build on them); the proof of "never identity" (which invariant, checked where); what B must change, by file:line; files outside your layers touched; gates on the tip; anything GOAL.md got wrong. Under ~70 lines.
