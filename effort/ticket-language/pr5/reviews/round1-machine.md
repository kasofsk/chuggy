# Round 1, machine half — PR 5 "Escalated is a sum", tip 3d994ce8

CHANGES

## Findings

### 1. `008-escalation-sum.ts:89-90` — the two `execution` grants are load-bearing and nothing proves them

`readiness.ts:538` joins `execution` on `completion_operation` and selects
`blocked_reason`; the control plane runs that query as `chuggy_ticket_service`
(`controlPlane.ts:478` asserts the role as a precondition), so without these two
GRANTs the writer's inbox read fails with a column permission denial and no
decision is ever taken.

I removed both statements from 008 and re-ran the suites that could see them:
`migration.test.ts` clean, `readiness.test.ts` 7/7, `privileges.test.ts` 38/38.
`has_column_privilege('chuggy_ticket_service','public.execution','blocked_reason','SELECT')`
answered `f` on the resulting schema. Every gate is green on a tree where the
grant the writer needs is gone.

The four sibling grants added in the same migration are proved
(`migration.test.ts:3258-3272`, `has_column_privilege`), and the api-side read is
driven through a real role pool (`finalizerUnavailable.test.ts:207-218`). These
two are the only ones with neither. House rule 13, and the standing commitment
that an unverified control is worse than none — this is the tree's own
guard-fails-open shape: the suites drive readiness through the owner pool, so a
missing service-role grant reads exactly like a working one.

Fix: add the pair to the `has_column_privilege` loop at
`migration.test.ts:3258`, or drive `postgresReadinessConsumable` through
`postgresHarnessRolePool(ticketServiceRole)` in `readiness.test.ts`.

## What I checked

- **Model vs package.** The five wall names and their order are
  `package/.../ticket.qnt:50-54`'s; `resumeOf` (`ticket.qnt:184-192`) matches the
  package's `decideResume` arm for arm, including `EvaluationBlockedEscalated →
  ResumeEvaluation`. `NoEscalation` is chuggy's alone and is argued in the header
  (flat `Phase`). `EvaluationBlockedEscalated` is stamped only at
  `domain.qnt:549`, under `decideExecutionBlocked`'s `Evaluation` arm, whose
  caller draws from `taskPhaseIn` (Work | Evaluation); the TS mirror
  (`deciders.ts:346`) is the same shape. `deskConsistent` is still in
  `allInvariants` (`domain.qnt:1123`) and in `invariantBundle`
  (`invariants.ts:244`), which `check-conformance` walks per step — 11 goldens,
  235 steps, records, states and bundle.
- **Semantics 6 alone.** `storedJournalLegalOn` (`journal.ts:89`) refuses any row
  not at 6; `decisionSemantics.test.ts` pins 1–5 and 7 refused both there and at
  `isDecisionSemanticsVersion`. The grep finds no live pre-6 spelling outside
  frozen migrations 001–007 and `baseline/`; `resumeAt` survives only as the
  wire's derived field. B's zod-strips note is harmless: `decision_event_is_valid`
  only refuses a retired *tag*, an extra `reason` key is ignored, and no row
  carrying one can exist behind the wipe.
- **008.** Guard first; render-diff of 001–007 main vs branch is byte-empty (240
  added lines, all migration 8). `submit_task_completion` differs from
  `baseline/functions.ts` in the envelope alone; `request_finalization_approval`
  differs from 006's in the column name and the literal. No surviving function
  definition reads `ticket_projection.reason`, `.resume_at` or
  `native_action.reason` (the remaining `reason` hits are
  `selector_refusal`/`project_change`, other columns). Red-proofs, each run
  against the case that owns it, each RED: guard disabled → "refuses the
  migration and names the wipe"; evidence CHECK weakened to `true` → "admits
  evidence only beside an escalation"; `'reason', in_reason` put back in the
  envelope → "journals a block naming its ticket".
- **Evidence.** `execution_completion_is_its_own` is UNIQUE on
  `(tenant,project,completion_operation)`, so two executions for one ticket
  cannot fan the join out or answer the wrong one, and
  `execution_blocked_reason_is_known` closes `inboxBlockedReason` against a value
  it would raise on. Staleness: the upsert writes `EXCLUDED.escalation_evidence`
  from `row.escalationEvidence ?? null`, so a resume clears it, and no decision
  re-projects an Escalated ticket without touching it (`ticketEquals`). A
  continuation park after an execution park rewrites both columns;
  `finalizerUnavailable.test.ts:219-224` pins that a second hold does not
  overwrite the standing escalation's evidence. `projectionOf`'s
  IntegrityContradiction is covered (`projection.test.ts:238`).
- **The wire.** `resumeAt` is `resumeOf(kind)` at the read
  (`nativeWeb.ts:274`), the same function the deciders switch on, off the same
  stored `escalation` the projection wrote — I found no path where the two can
  disagree. `ticketEscalationSchema`'s evidence union is
  `blockedReasons ∪ gitEvidences ∪ finalizationUnavailableKinds`, and
  `rosters.test.ts:201,212` holds two of the three against the interpreter.
- **The wipe.** Rendered the effective schema: 76 tables, 54 truncated, 22 kept,
  nothing named that is not a table. No kept relation has an FK into a wiped one
  (the only hit is `finalization_request_configuration`, which 003 dropped). The
  four counters and `head` are the whole of `project`'s; `project_change.sequence`
  is the identity `RESTART IDENTITY` restarts, and `thread_wake_cursor` is reset
  rather than truncated because no role holds INSERT on it. The case's last
  assertion holds every public table against the truncate list or `wipeKept`:
  removing `public.ticket_projection` from the file turned it RED, naming the
  table.
- **Gates at the tip.** check-figures 0 · check-comments 0 · check-paths 0 ·
  check-boundaries 0 · check-queries 0 · check-postgres 0 (76 suites) ·
  check-conformance 0 · check-source 0 (6 stages).

## Notes

- Not flagged: `TicketEscalationResource.evidence` is `string` where the wire
  schema narrows to the three rosters, so the narrowing lives only in
  `projectionEvidence`. It raises, and the type would only restate it — opinion,
  not a finding.
- Not flagged: a durable unreadable source for an *evaluation* spawn parks the
  ticket at `WorkExecutionUnavailableEscalated`, because the ticket is still in
  Work in the pre-graph. That is phase-honest and unchanged from main.
- `check-model` not run — the slowest gate, and A reports 0 on it; the Quint
  suites it runs are the ones this change edits, so it is worth one clean run
  before merge.
- Practices invoked: `modular-and-layered-code` (the finding is a boundary
  contract — a grant — with no test pinning it).
- Mutations were made in my own detached worktree and reverted; `git status` is
  clean there and the worktree is removed.
