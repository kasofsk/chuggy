# PR 4 — Finalization Unavailable escalates

Step 4 of the convergence (SPIKE.md plan; package pin 76c95a9). Base: main
e5f7b3d3 (PR 3 released; rig ledger 6). Survey: `survey.md` (read first; its
§4 table and §10 surprises set the decisions below). Effort dir: this
directory; tasks in `tasks/`, reviews in `reviews/`, ledger `reviews/ledger.md`.

**The failure this step prevents** (survey §4, §10.5): a finalization the
finalizer cannot carry out leaves the ticket in Finalization with no operator
exit — not revocable, not resumable, no native action — until the environment
changes under it. After this PR it escalates, says why, and Resume re-runs it.

## Decisions (orchestrator, 2026-09-21, under Geoff's overnight grant)

**The package's shape, in chuggy's terms.** `FinalizationOutcome` gains
`FinalizationResultUnavailable` (the package's name). `Reason` gains
`FinalizationUnavailableEscalated`. `decideFinalizationResult` on it escalates
with `resumeAt: ResumeFinalization` and label
`ticket-escalated finalization_unavailable_escalated`; `decideResumeTicket`'s
existing `ResumeFinalization` arm (`RunFinalizer` again) is the package's
"generation + 1 on the same pinned input", already realized as a new
`finalization_request` row at a later seq (survey §6). The model gains no
generation. Decision semantics stays **5** (survey §3: no stored row can carry
either new value; nothing re-derives differently).

**Which holds are "the result is unavailable".** Thirteen of the eighteen
`FinalizationHoldKind`s: the reachability holds `RepositoryUnbound`,
`TargetUnreadable`, `ProposalBaseUnreadable`, `ProposalBaseIsHead`,
`ProposalDenied`, `ReconciliationUnreadable`, `ProposalEvidenceUnstorable`,
`ProposalAbsent`, `ProposalUnaddressed`, `ProposalUnavailable`, and the three
exhausted budgets `PreparationRestartsExhausted`, `ProposalCreationsExhausted`,
`ProposalMergesExhausted` (the finalizer's own bounds, which Geoff placed in
the finalizer; a resume is a new request and a fresh count, which is exactly
generation + 1). **Five stay holds, unchanged by this PR**, each with where it
belongs: `ApprovalDeclined` and the Closed/Superseded/Merged half of
`ProposalRefused` are a human's answer and read as `FinalizationNeedsWork`
(a later PR; not language); `ProposalHeadMoved` is a rebuild (same);
`ContradictoryEvidence` is a durable-row defect for telemetry, not a desk
item; `ProposalMergeBlocked` is indistinguishable from "awaiting review" and
must not park a ticket that is merely waiting on a human at the forge. The
thirteen are a roster `finalizationUnavailableKinds` beside
`FinalizationHoldKind`, and the five are named in its doc comment as the
complement with the one-line reason each.

**When a hold becomes the result** (survey §10.3). A hold is recorded
durably on its request and reported Unavailable after a dwell:
- 007 adds to `finalization_request`: `hold_kind text` (CHECK: null or one of
  the thirteen), `hold_passes integer NOT NULL DEFAULT 0`, `held_since
  timestamptz`; whole-ness CHECK `(hold_kind IS NULL) = (held_since IS NULL)
  AND (hold_kind IS NULL) = (hold_passes = 0)`.
- A boundary function `record_finalization_hold(tenant, project, request,
  in_kind, claim fence as `submit_finalization_result` takes it)` for the
  finalizer role: same kind → `hold_passes + 1`; a different kind → kind
  replaced, `hold_passes = 1`, `held_since = now()`; `in_kind` null clears
  all three. `finalizerHold` (`finalizerRun.ts:331-340`) calls it with the
  kind when the kind is one of the thirteen and every non-held conclusion of
  a pass calls it with null — a pass that ends in a hold outside the thirteen
  leaves the record alone (so `ProposalMergeBlocked` after `TargetUnreadable`
  neither counts nor clears). The function returns the row's `hold_passes`.
- The finalizer reports `FinalizationResultUnavailable` when the returned
  `hold_passes` reaches `holdPassesMax`, a finalizer setting read where
  `preparationRestartsMax` is read, **with a code default so no fabric change
  rides with this PR**; the report's failure kind is the hold kind.
- `submit_finalization_result`'s third binding arm fences on the recorded
  hold, as the other two fence on an attempt: `in_outcome =
  'FinalizationResultUnavailable'` is admitted only when the bound request's
  `hold_kind` is not null and equals the submitted kind (`in_failure_kind`
  widened for this arm; S decides the narrowest way that keeps the attempt
  column's CHECK as it is), and no attempt is required. The command JSON
  carries the kind. Fulfilment (`decisionPlan.ts:408-411`) is unchanged; the
  fulfilled request keeps its hold columns — they are the evidence.

**The evidence reaches the reader.** The ticket read gains
`finalizationBlockedBy?: FinalizationUnavailableKind`, present only while
`reason = 'FinalizationUnavailableEscalated'`: the `hold_kind` of the ticket's
most recent `finalization_request` (by `authorizing_seq`), a tagged query in
`nativeReads.ts` beside `executionBlockedBy`, the same `chuggy_api` grant
shape. The roster lives where `blockedReasons` lives (contract rosters; the
interpreter imports it) so the wire, the console and the finalizer share one
list.

**Migration 007** (`007-finalization-unavailable.ts`, in 006's shape; guard
first reading fields, though the argument may be that there is nothing to
guard): the two reason CHECKs and the three outcome IN lists (survey §6), the
three columns and their CHECKs, `record_finalization_hold` with its grant to
the finalizer role, the third binding arm, `chuggy_api` grant on the new
columns. `decision_event_is_valid`'s `ExecutionBlocked` reason list is left
alone. Render-diff of 001–006 main vs branch empty.

**Model.** `finalizationOutcomes` draws the third; refinement and api gain
the branch; the `ResumeFinalization` model test is rebuilt on the now-reachable
path (`chuggy_test.qnt:499-503`) — the old hand-built state deleted, not
kept; the tenth aimed golden `finalization-unavailable.itf.json` fires the
new label and the resume after it; manifest row; witness roster count
re-checked in `check-model.sh`/`.test.sh`; `coverage.test.ts` regenerates.
`check-model` will be slower by one branch of the search; acceptable.

**Console.** The new reason's label, sentence, tone, section, resume point
and action follow the three existing reasons (the silent fallback at
`ticketActions.ts:145-149` gets an arm, not a wider fallback); the wall label
beside Parked comes off `finalizationBlockedBy` exactly as `executionBlockedBy`
does, with one short label per unavailable kind. Copy: nouns, one-word
statuses, one short line.

**Not in this PR.** NeedsWork for the human-answer holds; the handoff residue
in `finalization_request_kind_is_known`; any fabric or worker change (survey
§9: clean).

## Sequence

A. model + goldens + generated + `src/domain` + `src/actor` (semantics 5,
   rosters) + conformance + their tests. opus. Worktree
   `~/claude/chuggy-wt/finunavail`, branch `model/finalization-unavailable`.
S. migration 007 + `test/postgres/migration.test.ts` + render-diff. opus,
   parallel with A. Worktree `~/claude/chuggy-wt/finunavail-schema`, branch
   `schema/finalization-unavailable`, merged into A's branch after both land.
B. interpreter (finalizer hold record, dwell, Unavailable report and
   submission; `finalizationUnavailableKinds`), postgres finalizer adapter,
   readiness, wire, contract (`finalizationBlockedBy`, `escalationReasons`),
   `nativeReads`, tests. opus, after A and S.
C. console. sonnet, after B.
R. fresh reviewer per round (two halves as PR 3), whole-branch mutation sweep
   second, full roster with `origin/main` merged (`CHUG_CI_FULL=1`), PR,
   merge, release by the runbook with a dump first and 007 rehearsed on a
   restored rig copy as `chuggy_owner` (recipe in `pr3/GOAL.md`), sanity,
   record.

## Progress

- 2026-09-21: survey landed; goal written; A and S launched.
- 2026-09-21: A landed fbdb7b6f (refinement/api/mc needed no edit; golden finalization-unavailable + six re-walked goldens; witness into the existing gate test; semantics 5 with the header's argument; three smallest edits outside A: rosters.ts escalationReasons, resumePoint.ts, a placeholder sentence in codeSentences.ts for C). Attribution on A's commits names Opus 5; noted as PR 2 did, not rewritten. S running.
- 2026-09-21: S landed 978c0120 (007: two reason CHECKs, three outcome lists, three hold columns + CHECKs, record_finalization_hold with a claim fence, third binding arm on the recorded hold, grants incl. boundary_owner UPDATE and chuggy_api base columns; no guard by argument; 22 red-proofs; render-diff empty). Merged into model/finalization-unavailable. B launched.
- 2026-09-21: B landed 8a4cd92d. Refutations accepted: the record lives at the end of finalizerAdvance (finalizerHold holds no claim); a result-ending pass does NOT clear the hold (the fulfilled request keeps its evidence; the door fences on it); the submission carries no kind on the wire (the desk reads it off the request); evidence for Unavailable is nothing. Dwell: holdPassesMax default 10, env CHUG_FINALIZER_HOLD_PASSES_MAX, one pass per claim lease (30s), so about five minutes of a persisting hold. C launched.
- 2026-09-21: C landed 344d443b (check-console clean; resumeSentence made exhaustive; thirteen de-camelcased kind labels). Round 1 launched: machine at 8a4cd92d, surface at 344d443b.
- 2026-09-21: round 1: machine CHANGES (one comment, fixed b866a535), surface CHANGES (two unproved guards + a label) → F1 d38edc9a. Full roster clean at 344d443b. Sweep launched at d38edc9a.
- 2026-09-21: **007 rehearsal**: rig dump `rig/chuggy-pre-007-rehearsal.dump` (ledger 6, 32 finalization requests) restored locally; the branch's migrate as `chuggy_owner` applied 7 (`rig/migrate-007.log`): every request row whole with empty hold columns; `record_finalization_hold` SECURITY DEFINER with search_path pinned, executable by chuggy_finalizer and not chuggy_api; `decision_event_is_valid` admits FinalizationResultUnavailable. Machine reviewer's rig replay identical to main's.
- 2026-09-21 ~10:35Z: **landed and released.** Sweep at d38edc9a APPROVE (50 mutations, no behaviour defect); its three unpinned claims pinned (d4915f66, each red-proved). Full roster clean with main d126c09a merged. **PR #725 merged → main bd63df14.** Dump `/home/geoff/backups/chuggy-pre-bd63df14.dump`. Fabric #286 (api and web images) merged; `chuggy-migrate-bd63df14-registry` "applied 7" (finalization_request gained hold_kind/hold_passes/held_since; `record_finalization_hold` present); seven deployments rolled; ticket 84, draft 84, drafts page, configuration and console all 200; no error lines in any service log; no pod outside Running/Completed. Worktrees `finunavail` and `finunavail-sweep` removed.
