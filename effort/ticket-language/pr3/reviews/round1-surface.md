# Round 1 review — surface half (interpreter, adapters, contract, console)

Branch `model/rename` @ 64e5abb5, base main 55de9de6. Worktree
`~/claude/chuggy-wt/rename-review-surface`. Reviewer did not author the change.

**CHANGES** — the rename itself holds: the fabric boundary does not move, the
evidence reaches the reader and is proved against a real server, and every
stored-row reader in this half goes through the normalising decoder. Two
mechanical gaps, both fixable in one commit.

## Findings

### 1. The five wall labels fell out of the only check that covered them, and the two new label functions have no test

`ui/chuggy-ui/app/core/codeLabels.ts:59` (`blockedReasonLabel`) and `:81`
(`escalationDetail`).

On main, `ui/chuggy-ui/test/codeLabels.test.ts:55` built `drawn` from
`escalationReasons.map(escalationReasonLabel)`. `escalationReasons` was the
seven, so the five wall strings were checked non-empty, ≤ 60 chars
(`copyBudgetChars`, "§1.1 rule 7") and free of `.:;`. On the branch
`escalationReasons` is three, and nothing maps `blockedReasons` over
`blockedReasonLabel`, so the five strings the ticket page now actually draws —
"Execution denied by policy", "No matching execution profile", … — are drawn
by an untested function and checked by nothing. `escalationDetail`, which is
what `TicketSituation.tsx:74` calls, has no test at all: neither the
wall-present arm nor the wall-absent arm (the continuation path, which is the
one arm the change newly relies on).

House rule 13, and the standing commitment that an unverified control is worse
than none: the control was verified before this change and is not now.

Do instead: add `...blockedReasons.map(blockedReasonLabel)` to that test's
`drawn`, and one case for `escalationDetail` with a wall and one without.

### 2. Comments still naming phases the tree no longer has

- `ui/chuggy-ui/app/core/inboxUnion.ts:8` — "`Finalizing` is not a phase the
  section holds". The phase is `Finalization`; backticked, so it is naming the
  constructor and not the product's word.
- `ui/chuggy-ui/test/inboxApproval.test.tsx:6` — the same sentence.
- `test/interpreter/leadTurn.test.ts:422` — "the first left the ticket
  Working". Its own subject, `src/interpreter/leadTurn.ts:345`, *was* updated
  in this diff to "left in `Work`", so the pair now disagrees.
- `test/interpreter/selector.test.ts:2723` — "a ticket the first left Working".
- `ui/chuggy-ui/app/core/codeLabels.ts:142-146` — the second half of the
  `phaseLabel` header, "decided before the phases were renamed to fit the
  package's `TaskKind` constructors, and not reopened here", is bound to this
  change rather than to the code: a reader who does not know this PR cannot
  read "here". The first half ("`Working`/`Evaluating`/`Finalizing` are the
  product's own words for `Work`/`Evaluation`/`Finalization`") is what a future
  reader needs and should stay. Practice `comments-describe-the-code`
  (invoked), §1 and §3; house rule 16.

`check-comments`, `check-figures` and `check-paths` are all clean, so none of
this is a gate finding — it is the tree's own bar for a comment as a doc.

## What was checked and not flagged

**1. The fabric boundary.** `decisionPlan.ts:72-74` is the only place a domain
task kind becomes a fabric string (`WorkTask` → `"Work"`, `EvaluationTask` →
`"Evaluation"`, stage carried). `executionRequirement.ts:3,353,434`,
`executionScheduler.ts:171,357,760`, `executionSchedulerRun.ts:474,499`,
`workerPlane.ts:24`, `executionSource.ts:20`, `operationsView.ts:97`,
`workerPlaneCredentials.ts:158` all still hold `"Work" | "Evaluation"` and are
untouched. `Verdict`, effect strings and `images/worker/*` are byte-identical
to main. The single place a fabric string re-enters the domain is
`wire.ts:333` `storedSchedulerCompletion`, and it maps. A worker on today's
image still completes a task dispatched by this branch.

**2. The evidence.** Traced `ExecutionProfileUnavailable` from
`blockExecution` → `execution.blocked_reason` → `submit_task_completion`'s
`ExecutionBlocked` → `storedSchedulerCompletion` (lift to
`WorkExecutionUnavailableEscalated`) → `ticket_projection.reason` →
`nativeReads.ts:527-535` correlated read → `TicketResource.executionBlockedBy`
→ `outcomes.ts:350` (passes the resource through whole) → `TicketSituation`.
`execution_outcome_is_whole` (`baseline/relations.ts:231`) makes
`blocked_reason` non-null exactly on `outcome='Blocked'` and `terminal_at`
non-null on a terminal row, so the `ORDER BY terminal_at DESC, execution DESC`
is total and the narrowing at `nativeReads.ts:117` cannot see a null it treats
as a wall. `chuggy_api` has `SELECT(terminal_at)` from the baseline and
`SELECT(blocked_reason)` from `006-rename.ts:408`.
`test/postgres/schedulerStore.test.ts:720-837` drives all of this under
`postgresHarnessRolePool(apiRole)` — three cases: the wall, the latest of two,
and absent — and `check-postgres` is clean, so the grant and the query are
proved rather than argued.

The continuation path is the accepted loss: `projectWriter.ts:525` now
journals `WorkExecutionUnavailableEscalated` for an unreadable source and
writes no execution row, so the wall name reaches nothing and the page shows
`escalationReasonLabel`'s "Execution unavailable". GOAL.md defers that to
PR 5 and both the optional schema field and `escalationDetail`'s undefined arm
tolerate it. The `RemoteDenied` distinction still survives on the operation's
own refusal code (`executionSourceRefusalCode`, unchanged).

**3. Stored-row readers.** `parseStoredEntry` lifts every row before decoding,
after `storedJournalRowVerified`; `digest.ts` hashes the stored text, so the
lift cannot report tampering. `journal.ts:204` (dispatch contracts),
`journal.ts:326` (load), `readiness.ts:383` (finalization submission, via
`checkedFinalizationSubmission`, whose lifted outcome is then validated
against `finalizationOutcomeTags`) and `parseStoredTicketCommand`'s two
boundary arms all go through it. `rowAtCurrentVocabulary` is field-scoped
rather than a blind walk, and no journaled event or record carries a `TaskKind`
(`modelTypes.ts:117-185`), so nothing that needs lifting is out of its reach.
No public stored command can carry a renamed word: `CreateTicket` is excluded
from `OperationDecisionEvent` (`ticketCommand.ts:31-37`), and `Revoke`,
`Dispatch` and `ResumeTicket` carry ticket ids only.

**One reader does compare a stored spelling directly**:
`readiness.ts:440` lifts `project_continuation.expected_phase` as a raw string
and `projectWriter.ts:257` compares it to `ticket.phase`. It is correct only
because `006-rename.ts:123` rewrites those rows; the decoder never sees it.
Worth knowing, not worth changing here.

**4. Wire and contract.** `escalationReasons` is the three;
`ticketResponseSchema.executionBlockedBy` is optional and enumerates
`blockedReasons`; `test/contract/rosters.test.ts:184` holds
`blockedReasons` against the interpreter's `allBlockedReasons` (the contract
restates rather than imports, so the roster is held by a test rather than by
the dependency — correct for the layering). `src/contract/document.ts` is
generated from the request schemas and names none of the renamed words, so
there was nothing to follow there. Grepped the branch for `Working|Evaluating|
Finalizing|ResumeWorking|ResumeReworking|ResumeEvaluating|ResumeFinalizing|
ReleaseTicket|WorkFailed|ReworkBudgetExhausted|FinalizationFailed`: every hit
in this half is an old-spelling admit (`currentVocabulary`,
`nativeReads.ts:453,498,554` `IN ('ReleaseTicket','CreateTicket')`,
`wire.test.ts:314`), product copy (`ConversationWorkCard.tsx:140`,
`phaseLabel`, `shellNav.test.ts`, `createAndReleaseTicket` — the console's own
verb for releasing a draft, which names no event), or finding 2.
`decideReleaseTicket` in `src/domain`/`src/actor` is the machine reviewer's.

**5. Console.** Phase words are the product's existing copy; the three reason
labels, badges and sentences are exhaustive and within the copy budget; the
wall label comes off `executionBlockedBy`; `Stage` headers and
`ConversationWorkCard`'s "Working" are untouched. Copy reads as nouns and
fragments, per the standing copy rule.

## Gates run

| gate | exit | line |
|---|---|---|
| `check-source.sh` | 0 | 6 stages, 208 suites, all clean |
| `check-console.sh` | 0 | 5 scripts across 1 built console |
| `check-postgres.sh` | 0 | 75 suites against postgres:18-alpine |
| `check-comments.sh` | 0 | 0 findings across 907 files |
| `check-figures.sh` | 0 | 0 findings across 102 files |
| `check-paths.sh` | 0 | 0 findings across 1207 path claims |

**Environment note for the next round.** The brief's setup step is wrong:
running `npm ci` inside `ui/chuggy-ui` wipes the root install (it is a
workspace with no lock of its own), and `check-source` then false-reds with
"LINTER ERROR — no local prettier", exit 2. `npm ci` at the root only. This is
the known trap in `chuggy-false-reds`.

Practices invoked: `comments-describe-the-code`.
