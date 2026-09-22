# Review: Task B round 1 (interpreter, adapters, contract; plus B-fix0)

**CHANGES**

Scope read: `git diff dc867998..eb7f1fdb` minus the schema merge, in
`~/claude/chuggy-wt/no-accounts-review-b` (detached at eb7f1fdb), plus the
added-scope commit `6fcb53cf` in `~/claude/chuggy-wt/no-accounts-fixb`. I read
`.chug/tasks/review-change.md`, `GOAL.md`, `tasks/B.md`, `tasks/B-report.md`
and `tasks/B-fix0-report.md`, and the touched files in full rather than the
hunks. Both worktrees are clean; every scratch edit I made to red-proof a test
was reverted with `git checkout -- .` and confirmed.

The change is good and the two things the brief singled out are right. The
journal-digest defect is real, correctly diagnosed and correctly fixed, and
chaining over the stored column is strictly stronger than what it replaced —
not a hole. The disposition is decided in the one place that holds both the
replayed core and the cap, it is journaled on the event, and it cannot be
reached from any other path. The cap's arithmetic is exactly the parenthetical
reading and both comparisons go red when flipped. The baseline edit is properly
undone and moved into 004, with the derivation, the CHECK text and the replace
target all verified against the tree.

Two findings. One is a behaviour the counting rule introduces that nothing in
the tree tests or states, and that contradicts the report's own claim of
equivalence with `BudgetedRework(2)`. The other is that 004 now adds a narrowed
CHECK that its own header says must be guarded, and is not.

## Findings

### 1. `src/interpreter/reworkCap.ts:46-48` with `src/domain/task.ts:52-64` — a finalization failure spends the rework cap

`workCyclesStarted` counts *every* maximal run of Work-kind tasks. A
`FinalizationFailed` re-enters Working (GOAL: "FinalizationFailed always
re-enters Working … no wall"), and the evaluation tasks retired ahead of it
close the previous run, so each finalization failure starts a new counted
cycle.

Driven through the real deciders (`refinementInstance`, `ManagedFinalizer`,
`workFanout: 1`):

```
dispatched                     phase=Working     cycles=1
work reduced                   phase=Evaluating  cycles=1
eval passed -> finalizing      phase=Finalizing  cycles=1
finalization failed -> working phase=Working     cycles=2
work reduced                   phase=Evaluating  cycles=2
eval passed -> finalizing      phase=Finalizing  cycles=2
finalization failed -> working phase=Working     cycles=3
work reduced                   phase=Evaluating  cycles=3
eval FAILED (the ticket's first) cycles=3
reworkDisposition(ticket, 2) = EscalateEvaluationFailure
```

So at the fabric's `rework.cyclesMax: 2`, a ticket whose finalizer fails twice
parks at the rework wall on its **first** evaluation failure. On `main`,
`reworkLeft` was decremented in exactly one place (`deciders.ts:322`, the
eval-failure rework branch); a finalization failure drew on `finalizationLeft`
and gas and never on `reworkLeft`. `tasks/B-report.md` claims the
implementation is "the old `BudgetedRework(2)` meaning", and for any ticket
with a `ManagedFinalizer` that fails an integration it is not.

This is not hypothetical on the rig: finalization failures are the ordinary
outcome of a PR that will not land cleanly, and the rig's release tickets carry
`ManagedFinalizer`.

Note also that counting them buys nothing: the cap is consulted only on an
evaluation failure (`projectWriter.ts:379-388`), so a finalizer that keeps
failing is never parked by it — the count only shortens the evaluation-rework
allowance, by an amount no reader of the configuration can predict.

Either behaviour may be the one Geoff wants, but one of the two must change and
neither is pinned:

- **If the cap is meant to bound evaluation reworks**, count only a work run
  that follows a *failed* evaluation run, and land the fix with a case in
  `test/interpreter/reworkCap.test.ts` that drives a finalization failure and
  asserts the disposition is unchanged by it.
- **If counting every rework is intended**, say so where the cap is defined
  (`reworkCap.ts:36-41` currently reads as though only evaluation reworks are
  counted: "`cyclesMax: 2` is two reworks and a park on the third failure"),
  correct the report's equivalence claim, and pin the behaviour with a case —
  house rule 13, since this is behaviour the change introduces and no test in
  the diff expresses it.

### 2. `src/adapters/postgres/schema/migrations/004-no-accounts.ts:157-159` — a narrowed CHECK outside 004's own guard

004's header states the rule the file is built on:

> THE GUARD IS THE FIRST STATEMENT BECAUSE A NARROWED CHECK IS NOT A NO-OP OVER
> STORED ROWS. `ADD CONSTRAINT` revalidates what the relation already holds,
> settled rows as much as live ones, so an installation that ever parked a
> ticket at a removed wall would otherwise fail partway down this list; it
> refuses at the top instead, naming the relations that hold the rows, and the
> whole migration rolls back with its ledger row.

`6fcb53cf` appends a fourth statement that is exactly a narrowed CHECK over
stored rows — `session_turn_text_is_bounded`, from 17525063 to 17403663 — and
does not extend the guard. An installation holding a `session_turn` row whose
`input` is in the 121,400-character band between the two figures fails at
statement 157, not at statement 1: `postgresMigrate` runs every pending
migration in one transaction (`src/adapters/postgres/pool.ts:206-224`), so the
rollback is clean, but what the operator gets is

```
ERROR: check constraint "session_turn_text_is_bounded" of relation
       "session_turn" is violated by some row
```

with no relation named as holding the offending row, no count, and no remedy —
the unnamed refusal the guard exists to replace. The band is narrow and such a
row is improbable, so the finding is not "this row exists"; it is that the
file's own stated control no longer covers the file, which is the shape
`.chug/tasks/review-change.md`'s "an unverified control is worse than none"
commitment is about, and which S's reviewer approved 004 partly on.

Cheapest fix, inside the existing `DO` block's `UNION ALL`:

```sql
UNION ALL
SELECT 'session_turn'
 WHERE EXISTS (SELECT FROM public.session_turn
                WHERE length(input) > 17403663)
```

with a case in `test/postgres/migration.test.ts` proving that arm refuses and
that it does not fire on a compliant row — the two-arm discipline S's reviewer
used on the existing guard, because an arm that never matches reads exactly
like one that works. Alternatively, narrow the header sentence so it claims
only the removed-wall relations; I prefer the guard, because the migration has
not landed and the clause is four lines.

## What I verified rather than took on trust

**The journal chain (`cc70361e`).** Main's verification did re-encode: the
diff removes `journalChainDigest(partition, previous, entry)` whose body was
`encodeEntry(entry)`. The claim that no pre-3 row re-encodes to its bytes
holds — I decoded the pinned pre-accounts release text through
`src/generated/model-api.ts` and re-encoded it: the three priced fields are
stripped and `re === stored` is `false`. So on `dc867998` every such row fails
integrity, `postgresJournalLegality` names the partition unreplayable and the
service will not start. Real, and the brief's lift alone does not fix it.

**Chaining over the stored column is not a hole.** The digest is an unkeyed
SHA-256, so it never protected against an actor who can write the table; what
it protects against is corruption, an edit, a splice and a mis-restore. Under
the new scheme the digest is a function of the raw bytes and the decode is a
function of the same bytes, so any byte change is caught. Under the old scheme
a tampering the encoder normalised away — reordered keys, respacing, a key the
current schema strips — passed verification; that hole is now closed, which is
what the new header paragraph claims. The one thing the chain no longer
attests is that the stored bytes are canonical under *today's* encoder, and
nothing needs that: `postgresJournalWrite` computes `entryText` once and uses
it for both the column and the envelope (`journal.ts:262,277`), so no writer
can produce a non-canonical row.

**The order is right, and the semantics column is covered.**
`postgresJournalStored` now verifies *before* it parses, so the lift is applied
under a semantics the digest attests: `journalEnvelopeDigest` includes
`String(envelope.decisionSemanticsVersion)` (`digest.ts:127`), so a tampered
`decision_semantics_version` fails verification rather than steering the lift.
An integrity-v1 row forces semantics 1 regardless of its column, which is the
pre-envelope case the suite already pins.

**`postgresJournalDispatchContracts` through the same seam is sound.** It does
not verify the chain — nor did it before, so no regression — and it now reads
the row's own `integrity_version`/`decision_semantics_version` through the same
`storedJournalRowSemantics` and refuses an unknown one. The only event it acts
on is `ReleaseTicket`, which the lift never touches.

**The pre-3 lift.** `parseStoredEntry` (`wire.ts:113-127`) is the store's decode
seam and the actor's copy is gone. Red-proofed twice: `semantics < 3` →
`<= 3` turns "a bare reduction stored at the current semantics is refused, not
lifted" red; hard-coding `onFailure` to `"ReworkEvaluationFailure"` turns "a
pre-3 reduction is read at the disposition its own record reports" red. Both
reverted. `test/actor/decisionSemantics.test.ts` does *not* go red under the
second mutation, which is correct rather than a gap: at semantics 1 and 2
`execDecisionEventAt` re-derives the disposition from the record anyway
(`decisionSemantics.ts:96-105`), so the lift only has to make the bytes decode.

**The cap's arithmetic, and where it is decided.** `test/interpreter/reworkCap.test.ts`
drives real deciders, and flipping `>` to `>=` in `reworkDisposition` turns both
cap cases red (verified, reverted). The fanout probe confirms a fanout-2 work
cycle counts once and a rework after an eval failure counts a second. Placement
is right and cannot be bypassed: `decision_event_is_valid`
(`baseline/functions.ts:787+`) admits only `Revoke`, `Dispatch`, `ResumeTicket`,
`TaskDone`, `FinalizationResult`, `ExecutionBlocked` and `ReleaseTicket` for an
operation, so no `EvalReduce` can arrive as a `Decide`; the continuation is the
only source, and the fence runs before `continuationReductionEvent` so
`ticketAt` is safe. Replay uses the journaled `onFailure` at semantics 3 rather
than recomputing it. I invoked
`fix-the-assumption-not-the-hack:fix-the-assumption-not-the-hack` here: closing
`DecisionInput`'s continuation arm to `ContinuationReduction` instead of
smuggling a placeholder `DecisionEvent` through the port is the rethink that
practice asks for, and it dissolved the `IntegrityContradiction` rather than
adding a check.

Worth knowing (not a finding): `workCyclesStarted` merges the work run either
side of a `ResumeWorking` from a `WorkFailed` park, so that resume costs no
cycle. That matches `main`, where `ResumeWorking` neither spent nor refilled
`reworkLeft`. The `ResumeReworking` case differs deliberately — `main` refilled
the budget at `deciders.ts:476` and the model no longer does, so the count keeps
climbing and the next failure re-escalates, which is GOAL's "no refill".

**The deployment-policy pin (`53932964`).** `::jsonb IS NOT DISTINCT FROM
${encoded}::jsonb` over a `text` column, so key order and spacing no longer
refuse a start; a differing policy still is, and a row that is not JSON raises
the cast, which `serviceRuntime.ts:273` catches into `Undecided` — a
`CouldNotRun`, not a pass. The coupling test S's reviewer asked for exists
(`migration.test.ts:1475-1500`): it installs the accounted baseline, runs 004,
and starts the precondition against the row 004 actually wrote.

**The observation floor, both times.** `sessionTurnInputCharsMax` imported from
`src/contract/http.ts` evaluates to **17403663**, which is the figure `8c7cfcfd`
rendered and the figure `6fcb53cf` moved into 004 and exported as
`leadObservationTokensPerDecisionAt004`. So the figure was right and only the
place was wrong.

**B-fix0 (`6fcb53cf`).** `git diff main -- .../migrations/baseline/` is empty:
the baseline is byte-identical to `main` again. The re-added CHECK is
character-for-character the baseline's with only the bound substituted (checked
mechanically, not by eye). Red-proofed on a real server: reverting 004's ALTER
literal to 17525063 turns "the installed session constraints match the runtime"
red, and changing the `replace` target turns "fresh selector settings carry
current controls and only their initial history" red — both reverted. The
pinning triangle is closed: `leadTokenBudget` holds the exported constant to
the derivation, the fresh-settings case holds the `UPDATE`'s literal to the
constant, and the installed-constraint case holds the `ALTER`'s literal to the
derivation, all through a fresh install that only reaches those values because
004 ran.

**The `replace` cannot miss in a way that matters.** `controls` is `text`
(`baseline/relations.ts:1048,1061`) written by `JSON.stringify`, which never
spaces a `:`, and the pattern is unanchored, so key order is irrelevant. The
only row it misses is one whose `tokensPerDecision` an administrator changed —
and that figure is the selector's own per-decision token budget, compared at
`src/interpreter/selector.ts:842`; it is not the `session_turn.input` bound and
is unrelated to the new CHECK. Realistic settings are three orders of magnitude
below either figure (`test/postgres/leadDecision.test.ts:62` uses 200_000). An
installation that keeps 17525063 is left with a ceiling slightly above what it
needs, which is permissive rather than wrong, and no test reads a migrated row.

**The wire.** `escalationReasons` lost exactly `FinalizationBudgetExhausted`
and `GasExhausted` and kept the other nine; the ticket view lost the whole
optional `accounts` object and its four fields; the authoring options lost
`reworkPolicies`, `finalizationPricings`, `resumePricings`.
`test/contract/contractDocument.json` is byte-for-byte what
`nativeHttpContractDocument()` emits — I regenerated it into the scratchpad and
diffed the canonicalised JSON: identical. Not hand-edited.

**`dispatchViewSchemaVersion` staying at 1 is defensible**, though not quite
for the reason the report gives. The proposal fence
(`projectWriter.ts:296-303`) never compares the token's `digest` to the
recomputed one; what carries the weight is
`selected?.ticketVersion === proposal.expectedTicketVersion`. A cached view
from before the upgrade differs only by three fields that fed no selection
decision and no admissibility test, and no field name was repurposed, so a
narrower row cannot be *misread* — only read as saying less. The reverse
direction (an old image reading the migrated `dispatch_candidate`) fails loudly
on the missing columns rather than silently, and one release carries both
anyway. I would not bump it.

**Gates, run here at eb7f1fdb.** `check-postgres` 75 suites clean;
`check-queries` agrees with the server; `check-conformance` 10 goldens / 206
steps; `check-boundaries` clean across 1059 modules; `check-comments` 0/908;
`check-paths` 0/1209; `check-figures` 0/102; `emit-goldens.test.sh` 14 passed.
Nothing exited 2. At `6fcb53cf`: `check-postgres` 75 clean, `check-queries`
clean, `check-comments`/`check-figures`/`check-paths` all 0 findings.

`check-source` is red in three stages (static, lint, unit). **Correction to the
brief**: the red files are *not* all under `ui/chuggy-ui/`. They are

- `ui/chuggy-ui/app/core/codeSentences.ts`, `resumePoint.ts`, `ticketCreation.ts`
- `test/ui/resumePoint.test.ts`, `test/ui/ticketActions.test.ts` (at the repo root)

Both root files import from `ui/chuggy-ui/app/core/` (`resumePoint.ts` and
`ticketActions.ts`), so `tasks/B.md`'s "if they test console files, leave for
C" applies and the author's decision 4 is within the brief. I note only that
`ticketActions.test.ts` is nearly free of that dependency — its two errors are
in its own fixture and in the `gasLeft` case that should be deleted — so C has
almost nothing to do there.

## Notes

- **Attribution**, as the brief asked me to note rather than find: `eb7f1fdb`
  and `6fcb53cf` carry `Claude Opus 5 (1M context)`, the other five carry
  `Claude Fable 5.1`. The harness changed the line mid-task. Settle on one
  before this lands.
- `test/actor/journal.test.ts:358-362` — the edited paragraph leaves one line
  well past 80 columns ("…each a closed type whose every value the
  configuration offers. The release repeating a dep has no row and no conjunct
  either — the"). No gate covers comment wrapping and it is not a finding;
  re-wrap it if the file is touched again.
- `6fcb53cf` rewrites `selector_runtime_settings_history` rows, which carry
  `administrator_kind`, `administrator_subject` and `recorded_at` — an audit of
  what was in force and who set it. A rewritten row says a figure was in force
  that was not. I could not name a failure: the only reader
  (`selector.ts:1147,1173`) restores a revision's controls, and restoring either
  figure is harmless. The alternative also breaks the fresh-install case, so
  the author's choice looks right; recording it because "a landed migration's
  rendering is frozen history" was the argument for this whole commit, and this
  statement rewrites history of a different kind.
- The finalization-failure loop is now unbounded in the model — no gas, no
  `finalizationLeft`, no wall — and finding 1 notwithstanding, the rework cap
  does not bound it either. That is Task A's/GOAL's machine change and outside
  B's scope; flagging it because house rule 9 says everything is bounded and
  nothing in `src/` now bounds that loop.
- Practices invoked: `fix-the-assumption-not-the-hack` (cited above).
  `layering` and `comments-describe-the-code` I did not load, because
  `check-boundaries` answered the placement question over the module graph and
  I found no comment I wanted to reject over.
- What I read and chose not to flag: the re-levered suites
  (`nativeActionAdmits`, `readiness`, `finalizerRework`, `i3`, `projection`,
  `ticketProjection`, `dispatchView`) all keep their claim and change the lever;
  the four deleted cases were each about an account alone; the semantics case
  moving from 3 to 4 in `journal.test.ts` is right, since 3 is this image's own.
  The grep account in `tasks/B-report.md` is accurate — I reran it and every
  surviving hit is one of the ones it names, `test/random/shrink.test.ts:74`
  included as genuinely unrelated.
