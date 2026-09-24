# Review round 1, machine half — PR 8c-2 "Update" (tip a26bf034, branch `model/ticket-update`)

Setup: `_review-setup-8c-2.md` beside this file (part of this brief). Your half: `model/`, `test/golden`, `src/generated`, `src/domain`, `src/actor`, their tests, `.chug/tasks/{check-random,check-conformance,emit-goldens}.test.sh`. Diff: `git diff b6e5b4fb..a26bf034 -- <your paths>`.

Read first: `pr8/GOAL.md` §"PR 8c-2 — decisions" and every 8c-2 progress line, `pr8/tasks/8c-2/{A,S,C}-report.md`, the package's `model/ticket-domain/ticket.qnt` 70–115, 150–200, 495–525, 880–915, 1230–1245, `.chug/tasks/review-change.md`, `CLAUDE.md`.

Check, each with a failure that actually happens:
1. `decideUpdate` and `evolve`'s `TicketUpdated` arm against the package line by line (order of refusals, payloads, revision arithmetic, identity when not owed); `revisionsAccounted` and `definitionsWellFormed` state what the package states and nothing it doesn't.
2. The no-wipe claim (decision 3): does `storedBeforeUpdate.test.ts` actually exercise stored text through the decoder (would it fail if `revision` were required on decode, or if `TicketCreated`'s evolve set a revision other than 1)? Red-proof one.
3. `graphEquals`/`ticketEquals` see `revision`; replay legality's `eventPayloadTicketAgrees` for `TicketUpdated`.
4. Goldens re-emitted, not hand-edited; each decision-9 scenario present; `coverage.test.ts` fails when an update refusal is dropped; the directed `refuseUpdate` meaningful.
5. Gates: `check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`, and the shell suites of those gates.

Verdict: APPROVE or CHANGES; findings with file:line, input, what goes wrong; under ~60 lines.
