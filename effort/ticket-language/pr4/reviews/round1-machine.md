# Round 1 review — machine half (model, goldens, actor, migration 007)

Branch `model/finalization-unavailable` at 8a4cd92d, off main e5f7b3d3.
Worktree `~/claude/chuggy-wt/finunavail-review-machine`, read-only; the one
scratch edit (the mutation probe in §4) was reverted and `git status` is clean.

## CHANGES

### 1. `model/tests/chuggy_witness_test.qnt:154` — the comment states a fact the same file refutes

> "the desk's resume runs the finalizer again — **the only resume that
> re-enters the phase it left**, and the only exit a held finalization has"

`evaluationResumeWitness` (`model/tests/chuggy_witness_test.qnt:32-46`) is the
counterexample, sixty lines above in the same file: ticket 4 is blocked while
in Evaluation, `decideExecutionBlocked` stamps `ResumeEvaluation`
(`model/domain.qnt:566-568` → `Evaluation`), and the witness asserts the resume
puts it back in `Evaluation` — the phase it left. `ResumeEvaluation` re-enters
the phase its wall interrupted just as `ResumeFinalization` does.

What is actually singular about this resume is what the `domain.qnt` sibling
comment says and says correctly (`model/domain.qnt:521-524`): it is the only
one that re-runs *the very step* unchanged. `ResumeEvaluation` respawns stage 0
with new task ids and `ResumeWork`/`ResumeRework` respawn the work set, so
those resumes change the ticket; this one does not.

Fix: drop or restate that clause — e.g. "the only resume that re-runs the step
it interrupted, and the only exit a held finalization has". The second half of
the sentence is true and carries the point on its own.

Nothing else. The rest of the half is clean under every check below.

## What was checked, and what it said

**1. The model change is exactly the step.** `git diff main...HEAD -- model/`
is a third `FinalizationOutcome` member, a fifth `Reason`, one
`decideFinalizationResult` arm escalating at `ResumeFinalization` with
`ticket-escalated finalization_unavailable_escalated`, the matching
`finalizationOutcomes`/`finalizationOutcomeEnabled` members, and the doc
changes those force. No new generation, no invariant touched, `api.qnt`,
`refinement.qnt` and `mc/` unedited (enablement reads the draw set, so the
branch is picked up free).

The rebuilt resume test reaches the state through the wall:
`cEscFinalizer = dFinalizationUnavailable.post` (`chuggy_test.qnt:522`) with
the hand-built `escFinalizer` deleted, and its `accountedTicket` entry removed
correctly — the state is now derived from `cFinalizing`, which is accounted.

The witness went into the existing `chuggy_witness_gate_test` module, so the
gate's suite roster is unchanged: 4 unit + 6 witness + 3 refinement = the 13
`check-model.test.sh:74` asserts, and `check-model.sh` hard-codes no counts.
`.chug/tasks/check-model.sh` → **0 failure(s), 113 test(s) run**, exit 0.

**2. Goldens.** All ten re-emitted into scratch with
`.chug/tasks/emit-goldens.sh` under `CHUG_GOLDEN_DIR`, and `diff -rq` against
`test/golden/` reports **no differing file** — byte for byte, including the six
whose step counts moved (a third `finalizationOutcomes.oneOf()` branch re-walks
every aimed seed; nothing is hand-edited). Emitted step counts equal the
manifest's rows one for one.

The new golden carries both halves in one trace: state 30 is
`ticket-escalated finalization_unavailable_escalated`
(`Finalization → Escalated`, `OpenHumanTask`), state 31 is `ticket-resumed`
(`Escalated → Finalization`, `RunFinalizer`). `test/golden/coverage.test.ts`
passes all 12 assertions, including the aimed-content and declared-label ones;
corpus is 10 rows / 226 steps against the 24 / 800 cap.
`.chug/tasks/check-conformance.sh` → **10 golden(s), 226 step(s) replayed
clean**.

**3. Actor — semantics stays 5.** The header's argument holds. Both new values
are new: no row written by any earlier image can name either, `currentVocabulary`
maps no old spelling onto them, and none of the corrections at 1–3 reads a
finalization outcome or a reason beyond the ones it already names, so each
would be empty. The new `decisionSemantics.test.ts` case builds a history
through the wall and the resume at 5 and shows `storedJournalLegalOn` true and
the replay reaching `Escalated`/`FinalizationUnavailableEscalated`/
`ResumeFinalization` then `Finalization`.

Rig replay, this branch's `src` over `pr3/rig/vteng.jsonl`:

```
chuggy:     662 row(s), semantics 1/2/3, 4 cascade row(s) — storedJournalLegalOn = true
            replayed 78 ticket(s): Revoked 47, Done 31
rehearsal:  30 row(s), semantics 1, 5 cascade row(s) — storedJournalLegalOn = true
            replayed 15 ticket(s): Revoked 15
```

Identical, line for line, to the same script run against main's `src`. No row
a pre-PR main wrote replays differently.

**4. Migration 007.** Function bodies extracted from 006 and 007 and diffed:
`decision_event_is_valid` differs by one outcome literal, `ticket_command_is_valid`
by that literal plus the `kind` clause, `submit_finalization_result` by the
literal, the `f.hold_kind` projection, the attempt-precondition exemption, the
third arm and the envelope's `kind`. Nothing else drifted.

Both reason CHECKs are strict supersets of 006's (checked against the 006
source text), and the three new columns arrive `NULL`/`0` on every existing
row, which `finalization_request_hold_is_whole` calls whole — so **no
`finalization_request` row the rig holds today is refused**, and the header's
no-guard argument is sound rather than merely stated.

`record_finalization_hold` matches GOAL.md: same kind `+1` with `held_since`
untouched, a different kind to `1` and `now()`, null clearing all three, the
claim fence on owner and generation (and a null owner refused), an off-roster
kind refused by the column CHECK. The `hold_passes` OUT parameter does not
shadow the column — every read is `f.`-qualified and the `SET` target is never
substituted.

The third arm admits only `in_attempt IS NULL` with `bound.hold_kind IS NOT
NULL` equal to `in_failure_kind`, and the attempt precondition is exempted for
that outcome alone. **Mutation probe:** with the arm cut down to
`in_outcome = 'FinalizationResultUnavailable' AND bound.kind = 'RunFinalizer'`,
`.chug/tasks/check-postgres.sh` goes red on three tests —

- `the door admits the unavailable result at the recorded kind and at no other`
  (`test/postgres/finalizerUnavailable.test.ts`)
- `the door concludes unavailable on the recorded hold and on nothing else`
  (`test/postgres/migration.test.ts`)
- `the finalizer's door weighs the outcome it admits and refuses the name it
  has none of`

— so the fence is proved rather than asserted. Mutation reverted.

Grants: `UPDATE` on the three columns goes to the boundary owner only (which
is what the `SECURITY DEFINER` body runs as, and enough for its `FOR UPDATE OF
f`); the finalizer role reaches the columns only through `EXECUTE` on the
function; `chuggy_api` gets column-level `SELECT` and is proved unable to call
the function or read `state`. Render-diff of 001–006, main vs branch, with
`scratch/B-fix0/render.mjs`: **empty**.

**5. Docs and comments.** `check-figures`, `check-paths`, `check-comments`,
`doc-lint`, `check-knowledge` all 0 findings. The `schema/README.md` lock
enumeration is true: `record_finalization_hold` takes `FOR UPDATE OF f` on
`finalization_request` and nothing else, which is the first of the two
`submit_finalization_result` takes, in the order `finalizer.ts:62-65` declares.

**Gates run on this branch:** check-model 0/113 · check-model-api current ·
check-conformance 10/226 · check-random 2000 runs / 80000 steps ·
check-source 6 stages, 208 unit suites · check-postgres 76 suites clean ·
check-queries clean · check-boundaries 1058 modules · check-duplication ·
check-gates 23/23 · check-figures · check-paths · check-comments · doc-lint ·
check-knowledge. All exit 0.

## Notes — looked at, not flagged

- **`chuggy_api` reads `hold_passes` and `held_since` and uses neither.** The
  ticket read wants `hold_kind` alone. GOAL.md's decision says "`chuggy_api`
  grant on the new columns", so this is the decision rather than a slip, and I
  am not reopening it. The 007 header's phrase "the three the desk is there
  for" does overstate it — only one of the three reaches the desk — but the
  sentence's load-bearing half (the key columns a column-level grant needs so
  the row can be found at all) is right, so this is an opinion, not a finding.
- `action resume` in `chuggy_witness_gate_test` is declared between two `run`s
  rather than with the other actions at the top of the module. Quint does not
  care and neither do I; mentioned only because every other module groups them.
- The new `decisionSemantics.ts` paragraph generalizes ("A VALUE ADDED TO A
  DECIDER'S INPUT ALPHABET MINTS NO VERSION"). I weighed it against house rule
  16 and let it stand: that module is the declared home of the versioning rule
  and the paragraph exists to justify *this* change's decision not to mint 6,
  which is exactly what the surrounding header is for.
- Cross-half, since it could fall between the two reviews: 007 puts `kind` in
  the command envelope and `FinalizationSubmission` has no such field.
  `checkedFinalizationSubmission` (`src/interpreter/wire.ts:284-305`) reads
  fields one by one rather than strictly, and spreads the record through, so
  the extra key is carried and ignored. No gap.
- `decision_event_is_valid`'s `ExecutionBlocked` reason list is left alone, and
  correctly: the new reason is stamped only by `decideFinalizationResult`,
  never by `decideExecutionBlocked`.
- The revoke-fixture comment in `chuggy_test.qnt:590-593` had to change — the
  old "both desk-reason flavors" stopped being true the moment a fourth reason
  existed — and the replacement is accurate.

**Practices invoked:** none. The findings above are read off the tree's own
rules (the doc bar in `CLAUDE.md`, `review-change.md`'s discipline) rather than
off a general standard, so citing a skill would have been decoration.
