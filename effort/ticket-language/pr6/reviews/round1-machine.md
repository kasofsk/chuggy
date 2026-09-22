# Round 1, machine half — PR 6a "Work fan-out goes" at 5c46f391

APPROVE

No finding. I read `model/{ticket,domain,refinement}.qnt` and their suites whole,
`009-work-fanout.ts` and the baseline it edits, `src/{domain,actor,interpreter,
contract,adapters}` diffs with the files around them, and the wipe script; I
re-emitted the goldens, re-ran the seed re-pin both ways, render-diffed the
ledger, re-proved six mutations on a real server, and ran the roster. Every
check below reached a verdict; none is an assumption.

## What I checked, and what the check said

1. **One task per work spawn, nothing else moved.** `spawnWork`
   (`model/ticket.qnt:368`) is `spawnOn(ticket, WorkTask, 1)` and is the only
   work spawn: `domain.qnt:363,462,492,568`. `spawnOn` survives for the three
   evaluation sites (`:406,448,574`) — the right split. `tasksWellFormed`'s Work
   arm is `size == 1` and `ids == Set(start)` (`:931-936`); the TS mirror at
   `invariants.ts:112-118` is the same pair. `N_TASKS` correctly stays: it bounds
   `stageChoices`, `validPrograms` and `init`, and its header now says only that.
   `refinement.qnt`'s payload, `execDecisionEvent`, `decisionEventEnabled` and
   `actorReleaseTicket` all follow, and `decisionEvent.ts:187-195` mirrors the
   conjuncts one for one — `journal.test.ts`'s refusal table still names every
   surviving conjunct and deleted only the one whose conjunct went.
   Against the package (`package/model/ticket-domain/ticket.qnt:344,386`): the
   package spawns exactly one obligation per cycle and chuggy now spawns exactly
   one task per cycle. Strictly closer; nothing further. The cycle number is
   still derived, which is PR 6b's.

2. **Goldens.** `.chug/tasks/emit-goldens.sh` at the tip rewrote all eleven and
   left `git status` empty — byte for byte, and the printed step counts match
   `manifest.json`'s new `steps`. Each aimed row's last state carries exactly the
   label its invariant refutes (walk: `settled`; the ten others each their own).
   `check-random.test.sh`'s re-pin is honest in both directions: I rebuilt the
   suite's own fixture tree with the phantom-completion mutant and ran the gate
   twice — `0x1` now exits 0 ("walked clean"), `0x3` exits 1. `check-random.test.sh`
   itself: 16/16.

3. **009.** Guard is byte-identical to 008's — compared as values, not by eye
   (`m8.statements[0] === m9.statements[0]`). The CHECK restatement is
   load-bearing and I proved it on the server rather than taking B's word:
   a three-column CHECK, `DROP COLUMN c`, and `pg_constraint` comes back empty —
   `(0,0)` then inserts. The restated predicate is the baseline's
   (`relations.ts:124`) minus the width, exactly. Render-diff of 001–008, main
   against the branch: empty; the only difference is migration 9's 84 lines.
   Re-proved by mutation on a live server, one at a time, each red:
   guard deleted; `DROP COLUMN` removed; CHECK dropped and not rewritten;
   `value ? 'workFanout'` removed; second `DO` guard deleted; both re-seed
   `UPDATE`s removed. I also mutated the re-rendered `session_turn` bound back to
   005's figure expecting a survivor — "the installed session constraints match
   the runtime" catches it, so the narrowing is proved too.
   The mailbox derivation is right, not just consistent: branch
   `sessionTurnInputCharsMax` is 17_360_363, main's 17_363_763, and the 3_400
   delta is exactly `"workFanout":` + 20 digits + comma over a 100-candidate page
   — the member `http.ts:548` lost. `leadObservationTokensPerDecisionAt009`
   equals it. The re-seed is 005's move verbatim (`replace` on settings and
   history, chained off 005's figure).
   Refusal over 005's fall-out is right under the wipe, and no writer names the
   field: the only encoder is the generated codec, which no longer emits it.
   I probed the installed validator at 009: `{ticket,deps,prog}` true;
   `workFanout` at a number, at `null`, at a string all false; no-`value` and
   non-object `value` still false (the arm that used to catch them was the one
   removed, so this was worth checking).

4. **Stored text.** The generated wire schemas are `z.object`, not strict, so a
   stored release naming `workFanout` **parses and is stripped** at every reader
   — and that is covered by a live case, not an argument:
   `test/postgres/journal.test.ts:229-249` restates exactly such a row and
   asserts the replay equals today's shape. `operation.command` and
   `selector_proposal_delivery.command` both go through `parseTicketCommand`,
   whose `Decide` arm refuses `CreateTicket` outright (`wire.ts:172-179`), so
   neither can see one. The boundary refuses what the readers strip — an
   asymmetry 009's header argues, and safe because `wipe-tickets.sql` truncates
   `draft_revision`, `operation`, `selector_proposal_delivery`, `session_turn`
   and `journal_entry` alike.

5. **`executionSourceObservation.ts:68` and `finalizerPreparation.ts`.** The
   several-commit branch is now unreachable, and I checked why rather than
   assuming: `execution_names_one_logical_task UNIQUE (tenant,project,ticket,
   task)` gives one execution row per task, and `execution_result_source_pkey
   (tenant,project,manifest)` one source row per manifest, so `produced`
   (`executionSourceHistory.ts`) can return at most one row and the adapter's
   `LIMIT 2` is dead with it. **My call: fine as it stands, and the deletion
   belongs to PR 6b.** The rule is total over the port's list type, the branch is
   three tokens, and the comment claims no reachability. I would not block on it;
   see the note below for why I would still rather it went.
   `finalizerPreparation.ts:306-316` is still meaningful: spawns are per cycle,
   reworks make several, and the highest task number still picks the latest.

6. **The digest.** `canonicalCandidate` changed shape and
   `dispatchViewSchemaVersion` was not bumped — correctly. The only stored digest
   is `dispatch_view.digest`, which the wipe truncates and `viewHeader` COALESCEs
   to a runtime `dispatchViewDigest([])` (unchanged, since it digests no
   candidates). The selector fence (`projectWriter.ts:317-322`) compares tenant,
   project, recovery epoch, schema version and ticket version — never the digest
   — so nothing compares an old digest against a new one across the release. A
   token surviving the wipe answers `SelectionChanged`, since its ticket is gone.

7. **Gates at the tip**, all exit 0: `check-figures` (102 files) ·
   `check-comments` (908) · `check-paths` (1214 claims) · `check-boundaries`
   (1057 modules) · `check-queries` · `check-postgres` (76 suites) ·
   `check-conformance` (11 goldens, 190 steps) · `check-random` (2000 runs) ·
   `check-model` (114 tests) · `check-source --static` (5 stages) and `--unit`
   (207 suites). I ran `check-model` and `check-source` beyond the brief because
   A's clean runs predate the S and B merges; `model/`, `test/golden/`,
   `src/generated`, `src/domain` and `src/actor` are untouched since 58f40608,
   which I verified rather than assumed.

## Notes — looked at, not flagged

- **`test/interpreter/taskBriefing.test.ts:1555`**, "more reports than the work
  fanout admits". B reworded the source comment (`taskBriefing.ts:277`) and left
  the case name, which now attributes an eight-report bound to a thing that is
  gone and would be one if it were not. Nothing fails; it is the last sentence in
  my half that says work has a width, so I would take it in the sweep.
- **`model/refinement.qnt:112,176-177,383,676`** use "task fan-out" for the
  emission a spawn runs. For work that is now a singleton. Defensible as generic
  vocabulary over both kinds, and A left it deliberately; I would not churn it.
- **`deploy/rig/wipe-tickets.sql:6`** names 008 as the migration whose guard the
  file answers. Still true, now incomplete — 009 raises the same refusal and a
  second one over `session_turn`. The file was born at 008 and has no precedent
  for being re-pointed, so this is a question for the release step, not the diff.
- **`executionSourceObservation.ts:68`**, the other half of item 5. Invoking
  *fix-the-assumption-not-the-hack*: the assumption the branch rests on is dead,
  and the practice's default is the rethink. I am not raising it as a finding
  because no failure follows and the cost of leaving it is one comment. But PR 6b
  makes the cycle structural, and if it does not delete the branch, the `LIMIT 2`
  and the "declared several" case, that is where the debt becomes real.
- **`enablement.ts:177-182`** is now a one-conjunct wrapper whose doc still says
  "checked together". Harmless; deleting the indirection is a bigger change than
  the doc is worth.
- **`deciders.ts:178-181`** still frames the work reduce as "unanimous pass",
  where `domain.qnt:385-387` now says the phase's success is the one task's.
  True over a singleton, so not a divergence.
- `test/postgres/migration.test.ts:3323-3384` correctly re-points the escalation
  fixture to `installationAt(migration008.version)`; within it, "the release tag
  this image writes" now means 008's image, which the header says.
- Practices invoked: *fix-the-assumption-not-the-hack*. I did not invoke
  *domain-modelling* or *layering*: the change removes a field and adds no
  concept, and the boundary gate answers the layering half.
- I did not review `ui/` or `test/ui` — the surface half is another reviewer's.
