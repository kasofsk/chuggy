# Task A (PR 8c-2) — `UpdateTicket`, `TicketUpdated` and `Ticket.revision` in the model and its mirror

Branch `model/ticket-update` off `origin/main` b6e5b4fb. Setup: `_setup.md` beside this file (read it first; it is part of this brief).

Read first: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-2 — decisions" (2, 3 and 9 are yours to build; the rest say what the other layers do with what you make; do not reopen them, but say in the report where one cannot be built as written and what you built instead), the 8c-1 decisions and progress lines above them (what the tree holds now), `pr8/survey.md` §4 and surprise 7, the package's `model/ticket-domain/ticket.qnt` lines 70–115, 150–200, 495–525, 880–915, 1230–1245, `pr8/tasks/8c-1/A-report.md` and `F-report.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, `.chug/tasks/{check-conformance,check-random,emit-goldens}.test.sh`, and every test of those.

- **Types (decision 2).** `UpdateTicket` in `TicketCommand`, `TicketUpdated` in `TicketEvent`, `Ticket.revision`, verbatim in spelling. The three sentences 8c-1 wrote saying the update-only refusals are unreachable go.
- **`decide` and `evolve`.** `decideUpdate` and `evolve`'s `TicketUpdated` arm the package's, over chuggy's `Ticket` record; `TicketCreated` sets `revision` 1; nothing else touches it. `commandValid`'s `UpdateTicket` arm the package's plus chuggy's bounds. The machine draws updates (a changed definition, a stale revision, changed dependencies, an identity mismatch where the instance can draw one) so all four refusals and the accepted update are reachable; the release room (8c-1 F) does not apply to an update.
- **Invariants.** The package's revision invariant (`revision > 0`, and whatever `:1230-1245` states); "decided events are never identity" holds for `TicketUpdated`; `decisionValid` for an update (no obligations). `check-model` clean (slow; once at the end; log to a file and give its path).
- **No wipe (decision 3).** Prove that a journal stored by 8c-1 replays legal and to the same graph under the new `evolve`, with `revision` 1 on each created ticket: a test that takes a golden's rows as 8c-1 emitted them (check them in as a fixture from `git show origin/main:test/golden/...`) and replays them. `decisionSemanticsVersionCurrent` stays 8. If this cannot hold, stop and report.
- **Goldens (decision 9).** Re-emitted; the corpus carries an update then a dispatch that runs the updated definition, a stale `expectedRevision` refused, a dependency change refused, an update after dispatch refused `TicketNotPending`, and identity mismatch if drawable. Extend `test/golden/corpus.ts`; say which golden carries what. Every refusal now reachable is compared model ↔ TypeScript and `coverage.test.ts` asserts all thirteen fire. Run every `.chug/tasks/*.test.sh` suite of a gate you touch (8c-1 missed one: `check-conformance.test.sh` assumed a golden's first step). `check-conformance` and `check-random` clean.
- **Generated mirror and TypeScript.** Codecs; `src/domain/` decider, `evolve`, invariants, equality (`graphEquals` sees `revision` — 8a round 1 found `*Equals` blind to a new field); `src/actor/` constructor `updateTicketCommand`.
- Unit reds outside your layers are B's and C's — list them by file.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report reds that are B's by file; `test/rig` playwright errors are environment), `check-figures`, `check-comments`, `check-paths`, `check-duplication`, and the shell suites of the gates you touched. Exit codes in the report.

## Report

Tip; what changed per layer; **the generated spelling of `UpdateTicket`, `TicketUpdated` and `Ticket.revision`, quoted exactly as the codec encodes them** (S and B build on them); the no-wipe proof (which test, over which rows); which golden carries each scenario; what B must change, by file:line; files outside your layers touched; gates on the tip; anything GOAL.md got wrong. Under ~60 lines.
