# Task D (PR 6b) — report

Tip `0ef1eba5` on `fix/identity-explicit-task`, four commits off `1fb1bc26`.
Worktree `~/claude/chuggy-wt/identity-fix`.

## By layer

- **Model.** `RequirementSource` loses `ExplicitTask`, `RequirementDefaults`
  loses `explicitTasks`, `selectedRequirement` loses its first arm and its
  `task: int`, and a short doc on it says why a requirement is never authored
  for one task. `materialize`'s `task: int` was read by nothing else, so it
  goes too — the brief made that conditional of `selectedRequirement` only, but
  the same condition holds one call up. The module header says nothing about
  precedence or explicit tasks, so nothing there followed.
- **Model suite.** `precedenceIsExplicit…` becomes
  `precedenceIsKindThenTicketThenPlatformTest` and proves the kind default is
  the first source. Three cases that keyed an override by task number
  (`tasksInOneTicketMayMaterializeDifferentRequirements`, `wideningOverrideIsRefused`,
  `variantChangeIsNotARefinement`) key it by kind; two literal
  `RequirementDefaults` records lose the field. 16 pass.
- **Interpreter/contract/adapter.** The union, `asRequirementSource`,
  `requirementSources` and `executionRowRequirementSource` lose the member;
  `rosters.test.ts`'s exhaustiveness record follows, and
  `executionSchedulerRun.test.ts:405` names `TaskKindDefault` as its pinned
  non-default source. `materializeExecutionRequirement` already had no arm
  yielding it.
- **Schema.** 010 drops and rewrites `execution_requirement_source_known`
  without the member, in 009's `dispatch_candidate` idiom, with a header
  paragraph. `contractDocument.json` publishes no requirement source, so it
  needed nothing; no migration 001–009 imports the roster.
- **Comments.** A line-joined scan of the three touched TypeScript files and a
  tree-wide sweep for task-default phrasing found nothing left saying a task
  names its own requirement.
- **Model docs.** `AGENTS.md` now says `ticket.qnt` imports the copy for
  `TaskIdentity` and `domain.qnt` calls `taskIdentityValid` and `taskOwner`.
  `domain.qnt:348` replaces "ids sequential within the ticket" with one
  sentence: the cycle counter, with `stageGeneration` for an evaluation, is
  what makes each identity one no earlier task of the ticket carried.

## Red-proof and render-diff

Removing the `ALTER TABLE public.execution` statement from 010 turns
"an execution registered under a requirement a task named is refused" red with
`Missing expected rejection: a requirement a task named for itself`; restored,
it passes. Render-diff of migrations 001–009, main vs branch, rendered through
`migrations` on both sides: empty.

## Gates on the tip — all exit 0

`check-model` (114 tests), `check-model-api`, `check-conformance` (11 goldens),
`check-source`, `check-boundaries`, `check-queries`, `check-postgres`
(76 suites), `check-figures`, `check-comments`, `check-paths`.

## What the brief got wrong

- It says "the module doc follows" for `execution_requirement.qnt`. The module
  header never mentioned the explicit arm; I added a doc on
  `selectedRequirement` instead, which is where the rule now lives.
- Generated mirror: `execution_requirement` is not exported through `api.qnt`,
  so nothing regenerated. `check-model-api` confirms.
- The commit trailer is the brief's `Claude Fable 5.1`. This task ran on
  Opus 5 (1M context); the trailer is the brief's instruction, not a fact
  about who wrote the commits. Amend if that matters.
