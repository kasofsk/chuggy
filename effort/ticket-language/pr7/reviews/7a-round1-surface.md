# PR 7a round 1, surface half — verdict (tip `00664232`)

CHANGES

Two findings, both coverage: the code is right, and two of the three mutations
the brief names survive the whole console suite, so nothing holds them right.

## Findings

1. `ui/chuggy-ui/app/browser/TicketProvenance.tsx:133` — the one expression the
   change makes here is untested, and the field it draws has no test at all
   (`grep -rn "evaluation stages" test/` is empty). Replacing
   `stage.evaluators.length` with `stage.key` passes 1302/1302, `tsc --noEmit`,
   `check-console` and `check-console-sheets`. Input: a program of two 3-wide
   stages; the panel then reads "1× then 2×" instead of "3× then 3×" — the
   two fields are indistinguishable in every fixture, all of which are 1-wide
   or single-stage. Pin it at the component tier with a two-stage program of
   unequal width, as `ticketLedger.test.ts:366` pins the sparse width.
2. `ui/chuggy-ui/app/browser/TicketCreationAdvanced.tsx:162-165` — the remove
   path's reindexing is untested. Dropping `programPositioned` from the
   `filter` only (leaving add and choose alone, which the author red-proofed)
   passes 1302/1302. Input: default program, "add stage", "remove" on stage 1,
   submit — today sends `[{key: 1, …}]`, and without the reindex sends
   `[{key: 2, …}]`, which `src/domain/config.ts:78` (`stage.key === index + 1`)
   refuses, so the reader gets a refusal with nothing on the form to fix. The
   new form test covers add and choose; extend it, or add a sibling case, over
   remove.

House rule 13, and the mutation the brief asked for in item 4.

## What I checked

1. **The body sent.** `ticketCreationForm.test.tsx:352` asserts the whole
   `authoring` with `toStrictEqual` for a two-stage pick — positional stage
   keys, evaluators `1..n`, nothing else; red under `key: index` at either
   depth (evaluator: the submit is refused and no draft is sent; stage: a shape
   mismatch). The count is bounded: `evaluatorCountsOffered` offers
   `1..evaluatorsMax` and the disclosure case pins the options at
   `["9","1","2","3"]` for `evaluatorsMax: 3` — red under `evaluatorsMax + 1`.
   No fixture or call site is missing `choices.evaluatorsMax`; `choices.stages`
   has no reader left, and the console parses the initialization
   (`apiRoutes.ts:602`) so the field cannot arrive undefined at the form.
2. **What is drawn.** `stageExpected` reads `evaluators.length`; the sparse
   `[{key: 1}, {key: 3}]` case expects 2 and is red under
   `return executions.length` (with two siblings). A set's key is
   `(stage, generation)` alone (`ticketLedger.ts:199`), so keys 1 and 3 land in
   one set by construction and the row's identity is the set's first
   execution's requirement, not an evaluator. Nothing in `app/` reads
   `identity.value.evaluator` or `stage.key` for display, so decision 8 holds;
   the picker draws counts, the panel `n×`, no shape in copy.
3. **Fixtures.** No `{fanout}` stage survives in `ui` or `test/ui`. The eight
   remaining `fanout` hits are the local `fanoutAuthoring`/`fanoutShapes`
   identifiers in `ticketPageLedger.test.tsx`, and the "fan-out" prose is the
   set vocabulary the domain still uses (`src/domain/ticket.ts:82`).
4. **Gates at the tip:** `check-console` 0 (5 scripts), `check-console-sheets`
   0, `check-source --static` 0 (5 stages), `check-figures` 0, `check-comments`
   0, `check-paths` 0. Baseline `npx vitest run` 1302/1302, `tsc --noEmit` 0.

## Notes

- `stageAdded`'s `Math.min(…, evaluatorsMax)` is also a survivor, but the only
  reachable over-wide `last` is a synthetic default, so I read the clamp as
  bounding by rule 9 rather than as behaviour to pin. Not a finding.
- `programStageSchema.evaluators` has no `.min(1)` where `fanout:
  ticketNumberSchema` used to refuse 0 at the parse. `isValidProgram` refuses
  an empty roster, so the loss is which layer answers; no console path can send
  one. Machine half's call if it is one.
- `stageOfCount`'s `key: 1` is always overwritten by `programPositioned`, and
  `creationStageLabel` now has one caller, a React key. Both fine; naming them
  in case 7b collapses them.
- `choices.evaluatorsMax` is required, so a loaded old bundle fails the
  initialization parse against a new server and vice versa. `responses.ts:518`
  states that window for `request`; no header makes it a rule, and decision 6
  says the field arrives, so I am not flagging it — worth a line in the release
  note if a reader can have the creation page open across the rollout.
- Practices invoked: none. Read `GOAL.md` §7a 6 and 8, `survey.md` §6 and
  surprise 12, `{B,C}-report.md`, `chuggy-ui-copy-standard`,
  `review-change.md`, `CLAUDE.md`; read `TicketCreationAdvanced.tsx`,
  `ticketLedger.ts`, `TicketLedger.tsx`, `ticketCreation.ts`, `authoring.ts`
  and the changed suites in full. Tree restored clean after every mutation.
