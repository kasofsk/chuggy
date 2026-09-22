# PR 1 of the ticket convergence: the accounts leave the model

Context: `SPIKE.md` beside this file (read its "Decisions" and "The plan"
sections), and the published plan
https://claude.ai/artifact/FTzkDqocCgsCFAHZBUvCwk. Decided by Geoff
2026-09-20: gas, the rework budget, finalization pricing and retry pricing
leave the model; rework caps stay an implementation feature; the model
converges on `@kasofsk/chug-ticket-domain` (pinned 76c95a9, v0.5.0) until it can be
imported, and every PR's diff is read against the package's text. Do not
consult PR #670 (dc/chuggernaut-adoption).

Branch `model/no-accounts`, worktree `~/claude/chuggy-wt/no-accounts`, based
on main 81e8093a. Schema work on `schema/no-accounts`, worktree
`~/claude/chuggy-wt/no-accounts-schema`, merged into the code branch before
the PR (the code cannot run against the old schema: `dispatch_candidate`'s
pricing columns are NOT NULL, so one release carries both).

## What goes

Model: consts GAS, REWORK_POLICY, FINALIZATION_PRICING; types
FinalizationPricing, ReworkPolicy, RetryPricing, Bounds; Ticket fields
reworkPolicy, finalizationPricing, resumePricing, reworkLeft,
finalizationLeft, gasLeft; Reason literals GasExhausted and
FinalizationBudgetExhausted; the measure section of measure.qnt and every
measure-descends invariant/test; resumeCharge, reworkWallResume's budget
test, the rework wall's refill; the pricing dimension of the mc instances
(one machine instance and one directed instance remain); the goldens named
by pricing (re-planned, see Task A).

Code: `src/domain/measure.ts`, `pricing.ts`; the accounts on the wire ticket
view (gasLeft, gasMax, reworkLeft, finalizationLeft); the authoring request's
reworkPolicy/finalizationPricing/resumePricing and the option pages
reworkPolicies/finalizationPricings/resumePricings; `escalationReasons`
loses two literals; `retryableIn`'s affordability; the domain configuration's
reworkPolicy/gas/finalizationPricing; the console's budget meter, accounts
panel, pricing pickers and affordability copy.

Schema (migration 004): ticket_projection gas_left/rework_left/
finalization_left and their two CHECKs and column grants; dispatch_candidate
rework_policy/finalization_pricing/resume_pricing; reason CHECKs on
ticket_projection and native_action lose the two literals; the release
command admit stops requiring the pricing fields; the
deployment_authoring_policy singleton's domain_configuration JSON loses its
three keys; guard first.

## What changes shape (the package's text, verbatim)

- `type EvaluationFailureDisposition = ReworkEvaluationFailure | EscalateEvaluationFailure`
  enters the model. On an evaluation failure the machine consults a
  disposition: Rework re-enters Working as a new cycle (the rework
  wall's old "costs 1 rework" branch, unpriced); Escalate parks at the
  rework wall (reason stays `ReworkBudgetExhausted` until PR 3 renames it;
  resume stays `ResumeReworking`, which re-enters Working as a rework with
  no refill). In the model the disposition is a nondet draw of evalReduce;
  in the journal it is EvalReduce's payload (`{ ticket, onFailure }`),
  because picks are journaled. The interpreter supplies it from a policy
  over the ticket's work-cycle count and a configured cap (Task B).
- FinalizationFailed always re-enters Working (the package's NeedsWork);
  no wall.
- Resume is free; every parked ticket with a modeled resume is retryable.
- Dispatch needs no gas.

## Decision semantics

New rows are decided at semantics 3. Rows at 1 and 2 replay under the
current deciders with corrections stated in terms of the row, never a copy
of the old machine (`src/actor/decisionSemantics.ts`'s discipline): the
release event's pricing fields are ignored at decode; an EvalReduce row's
disposition is read from the row's own record (a transition into Escalated
means Escalate, otherwise Rework), so the correction takes the stored row's
`rec`; a row whose record names a wall the machine no longer has
(gas_exhausted, finalization_budget_exhausted) cannot be replayed and
`journalLegalOn` says so. The rig's journal has twelve rework-wall rows and
no gas or finalization-budget rows, so it replays. Migration 004's guard
refuses a journal that names either removed wall.

## Model file layout

`measure.qnt` cannot keep its name. It becomes `model/ticket.qnt`, module
`chuggy_ticket`: the ticket record, its vocabulary and the task plumbing
(spawnTasks, retireLive, resolveTask, combine…). The measure section is
deleted. Every importer of `chuggy_measure` imports `chuggy_ticket`. The
package's ticket module replaces this file at PR 9.

## Configuration

`Config` (domain) becomes `{ nTickets, nTasks, maxStages }`. The rework cap
is the ticket service's own policy, not the domain's: a `rework: {
cyclesMax }` block in the ticket-service configuration, read where the
interpreter builds EvalReduce. Fabric follows at rollout
(`cluster/apps/chuggy-ticket-service.yaml` CHUG_TICKET_SERVICE_CONFIG:
drop reworkPolicy/gas/finalizationPricing, add rework.cyclesMax 2).

## What stays

`ReworkBudgetExhausted` and `ResumeReworking` as names (PR 3 renames);
`DependencyRevoked`, NoFinalizer, AnyPass (PR 2); every ExecutionBlocked
reason; the record, spawned, completions ghost fields; artifact marks;
`ArtifactMark`, `Finalizer`, `Combinator` types.

## Sequence

A. model + goldens + generated + domain + actor + conformance (opus)
S. migration 004 + migration tests, own worktree, from main (opus)
B. interpreter + adapters + contract + tests + config (opus), after A
C. UI (sonnet), after B
R. fresh reviewer per round; mutation sweep second; ci.sh full; merge S
   into the code branch; PR; merge. Fabric config PR at merge, rolled at
   the next release with 002 and 003.

## Progress 2026-09-20

- S: cf708286 on schema/no-accounts, reviewed APPROVE (reviews/S-round1.md).
- A: 82649aff + dc867998 on model/no-accounts; review round 1 running in
  worktree no-accounts-review-a. B running on model/no-accounts (merges S
  first).
- Fabric: `ticket-service/no-accounts` at 64ef40d in
  `~/claude/chuggy-fabric-wt/no-accounts` (unpushed): domain block loses
  the three keys, `rework.cyclesMax: 2` added. Key names must match what
  B implements in `src/roots/ticketService.ts`; check before pushing. PR
  it when PR 1 merges; roll with 002–004.
- Fabric `ticket-service/no-accounts` 64ef40d verified against B's `src/roots/ticketService.ts`: `rework.cyclesMax` top-level beside `domain`, three domain keys. Unpushed until PR 1 merges.
- PR 1 MERGED 2026-09-20 as kasofsk/chuggy#714 → main 617675bb. RELEASED to the rig: fabric #276 (3d3ab486, carries the ticket-service config 1affec2; #275 closed as folded); migrate Job applied 2,3,4; all seven Deployments rolled at 617675bb; restarts are the ledger/readiness race only; api ready 200, console 200. Pre-release dumps at ~/backups/chuggy-pre-617675bb{.dump,-globals.sql}. Paused for Geoff's cluster check.
