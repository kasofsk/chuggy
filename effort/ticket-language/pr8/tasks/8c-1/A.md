# Task A (PR 8c-1) — the decider takes the package's `TicketCommand` and refuses in its thirteen words

Branch `model/ticket-commands` off `origin/main` e78a93ce. Setup: `_setup.md` beside this file (read it first; it is part of this brief).

Read first: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c — split" and §"PR 8c-1 — decisions" (1, 2, 8, 10 and 11 are yours to build; 3–7 and 9 say what the other layers do with what you make; do not reopen them, but say in the report where one cannot be built as written and what you built instead), the 8b decisions and progress lines above them (what the tree holds now), `pr8/survey.md` §1, §2 and surprises 4–6, the package's `model/ticket-domain/ticket.qnt` lines 70–160, 230–300, 470–845 and 1340–1363, `pr8/tasks/8b/A-report.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, and every test of those.

- **Types (decisions 1, 2).** `TicketCommand` (the package's arms minus `UpdateTicket`), `TaskTerminalReport` with `ticket` in every arm, `FinalizationResultReport` and the package's `FinalizationResult` sum (chuggy's `FinalizationOutcome` goes), `TicketRefusal` and its payload records, `TicketDecision`, verbatim in spelling. `DecisionEvent` is deleted from the model, the mirror and `src/`; nothing in your layers keeps the name.
- **`decide` (decision 2).** Returns `TicketDecided({ event, obligations }) | TicketRefused(TicketRefusal)`, each decider checking in the package's order and computing the payload; `commandValid` the package's plus chuggy's bounds. `decisionEventEnabled` and its TypeScript mirror are deleted; wherever the machine, the refinement or the actor asked enablement, it asks whether `decide` refused. A refused decision journals nothing and changes nothing; say how the machine treats one (a stutter, or excluded from the step) and why. `FinalizationNotCurrent` fences `workCycle` and `generation` (decision 3). The 8b work-failure exception stays and refuses `TaskNotCurrent`.
- **Invariants.** `decisionValid`'s refused arm; "decided events are never identity" keeps holding for `TicketDecided`; every refusal the instance can reach is reached (a witness per reachable arm; the three update-only arms declared and unreachable — say so where they are declared, in one sentence). `api.qnt` gains the `Api*` aliases the mirror needs. `check-model` clean (slow; once at the end; log to a file and give its path).
- **Goldens and conformance (decision 10).** Thirteen goldens re-emitted in the new command spelling. Every reachable refusal compared model ↔ TypeScript, in a golden or a table the model emits; say which, and which refusal is carried where. `check-conformance` and `check-random` clean (re-pin the seed if draws moved, and say so).
- **Generated mirror and TypeScript.** `src/generated/model-api.ts` codecs; `src/domain/` deciders with refusals, enablement deleted or reduced to what `decide` does not cover (say what is left and why); `src/actor/` follows; `decisionSemanticsVersionCurrent` 8; `event_schema_version` per decision 8 — find what names it and say whether it moved.
- Unit reds outside your layers (`src/interpreter`, `src/adapters`, `src/contract`, `ui/`) are B's and C's — list them by file.
- Comments: nothing says decision event or enablement where it now means a command or a refusal.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Exit codes in the report. `check-source`'s `test/rig` typecheck needs `@playwright/test`, which this machine's `node_modules` lacks: list those errors as environment and do not add the dependency.

## Report

Tip; what changed per layer; **the generated spelling of `TicketCommand`'s six arms, `TaskTerminalReport`'s three, `FinalizationResultReport`, and `TicketRefusal`'s thirteen with their payloads, quoted exactly as the codec encodes them** (S and B build on them); how the machine treats a refusal; where each refusal is compared model ↔ TypeScript; what B must change, by file:line; files outside your layers touched; gates on the tip; anything GOAL.md got wrong. Under ~70 lines.
