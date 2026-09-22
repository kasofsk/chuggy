# PR 6b review round 1, machine half — `model/task-identity` at 1fb1bc26

Verdict: **CHANGES** — three findings, all small; nothing in the machine, the
mint, 010 or the goldens is wrong.

## Findings

1. **`model/AGENTS.md:13-14` attributes `taskIdentityValid` to the wrong
   module.** The line says "`ticket.qnt` imports it for `TaskIdentity` and
   `taskIdentityValid`, and `domain.qnt` for `taskOwner`". `taskIdentityValid`
   has no caller in `ticket.qnt`; its only caller in the tree is
   `model/domain.qnt:1031` (`taskIdentitiesValid`), which also uses `taskOwner`
   at `:974`. This is the one doc the copy's correctness rests on, and a reader
   checking which of the copy's definitions are live is sent to the wrong file.

2. **`model/domain.qnt:348` still says "ids sequential within the ticket".**
   `decideDispatch`'s header kept the sentence through the rewrite. There are no
   task ids in this model any more, and the property the sentence was standing
   in for — history-unique identity, which the stale-completion argument at
   `:373-380` rests on — is now bought by the cycle counter and
   `stageGeneration`, not by sequential numbering. 68c4bbca swept the TypeScript
   layers for exactly this sentence and did not reach the model.

3. **`model/execution_requirement.qnt` still selects by explicit task; the
   interpreter no longer can.** `:8` keeps `ExplicitTask` in
   `RequirementSource`, `:11` keeps `explicitTasks: int -> ExecutionRequirement`
   and `:81-82` keeps it as the first arm of `selectedRequirement`;
   `check-model.sh:117` proves that suite. `src/interpreter/executionRequirement.ts`
   deleted `taskDefaults` and the `ExplicitTask` lookup, and
   `test/interpreter/executionRequirement.test.ts:200` now asserts such a
   configuration is *refused*. `AGENTS.md:3` says the Quint model is the
   authoritative behavioural specification and `CLAUDE.md` says the code is
   wrong when they disagree, so the next author reading that module will
   reinstate what this PR deleted. It also leaves `ExplicitTask` alive with no
   producer in `executionRequirement.ts:36,46`, `contract/rosters.ts:166`,
   `schedulerRows.ts:172` and the baseline `execution_requirement_source_known`
   CHECK. survey 9 named this file as this PR's, and decision 6 only moved the
   `Evaluation:<stage>` key; the `taskDefaults` deletion went further than the
   model followed.

## What I checked and found right

- **The copy.** `diff` against the package's `task.qnt` is empty. No module
  under `model/` redefines any of the twenty names it exports (the `WorkTask`/
  `EvaluationTask` hits are match arms). `TaskDefinition`, `TaskObligation`,
  `ValidatedTaskResult`, `TaskFailure`, `TaskTerminal` genuinely have no caller.
- **The machine.** Every spawn site names an identity `taskIdentityValid`
  admits, and `taskIdentitiesValid` is in both bundles.
  `workCyclesStarted` moves only in `spawnWork` (`ticket.qnt:390`) and is held
  to the record by `idsAccounted`. I drove the deciders through the resume edge
  A names — dispatch, stage 0 gen 1, stage 1, `ExecutionBlocked`,
  `ResumeTicket` — and the resumed set is `stage 1, generation 2`, distinct from
  everything in the record; `outstandingTaskIn` refuses a `TaskDone` naming the
  retired gen-1 identity. `ResumeEvaluation` is reachable only from
  `EvaluationBlockedEscalated`, i.e. only from Evaluation, so `workCycle` is
  never 0. Mutating `stageGeneration` to a constant turns
  `executionBlockedEvaluationResumeFreshTest` and `evaluationResumeWitness` red
  in the model and `check-conformance` red in the tree — the fix is proved, by
  tests rather than by an invariant, which is enough. `retireLive`'s
  `taskOrdinal` order reproduces the old id order, and the finalizer's
  descending-task election still names descending spawn order because the mint
  is ascending.
- **Goldens.** `emit-goldens.sh` reproduced all eleven byte for byte (clean
  `git status` after). Both identity arms appear across the corpus; the
  `TaskDone` draw covers both through `outstandingTasksIn`.
- **The mint.** Across a resume at generation 2 and two reworks the numbers are
  1..11, injective and strictly ascending per ticket, and identical to what the
  old `nextTaskId` would have minted — which is why the pod document golden and
  the cursor are untouched. `CancelTicketWork` re-mints the live set's own
  numbers (`before.spawned - before.tasks.size` is frozen while a set is live,
  since `spawnOn` refuses a non-empty set). `stage` reaches the requirement key
  as the positive column; `schedulerRows.ts:222` is the only column→index site,
  and every other `t.stage` reader goes through `executionRowLogical`.
- **010.** Guard byte-identical to 008's and 009's. Each CHECK arm states the
  whole identity per `taskIdentityValid`. The three new grants complete the
  api's column set (`tenant, project, request, task, kind, stage` were already
  granted). `submit_task_completion`'s join is total by
  `execution_has_its_authorized_task` and runs under the same `FOR UPDATE OF e`;
  the two-execution case proves each completion journals its own identity.
  Render-diff of 001–009, main vs branch: identical. Three of S's assertions
  re-proved by mutation — stage floor back to `>= 0`, `NOT value ? 'tid'`
  removed, and the door building the cycle off `bound.task` — all three red on
  exactly the case that owns them.
- **Stored text.** The only opaque-text reader of a `TaskDone` is
  `wire.ts parseStoredTicketCommand` → the regenerated codec; no
  `atCurrentVocabulary` lift survives and the remaining `value->'tid'` sites are
  frozen 004–009 bodies. `migration.test.ts:4071` asserts its absence.
- **Gates at the tip**, all exit 0: `check-model`, `check-model-api`,
  `check-conformance`, `check-random`, `check-source`, `check-boundaries`,
  `check-queries`, `check-postgres` (76 suites), `check-duplication`,
  `check-figures`, `check-comments`, `check-paths`.

Worktree `~/claude/chuggy-wt/identity-review-machine` removed; every database
the migration suite made dropped itself. Four `chuggy_check_<pid>` databases
from the gate runs are still on `chuggy-check-postgres` — dropping one is denied
to me by the permission rules, so Geoff may want to.
