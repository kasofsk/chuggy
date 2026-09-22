# Mutation sweep — PR 6a "Work fan-out goes", whole branch

Reviewed at `a7885e6a` in `~/claude/chuggy-wt/fanout-sweep`, detached, scope
`git diff 0f94fe6b..a7885e6a`. Fresh session; I authored none of it. Each
mutation was applied alone, proved to have changed its file, and reverted; the
worktree was byte-clean when removed. Root and `ui/chuggy-ui` `node_modules`
symlinked; no `npm ci` anywhere.

## APPROVE

Fifty-five mutations over every added or changed behaviour the brief names.
Forty-nine went red in the narrowest gate or suite that should catch them.
**Six survived; none is a behaviour defect.** Four are provably equivalent or
unobservable, one is a model-side weakening the TS mirror answers, and one is a
proof gap a single case closes — finding 1, which predates the branch. The
round ships.

Baseline at this tip, all run here and all clean: check-model (114 tests) ·
check-model-api · check-conformance (11 goldens, 190 steps) · check-random
(2000 runs, 80000 steps) · check-source (6 stages, 207 unit suites) ·
check-queries · `test/postgres/migration.test.ts` (79 cases, own database) ·
check-console vitest (117 files, 1299 tests) · check-console-sheets (31) ·
check-boundaries (1057) · check-figures (102) · check-comments (908) ·
check-paths (1214 claims) · doc-lint (21) · check-duplication (1037) ·
check-gates (23) · check-shell-quoting · check-knowledge.

## The table — red

| # | mutation | went red in |
|---|---|---|
| Q1 | `.qnt` `spawnWork` spawns 2 (`ticket.qnt:368`) | check-model, 7 unit tests |
| Q3, Q5 | `.qnt` dispatch / resume sites back on `spawnOn(…, 2)` | check-model ×2–6 |
| Q6, Q7 | `.qnt` refinement release enablement a tautology; its `prog` emptied | check-model refinement unit / witness + hazard |
| M1 | `spawnWork` spawns 2 (`src/domain/ticket.ts:80`) | `deciders`, `invariants` |
| M4–M7 | each of the four spawn sites back on `spawnOn(…, tkWork, 2)` | `deciders` ×1–2 |
| M8 | `releasableAuthoring` returns true (`enablement.ts:180`) | `enablement`, `deciders` |
| A1 | one entry dropped from `ticketMutants` (`test/actor/equality.test.ts:67`) | check-source typecheck — the table is total by type |
| A2 | `decisionEventEnabled` drops `releasableAuthoring` (`decisionEvent.ts:190`) | `journal` refusal table |
| M9, M10 | `workFanout` back in `model-api.ts` / `modelTypes.ts` | check-model-api ×2 |
| M11 | `authoringSchema` admits an optional `workFanout` | `httpContract`, `responses` |
| CD2 | `authoringSchema` is `z.object`, not `z.strictObject` | `httpContract` |
| M12 | the cursor member restored (`contract/http.ts:547`) | `leadTokenBudget` |
| M13, M14 | `workFanout` back on `dispatchCandidateSchema` / `choices.workFanouts` back | `responses`, `httpOutcomes` |
| CD1 | `contractDocument.json` requires `workFanout` again | `contractDocument` |
| M15 | the interpreter offers `choices.workFanouts` again | check-source typecheck |
| M20 | `executionSourceEvaluated` takes `declared[0]` unconditionally | `executionSourceObservation` — the branch left standing IS proved |
| F1 | `handoffSuperseded` keeps the lowest spawn | `finalizerPreparation` |
| M17 | the candidate insert names `work_fanout` again | `schedulerStore` |
| M18 | the candidate select names `d.work_fanout` again | check-queries |
| M19 | the selector's candidate schema requires `workFanout` | `leadDurable`/`leadDecision`/`viaSession` |
| S1, S5 | 009's journal guard / its `session_turn` guard deleted | `migration` ×2 |
| S2, S3 | `DROP COLUMN` removed; the CHECK dropped and **not** restated | `migration` ×2 |
| S4 | `value ? 'workFanout'` removed, so the validator admits the field | `migration` |
| S6, S10 | the `session_turn` bound not re-rendered; re-rendered at 005's figure | `migration` ×2 |
| S7, S8 | the settings re-seed / the history re-seed skipped | `migration` ×2 |
| S9 | `leadObservationTokensPerDecisionAt009` back at 005's figure | `leadTokenBudget` |
| S11 | 009 not registered in `migrations/index.ts` | `migration` |
| C1 | `creationBodyFrom` sends `workFanout` again | 37 console cases, 2 files |
| C2 | `taskSetOf`'s work `expected` is 2 | 4 console cases |
| C3, C5 | the stage label / the `stageRow` lookup restored to the old shape | 1 and 3 console cases |
| C4 | the recast fixture's stage narrowed 3→2 | 1 console case |
| C6, C7 | `workFanout` back in a root / a `ui/` fixture | check-source typecheck; ui typecheck |
| G1 | `check-random.test.sh` back on seed `0x1` | check-random.test — 4 cases; the re-pin is honest |
| G2 | one golden's `steps` in `manifest.json` off by one | check-conformance |
| V1 | `encodeTicket` emits `workFanout` again (`test/itf/vocabulary.ts:193`) | check-conformance |
| D1 | the walk's release `permitsIn` always true (`test/random/draws.ts:137`) | check-random |

## Findings

1. **`src/domain/invariants.ts:116` — the Work arm's id-run claim is
   unproved.** Replacing `idsAreTheRunFrom(t.tasks, start, 1)` with `true`
   (M3) survives all 207 unit suites *and* check-conformance. The sibling
   conjunct `t.tasks.size === 1` masks every two-task fixture (M2 survives for
   the same reason: `idsAreTheRunFrom(…, 1)` already asserts `ids.length === 1`),
   and no case puts a *single* live work task at the wrong id. The header
   claims "the live ids are the contiguous run directly above the retired
   record — which is what the at-least-once-by-identity argument needs", so the
   claim is load-bearing and unchecked. The Evaluation arm's identical call
   **is** pinned: mutating `idsAreTheRunFrom(t.tasks, start, t.tasks.size)` to
   `true` goes red (control). Fix: one `assert.ok(!tasksWellFormed(…))` on a
   Work ticket with a non-empty `record` whose one live task sits at
   `firstTaskId` rather than `record.length + firstTaskId`.
   **Predates the branch** — the same mutation against
   `idsAreTheRunFrom(t.tasks, start, t.workFanout)` survives at `0f94fe6b`
   (run in a second worktree at the base) — but this diff rewrote the line, and
   the close is one assertion.

## Survivors that are not findings

- **Q2, M2 — provably equivalent.** `jb.tasks.size() == 1` → `>= 1` in the
  model and `t.tasks.size === 1` → `>= 1` in the mirror. In TS the conjunct is
  strictly redundant with `idsAreTheRunFrom(…, 1)`; in Quint it only differs
  for two task records sharing an id, which `spawnTasks` cannot produce.
- **Q4 — near-inert.** `ids == Set(start)` → `.subseteq(Set(start))` differs
  only on the empty set, which `size() == 1` already excludes.
- **M16 — unobservable.** A constant `workFanout: 1` added back to
  `canonicalCandidate` (`dispatchView.ts:98`) survives the whole unit suite and
  check-conformance: the digest is only ever compared with another digest of
  the same run (`dispatchView.test.ts:60-101`), no byte vector pins it, and
  `dispatch_view.digest` is truncated by the wipe. Confirms round 1's item 6.
- **F2 — unobservable.** `taskSetOf`'s work `expected` set to
  `set.executions.length` instead of `1`: a work set is built from exactly one
  execution, so the two agree. The literal is pinned from above (C2) and cannot
  be pinned from below.

## Docs pass and fabric alignment

Every comment and header the diff touches reads true against the code beside
it; I found nothing to flag. Checked in particular, on the code rather than the
claim: 009's "no grant follows the column out" (`baseline/privileges.ts:323-324`
grants `dispatch_candidate` by table, no column grant — true); its "one
constraint over the ticket, the version and the width"
(`baseline/relations.ts:124` — true, and the restatement is that predicate
minus the width, exactly); its "as 004 and 005 each held one at theirs"
(`004:76`, `005:117` — true); the validator it installs is **byte-identical to
008's but for the one line** (diffed as text); `ticket.qnt:361-366`'s "every
work spawn site (dispatch, both reworks, the work resume)" — four sites, all
four call it; `domain.qnt:71-74`'s "Work is not fanned out", against every
`N_TASKS` use (all stage widths); `deciders.ts:295`'s "a fresh work task";
`taskBriefing.ts:277`'s "a list past it"; `wipe-tickets.sql`'s re-pointed
header, whose `TRUNCATE` list does hold `journal_entry`, `session_turn`,
`dispatch_view` and `dispatch_candidate`, so both of 009's guards are
answerable; `ticketPageLedger.test.tsx:734-737`'s recast fixture docstring
(`retriesSpent` 1 and 2, drawn "Relaunched 3×" — both relaunched, as it now
says) and :814-817's case name, which no longer asserts an unreachable row.
Round 1's three machine notes were taken in `a7885e6a`. check-figures,
check-comments, check-paths and doc-lint are 0, and the branch states no lesson
(house rule 16).

**Fabric alignment: clean.** Nothing under `.chug/`, `images/` or `deploy/`
names `workFanout`, `work_fanout` or a work fan-out at all, and neither does
`~/claude/chuggy-fabric` or any of `~/claude/chuggy-fabric-wt/{no-accounts,
rollout-fix,worker-roster-build}`. The surviving hits in `src/` are the frozen
bodies of migrations 004–008, the baseline relation, and tests that exercise an
earlier vintage on purpose (`migration.test.ts:1909`, `journal.test.ts:229`).

## Notes

- **`src/actor/decisionSemantics.ts:6-11`, looked at and not flagged.** This
  branch changes the shape of a `CreateTicket` row without bumping
  `decisionSemanticsVersionCurrent`, and nothing in the diff or its nine commit
  messages says why. Under that header's own rule — "a version whose correction
  is empty is a number that says nothing" (`2c919741`) — staying at 6 is right:
  009's guard means no row of the old shape can survive the release, so a
  correction would be empty. What is missing is only the sentence PR 4 spent a
  commit writing; the header still explains version 6 by PR 5's rename alone.
  Not false, so not a finding; worth one line if this header is edited again.
- `deploy/rig/wipe-tickets.sql` now says "each such migration names it", which
  answers round 1's note and is true of 008 and 009 both.
- Practices invoked: `comments-describe-the-code` (the docs pass) and
  `modular-and-layered-code` (finding 1 is its "test hardest at domain
  boundaries" — the boundary here is the domain invariant the golden replay
  leans on).
- I did not mutate the goldens' step bodies: they are the model's output and
  `emit-goldens.sh` owns them. I mutated the manifest (G2) and the ITF
  vocabulary (V1) instead.
- One false start recorded so it is not repeated: `cd X && (A) & (B) &` leaves
  B in the old cwd, which ran a gate against `main` and printed main's figures.
  Every run in this sweep after that point cd'd inside its own subshell.
- Worktrees `fanout-sweep` and `fanout-base` removed; `fanoutsweep_t`,
  `fanoutsweep_s1` and `fanoutsweep_run` dropped from `chuggy-check-postgres`.
