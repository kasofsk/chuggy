# Task B report — the width leaves the interpreter, the adapters and the contract

Tip `432678ad` on `model/work-fanout-goes`, four commits over `66fac4ca` (A+S merged): `c2053071` the
wire stops offering a work width · `0ffe0128` a dispatch candidate publishes no width · `33b4303c` the
mailbox bound follows the candidate down · `432678ad` no comment in these layers says work has a
fan-out. Commits carry `Co-Authored-By: Claude Opus 5 (1M context)`, not the brief's Fable line: the
session's attribution reminder names this model, as A, S and PRs 3–5 also reported.

## Per layer

- **`src/contract/`** — `authoringSchema.workFanout` gone (so a request body naming it is now refused,
  `authoring.ts:34`); `dispatchCandidateSchema.workFanout` and
  `draftInitializationResponseSchema.choices.workFanouts` gone (`responses.ts:693,823`); the cursor
  member gone (`http.ts:548`), which shortens `leadObservedCandidateCharsMax` and with it
  `sessionTurnInputCharsMax` — see the mailbox note below.
- **`src/interpreter/`** — `authoring.ts` loses the `workFanoutChoices` import, the `workFanouts`
  choice and the `workFanout: 1` default; `dispatchView.ts` loses the field from `DispatchCandidate`,
  from `canonicalCandidate` (so the view digest changes) and from `deriveDispatchCandidates`. Nothing
  else needed a read: `parseDraftAuthoring`/`parseTicketCommand` go through the generated model codec,
  which A already shortened, so every stored-text reader of a release event —
  `draft_revision.authoring`, `operation.command`, `selector_proposal_delivery.command` — parses the
  new shape with no edit of its own.
- **`src/adapters/`** — `http/contract.ts` `releaseAuthoring`, `http/outcomes.ts` `draftBody` and the
  initialization defaults; `postgres/decision.ts` insert, `postgres/dispatchViews.ts` row type, select
  and projection, `postgres/selector.ts:156` zod field.
- **Tests** — `test/contract/{representations.ts, contractDocument.json (regenerated), responses.test.ts}`,
  `test/adapters/{httpContract,httpOutcomes,httpServer}.test.ts`,
  `test/interpreter/{authoring,dispatchView,i3,leadPolicyHost,leadTurn,selector}.test.ts`,
  `test/postgres/{digest,leadDecision,leadDurable,readiness}.test.ts`. Two cases were re-pointed rather
  than deleted: `responses.test.ts:971` now reads `programStagesMax`, `authoring.test.ts:47` the stage
  vocabulary's top. `dispatchView.test.ts:71` loses the width as a digested fact and gains the program,
  which the case never covered.
- **`test/postgres/digest.test.ts`** — the pinned wire and both chain digests re-taken.
  `CreateTicket` is shorter by a key, which that file's header admits as a vocabulary change and not a
  corrected constant. `test/postgres/journal.test.ts:229` keeps `workFanout` on purpose: it is the
  "fields the model has since dropped" fixture, and the field now belongs in it — S listed it, plus
  `leadDecision`/`leadDurable`/`readiness`, as a second red wave; only the latter three were.

## Outside my layers (the one thing to review closely)

`src/adapters/postgres/schema/migrations/009-work-fanout.ts` and `test/postgres/migration.test.ts`.
Removing the cursor member narrowed `sessionTurnInputCharsMax` by one candidate key per page, and
`test/adapters/leadTokenBudget.test.ts` holds the latest migration's rendering equal to it — so 005's
figure stopped being the derivation. 009 now re-renders `session_turn_text_is_bounded`, re-seeds
`tokensPerDecision` in `selector_runtime_settings` and its history, exports
`leadObservationTokensPerDecisionAt009`, and carries a second `DO` guard refusing a stored turn past
the new bound (005's message, its own block so S's journal guard stays byte-for-byte and its
red-proofs stand). `migration.test.ts` gains a `workfanout` row in the mailbox-guard table, its
"narrowed bound migrates" case moves to 009, and `:1027` reads the new constant. Nothing in `model/`,
`src/domain/`, `src/actor/` or `ui/` was touched.

## What C must change

`ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx:172-176` (the picker), `TicketProvenance.tsx:136`,
`app/core/ticketCreation.ts:481`, `app/core/ticketLedger.ts:219`, `test/ui/ticketActions.test.ts:39`,
and nine `ui/chuggy-ui/test/` fixtures: `repositoryPage.test.tsx:84,89`, `ticketActions.test.ts:106`,
`ticketBrief.test.tsx:28`, `ticketCreationFixture.ts:58,63`, `ticketCreationForm.test.tsx:321`,
`ticketLabels.test.tsx:67`, `ticketLedgerFixture.ts:144`, `ticketPageFixture.ts:33`,
`ticketPageLedger.test.tsx:731`, `ticketSituation.test.tsx:19`.

## Gates on the tip

`check-source` **1** — typecheck only, and only the two C files above; residue, browser, lint, format
and unit (207 suites) clean. `check-boundaries` 0 (1057 modules) · `check-queries` 0 · `check-postgres`
**0** (76 suites) · `check-conformance` 0 (11 goldens, 190 steps) · `check-figures` 0 · `check-comments`
0 · `check-paths` 0.

## Judgment calls and what the earlier reports got wrong

- **Comments.** `finalizerPreparation.ts:30,148,302` read a work spawn as a set with a width;
  `taskBriefing.ts:277` bounded "a fanout"; `executionSourceObservation.ts:60` explained its branch by
  a fan-out declaring several commits. All reworded. I did **not** delete the branch itself
  (`work.declared.length === 1 ? … : undefined`), its two tests or the adapter's `LIMIT 2`: a work
  cycle being one task makes the several-commit case unreachable, but the rule is total over the list
  the port is handed, and deleting it is a behaviour change past a field's removal. The interpreter
  case is renamed off "a fan-out". Flagging it for the reviewer as the one thing left standing on the
  old assumption. `briefingTemplate.ts:127` ("Reports from the work tasks") is a rendered heading
  bounded at 8 and was left alone.
- **GOAL.md / S-report.** Neither mentions the mailbox bound, which is the only thing on this branch
  that needed a migration statement nobody had planned — 005's header names the trap exactly and PR 6's
  brief did not carry it forward. S's second-red-wave list included `journal.test.ts:229`, which is not
  one.
