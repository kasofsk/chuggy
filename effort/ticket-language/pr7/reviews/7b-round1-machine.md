# Round 1, machine half — PR 7b, tip 64a95abe

**CHANGES.** Two findings, one minor, one nit. The model, the copy, the goldens,
the mint, 012 and the stored-text readers all hold; both findings are at the
interpreter/adapter seam and neither needs the model touched.

## 1. A spawn no dispatch can source defers forever, and wedges the project

`src/interpreter/projectWriter.ts:551-556`. A durable `Unreadable` now lands as
`Deferred` for every continuation and every completion, where main journalled
`ExecutionBlocked` and parked. The input stays `Pending`, so
`postgresReadinessConsumable` (`src/adapters/postgres/readiness.ts:538-557`)
re-picks it as its class head next quantum, `projectTicketWriterRun`
(`projectWriter.ts:722-726`) returns on `Deferred`, and the aging term
(`floor(age/300)`) drives that head below every other class within the hour: the
whole project's writer stops deciding anything, not just that ticket.

B's case is real, and I traced it end to end rather than reproducing it live.
`projectWriterExecutionSource` (`:503-506`) skips observation whenever
`finalizationRequest.evidence` is present, so a `FinalizationNeedsWork` rework's
bundle gets no `source`; `inputBundleReferencesOf` (`decisionPlan.ts:291-310`)
then writes `TargetCommit` from the evidence and **no** `Repository`.
`postgresExecutionSourceHistory.workSource` reads the newest `SpawnWork`
bundle's `Repository` reference and returns `undefined` when it is null
(`executionSourceHistory.ts:57-58`), so the next evaluation spawn's `observe`
answers `RefUnreadable` (`executionSourceObservation.ts:84-86`) — durable, not
transient. On main that park was `WorkExecutionUnavailableEscalated`, which a
desk resume clears; here nothing ever moves. The branch's own test change
(`test/interpreter/dispatchWriter.test.ts:806`, "…parks its ticket on the desk"
→ "…is deferred") is the same fact.

Smallest fix, and the one I'd take: make the rework bundle carry `Repository`
— either do not skip the Work observation for a `NeedsWork` submission, or add
the brief's repository to the evidence branch of `inputBundleReferencesOf`.
The alternative the brief names (the spawn reporting
`TerminalFailureReport{ExecutionUnavailableFailure}`) invents a task the
journal never heard of, which is exactly what `projectWriter.ts:543-547` argues
against. Whatever the fix, a durable evidence must not leave an input
permanently undecidable.

## 2. The "no principal may offer a completion" guard now passes vacuously

`test/postgres/privileges.test.ts:347-350`. Both fixtures are shapes 012
deleted: the first is the pre-012 `TaskDone` (`verdict`/`result`), the second an
`ExecutionBlocked`. `accept_operation` runs `ticket_command_is_valid` *before*
it derives `command_tag` (`003-no-handoff.ts:90-120`), so both are now refused
as invalid and the tag arm the test exists for is never reached.

Red-proved both ways on a fresh database: with
`command_tag IN ('ReleaseDraft','Dispatch','ResumeTicket','TaskDone','ExecutionBlocked')`
patched into 003, the test **passes** (1/1) — a forged completion admitted as an
ordinary command goes unnoticed. Repair the first literal to 012's spelling
(`report: {type:"WorkResultReport", value:{result:{…}}}`) and drop the second,
and the same mutant is **RED**. One-line fix.

## 3. Minor — a wall's evidence can be stamped on a park that was not a wall

`src/interpreter/projectWriter.ts:577-583` takes `executionBlockedBy` whenever
the post state is escalated at all. A stage holding one `EvaluatorFail` and one
walled evaluator concludes `EvaluationFailed` (`concludeStage` tests
`stageHasFailed` first), so if the walled evaluator reports last under
`EscalateEvaluationFailure` the desk row reads
`EvaluationFailureEscalated` + `ExecutionProfileUnavailable`, sending the
operator at infrastructure for a judgement. Gate the arm on the wall's own
escalations instead of on "escalated".

## 4. Nit

`model/AGENTS.md:15-17` — "every divergence is a producer of a task DEFINITION"
is not true of the `acceptedSourceRef` one; that ref is not a task definition.

## What I verified clean

- **Copy**: `diff` against the package prints exactly the six hunks, four
  decided and two forced, each listed in `model/AGENTS.md`. Nothing else edited.
- **Instance, blocked and resume**: the model tests pin all of it —
  `evaluatorWallLeavesTheStageRunningTest`, `blockedStageParksAndResumesTheBlockedAloneTest`
  (park only after the sibling answers; generation 2; the kept pass untouched; a
  late gen-1 completion a no-op), `evaluatorProcessFailureParksTest`,
  `failureBeatsAWallTest`, and the work wall still walling. `idsAccounted` is the
  slot sum and `decisionEventEnabled` refuses a stale `TaskDone`.
- **Goldens**: `emit-goldens.sh` re-run at the tip leaves `test/golden` byte
  identical. `draws.ts` draws every report kind and reaches a park and a resume.
- **Mint**: injective and monotone across a resume (`[1,2,3,4,6]`, re-ask at
  generation 2) and across two instances; `executionScheduler.ts` drains no
  siblings; `schedulerRetriesExhausted` submits `ProcessFailed`, whose only
  producer it is; `Pass→EvaluatorPass` lives once, in 012.
- **012**: guard byte-identical to 008's; the `TaskDone` arm matches
  `src/generated/model-api.ts` exactly (no `ticket` in a value, `evidence` on a
  failure, `onFailure` and `verdict` refused); no `EvalReduce`/`ExecutionBlocked`
  arm; no earlier migration file or any file they import changed, so 001–011
  render identically. Re-proved RED: `verdict` unrefused, a third failure kind,
  the absent kind left to answer NULL (S's), the `ProcessFailed` arm deleted and
  the evidence taken from the ticket (B's).
- **Addendum 1**: the writer's stamp is on the journalled event, replay reads
  the event and never the cap, and `TaskDone` is unspellable at the client
  surface in TypeScript, in `parseTicketCommand` and at the door — subject to
  finding 2, which is about the test, not the code.
- **Gates at the tip**: `check-model` (123), `check-conformance` (12/208),
  `check-random`, `check-model-api`, `check-source`, `check-boundaries`,
  `check-queries`, `check-duplication`, `check-figures`, `check-comments`,
  `check-paths` all 0. Postgres suites run individually, all green: `migration`
  95, `scheduler` 25, `schedulerStore` 32, `ticketProjection` 7, `privileges`
  38, `nativeReads` 20 — a wall, a kill and a resume each reach the new arms
  outside the migration suite's literals.
