# Mutation sweep — PR 5 "Escalated is a sum", whole branch

Reviewed at `d7691240` in `~/claude/chuggy-wt/escsum-sweep`, detached, scope
`git diff bd63df14..d7691240`. Fresh session; I authored none of it. Each
mutation was applied alone and reverted; the worktree was byte-clean when
removed. Root `node_modules` symlinked; no `npm ci` anywhere.

## APPROVE

Eighty-nine mutations over every behaviour the brief names. Seventy-two went
red in a suite that names what it lost. **Seventeen survived and none is a
behaviour defect** — I could not construct a wrong answer out of the branch as
written. Six findings below are cheap; all are proof gaps but one, which is a
stale sentence. The round ships on them.

One inert "mutation" nearly became a false survivor — a `sed` that matched
nothing while the runner reported green — so every mutation below was proved to
have changed its file before its suite ran.

Baseline at this tip, all run here and all clean: check-source static (5
stages) · unit (207 suites) · check-conformance (11 goldens, 235 steps) ·
check-random (2000 runs, 80000 steps) · check-postgres (76 suites) ·
check-queries · check-boundaries (1056) · check-console (5 scripts, 1299
tests) · check-console-sheets (31) · check-model (114) · check-figures (102) ·
check-comments (907) · check-paths (1212 claims) · doc-lint (21) ·
check-duplication (1037) · check-gates (23).

## The table — red

| # | mutation | went red in |
|---|---|---|
| M1–M3 | `resumeOf`: eval-blocked→`ResumeWork`, finalization→`ResumeRework`, `NoEscalation`→`ResumeWork` | `deciders` ×2–5, `enablement`, `decisionSemantics` |
| M4, M5 | `decideExecutionBlocked`'s Evaluation arm takes the work wall; its label misspelt | `deciders`; M5 also check-conformance |
| M6 | `deskConsistent` a tautology | `invariants` |
| M7 | `retryableIn` admits an unparked ticket | `enablement`, `deciders` |
| M8–M10 | `escalate` stamps `NoEscalation`; revoke / resume keep the wall | `deciders` ×1–5 |
| M11–M13 | legality admits older semantics; `isDecisionSemanticsVersion` admits 5; current 6→5 | `journal`, `decisionSemantics` |
| M75 | `ExecutionBlocked` enablement widened past `taskPhaseIn` | "every conjunct of every enablement refuses on a state that fails it alone" |
| M80 | `ticketEquals` drops `escalation` | `equality` |
| M14–M16 | `escalationKinds` without the new member / with `NoEscalation`; `gitEvidences` without one | `rosters` |
| M18 | the evidence union becomes `z.string()` | check-console **typecheck**, TS2345 at `codeLabels.ts:161` |
| M19 | `ticketEscalationResource` always `ResumeWork` | `responses` |
| M25, M26 | the submission's `kind` fence / its roster check dropped | `wire` |
| M68 | a raise offers `["Revoke"]` alone | `i3` |
| M79 | the new golden's manifest `steps` 9→8 | check-conformance |
| M21 | `projectionOf`'s IntegrityContradiction disabled | `projection` |
| M23, M27 | the `ExecutionBlocked` evidence arm never fires; the continuation landing carries none | `dispatchWriter` |
| M28 | the inbox read stops joining `execution.blocked_reason` | `schedulerStore` ×2 |
| M30–M33 | each of the four new/`execution` GRANTs removed, one at a time | `migration`, naming the exact role and column |
| M34–M36 | roster without the new member; evidence CHECK inverted; `DependencyRevoked` arm dropped | `migration`, `ticketProjection`, `nativeActionAdmits` |
| M38–M41 | validator admits any block; the event carries `reason` again; the wall not written to `execution`; the approval writes a wall | `migration`, `scheduler`, `schedulerStore`, `finalizerApproval` |
| M42–M44 | upsert keeps stale evidence / never writes it / drops `escalation` | `ticketProjection`, `finalizerUnavailable`, `schedulerStore`, `projectChange` |
| M48, M50, M69, M70 | the single read and the identity list drop the evidence column; the resource drops it; `NoEscalation` read as a kind | `nativeReads` ×1–3, `finalizerUnavailable` |
| M74 | the stored-row semantics fence disabled | `journal` ×3 |
| M51–M56 | wipe keeps `journal_entry`; no `RESTART IDENTITY`; `ticket_next`/`head`/cursor not reset; a kept table added | `migration`'s wipe case |
| M57, M58, M64, M77 | the new kind label / a git label / the new badge / the new sentence collides with a sibling | `codeLabels` ×2, `ticketSections` ×2, `codeSentences` |
| M59 | `escalationDetail` prefers the kind over the evidence | `codeLabels` ×3, `ticketPageLedger` ×2 |
| M61 | the eval-blocked second line says "Work cancelled" | `codeLabels` |
| M62, M63 | `NoPoint` offers a resume; the page never reads `escalation.resumeAt` | `codeLabels` ×3; 18 console tests |
| M65, M76, M78 | badge ignores the kind; the notice's kind fixed; `ResumeEvaluation` copy | `ticketSections`, `projectTable*`, `ticketPageLedger`, `codeLabels` |
| Q1–Q4 | `.qnt`: `resumeOf`'s eval and `NoEscalation` arms; `decideExecutionBlocked`'s Evaluation arm; its label | check-model unit / refinement |
| Q6–Q9 | `.qnt`: `retryableIn` widened; `escalate` stamps nothing; revoke / resume keep the wall | check-model ×1–5; Q8 also `[violation]` in the randomized run |

## Findings — proof gaps and one stale sentence, none blocking

1. **`src/contract/rosters.ts:43-44` — the sentence this change edited is now
   false.** "the machine has one escalation for all five, and a ticket carries
   a wall only while that one is its own." After this PR a `BlockedReason` is
   the evidence for **two** escalations: `decideExecutionBlocked` stamps
   `EvaluationBlockedEscalated` on the Evaluation arm, and
   `projectWriterEscalationEvidence` (`projectWriter.ts:569-575`) records the
   same `executionBlockedBy` beside it. The console's sibling header got it
   right (`codeLabels.ts:62-65` names both arms); this one was reworded
   reason→escalation without fixing the count, so a reader of the roster
   concludes the evidence appears only beside
   `WorkExecutionUnavailableEscalated`. Fix: name both walls, as
   `codeLabels.ts` does.
2. **`test/interpreter/projection.test.ts:236` — "and no other" is vacuous.**
   The fixture graph holds one ticket, so replacing
   `escalated?.ticket === ticket` with `escalated !== undefined`
   (`projectWriter.ts:175`) passes the case, the whole unit suite and
   check-postgres (M22). It is unobservable today only because no escalating
   decision changes a second projection row. Fix: escalate inside a graph with
   a second live ticket and assert that row carries no evidence.
3. **`test/postgres/migration.test.ts:3112, 3136` — the guard's red-proof is
   coarser than the guard.** `escalatedProjection` seeds a `journal_entry`
   *and* a `ticket_projection` row, so pointing 008's guard at
   `public.ticket_projection` instead of `public.journal_entry` leaves the case
   green (M37). What the header states is about the journal the actor replays;
   a rig whose projection was emptied but whose journal was not would migrate
   and then refuse every row on read. Fix: seed the journal row alone.
4. **`src/adapters/postgres/nativeReads.ts:240-249` — the one narrowing over an
   unchecked column is unproved.** Its header says the column carries no CHECK
   and that this is where a value the wire cannot spell is caught; replacing the
   raise with `return value` leaves `nativeReads` green (M47), because no case
   seeds an evidence off the three rosters. Its sibling `projectionEscalation`
   (M46) survives too, but that column *is* closed by
   `ticket_projection_escalation_is_known`. Fix: one seeded junk evidence and an
   `assert.rejects`.
5. **`ui/chuggy-ui/test/ticketActions.test.ts:74-85` — the new wall's resume
   sentence is free to say the wrong thing.** The case asserts two distinct
   sentences and names which two kinds get which; `EvaluationBlockedEscalated`
   is named by neither, so putting it on "rework this ticket with a fresh
   cycle" keeps the count at two and ships (M66) — false copy, that resume
   re-entering evaluation. One `expect` closes it; PR 4's sweep found the same
   shape at C1b.
6. **`test/contract/responses.test.ts:298-302` — the case's own header states
   what it does not assert.** "The evidence is optional and the resume is not":
   making `resumeAt` optional in `ticketEscalationSchema` (`responses.ts:214`)
   is green everywhere (M17). One `assert.throws` on a body whose escalation
   omits `resumeAt`.

## Survivors that are not findings

- **Unobservable, unreachable by construction.** M20 `ticketEscalationResource`'s
  `NoResume` raise (`resumeOf` answers `NoResume` for `NoEscalation` alone,
  which is no `EscalationKind`); M24 the finalization evidence arm's
  `out !== FinalizationResultUnavailable` term (the mailbox fence
  `wire.ts:247`, red-proved by M25/M26, admits `kind` only beside that
  outcome); M29 and M46, the two narrowings whose columns carry CHECKs; M60 the
  order of the two evidence-roster guards (the rosters are disjoint).
- **M45** `native_action.escalation` written as `'NoEscalation'` — **nothing in
  `src/` selects that column.** Written and never read (pre-existing as
  `native_action.reason`, renamed here). Unobservable; worth knowing before
  someone builds a read on it.
- **Unpinned but right:** M49 the by-activity list read's evidence column and
  M67 the inbox pill's tooltip wiring (`Inbox.tsx:356`); the identity list
  (M50) and the sentence map are pinned, these two are not.
- **Model-side gaps, implementation covered.** Q5: `deskConsistent` weakened to
  a tautology survives check-model, because a Quint invariant is asserted to
  hold and never to reject — the TS mirror's negative case is red (M6). Q10:
  the refinement's `ExecutionBlocked` enablement widened past `taskPhaseIn`
  survives all three refinement mains; the TS mirror is pinned (M75).
- **M72, M73** two fences outside this diff's added behaviour
  (`storedSchedulerCompletion`'s completion-event check; the dispatch-contract
  semantics check). Pre-existing, noted only.

## Docs pass and fabric alignment

Every comment and header the diff touches reads true against the code beside it
**except finding 1**. Checked in particular: 008's "the two new columns take the
grants `reason` held" (baseline `privileges.ts:805-808` — true); `readiness.ts`'s
"durable by the time this read can see the item" (`submit_task_completion`
writes the execution in the same transaction as the `decision_input` insert —
true); `decisionPlan.ts`'s "the resume and the revoke are both enabled at it"
(`revocableIn` excludes Done/Revoked/Finalization — true); `nativeWeb.ts`'s "as
its own read and a project's page both carry it" (both list queries now select
`escalation_evidence` — true). check-figures, check-comments, check-paths and
doc-lint are 0; the branch spells no quantity in a comment and no comment it
adds refers to the change that produced it. The new golden is real:
`evaluation-blocked.itf.json` ends `Evaluation → Escalated` labelled
`ticket-escalated evaluation_blocked_escalated`, ticket 3 at
`EvaluationBlockedEscalated`.

**Fabric alignment: clean.** Nothing under `.chug/`, `images/`, `deploy/`
(outside the wipe script) or in `~/claude/chuggy-fabric` or
`~/claude/chuggy-fabric-wt/{no-accounts,rollout-fix,worker-roster-build}` names
`reason` as a ticket escalation, `resumeAt`, `resume_at`, `executionBlockedBy`,
`finalizationBlockedBy`, `escalationReasons` or any old spelling. The worker's
ticket tools pass the read through as JSON and name `phase` alone
(`images/worker/chuggyTools.mjs:476-487`), so the wire break reaches no worker;
the `reason` hits under `images/worker/` are the selector's agentic refusal and
HTTP refusal codes.

## Notes

- Practices invoked: `comments-describe-the-code` (finding 1 — a reader with no
  knowledge of this branch takes the sentence as current) and
  `modular-and-layered-code` (findings 2–4 are its "test hardest at domain
  boundaries"; the boundaries here are a tagged query, a column with no CHECK,
  and a migration guard).
- I did not mutate the goldens' step bodies — they are the model's output and
  check-conformance refuses to regenerate by design; I mutated the manifest
  instead (M79).
- Worktree removed, `sweepdb` dropped.
