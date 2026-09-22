# Task B — the finalizer reports Unavailable; the wire and the reader carry it

Worktree `~/claude/chuggy-wt/finunavail`, branch `model/finalization-unavailable`, which carries Task A (model, goldens, domain, actor) merged with Task S (migration 007), tip 1f281d9c. S refuted three GOAL.md details — read its report: `record_finalization_hold` takes the claim owner and generation the finalizer heartbeats under (not `submit_finalization_result`'s fence); the `chuggy_api` grant covers the base columns your read needs; the roster tie-back test (`deepEqual` of the SQL constraint's list against `finalizationUnavailableKinds`) is yours to add in `test/postgres/`. A already put `FinalizationUnavailableEscalated` into `escalationReasons`. Root `npm ci` if stale. Read, in order: `~/claude/chuggy-effort/ticket-language/pr4/GOAL.md` (decisions settled; **Which holds**, **When a hold becomes the result**, **The evidence reaches the reader** are yours), `pr4/survey.md` §4, §5, §7, §10.3–§10.4, `pr4/tasks/A-report.md`, `pr4/tasks/S-report.md` (the function's exact signature and refusals; the failure-kind widening it chose), `CLAUDE.md`, `.chug/tasks/review-change.md`, then `src/interpreter/finalizer.ts` (`FinalizationHoldKind`, `finalizationNext`), `src/interpreter/finalizerRun.ts` (`finalizerHold`, the pass loop, where `preparationRestartsMax` is read), `src/adapters/postgres/finalizer.ts` (the submission caller), `src/adapters/postgres/readiness.ts` (`finalizationEvidenceOf`, `finalizationRequestSource`), `src/interpreter/wire.ts` (`checkedFinalizationSubmission`), `src/adapters/postgres/nativeReads.ts` (`executionBlockedBy`, the pattern to copy).

## Scope

`src/interpreter/`, `src/adapters/` (not `schema/`), `src/contract/`, and their tests under `test/`.

- `finalizationUnavailableKinds`: the thirteen, as a roster where `blockedReasons` lives (contract rosters), with the five excluded kinds named in its doc comment with the one-line reason each (GOAL.md gives them); `FinalizationHoldKind` stays the eighteen; a type `FinalizationUnavailableKind` derived from the roster; a unit test that the roster is a subset of `allFinalizationHoldKinds` and that the five are exactly the complement.
- The finalizer's pass: every pass ending in a hold whose kind is in the thirteen calls `record_finalization_hold` with the kind through the postgres finalizer adapter (a new port method on the finalizer store, in the supplied adapter too); every pass ending otherwise than a hold calls it with null; a hold outside the thirteen calls nothing. When the returned `hold_passes` reaches `holdPassesMax` — read where `preparationRestartsMax` is read, with a code default beside its siblings' defaults — the pass submits `FinalizationResultUnavailable` with the hold kind, through `submit_finalization_result`'s third arm as S built it. The telemetry (`finalizerTelemetry.ts`) keeps counting holds as it does; a new outcome counter if its siblings have one.
- `src/adapters/postgres/finalizer.ts` submission caller: the third outcome carries its kind (S's widening); `readiness.ts` `finalizationEvidenceOf` and `finalizationRequestSource` handle the new outcome (evidence is the hold kind, or nothing — say which and why).
- The ticket read gains `finalizationBlockedBy?: FinalizationUnavailableKind` (tagged query in `nativeReads.ts` beside `executionBlockedBy`: the `hold_kind` of the ticket's most recent `finalization_request` by `authorizing_seq`, present only while `reason = 'FinalizationUnavailableEscalated'`; `check-queries` must agree); `ticketResponseSchema` carries it optional; `escalationReasons` gains `FinalizationUnavailableEscalated`; the contract document and fixtures follow.
- A supplied/in-memory finalizer adapter test that drives a pass into a reachability hold `holdPassesMax` times and sees the Unavailable submission, and one that a hold outside the thirteen never submits; a postgres suite (`test/postgres/`, under the finalizer role) that records a hold, submits Unavailable, and reads `finalizationBlockedBy` back under the api role; one that the projection reason is `FinalizationUnavailableEscalated` after the actor decides the submission.
- Every comment in your layers naming the outcome or reason rosters.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Gates

`check-source` (unit + static), `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each exit on the tip.

## Commits

On `model/finalization-unavailable`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.

## Report

`~/claude/chuggy-effort/ticket-language/pr4/tasks/B-report.md`: tip, what changed per layer, the dwell's exact rule and default, the query for `finalizationBlockedBy`, the port method, files outside your layers touched, gates, anything GOAL.md got wrong. Under ~60 lines.
