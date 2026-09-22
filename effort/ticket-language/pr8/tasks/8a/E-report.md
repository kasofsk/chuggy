# Task E (PR 8a) — the sweep's gaps are each held by a case

Tip `e3a353a6` on `model/released-ticket` (from `a7923309`), one commit, hook
clean, worktree clean. Tests and docs only; no production code moved.

1. **Release rule, conjunct by conjunct.** `journalRefusesInvalidReleasePayloadTest`
   refuses eight more payloads (content, work ref, evaluator's own ref, repeated
   evaluator key, stage key off its position, evaluator key past `N_TASKS`,
   stages past `MAX_STAGES`, finalization ref): **M4, M5, M16, M19–M22 RED**.
   `id > 0` and `dependencies.forall(> 0)` have no event case — dominated by
   `canReleaseIn` (`refinement.qnt:334`, `ticketIdUniverse = 1.to(N_TICKETS*2)`)
   and by the dependability conjunct beside it (**M18, M17 survive**); the test
   says so, and both are held in `enablement.test.ts`, where the rule is a
   function: ten conjuncts refuted, **T6, T7 RED** (isValidPlan's uniqueness
   conjunct survives, dominated by `planValid`).
2. **A wrong obligation.** `task.test.ts` refuses a work and an evaluator report
   at another definition and at another `contextRef` (new `carriedAt` fixture);
   `deciders.test.ts` adds an answer for a spawn the stage never made: **T3–T5,
   T13 RED**.
3. **An unobserved dispatch source.** `journalRefusesUnobservedDispatchSourceTest`
   (**M14 RED**) and a `Dispatch/source` refusal row (**T19 RED**).
4. **Per-stage material.** Two stages cannot be released (the deployment's
   `maxStages` is 1, mirroring the model), so the two-stage case is a unit one
   over the pure functions: new `test/interpreter/ticketDefinition.test.ts`
   (per-stage `inputs` fold, evaluators equal within a stage and different
   across, work distinct) — **I1–I4 RED, unit**; the postgres suite releases
   under differing blocks and reads the row and the journal — **I1–I4 RED,
   check-postgres**; `schedulerStore.test.ts` registers a `SpawnEvaluation`
   beside a `SpawnWork` under per-kind requirements — **I5 RED**.
5. **The two evidences**, both through the completion path: a passed work
   manifest declaring no source, an evaluator answering for a cycle with no
   passed work result — **I10 RED**.
6. **Codecs**, six lines each: `parseDraftAuthoring` and `encodeDispatchProgram`
   refuse malformed values — **C1, C3 RED**.

Docs: the README names the scheduler among `ticket_definition`'s readers;
`model/AGENTS.md` names `domain.qnt`'s two calls into the copy; the two
over-long comments in `model/domain.qnt` are wrapped. Nothing left open.

Gates on the tip, one at a time, all **exit 0**: `check-model` (124 tests),
`check-conformance` (12 goldens), `check-random` (2000 runs), `check-source`
(6 stages), `check-postgres` (77 suites), `check-figures`, `check-comments`,
`check-paths`, `check-duplication`. Container removed.
