# Mutation sweep — PR 3 (the rename), whole branch

Reviewed at `a704946c` in `~/claude/chuggy-wt/rename-sweep`, detached, scope
`git diff 55de9de6...a704946c`. Fresh session, authored none of it. Every
mutation below was applied one at a time and reverted with `git checkout -- .`;
the tree is clean at `a704946c` and nothing was committed.

## CHANGES

Sixty-three mutations, covering every behaviour the brief names. Fifty-two went
red in a suite that names the behaviour it lost. Eleven did not, and none of
the eleven is a behaviour defect — they are unpinned behaviours, listed
separately at the end, and under the house rule a sweep round would ship on
them.

The finding that stops it came from reading rather than mutating: **the rename
makes the console say two different words for the same phase**, because two
surfaces draw `ticket.phase` raw while every other surface draws
`phaseLabel(phase)`. Before this PR those were the same string. Three comments
naming a constructor this PR renamed, in files this PR edits, follow it. All
four are one commit.

Baseline before mutating, every gate clean at this tip: doc-lint (21 files),
check-figures (102 files), check-paths (1207 claims, 1158 files), check-comments
(907 files), check-knowledge, check-gates (23 gates), check-duplication (1036
files), check-console-sheets (31 sheets), check-shell-quoting, check-roster
(8 practices), check-boundaries (1056 modules), check-source (6 stages),
check-console (5 scripts), check-conformance (9 goldens, 184 steps),
check-random (2000 runs, 80000 steps), check-queries, check-postgres (75
suites), check-model-api, check-model (111 tests). The nine goldens were
re-emitted into a scratch `CHUG_GOLDEN_DIR` and are byte-identical to the
committed corpus.

## Findings

### 1. Two console surfaces draw the phase constructor where the rest of the product draws the phase's word

`ui/chuggy-ui/app/core/conversationMention.ts:58` and
`ui/chuggy-ui/app/browser/ui/TicketReference.tsx:70`.

`phaseLabel` (`ui/chuggy-ui/app/core/codeLabels.ts:145`) exists because the
constructor is no longer the product's word: it maps `Work`/`Evaluation`/
`Finalization` back to "Working"/"Evaluating"/"Finalizing". `ProjectTable.tsx:155`,
`TicketHead.tsx:140` and `TicketSituation.tsx:89` all go through it. These two
do not:

- `conversationMention.ts:58` — `description: ticket.title ?? ticket.phase`. An
  untitled ticket in the @-mention list now reads **"Work"** where the project
  table two panes away reads "Working". `ui/chuggy-ui/test/conversationMention.test.ts:86`
  was changed in this diff from `toBe("Working")` to `toBe("Work")`, so the
  regression is now asserted.
- `TicketReference.tsx:70` — `<span className="visually-hidden">{facts.phase}</span>`.
  A screen reader now hears "Work" for the pill a sighted reader sees as
  "Working". The file's own header (`:5-8`) says a reference "says the same
  three things a phase [pill] does"; after this change it does not.
  `ui/chuggy-ui/test/ticketReference.test.tsx:62` was changed the same way.

`tasks/C-report.md` names this as a judgment call — "they draw the wire's own
word, not a copy label". That reasoning held while the wire's word and the
product's word were the same string, which is exactly what this PR ends. The
PR's own scope is "language only: no machine change"; making the product call
one phase two things is a change it did not set out to make. Do instead: wrap
both in `phaseLabel` and restore the two assertions to "Working".

This is the only one of C's five judgment calls I disagree with. The other
four — `phaseLabel`'s three-arm mapping, the five-wall collapse plus
`blockedReasonLabel`, `ConversationWorkCard.tsx:140`, `shellNav.test.ts`'s
`leadStanding` — all check out, and the wall collapse is now tested (F1).

### 2. Comments naming a constructor this PR renamed, in files this PR touched

Round 1 found this class at `inboxUnion.ts:8`; F1 fixed four. Four more stand,
each in a file the diff edits, each backticked and so naming the constructor
rather than the product's word:

- `test/postgres/finalizerClosure.test.ts:3` and `:7` — "racing the entry into
  `Finalizing`" and "`revocableIn` excludes `Finalizing`". The same file's
  assertions were changed to `"Finalization"` at `:198` and `:286` in this
  diff, so the header and the body now disagree.
- `test/postgres/ticketProjection.test.ts:13` — "a fixture that stopped at
  `Working`". The header's paragraph above it was updated in this diff
  (`core` → `graph`); this line was not.
- `ui/chuggy-ui/test/ticketApproval.test.tsx:7` — "operational protocol rather
  than `Core` state". `Core` is the type this PR renamed to `TicketGraph`, and
  line 3 of the same header was updated in this diff.

Practice `comments-describe-the-code` (invoked), §1: the comment describes a
name the code beside it no longer has.

### 3. The same class in a file the diff does not touch

`test/postgres/finalizerHarness.ts:3`, `:16`, `:531`, `:596` — four sentences
about a ticket "into `Finalizing`". Untouched by the diff, so strictly outside
its hunks, but the rename is what made them false and no later change will
find them. Worth the same commit.

## Mutation → what went red

### `src/actor/decisionSemantics.ts` — `currentVocabulary`, one key at a time

Each key removed alone; unit, check-conformance and check-random run for each.
Conformance and random stayed green throughout (the corpus speaks the new
vocabulary and never replays a stored row).

| Key dropped | Red |
|---|---|
| `ReleaseTicket` | unit: `decisionSemantics.test.ts` (fixture replay), `a writer rebuilds a history from the machine that decided it, not from its own` |
| `Working` | the same two |
| `Evaluating` | the same two |
| `Finalizing` | **nothing** |
| `WorkFailed` | **nothing** |
| `ReworkBudgetExhausted` | **nothing** |
| `ExecutionPolicyDenied` | `a stored block names the wall it hit and is read as the reason the machine has` |
| `TicketConfigIncompatible` | the same |
| `ExecutionProfileUnavailable` | the same |
| `RuntimeVersionUnsupported` | the same |
| `RequiredCapabilityUnavailable` | the same |
| `FinalizationFailed` | `a submission stored at the superseded outcome is read as the outcome this image has` |
| `ticket-escalated work_failed` | **nothing** |
| `ticket-escalated rework_budget_exhausted` | 6 unit, incl. `a pinned row says the old words and is read as the new ones` |
| `ticket-escalated execution_blocked` | **nothing** |
| `rework-started finalization_failed` | **nothing** |

The six that redden nothing are exactly the words the two frozen fixtures do
not contain. `journalAtSemanticsOne{,Walls}.json` between them hold `Working`
(4/6), `Evaluating` (5/8), `ReleaseTicket` (1/2) and
`ticket-escalated rework_budget_exhausted` (1/2), and none of the other six.
The five walls and `FinalizationFailed` are pinned by the two new wire cases
rather than by a row. See unpinned §1.

### `rowAtCurrentVocabulary` — the fields it walks

| Mutation | Red |
|---|---|
| `rec.transitions[].from` left unlifted | unit ×2 (fixture replay, writer-rebuild) |
| `rec.transitions[].to` left unlifted | the same two |
| `rec.label` left unlifted | unit ×6 |
| `event.type` left unlifted | unit ×2 |
| `event.value.reason` left unlifted | `a stored block names the wall it hit…` |
| `event.value.out` left unlifted | **nothing** — see unpinned §2 |

### `src/interpreter/wire.ts` — where the lift is applied

| Mutation | Red |
|---|---|
| `parseStoredEntry`: `rowAtCurrentVocabulary` removed (equivalent to running it after the codec) | unit ×2 |
| `parseStoredEntry`: lift only when `semantics === 5` | unit ×2 |
| `checkedFinalizationSubmission`: `wordAtCurrentVocabulary` removed | `a submission stored at the superseded outcome…` |
| `storedSchedulerCompletion`: `rowAtCurrentVocabulary` removed | `a stored block names the wall it hit…` |

### `decisionSemantics.ts` — the cascade correction and the version

| Mutation | Red |
|---|---|
| correction dropped at 1 | `a revoke that parked the tickets behind it is replayed, not refused` |
| correction dropped at 2 | that, plus `the cascade parks its dependents where nothing but a revoke reaches them` |
| correction dropped at 3 | `a revoke that parked the tickets behind it is replayed, not refused` |
| correction also runs at 4 | the same |
| parked set unrestricted (`pending.has(t.ticket)` filter dropped) | `a cascade parking anything but a Pending dependent is refused, not thrown on` |
| `decisionSemanticsVersionCurrent` back to 4 | `the current semantics is the one whose refusals this module states` |

### The fabric boundary

| Mutation | Red |
|---|---|
| `decisionPlan.ts:71-75` domain→fabric task-kind map inverted | **tsc** (`stage` required on `Evaluation`), **check-postgres** ×14 (`execution_request_task_check`: `2:0:SpawnWork, 1, Evaluation, null`) |
| the same map dropped — every task emitted as `kind: "Work"`, no stage | **nothing**: tsc, unit, conformance and check-postgres all green. See unpinned §3 |

`wire.ts` has no fabric→domain task-kind lift to drop: the only lifts in it are
the two above, and `modelTypes.ts` puts no `TaskKind` inside any journaled
event or record.

### `executionBlockedBy` — the correlated read and its grant

| Mutation | Red |
|---|---|
| `nativeReads.ts:540` `t.reason='WorkExecutionUnavailableEscalated'` dropped | check-postgres |
| `nativeReads.ts:541` `ORDER BY x.terminal_at DESC,x.execution DESC` inverted to ASC | check-postgres |
| `nativeReads.ts:539` `x.outcome='Blocked'` dropped | **nothing** — see unpinned §4 |
| `006-rename.ts:408` `GRANT SELECT(blocked_reason) … TO chuggy_api` removed | check-postgres, three suites |

### Migration 006 — eleven mutations, eleven reds

| Mutation | Red (`test/postgres/migration.test.ts`) |
|---|---|
| `ticket_projection.phase` rewrite skipped | `every stored spelling in a rewritten column becomes the package's` |
| `ticket_projection.reason` rewrite skipped | that, plus `a row each arm must not match migrates` |
| `ticket_projection.resume_at` rewrite skipped | `every stored spelling…` |
| `native_action.reason` rewrite skipped | `every stored spelling…` |
| `project_continuation.expected_phase` rewrite skipped | `every stored spelling…` |
| `RuntimeVersionUnsupported` left out of the projection's wall collapse | `every stored spelling…` |
| restated phase CHECK still admits `'Working'` | `each rewritten column refuses the spelling it left` |
| `decision_event_is_valid` refuses `'ReleaseTicket'` | 3 cases, incl. `the boundary admits a stored event's spelling and the one it writes next` |
| `journal_entry_release_ticket` recreated over `'CreateTicket'` alone | 3 cases, incl. `the release index answers a read at either tag` |
| `submit_finalization_result` refuses `'FinalizationFailed'` | `the finalizer's door concludes at either spelling of the outcome it needs work under` |
| `request_finalization_approval` binds `bound.phase` to `'Finalizing'` | 13 cases, incl. `the approval door binds to a ticket the projection holds at the renamed phase` |

### `model/`

| Mutation | Red |
|---|---|
| phase `Finalization` reverted to `Finalizing` across `model/` | **check-model-api** (`modelTypes.ts` and `model-api.ts` stale). check-model green, conformance green, random green, unit green. Golden emission fails outright (`finalization-succeeded: no trace was written`) |
| reason `WorkFailureEscalated` reverted to `WorkFailed` across `model/` | **check-model-api**, same two lines. check-model green, conformance green. Five goldens no longer reproduce |
| `refinement.qnt:355` `decisionEventEnabled`'s `ExecutionBlocked` arm names `WorkFailureEscalated` | **check-model**: `executionBlockedResumeRecoversTest` |
| wall collapse undone — `domain.qnt:805` `executionBlocked` draws a `why` again | **nothing**: check-model, conformance and random all green. Six of the nine goldens stop reproducing. See unpinned §5 |

The corpus is the thing a model-only mutation moves, and it moves silently:
`emit-goldens.sh` is not a gate and `check-conformance` replays the committed
files against `src/`. That is the tree's stated design and not this PR's
defect; it is why the first two rows above are reported against
check-model-api.

### Contract and wire

| Mutation | Red |
|---|---|
| `escalationReasons` carries a fourth name (`WorkFailed`) | tsc (two non-exhaustive switches), unit: `the escalation reasons are the model's, less the absent one` |
| `phaseRoster` spells `Finalizing` | tsc ×3, unit: `the phase and scheduler rosters are the model's` |
| `ticketResponseSchema` drops `executionBlockedBy` | tsc ×2, unit ×2 (`a ticket read emits exactly the keys the contract names`) |

### Console

| Mutation | Red |
|---|---|
| `phaseLabel` returns the constructor | check-console ×4 (`projectTableLabels`, `ticketPageLedger`) |
| `escalationDetail` ignores the wall | check-console: `the escalation's one line names the wall where the read carries one` |
| `blockedReasonLabel` loses one wall's label | check-console ×2, incl. the copy-budget case (F1's addition, biting) |
| `escalationDetail` draws the wall only when `reason` is `WorkExecutionUnavailableEscalated` | **nothing** — see unpinned §6 |

### The frozen fixtures

| Mutation | Red |
|---|---|
| `journalAtSemanticsOne.json`: one byte of a transition (`Working` → `Workinh`) | unit ×2 |
| `journalAtSemanticsOne.json`: one byte of a record label (`dispatch` → `dispatcg`) | unit ×3 |
| `journalAtSemanticsOneWalls.json`: one byte of a `seq` (4 → 5) | unit: `the two-wall history holds an EvalReduce row on each disposition edge` |

There is no digest field in either fixture: what refuses a corrupted byte is
`storedJournalLegalOn` comparing the replayed record with the stored one, which
is the right thing to be doing it.

### Fabric alignment

`.chug/configurations/{basic-coding,chuggy-development}.json` and
`images/worker/*` name none of the renamed words and are byte-identical to
main (the diff touches neither directory). `images/worker/entrypoint.mjs`
still speaks `taskKind: "Work" | "Evaluation"`, which is the boundary GOAL.md
says does not move. `~/claude/chuggy-fabric` at `dc1d465` carries none of the
old spellings and none of the new ones — its only hits are "Working agreement"
in `AGENTS.md` and `WorkingDir` in vendored Tekton. No fabric or worker release
is coupled to this PR.

## Unpinned behaviours — no test reddens, none is wrong

1. **Six of the sixteen `currentVocabulary` keys.** `Finalizing`, `WorkFailed`,
   `ReworkBudgetExhausted`, `ticket-escalated work_failed`,
   `ticket-escalated execution_blocked`, `rework-started finalization_failed`.
   The map is right; the corpus is short. `Finalizing` is the one that
   would bite: it is in `rec.transitions[].from/to` of every row that entered
   or left finalization, which is most of a real journal, and dropping it
   would refuse those rows at replay with nothing red on the way. The frozen
   fixtures cannot be rewritten (they are what proves old bytes replay), so
   the fix is a third fixture, or a table-driven case over
   `rowAtCurrentVocabulary`'s domain asserting every key lifts.
2. **`event.value.out` in the row lift.** A stored `FinalizationResult` at
   `out: "FinalizationFailed"` — an ordinary pre-5 row — decodes only because
   of that line, and nothing reddens when it goes. The neighbouring
   `checkedFinalizationSubmission` lift of the same word *is* pinned
   (`a submission stored at the superseded outcome…`), which is what makes the
   gap easy to miss.
3. **The domain→fabric task kind and its stage.** Collapsing
   `decisionPlan.ts:71-75` so every task is `kind: "Work"` with no stage passes
   tsc, unit, conformance and check-postgres. What catches the *inverted* map
   is `execution_request_task_check`, which pairs `kind` with the presence of
   `stage` and so only sees an `Evaluation` without one. Nothing asserts that a
   dispatched evaluation reaches the fabric as `Evaluation` at its stage. This
   is pre-existing — the identical mutation on main would behave the same way —
   and the rename only renamed the left-hand side of it.
4. **`x.outcome='Blocked'` in the correlated read.** With it gone the subquery
   takes the latest terminal execution whatever its outcome, and
   `execution_outcome_is_whole` makes `blocked_reason` NULL on any non-blocked
   one, so the wall would silently vanish from the page. It is load-bearing as
   soon as a ticket has two concurrent executions (work fanout ≥ 2) of which
   one blocked and the other failed later; the three cases at
   `test/postgres/schedulerStore.test.ts:720-837` are the wall, the latest of
   two blocks, and absent, and none is a mixed pair.
5. **The wall collapse in `domain.qnt`.** Giving `executionBlocked` a `nondet
   why` again leaves check-model, check-conformance and check-random green.
   `refinement.qnt` has no actor action for `ExecutionBlocked` at all — the
   roster is release/revoke/dispatch/taskDone/workReduce/evalReduce/
   finalizationResult/resumeTicket — so no refinement run journals one, and
   the arm's own correctness is held by `executionBlockedResumeRecoversTest`
   instead. Pre-existing; named because the brief asks which gate sees a model
   mutation, and here the honest answer is none.
6. **`escalationDetail`'s indifference to `reason`.** It draws
   `blockedReasonLabel(blockedBy)` whenever the field is present, whatever the
   reason. Narrowing it to draw the wall only under
   `WorkExecutionUnavailableEscalated` leaves check-console green, so no case
   pairs a present `executionBlockedBy` with another reason. The invariant is
   held by `nativeReads.ts:540`'s `t.reason=` predicate and by nothing on the
   client; `ticketResponseSchema` makes the field optional independently of
   `reason`, so a client is trusting the server here.

## Notes — looked at, not flagged

- **`escalationReasonLabel("EvaluationFailureEscalated")` still reads "Rework
  budget exhausted".** The reason was renamed; the label was not. Unlike
  finding 1 this is one word in one place with no second surface disagreeing
  with it, and product copy is explicitly out of the rename's scope. Worth
  Geoff's eye at some point, not worth a commit here.
- **`ExecutionTaskKind` now overlaps `Phase`** (`executionRequirement.ts:3`).
  The machine reviewer named it; unpinned §3 is the same seam seen from the
  test side, and it is why the collapsed map typechecks. A branded type would
  close both.
- **`request_finalization_approval` reads `'Finalization'` alone** while every
  other stored-spelling read admits both. It is right — the projection is
  rewritten above it — and it is the most heavily pinned statement in 006
  (13 cases).
- **The goldens' four moved step counts** reproduce exactly, so the manifest is
  honest about the traces the collapsed draw now walks.
- `check-figures`, `check-comments`, `check-paths` and `doc-lint` are clean and
  none of findings 2 or 3 is a gate finding: no gate reads a comment against
  the identifiers beside it.
- I line-joined the whole tree (including `ui/` and `.chug/`) for every old
  spelling in GOAL.md's table. Every hit is accounted for: the two frozen
  fixtures, `currentVocabulary`'s own keys, 006's deliberate both-spellings
  admissions and the landed migrations 003–005 it does not edit,
  `nativeReads.ts`'s three `IN ('ReleaseTicket','CreateTicket')` reads,
  `decideReleaseTicket`'s name (the model spells it that way), `phaseLabel`'s
  gerunds and `ConversationWorkCard.tsx:140`'s copy, the console's
  `createAndReleaseTicket` (its own verb, naming no event), `shellNav`'s lead
  word, `model/tests/chuggy_test.qnt`'s two local bindings, and findings 2
  and 3.
- Practices invoked: `comments-describe-the-code`.
