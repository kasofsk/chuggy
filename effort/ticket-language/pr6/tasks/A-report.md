# Task A report — work fan-out leaves the model, the domain and the actor

Tip `58f40608` on `model/work-fanout-goes`, four commits off main `0f94fe6b`: `0b9871e7` a work cycle is
one task · `8282326e` the goldens are re-emitted at one work task per cycle · `44ef8dcb` the domain, the
actor and their suites lose the width · `58f40608` no comment still says work chooses a width. Commits
carry `Co-Authored-By: Claude Opus 5 (1M context)`, not the brief's `Claude Fable 5.1`: the session's
attribution reminder names this model, as PR 3, PR 4 and PR 5 also reported.

## Per layer

- **`model/`** — `Ticket.workFanout` gone (`ticket.qnt:228`); `spawnWork` added beside `spawnOn`
  (`ticket.qnt:364-369`) and is the only work spawn. `freshTicket`/`decideReleaseTicket` lose the
  parameter (`domain.qnt:119-129`, `:184-189`), `workFanoutChoices` and the `releaseTicket` nondet pick
  are gone (`domain.qnt:717-724`), and the four spawn sites call `spawnWork` (`domain.qnt:363`, `:462`,
  `:492`, `:568`). `tasksWellFormed`'s Work arm is `size == 1` and `ids == Set(start)`
  (`domain.qnt:934-936`). `refinement.qnt`'s `CreateTicket` payload, `execDecisionEvent` arm,
  `decisionEventEnabled` conjunct and `actorReleaseTicket` follow (`:273`, `:307`, `:330`, `:545-551`).
  `api.qnt` needed no edit — it aliases `Ticket`/`DecisionEvent` whole.
- **`N_TASKS` stays**, against the brief's "if nothing else reads it": it is still the evaluation stage
  ceiling for `stageChoices`, `defaultProgram`, `programsWellFormed` and `init`
  (`domain.qnt:93`, `:110`, `:1002-1009`, `:703`). Its header now says so (`domain.qnt:71-74`).
- **Goldens** — the eleven re-emitted; every step count moved, so `manifest.json`'s `steps` follow, and
  three `purpose` lines say work task where they said work set (`manifest.json:88`, `:102`, `:130`).
- **Generated** — `modelTypes.ts`, `model-api.ts` regenerated: `Ticket` and the `CreateTicket` value each
  lose the field, in both the value and wire schemas.
- **`src/domain`** — `spawnWork` in `ticket.ts:74-81`; `config.ts` loses `workFanoutChoices`;
  `deciders.ts` mirrors the model at `:144`, `:257`, `:302`, `:379`; `invariants.ts:115-116` pins one;
  `enablement.ts:177-182` has only the program left to draw.
- **`src/actor`** — `decisionEvent.ts` `ReleaseAuthoring` and both its directions; `equality.ts:99`
  compares one field fewer.
- **Suites** — `test/domain/fixtures.ts` `healthyFleet` is a reachable shape again (one work task, then
  the stage above it); `test/domain/{deciders,invariants,enablement,config,task}.test.ts`,
  `test/actor/{harness,journal,equality}`, `test/generated/model-api.test.ts`, `test/itf/vocabulary.ts`,
  `test/conformance/{dispatch,dispatch.test,replay.test}`, `test/random/{draws,walk.test}` follow. The
  `CreateTicket/workFanoutChoices` refusal row is deleted (`test/actor/journal.test.ts`) — nothing else
  in that table changed, and `CreateTicket/isValidProgram` still holds the release's refusal.

## Outside my layers

One file: `.chug/tasks/check-random.test.sh:35` — its mutant seed is pinned to a run that draws a
duplicate completion, and the walk's draws moved with the work set, so `0x1` now walks clean under the
phantom-completion mutant and `0x3` finds it. Verified both directions. No edit in `src/interpreter/`,
`src/adapters/`, `src/contract/`, `ui/` or migrations.

## What B and C must change

B, typecheck reds: `src/interpreter/authoring.ts:16` (imports the deleted `workFanoutChoices`), `:458`
(`draftInitializationResponse.choices.workFanouts`), `:499`, `:504`; `src/interpreter/dispatchView.ts:32`,
`:102`, `:152`; `src/adapters/http/contract.ts:278`; `src/adapters/http/outcomes.ts:702`, `:1282`.
B, not yet red but the same change: `src/contract/authoring.ts:34`, `src/contract/responses.ts:693`
(`workFanout`) and `:823` (`choices.workFanouts`), `src/contract/http.ts:548` (cursor field),
`src/adapters/postgres/{decision.ts:241, dispatchViews.ts:65, selector.ts:156}`,
`test/contract/{representations.ts, contractDocument.json}`.
C: `ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx:172-176` (the picker),
`app/core/ticketCreation.ts:481`, `app/browser/TicketProvenance.tsx:136`, `app/core/ticketLedger.ts:219`,
and the eight `ui/chuggy-ui/test/` fixtures. S: `functions.ts:817` (`command_integer(value->'workFanout')`),
`relations.ts` (`dispatch_candidate.work_fanout`).

Unit reds left for B, by file: all 42 are one import failure
(`SyntaxError: … does not provide an export named 'workFanoutChoices'`) from
`src/interpreter/authoring.ts:16` — every suite under `test/adapters/`, `test/contract/`,
`test/interpreter/` that loads the interpreter, plus `test/ui/mutationSentences.test.ts`. Static adds
`test/interpreter/i3.test.ts:205` and `test/ui/ticketActions.test.ts:39`. No red sits in `model/`,
`src/domain`, `src/actor`, `src/generated` or any suite of theirs.

## Gates on the tip

`check-model` **0** (114 tests; log at `pr6/check-model-A.log`) · `check-model.test` 0 (16) ·
`check-model-api` 0 · `check-conformance` 0 (11 goldens, 190 steps) · `check-conformance.test` 0 (9) ·
`check-random` 0 (2000 runs, 80000 steps) · `check-random.test` 0 (16) · `check-figures` 0 ·
`check-comments` 0 · `check-paths` 0 · `check-boundaries` 0 · `check-source --static` **1** and
`--unit` **1**, both entirely the reds listed above.

## Where GOAL.md was thin

Two things. It reads `N_TASKS` as possibly going with the fan-out; it cannot — it is the evaluation
stage ceiling, and only `workFanoutChoices` goes. And it does not mention `check-random.test.sh`'s
pinned seed, which this change invalidates exactly as PR 3's did; PR 5's brief carried that warning and
PR 6's did not.
